import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { POPULAR_GAMES_DATABASE } from '../database/gamesData';
import { SteamGame, SearchSourceId, SearchPaginationParams, SearchPaginationResult } from '../../types';
import { APP_CONFIG } from '../../config/appConfig';

export class SearchService {
  private fallbackPopularGames: SteamGame[] = [...POPULAR_GAMES_DATABASE];
  private localAllGames: { appid: number; name: string }[] | null = null;

  private readonly sourceNames: Record<SearchSourceId, string> = {
    steam_official: 'Steam官方API',
    cloud_db: '云端18万+自建库',
    steam_community: 'Steam社区搜索源',
    hybrid: '全域智能聚合源',
    local_db: '本地18万+全量库'
  };

  /**
   * 多数据源分页综合检索
   */
  public async searchGamesPaged(params: SearchPaginationParams): Promise<SearchPaginationResult> {
    const q = (params.query || '').trim();
    const source: SearchSourceId = params.source || 'steam_official';
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.max(1, Math.min(100, params.pageSize || 48));

    // 1. 优先尝试从云端服务端检索
    try {
      const url = `${APP_CONFIG.API_BASE_URL}/api/games/search`;
      const response = await axios.get(url, {
        params: { q, source, page, pageSize },
        timeout: 2500
      });

      if (response.data && response.data.success && response.data.data) {
        const d = response.data.data;
        if (Array.isArray(d)) {
          return {
            items: d,
            total: d.length,
            page,
            pageSize,
            totalPages: Math.max(1, Math.ceil(d.length / pageSize)),
            source,
            sourceName: this.sourceNames[source]
          };
        } else if (d.items && Array.isArray(d.items)) {
          return d;
        }
      }
    } catch {
      // 云端未连接，平滑走本地多源离线/直连处理
    }

    // 2. 本地直接按源处理
    return this.fallbackSearchPaged(q, source, page, pageSize);
  }

  /**
   * 兼容旧版 searchGames
   */
  public async searchGames(query: string): Promise<SteamGame[]> {
    const res = await this.searchGamesPaged({ query, pageSize: 48 });
    return res.items;
  }

  /**
   * 加载本地 18万游戏数据 (如有)
   */
  private loadLocalAllGames(): void {
    if (this.localAllGames) return;
    const candidatePaths = [
      path.join(process.cwd(), 'server/data/steam_all_games.json'),
      path.join(process.cwd(), 'data/steam_all_games.json'),
      path.join(__dirname, '../../../server/data/steam_all_games.json')
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          this.localAllGames = JSON.parse(fs.readFileSync(p, 'utf-8'));
          break;
        } catch {}
      }
    }
  }

  /**
   * 本地多源分页降级逻辑
   */
  private async fallbackSearchPaged(
    q: string,
    source: SearchSourceId,
    page: number,
    pageSize: number
  ): Promise<SearchPaginationResult> {
    this.loadLocalAllGames();
    const queryLower = q.toLowerCase();
    const isNumber = /^\d+$/.test(queryLower);

    // 模式 A：无关键词全量浏览（3000+ 页）
    if (!q) {
      if (this.localAllGames && this.localAllGames.length > 0) {
        const total = this.localAllGames.length;
        const start = (page - 1) * pageSize;
        const slice = this.localAllGames.slice(start, start + pageSize);

        const items: SteamGame[] = slice.map((item) => ({
          appId: item.appid || (item as any).appId,
          name: item.name,
          nameZh: item.name,
          headerUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${item.appid || (item as any).appId}/header.jpg`,
          description: `Steam 官方收录应用 (AppID: ${item.appid || (item as any).appId})`
        }));

        return {
          items,
          total,
          page,
          pageSize,
          totalPages: Math.ceil(total / pageSize),
          source,
          sourceName: this.sourceNames[source]
        };
      } else {
        const total = this.fallbackPopularGames.length;
        const start = (page - 1) * pageSize;
        const items = this.fallbackPopularGames.slice(start, start + pageSize);
        return {
          items,
          total,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
          source,
          sourceName: this.sourceNames[source]
        };
      }
    }

    // 模式 B：有关键词检索
    const allResults: SteamGame[] = [];
    const seenIds = new Set<number>();

    // 1. 若为 steam_official 源且非纯数字，先向 Steam 官方 Store 检索
    if (source === 'steam_official' && !isNumber) {
      try {
        const steamUrl = 'https://store.steampowered.com/api/storesearch/';
        const resp = await axios.get(steamUrl, {
          params: { term: q, l: 'schinese', cc: 'CN' },
          timeout: 3500,
          headers: { 'User-Agent': 'Mozilla/5.0 ChunFengDu/1.0' }
        });

        if (resp.data && Array.isArray(resp.data.items) && resp.data.items.length > 0) {
          for (const item of resp.data.items) {
            allResults.push({
              appId: item.id,
              name: item.name,
              nameZh: item.name,
              headerUrl: item.tiny_image
                ? item.tiny_image.replace(/capsule_sm_\d+\.jpg/, 'header.jpg')
                : `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${item.id}/header.jpg`,
              description: `Steam 官方商店应用 (AppID: ${item.id})`
            });
            seenIds.add(item.id);
          }
        }
      } catch {}
    }

    // 2. 热门精修库
    for (const game of this.fallbackPopularGames) {
      if (seenIds.has(game.appId)) continue;
      if (isNumber && game.appId.toString().includes(queryLower)) {
        allResults.push(game);
        seenIds.add(game.appId);
        continue;
      }

      const matchName = game.name.toLowerCase().includes(queryLower);
      const matchZh = game.nameZh ? game.nameZh.toLowerCase().includes(queryLower) : false;
      const matchPinyin = game.pinyin ? game.pinyin.toLowerCase().includes(queryLower) : false;

      if (matchName || matchZh || matchPinyin) {
        allResults.push(game);
        seenIds.add(game.appId);
      }
    }

    // 3. 本地 18万+ 库
    if (this.localAllGames) {
      for (const item of this.localAllGames) {
        const appId = item.appid || (item as any).appId;
        if (!appId || seenIds.has(appId)) continue;

        if (isNumber && appId.toString().includes(queryLower)) {
          allResults.push({
            appId,
            name: item.name,
            nameZh: item.name,
            headerUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
            description: `Steam 官方收录应用 (AppID: ${appId})`
          });
          seenIds.add(appId);
        } else if (item.name && item.name.toLowerCase().includes(queryLower)) {
          allResults.push({
            appId,
            name: item.name,
            nameZh: item.name,
            headerUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
            description: `Steam 官方收录应用 (AppID: ${appId})`
          });
          seenIds.add(appId);
        }
      }
    }

    if (isNumber && allResults.length === 0) {
      const appId = parseInt(queryLower, 10);
      allResults.push({
        appId,
        name: `Steam App ${appId}`,
        nameZh: `Steam 应用 (AppID: ${appId})`,
        headerUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
        description: '通过 AppID 直接添加的 Steam 应用'
      });
    }

    const total = allResults.length;
    const start = (page - 1) * pageSize;
    const items = allResults.slice(start, start + pageSize);

    return {
      items,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      source,
      sourceName: this.sourceNames[source]
    };
  }
}

export const searchService = new SearchService();

