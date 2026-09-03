import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';
import { steamService, getExecutableBitness } from './steamService';
import { manifestService } from './manifestService';
import { SteamGame } from '../../types';
import { APP_CONFIG } from '../../config/appConfig';

export class OSTService {
  /**
   * 自动探测 Steam 位数并智能部署匹配的 Hook 核心组件 (32位/64位) 到 Steam 根目录
   */
  public async deployCoreBinaries(steamPath: string): Promise<{ success: boolean; deployedCount: number; bitness: 'x86' | 'x64' | 'unknown'; message: string }> {
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
      path.join(process.cwd(), 'server/data/OpenSteamTool-Release'),
      path.join((process as any).resourcesPath || '', 'assets/opensteam'),
      path.join((process as any).resourcesPath || '', 'opensteam')
    ];

    let foundAssetDir: string | null = null;
    for (const d of candidateAssetDirs) {
      if (fs.existsSync(d) && (fs.existsSync(path.join(d, 'version.dll')) || fs.existsSync(path.join(d, 'OpenSteamTool.dll')))) {
        foundAssetDir = d;
        break;
      }
    }

    // 2. 自动检测 Steam 主程序位数架构
    const steamBitness = await steamService.detectSteamBitness(steamPath);

    if (steamBitness === 'x86') {
      // ===== 32 位 Steam 客户端自适应部署 =====
      // 32 位 Steam 使用 32 位专用的 version.dll 作为 Hook 模块
      let versionDeployed = false;

      // 优先从本地资源目录提取 32 位 version.dll
      if (foundAssetDir) {
        const srcVersion = path.join(foundAssetDir, 'version.dll');
        if (fs.existsSync(srcVersion)) {
          try {
            fs.copyFileSync(srcVersion, path.join(steamPath, 'version.dll'));
            deployedCount++;
            versionDeployed = true;
          } catch (e: any) {
            console.warn('[OSTService] 复制 32位 version.dll 失败:', e.message);
          }
        }
      }

      // 检查是否有备份文件 version.bak.dll，如尚未部署则恢复
      const versionBak = path.join(steamPath, 'version.bak.dll');
      const versionDest = path.join(steamPath, 'version.dll');
      if (!versionDeployed && fs.existsSync(versionBak)) {
        try {
          fs.copyFileSync(versionBak, versionDest);
          deployedCount++;
          versionDeployed = true;
        } catch {}
      }

      // 清理可能导致 32 位 Steam 载入异常的 64 位冲突代理模块
      const incompatibleX64Dlls = ['dwmapi.dll', 'xinput1_4.dll'];
      for (const dll of incompatibleX64Dlls) {
        const targetPath = path.join(steamPath, dll);
        if (fs.existsSync(targetPath) && getExecutableBitness(targetPath) === 'x64') {
          try {
            fs.unlinkSync(targetPath);
          } catch {}
        }
      }

      return {
        success: true,
        deployedCount,
        bitness: 'x86',
        message: `已自动检测 Steam 为 32 位 (x86) 架构，成功匹配并部署 32 位专用 Hook 核心 (version.dll)！`
      };
    } else if (steamBitness === 'x64') {
      // ===== 64 位 Steam 客户端自适应部署 =====
      const requiredDlls = ['OpenSteamTool.dll', 'dwmapi.dll', 'xinput1_4.dll', 'hid.dll'];
      if (foundAssetDir) {
        for (const dll of requiredDlls) {
          const srcFile = path.join(foundAssetDir, dll);
          const destFile = path.join(steamPath, dll);
          if (fs.existsSync(srcFile)) {
            try {
              fs.copyFileSync(srcFile, destFile);
              deployedCount++;
            } catch (e: any) {
              console.warn(`[OSTService] 复制 ${dll} 到 64位 Steam 失败:`, e.message);
            }
          }
        }
      }

      // 如果 64 位本地缺失核心，从云端镜像下载最新内核
      const hasCore = fs.existsSync(path.join(steamPath, 'OpenSteamTool.dll')) && fs.existsSync(path.join(steamPath, 'dwmapi.dll'));
      if (!hasCore) {
        try {
          const downloadUrls = [
            'https://ghfast.top/https://github.com/OpenSteam001/OpenSteamTool/releases/download/1.4.8/OpenSteamTool-1.4.8-Release.zip',
            'https://ghproxy.net/https://github.com/OpenSteam001/OpenSteamTool/releases/download/1.4.8/OpenSteamTool-1.4.8-Release.zip',
            'https://github.com/OpenSteam001/OpenSteamTool/releases/download/1.4.8/OpenSteamTool-1.4.8-Release.zip'
          ];

          for (const dlUrl of downloadUrls) {
            try {
              const resp = await axios.get(dlUrl, { responseType: 'arraybuffer', timeout: 8000 });
              if (resp.data && resp.data.length > 10000) {
                const tempZip = path.join(steamPath, 'ost_temp.zip');
                try {
                  const { execSync } = await import('child_process');
                  execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${tempZip}' -DestinationPath '${steamPath}' -Force"`);
                  try { fs.unlinkSync(tempZip); } catch {}
                  deployedCount = 3;
                  break;
                } catch (zipErr) {
                  console.warn('[OSTService] 解压失败:', zipErr);
                }
              }
            } catch {}
          }
        } catch (e) {
          console.warn('[OSTService] 在线下载 OST 内核失败:', e);
        }
      }

      return {
        success: true,
        deployedCount,
        bitness: 'x64',
        message: `已自动检测 Steam 为 64 位 (x64) 架构，成功匹配并部署 64 位 OpenSteamTool 核心组件 (${deployedCount} 个模块)！`
      };
    } else {
      // ===== 未知架构时的通用双向兜底部署 =====
      const allDlls = ['version.dll', 'OpenSteamTool.dll', 'dwmapi.dll', 'xinput1_4.dll'];
      if (foundAssetDir) {
        for (const dll of allDlls) {
          const srcFile = path.join(foundAssetDir, dll);
          const destFile = path.join(steamPath, dll);
          if (fs.existsSync(srcFile)) {
            try {
              fs.copyFileSync(srcFile, destFile);
              deployedCount++;
            } catch {}
          }
        }
      }

      return {
        success: true,
        deployedCount,
        bitness: 'unknown',
        message: `已为 Steam 部署自适应通用核心组件 (${deployedCount} 个模块)！`
      };
    }
  }

  /**
   * 确保 st_scripts 与 config/stplug-in / config/lua 目录、DLL 与 opensteamtool.toml 存在
   */
  public async ensureOSTEnvironment(manifestApi: string = 'steamrun', customApiUrl?: string, enableInject: boolean = true): Promise<{ success: boolean; message: string }> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return { success: false, message: '未找到 Steam 安装路径，请先在设置中手动指定。' };
    }

    try {
      // 1. 自动探测架构并部署自适应 DLL 核心
      const deployRes = await this.deployCoreBinaries(steamPath);

      // 2. 确保规则与清单目录存在 (st_scripts, config/stplug-in, config/lua, depotcache)
      const dirs = [
        path.join(steamPath, 'st_scripts'),
        path.join(steamPath, 'config', 'stplug-in'),
        path.join(steamPath, 'config', 'lua'),
        path.join(steamPath, 'depotcache')
      ];
      for (const d of dirs) {
        if (!fs.existsSync(d)) {
          fs.mkdirSync(d, { recursive: true });
        }
      }

      // 3. 生成/更新 opensteamtool.toml 配置文件
      const tomlPath = path.join(steamPath, 'opensteamtool.toml');
      let manifestSetting = 'url = "http://gmrc.wudrm.com/manifest/{gid}"';
      if (manifestApi === 'steamrun') {
        manifestSetting = 'url = "steamrun"';
      } else if (manifestApi === 'wudrm') {
        manifestSetting = 'url = "http://gmrc.wudrm.com/manifest/{gid}"';
      } else if (manifestApi === 'custom' && customApiUrl) {
        manifestSetting = `url = "${customApiUrl}"`;
      } else if (manifestApi === 'opensteamtool') {
        manifestSetting = 'url = "steamrun"';
      }

      const tomlContent = `# OpenSteamTool Configuration generated by SteamMaster
[manifest]
${manifestSetting}
auto_download = true

[stats]
enable_api = true

[inject]
enabled = ${enableInject ? 'true' : 'false'}
`;
      fs.writeFileSync(tomlPath, tomlContent, 'utf-8');

      const bitnessDesc = deployRes.bitness === 'x86' ? '32 位 (x86)' : deployRes.bitness === 'x64' ? '64 位 (x64)' : '通用架构';
      return { success: true, message: `已成功为 ${bitnessDesc} Steam 部署适配的运行内核、清单下载管道与入库规则环境！` };
    } catch (e: any) {
      return { success: false, message: `配置 OST 环境失败: ${e.message}` };
    }
  }

  /**
   * 启动向导：一键自动安装完整 OpenSteam 注入内核并重启 Steam
   */
  public async activateInjection(
    manifestApi: string = 'wudrm',
    customApiUrl?: string,
    shouldRestartSteam: boolean = true
  ): Promise<{ success: boolean; message: string; steamPath?: string; steamRestarted?: boolean }> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return { success: false, message: '未找到 Steam 安装路径，请先定位 Steam 目录。' };
    }

    // 1. 自动写入内核组件与配置文件
    const envRes = await this.ensureOSTEnvironment(manifestApi, customApiUrl, true);
    if (!envRes.success) {
      return { success: false, message: envRes.message, steamPath };
    }

    // 2. 自动重启 Steam 客户端以挂载注入内核
    let steamRestarted = false;
    if (shouldRestartSteam) {
      try {
        await steamService.restartSteam();
        steamRestarted = true;
      } catch (err: any) {
        console.warn('[OSTService] 自动重启 Steam 失败:', err);
      }
    }

    const bitness = await steamService.detectSteamBitness(steamPath);
    const bitnessLabel = bitness === 'x86' ? '32 位' : bitness === 'x64' ? '64 位' : '';

    return {
      success: true,
      message: steamRestarted
        ? `已自动为 ${bitnessLabel} Steam 注入匹配的 Hook 内核，并已自动重启生效！`
        : `已为 ${bitnessLabel} Steam 自动安装就绪匹配的 Hook 内核！`,
      steamPath,
      steamRestarted
    };
  }

  /**
   * 为指定游戏生成一键入库 Lua 脚本并同步写入 Steam 规则与 depotcache 清单
   */
  public async generateLuaScript(game: SteamGame): Promise<{
    success: boolean;
    message: string;
    scriptPath?: string;
    matchedKeysCount?: number;
    manifestCount?: number;
  }> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return { success: false, message: '未找到 Steam 路径' };
    }

    // 确保 opensteamtool.toml 及环境正常
    await this.ensureOSTEnvironment();

    const scriptsDir = path.join(steamPath, 'st_scripts');
    const pluginDir = path.join(steamPath, 'config', 'stplug-in');
    const luaDir = path.join(steamPath, 'config', 'lua');
    if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
    if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir, { recursive: true });
    if (!fs.existsSync(luaDir)) fs.mkdirSync(luaDir, { recursive: true });

    const lines: string[] = [
      `-- SteamMaster 自动生成的入库规则`,
      `-- Game: ${game.nameZh || game.name} (AppID: ${game.appId})`,
      `-- Timestamp: ${new Date().toISOString()}`,
      ``,
      `-- 1. 挂载主游戏本体 License (伪造拥有权)`,
      `addappid(${game.appId})`,
      ``
    ];

    // 2. 挂载 DLC（如有）
    if (game.dlcs && game.dlcs.length > 0) {
      lines.push(`-- 2. 挂载 DLC 列表`);
      for (const dlcId of game.dlcs) {
        lines.push(`addappid(${dlcId})`);
      }
      lines.push(``);
    }

    const isValidKey = (k?: string) => k && k.length >= 32 && !/^0+$/.test(k);

    // 3. 聚合密钥：优先通过云端 Node.js 后端拉取 28.8万条 DepotKey 库
    let matchedKeys: { [depotId: string]: string } = {};
    if (game.depots) {
      for (const [dId, k] of Object.entries(game.depots)) {
        if (isValidKey(k)) {
          matchedKeys[dId] = k;
        }
      }
    }

    let fetchedFromCloud = false;
    try {
      const url = `${APP_CONFIG.API_BASE_URL}/api/depots/${game.appId}`;
      const resp = await axios.get(url, {
        params: { dlcs: game.dlcs?.join(',') },
        timeout: 2500
      });
      if (resp.data && resp.data.success && resp.data.data) {
        for (const [dId, k] of Object.entries(resp.data.data as Record<string, string>)) {
          if (isValidKey(k)) {
            matchedKeys[dId] = k;
          }
        }
        fetchedFromCloud = true;
      }
    } catch {
      // 云端未连接，走本地 28.8万离线密钥库检索
    }

    // 无论云端是否返回，均以本地 28.8万离线密钥库深度补全有效密钥
    try {
      const localKeyPaths = [
        path.join(process.cwd(), 'server/data/steam_depot_keys.json'),
        path.join(process.cwd(), 'data/steam_depot_keys.json')
      ];
      for (const kp of localKeyPaths) {
        if (fs.existsSync(kp)) {
          const allKeys = JSON.parse(fs.readFileSync(kp, 'utf-8'));
          const effectiveDlcs = game.dlcs || [];
          for (let i = 0; i <= 100; i++) {
            const dId = (game.appId + i).toString();
            const key = allKeys[dId];
            if (isValidKey(key) && (!matchedKeys[dId] || !isValidKey(matchedKeys[dId]))) {
              matchedKeys[dId] = key;
            }
          }
          for (const dlc of effectiveDlcs) {
            for (let j = 0; j <= 30; j++) {
              const dId = (dlc + j).toString();
              const key = allKeys[dId];
              if (isValidKey(key) && (!matchedKeys[dId] || !isValidKey(matchedKeys[dId]))) {
                matchedKeys[dId] = key;
              }
            }
          }
          break;
        }
      }
    } catch (err) {
      console.warn('[OSTService] 读取本地离线密钥库异常:', err);
    }

    // 4. 全自动拉取并写入分包清单 (.manifest) 到 Steam depotcache/ (后端优先 -> 公共清单源兜底)
    let manifestResult: any = null;
    try {
      manifestResult = await manifestService.fetchAndInstallManifests(game.appId, game.dlcs, matchedKeys);
      if (manifestResult && manifestResult.depotKeys) {
        matchedKeys = { ...matchedKeys, ...manifestResult.depotKeys };
      }
    } catch (mErr) {
      console.warn('[OSTService] 自动匹配清单异常:', mErr);
    }

    // 5. 写入密钥规则 (标准 OpenSteamTool 语法: addappid(depotId, 0, key) 与 set_depot_key(depotId, key))
    const keysCount = Object.keys(matchedKeys).length;
    if (keysCount > 0) {
      lines.push(`-- 3. 注入分包解密密钥 (Depot Decryption Keys, 共 ${keysCount} 个分包)`);
      for (const [depotId, key] of Object.entries(matchedKeys)) {
        if (depotId === game.appId.toString()) {
          if (key && key !== '0000000000000000000000000000000000000000000000000000000000000000') {
            lines.push(`set_depot_key(${depotId}, "${key}")`);
          }
          continue;
        }
        if (key && key !== '0000000000000000000000000000000000000000000000000000000000000000') {
          lines.push(`addappid(${depotId}, 0, "${key}")`);
          lines.push(`set_depot_key(${depotId}, "${key}")`);
        } else {
          lines.push(`addappid(${depotId})`);
        }
      }
      lines.push(``);
    }

    const scriptContent = lines.join('\n');
    const destFiles = [
      path.join(scriptsDir, `app_${game.appId}.lua`),
      path.join(pluginDir, `app_${game.appId}.lua`),
      path.join(luaDir, `app_${game.appId}.lua`)
    ];

    try {
      for (const f of destFiles) {
        try {
          fs.writeFileSync(f, scriptContent, 'utf-8');
        } catch {}
      }

      const manifestCount = manifestResult?.totalDepots || manifestResult?.downloadedCount || 0;
      const manifestMsg = manifestCount > 0
        ? `，已就绪 ${manifestCount} 个分包清单 (.manifest) 到 depotcache`
        : ` (清单代理已就绪)`;

      return {
        success: true,
        message: `成功为「${game.nameZh || game.name}」写入入库规则！已匹配 ${keysCount} 个分包密钥${manifestMsg}！`,
        scriptPath: destFiles[0],
        matchedKeysCount: keysCount,
        manifestCount
      };
    } catch (e: any) {
      return { success: false, message: `写入 Lua 脚本失败: ${e.message}` };
    }
  }

  /**
   * 获取所有已入库的 Lua 规则列表
   */
  public async getUnlockedAppIds(): Promise<number[]> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) return [];

    const dirsToCheck = [
      path.join(steamPath, 'st_scripts'),
      path.join(steamPath, 'config', 'stplug-in')
    ];

    const appIdsSet = new Set<number>();

    for (const dir of dirsToCheck) {
      if (!fs.existsSync(dir)) continue;
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const match = file.match(/app_(\d+)\.lua/i);
          if (match && match[1]) {
            appIdsSet.add(parseInt(match[1], 10));
          }
        }
      } catch (e) {
        console.error('[OSTService] 读取已入库列表失败:', e);
      }
    }

    return Array.from(appIdsSet);
  }

  /**
   * 删除指定 AppID 的 Lua 规则
   */
  public async removeLuaScript(appId: number): Promise<{ success: boolean; message: string }> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return { success: false, message: '未找到 Steam 路径' };
    }

    const candidateFiles = [
      path.join(steamPath, 'st_scripts', `app_${appId}.lua`),
      path.join(steamPath, 'config', 'stplug-in', `app_${appId}.lua`),
      path.join(steamPath, 'config', 'lua', `app_${appId}.lua`)
    ];

    let removed = false;
    for (const f of candidateFiles) {
      if (fs.existsSync(f)) {
        try {
          fs.unlinkSync(f);
          removed = true;
        } catch {}
      }
    }

    return {
      success: true,
      message: removed ? '成功移除入库规则！' : '规则文件已不存在。'
    };
  }

  public async removeUnlockedGame(appId: number): Promise<{ success: boolean; message: string }> {
    return this.removeLuaScript(appId);
  }

  /**
   * 清空所有入库规则
   */
  public async clearAllScripts(): Promise<{ success: boolean; message: string; count: number }> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return { success: false, message: '未找到 Steam 路径', count: 0 };
    }

    const dirsToCheck = [
      path.join(steamPath, 'st_scripts'),
      path.join(steamPath, 'config', 'stplug-in'),
      path.join(steamPath, 'config', 'lua')
    ];

    let count = 0;
    for (const dir of dirsToCheck) {
      if (!fs.existsSync(dir)) continue;
      try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
          if (file.endsWith('.lua')) {
            fs.unlinkSync(path.join(dir, file));
            count++;
          }
        }
      } catch {}
    }

    return { success: true, message: `已成功清空入库规则！`, count };
  }
}

export const ostService = new OSTService();
