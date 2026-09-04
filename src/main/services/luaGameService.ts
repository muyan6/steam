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
    lines.push(`-- ${gameTitle} (由 春风渡 管理)`);

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
   * 校验 AppID：必须为正整数，防止非法值拼入文件路径
   */
  private isValidAppId(appId: number | string): boolean {
    return typeof appId === 'number' ? Number.isInteger(appId) && appId > 0 : /^\d+$/.test(String(appId));
  }

  /**
   * 将游戏规则写入 <SteamPath>/config/lua/<appid>.lua
   */
  public saveLuaScript(steamPath: string, metadata: GameMetadata): { success: boolean; filePath: string; message: string } {
    try {
      if (!this.isValidAppId(metadata.appId)) {
        return { success: false, filePath: '', message: `非法 AppID: ${metadata.appId}，已拒绝写入规则` };
      }
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

      // 同步 GreenLuma (AppList) 双轨兼容配置
      this.syncGreenLumaAppList(steamPath);

      console.log(`[LuaGameService] 成功写入标准 Lua 规则: ${filePath}`);
      return {
        success: true,
        filePath,
        message: `成功为「${metadata.name || metadata.appId}」生成 OpenSteamTool 规则并同步 AppList！`
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
   * 双轨兼容：自动将所有已入库应用及 DLC AppID 同步到 GreenLuma AppList 目录 (<steam>/AppList/*.txt)
   * 仅清理本工具通过 .cfd_managed.json 清单写入的文件，用户手动维护的 GreenLuma 条目不受影响
   */
  public syncGreenLumaAppList(steamPath: string): void {
    try {
      const appListDir = path.join(steamPath, 'AppList');
      if (!fs.existsSync(appListDir)) {
        try { fs.mkdirSync(appListDir, { recursive: true }); } catch {}
      }

      // 扫描 config/lua/ 下所有 lua 规则，提取所有唯一 AppID (包含本体、Depots 与 DLCs)
      const luaDir = path.join(steamPath, 'config', 'lua');
      const allAppIds = new Set<number>();

      if (fs.existsSync(luaDir)) {
        const files = fs.readdirSync(luaDir).filter(f => /^\d+\.lua$/i.test(f));
        for (const f of files) {
          const mainAppId = parseInt(f.replace('.lua', ''), 10);
          if (!isNaN(mainAppId)) allAppIds.add(mainAppId);

          try {
            const content = fs.readFileSync(path.join(luaDir, f), 'utf-8');
            const matches = content.matchAll(/addappid\s*\(\s*(\d+)/gi);
            for (const m of matches) {
              const id = parseInt(m[1], 10);
              if (!isNaN(id)) allAppIds.add(id);
            }
          } catch {}
        }
      }

      if (!fs.existsSync(appListDir)) return;

      const managedFile = path.join(appListDir, '.cfd_managed.json');
      let managedFiles: string[] = [];
      try {
        const parsed = JSON.parse(fs.readFileSync(managedFile, 'utf-8'));
        if (Array.isArray(parsed)) managedFiles = parsed.filter((x) => typeof x === 'string');
      } catch {}

      // 仅清理本工具此前写入的文件，保留用户手动维护的 GreenLuma 条目
      for (const file of managedFiles) {
        try { fs.unlinkSync(path.join(appListDir, file)); } catch {}
      }

      // 写入连续序号 0.txt, 1.txt, 2.txt ... 并记录管理清单
      const written: string[] = [];
      let index = 0;
      const sortedIds = Array.from(allAppIds).sort((a, b) => a - b);
      for (const id of sortedIds) {
        const fileName = `${index}.txt`;
        fs.writeFileSync(path.join(appListDir, fileName), id.toString(), 'utf-8');
        written.push(fileName);
        index++;
      }
      try {
        fs.writeFileSync(managedFile, JSON.stringify(written, null, 2), 'utf-8');
      } catch {}
      console.log(`[LuaGameService] 成功同步 GreenLuma AppList: 共 ${sortedIds.length} 个 AppID 条目写入 ${appListDir}`);
    } catch (e: any) {
      console.warn('[LuaGameService] 同步 GreenLuma AppList 异常:', e.message);
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
      if (!candidate.startsWith('由') && !candidate.includes('SteamMaster 自动生成') && !candidate.includes('春风渡 自动生成')) {
        name = candidate;
      }
    }

    // 2. 检测 addtoken
    const hasToken = /addtoken\s*\(/i.test(content);

    // 3. 统计 addappid 数量及是否含有效密钥 (排除全 0 占位符)
    const allAddAppIds: Array<{ id: number; key?: string }> = [];
    const addAppIdRegex = /addappid\s*\(\s*(\d+)(?:\s*,\s*0\s*,\s*"([^"]+)")?\s*\)/gi;
    let match: RegExpExecArray | null;
    while ((match = addAppIdRegex.exec(content)) !== null) {
      allAddAppIds.push({
        id: parseInt(match[1], 10),
        key: match[2]
      });
    }

    const hasDepotKeys = allAddAppIds.some(
      (item) => item.key && item.key.length >= 32 && !/^0+$/.test(item.key)
    );

    // 计算分包与 DLC 数量
    const depotsCount = allAddAppIds.filter((item) => item.key || (item.id !== appId && Math.abs(item.id - appId) <= 100)).length;
    const dlcCount = Math.max(0, allAddAppIds.length - depotsCount - 1);

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
      depotsCount: Math.max(0, depotsCount),
      dlcCount: Math.max(0, dlcCount),
      luaPath
    };
  }

  /**
   * 移除指定 AppID 的 Lua 脚本（一键出库）
   */
  public removeLuaScript(steamPath: string, appId: number | string): { success: boolean; message: string } {
    if (!this.isValidAppId(appId)) {
      return { success: false, message: `非法 AppID: ${appId}` };
    }
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

    // 同步 GreenLuma AppList
    this.syncGreenLumaAppList(steamPath);

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

    // 同步 GreenLuma AppList
    this.syncGreenLumaAppList(steamPath);

    return {
      success: true,
      count,
      message: `已成功清空所有入库规则！`
    };
  }
}

export const luaGameService = new LuaGameService();
