import fs from 'fs';
import path from 'path';
import { OnlineFixStatus } from '../../types';

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
}

export const onlineFixService = new OnlineFixService();
