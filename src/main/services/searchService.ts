import axios from 'axios';
import { POPULAR_GAMES_DATABASE } from '../database/gamesData';
import { SteamGame } from '../../types';
import { APP_CONFIG } from '../../config/appConfig';

export class SearchService {
  private fallbackPopularGames: SteamGame[] = [...POPULAR_GAMES_DATABASE];

  /**
   * 综合检索：优先通过云端 Node.js 后端极速检索 18 万+ 游戏；如果离线则启用精修热门兜底
   */
  public async searchGames(query: string): Promise<SteamGame[]> {
    const q = query.trim();

    // 1. 优先尝试从云端服务端接口检索
    try {
      const url = `${APP_CONFIG.API_BASE_URL}/api/games/search`;
      const response = await axios.get(url, {
        params: { q, limit: 48 },
        timeout: APP_CONFIG.REQUEST_TIMEOUT_MS
      });

      if (response.data && response.data.success && Array.isArray(response.data.data)) {
        return response.data.data;
      }
    } catch (e: any) {
      console.warn(`[SearchService] 云端搜索接口不可用 (${e.message})，启用本地离线精简数据库检索...`);
    }

    // 2. 离线/服务未启动时的优雅降级（使用内置基础热门库）
    return this.fallbackSearch(q);
  }

  /**
   * 离线降级搜索逻辑
   */
  private fallbackSearch(q: string): SteamGame[] {
    if (!q) {
      return this.fallbackPopularGames;
    }

    const queryLower = q.toLowerCase();
    const isNumber = /^\d+$/.test(queryLower);
    const results: SteamGame[] = [];

    for (const game of this.fallbackPopularGames) {
      if (isNumber && game.appId.toString().includes(queryLower)) {
        results.push(game);
        continue;
      }

      const matchName = game.name.toLowerCase().includes(queryLower);
      const matchZh = game.nameZh ? game.nameZh.toLowerCase().includes(queryLower) : false;
      const matchPinyin = game.pinyin ? game.pinyin.toLowerCase().includes(queryLower) : false;

      if (matchName || matchZh || matchPinyin) {
        results.push(game);
      }
    }

    if (isNumber && results.length === 0) {
      const appId = parseInt(queryLower, 10);
      results.push({
        appId,
        name: `Steam App ${appId}`,
        nameZh: `Steam 应用 (AppID: ${appId})`,
        headerUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
        description: '通过 AppID 直接添加的 Steam 应用'
      });
    }

    return results;
  }
}

export const searchService = new SearchService();
