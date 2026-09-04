import { app, ipcMain, dialog, BrowserWindow, shell } from 'electron';
import { steamService } from './services/steamService';
import { ostService } from './services/ostService';
import { manifestService } from './services/manifestService';
import { searchService } from './services/searchService';
import { onlineFixService } from './services/onlineFixService';
import { updateService } from './services/updateService';
import { licenseClientService } from './services/licenseClientService';
import { toolboxService } from './services/toolboxService';
import { steamlessService } from './services/steamlessService';
import { SteamGame } from '../types';

export function registerIpcHandlers() {
  // 0. 应用生命周期与无边框窗口控制
  ipcMain.handle('app:quit', () => {
    app.quit();
  });

  ipcMain.handle('window:minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.handle('window:maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
    return win?.isMaximized() ?? false;
  });

  ipcMain.handle('window:close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.close();
  });

  ipcMain.handle('window:isMaximized', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return win?.isMaximized() ?? false;
  });

  // 1. Steam 环境相关与健康检测
  ipcMain.handle('steam:get-info', async () => {
    return await steamService.getEnvironmentInfo();
  });

  ipcMain.handle('steam:check-health', async () => {
    return await steamService.checkEnvironmentHealth();
  });

  ipcMain.handle('steam:set-path', async (_, customPath: string) => {
    steamService.setCustomSteamPath(customPath);
    return await steamService.getEnvironmentInfo();
  });

  ipcMain.handle('steam:restart', async (_, extraArgs: string[] = []) => {
    return await steamService.restartSteam(extraArgs);
  });

  ipcMain.handle('steam:launch-onlinefix', async () => {
    return await steamService.restartSteam(['-onlinefix']);
  });

  // 2. OpenSteamTool 与一键入库 / 激活注入
  ipcMain.handle('ost:ensure-env', async (_, { manifestApi, customApiUrl }) => {
    return await ostService.ensureOSTEnvironment(manifestApi, customApiUrl);
  });

  ipcMain.handle('ost:activate-injection', async (_, { manifestApi, customApiUrl, restartSteam }) => {
    return await ostService.activateInjection(manifestApi, customApiUrl, restartSteam);
  });

  ipcMain.handle('ost:unlock-game', async (_, game: SteamGame) => {
    return await ostService.generateLuaScript(game);
  });

  ipcMain.handle('ost:get-unlocked', async () => {
    return await ostService.getUnlockedAppIds();
  });

  ipcMain.handle('ost:get-unlocked-details', async () => {
    return await ostService.getUnlockedGames();
  });

  ipcMain.handle('ost:remove-game', async (_, appId: number) => {
    return await ostService.removeUnlockedGame(appId);
  });

  ipcMain.handle('ost:uninstall-injection', async () => {
    return await ostService.uninstallInjection();
  });

  ipcMain.handle('ost:clear-all', async () => {
    return await ostService.clearAllScripts();
  });

  ipcMain.handle('ost:check-manifest', async (_, { appId, dlcs }) => {
    return await manifestService.checkAppManifestStatus(appId, dlcs || []);
  });

  ipcMain.handle('ost:download-manifest', async (_, { appId, dlcs }) => {
    return await manifestService.fetchAndInstallManifests(appId, dlcs || []);
  });

  // 3. 搜索服务
  ipcMain.handle('games:search', async (_, query: string) => {
    return await searchService.searchGames(query);
  });

  // 4. 联机修复工具
  ipcMain.handle('onlinefix:check-dir', async (_, dirPath: string) => {
    return onlineFixService.checkGameDirectory(dirPath);
  });

  ipcMain.handle('onlinefix:check-spacewar', async () => {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return { isInstalled: false, appName: 'Spacewar', appId: 480 };
    }
    return onlineFixService.isSpacewarInstalled(steamPath);
  });

  ipcMain.handle('onlinefix:install-spacewar', async () => {
    try {
      await shell.openExternal('steam://install/480');
      return true;
    } catch (e: any) {
      console.error('唤起 Steam 安装 Spacewar 失败:', e);
      return false;
    }
  });

  ipcMain.handle('onlinefix:scan-local-games', async () => {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) return [];
    return onlineFixService.scanInstalledGames(steamPath);
  });

  ipcMain.handle('onlinefix:launch-game', async (_, params) => {
    return await onlineFixService.launchGameOnline(params);
  });

  ipcMain.handle('onlinefix:repair-steamless', async (_, { gamePath, gameName }) => {
    return await steamlessService.repairGameWithSteamless(gamePath, gameName);
  });

  ipcMain.handle('onlinefix:steamless-status', async () => {
    return steamlessService.getSteamlessStatus();
  });

  ipcMain.handle('onlinefix:apply-spacewar', async (_, { dirPath, appId }) => {
    return onlineFixService.applySpacewarFix(dirPath, appId);
  });

  ipcMain.handle('onlinefix:apply-goldberg', async (_, { dirPath, appId, playerName }) => {
    return onlineFixService.applyGoldbergFix(dirPath, appId, playerName);
  });

  ipcMain.handle('onlinefix:restore', async (_, dirPath: string) => {
    return onlineFixService.restoreOriginalGame(dirPath);
  });

  // 5. 商业版：公告通知与版本检测
  ipcMain.handle('app:check-notice', async () => {
    return await updateService.checkNotice();
  });

  ipcMain.handle('app:check-version', async (_, currentVersion?: string) => {
    return await updateService.checkVersion(currentVersion);
  });

  ipcMain.handle('update:get-stats', async () => {
    return await updateService.getDatabaseStats();
  });

  ipcMain.handle('app:get-sources', async () => {
    return await updateService.getSourcesList();
  });

  ipcMain.handle('app:sync-sources', async () => {
    return await updateService.triggerSyncSources();
  });

  // 6. 设备码与激活码授权服务
  ipcMain.handle('license:get-device-id', () => {
    return licenseClientService.getDeviceId();
  });

  ipcMain.handle('license:get-info', async (_, forceVerify?: boolean) => {
    return await licenseClientService.getLicenseInfo(forceVerify);
  });

  ipcMain.handle('license:activate', async (_, code: string) => {
    return await licenseClientService.activateLicense(code);
  });

  ipcMain.handle('license:unbind', () => {
    return licenseClientService.unbindLocal();
  });

  // 7. 工具箱服务 (Steam 缓存清理 / OpenSteamTool 内核修复 / SHA256 补齐 / 清单自动切换)
  ipcMain.handle('toolbox:clear-cache', async () => {
    return await toolboxService.clearSteamCache();
  });

  ipcMain.handle('toolbox:repair-ost', async () => {
    return await toolboxService.repairOstKernel();
  });

  ipcMain.handle('toolbox:fill-sha256', async () => {
    return await toolboxService.fillSha256Checksums();
  });

  ipcMain.handle('toolbox:auto-switch-manifest', async () => {
    return await toolboxService.enableAutoSwitchManifestServers();
  });

  ipcMain.handle('toolbox:get-status', async () => {
    return await toolboxService.getStatus();
  });

  // 8. 对话框服务
  ipcMain.handle('dialog:select-directory', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory']
    });
    if (!res.canceled && res.filePaths.length > 0) {
      return res.filePaths[0];
    }
    return null;
  });
}
