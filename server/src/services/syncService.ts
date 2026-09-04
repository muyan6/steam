import axios from 'axios';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { CONFIG } from '../config/index.js';
import { gameService } from './gameService.js';
import { depotService } from './depotService.js';
import { tokenService } from './tokenService.js';
import { sourceRegistryService } from './sourceRegistryService.js';

export class SyncService {
  private readonly httpsAgent = new https.Agent({ rejectUnauthorized: false });
  private isSyncing = false;
  private timer: NodeJS.Timeout | null = null;

  private fastMirrors = [
    'https://raw.githubusercontent.com/',
    'https://ghfast.top/https://raw.githubusercontent.com/',
    'https://ghproxy.net/https://raw.githubusercontent.com/'
  ];

  private sudamaEndpoints = {
    depotKeys: 'https://api.993499094.xyz/depotkeys.json',
    tokens: 'https://api.993499094.xyz/appaccesstokens.json'
  };

  /**
   * 同步全量游戏列表
   */
  public async syncGames(): Promise<{ success: boolean; message: string; count?: number }> {
    const upstreamPath = 'SteamTools-Team/GameList/main/games.json';
    let data: any = null;

    for (const prefix of this.fastMirrors) {
      const url = prefix + upstreamPath;
      try {
        console.log(`[SyncService] 正在从 ${url} 拉取最新游戏列表...`);
        const resp = await axios.get(url, {
          timeout: 30000,
          httpsAgent: this.httpsAgent,
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
      sourceRegistryService.recordSyncError('steamtools_gamelist', '所有上游镜像请求超时');
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
      sourceRegistryService.recordSyncSuccess('steamtools_gamelist', compactGames.length);

      return {
        success: true,
        message: `游戏数据库更新成功！共更新 ${compactGames.length} 款游戏。`,
        count: compactGames.length
      };
    } catch (e: any) {
      sourceRegistryService.recordSyncError('steamtools_gamelist', e.message);
      return { success: false, message: `解析并写入数据失败: ${e.message}` };
    }
  }

  /**
   * 同步全量 DepotKey 解密密钥库（优先苏大猫实时源，其次 GitHub 镜像源）
   */
  public async syncDepotKeys(): Promise<{ success: boolean; message: string; count?: number }> {
    let data: Record<string, string> | null = null;
    let sudamaCount = 0;

    // 1. 优先尝试从苏大猫实时接口同步
    try {
      console.log(`[SyncService] 正在从苏大猫源 ${this.sudamaEndpoints.depotKeys} 拉取最新全量 DepotKey 库...`);
      const resp = await axios.get(this.sudamaEndpoints.depotKeys, {
        timeout: 25000,
        httpsAgent: this.httpsAgent,
        headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster-Server/1.0' }
      });

      if (resp.data && typeof resp.data === 'object' && Object.keys(resp.data).length > 1000) {
        data = resp.data;
        sudamaCount = Object.keys(data!).length;
        sourceRegistryService.recordSyncSuccess('sudama_keys', sudamaCount);
        console.log(`[SyncService] 成功从苏大猫源拉取到 ${sudamaCount} 条 DepotKey`);
      }
    } catch (e: any) {
      sourceRegistryService.recordSyncError('sudama_keys', e.message);
      console.warn(`[SyncService] 苏大猫源同步 DepotKeys 异常: ${e.message}，尝试备用 GitHub 镜像源...`);
    }

    // 2. 备用源：GitHub 镜像源
    if (!data) {
      const upstreamPath = 'SteamAutoCracks/ManifestHub/main/depotkeys.json';
      for (const prefix of this.fastMirrors) {
        const url = prefix + upstreamPath;
        try {
          console.log(`[SyncService] 正在从备用源 ${url} 拉取 DepotKey 库...`);
          const resp = await axios.get(url, {
            timeout: 30000,
            httpsAgent: this.httpsAgent,
            headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster-Server/1.0' }
          });

          if (resp.data && typeof resp.data === 'object') {
            data = resp.data;
            sourceRegistryService.recordSyncSuccess('manifesthub_keys', Object.keys(data!).length);
            break;
          }
        } catch (e: any) {
          console.warn(`[SyncService] 备用镜像 ${url} 同步失败: ${e.message}`);
        }
      }
    }

    if (!data) {
      return { success: false, message: '密钥库上游请求超时，请稍后重试。' };
    }

    try {
      const cleanKeys: Record<string, string> = {};
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'string' && v.length >= 32 && !/^0+$/.test(v)) {
          cleanKeys[k] = v;
        }
      }

      depotService.saveDepotKeys(cleanKeys);
      const count = depotService.getTotalKeysCount();
      sourceRegistryService.recordSyncSuccess('manifesthub_keys', count);

      return {
        success: true,
        message: `DepotKey 库同步完成！后端已持久化收录 ${count} 条解密密钥。`,
        count
      };
    } catch (e: any) {
      return { success: false, message: `写入密钥数据失败: ${e.message}` };
    }
  }

  /**
   * 同步 Steam PICS AccessTokens 令牌库
   */
  public async syncTokens(): Promise<{ success: boolean; message: string; count?: number }> {
    try {
      console.log(`[SyncService] 正在从苏大猫源 ${this.sudamaEndpoints.tokens} 拉取最新 PICS AccessTokens...`);
      const resp = await axios.get(this.sudamaEndpoints.tokens, {
        timeout: 20000,
        httpsAgent: this.httpsAgent,
        headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster-Server/1.0' }
      });

      if (resp.data && typeof resp.data === 'object') {
        const tokens: Record<string, string> = {};
        for (const [k, v] of Object.entries(resp.data)) {
          if (typeof v === 'string' && v.length > 0) {
            tokens[k] = v;
          }
        }

        tokenService.saveTokens(tokens);
        const count = tokenService.getTotalTokensCount();
        sourceRegistryService.recordSyncSuccess('sudama_tokens', count);

        return {
          success: true,
          message: `AccessTokens 库同步完成！后端已持久化收录 ${count} 款应用令牌。`,
          count
        };
      }
      sourceRegistryService.recordSyncError('sudama_tokens', '返回格式不正确');
      return { success: false, message: 'Token 数据返回格式不正确' };
    } catch (e: any) {
      sourceRegistryService.recordSyncError('sudama_tokens', e.message);
      console.error(`[SyncService] 同步 AccessTokens 失败:`, e.message);
      return { success: false, message: `同步 AccessTokens 失败: ${e.message}` };
    }
  }

  /**
   * 全量数据一键同步（游戏库 + 密钥库 + Tokens）
   */
  public async syncAll(): Promise<{ success: boolean; message: string; results: any }> {
    if (this.isSyncing) {
      return { success: false, message: '同步任务正在后台进行中，请勿重复触发', results: null };
    }

    this.isSyncing = true;
    console.log('[SyncService] 🚀 开始执行后端全量数据自动化同步...');
    const results: any = {};

    try {
      results.depotKeys = await this.syncDepotKeys();
      results.tokens = await this.syncTokens();
      results.games = await this.syncGames();

      console.log('[SyncService] ✅ 全量数据自动化同步完成！');
      return {
        success: true,
        message: '全量数据同步完成！',
        results
      };
    } catch (e: any) {
      console.error('[SyncService] ❌ 全量同步发生异常:', e);
      return {
        success: false,
        message: `同步异常: ${e.message}`,
        results
      };
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * 启动每日自动定时同步任务（每天 24 小时自动拉取并持久化）
   */
  public startScheduledDailySync(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }

    console.log('[SyncService] ⏰ 已启动后端每日自动数据定时更新引擎 (周期: 24 小时)');

    // 检查本地如果没有任何数据或数据为空，5秒后自动启动首次静默同步
    setTimeout(() => {
      const keysCount = depotService.getTotalKeysCount();
      const tokensCount = tokenService.getTotalTokensCount();
      if (keysCount < 1000 || tokensCount === 0) {
        console.log('[SyncService] 检测到后端数据库待初始化，正在启动初始数据抓取...');
        this.syncAll().catch(() => {});
      }
    }, 5000);

    // 每 24 小时定时轮询执行一次同步
    const INTERVAL_24H = 24 * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      console.log('[SyncService] ⏰ 触发每日定时全量数据同步任务...');
      this.syncAll().catch((err) => {
        console.error('[SyncService] 定时同步失败:', err.message);
      });
    }, INTERVAL_24H);
  }
}

export const syncService = new SyncService();
