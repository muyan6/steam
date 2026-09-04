import { contextBridge, ipcRenderer, webFrame } from 'electron';
import { SteamGame, SteamEnvironmentInfo, OnlineFixStatus, SpacewarStatus, ToolboxActionResult, ToolboxStatusInfo, LocalInstalledGame, SteamlessRepairResult, SteamlessStatusInfo, OnlineLaunchMode } from './types';

export const electronAPI = {
  // 应用生命周期与窗口控制
  quitApp: (): Promise<void> => ipcRenderer.invoke('app:quit'),
  windowMinimize: (): Promise<void> => ipcRenderer.invoke('window:minimize'),
  windowMaximize: (): Promise<boolean> => ipcRenderer.invoke('window:maximize'),
  windowClose: (): Promise<void> => ipcRenderer.invoke('window:close'),
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  setZoomFactor: (factor: number): void => {
    try {
      webFrame.setZoomFactor(factor);
    } catch (e) {
      console.error('Failed to set zoom factor:', e);
    }
  },
  getZoomFactor: (): number => {
    try {
      return webFrame.getZoomFactor();
    } catch {
      return 1;
    }
  },

  // Steam 环境与进程
  getSteamInfo: (): Promise<SteamEnvironmentInfo> => ipcRenderer.invoke('steam:get-info'),
  checkEnvironmentHealth: (): Promise<any> => ipcRenderer.invoke('steam:check-health'),
  setSteamPath: (path: string): Promise<SteamEnvironmentInfo> => ipcRenderer.invoke('steam:set-path', path),
  restartSteam: (extraArgs: string[] = []): Promise<boolean> => ipcRenderer.invoke('steam:restart', extraArgs),
  launchOnlineFixSteam: (): Promise<boolean> => ipcRenderer.invoke('steam:launch-onlinefix'),

  // OpenSteamTool 与一键入库 / 激活注入
  ensureOSTEnv: (options: { manifestApi: string; customApiUrl?: string }): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('ost:ensure-env', JSON.parse(JSON.stringify(options))),
  activateInjection: (options?: { manifestApi?: string; customApiUrl?: string; restartSteam?: boolean }): Promise<{ success: boolean; message: string; steamPath?: string; steamRestarted?: boolean }> =>
    ipcRenderer.invoke('ost:activate-injection', options ? JSON.parse(JSON.stringify(options)) : {}),
  unlockGame: (game: SteamGame): Promise<{ success: boolean; message: string; scriptPath?: string }> =>
    ipcRenderer.invoke('ost:unlock-game', JSON.parse(JSON.stringify(game))),
  getUnlockedGames: (): Promise<number[]> => ipcRenderer.invoke('ost:get-unlocked'),
  getUnlockedDetails: (): Promise<any[]> => ipcRenderer.invoke('ost:get-unlocked-details'),
  removeUnlockedGame: (appId: number): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('ost:remove-game', appId),
  uninstallInjection: (): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('ost:uninstall-injection'),
  clearAllGames: (): Promise<{ success: boolean; count: number; message: string }> =>
    ipcRenderer.invoke('ost:clear-all'),
  checkManifestStatus: (appId: number, dlcs?: number[]): Promise<any> =>
    ipcRenderer.invoke('ost:check-manifest', { appId, dlcs }),
  downloadManifest: (appId: number, dlcs?: number[]): Promise<any> =>
    ipcRenderer.invoke('ost:download-manifest', { appId, dlcs }),

  // 搜索服务
  searchGames: (query: string): Promise<SteamGame[]> => ipcRenderer.invoke('games:search', query),

  // 联机工具箱
  checkGameDir: (dirPath: string): Promise<OnlineFixStatus> => ipcRenderer.invoke('onlinefix:check-dir', dirPath),
  checkSpacewarInstalled: (): Promise<SpacewarStatus> => ipcRenderer.invoke('onlinefix:check-spacewar'),
  installSpacewar: (): Promise<boolean> => ipcRenderer.invoke('onlinefix:install-spacewar'),
  scanLocalGames: (): Promise<LocalInstalledGame[]> => ipcRenderer.invoke('onlinefix:scan-local-games'),
  launchLocalGame: (params: {
    appId: number;
    gamePath: string;
    primaryExe?: string;
    mode: OnlineLaunchMode;
    onlineAppId: number;
  }): Promise<{ success: boolean; message: string }> => ipcRenderer.invoke('onlinefix:launch-game', params),
  repairGameSteamless: (gamePath: string, gameName?: string): Promise<SteamlessRepairResult> =>
    ipcRenderer.invoke('onlinefix:repair-steamless', { gamePath, gameName }),
  getSteamlessStatus: (): Promise<SteamlessStatusInfo> => ipcRenderer.invoke('onlinefix:steamless-status'),
  applySpacewarFix: (dirPath: string, appId: number): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('onlinefix:apply-spacewar', { dirPath, appId }),
  applyGoldbergFix: (dirPath: string, appId: number, playerName: string): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('onlinefix:apply-goldberg', { dirPath, appId, playerName }),
  restoreGame: (dirPath: string): Promise<{ success: boolean; message: string }> =>
    ipcRenderer.invoke('onlinefix:restore', dirPath),

  // 商业版：公告通知与版本更新
  checkNotice: (): Promise<any> => ipcRenderer.invoke('app:check-notice'),
  checkVersion: (currentVersion?: string): Promise<any> => ipcRenderer.invoke('app:check-version', currentVersion),
  getDatabaseStats: (): Promise<any> => ipcRenderer.invoke('update:get-stats'),
  getSourcesList: (): Promise<any> => ipcRenderer.invoke('app:get-sources'),
  syncSources: (): Promise<any> => ipcRenderer.invoke('app:sync-sources'),

  // 商业版：设备码与激活码系统
  getDeviceId: (): Promise<string> => ipcRenderer.invoke('license:get-device-id'),
  getLicenseInfo: (forceVerify?: boolean): Promise<any> => ipcRenderer.invoke('license:get-info', forceVerify),
  activateLicense: (code: string): Promise<{ success: boolean; message: string; license?: any }> =>
    ipcRenderer.invoke('license:activate', code),
  unbindLicense: (): Promise<{ success: boolean; message: string }> => ipcRenderer.invoke('license:unbind'),

  // 工具箱 (Steam 缓存清理 / OpenSteamTool 内核修复 / SHA256 补齐 / 清单自动切换)
  toolboxClearCache: (): Promise<ToolboxActionResult> => ipcRenderer.invoke('toolbox:clear-cache'),
  toolboxRepairOst: (): Promise<ToolboxActionResult> => ipcRenderer.invoke('toolbox:repair-ost'),
  toolboxFillSha256: (): Promise<ToolboxActionResult> => ipcRenderer.invoke('toolbox:fill-sha256'),
  toolboxAutoSwitchManifest: (): Promise<ToolboxActionResult> => ipcRenderer.invoke('toolbox:auto-switch-manifest'),
  toolboxGetStatus: (): Promise<ToolboxStatusInfo> => ipcRenderer.invoke('toolbox:get-status'),

  // 对话框
  selectDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:select-directory')
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ElectronAPI = typeof electronAPI;
