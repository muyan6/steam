import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { pinyin } from 'pinyin-pro';
import { POPULAR_GAMES_DATABASE } from '../data/popularGames.js';
import { CHINESE_KEYWORD_MAP } from '../data/chineseDictionary.js';
import { CompactGame, SteamGame } from '../types/index.js';
import { CONFIG } from '../config/index.js';

export class GameService {
  private popularGames: SteamGame[] = [...POPULAR_GAMES_DATABASE];
  private allGames: CompactGame[] = [];
  private chineseGamesCache: Map<number, SteamGame> = new Map();
  private imageCache: Map<number, string> = new Map();
  private isLoaded = false;
  private cacheFilePath: string;

  constructor() {
    this.cacheFilePath = path.join(CONFIG.DATA_DIR, 'chinese_games_cache.json');
    this.loadAllGamesDatabase();
    this.loadChineseCache();
  }

  /**
   * 加载持久化的中文游戏缓存数据库
   */
  private loadChineseCache(): void {
    try {
      if (fs.existsSync(this.cacheFilePath)) {
        const content = fs.readFileSync(this.cacheFilePath, 'utf-8');
        const list: SteamGame[] = JSON.parse(content);
        if (Array.isArray(list)) {
          for (const item of list) {
            this.chineseGamesCache.set(item.appId, item);
            if (item.headerUrl) {
              this.imageCache.set(item.appId, item.headerUrl);
            }
          }
          console.log(`[GameService] 成功载入 ${list.length} 条云端持久化中文游戏索引！`);
        }
      }
    } catch (e) {
      console.error('[GameService] 加载中文持久化缓存失败:', e);
    }
  }

  /**
   * 将新检索到的中文游戏沉淀持久化到硬盘 JSON 文件中
   */
  private saveChineseCache(): void {
    try {
      const list = Array.from(this.chineseGamesCache.values());
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(list, null, 2), 'utf-8');
      console.log(`[GameService] 已将最新中文游戏沉淀入库，当前持久化总数: ${list.length} 款`);
    } catch (e) {
      console.error('[GameService] 保存中文游戏缓存失败:', e);
    }
  }

  public async loadAllGamesDatabase(): Promise<void> {
    try {
      const dbPath = path.join(CONFIG.DATA_DIR, 'steam_all_games.json');
      if (fs.existsSync(dbPath)) {
        const content = fs.readFileSync(dbPath, 'utf-8');
        this.allGames = JSON.parse(content);
        this.isLoaded = true;
        console.log(`[GameService] 成功加载全量 Steam 数据库，共收录 ${this.allGames.length} 款游戏！`);
      } else {
        console.warn(`[GameService] 未找到游戏数据库文件: ${dbPath}`);
      }
    } catch (e) {
      console.error('[GameService] 加载游戏数据库失败:', e);
    }
  }

  public getPopularGames(): SteamGame[] {
    return this.popularGames;
  }

  /**
   * 动态解析 Steam 官方最新的带 Hash 的封面图片地址 (针对新发售/新版本游戏)
   */
  public async fetchRealSteamHeader(appId: number): Promise<string | null> {
    if (this.imageCache.has(appId)) {
      return this.imageCache.get(appId)!;
    }

    try {
      const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=schinese`;
      const resp = await axios.get(url, {
        timeout: 4000,
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const data = resp.data?.[appId.toString()];
      if (data && data.data && data.data.header_image) {
        const imgUrl = data.data.header_image;
        this.imageCache.set(appId, imgUrl);
        return imgUrl;
      }
    } catch {
      // ignore
    }
    return null;
  }

  public async getGameByAppId(appId: number): Promise<SteamGame | null> {
    // 1. 优先在精修热门库查找
    const pop = this.popularGames.find((g) => g.appId === appId);
    if (pop) return pop;

    // 2. 在持久化中文缓存库中查找
    if (this.chineseGamesCache.has(appId)) {
      return this.chineseGamesCache.get(appId)!;
    }

    // 3. 在全量库查找
    if (!this.isLoaded) await this.loadAllGamesDatabase();
    const compact = this.allGames.find((g) => g.appId === appId);
    if (compact) {
      const realHeader = await this.fetchRealSteamHeader(compact.appId);
      return {
        appId: compact.appId,
        name: compact.name,
        nameZh: compact.name,
        headerUrl: realHeader || `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${compact.appId}/header.jpg`,
        description: `Steam 官方收录应用 (AppID: ${compact.appId})`
      };
    }

    return null;
  }

  /**
   * 生成汉字的拼音全拼与首字母缩写
   */
  private generatePinyin(text: string): string {
    try {
      const full = pinyin(text, { toneType: 'none', nonZh: 'consecutive' }).replace(/\s+/g, '');
      const first = pinyin(text, { pattern: 'first', toneType: 'none', nonZh: 'consecutive' }).replace(/\s+/g, '');
      return `${full} ${first}`.toLowerCase();
    } catch {
      return '';
    }
  }

  /**
   * 向 Steam 官方 Store 搜索接口检索中文匹配，并将结果沉淀入库
   */
  private async searchSteamStoreOnlineAndPersist(query: string): Promise<SteamGame[]> {
    try {
      const url = 'https://store.steampowered.com/api/storesearch/';
      const resp = await axios.get(url, {
        params: {
          term: query,
          l: 'schinese',
          cc: 'CN'
        },
        timeout: 3000,
        headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster/1.0' }
      });

      if (resp.data && resp.data.items && Array.isArray(resp.data.items)) {
        let hasNewGames = false;
        const newResults: SteamGame[] = [];

        for (const item of resp.data.items) {
          const appId = item.id;
          const nameZh = item.name;
          const py = this.generatePinyin(nameZh);

          const gameObj: SteamGame = {
            appId,
            name: item.name,
            nameZh,
            pinyin: py,
            headerUrl: item.tiny_image
              ? item.tiny_image.replace(/capsule_sm_\d+\.jpg/, 'header.jpg')
              : `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
            description: `Steam 商店收录应用 (AppID: ${appId})`
          };

          newResults.push(gameObj);

          if (!this.chineseGamesCache.has(appId)) {
            this.chineseGamesCache.set(appId, gameObj);
            hasNewGames = true;
          }
        }

        if (hasNewGames) {
          this.saveChineseCache();
        }

        return newResults;
      }
    } catch {
      // 联网异常或超时静默跳过
    }

    return [];
  }

  /**
   * 精准映射中文关键词，避免泛滥模糊匹配
   */
  private getExpandedKeywords(query: string): string[] {
    const q = query.trim().toLowerCase();
    const keywords = new Set<string>([q]);

    // 只进行明确的词表映射，避免泛滥包含匹配
    if (CHINESE_KEYWORD_MAP[q]) {
      for (const kw of CHINESE_KEYWORD_MAP[q]) {
        keywords.add(kw.toLowerCase());
      }
    }

    return Array.from(keywords);
  }

  public async searchGames(query: string, limit: number = 48): Promise<SteamGame[]> {
    const rawQ = query.trim();
    if (!rawQ) {
      return this.popularGames;
    }

    if (!this.isLoaded) {
      await this.loadAllGamesDatabase();
    }

    const results: SteamGame[] = [];
    const seenAppIds = new Set<number>();
    const isNumber = /^\d+$/.test(rawQ);

    const searchKeywords = this.getExpandedKeywords(rawQ);

    // 1. 优先在精修热门库中匹配
    for (const game of this.popularGames) {
      if (isNumber && game.appId.toString().includes(rawQ)) {
        results.push(game);
        seenAppIds.add(game.appId);
        continue;
      }

      const gameNameLower = game.name.toLowerCase();
      const gameZhLower = game.nameZh ? game.nameZh.toLowerCase() : '';
      const gamePinyinLower = game.pinyin ? game.pinyin.toLowerCase() : '';

      let matched = false;
      for (const kw of searchKeywords) {
        if (gameNameLower.includes(kw) || gameZhLower.includes(kw) || gamePinyinLower.includes(kw)) {
          matched = true;
          break;
        }
      }

      if (matched) {
        results.push(game);
        seenAppIds.add(game.appId);
      }
    }

    // 2. 匹配持久化中文游戏数据库
    for (const game of this.chineseGamesCache.values()) {
      if (results.length >= limit) break;
      if (seenAppIds.has(game.appId)) continue;

      if (isNumber && game.appId.toString().includes(rawQ)) {
        results.push(game);
        seenAppIds.add(game.appId);
        continue;
      }

      const gameNameLower = game.name.toLowerCase();
      const gameZhLower = game.nameZh ? game.nameZh.toLowerCase() : '';
      const gamePinyinLower = game.pinyin ? game.pinyin.toLowerCase() : '';

      let matched = false;
      for (const kw of searchKeywords) {
        if (gameNameLower.includes(kw) || gameZhLower.includes(kw) || gamePinyinLower.includes(kw)) {
          matched = true;
          break;
        }
      }

      if (matched) {
        results.push(game);
        seenAppIds.add(game.appId);
      }
    }

    // 3. 在全量 18万+ 数据库中检索
    for (const game of this.allGames) {
      if (results.length >= limit) break;
      if (seenAppIds.has(game.appId)) continue;

      const gameNameLower = game.name.toLowerCase();
      let matched = false;

      if (isNumber) {
        matched = game.appId.toString().includes(rawQ);
      } else {
        for (const kw of searchKeywords) {
          if (gameNameLower.includes(kw)) {
            matched = true;
            break;
          }
        }
      }

      if (matched) {
        // 如果已有缓存的高清图则使用，否则使用标准路径
        const cachedImg = this.imageCache.get(game.appId);
        results.push({
          appId: game.appId,
          name: game.name,
          nameZh: game.name,
          headerUrl: cachedImg || `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/header.jpg`,
          description: `Steam 官方收录应用 (AppID: ${game.appId})`
        });
        seenAppIds.add(game.appId);
      }
    }

    // 4. 如果是中文检索且命中条目为 0，尝试连线 Steam 在线接口补充并持久化
    if (!isNumber && results.length === 0) {
      const onlineResults = await this.searchSteamStoreOnlineAndPersist(rawQ);
      for (const game of onlineResults) {
        if (!seenAppIds.has(game.appId) && results.length < limit) {
          results.push(game);
          seenAppIds.add(game.appId);
        }
      }
    }

    // 5. 如果是纯数字且库中完全未收录，自动生成兜底应用对象
    if (isNumber && results.length === 0) {
      const appId = parseInt(rawQ, 10);
      results.push({
        appId,
        name: `Steam App ${appId}`,
        nameZh: `Steam 应用 (AppID: ${appId})`,
        headerUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
        description: '通过 AppID 直接检索的 Steam 应用'
      });
    }

    return results;
  }

  public getTotalGamesCount(): number {
    return this.allGames.length + this.chineseGamesCache.size;
  }
}

export const gameService = new GameService();
