import fs from 'fs';
import path from 'path';
import https from 'https';
import axios from 'axios';
import { POPULAR_GAMES_DATABASE } from '../database/gamesData';
import { SteamGame } from '../../types';
import { APP_CONFIG } from '../../config/appConfig';

export class SearchService {
  private fallbackPopularGames: SteamGame[] = [...POPULAR_GAMES_DATABASE];
  private localAllGames: { appid: number; name: string }[] | null = null;
  private readonly httpsAgent = new https.Agent({ rejectUnauthorized: false });

  /**
   * 综合检索：优先通过云端后端检索；如果离线则启用 Steam 官方 Store 直连检索 + 本地 18万+ 数据库
   */
  public async searchGames(query: string): Promise<SteamGame[]> {
    const q = query.trim();
    if (!q) {
      return this.fallbackPopularGames;
    }

    // 1. 优先尝试从云端服务端接口检索
    try {
      const url = `${APP_CONFIG.API_BASE_URL}/api/games/search`;
      const response = await axios.get(url, {
        params: { q, limit: 48 },
        timeout: 2500
      });

      if (response.data && response.data.success && Array.isArray(response.data.data) && response.data.data.length > 0) {
        return response.data.data;
      }
    } catch {
      // 云端未启动或超时，平滑走直连与离线检索
    }

    // 2. 直连 Steam 官方商店极速检索（支持所有最新中文游戏、冷门游戏及别名）
    const isNumber = /^\d+$/.test(q);
    if (!isNumber) {
      try {
        const steamUrl = 'https://store.steampowered.com/api/storesearch/';
        const resp = await axios.get(steamUrl, {
          params: { term: q, l: 'schinese', cc: 'CN' },
          httpsAgent: this.httpsAgent,
          timeout: 4000,
          headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster/1.0' }
        });

        if (resp.data && Array.isArray(resp.data.items) && resp.data.items.length > 0) {
          const onlineResults: SteamGame[] = resp.data.items.map((item: any) => ({
            appId: item.id,
            name: item.name,
            nameZh: item.name,
            headerUrl: item.tiny_image
              ? item.tiny_image.replace(/capsule_sm_\d+\.jpg/, 'header.jpg')
              : `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${item.id}/header.jpg`,
            description: `Steam 官方商店应用 (AppID: ${item.id})`
          }));
          return onlineResults;
        }
      } catch {
        // 网络请求异常，走本地离线库
      }
    }

    // 3. 离线/服务未启动时的优雅降级（使用本地全量库与热门库）
    return this.fallbackSearch(q);
  }

  /**
   * 加载本地 18万游戏数据 (如有)
   */
  private loadLocalAllGames(): void {
    if (this.localAllGames) return;
    const candidatePaths = [
      path.join(process.cwd(), 'server/data/steam_all_games.json'),
      path.join(process.cwd(), 'data/steam_all_games.json')
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
   * 离线降级搜索逻辑
   */
  private fallbackSearch(q: string): SteamGame[] {
    const queryLower = q.toLowerCase();
    const isNumber = /^\d+$/.test(queryLower);
    const results: SteamGame[] = [];
    const seenIds = new Set<number>();

    // 热门精修库
    for (const game of this.fallbackPopularGames) {
      if (isNumber && game.appId.toString().includes(queryLower)) {
        results.push(game);
        seenIds.add(game.appId);
        continue;
      }

      const matchName = game.name.toLowerCase().includes(queryLower);
      const matchZh = game.nameZh ? game.nameZh.toLowerCase().includes(queryLower) : false;
      const matchPinyin = game.pinyin ? game.pinyin.toLowerCase().includes(queryLower) : false;

      if (matchName || matchZh || matchPinyin) {
        results.push(game);
        seenIds.add(game.appId);
      }
    }

    // 本地 18万+ 库兜底
    this.loadLocalAllGames();
    if (this.localAllGames && results.length < 48) {
      for (const item of this.localAllGames) {
        if (results.length >= 48) break;
        const appId = item.appid || (item as any).appId;
        if (!appId || seenIds.has(appId)) continue;

        if (isNumber && appId.toString().includes(queryLower)) {
          results.push({
            appId,
            name: item.name,
            nameZh: item.name,
            headerUrl: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`,
            description: `Steam 官方收录应用 (AppID: ${appId})`
          });
          seenIds.add(appId);
        } else if (item.name && item.name.toLowerCase().includes(queryLower)) {
          results.push({
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
