import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { gameService } from './gameService.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';

export class DepotService {
  private depotKeysDb: { [depotId: string]: string } = {};
  private isLoaded = false;

  constructor() {
    this.loadDepotKeysDb();
  }

  public loadDepotKeysDb(): void {
    try {
      const dbPath = path.join(CONFIG.DATA_DIR, 'steam_depot_keys.json');
      if (fs.existsSync(dbPath)) {
        const content = fs.readFileSync(dbPath, 'utf-8');
        this.depotKeysDb = JSON.parse(content);
        this.isLoaded = true;
        console.log(`[DepotService] 成功加载 DepotKey 数据库，共收录 ${Object.keys(this.depotKeysDb).length} 条解密密钥！`);
      } else {
        console.warn(`[DepotService] 未找到 DepotKey 数据库文件: ${dbPath}`);
        this.depotKeysDb = {};
        this.isLoaded = true;
      }
    } catch (e) {
      // fail-closed：损坏文件备份为 .corrupt，保留已加载数据，禁止空库覆写
      try { const dbPath = path.join(CONFIG.DATA_DIR, 'steam_depot_keys.json'); if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, dbPath + '.corrupt'); } catch {}
      console.error('[DepotService] DepotKey 数据库损坏！已备份到 .corrupt，写入功能已禁用，请修复文件后重启服务:', e);
    }
  }

  public async getDepotsForGame(appId: number, dlcs: number[] = []): Promise<{ [depotId: string]: string }> {
    if (!this.isLoaded) {
      this.loadDepotKeysDb();
    }

    const matchedKeys: { [depotId: string]: string } = {};
    const isValidKey = (k?: string) => k && k.length >= 32 && !/^0+$/.test(k);

    // 1. 尝试从预设热门库中提取预设好的有效 depot keys 及 DLC 列表
    const presetGame = await gameService.getGameByAppId(appId);
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

    // 2. 候选 DepotID 集合：主游戏本体 0~100 连续分包范围（SteamPipe 规范内 depot 与 app 强相邻，
    //    该启发式仅用于主游戏；命中后仍由客户端按 depot 元数据归属使用）
    const candidateDepotIds = new Set<number>();
    for (let i = 0; i <= 100; i++) {
      candidateDepotIds.add(appId + i);
    }

    // 3. DLC 分包范围收紧为 0~10（原 0~30 会把 AppID 相邻的无关游戏的密钥误配进来）
    for (const dlcId of effectiveDlcs) {
      for (let j = 0; j <= 10; j++) {
        candidateDepotIds.add(dlcId + j);
      }
    }

    // 4. 遍历并在 28.8万条密钥库中高精度匹配
    for (const dId of candidateDepotIds) {
      const key = this.depotKeysDb[dId.toString()];
      if (isValidKey(key)) {
        if (!matchedKeys[dId] || !isValidKey(matchedKeys[dId])) {
          matchedKeys[dId] = key;
        }
      }
    }

    return matchedKeys;
  }

  public getDepotKey(depotId: string): string | null {
    if (!this.isLoaded) this.loadDepotKeysDb();
    return this.depotKeysDb[depotId] || null;
  }

  public saveDepotKeys(newKeys: Record<string, string>): boolean {
    try {
      // 增量合并，保留已有有效密钥
      this.depotKeysDb = { ...this.depotKeysDb, ...newKeys };
      const dbPath = path.join(CONFIG.DATA_DIR, 'steam_depot_keys.json');
      writeJsonAtomic(dbPath, this.depotKeysDb);
      this.isLoaded = true;
      console.log(`[DepotService] 已成功保存 ${Object.keys(this.depotKeysDb).length} 条 DepotKey 到 ${dbPath}`);
      return true;
    } catch (e: any) {
      console.error('[DepotService] 保存 DepotKey 数据库失败:', e.message);
      return false;
    }
  }

  public getTotalKeysCount(): number {
    if (!this.isLoaded) this.loadDepotKeysDb();
    return Object.keys(this.depotKeysDb).length;
  }
}

export const depotService = new DepotService();
