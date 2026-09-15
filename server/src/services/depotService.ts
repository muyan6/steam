import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { gameService } from './gameService.js';
import { writeStringAtomic } from '../utils/atomicJson.js';

/**
 * DepotKey 内存优化说明：
 * - 30 万条密钥用 Map 存储（实测约为普通对象字典的一半内存，~32MB vs ~62MB）；
 * - 同步合并改为原地 set，不再 {...旧, ...新} 整库复制（此前每日同步会产生
 *   一次与主库等大的瞬时副本，是内存尖峰的主要来源）；
 * - 落盘改为紧凑序列化（单字符串原子写），同时省去美化缩进的磁盘/解析开销。
 */
export class DepotService {
  private depotKeysDb: Map<string, string> = new Map();
  private isLoaded = false;
  // 数据库损坏时置位：禁止任何落盘，防止空库/残缺库覆写 28.8 万条真实密钥
  private saveBlocked = false;

  constructor() {
    this.loadDepotKeysDb();
  }

  public loadDepotKeysDb(): void {
    try {
      const dbPath = path.join(CONFIG.DATA_DIR, 'steam_depot_keys.json');
      if (fs.existsSync(dbPath)) {
        const content = fs.readFileSync(dbPath, 'utf-8');
        this.depotKeysDb = new Map(Object.entries(JSON.parse(content) as Record<string, string>));
        this.isLoaded = true;
        console.log(`[DepotService] 成功加载 DepotKey 数据库，共收录 ${this.depotKeysDb.size} 条解密密钥！`);
      } else {
        console.warn(`[DepotService] 未找到 DepotKey 数据库文件: ${dbPath}`);
        this.depotKeysDb = new Map();
        this.isLoaded = true;
      }
    } catch (e) {
      // fail-closed：损坏文件备份为 .corrupt（已存在则跳过，保留首次完整备份），
      // 保留已加载数据并置为已加载，禁止空库覆写与反复重载
      try {
        const dbPath = path.join(CONFIG.DATA_DIR, 'steam_depot_keys.json');
        if (fs.existsSync(dbPath) && !fs.existsSync(dbPath + '.corrupt')) {
          fs.copyFileSync(dbPath, dbPath + '.corrupt');
        }
      } catch {}
      this.isLoaded = true;
      this.saveBlocked = true;
      console.error('[DepotService] DepotKey 数据库损坏！已备份到 .corrupt，写入功能已禁用，请修复文件后重启服务:', e);
    }
  }

  public async getDepotsForGame(
    appId: number,
    dlcs: number[] = [],
    opts?: { skipRemoteHeader?: boolean }
  ): Promise<{ [depotId: string]: string }> {
    if (!this.isLoaded) {
      this.loadDepotKeysDb();
    }

    const matchedKeys: { [depotId: string]: string } = {};
    const isValidKey = (k?: string) => k && k.length >= 32 && !/^0+$/.test(k);

    // 1. 尝试从预设热门库中提取预设好的有效 depot keys 及 DLC 列表
    // opts 透传：本方法只用到 presetGame 的 depots/dlcs，不需要头图，
    // 元数据链路可借此跳过 Store API 的 4 秒超时
    const presetGame = await gameService.getGameByAppId(appId, opts);
    if (presetGame && presetGame.depots) {
      for (const [dId, key] of Object.entries(presetGame.depots)) {
        if (isValidKey(key)) {
          matchedKeys[dId] = key;
        }
      }
    }

    const effectiveDlcs = new Set<number>(dlcs);
    if (presetGame && presetGame.dlcs) {
      presetGame.dlcs.forEach((d) => effectiveDlcs.add(d));
    }

    // 2. 候选 DepotID 集合：主游戏本体 0~100 连续分包范围
    //
    // 这是**启发式兜底**，不是权威归属：SteamPipe 规范里 depot 与 app 强相邻，
    // 但相邻不等于属于本作 —— AppID 临近的无关游戏 depot 会被一并捞进来。
    // 实测 Brotato (1942280) 的权威分包只有 4 个（SteamCMD 报的
    // 1942281/1942282/1942283/2868390），而本方法扫出 10+ 个含
    // 1942291/1942321/1942361/1942381... 等非本作 ID。
    // 因此调用方必须区分场景：有权威分包清单时只用本结果补密钥，
    // 无权威来源时才用它兜底补分包。窗口不做扩大。
    const candidateDepotIds = new Set<number>();
    for (let i = 0; i <= 100; i++) {
      candidateDepotIds.add(appId + i);
    }

    // 3. DLC 分包范围 0~10（同上，仍属启发式兜底）
    for (const dlcId of effectiveDlcs) {
      for (let j = 0; j <= 10; j++) {
        candidateDepotIds.add(dlcId + j);
      }
    }

    // 4. 遍历并在 28.8万条密钥库中高精度匹配
    for (const dId of candidateDepotIds) {
      const key = this.depotKeysDb.get(String(dId));
      if (key && isValidKey(key)) {
        if (!matchedKeys[dId] || !isValidKey(matchedKeys[dId])) {
          matchedKeys[dId] = key;
        }
      }
    }

    return matchedKeys;
  }

  public getDepotKey(depotId: string): string | null {
    if (!this.isLoaded) this.loadDepotKeysDb();
    return this.depotKeysDb.get(depotId) || null;
  }

  public saveDepotKeys(newKeys: Record<string, string>): boolean {
    if (this.saveBlocked) {
      console.error('[DepotService] 数据库处于损坏保护状态，已拒绝写入以免覆写真实密钥库。请修复 steam_depot_keys.json 后重启服务。');
      return false;
    }
    try {
      // 原地合并（增量），保留已有有效密钥；不做整库展开复制，避免内存尖峰
      let added = 0;
      for (const [k, v] of Object.entries(newKeys)) {
        if (!this.depotKeysDb.has(k)) added++;
        this.depotKeysDb.set(k, v);
      }

      // 紧凑序列化：分块收集后一次性 join，避免 30 万次字符串 += 累积的
      // O(n²) 中间串分配，同时免去 Object.fromEntries 构建的大体积中间副本
      const dbPath = path.join(CONFIG.DATA_DIR, 'steam_depot_keys.json');
      const chunks: string[] = ['{'];
      let first = true;
      for (const [k, v] of this.depotKeysDb) {
        if (!first) chunks.push(',');
        chunks.push(JSON.stringify(k), ':', JSON.stringify(v));
        first = false;
      }
      chunks.push('}');
      const json = chunks.join('');
      writeStringAtomic(dbPath, json);
      this.isLoaded = true;
      console.log(`[DepotService] 已成功保存 ${this.depotKeysDb.size} 条 DepotKey（新增 ${added} 条）到 ${dbPath}`);
      return true;
    } catch (e: any) {
      console.error('[DepotService] 保存 DepotKey 数据库失败:', e.message);
      return false;
    }
  }

  public getTotalKeysCount(): number {
    if (!this.isLoaded) this.loadDepotKeysDb();
    return this.depotKeysDb.size;
  }
}

export const depotService = new DepotService();
