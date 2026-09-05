import { invoke } from '@tauri-apps/api/core';
import { fetch as httpFetch } from '@tauri-apps/plugin-http';
import type { SteamGame, SteamEnvironmentInfo, ToolboxActionResult } from '../../types';
import { POPULAR_GAMES_DATABASE as GAMES_DATABASE } from '../data/gamesData';
import { createExtractorFromData } from 'node-unrar-js';
import { UNRAR_WASM_BASE64 } from '../utils/unrarWasm';
import { APP_CONFIG } from '../../config/appConfig';

export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
};

const API = APP_CONFIG.API_BASE_URL;

// ==================== HTTP 与数据辅助 ====================

async function getJson<T = any>(url: string, timeoutMs = 8000): Promise<T | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const resp = await httpFetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as unknown as number[]);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let wasmBinaryCache: Uint8Array | null = null;
function getWasmBinary(): Uint8Array {
  if (!wasmBinaryCache) wasmBinaryCache = base64ToBytes(UNRAR_WASM_BASE64);
  return wasmBinaryCache;
}

interface ExtractedEntry {
  name: string;
  dataB64: string;
}

/** 使用内嵌 unrar.wasm 在渲染进程解压 RAR（与 Electron 版同一引擎与密码） */
async function extractRarEntries(data: ArrayBuffer): Promise<ExtractedEntry[]> {
  const extractor = await createExtractorFromData({
    wasmBinary: getWasmBinary().slice().buffer as ArrayBuffer,
    data,
    password: 'online-fix.me'
  } as any);
  const entries: ExtractedEntry[] = [];
  const extracted = extractor.extract();
  for (const f of [...extracted.files]) {
    if (!f.fileHeader?.name) continue;
    if (f.extraction && f.extraction.length > 0) {
      entries.push({ name: f.fileHeader.name, dataB64: bytesToBase64(f.extraction) });
    }
  }
  return entries;
}

// ==================== 多源搜索 ====================

interface SteamSearchItem {
  appId: number;
  name: string;
  nameZh?: string;
  headerUrl?: string;
  description?: string;
}

async function searchCloud(q: string, source: string, page: number, pageSize: number): Promise<any | null> {
  const json = await getJson(`${API}/api/games/search?q=${encodeURIComponent(q)}&source=${source}&page=${page}&pageSize=${pageSize}`, 3500);
  if (json?.success && json?.data) {
    const d = json.data;
    if (Array.isArray(d)) {
      return { items: d, total: d.length, page, pageSize, totalPages: 1, source, sourceName: '云端数据库' };
    }
    if (Array.isArray(d.items)) {
      return {
        items: d.items,
        total: d.total || d.items.length,
        page: d.page || page,
        pageSize: d.pageSize || pageSize,
        totalPages: d.totalPages || 1,
        source,
        sourceName: d.sourceName || '云端数据库'
      };
    }
  }
  return null;
}

async function searchSteamOfficial(q: string, page: number, pageSize: number, lang: string): Promise<any | null> {
  const json = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(q)}&l=${lang}&cc=CN`, 4000);
  if (json && Array.isArray(json.items)) {
    const items: SteamSearchItem[] = json.items.map((it: any) => ({
      appId: it.id,
      name: it.name,
      nameZh: it.name,
      headerUrl: it.tiny_image
        ? String(it.tiny_image).replace(/capsule_sm_\d+\.jpg/, 'header.jpg')
        : `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${it.id}/header.jpg`,
      description: 'Steam 官方收录应用'
    }));
    const total = items.length;
    const start = (page - 1) * pageSize;
    return {
      items: items.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      source: 'steam_official',
      sourceName: 'Steam官方API'
    };
  }
  return null;
}

async function searchLocal(q: string, page: number, pageSize: number): Promise<any> {
  // 优先走 Rust 端 18万+ 全量库（随包分发），失败时回退内置精简库
  try {
    return await invoke('search_local_games', { query: q, page, pageSize });
  } catch {
    const query = q.trim().toLowerCase();
    let matched = GAMES_DATABASE;
    if (query) {
      matched = GAMES_DATABASE.filter((g) =>
        g.appId.toString().includes(query) ||
        g.name.toLowerCase().includes(query) ||
        (g.nameZh && g.nameZh.toLowerCase().includes(query)) ||
        (g.pinyin && g.pinyin.toLowerCase().includes(query))
      );
    }
    const total = matched.length;
    const totalPages = Math.ceil(total / pageSize) || 1;
    const start = (page - 1) * pageSize;
    return {
      items: matched.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      totalPages,
      source: 'local_db',
      sourceName: '本地精简库'
    };
  }
}

// ==================== 桥接 ====================

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
    launchOnlineFixSteam: async (): Promise<boolean> => invoke('restart_steam', { extraArgs: ['-onlinefix'] }),

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
    getUnlockedDetails: async (): Promise<any[]> => invoke<any[]>('get_unlocked_details'),
    removeUnlockedGame: async (appId: number): Promise<{ success: boolean; message: string }> =>
      invoke('remove_unlocked_game', { appId }),
    uninstallInjection: async (): Promise<{ success: boolean; message: string }> =>
      invoke('uninstall_injection'),
    clearAllGames: async (): Promise<{ success: boolean; count: number; message: string }> =>
      invoke('clear_all_games'),

    // 清单预缓存（Rust 端经 SteamPipe CDN 下载并解压到 depotcache）
    checkManifestStatus: async (appId: number, dlcs?: number[]): Promise<any> =>
      invoke('check_manifest_status', { appId, dlcs: dlcs || [] }),
    downloadManifest: async (appId: number, dlcs?: number[]): Promise<any> =>
      invoke('download_manifests', { appId, dlcs: dlcs || [] }),

    // 搜索服务：多数据源（云端/官方/聚合/本地）
    searchGames: async (params: any): Promise<any> => {
      const q = (typeof params === 'string' ? params : params?.query || '').trim();
      const source: string = params?.source || 'steam_official';
      const page = params?.page || 1;
      const pageSize = params?.pageSize || 48;

      if (source === 'local_db') {
        return await searchLocal(q, page, pageSize);
      }
      if (source === 'steam_official' || source === 'steam_community') {
        const lang = source === 'steam_community' ? 'en' : 'schinese';
        const official = q ? await searchSteamOfficial(q, page, pageSize, lang) : null;
        if (official) return official;
        const cloud = q ? await searchCloud(q, source, page, pageSize) : null;
        if (cloud) return cloud;
        return await searchLocal(q, page, pageSize);
      }
      if (source === 'hybrid') {
        const [cloud, official] = await Promise.all([
          q ? searchCloud(q, 'cloud_db', page, pageSize) : null,
          q ? searchSteamOfficial(q, page, pageSize, 'schinese') : null
        ]);
        if (cloud && official) {
          const seen = new Set<number>();
          const merged: SteamSearchItem[] = [];
          for (const item of [...official.items, ...cloud.items]) {
            if (!seen.has(item.appId)) {
              seen.add(item.appId);
              merged.push(item);
            }
          }
          // 与分页语义对齐：只返回当前页大小的去重结果，统计沿用云端总数
          return {
            ...cloud,
            items: merged.slice(0, pageSize),
            source: 'hybrid',
            sourceName: '全域智能聚合源'
          };
        }
        if (cloud) return { ...cloud, source: 'hybrid', sourceName: '全域智能聚合源' };
        if (official) return { ...official, source: 'hybrid', sourceName: '全域智能聚合源' };
        return await searchLocal(q, page, pageSize);
      }
      // cloud_db 与其他未知源：云端优先，回退本地
      const cloud = q ? await searchCloud(q, source, page, pageSize) : null;
      if (cloud) return cloud;
      return await searchLocal(q, page, pageSize);
    },

    // 联机修复中心（Rust 端完整实现）
    checkGameDir: async (dirPath: string): Promise<any> => invoke('check_game_dir', { dirPath }),
    checkSpacewarInstalled: async (): Promise<any> => invoke('is_spacewar_installed'),
    installSpacewar: async (): Promise<boolean> => {
      await invoke('open_url', { url: 'steam://install/480' });
      return true;
    },
    scanLocalGames: async (): Promise<any[]> => invoke('scan_local_games'),
    launchLocalGame: async (params: {
      appId: number;
      gamePath: string;
      primaryExe?: string;
      mode: string;
      onlineAppId: number;
    }): Promise<{ success: boolean; message: string }> =>
      invoke('launch_local_game', {
        appId: params.appId,
        gamePath: params.gamePath,
        primaryExe: params.primaryExe || null,
        mode: params.mode,
        onlineAppId: params.onlineAppId
      }),
    repairGameSteamless: async (gamePath: string, gameName?: string): Promise<any> =>
      invoke('repair_game_steamless', { gamePath, gameName: gameName || null }),
    getSteamlessStatus: async (): Promise<any> => invoke('get_steamless_status'),
    applySpacewarFix: async (dirPath: string, appId: number): Promise<any> =>
      invoke('apply_spacewar_fix', { dirPath, realAppId: appId }),
    applyGoldbergFix: async (dirPath: string, appId: number, playerName: string): Promise<any> =>
      invoke('apply_goldberg_fix', { dirPath, appId, playerName }),
    restoreGame: async (dirPath: string): Promise<any> => invoke('restore_game', { dirPath }),
    searchOnlineFixPatch: async (appId: number, gameName?: string): Promise<any> =>
      invoke('search_onlinefix_patch', { appId, gameName: gameName || null }),
    installOnlineFixFromWeb: async (gamePath: string, appId: number, gameName?: string): Promise<any> => {
      // 1. Rust 搜索并下载补丁包到临时目录
      const prep = await invoke<any>('onlinefix_prepare', { gamePath, appId, gameName: gameName || null });
      const archivePath = prep.archivePath as string;
      const fileName = prep.fileName as string;
      const isRar = fileName.toLowerCase().endsWith('.rar');

      let extractedCount = 0;
      if (isRar) {
        // 2a. RAR：读取原始字节 → 渲染进程 unrar.wasm 解压 → 分批回传由 Rust 部署
        //     （分批控制单次 IPC 载荷约 4MB，避免 100MB+ 补丁的内存峰值）
        const bytes = (await invoke('read_file_raw', { path: archivePath })) as ArrayBuffer;
        const entries = await extractRarEntries(bytes);
        let batch: ExtractedEntry[] = [];
        let batchSize = 0;
        const flush = async (isLast: boolean) => {
          if (batch.length === 0) return;
          const res = await invoke<any>('onlinefix_deploy', {
            gamePath,
            entries: batch.map((e) => ({ name: e.name, dataB64: e.dataB64 })),
            archivePath: isLast ? archivePath : null
          });
          extractedCount += res.extractedCount ?? 0;
          batch = [];
          batchSize = 0;
        };
        for (const e of entries) {
          batch.push(e);
          batchSize += e.dataB64.length;
          if (batchSize >= 4 * 1024 * 1024) await flush(false);
        }
        await flush(true);
      } else {
        // 2b. ZIP：Rust 端直接解压（含密码支持与越界防护）
        const res = await invoke<any>('zip_extract', { archivePath, destDir: gamePath });
        extractedCount = res.extractedCount ?? 0;
      }

      return {
        success: extractedCount > 0,
        message: extractedCount > 0
          ? `成功从 online-fix.me 下载并安装联机补丁 (${fileName})，共解压部署 ${extractedCount} 个文件！`
          : '补丁已下载但未能部署任何文件（归档可能为空、密码不匹配或全部条目被拒绝）',
        fileName,
        extractedCount,
        articleUrl: prep.articleUrl,
        downloadUrl: prep.downloadUrl
      };
    },
    setOnlineFixAccount: async (username: string, password: string): Promise<any> =>
      invoke('set_onlinefix_account', { username, password }),

    // 商业版：公告通知与版本更新（plugin-http 走 Rust 通道，不受 CORS 限制）
    checkNotice: async (): Promise<any> => {
      const json = await getJson(`${API}/api/notice/latest`, 3000);
      return json?.data || null;
    },
    checkVersion: async (ver?: string): Promise<any> => {
      const json = await getJson(`${API}/api/version/check?version=${ver || '1.0.0'}`, 3000);
      return json?.data || { hasUpdate: false };
    },
    getDatabaseStats: async (): Promise<any> => {
      const json = await getJson(`${API}/api/stats`, 3000);
      if (json?.success && json?.data) {
        return {
          gamesCount: json.data.gamesCount || 0,
          keysCount: json.data.keysCount || 0,
          lastUpdated: '已连接云端实时数据库',
          serverStatus: 'online'
        };
      }
      return { gamesCount: GAMES_DATABASE.length, keysCount: 0, lastUpdated: '云端暂不可用', serverStatus: 'offline' };
    },
    getSourcesList: async (): Promise<any> => {
      const json = await getJson(`${API}/api/sources`, 3000);
      return json?.data?.sources || [];
    },
    syncSources: async (): Promise<any> => ({
      success: false,
      message: '数据源同步由服务端每日定时自动执行；如需手动同步请在管理后台操作。'
    }),

    // 设备码与激活码系统（真实服务端校验）
    getDeviceId: async (): Promise<string> => invoke('get_device_id'),
    getLicenseInfo: async (forceVerify: boolean = false): Promise<any> => {
      const devId = await invoke<string>('get_device_id');
      const cached = (() => {
        try {
          const local = localStorage.getItem('cfd_license_cache');
          return local ? JSON.parse(local) : null;
        } catch { return null; }
      })();

      if (!forceVerify && cached && cached.deviceId === devId && cached.isActivated) {
        if (cached.isLifetime || !cached.expiresAt || new Date(cached.expiresAt).getTime() > Date.now()) {
          return cached;
        }
      }

      try {
        const resp = await httpFetch(`${API}/api/license/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: devId, code: cached?.code })
        });
        const json = await resp.json();
        if (json?.success && json?.data) {
          localStorage.setItem('cfd_license_cache', JSON.stringify(json.data));
          return json.data;
        }
      } catch {}

      if (cached && cached.deviceId === devId) {
        // 离线兜底也必须校验本地到期时间，过期授权不放行
        if (cached.isActivated && !cached.isLifetime && cached.expiresAt) {
          const expMs = new Date(cached.expiresAt).getTime();
          if (!isNaN(expMs) && expMs < Date.now()) {
            return {
              ...cached,
              isActivated: false,
              status: 'expired',
              remainingDays: 0,
              message: '您的会员授权已到期，请续费使用！'
            };
          }
        }
        return cached;
      }
      return { isActivated: false, status: 'unactivated', deviceId: devId, message: '当前设备未激活' };
    },
    activateLicense: async (code: string): Promise<any> => {
      const devId = await invoke<string>('get_device_id');
      try {
        const resp = await httpFetch(`${API}/api/license/activate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, deviceId: devId })
        });
        const json = await resp.json();
        if (json?.success) {
          localStorage.setItem('cfd_license_cache', JSON.stringify(json.data));
          return { success: true, message: json.message, license: json.data };
        }
        return { success: false, message: json?.message || '激活失败' };
      } catch (e: any) {
        return { success: false, message: `激活请求异常: ${e?.message || String(e)}` };
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


// Tauri 版设备心跳：对齐 Electron 版行为（启动一次 + 每 30 分钟一次），
// 保证 Dashboard 设备统计不因客户端版本而失真
let heartbeatStarted = false;
export function startTauriHeartbeat(): void {
  if (heartbeatStarted || !isTauriEnvironment()) return;
  heartbeatStarted = true;
  const send = async () => {
    try {
      const deviceId = await invoke<string>('get_device_id');
      let license: any = null;
      try { license = JSON.parse(localStorage.getItem('cfd_license_cache') || 'null'); } catch {}
      await httpFetch(`${APP_CONFIG.API_BASE_URL}/api/telemetry/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          clientVersion: APP_CONFIG.VERSION,
          osVersion: `tauri ${navigator.platform || 'windows'}`,
          isActivated: !!(license && license.isActivated),
          licenseCode: license?.code
        })
      });
    } catch {}
  };
  void send();
  setInterval(send, 30 * 60 * 1000);
}