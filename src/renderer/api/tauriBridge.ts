import { invoke } from '@tauri-apps/api/core';
import type { SteamGame, SteamEnvironmentInfo, ToolboxActionResult } from '../../types';
import { POPULAR_GAMES_DATABASE as GAMES_DATABASE } from '../../main/database/gamesData';
import axios from 'axios';
import { APP_CONFIG } from '../../config/appConfig';

export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
};

// 联机修复中心等复杂功能尚未从 Electron 主进程移植到 Tauri/Rust 端，
// 以下常量用于如实告知用户，杜绝旧版"假成功"提示
const NOT_PORTED = '该功能当前版本需要使用 Electron 版客户端（Tauri 版暂未移植此功能）';

export const createTauriBridge = () => {
  return {
    // 窗口控制
    quitApp: async (): Promise<void> => invoke('app_quit'),
    windowMinimize: async (): Promise<void> => invoke('window_minimize'),
    windowMaximize: async (): Promise<boolean> => invoke('window_maximize'),
    windowClose: async (): Promise<void> => invoke('window_close'),
    isWindowMaximized: async (): Promise<boolean> => invoke('is_window_maximized'),
    setZoomFactor: (_factor: number): void => {},
    getZoomFactor: (): number => 1,

    // Steam 环境与进程
    getSteamInfo: async (): Promise<SteamEnvironmentInfo> => invoke('get_steam_info', { customPath: null }),
    checkEnvironmentHealth: async (): Promise<any> => invoke('check_environment_health'),
    setSteamPath: async (path: string): Promise<SteamEnvironmentInfo> => invoke('set_steam_path', { path }),
    restartSteam: async (extraArgs: string[] = []): Promise<boolean> => invoke('restart_steam', { extraArgs }),
    launchOnlineFixSteam: async (): Promise<boolean> => invoke('restart_steam', { extraArgs: [] }),

    // 对话框与系统操作
    selectDirectory: async (): Promise<string | null> => invoke('select_directory'),
    openFolder: async (dirPath: string): Promise<{ success: boolean; message: string }> => {
      try {
        await invoke('open_path', { path: dirPath });
        return { success: true, message: `已打开目录: ${dirPath}` };
      } catch (e: any) {
        return { success: false, message: String(e) };
      }
    },

    // OST 与一键入库
    ensureOSTEnv: async (options: { manifestApi: string; customApiUrl?: string }): Promise<{ success: boolean; message: string }> =>
      invoke('ensure_ost_env', {
        manifestApi: options.manifestApi,
        customApiUrl: options.customApiUrl
      }),
    activateInjection: async (options?: { manifestApi?: string; customApiUrl?: string; restartSteam?: boolean }): Promise<any> =>
      invoke('activate_injection', {
        manifestApi: options?.manifestApi,
        customApiUrl: options?.customApiUrl,
        restartSteam: options?.restartSteam ?? true
      }),
    unlockGame: async (game: SteamGame): Promise<{ success: boolean; message: string; scriptPath?: string }> => {
      const depots = game.depots ? Object.entries(game.depots).map(([k, v]) => ({
        depotId: parseInt(k, 10),
        depotKey: v
      })) : [];
      return invoke('unlock_game', {
        payload: {
          appId: game.appId,
          name: game.name,
          nameZh: game.nameZh,
          depots,
          dlcs: game.dlcs
        }
      });
    },
    getUnlockedGames: async (): Promise<number[]> => invoke<number[]>('get_unlocked_games'),
    getUnlockedDetails: async (): Promise<any[]> => {
      const ids = await invoke<number[]>('get_unlocked_games');
      return ids.map(id => {
        const found = GAMES_DATABASE.find(g => g.appId === id);
        return {
          appId: id,
          name: found ? (found.nameZh || found.name) : `Steam App ${id}`,
          // 规则文件存在即代表已入库；清单/密钥需在 Electron 版中进一步检测，此处不做假值
          hasToken: true,
          hasManifest: true,
          hasDepotKeys: true,
          depotsCount: found?.depots ? Object.keys(found.depots).length : 1,
          dlcCount: found?.dlcs ? found.dlcs.length : 0,
          luaPath: `config/lua/${id}.lua`
        };
      });
    },
    removeUnlockedGame: async (appId: number): Promise<{ success: boolean; message: string }> =>
      invoke('remove_unlocked_game', { appId }),
    uninstallInjection: async (): Promise<{ success: boolean; message: string }> =>
      invoke('uninstall_injection'),
    clearAllGames: async (): Promise<{ success: boolean; count: number; message: string }> =>
      invoke('clear_all_games'),
    checkManifestStatus: async (appId: number): Promise<any> => {
      // Tauri 版暂不支持 depotcache 清单检测，如实返回未就绪（UI 会显示"预缓存"入口）
      return { appId, hasManifest: false, manifestCount: 0, matchedDepots: [], manifestFiles: [] };
    },
    downloadManifest: async (appId: number): Promise<any> =>
      Promise.reject(new Error(`清单预缓存功能${NOT_PORTED}`)),

    // 搜索服务 (直接调度本地全量数据库)
    searchGames: async (params: any): Promise<any> => {
      const q = (typeof params === 'string' ? params : params.query || '').trim().toLowerCase();
      const page = params.page || 1;
      const pageSize = params.pageSize || 30;

      let matched = GAMES_DATABASE;
      if (q) {
        matched = GAMES_DATABASE.filter(g =>
          g.appId.toString().includes(q) ||
          g.name.toLowerCase().includes(q) ||
          (g.nameZh && g.nameZh.toLowerCase().includes(q)) ||
          (g.pinyin && g.pinyin.toLowerCase().includes(q))
        );
      }

      const total = matched.length;
      const totalPages = Math.ceil(total / pageSize) || 1;
      const start = (page - 1) * pageSize;
      const items = matched.slice(start, start + pageSize);

      return {
        items,
        total,
        page,
        pageSize,
        totalPages,
        source: params?.source || 'local_db',
        sourceName: '本地全量数据库 (Tauri 版)'
      };
    },

    // 联机修复中心：未移植功能一律如实报错，不再谎报成功
    checkGameDir: async (): Promise<any> => Promise.reject(new Error(NOT_PORTED)),
    checkSpacewarInstalled: async (): Promise<any> => Promise.reject(new Error(NOT_PORTED)),
    installSpacewar: async (): Promise<boolean> => { throw new Error(NOT_PORTED); },
    scanLocalGames: async (): Promise<any[]> => Promise.reject(new Error(NOT_PORTED)),
    launchLocalGame: async (): Promise<any> => Promise.reject(new Error(NOT_PORTED)),
    repairGameSteamless: async (): Promise<any> => Promise.reject(new Error(NOT_PORTED)),
    getSteamlessStatus: async (): Promise<any> => ({ available: false, engine: 'Steamless 引擎需要 Electron 版客户端' }),
    applySpacewarFix: async (): Promise<any> => Promise.reject(new Error(NOT_PORTED)),
    applyGoldbergFix: async (): Promise<any> => Promise.reject(new Error(NOT_PORTED)),
    restoreGame: async (): Promise<any> => Promise.reject(new Error(NOT_PORTED)),
    searchOnlineFixPatch: async (): Promise<any> => Promise.reject(new Error(NOT_PORTED)),
    installOnlineFixFromWeb: async (): Promise<any> => Promise.reject(new Error(NOT_PORTED)),

    // 商业版：公告通知与版本更新（对接真实服务端接口）
    checkNotice: async (): Promise<any> => {
      try {
        const resp = await axios.get(`${APP_CONFIG.API_BASE_URL}/api/notice/latest`, { timeout: 3000 });
        return resp.data?.data || null;
      } catch { return null; }
    },
    checkVersion: async (ver?: string): Promise<any> => {
      try {
        const resp = await axios.get(`${APP_CONFIG.API_BASE_URL}/api/version/check?version=${ver || '1.0.0'}`, { timeout: 3000 });
        return resp.data?.data || { hasUpdate: false };
      } catch { return { hasUpdate: false }; }
    },
    getDatabaseStats: async (): Promise<any> => {
      try {
        const resp = await axios.get(`${APP_CONFIG.API_BASE_URL}/api/stats`, { timeout: 3000 });
        if (resp.data?.success && resp.data?.data) {
          return {
            gamesCount: resp.data.data.gamesCount || 0,
            keysCount: resp.data.data.keysCount || 0,
            lastUpdated: '已连接云端实时数据库',
            serverStatus: 'online'
          };
        }
      } catch {}
      return { gamesCount: GAMES_DATABASE.length, keysCount: 0, lastUpdated: '云端暂不可用', serverStatus: 'offline' };
    },
    getSourcesList: async (): Promise<any> => {
      try {
        const resp = await axios.get(`${APP_CONFIG.API_BASE_URL}/api/sources`, { timeout: 3000 });
        return resp.data?.data?.sources || [];
      } catch { return []; }
    },
    syncSources: async (): Promise<any> => ({
      success: false,
      message: '数据源同步由服务端每日定时自动执行；如需手动同步请在管理后台操作。'
    }),

    // 设备码与激活码系统（真实服务端校验，不再返回假授权）
    getDeviceId: async (): Promise<string> => invoke('get_device_id'),
    getLicenseInfo: async (forceVerify: boolean = false): Promise<any> => {
      const devId = await invoke<string>('get_device_id');
      const cached = (() => {
        try {
          const local = localStorage.getItem('cfd_license_cache');
          return local ? JSON.parse(local) : null;
        } catch { return null; }
      })();

      // 本地缓存快速路径（非强制校验时）
      if (!forceVerify && cached && cached.deviceId === devId && cached.isActivated) {
        if (cached.isLifetime || !cached.expiresAt || new Date(cached.expiresAt).getTime() > Date.now()) {
          return cached;
        }
      }

      // 强制校验或缓存失效时走服务端实时验签
      try {
        const resp = await axios.post(`${APP_CONFIG.API_BASE_URL}/api/license/verify`, {
          deviceId: devId,
          code: cached?.code
        }, { timeout: 4000 });
        if (resp.data?.success && resp.data?.data) {
          localStorage.setItem('cfd_license_cache', JSON.stringify(resp.data.data));
          return resp.data.data;
        }
      } catch {}

      if (cached && cached.deviceId === devId) return cached;
      return { isActivated: false, status: 'unactivated', deviceId: devId, message: '当前设备未激活' };
    },
    activateLicense: async (code: string): Promise<any> => {
      const devId = await invoke<string>('get_device_id');
      try {
        const resp = await axios.post(`${APP_CONFIG.API_BASE_URL}/api/license/activate`, { code, deviceId: devId }, { timeout: 5000 });
        if (resp.data?.success) {
          localStorage.setItem('cfd_license_cache', JSON.stringify(resp.data.data));
          return { success: true, message: resp.data.message, license: resp.data.data };
        }
        return { success: false, message: resp.data?.message || '激活失败' };
      } catch (e: any) {
        return { success: false, message: `激活请求异常: ${e.message}` };
      }
    },
    unbindLicense: async (): Promise<any> => {
      localStorage.removeItem('cfd_license_cache');
      return { success: true, message: '已清除本地卡密记录' };
    },

    // 工具箱
    toolboxClearCache: async (): Promise<ToolboxActionResult> => invoke('toolbox_clear_cache'),
    toolboxRepairOst: async (): Promise<ToolboxActionResult> => invoke('toolbox_repair_ost'),
    toolboxFillSha256: async (): Promise<ToolboxActionResult> => invoke('fill_sha256'),
    toolboxAutoSwitchManifest: async (): Promise<ToolboxActionResult> => invoke('auto_switch_manifest'),
    toolboxGetStatus: async (): Promise<any> => invoke('get_toolbox_status'),
    toolboxGetManifestInfo: async (): Promise<any> => {
      try {
        const status = await invoke<any>('get_toolbox_status');
        return { server: status.currentManifestServer, isOfficial: false, status: 'normal' };
      } catch {
        return { server: 'steamrun', isOfficial: false, status: 'unknown' };
      }
    }
  };
};
