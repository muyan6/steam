import axios from 'axios';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { CONFIG } from '../config/index.js';
import { gameService } from './gameService.js';
import { depotService } from './depotService.js';
import { tokenService } from './tokenService.js';
import { sourceRegistryService } from './sourceRegistryService.js';
import { writeJsonAtomicAsync } from '../utils/atomicJson.js';

export class SyncService {
  // 安全策略：不再关闭上游 HTTPS 证书校验
  private readonly httpsAgent = new https.Agent();
  private isSyncing = false;
  // 子任务各自的互斥：syncGames/syncDepotKeys/syncTokens 会被管理端路由直接调用，
  // 旧实现只给 syncAll 加了守卫，手动同步与 24h 定时任务并发时两路会同时
  // writeJsonAtomicAsync + loadAllGamesDatabase，后写覆盖先写。
  private subRunning = new Set<string>();
  private timer: NodeJS.Timeout | null = null;
  private initialTimer: NodeJS.Timeout | null = null;

  /**
   * 获取子任务锁。
   * @param internal 由 syncAll 调用时为 true —— 调用方已持有全局互斥，跳过抢锁
   */
  private beginSub(name: string, internal?: boolean): boolean {
    if (internal) return true;
    if (this.isSyncing || this.subRunning.has(name)) return false;
    this.subRunning.add(name);
    return true;
  }

  private endSub(name: string): void {
    this.subRunning.delete(name);
  }

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
  public async syncGames(opts?: { internal?: boolean }): Promise<{ success: boolean; message: string; count?: number }> {
    if (!this.beginSub('games', opts?.internal)) {
      return { success: false, message: '同步任务正在后台进行中，请勿重复触发。' };
    }
    try {
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
      // 异步原子写 + 紧凑序列化：8MB 库同步写盘会阻塞事件循环，
      // 且 JSON.stringify(data, null, 2) 的美化缩进会把文件体积放大数倍
      await writeJsonAtomicAsync(outPath, compactGames);

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
    } finally {
      if (!opts?.internal) this.endSub('games');
    }
  }

  /**
   * 同步全量 DepotKey 解密密钥库（优先苏大猫实时源，其次 GitHub 镜像源）
   */
  public async syncDepotKeys(opts?: { internal?: boolean }): Promise<{ success: boolean; message: string; count?: number }> {
    if (!this.beginSub('depotKeys', opts?.internal)) {
      return { success: false, message: '同步任务正在后台进行中，请勿重复触发。' };
    }
    try {
    let data: Record<string, string> | null = null;
    let sudamaCount = 0;
    let fromSudama = false;

    // 1. 优先尝试从苏大猫实时接口同步
    try {
      console.log(`[SyncService] 正在从苏大猫源 ${this.sudamaEndpoints.depotKeys} 拉取最新全量 DepotKey 库...`);
      const resp = await axios.get(this.sudamaEndpoints.depotKeys, {
        timeout: 25000,
        httpsAgent: this.httpsAgent,
        headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster-Server/1.0' }
      });

      // 必须排除数组：typeof [] === 'object'，数组同样能通过旧校验，
      // 随后按 Object.entries 落盘会写成 "0"/"1"/"2" 键的垃圾数据，
      // 直接污染 28.8 万条真实密钥库。
      if (
        resp.data &&
        typeof resp.data === 'object' &&
        !Array.isArray(resp.data) &&
        Object.keys(resp.data).length > 1000
      ) {
        data = resp.data;
        fromSudama = true;
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

          if (resp.data && typeof resp.data === 'object' && !Array.isArray(resp.data)) {
            data = resp.data;
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

      if (!(await depotService.saveDepotKeys(cleanKeys))) {
        sourceRegistryService.recordSyncError(fromSudama ? 'sudama_keys' : 'manifesthub_keys', '落盘失败或数据库处于损坏保护状态');
        return { success: false, message: '密钥数据落盘失败（可能数据库损坏保护已生效），请检查服务端日志。' };
      }
      const count = depotService.getTotalKeysCount();
      // 按实际命中的源记状态：数据来自苏大猫时却把成功与计数写进 manifesthub_keys，
      // 会让数据源面板显示「GitHub 镜像已同步 28.8 万条」而实际是苏大猫贡献的
      sourceRegistryService.recordSyncSuccess(fromSudama ? 'sudama_keys' : 'manifesthub_keys', count);

      return {
        success: true,
        message: `DepotKey 库同步完成！后端已持久化收录 ${count} 条解密密钥。`,
        count
      };
    } catch (e: any) {
      return { success: false, message: `写入密钥数据失败: ${e.message}` };
    }
    } finally {
      if (!opts?.internal) this.endSub('depotKeys');
    }
  }

  /**
   * 同步 Steam PICS AccessTokens 令牌库
   */
  public async syncTokens(opts?: { internal?: boolean }): Promise<{ success: boolean; message: string; count?: number }> {
    if (!this.beginSub('tokens', opts?.internal)) {
      return { success: false, message: '同步任务正在后台进行中，请勿重复触发。' };
    }
    try {
      console.log(`[SyncService] 正在从苏大猫源 ${this.sudamaEndpoints.tokens} 拉取最新 PICS AccessTokens...`);
      const resp = await axios.get(this.sudamaEndpoints.tokens, {
        timeout: 20000,
        httpsAgent: this.httpsAgent,
        headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster-Server/1.0' }
      });

      if (resp.data && typeof resp.data === 'object' && !Array.isArray(resp.data)) {
        const tokens: Record<string, string> = {};
        for (const [k, v] of Object.entries(resp.data)) {
          if (typeof v === 'string' && v.length > 0) {
            tokens[k] = v;
          }
        }

        if (!(await tokenService.saveTokens(tokens))) {
          sourceRegistryService.recordSyncError('sudama_tokens', '落盘失败或写入已被禁用');
          return { success: false, message: 'AccessTokens 落盘失败（写入可能已被禁用），请检查服务端日志。' };
        }
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
    } finally {
      if (!opts?.internal) this.endSub('tokens');
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
      // internal: true —— syncAll 已持有全局互斥，子方法不再重复抢锁，
      // 否则会立即被自己的守卫拒绝、整体同步静默变成「全部失败」
      results.depotKeys = await this.syncDepotKeys({ internal: true });
      results.tokens = await this.syncTokens({ internal: true });
      results.games = await this.syncGames({ internal: true });

      // 子任务失败必须如实上报：密钥库/令牌库属于核心数据，任一写入失败都视为整体失败，
      // 否则管理端会在数据未落盘时仍显示「同步完成」，掩盖真实的持久化故障。
      const coreFailed = !results.depotKeys?.success || !results.tokens?.success;
      if (coreFailed) {
        const failed = [
          results.depotKeys?.success === false ? '密钥库' : '',
          results.tokens?.success === false ? '令牌库' : ''
        ].filter(Boolean).join('、');
        console.error(`[SyncService] ⚠️ 全量同步存在核心数据失败: ${failed}`);
        return {
          success: false,
          message: `同步完成但存在失败项（${failed}），请查看详情与日志。`,
          results
        };
      }

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
      this.timer = null;
    }
    if (this.initialTimer) {
      clearTimeout(this.initialTimer);
      this.initialTimer = null;
    }

    console.log('[SyncService] ⏰ 已启动后端每日自动数据定时更新引擎 (周期: 24 小时)');

    // 检查本地如果没有任何数据或数据为空，5秒后自动启动首次静默同步
    this.initialTimer = setTimeout(() => {
      this.initialTimer = null;
      const keysCount = depotService.getTotalKeysCount();
      const tokensCount = tokenService.getTotalTokensCount();
      if (keysCount < 1000 || tokensCount === 0) {
        console.log('[SyncService] 检测到后端数据库待初始化，正在启动初始数据抓取...');
        this.syncAll().catch(() => {});
      }
    }, 5000);
    // 初始探测计时器不应阻止进程退出，也不应因重复调用而叠加
    (this.initialTimer as any).unref?.();

    // 每 24 小时定时轮询执行一次同步
    const INTERVAL_24H = 24 * 60 * 60 * 1000;
    this.timer = setInterval(() => {
      console.log('[SyncService] ⏰ 触发每日定时全量数据同步任务...');
      this.syncAll().catch((err) => {
        console.error('[SyncService] 定时同步失败:', err.message);
      });
    }, INTERVAL_24H);
    (this.timer as any).unref?.();
  }
}

export const syncService = new SyncService();
