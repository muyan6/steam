import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { shell } from 'electron';
import { OnlineFixStatus, LocalInstalledGame, OnlineLaunchMode } from '../../types';
import { steamlessService } from './steamlessService';
import { steamService } from './steamService';

export class OnlineFixService {
  /**
   * 检查指定游戏目录的联机补丁状态
   */
  public checkGameDirectory(dirPath: string): OnlineFixStatus {
    if (!fs.existsSync(dirPath)) {
      return {
        gamePath: dirPath,
        hasBackup: false,
        isPatched: false,
        mode: 'none'
      };
    }

    const api64 = path.join(dirPath, 'steam_api64.dll');
    const api32 = path.join(dirPath, 'steam_api.dll');
    const backup64 = path.join(dirPath, 'steam_api64_o.dll');
    const backup32 = path.join(dirPath, 'steam_api_o.dll');
    const onlineFixIni = path.join(dirPath, 'OnlineFix.ini');
    const goldbergSettings = path.join(dirPath, 'steam_settings');

    const hasBackup = fs.existsSync(backup64) || fs.existsSync(backup32);
    let isPatched = false;
    let mode: 'spacewar' | 'goldberg' | 'none' = 'none';
    let appId: number | undefined;

    if (fs.existsSync(onlineFixIni)) {
      isPatched = true;
      mode = 'spacewar';
      try {
        const content = fs.readFileSync(onlineFixIni, 'utf-8');
        const match = content.match(/RealAppId\s*=\s*(\d+)/i);
        if (match && match[1]) {
          appId = parseInt(match[1], 10);
        }
      } catch {
        // ignore
      }
    } else if (fs.existsSync(goldbergSettings)) {
      isPatched = true;
      mode = 'goldberg';
      try {
        const appIdFile = path.join(goldbergSettings, 'steam_appid.txt');
        if (fs.existsSync(appIdFile)) {
          appId = parseInt(fs.readFileSync(appIdFile, 'utf-8').trim(), 10);
        }
      } catch {
        // ignore
      }
    }

    return {
      gamePath: dirPath,
      hasBackup,
      isPatched,
      mode,
      appId
    };
  }

  /**
   * 注入 Spacewar (AppID 480) 联机补丁配置
   */
  public applySpacewarFix(dirPath: string, realAppId: number): { success: boolean; message: string } {
    try {
      if (!fs.existsSync(dirPath)) {
        return { success: false, message: '游戏目录不存在' };
      }

      const api64 = path.join(dirPath, 'steam_api64.dll');
      const api32 = path.join(dirPath, 'steam_api.dll');
      const backup64 = path.join(dirPath, 'steam_api64_o.dll');
      const backup32 = path.join(dirPath, 'steam_api_o.dll');
      const onlineFixIni = path.join(dirPath, 'OnlineFix.ini');

      // 1. 如果存在原版 DLL 且未备份，先执行备份 (同时支持 64 位与 32 位)
      if (fs.existsSync(api64) && !fs.existsSync(backup64)) {
        fs.copyFileSync(api64, backup64);
      }
      if (fs.existsSync(api32) && !fs.existsSync(backup32)) {
        fs.copyFileSync(api32, backup32);
      }

      // 2. 写入 OnlineFix.ini 配置文件
      const iniContent = `[Main]
RealAppId=${realAppId}
FakeAppId=480
Language=schinese
Overlay=1

[Steam]
FakeSteamId=1
`;
      fs.writeFileSync(onlineFixIni, iniContent, 'utf-8');

      // 3. 写入 steam_appid.txt
      const appidTxt = path.join(dirPath, 'steam_appid.txt');
      fs.writeFileSync(appidTxt, '480', 'utf-8');

      return {
        success: true,
        message: `成功为 AppID: ${realAppId} 部署 Spacewar (480) 联机配置！原 DLL 已安全备份。`
      };
    } catch (e: any) {
      return { success: false, message: `注入补丁失败: ${e.message}` };
    }
  }

  /**
   * 部署 Goldberg 局域网/虚拟专网离线联机配置
   */
  public applyGoldbergFix(dirPath: string, appId: number, playerName: string = '春风渡玩家'): { success: boolean; message: string } {
    try {
      if (!fs.existsSync(dirPath)) {
        return { success: false, message: '游戏目录不存在' };
      }

      const api64 = path.join(dirPath, 'steam_api64.dll');
      const api32 = path.join(dirPath, 'steam_api.dll');
      const backup64 = path.join(dirPath, 'steam_api64_o.dll');
      const backup32 = path.join(dirPath, 'steam_api_o.dll');
      const settingsDir = path.join(dirPath, 'steam_settings');

      if (fs.existsSync(api64) && !fs.existsSync(backup64)) {
        fs.copyFileSync(api64, backup64);
      }
      if (fs.existsSync(api32) && !fs.existsSync(backup32)) {
        fs.copyFileSync(api32, backup32);
      }

      if (!fs.existsSync(settingsDir)) {
        fs.mkdirSync(settingsDir, { recursive: true });
      }

      // 写入 steam_appid.txt
      fs.writeFileSync(path.join(settingsDir, 'steam_appid.txt'), appId.toString(), 'utf-8');
      fs.writeFileSync(path.join(dirPath, 'steam_appid.txt'), appId.toString(), 'utf-8');

      // 写入玩家昵称
      fs.writeFileSync(path.join(settingsDir, 'force_account_name.txt'), playerName, 'utf-8');

      // 写入局域网广播 settings.ini
      const settingsIni = `[user_general]
account_name=${playerName}
language=schinese

[auto_discovery]
enable=1
`;
      fs.writeFileSync(path.join(settingsDir, 'settings.ini'), settingsIni, 'utf-8');

      return {
        success: true,
        message: `成功配置 Goldberg 局域网联机环境（玩家名: ${playerName}）！`
      };
    } catch (e: any) {
      return { success: false, message: `配置失败: ${e.message}` };
    }
  }

  /**
   * 一键恢复原版游戏文件（无损还原）
   */
  public restoreOriginalGame(dirPath: string): { success: boolean; message: string } {
    try {
      if (!fs.existsSync(dirPath)) {
        return { success: false, message: '游戏目录不存在' };
      }

      const api64 = path.join(dirPath, 'steam_api64.dll');
      const api32 = path.join(dirPath, 'steam_api.dll');
      const backup64 = path.join(dirPath, 'steam_api64_o.dll');
      const backup32 = path.join(dirPath, 'steam_api_o.dll');
      const onlineFixIni = path.join(dirPath, 'OnlineFix.ini');
      const appidTxt = path.join(dirPath, 'steam_appid.txt');
      const settingsDir = path.join(dirPath, 'steam_settings');

      // 还原备份的 DLL (64位及32位)
      if (fs.existsSync(backup64)) {
        fs.copyFileSync(backup64, api64);
        try { fs.unlinkSync(backup64); } catch {}
      }
      if (fs.existsSync(backup32)) {
        fs.copyFileSync(backup32, api32);
        try { fs.unlinkSync(backup32); } catch {}
      }

      // 清理补丁衍生配置文件
      if (fs.existsSync(onlineFixIni)) {
        try { fs.unlinkSync(onlineFixIni); } catch {}
      }
      if (fs.existsSync(appidTxt)) {
        try { fs.unlinkSync(appidTxt); } catch {}
      }
      if (fs.existsSync(settingsDir)) {
        try { fs.rmSync(settingsDir, { recursive: true, force: true }); } catch {}
      }

      return { success: true, message: '已完全恢复游戏原版状态与 DLL 文件！' };
    } catch (e: any) {
      return { success: false, message: `还原失败: ${e.message}` };
    }
  }

  /**
   * 获取所有已知的 Steam 库目录路径 (包含 steamapps 及其它盘符 SteamLibrary)
   */
  public getSteamLibraryPaths(steamPath: string): string[] {
    const libraries: string[] = [];
    if (!steamPath || !fs.existsSync(steamPath)) return libraries;

    // 1. Steam 根目录下的 steamapps
    const mainApps = path.join(steamPath, 'steamapps');
    if (fs.existsSync(mainApps)) {
      libraries.push(mainApps);
    }

    // 2. 解析 libraryfolders.vdf 获取其它库路径
    const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
    if (fs.existsSync(vdfPath)) {
      try {
        const content = fs.readFileSync(vdfPath, 'utf-8');
        // 匹配 "path"		"D:\\SteamLibrary"
        const pathMatches = content.matchAll(/"path"\s+"([^"]+)"/gi);
        for (const match of pathMatches) {
          const rawPath = match[1];
          const cleanPath = rawPath.replace(/\\\\/g, '\\');
          const appsDir = path.join(cleanPath, 'steamapps');
          if (fs.existsSync(appsDir) && !libraries.includes(appsDir)) {
            libraries.push(appsDir);
          }
        }
      } catch {
        // ignore
      }
    }

    return libraries;
  }

  /**
   * 检测 Steam 中是否已安装 Spacewar (AppID: 480)
   */
  public isSpacewarInstalled(steamPath: string): { isInstalled: boolean; path?: string; appName: string; appId: number } {
    const defaultInfo = {
      isInstalled: false,
      appName: 'Spacewar',
      appId: 480
    };

    if (!steamPath || !fs.existsSync(steamPath)) {
      return defaultInfo;
    }

    const libDirs = this.getSteamLibraryPaths(steamPath);
    for (const libDir of libDirs) {
      const manifestPath = path.join(libDir, 'appmanifest_480.acf');
      const commonDir = path.join(libDir, 'common', 'Spacewar');
      if (fs.existsSync(manifestPath) || fs.existsSync(commonDir)) {
        return {
          isInstalled: true,
          path: fs.existsSync(manifestPath) ? manifestPath : commonDir,
          appName: 'Spacewar',
          appId: 480
        };
      }
    }

    return defaultInfo;
  }

  /**
   * 扫描并解析所有 Steam 库中已安装的本地游戏列表
   */
  public scanInstalledGames(steamPath: string): LocalInstalledGame[] {
    const games: LocalInstalledGame[] = [];
    if (!steamPath || !fs.existsSync(steamPath)) {
      return games;
    }

    const libDirs = this.getSteamLibraryPaths(steamPath);
    const seenAppIds = new Set<number>();

    // 过滤一些无用的公用组件（保留 480 Spacewar 及全部游戏）
    const skipAppIds = new Set<number>([
      228980, // Steamworks Common Redistributables
      1070560, // Steam Linux Runtime
      1391110,
      1628350,
      223750
    ]);

    for (const libDir of libDirs) {
      if (!fs.existsSync(libDir)) continue;

      try {
        const files = fs.readdirSync(libDir);
        for (const file of files) {
          const match = file.match(/^appmanifest_(\d+)\.acf$/i);
          if (!match) continue;

          const appId = parseInt(match[1], 10);
          if (isNaN(appId) || seenAppIds.has(appId) || skipAppIds.has(appId)) continue;

          try {
            const manifestPath = path.join(libDir, file);
            const content = fs.readFileSync(manifestPath, 'utf-8');

            // 解析 Name
            let name = `AppID ${appId}`;
            const nameMatch = content.match(/"name"\s+"([^"]+)"/i);
            if (nameMatch && nameMatch[1]) {
              name = nameMatch[1];
            }

            // 解析 installdir
            let installDir = '';
            const dirMatch = content.match(/"installdir"\s+"([^"]+)"/i);
            if (dirMatch && dirMatch[1]) {
              installDir = dirMatch[1];
            } else {
              installDir = name;
            }

            // 解析 SizeOnDisk
            let sizeOnDisk = 0;
            const sizeMatch = content.match(/"SizeOnDisk"\s+"([^"]+)"/i);
            if (sizeMatch && sizeMatch[1]) {
              sizeOnDisk = parseInt(sizeMatch[1], 10) || 0;
            }

            const fullInstallPath = path.join(libDir, 'common', installDir);

            // 扫描目录下的可执行文件
            let executableFiles: string[] = [];
            let primaryExe: string | undefined;
            let hasSteamlessBackup = false;

            if (fs.existsSync(fullInstallPath)) {
              executableFiles = steamlessService.findExecutableFiles(fullInstallPath, 2);
              if (executableFiles.length > 0) {
                // 优先选取同名 exe 或第一个 exe
                const lowerInstall = installDir.toLowerCase().replace(/\s+/g, '');
                const matchedExe = executableFiles.find((p) => {
                  const base = path.basename(p, '.exe').toLowerCase().replace(/\s+/g, '');
                  return base === lowerInstall || lowerInstall.includes(base) || base.includes(lowerInstall);
                });
                primaryExe = matchedExe || executableFiles[0];
              }

              // 检查是否有 .bak 备份
              try {
                const rootEntries = fs.readdirSync(fullInstallPath);
                hasSteamlessBackup = rootEntries.some((f) => f.toLowerCase().endsWith('.bak'));
              } catch {}
            }

            seenAppIds.add(appId);
            games.push({
              appId,
              name,
              installDir,
              fullInstallPath,
              libraryPath: libDir,
              sizeOnDisk,
              executableFiles,
              primaryExe,
              hasSteamlessBackup
            });
          } catch (e: any) {
            console.warn(`[OnlineFixService] 解析 manifest ${file} 失败:`, e.message);
          }
        }
      } catch (e: any) {
        console.warn(`[OnlineFixService] 扫描库目录 ${libDir} 失败:`, e.message);
      }
    }

    // 优先显示有实际目录和执行文件的游戏，按名称字母排序
    return games.sort((a, b) => {
      const aExists = fs.existsSync(a.fullInstallPath) ? 1 : 0;
      const bExists = fs.existsSync(b.fullInstallPath) ? 1 : 0;
      if (aExists !== bExists) return bExists - aExists;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }

  /**
   * 启动指定游戏的联机模式 (支持 Open内核 / Spacewar / BAT注入)
   */
  public async launchGameOnline(options: {
    appId: number;
    gamePath: string;
    primaryExe?: string;
    mode: OnlineLaunchMode;
    onlineAppId: number;
  }): Promise<{ success: boolean; message: string }> {
    const { appId, gamePath, primaryExe, mode, onlineAppId } = options;

    try {
      if (mode === 'open') {
        // 模式 1: Open 内核联机模式 -> 确保 Steam 带 -onlinefix 运行，并通过 steam 协议拉起
        const isRunning = await steamService.isSteamRunning();
        if (!isRunning) {
          await steamService.restartSteam(['-onlinefix']);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
        await shell.openExternal(`steam://rungameid/${appId}`);
        return {
          success: true,
          message: `已通过 Open内核联机模式唤起《${path.basename(gamePath)}》！`
        };
      }

      if (!gamePath || !fs.existsSync(gamePath)) {
        // 若找不到游戏目录，回退到 steam 协议
        await shell.openExternal(`steam://rungameid/${appId}`);
        return {
          success: true,
          message: `已通过 Steam 协议唤起游戏 (AppID: ${appId})`
        };
      }

      // 确定实际运行的 exe
      let targetExe = primaryExe;
      if (!targetExe || !fs.existsSync(targetExe)) {
        const exes = steamlessService.findExecutableFiles(gamePath, 2);
        if (exes.length > 0) {
          targetExe = exes[0];
        }
      }

      if (!targetExe || !fs.existsSync(targetExe)) {
        await shell.openExternal(`steam://rungameid/${appId}`);
        return {
          success: true,
          message: `未在游戏目录找到 exe，已回退至 Steam 协议启动。`
        };
      }

      if (mode === 'spacewar') {
        // 模式 2: Spacewar 480 模式 (环境变量注入)
        const appidFile = path.join(gamePath, 'steam_appid.txt');
        try {
          fs.writeFileSync(appidFile, onlineAppId.toString(), 'utf-8');
        } catch {}

        const child = spawn(targetExe, [], {
          cwd: path.dirname(targetExe),
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            SteamAppId: onlineAppId.toString(),
            SteamGameId: onlineAppId.toString(),
            SteamOverlayGameId: onlineAppId.toString()
          }
        });
        child.unref();

        return {
          success: true,
          message: `已通过 Spacewar 模式 (AppID: ${onlineAppId}) 成功拉起游戏！`
        };
      }

      if (mode === 'bat') {
        // 模式 3: BAT 环境变量注入模式
        const batName = 'Launch_Online_Fix.bat';
        const batPath = path.join(gamePath, batName);
        const exeFileName = path.basename(targetExe);

        const batContent = `@echo off
title Online Fix Launcher - ${path.basename(gamePath)}
cd /d "%~dp0"
set SteamAppId=${onlineAppId}
set SteamGameId=${onlineAppId}
set SteamOverlayGameId=${onlineAppId}
start "" "${exeFileName}" %*
exit
`;
        fs.writeFileSync(batPath, batContent, 'utf-8');

        const child = spawn('cmd.exe', ['/c', batName], {
          cwd: gamePath,
          detached: true,
          stdio: 'ignore'
        });
        child.unref();

        return {
          success: true,
          message: `已生成并执行 ${batName} (AppID: ${onlineAppId}) 成功拉起游戏！`
        };
      }

      return { success: false, message: '未知的联机启动模式' };
    } catch (err: any) {
      console.error('[OnlineFixService] 启动游戏异常:', err);
      return { success: false, message: `启动游戏失败: ${err.message}` };
    }
  }
}

export const onlineFixService = new OnlineFixService();


