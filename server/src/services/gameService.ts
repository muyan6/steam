import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { pinyin } from 'pinyin-pro';
import { POPULAR_GAMES_DATABASE } from '../data/popularGames.js';
import { CHINESE_KEYWORD_MAP } from '../data/chineseDictionary.js';
import { CompactGame, SteamGame, SearchSourceId, SearchPaginationResult } from '../types/index.js';
import { CONFIG } from '../config/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';

export class GameService {
  private popularGames: SteamGame[] = [...POPULAR_GAMES_DATABASE];
  private allGames: CompactGame[] = [];
  private chineseGamesCache: Map<number, SteamGame> = new Map();
  private imageCache: Map<number, string> = new Map();
  private isLoaded = false;
  private cacheFilePath: string;
  // 全量库 appId 索引：28.8万条线性扫描是每次详情查询的热点，建 Map 后 O(1)
  private allGamesById: Map<number, CompactGame> | null = null;
  // Steam 官方在线搜索结果 TTL 缓存（防同一热词反复实时打 Steam API）
  private onlineSearchCache: Map<string, { ts: number; items: SteamGame[] }> = new Map();
  private static ONLINE_SEARCH_TTL_MS = 5 * 60 * 1000;
  // 中文缓存防抖落盘：搜索热词命中时避免每次都在事件循环上同步全量写盘
  private cacheDirty = false;
  private cacheFlushTimer: ReturnType<typeof setTimeout> | null = null;

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
   * 将新检索到的中文游戏沉淀持久化到硬盘 JSON 文件中。
   * 防抖 60 秒批量落盘：缓存是可重建数据，宁可丢几秒也不在
   * 事件循环上同步写 50 万条全量 JSON 阻塞所有请求。
   */
  private saveChineseCache(): void {
    this.cacheDirty = true;
    if (this.cacheFlushTimer) return;
    this.cacheFlushTimer = setTimeout(() => {
      this.cacheFlushTimer = null;
      this.flushChineseCache();
    }, 60 * 1000);
  }

  private flushChineseCache(): void {
    if (!this.cacheDirty) return;
    this.cacheDirty = false;
    try {
      const list = Array.from(this.chineseGamesCache.values());
      writeJsonAtomic(this.cacheFilePath, list);
      console.log(`[GameService] 已将最新中文游戏沉淀入库，当前持久化总数: ${list.length} 款`);
    } catch (e) {
      this.cacheDirty = true;
      console.error('[GameService] 保存中文游戏缓存失败:', e);
    }
  }

  public async loadAllGamesDatabase(): Promise<void> {
    try {
      const dbPath = path.join(CONFIG.DATA_DIR, 'steam_all_games.json');
      if (fs.existsSync(dbPath)) {
        const content = fs.readFileSync(dbPath, 'utf-8');
        this.allGames = JSON.parse(content);
        this.allGamesById = null; // 数据变动，索引待重建
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

    // 3. 在全量库查找（Map 索引，O(1)）
    if (!this.isLoaded) await this.loadAllGamesDatabase();
    if (!this.allGamesById) {
      this.allGamesById = new Map(this.allGames.map((g) => [g.appId, g]));
    }
    const compact = this.allGamesById.get(appId);
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
   * 向 Steam 官方 Store 搜索接口检索中文匹配，并将结果沉淀入库。
   * 结果带 5 分钟 TTL 缓存：同一热词的并发/重复搜索不再实时打 Steam API，
   * 防止被官方封 IP，也减少大词触发全量缓存落盘的频率。
   */
  private async searchSteamStoreOnlineAndPersist(query: string): Promise<SteamGame[]> {
    const cacheKey = query.trim().toLowerCase();
    const cached = this.onlineSearchCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < GameService.ONLINE_SEARCH_TTL_MS) {
      return cached.items;
    }
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
            // 持久缓存容量上限：公开搜索接口可被脚本灌词，防止缓存文件无限膨胀
            if (this.chineseGamesCache.size >= 500000) {
              continue;
            }
            this.chineseGamesCache.set(appId, gameObj);
            hasNewGames = true;
          }
        }

        if (hasNewGames) {
          this.saveChineseCache();
        }

        // 空结果也缓存但用较短 TTL 占位，防止用无效词刷穿缓存上限
        this.onlineSearchCache.set(cacheKey, { ts: Date.now(), items: newResults });
        if (this.onlineSearchCache.size > 500) {
          const now = Date.now();
          for (const [k, v] of this.onlineSearchCache) {
            if (now - v.ts > GameService.ONLINE_SEARCH_TTL_MS) this.onlineSearchCache.delete(k);
          }
        }
        return newResults;
      }
    } catch {
      // 联网异常或超时静默跳过
    }

    return [];
  }

  /**
   * 精准映射中文关键词，支持复合词与多词联想
   */
  private getExpandedKeywords(query: string): string[] {
    const q = query.trim().toLowerCase();
    const keywords = new Set<string>([q]);

    // 1. 精确匹配词表
    if (CHINESE_KEYWORD_MAP[q]) {
      for (const kw of CHINESE_KEYWORD_MAP[q]) {
        keywords.add(kw.toLowerCase());
      }
    }

    // 2. 复合词与子串匹配（例如“黑神话悟空”自动命中“黑神话”与“悟空”映射词）
    for (const [dictKey, englishList] of Object.entries(CHINESE_KEYWORD_MAP)) {
      // 双向子串扩展需要最短长度限制，避免单字符查询命中几乎全部词条
      if (dictKey.length >= 2 && q.length >= 2 && (q.includes(dictKey) || (dictKey.includes(q) && q.length >= 2))) {
        for (const kw of englishList) {
          keywords.add(kw.toLowerCase());
        }
      }
    }

    return Array.from(keywords);
  }

  /**
   * 多数据源综合分页检索系统
   */
  public async searchGamesPaged(params: {
    query?: string;
    source?: SearchSourceId;
    page?: number;
    pageSize?: number;
  }): Promise<SearchPaginationResult> {
    const rawQ = (params.query || '').trim();
    const source: SearchSourceId = params.source || 'steam_official';
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.max(1, Math.min(100, params.pageSize || 48));

    if (!this.isLoaded) {
      await this.loadAllGamesDatabase();
    }

    const sourceNames: Record<SearchSourceId, string> = {
      steam_official: 'Steam官方API',
      cloud_db: '云端18万+自建库',
      steam_community: 'Steam社区搜索源',
      hybrid: '全域智能聚合源',
    local_db: '本地全量库'
    };

    let allMatched: SteamGame[] = [];

    // 模式 A：无关键词浏览全量库（3000+ 页海量宝库）
    if (!rawQ) {
      if (source === 'cloud_db' || source === 'hybrid') {
        const total = this.allGames.length || this.popularGames.length;
        const start = (page - 1) * pageSize;
        const end = start + pageSize;
        const slice = this.allGames.length > 0 ? this.allGames.slice(start, end) : [];

        const items: SteamGame[] = slice.map((g) => ({
          appId: g.appId,
          name: g.name,
          nameZh: g.name,
          headerUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${g.appId}/header.jpg`,
          description: `Steam 官方收录应用 (AppID: ${g.appId})`
        }));

        return {
          items: items.length > 0 ? items : this.popularGames.slice(0, pageSize),
          total: total > 0 ? total : this.popularGames.length,
          page,
          pageSize,
          totalPages: Math.ceil((total > 0 ? total : this.popularGames.length) / pageSize),
          source,
          sourceName: sourceNames[source]
        };
      } else {
        // Steam 官方或社区源默认显示热门库
        const total = this.popularGames.length;
        const start = (page - 1) * pageSize;
        const items = this.popularGames.slice(start, start + pageSize);

        return {
          items,
          total,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
          source,
          sourceName: sourceNames[source]
        };
      }
    }

    // 模式 B：有关键词检索
    const isNumber = /^\d+$/.test(rawQ);
    const seenAppIds = new Set<number>();
    const searchKeywords = this.getExpandedKeywords(rawQ);

    // 1. Steam 官方 API 源
    if (source === 'steam_official') {
      const onlineResults = await this.searchSteamStoreOnlineAndPersist(rawQ);
      for (const g of onlineResults) {
        if (!seenAppIds.has(g.appId)) {
          allMatched.push(g);
          seenAppIds.add(g.appId);
        }
      }

      // 如果官方 API 结果较少，用中文缓存和热门库补充
      for (const g of this.popularGames) {
        if (isNumber && g.appId.toString().includes(rawQ) && !seenAppIds.has(g.appId)) {
          allMatched.push(g);
          seenAppIds.add(g.appId);
        } else if (searchKeywords.some((kw) => g.name.toLowerCase().includes(kw) || (g.nameZh && g.nameZh.toLowerCase().includes(kw))) && !seenAppIds.has(g.appId)) {
          allMatched.push(g);
          seenAppIds.add(g.appId);
        }
      }
    }
    // 2. 云端 18万+ 自建库源 (支持全量拼音与关键词模糊)
    else if (source === 'cloud_db') {
      // 热门与中文库优先
      for (const g of this.popularGames) {
        if (isNumber && g.appId.toString().includes(rawQ) && !seenAppIds.has(g.appId)) {
          allMatched.push(g);
          seenAppIds.add(g.appId);
        } else if (searchKeywords.some((kw) => g.name.toLowerCase().includes(kw) || (g.nameZh && g.nameZh.toLowerCase().includes(kw))) && !seenAppIds.has(g.appId)) {
          allMatched.push(g);
          seenAppIds.add(g.appId);
        }
      }

      for (const g of this.chineseGamesCache.values()) {
        if (isNumber && g.appId.toString().includes(rawQ) && !seenAppIds.has(g.appId)) {
          allMatched.push(g);
          seenAppIds.add(g.appId);
        } else if (searchKeywords.some((kw) => g.name.toLowerCase().includes(kw) || (g.nameZh && g.nameZh.toLowerCase().includes(kw))) && !seenAppIds.has(g.appId)) {
          allMatched.push(g);
          seenAppIds.add(g.appId);
        }
      }

      // 全量 18 万中检索
      for (const g of this.allGames) {
        if (seenAppIds.has(g.appId)) continue;
        const nameLower = g.name.toLowerCase();
        let matched = false;
        if (isNumber) {
          matched = g.appId.toString().includes(rawQ);
        } else {
          matched = searchKeywords.some((kw) => nameLower.includes(kw));
        }

        if (matched) {
          allMatched.push({
            appId: g.appId,
            name: g.name,
            nameZh: g.name,
            headerUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${g.appId}/header.jpg`,
            description: `Steam 官方收录应用 (AppID: ${g.appId})`
          });
          seenAppIds.add(g.appId);
          // 匹配集上限，防止全量线性扫描返回超大响应
          if (allMatched.length >= 200) break;
        }
      }
    }
    // 3. Steam 社区源 / 4. 聚合源
    else {
      // 聚合热门 + 中文持久库 + 官方在线
      const onlineResults = await this.searchSteamStoreOnlineAndPersist(rawQ);
      for (const g of onlineResults) {
        if (!seenAppIds.has(g.appId)) {
          allMatched.push(g);
          seenAppIds.add(g.appId);
        }
      }

      for (const g of this.popularGames) {
        if (!seenAppIds.has(g.appId)) {
          if (isNumber && g.appId.toString().includes(rawQ)) {
            allMatched.push(g);
            seenAppIds.add(g.appId);
          } else if (searchKeywords.some((kw) => g.name.toLowerCase().includes(kw) || (g.nameZh && g.nameZh.toLowerCase().includes(kw)))) {
            allMatched.push(g);
            seenAppIds.add(g.appId);
          }
        }
      }

      for (const g of this.chineseGamesCache.values()) {
        if (!seenAppIds.has(g.appId)) {
          if (isNumber && g.appId.toString().includes(rawQ)) {
            allMatched.push(g);
            seenAppIds.add(g.appId);
          } else if (searchKeywords.some((kw) => g.name.toLowerCase().includes(kw) || (g.nameZh && g.nameZh.toLowerCase().includes(kw)))) {
            allMatched.push(g);
            seenAppIds.add(g.appId);
          }
        }
      }

      for (const g of this.allGames) {
        if (allMatched.length >= 200) break;
        if (seenAppIds.has(g.appId)) continue;
        const nameLower = g.name.toLowerCase();
        if (isNumber ? g.appId.toString().includes(rawQ) : searchKeywords.some((kw) => nameLower.includes(kw))) {
          allMatched.push({
            appId: g.appId,
            name: g.name,
            nameZh: g.name,
            headerUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${g.appId}/header.jpg`,
            description: `Steam 官方收录应用 (AppID: ${g.appId})`
          });
          seenAppIds.add(g.appId);
        }
      }
    }

    // 纯数字未收录时的保底
    if (isNumber && allMatched.length === 0) {
      const appId = parseInt(rawQ, 10);
      allMatched.push({
        appId,
        name: `Steam App ${appId}`,
        nameZh: `Steam 应用 (AppID: ${appId})`,
        headerUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
        description: '通过 AppID 直接检索的 Steam 应用'
      });
    }

    const total = allMatched.length;
    const start = (page - 1) * pageSize;
    const items = allMatched.slice(start, start + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      source,
      sourceName: sourceNames[source]
    };
  }

  public async searchGames(query: string, limit: number = 48): Promise<SteamGame[]> {
    const res = await this.searchGamesPaged({ query, pageSize: limit });
    return res.items;
  }

  public getTotalGamesCount(): number {
    return this.allGames.length + this.chineseGamesCache.size;
  }
}

export const gameService = new GameService();
