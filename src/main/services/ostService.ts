import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { steamService } from './steamService';
import { metadataService } from './metadataService';
import { luaGameService } from './luaGameService';
import { manifestDownloadService } from './manifestDownloadService';
import { SteamGame, LuaGameInfo } from '../../types';

export class OSTService {
  /**
   * 部署 OpenSteamTool 64 位核心 DLL 三件套到 Steam 根目录
   */
  public async deployCoreBinaries(steamPath: string): Promise<{ success: boolean; deployedCount: number; message: string }> {
    let deployedCount = 0;

    let baseDir = process.cwd();
    try {
      if (typeof __dirname !== 'undefined') {
        baseDir = __dirname;
      } else if (import.meta && import.meta.url) {
        baseDir = path.dirname(fileURLToPath(import.meta.url));
      }
    } catch {
      baseDir = process.cwd();
    }

    // 1. 查找内置资源目录
    const candidateAssetDirs = [
      path.join(baseDir, '../assets/opensteam'),
      path.join(baseDir, '../../src/main/assets/opensteam'),
      path.join(process.cwd(), 'src/main/assets/opensteam'),
      path.join((process as any).resourcesPath || '', 'assets/opensteam'),
      path.join((process as any).resourcesPath || '', 'opensteam')
    ];

    let foundAssetDir: string | null = null;
    for (const d of candidateAssetDirs) {
      if (fs.existsSync(d) && fs.existsSync(path.join(d, 'OpenSteamTool.dll'))) {
        foundAssetDir = d;
        break;
      }
    }

    if (!foundAssetDir) {
      return {
        success: false,
        deployedCount: 0,
        message: '未找到 OpenSteamTool 内核资源文件目录。'
      };
    }

    // 2. 部署 3 个 64 位核心 DLL (OpenSteamTool.dll, dwmapi.dll, xinput1_4.dll)
    const requiredDlls = ['OpenSteamTool.dll', 'dwmapi.dll', 'xinput1_4.dll'];
    for (const dll of requiredDlls) {
      const srcFile = path.join(foundAssetDir, dll);
      const destFile = path.join(steamPath, dll);
      if (fs.existsSync(srcFile)) {
        try {
          fs.copyFileSync(srcFile, destFile);
          deployedCount++;
        } catch (e: any) {
          console.warn(`[OSTService] 复制 ${dll} 到 Steam 失败:`, e.message);
        }
      }
    }

    // 3. 清理可能遗留的旧版冲突 DLL (version.dll, hid.dll)
    const obsoleteDlls = ['version.dll', 'hid.dll'];
    for (const dll of obsoleteDlls) {
      const target = path.join(steamPath, dll);
      if (fs.existsSync(target)) {
        try {
          fs.unlinkSync(target);
        } catch {}
      }
    }

    // 4. 创建 config/lua 与 depotcache 目录
    luaGameService.ensureLuaDir(steamPath);
    manifestDownloadService.ensureDepotCacheDir(steamPath);

    return {
      success: deployedCount >= 2,
      deployedCount,
      message: `已成功为 Steam 部署 OpenSteamTool 核心组件 (${deployedCount}/3 个模块) 及 Lua 规则环境！`
    };
  }

  /**
   * 确保 OpenSteamTool 运行环境完备
   */
  public async ensureOSTEnvironment(
    _manifestApi: string = 'steamrun',
    _customApiUrl?: string,
    _enableInject: boolean = true
  ): Promise<{ success: boolean; message: string }> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return { success: false, message: '未找到 Steam 安装路径，请先在设置中手动指定。' };
    }

    try {
      const deployRes = await this.deployCoreBinaries(steamPath);
      if (!deployRes.success) {
        return { success: false, message: deployRes.message };
      }

      return {
        success: true,
        message: 'OpenSteamTool 运行环境已就绪！'
      };
    } catch (e: any) {
      return { success: false, message: `配置 OST 环境失败: ${e.message}` };
    }
  }

  /**
   * 一键激活注入：部署 DLL 并重启 Steam
   */
  public async activateInjection(
    manifestApi: string = 'steamrun',
    customApiUrl?: string,
    shouldRestartSteam: boolean = true
  ): Promise<{ success: boolean; message: string; steamPath?: string; steamRestarted?: boolean }> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return { success: false, message: '未找到 Steam 安装路径，请先定位 Steam 目录。' };
    }

    const envRes = await this.ensureOSTEnvironment(manifestApi, customApiUrl, true);
    if (!envRes.success) {
      return { success: false, message: envRes.message, steamPath };
    }

    let steamRestarted = false;
    if (shouldRestartSteam) {
      try {
        await steamService.restartSteam();
        steamRestarted = true;
      } catch (err: any) {
        console.warn('[OSTService] 自动重启 Steam 失败:', err);
      }
    }

    return {
      success: true,
      message: steamRestarted
        ? '已成功为 Steam 安装 OpenSteamTool 核心并自动重启生效！'
        : '已成功为 Steam 安装就绪 OpenSteamTool 核心！',
      steamPath,
      steamRestarted
    };
  }

  /**
   * 卸载 OpenSteamTool 注入组件
   */
  public async uninstallInjection(): Promise<{ success: boolean; message: string }> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return { success: false, message: '未找到 Steam 安装路径' };
    }

    const dllsToRemove = ['OpenSteamTool.dll', 'dwmapi.dll', 'xinput1_4.dll', 'version.dll', 'hid.dll'];
    for (const dll of dllsToRemove) {
      const p = path.join(steamPath, dll);
      if (fs.existsSync(p)) {
        try { fs.unlinkSync(p); } catch {}
      }
    }

    // 清理日志
    const logDir = path.join(steamPath, 'opensteamtool');
    if (fs.existsSync(logDir)) {
      try {
        fs.rmSync(logDir, { recursive: true, force: true });
      } catch {}
    }

    return {
      success: true,
      message: '已成功移除 OpenSteamTool 注入文件与日志缓存。'
    };
  }

  /**
   * 一键入库：解析完整元数据 -> 写入标准 Lua 规则 (<steam>/config/lua/<appid>.lua) -> 并发下载 Manifest
   */
  public async unlockGame(game: SteamGame): Promise<{
    success: boolean;
    message: string;
    scriptPath?: string;
    matchedKeysCount?: number;
    manifestCount?: number;
  }> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return { success: false, message: '未找到 Steam 客户端路径' };
    }

    // 1. 确保核心环境与目录就绪
    await this.ensureOSTEnvironment();

    // 2. 获取包含真实 Depots、DLC Depots、Sudama 密钥和 Token 的完整元数据
    const metadata = await metadataService.fetchMetadata(game.appId, game.nameZh || game.name);

    // 3. 严格遵循规范生成 <SteamPath>/config/lua/<appid>.lua
    const saveRes = luaGameService.saveLuaScript(steamPath, metadata);
    if (!saveRes.success) {
      return { success: false, message: saveRes.message };
    }

    // 4. 自动拉取 Manifest 清单到 depotcache/
    let manifestCount = 0;
    try {
      const manifestRes = await manifestDownloadService.downloadDepotManifests(
        steamPath,
        game.appId,
        metadata.depots
      );
      manifestCount = manifestRes.downloadedCount;
    } catch (e: any) {
      console.warn('[OSTService] 下载分包清单异常 (DLL 运行时将自动下载):', e.message);
    }

    const keysCount = metadata.depots.filter(d => d.depotKey).length;
    const manifestMsg = manifestCount > 0
      ? `，已就绪 ${manifestCount} 个分包清单 (.manifest)`
      : ` (OpenSteamTool 动态清单就绪)`;

    return {
      success: true,
      message: `成功为「${metadata.name}」写入标准入库规则！已匹配 ${keysCount} 个分包密钥${manifestMsg}！`,
      scriptPath: saveRes.filePath,
      matchedKeysCount: keysCount,
      manifestCount
    };
  }

  /**
   * 兼容旧接口：生成 Lua 脚本
   */
  public async generateLuaScript(game: SteamGame) {
    return this.unlockGame(game);
  }

  /**
   * 获取所有已入库的 AppID 列表
   */
  public async getUnlockedAppIds(): Promise<number[]> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) return [];

    const games = luaGameService.scanUnlockedGames(steamPath);
    return games.map(g => g.appId);
  }

  /**
   * 获取所有已入库游戏的详细信息（包含游戏名称、Depot 数量等）
   */
  public async getUnlockedGames(): Promise<LuaGameInfo[]> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) return [];

    return luaGameService.scanUnlockedGames(steamPath);
  }

  /**
   * 删除指定 AppID 的入库规则（一键出库）
   */
  public async removeUnlockedGame(appId: number | string): Promise<{ success: boolean; message: string }> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return { success: false, message: '未找到 Steam 路径' };
    }

    return luaGameService.removeLuaScript(steamPath, appId);
  }

  /**
   * 清空所有入库规则
   */
  public async clearAllScripts(): Promise<{ success: boolean; message: string; count: number }> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return { success: false, message: '未找到 Steam 路径', count: 0 };
    }

    return luaGameService.clearAll(steamPath);
  }
}

export const ostService = new OSTService();

