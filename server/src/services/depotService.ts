import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { gameService } from './gameService.js';

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
      }
    } catch (e) {
      console.error('[DepotService] 加载 DepotKey 数据库失败:', e);
    }
  }

  public async getDepotsForGame(appId: number, dlcs: number[] = []): Promise<{ [depotId: string]: string }> {
    if (!this.isLoaded) {
      this.loadDepotKeysDb();
    }

    const matchedKeys: { [depotId: string]: string } = {};

    // 1. 尝试从预设热门库中提取预设好的 depot keys
    const presetGame = await gameService.getGameByAppId(appId);
    if (presetGame && presetGame.depots) {
      Object.assign(matchedKeys, presetGame.depots);
    }

    // 2. 候选 DepotID 集合：主游戏本体及常见分包
    const candidateDepotIds = [
      appId,
      appId + 1,
      appId + 2,
      appId + 3,
      appId + 4,
      appId + 5,
      appId + 10,
      appId + 20,
      appId + 30
    ];

    // 3. 将 DLC 也作为候选 Depot 包含进来
    for (const dlcId of dlcs) {
      candidateDepotIds.push(dlcId, dlcId + 1, dlcId + 2);
    }

    // 4. 遍历并在 28.8万条密钥库中匹配
    for (const dId of candidateDepotIds) {
      const key = this.depotKeysDb[dId.toString()];
      if (key && !matchedKeys[dId]) {
        matchedKeys[dId] = key;
      }
    }

    return matchedKeys;
  }

  public getDepotKey(depotId: string): string | null {
    if (!this.isLoaded) this.loadDepotKeysDb();
    return this.depotKeysDb[depotId] || null;
  }

  public getTotalKeysCount(): number {
    return Object.keys(this.depotKeysDb).length;
  }
}

export const depotService = new DepotService();
