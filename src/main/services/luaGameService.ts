import fs from 'fs';
import path from 'path';
import { GameMetadata, LuaGameInfo } from '../../types';

export class LuaGameService {
  /**
   * 确保 Steam 根目录下的 config/lua 目录存在
   */
  public ensureLuaDir(steamPath: string): string {
    const luaDir = path.join(steamPath, 'config', 'lua');
    if (!fs.existsSync(luaDir)) {
      fs.mkdirSync(luaDir, { recursive: true });
    }
    return luaDir;
  }

  /**
   * 严格按照 OpenSteamTool 标准构建 Lua 文件内容
   */
  public buildLuaContent(metadata: GameMetadata): string {
    const lines: string[] = [];
    const gameTitle = metadata.name || `AppID ${metadata.appId}`;

    // 1. 注释行（包含游戏名称，方便扫描器反向解析）
    lines.push(`-- ${gameTitle} (由 SteamMaster 管理)`);

    // 2. 主游戏入库
    if (metadata.appLevelKey) {
      lines.push(`addappid(${metadata.appId}, 0, "${metadata.appLevelKey}")`);
    } else {
      lines.push(`addappid(${metadata.appId})`);
    }

    // 3. 主游戏 Depot 密钥与分包挂载
    const seenDepotIds = new Set<string>([metadata.appId]);
    for (const depot of metadata.depots) {
      if (seenDepotIds.has(depot.depotId)) continue;
      seenDepotIds.add(depot.depotId);

      if (depot.depotKey) {
        lines.push(`addappid(${depot.depotId}, 0, "${depot.depotKey}")`);
      } else {
        lines.push(`addappid(${depot.depotId})`);
      }
    }

    // 4. Access Token
    if (metadata.accessToken) {
      lines.push(`addtoken(${metadata.appId}, "${metadata.accessToken}")`);
    }

    // 5. DLC 列表挂载
    if (metadata.dlcIds && metadata.dlcIds.length > 0) {
      const sortedDlcs = Array.from(new Set(metadata.dlcIds)).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
      for (const dlcId of sortedDlcs) {
        if (dlcId === metadata.appId) continue;
        lines.push(`addappid(${dlcId})`);
      }
    }

    // 6. DLC Depot 专属密钥
    if (metadata.dlcDepots && metadata.dlcDepots.length > 0) {
      for (const { depot } of metadata.dlcDepots) {
        if (depot.depotKey && !seenDepotIds.has(depot.depotId)) {
          seenDepotIds.add(depot.depotId);
          lines.push(`addappid(${depot.depotId}, 0, "${depot.depotKey}")`);
        }
      }
    }

    lines.push('');
    return lines.join('\n');
  }

  /**
   * 将游戏规则写入 <SteamPath>/config/lua/<appid>.lua
   */
  public saveLuaScript(steamPath: string, metadata: GameMetadata): { success: boolean; filePath: string; message: string } {
    try {
      const luaDir = this.ensureLuaDir(steamPath);
      const filePath = path.join(luaDir, `${metadata.appId}.lua`);
      const content = this.buildLuaContent(metadata);

      fs.writeFileSync(filePath, content, 'utf-8');

      // 同时镜像保存一份到 st_scripts/ 兼容旧模式
      try {
        const legacyDir = path.join(steamPath, 'st_scripts');
        if (!fs.existsSync(legacyDir)) fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, `${metadata.appId}.lua`), content, 'utf-8');
      } catch {}

      console.log(`[LuaGameService] 成功写入标准 Lua 规则: ${filePath}`);
      return {
        success: true,
        filePath,
        message: `成功为「${metadata.name || metadata.appId}」生成 OpenSteamTool 规则！`
      };
    } catch (e: any) {
      console.error(`[LuaGameService] 写入 Lua 规则失败:`, e);
      return {
        success: false,
        filePath: '',
        message: `写入 Lua 规则失败: ${e.message}`
      };
    }
  }

  /**
   * 扫描 <SteamPath>/config/lua 目录，解析所有已入库游戏
   */
  public scanUnlockedGames(steamPath: string): LuaGameInfo[] {
    const luaDir = path.join(steamPath, 'config', 'lua');
    if (!fs.existsSync(luaDir)) {
      return [];
    }

    const games: LuaGameInfo[] = [];
    try {
      const files = fs.readdirSync(luaDir);
      for (const file of files) {
        // OpenSteamTool 规范：纯数字.lua
        const match = file.match(/^(\d+)\.lua$/i);
        if (!match) continue;

        const appId = parseInt(match[1], 10);
        const fullPath = path.join(luaDir, file);

        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const info = this.parseLuaContent(appId, fullPath, content, steamPath);
          if (info) {
            games.push(info);
          }
        } catch {}
      }
    } catch (e) {
      console.error('[LuaGameService] 扫描 config/lua 失败:', e);
    }

    // 按 AppID 升序排序
    return games.sort((a, b) => a.appId - b.appId);
  }

  /**
   * 检查某游戏是否已在库中
   */
  public hasGame(steamPath: string, appId: number | string): boolean {
    const filePath = path.join(steamPath, 'config', 'lua', `${appId}.lua`);
    return fs.existsSync(filePath);
  }

  /**
   * 解析单个 Lua 文件内容提取游戏状态与名称
   */
  public parseLuaContent(appId: number, luaPath: string, content: string, steamPath?: string): LuaGameInfo {
    let name = `AppID ${appId}`;

    // 1. 从首行注释提取游戏名称
    const nameMatch = content.match(/^--\s*(.+?)(?:\s*\(.*?\))?\s*$/m);
    if (nameMatch && nameMatch[1]) {
      const candidate = nameMatch[1].trim();
      if (!candidate.startsWith('由') && !candidate.includes('SteamMaster 自动生成')) {
        name = candidate;
      }
    }

    // 2. 检测 addtoken
    const hasToken = /addtoken\s*\(/i.test(content);

    // 3. 统计 addappid 数量及是否含密钥
    const addAppIdMatches = content.match(/addappid\s*\(\s*\d+\s*(?:,\s*0\s*,\s*"[^"]+")?\s*\)/gi) || [];
    const hasDepotKeys = /addappid\s*\(\s*\d+\s*,\s*0\s*,\s*"[0-9a-fA-F]{32,}"\s*\)/i.test(content);

    // 4. 检查是否有 manifest 在 depotcache
    let hasManifest = false;
    if (steamPath) {
      const depotCacheDir = path.join(steamPath, 'depotcache');
      if (fs.existsSync(depotCacheDir)) {
        try {
          const depotFiles = fs.readdirSync(depotCacheDir);
          hasManifest = depotFiles.some(f => f.startsWith(`${appId}_`) || f.startsWith(`${appId + 1}_`));
        } catch {}
      }
    }

    return {
      appId,
      name,
      hasToken,
      hasManifest,
      hasDepotKeys,
      depotsCount: Math.max(0, addAppIdMatches.length - 1),
      dlcCount: 0,
      luaPath
    };
  }

  /**
   * 移除指定 AppID 的 Lua 脚本（一键出库）
   */
  public removeLuaScript(steamPath: string, appId: number | string): { success: boolean; message: string } {
    let removed = false;
    const pathsToClean = [
      path.join(steamPath, 'config', 'lua', `${appId}.lua`),
      path.join(steamPath, 'st_scripts', `${appId}.lua`),
      path.join(steamPath, 'st_scripts', `app_${appId}.lua`),
      path.join(steamPath, 'config', 'stplug-in', `app_${appId}.lua`)
    ];

    for (const p of pathsToClean) {
      if (fs.existsSync(p)) {
        try {
          fs.unlinkSync(p);
          removed = true;
        } catch {}
      }
    }

    return {
      success: true,
      message: removed ? `已成功将 AppID ${appId} 移出库！` : `规则文件不存在或已被移除。`
    };
  }

  /**
   * 清空所有入库规则
   */
  public clearAll(steamPath: string): { success: boolean; count: number; message: string } {
    let count = 0;
    const dirs = [
      path.join(steamPath, 'config', 'lua'),
      path.join(steamPath, 'st_scripts'),
      path.join(steamPath, 'config', 'stplug-in')
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (f.endsWith('.lua')) {
            try {
              fs.unlinkSync(path.join(dir, f));
              count++;
            } catch {}
          }
        }
      } catch {}
    }

    return {
      success: true,
      count,
      message: `已成功清空所有入库规则！`
    };
  }
}

export const luaGameService = new LuaGameService();
