import { invoke } from '@tauri-apps/api/core';
import { fetch as httpFetch } from '@tauri-apps/plugin-http';
import type { SteamGame, SteamEnvironmentInfo, ToolboxActionResult, LocalGamesScanResult } from '../../types';
import { POPULAR_GAMES_DATABASE as GAMES_DATABASE } from '../data/gamesData';
import { createExtractorFromData } from 'node-unrar-js';
import { APP_CONFIG } from '../../config/appConfig';

export const isTauriEnvironment = (): boolean => {
  return typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window);
};

const API = APP_CONFIG.API_BASE_URL;

/**
 * 统一格式化后端错误：Tauri invoke 可能 reject 字符串、Error 或
 * 结构化对象（如 onlinefix_prepare 的 OnlineFixPatchResult），
 * 直接 String(obj) 会显示 "[object Object]"，调用方应统一使用本函数
 */
export function formatIpcError(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    for (const key of ['message', 'msg', 'error', 'reason', 'detail']) {
      const v = o[key];
      if (typeof v === 'string' && v.trim()) return v;
    }
    try {
      return JSON.stringify(e);
    } catch {
      return '未知错误';
    }
  }
  return String(e ?? '未知错误');
}

// ==================== HTTP 与数据辅助 ====================

/** 网络请求统一走 Tauri Rust 通道（无 CORS 限制）；失败返回 null */
export async function getJson<T = any>(url: string, timeoutMs = 8000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await httpFetch(url, { signal: ctrl.signal });
    if (!resp.ok) return null;
    return (await resp.json()) as T;
  } catch {
    return null;
  } finally {
    // 无论成功、失败或超时都必须清理定时器，避免定时器泄漏
    clearTimeout(timer);
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

let wasmBinaryBuffer: ArrayBuffer | null = null;
/** 运行时加载 public/unrar.wasm（已从主包剥离，消除 277KB base64 内嵌） */
async function getWasmBinaryBuffer(): Promise<ArrayBuffer> {
  if (wasmBinaryBuffer) return wasmBinaryBuffer;
  const resp = await fetch('/unrar.wasm');
  if (!resp.ok) throw new Error(`加载 unrar.wasm 失败: HTTP ${resp.status}`);
  wasmBinaryBuffer = await resp.arrayBuffer();
  return wasmBinaryBuffer;
}interface ExtractedEntry {
  name: string;
  dataB64: string;
}

/** 懒迭代解压 RAR：边解边攒批回调落盘，条目处理完即释放，
 *  避免全量解出后一次性驻留内存（大补丁峰值可达 300MB+） */
async function extractRarEntriesStreaming(
  data: ArrayBuffer,
  onBatch: (entries: ExtractedEntry[]) => Promise<void>
): Promise<number> {
  const extractor = await createExtractorFromData({
    wasmBinary: await getWasmBinaryBuffer(),
    data,
    password: 'online-fix.me'
  } as any);
  const FLUSH_BYTES = 4 * 1024 * 1024;
  let batch: ExtractedEntry[] = [];
  let batchSize = 0;
  let count = 0;
  for (const f of extractor.extract().files) {
    if (!f.fileHeader?.name) continue;
    if (f.extraction && f.extraction.length > 0) {
      const dataB64 = bytesToBase64(f.extraction);
      batch.push({ name: f.fileHeader.name, dataB64 });
      batchSize += dataB64.length;
      count++;
      if (batchSize >= FLUSH_BYTES) {
        await onBatch(batch);
        batch = [];
        batchSize = 0;
      }
    }
  }
  if (batch.length > 0) await onBatch(batch);
  return count;
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
      // l=en 实际走的是商店搜索英文接口，标注为"Steam 商店 (英文)"避免误导
      sourceName: lang === 'en' ? 'Steam 商店 (英文)' : 'Steam官方API'
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
    // UI 缩放：WebView2 支持 CSS zoom，直接作用于根元素并持久化，
    // 替代 Electron 版遗留的空实现（此前缩放设置完全无效）
    setZoomFactor: (factor: number): void => {
      const zoom = Math.min(1.5, Math.max(0.8, factor));
      document.documentElement.style.zoom = String(zoom);
      localStorage.setItem('cfd_ui_zoom', String(zoom));
    },
    getZoomFactor: (): number => {
      const v = parseFloat(localStorage.getItem('cfd_ui_zoom') || '1');
      return Number.isFinite(v) ? v : 1;
    },

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
    unlockGame: async (game: SteamGame): Promise<{ success: boolean; message: string; scriptPath?: string; keyCount?: number; manifestCount?: number; metadataOk?: boolean; metadataMessage?: string | null }> => {
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
    checkManifestStatusBatch: async (appIds: number[]): Promise<any[]> =>
      invoke('check_manifest_status_batch', { appIds }),
    downloadManifest: async (appId: number, dlcs?: number[]): Promise<any> =>
      invoke('download_manifests', { appId, dlcs: dlcs || [] }),

    // 版本更新检测：对比已入库规则中钉死的清单 GID 与云端实时元数据（服务端每次实时查 SteamCMD）
    checkGameUpdates: async (appIds: number[]): Promise<any[]> =>
      invoke<any[]>('check_game_updates', { appIds }),
    // 版本策略切换：lockVersion=true 锁定到当前官方最新 GID（联机对版本）；
    // false 重写为"跟随官方最新版"规则（不写 setManifestid），此后自动跟进官方更新
    updateGame: async (appId: number, name: string, nameZh?: string, lockVersion?: boolean): Promise<{ success: boolean; message: string; keyCount?: number }> =>
      invoke('update_game_rules', { appId, name, nameZh: nameZh || name, lockVersion: lockVersion ?? false }),

      // 搜索服务：多数据源（云端/官方/聚合/本地）
      // seenIds：调用方可传入跨页共享的去重集合，避免聚合源翻页时 Steam 官方结果重复出现
      searchGames: async (params: any): Promise<any> => {
      const q = (typeof params === 'string' ? params : params?.query || '').trim();
      const source: string = params?.source || 'steam_official';
      const page = params?.page || 1;
      const pageSize = params?.pageSize || 60;

      if (source === 'local_db') {
        // 本地全量库（含同步下来的中文名索引）优先；本地未命中（如超新的游戏）
        // 再回退云端中文检索，云端也无结果时返回本地空结果保持分页结构
        const local = await searchLocal(q, page, pageSize);
        if (local && local.items.length > 0) {
          return local;
        }
        const cloud = await searchCloud(q, 'cloud_db', page, pageSize);
        if (cloud && cloud.items.length > 0) {
          return { ...cloud, source: 'local_db', sourceName: '云端中文索引' };
        }
        return local;
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
          // 去重集合支持调用方跨页传入， Steam 官方结果不再随翻页重复
          const seen: Set<number> = params?.seenIds instanceof Set ? params.seenIds : new Set<number>();
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

    // 联机中心（Rust 端完整实现）
    checkGameDir: async (dirPath: string): Promise<any> => invoke('check_game_dir', { dirPath }),
    checkSpacewarInstalled: async (): Promise<any> => invoke('is_spacewar_installed'),
    installSpacewar: async (): Promise<boolean> => {
      await invoke('open_url', { url: 'steam://install/480' });
      return true;
    },
    // force=true 强制重扫本地库；默认优先内存(60s)/磁盘(跨重启)缓存秒开，
    // 返回值带 scannedAt/stale，前端对超过 24h 的陈旧缓存做后台静默重刷
    scanLocalGames: async (force: boolean = false): Promise<LocalGamesScanResult> =>
      invoke('scan_local_games', { force }),
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
      // 防御性校验：prepare 失败时可能返回空对象/null，避免下方空指针
      if (!prep || !prep.archivePath || !prep.fileName) {
        throw new Error('联机补丁下载准备失败：服务端未返回有效的补丁归档信息，请稍后重试');
      }
      const archivePath = prep.archivePath as string;
      const fileName = prep.fileName as string;
      const isRar = fileName.toLowerCase().endsWith('.rar');

      let extractedCount = 0;
      if (isRar) {
        // 2a. RAR：读取原始字节 → 渲染进程 unrar.wasm 懒解压 → 攒批回传由 Rust 部署
        //     （单批 IPC 载荷约 4MB；条目边解边释放，不整包驻留内存）
        const bytes = (await invoke('read_file_raw', { path: archivePath })) as ArrayBuffer;
        let deployed = 0;
        await extractRarEntriesStreaming(bytes, async (batch) => {
          const res = await invoke<any>('onlinefix_deploy', {
            gamePath,
            entries: batch.map((e) => ({ name: e.name, dataB64: e.dataB64 })),
            archivePath: null
          });
          deployed += res.extractedCount ?? 0;
        });
        // 传空批次触发 Rust 侧清理临时归档（deploy 末尾按 archivePath 删除）
        await invoke('onlinefix_deploy', { gamePath, entries: [], archivePath });
        extractedCount = deployed;
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
    // 拉取全部生效公告（按优先级降序）：客户端据 priority 依次弹出，popupOnce 逐条独立判断
    checkNoticeList: async (): Promise<any[]> => {
      // getJson 失败时返回 null（不会抛异常），故此处用空值判断触发兼容回退
      const json = await getJson(`${API}/api/notice/list`, 3000);
      if (!json || !Array.isArray(json?.data)) {
        // 旧版服务端无 /notice/list 时退回单条接口，保持向后兼容
        const single = await window.electronAPI.checkNotice();
        return single ? [single] : [];
      }
      return json.data;
    },
    checkVersion: async (ver?: string): Promise<any> => {
      const json = await getJson(`${API}/api/version/check?version=${ver || '1.0.0'}`, 3000);
      return json?.data || { hasUpdate: false };
    },
    // 应用内更新：下载进度经 update-download-progress 事件上报（Rust 端流式下载），
    // 完成返回安装包临时路径；拉起安装器后应用自动退出
    downloadUpdate: async (url: string): Promise<string> => invoke('download_update', { url }),
    launchInstaller: async (path: string): Promise<void> => invoke('launch_installer', { path }),
    // 原生窗口背景色 (#rrggbb)：主题切换时同步，覆盖 WebView 边缘原生缝隙的默认白底
    setWindowBackground: async (hex: string): Promise<void> => invoke('set_window_background', { hex }),
    // 应用内跳转链接 (教程/FAQ/QQ群/赞助) —— 由服务端配置，未配置为空串
    getAppLinks: async (): Promise<{ tutorialUrl: string; faqUrl: string; qqGroupUrl: string; sponsorUrl: string }> => {
      const json = await getJson(`${API}/api/links`, 3000);
      return json?.data || { tutorialUrl: '', faqUrl: '', qqGroupUrl: '', sponsorUrl: '' };
    },
    // 调用系统默认浏览器或外部协议打开外部链接
    openExternalUrl: async (url: string): Promise<void> => {
      if (!url) return;
      await invoke('open_url', { url });
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

    // 设备码与赞助码系统（支持离线保留与双重持久化兜底）
    getDeviceId: async (): Promise<string> => invoke('get_device_id'),
    getLicenseInfo: async (forceVerify: boolean = false): Promise<any> => {
      const devId = await invoke<string>('get_device_id');
      
      const readLocalCache = async (): Promise<any> => {
        try {
          const local = localStorage.getItem('cfd_license_cache');
          if (local) return JSON.parse(local);
        } catch {}
        try {
          const diskStr = await invoke<string | null>('load_license_cache');
          if (diskStr) {
            const diskObj = JSON.parse(diskStr);
            localStorage.setItem('cfd_license_cache', diskStr);
            return diskObj;
          }
        } catch {}
        return null;
      };

      const writeLocalCache = async (data: any) => {
        try {
          const str = JSON.stringify(data);
          localStorage.setItem('cfd_license_cache', str);
          await invoke('save_license_cache', { data: str });
        } catch {}
      };

      const cached = await readLocalCache();

      // 离线可用性判断：终身卡永久离线可用；定期卡在 expiresAt 到期前离线完全可用
      const cacheUsable = (c: any): boolean => {
        if (!c || !c.isActivated) return false;
        if (c.isLifetime) return true;
        if (!c.expiresAt) return true;
        const t = new Date(c.expiresAt).getTime();
        return !isNaN(t) && t > Date.now();
      };

      const isCacheValid = cached && cached.deviceId === devId && cacheUsable(cached);

      // 非强制联网校验时，先用 Rust 原生 Ed25519 引擎对离线缓存做权威验签（防本地篡改）
      if (!forceVerify && isCacheValid) {
        const verifyRes = await invoke<any>('verify_offline_license').catch(() => null);
        if (verifyRes && verifyRes.isActivated) {
          return cached;
        } else if (verifyRes && !verifyRes.isActivated) {
          console.warn('[License] 本地离线授权签名校验失败:', verifyRes.message);
          // 签名被篡改或无效：不放行本地缓存
        }
      }

      // 联网校验（附带 3.5 秒严格超时熔断保护，防止云端掉线卡死界面）
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3500);
        const resp = await httpFetch(`${API}/api/license/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deviceId: devId, code: cached?.code }),
          signal: ctrl.signal
        });
        clearTimeout(timer);
        const json = await resp.json();
        if (json?.success && json?.data) {
          await writeLocalCache(json.data);
          return json.data;
        }
      } catch {
        // 网络超时、断网或云端掉线：走离线优雅降级
      }

      if (isCacheValid) {
        // 断网离线状态下二次验证 Rust 端数字签名
        const verifyRes = await invoke<any>('verify_offline_license').catch(() => null);
        if (verifyRes && !verifyRes.isActivated) {
          return {
            ...cached,
            isActivated: false,
            status: 'unverified',
            remainingDays: 0,
            message: verifyRes.message || '本地授权签名损坏或被篡改，请联网后重新校验！'
          };
        }

        // 离线到期二次检查
        if (!cached.isLifetime && cached.expiresAt) {
          const expMs = new Date(cached.expiresAt).getTime();
          if (!isNaN(expMs) && expMs < Date.now()) {
            return {
              ...cached,
              isActivated: false,
              status: 'expired',
              remainingDays: 0,
              message: '您的赞助授权已到期，请更新赞助码！'
            };
          }
        }
        return cached;
      }

      return { isActivated: false, status: 'unactivated', deviceId: devId, message: '当前为普通用户' };
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
          try {
            const str = JSON.stringify(json.data);
            localStorage.setItem('cfd_license_cache', str);
            await invoke('save_license_cache', { data: str });
          } catch {}
          // 激活成功后立即主动上报一次心跳，使云端控制台零延迟显示已激活
          void sendTauriHeartbeatNow();
          return { success: true, message: json.message || '赞助码绑定成功！', license: json.data };
        }
        return { success: false, message: json?.message || '激活失败' };
      } catch (e: any) {
        return { success: false, message: `激活请求异常: ${e?.message || String(e)}` };
      }
    },
    // 换机迁移：凭赞助码 + 原设备码将绑定关系迁移到本机
    rebindLicense: async (code: string, oldDeviceId: string): Promise<any> => {
      const devId = await invoke<string>('get_device_id');
      try {
        const resp = await httpFetch(`${API}/api/license/rebind`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code, oldDeviceId, newDeviceId: devId })
        });
        const json = await resp.json();
        if (json?.success) {
          try {
            const str = JSON.stringify(json.data);
            localStorage.setItem('cfd_license_cache', str);
            await invoke('save_license_cache', { data: str });
          } catch {}
          // 迁移成功后立即主动上报一次心跳
          void sendTauriHeartbeatNow();
          return { success: true, message: json.message || '赞助码已迁移到本机！', license: json.data };
        }
        return { success: false, message: json?.message || '迁移失败' };
      } catch (e: any) {
        return { success: false, message: `迁移请求异常: ${e?.message || String(e)}` };
      }
    },
    unbindLicense: async (): Promise<any> => {
      localStorage.removeItem('cfd_license_cache');
      try {
        await invoke('clear_license_cache');
      } catch {}
      void sendTauriHeartbeatNow();
      return { success: true, message: '已清除本地赞助码与授权缓存' };
    },

    // 未激活设备每日免费入库额度（动态上限支持后台随时调整，按本地日期刷新）
    getFreeUnlockQuota: async (isActivated: boolean): Promise<any> => {
      if (isActivated) {
        return invoke('get_free_unlock_quota', { isActivated });
      }
      try {
        const deviceId = await invoke<string>('get_device_id');
        const res = await getJson<any>(`${API}/api/quota/status?deviceId=${encodeURIComponent(deviceId)}`);
        if (res && res.success && res.data) {
          if (typeof res.data.limit === 'number') {
            await invoke('sync_free_quota_limit', { limit: res.data.limit });
          }
          return {
            isActivated: false,
            limit: res.data.limit,
            used: res.data.used,
            remaining: res.data.remaining,
            allowed: res.data.remaining > 0,
            consumed: false
          };
        }
      } catch {}
      return invoke('get_free_unlock_quota', { isActivated });
    },
    consumeFreeUnlockQuota: async (isActivated: boolean): Promise<any> =>
      invoke('consume_free_unlock_quota', { isActivated }),
    syncFreeQuotaLimit: async (limit: number): Promise<void> =>
      invoke('sync_free_quota_limit', { limit }),

    // 工具箱
    toolboxClearCache: async (): Promise<ToolboxActionResult> => invoke('toolbox_clear_cache'),
    // 修复内核时带上用户在设置页选择的清单服务器，避免被硬编码重置
    toolboxRepairOst: async (): Promise<ToolboxActionResult> => {
      const manifestApi = localStorage.getItem('chunfengdu_manifest_api') || null;
      return invoke('toolbox_repair_ost', { manifestApi, customApiUrl: null });
    },
    toolboxFillSha256: async (): Promise<ToolboxActionResult> => invoke('fill_sha256'),
    toolboxAutoSwitchManifest: async (): Promise<ToolboxActionResult> => invoke('auto_switch_manifest'),
    toolboxGetStatus: async (): Promise<any> => invoke('get_toolbox_status'),
    // OST 内核在线同步：检测 GitHub 最新 release 并镜像下载部署（内嵌 DLL 仅为首次种子）
    checkOstSync: async (): Promise<any> => invoke('check_ost_sync'),
    syncOstLatest: async (): Promise<{ success: boolean; message: string }> =>
      invoke('sync_ost_latest'),
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
// 保证 Dashboard 设备统计不因客户端版本而失真；激活/换机时支持即时主动触发
export async function sendTauriHeartbeatNow(): Promise<void> {
  if (!isTauriEnvironment()) return;
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
}

let heartbeatStarted = false;
export function startTauriHeartbeat(): void {
  if (heartbeatStarted || !isTauriEnvironment()) return;
  heartbeatStarted = true;
  void sendTauriHeartbeatNow();
  setInterval(sendTauriHeartbeatNow, 30 * 60 * 1000);
}