import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { pinyin } from 'pinyin-pro';
import { POPULAR_GAMES_DATABASE } from '../data/popularGames.js';
import { CHINESE_KEYWORD_MAP } from '../data/chineseDictionary.js';
import { CompactGame, SteamGame, SearchSourceId, SearchPaginationResult } from '../types/index.js';
import { CONFIG } from '../config/index.js';
import { writeJsonAtomicAsync } from '../utils/atomicJson.js';
import { buildGameDictBinary, hashGameDictBinary } from '../utils/gameDictCodec.js';

export class GameService {
  private popularGames: SteamGame[] = [...POPULAR_GAMES_DATABASE];
  private allGames: CompactGame[] = [];
  private chineseGamesCache: Map<number, SteamGame> = new Map();
  private imageCache: Map<number, string> = new Map();
  // 封面图拉取失败的短 TTL 负缓存（appId -> 失败时间戳），防止重复请求打穿 Steam API
  private negativeHeaderCache: Map<number, number> = new Map();
  private static NEGATIVE_HEADER_TTL_MS = 5 * 60 * 1000;
  // 负缓存容量上限：公开接口可按 AppID 枚举，无界会随随机/无效 ID 持续膨胀
  private static NEGATIVE_CACHE_MAX = 20000;
  // 内存缓存硬上限：超过时按插入序淘汰最旧条目
  private static IMAGE_CACHE_MAX = 5000;
  private isLoaded = false;
  private cacheFilePath: string;
  // 全量库 appId 索引：28.8万条线性扫描是每次详情查询的热点，建 Map 后 O(1)
  private allGamesById: Map<number, CompactGame> | null = null;
  // Steam 官方在线搜索结果 TTL 缓存（防同一热词反复实时打 Steam API）
  // ttl 逐条存储：空结果必须用短 TTL（见 searchSteamStoreOnlineAndPersist），
  // 统一读全局常量会让「空结果短 TTL」的承诺失效
  private onlineSearchCache: Map<string, { ts: number; items: SteamGame[]; ttl: number }> = new Map();
  private static ONLINE_SEARCH_TTL_MS = 5 * 60 * 1000;
  // 空结果短 TTL：用户改一个错别字后应能立刻重查，而不是被冻结 5 分钟
  private static ONLINE_SEARCH_EMPTY_TTL_MS = 20 * 1000;
  // 中文缓存防抖落盘：搜索热词命中时避免每次都在事件循环上同步全量写盘
  private cacheDirty = false;
  private cacheFlushTimer: ReturnType<typeof setTimeout> | null = null;
  // 游戏字典二进制缓存（客户端离线检索基线）：懒构建 + 数据变更后失效重建
  private libraryCache: { buffer: Buffer; sha256: string; count: number } | null = null;

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
            // imageCache 的 5000 上限此前只在 fetchRealSteamHeader 里生效，
            // 从磁盘全量灌入时完全没有约束 —— 缓存文件涨到几十万条后，
            // 每次重启都会把整份封面 URL 塞进内存，且永远不会被淘汰。
            if (item.headerUrl) {
              if (this.imageCache.size >= GameService.IMAGE_CACHE_MAX) {
                const oldest = this.imageCache.keys().next().value;
                if (oldest !== undefined) this.imageCache.delete(oldest);
              }
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
    this.scheduleChineseCacheFlush();
  }

  /** 单次排定防抖落盘；已有计时器时不重复排定 */
  private scheduleChineseCacheFlush(): void {
    if (this.cacheFlushTimer) return;
    this.cacheFlushTimer = setTimeout(() => {
      this.cacheFlushTimer = null;
      void this.flushChineseCache();
    }, 60 * 1000);
    // 计时器不阻止进程退出
    (this.cacheFlushTimer as any).unref?.();
  }

  private flushingChineseCache = false;

  private async flushChineseCache(): Promise<void> {
    if (!this.cacheDirty || this.flushingChineseCache) return;
    this.cacheDirty = false;
    this.flushingChineseCache = true;
    try {
      const list = Array.from(this.chineseGamesCache.values());
      // 异步原子写：最多 50 万条的缓存落盘不再同步阻塞事件循环
      await writeJsonAtomicAsync(this.cacheFilePath, list);
      // 中文缓存已持久化变更，字典二进制随之失效，下次访问自动重建
      this.libraryCache = null;
      console.log(`[GameService] 已将最新中文游戏沉淀入库，当前持久化总数: ${list.length} 款`);
    } catch (e) {
      this.cacheDirty = true;
      console.error('[GameService] 保存中文游戏缓存失败:', e);
      // 必须重排定时器：flushChineseCache 被调用时 cacheFlushTimer 已被清空，
      // 只恢复 dirty 标记而没有计时器的话，在下次命中搜索热词之前
      // 这批数据再也没有落盘机会（进程重启即全部丢失）。
      this.scheduleChineseCacheFlush();
    } finally {
      this.flushingChineseCache = false;
    }
  }

  public async loadAllGamesDatabase(): Promise<void> {
    try {
      const dbPath = path.join(CONFIG.DATA_DIR, 'steam_all_games.json');
      if (fs.existsSync(dbPath)) {
        const content = fs.readFileSync(dbPath, 'utf-8');
        this.allGames = JSON.parse(content);
        this.allGamesById = null; // 数据变动，索引待重建
        this.allGamesLowerNames = null; // 数据变动，小写名索引待重建
        this.libraryCache = null; // 数据变动，游戏字典二进制待重建
        console.log(`[GameService] 成功加载全量 Steam 数据库，共收录 ${this.allGames.length} 款游戏！`);
      } else {
        console.warn(`[GameService] 未找到游戏数据库文件: ${dbPath}`);
        this.allGames = [];
        this.allGamesById = null;
        this.allGamesLowerNames = null;
        this.libraryCache = null;
      }
    } catch (e) {
      // fail-closed：解析失败也必须结束「未加载」状态。
      // 原实现在 catch 中不置 isLoaded，导致此后每个 /api/games/search、
      // /api/games/:appId 都重新同步 readFileSync + JSON.parse 8MB 全量库，
      // 事件循环被反复阻塞数秒。与 depotService / tokenService / dlcIndexService
      // 的损坏保护保持一致：降级为空库并告警，等人工修复后重启，绝不反复重试。
      this.allGames = [];
      this.allGamesById = null;
      this.allGamesLowerNames = null;
      this.libraryCache = null;
      console.error(
        '[GameService] 游戏数据库加载失败！已降级为空库，需人工修复 server/data/steam_all_games.json 后重启服务:',
        e
      );
    } finally {
      this.isLoaded = true;
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
    // 负缓存：5 分钟内拉取过的失败 AppID 直接返回 null，不反复打 Steam API
    const negTs = this.negativeHeaderCache.get(appId);
    if (negTs && Date.now() - negTs < GameService.NEGATIVE_HEADER_TTL_MS) {
      return null;
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
        this.negativeHeaderCache.delete(appId);
        // 内存上限保护：超限按插入序淘汰最旧条目
        if (this.imageCache.size > GameService.IMAGE_CACHE_MAX) {
          const oldest = this.imageCache.keys().next().value;
          if (oldest !== undefined) this.imageCache.delete(oldest);
        }
        return imgUrl;
      }
    } catch {
      // ignore
    }
    this.negativeHeaderCache.set(appId, Date.now());
    // 负缓存同样限容：超限先清过期项，仍超限则按插入序淘汰最旧，防公开接口枚举打爆内存
    if (this.negativeHeaderCache.size > GameService.NEGATIVE_CACHE_MAX) {
      const now = Date.now();
      for (const [id, ts] of this.negativeHeaderCache) {
        if (now - ts >= GameService.NEGATIVE_HEADER_TTL_MS) this.negativeHeaderCache.delete(id);
      }
      while (this.negativeHeaderCache.size > GameService.NEGATIVE_CACHE_MAX) {
        const oldest = this.negativeHeaderCache.keys().next().value;
        if (oldest === undefined) break;
        this.negativeHeaderCache.delete(oldest);
      }
    }
    return null;
  }

  /**
   * 返回多路 Steam 官方图片 CDN 候选列表 (用于客户端或中继多节点智能保底)
   */
  public getSteamImageCdns(appId: number, asset: string = 'header.jpg'): string[] {
    return [
      `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/${asset}`,
      `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/${asset}`,
      `https://steamcdn-a.akamaihd.net/steam/apps/${appId}/${asset}`,
      `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/${asset}`,
      `https://cdn.steamstatic.com/steam/apps/${appId}/${asset}`
    ];
  }

  public async getGameByAppId(
    appId: number,
    opts?: { skipRemoteHeader?: boolean }
  ): Promise<SteamGame | null> {
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
      // skipRemoteHeader：调用方只要名称/密钥/DLC（如元数据接口）时跳过 Steam
      // Store 图片查询 —— 该接口从服务器侧实测 30 秒完全不可达，会白等 4 秒超时。
      // 名称已由本地全量库提供，头图在元数据链路里根本用不到。
      // 列表/搜索等需要真实封面的场景不传此参数，行为完全不变。
      const realHeader = opts?.skipRemoteHeader ? null : await this.fetchRealSteamHeader(compact.appId);
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
    if (cached && Date.now() - cached.ts < (cached.ttl || GameService.ONLINE_SEARCH_TTL_MS)) {
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

        // 空结果也缓存，但必须用**较短** TTL —— 注释一直这么写，实现此前却写入
        // 完整的 5 分钟 TTL：用户拼错一个词后即便立刻改正，5 分钟内仍拿不到结果，
        // 表现成「搜索坏了」。这里按结果是否为空分别取 TTL。
        const ttl = newResults.length > 0
          ? GameService.ONLINE_SEARCH_TTL_MS
          : GameService.ONLINE_SEARCH_EMPTY_TTL_MS;
        this.onlineSearchCache.set(cacheKey, { ts: Date.now(), items: newResults, ttl });
        if (this.onlineSearchCache.size > 500) {
          const now = Date.now();
          for (const [k, v] of this.onlineSearchCache) {
            if (now - v.ts > GameService.ONLINE_SEARCH_TTL_MS) this.onlineSearchCache.delete(k);
          }
          // 仍超限时按插入序强制淘汰最旧条目至 400 以内（不论 TTL）
          while (this.onlineSearchCache.size > 400) {
            const oldestKey = this.onlineSearchCache.keys().next().value;
            if (oldestKey === undefined) break;
            this.onlineSearchCache.delete(oldestKey);
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
   * 数字关键词匹配收紧：只按「精确相等或前缀」命中，
   * 避免 includes 模式在热门库/中文缓存中命中巨量 AppID（如搜 "12" 命中一切含 12 的编号）
   */
  private matchNumeric(appId: number, query: string): boolean {
    const s = appId.toString();
    return s === query || s.startsWith(query);
  }

  // 全量库小写名索引：28 万条逐条 toLowerCase 是每个搜索请求的固定开销，
  // 预计算一次后按索引取值，避免每请求分配 28 万个临时字符串
  private allGamesLowerNames: string[] | null = null;
  // 全量线性扫描时间预算：极端无命中查询不再长时间独占事件循环
  private static readonly FULL_SCAN_BUDGET_MS = 250;

  private getLowerNames(): string[] {
    if (!this.allGamesLowerNames || this.allGamesLowerNames.length !== this.allGames.length) {
      this.allGamesLowerNames = this.allGames.map((g) => (g.name || '').toLowerCase());
    }
    return this.allGamesLowerNames;
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
        // 必须与下方各源统一走 matchNumeric（精确或前缀），
        // 旧实现用 includes：搜 "12" 会命中 512、1123、61234 等一切含 "12" 的 AppID
        if (isNumber && this.matchNumeric(g.appId, rawQ) && !seenAppIds.has(g.appId)) {
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
        if (allMatched.length >= 200) break;
        if (isNumber && this.matchNumeric(g.appId, rawQ) && !seenAppIds.has(g.appId)) {
          allMatched.push(g);
          seenAppIds.add(g.appId);
        } else if (searchKeywords.some((kw) => g.name.toLowerCase().includes(kw) || (g.nameZh && g.nameZh.toLowerCase().includes(kw))) && !seenAppIds.has(g.appId)) {
          allMatched.push(g);
          seenAppIds.add(g.appId);
        }
      }

      for (const g of this.chineseGamesCache.values()) {
        if (allMatched.length >= 200) break;
        if (isNumber && this.matchNumeric(g.appId, rawQ) && !seenAppIds.has(g.appId)) {
          allMatched.push(g);
          seenAppIds.add(g.appId);
        } else if (searchKeywords.some((kw) => g.name.toLowerCase().includes(kw) || (g.nameZh && g.nameZh.toLowerCase().includes(kw))) && !seenAppIds.has(g.appId)) {
          allMatched.push(g);
          seenAppIds.add(g.appId);
        }
      }

      // 全量 18 万中检索（预计算小写名 + 时间预算，避免长阻塞事件循环）
      const lowerNames = this.getLowerNames();
      const scanDeadline = Date.now() + GameService.FULL_SCAN_BUDGET_MS;
      for (let i = 0; i < this.allGames.length; i++) {
        const g = this.allGames[i];
        if (seenAppIds.has(g.appId)) continue;
        if ((i & 0x3ff) === 0 && Date.now() > scanDeadline) break;
        const nameLower = lowerNames[i] || '';
        let matched = false;
        if (isNumber) {
          matched = this.matchNumeric(g.appId, rawQ);
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
        if (allMatched.length >= 200) break;
        if (!seenAppIds.has(g.appId)) {
          if (isNumber && this.matchNumeric(g.appId, rawQ)) {
            allMatched.push(g);
            seenAppIds.add(g.appId);
          } else if (searchKeywords.some((kw) => g.name.toLowerCase().includes(kw) || (g.nameZh && g.nameZh.toLowerCase().includes(kw)))) {
            allMatched.push(g);
            seenAppIds.add(g.appId);
          }
        }
      }

      for (const g of this.chineseGamesCache.values()) {
        if (allMatched.length >= 200) break;
        if (!seenAppIds.has(g.appId)) {
          if (isNumber && this.matchNumeric(g.appId, rawQ)) {
            allMatched.push(g);
            seenAppIds.add(g.appId);
          } else if (searchKeywords.some((kw) => g.name.toLowerCase().includes(kw) || (g.nameZh && g.nameZh.toLowerCase().includes(kw)))) {
            allMatched.push(g);
            seenAppIds.add(g.appId);
          }
        }
      }

      const lowerNames = this.getLowerNames();
      const scanDeadline = Date.now() + GameService.FULL_SCAN_BUDGET_MS;
      for (let i = 0; i < this.allGames.length; i++) {
        const g = this.allGames[i];
        if (allMatched.length >= 200) break;
        if ((i & 0x3ff) === 0 && Date.now() > scanDeadline) break;
        if (seenAppIds.has(g.appId)) continue;
        const nameLower = lowerNames[i] || '';
        if (isNumber ? this.matchNumeric(g.appId, rawQ) : searchKeywords.some((kw) => nameLower.includes(kw))) {
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

    // 纯数字未收录时的保底。
    // 必须校验为安全的 32 位 AppID：传入 20 位数字串时 parseInt 会产生一个
    // 超出 Steam 取值范围的失真 appId，并据此拼出必然 404 的封面 URL。
    if (isNumber && allMatched.length === 0) {
      const appId = Number(rawQ);
      if (!Number.isSafeInteger(appId) || appId <= 0 || appId > 0xffffffff) {
        return {
          items: [],
          total: 0,
          page,
          pageSize,
          totalPages: 1,
          source,
          sourceName: sourceNames[source]
        };
      }
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

  public getTotalGamesCount(): number {
    // 只统计全量库本体，中文缓存与全量库高度重叠，不再叠加造成重复计数
    return this.allGames.length;
  }

  /**
   * 懒构建游戏字典二进制缓存（CFGD v1，与 scripts/build-game-dict.mjs 字节级一致）。
   * 数据源 = 全量库 allGames + 中文缓存 chineseGamesCache 叠加（nameZh 覆盖，规则同脚本：
   * 中文名取中文缓存且缺失回退原名；中文缓存独有 AppID 也并入字典尾部）。
   * 缓存在 loadAllGamesDatabase 重载与 flushChineseCache 落盘后自动失效重建。
   */
  private getLibraryCache(): { buffer: Buffer; sha256: string; count: number } {
    if (!this.libraryCache) {
      // 中文缓存 Map 转数组（SteamGame 自带 nameZh；缺失时由编解码器回退原名）
      const zhGames = Array.from(this.chineseGamesCache.values()).map((g) => ({
        appId: g.appId,
        name: g.name,
        nameZh: g.nameZh || g.name
      }));
      const buffer = buildGameDictBinary(this.allGames, zhGames);
      this.libraryCache = {
        buffer,
        sha256: hashGameDictBinary(buffer),
        // 条目数直接读头部 u32 LE（9 字节头：4 魔数 + 1 版本 + 4 条目数），与实际编码严格一致
        count: buffer.readUInt32LE(5)
      };
      console.log(`[GameService] 已重建游戏字典二进制：${this.libraryCache.count} 条，` +
        `体积 ${(buffer.length / 1024 / 1024).toFixed(2)} MB，SHA256 ${this.libraryCache.sha256.slice(0, 16)}…`);
    }
    return this.libraryCache;
  }

  /**
   * 获取游戏字典二进制下载载荷（客户端静默增量更新用）
   */
  public getLibraryBinary(): { buffer: Buffer; sha256: string; count: number } {
    return this.getLibraryCache();
  }

  /**
   * 获取游戏字典版本信息（SHA256 即版本号，客户端比对后决定是否下载）
   */
  public getLibraryVersion(): { count: number; sha256: string; size: number } {
    const c = this.getLibraryCache();
    return { count: c.count, sha256: c.sha256, size: c.buffer.length };
  }
}

export const gameService = new GameService();
