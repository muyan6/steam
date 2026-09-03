import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { gameService } from './gameService.js';
import { depotService } from './depotService.js';

export class SyncService {
  private fastMirrors = [
    'https://raw.githubusercontent.com/',
    'https://ghfast.top/https://raw.githubusercontent.com/',
    'https://ghproxy.net/https://raw.githubusercontent.com/'
  ];

  public async syncGames(): Promise<{ success: boolean; message: string; count?: number }> {
    const upstreamPath = 'SteamTools-Team/GameList/main/games.json';
    let data: any = null;

    for (const prefix of this.fastMirrors) {
      const url = prefix + upstreamPath;
      try {
        console.log(`[SyncService] 正在从 ${url} 拉取最新游戏列表...`);
        const resp = await axios.get(url, {
          timeout: 30000,
          headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster-Server/1.0' }
        });

        if (Array.isArray(resp.data)) {
          data = resp.data;
          break;
        }
      } catch (e: any) {
        console.warn(`[SyncService] 镜像 ${url} 同步失败: ${e.message}`);
      }
    }

    if (!data) {
      return { success: false, message: '所有上游镜像请求超时，请检查网络后重试。' };
    }

    try {
      const compactGames: { appId: number; name: string }[] = [];
      for (const item of data) {
        if (item.appid && item.name) {
          compactGames.push({
            appId: Number(item.appid),
            name: String(item.name).trim()
          });
        }
      }

      const outPath = path.join(CONFIG.DATA_DIR, 'steam_all_games.json');
      fs.writeFileSync(outPath, JSON.stringify(compactGames), 'utf-8');

      // 重新加载内存索引
      await gameService.loadAllGamesDatabase();

      return {
        success: true,
        message: `游戏数据库更新成功！共更新 ${compactGames.length} 款游戏。`,
        count: compactGames.length
      };
    } catch (e: any) {
      return { success: false, message: `解析并写入数据失败: ${e.message}` };
    }
  }

  public async syncDepotKeys(): Promise<{ success: boolean; message: string; count?: number }> {
    const upstreamPath = 'SteamAutoCracks/ManifestHub/main/depotkeys.json';
    let data: any = null;

    for (const prefix of this.fastMirrors) {
      const url = prefix + upstreamPath;
      try {
        console.log(`[SyncService] 正在从 ${url} 拉取最新 DepotKey 库...`);
        const resp = await axios.get(url, {
          timeout: 30000,
          headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster-Server/1.0' }
        });

        if (resp.data && typeof resp.data === 'object') {
          data = resp.data;
          break;
        }
      } catch (e: any) {
        console.warn(`[SyncService] 镜像 ${url} 同步失败: ${e.message}`);
      }
    }

    if (!data) {
      return { success: false, message: '密钥库上游请求超时，请稍后重试。' };
    }

    try {
      const outPath = path.join(CONFIG.DATA_DIR, 'steam_depot_keys.json');
      fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');

      // 重新加载内存索引
      depotService.loadDepotKeysDb();

      const count = Object.keys(data).length;
      return {
        success: true,
        message: `DepotKey 库更新成功！共收录 ${count} 条解密密钥。`,
        count
      };
    } catch (e: any) {
      return { success: false, message: `写入密钥数据失败: ${e.message}` };
    }
  }
}

export const syncService = new SyncService();
