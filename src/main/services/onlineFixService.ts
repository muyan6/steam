import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { shell } from 'electron';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { createExtractorFromData } from 'node-unrar-js';
import AdmZip from 'adm-zip';
import {
  OnlineFixStatus,
  LocalInstalledGame,
  OnlineLaunchMode,
  OnlineFixSearchResult,
  OnlineFixPatchResult
} from '../../types';
import { steamlessService } from './steamlessService';
import { steamService } from './steamService';

export class OnlineFixService {
  private sessionCookie: string = '';
  private readonly defaultUsername: string = 'huasjj';
  private readonly defaultPassword: string = 'Fanxing6';

  /**
   * 确保 online-fix.me 登录会话
   */
  private async ensureAuth(): Promise<string> {
    if (this.sessionCookie) return this.sessionCookie;

    try {
      const tokenRes = await fetch('https://online-fix.me/engine/ajax/authtoken.php', {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://online-fix.me/',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      const tokenData = await tokenRes.json();
      const tokenCookies = tokenRes.headers.getSetCookie ? tokenRes.headers.getSetCookie() : [];
      const initCookie = tokenCookies.map((c) => c.split(';')[0]).join('; ');

      const formParams = new URLSearchParams();
      formParams.append('login_name', this.defaultUsername);
      formParams.append('login_password', this.defaultPassword);
      formParams.append('login', 'submit');
      formParams.append('login_not_save', '0');
      if (tokenData && tokenData.field && tokenData.value) {
        formParams.append(tokenData.field, tokenData.value);
      }

      const loginRes = await fetch('https://online-fix.me/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Cookie': initCookie,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://online-fix.me/'
        },
        body: formParams.toString()
      });

      const loginCookies = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [];
      this.sessionCookie = [...tokenCookies, ...loginCookies].map((c) => c.split(';')[0]).join('; ');
      return this.sessionCookie;
    } catch (e: any) {
      console.warn('[OnlineFixService] 自动登录 online-fix.me 失败:', e.message);
      return '';
    }
  }

  /**
   * 在 online-fix.me 检索游戏补丁
   */
  public async searchOnlineFixPatch(appId: number, gameName?: string): Promise<OnlineFixSearchResult> {
    const queries: string[] = [appId.toString()];
    if (gameName) {
      const cleanName = gameName.replace(/[^\w\s-]/gi, ' ').trim().replace(/\s+/g, ' ');
      if (cleanName && cleanName !== appId.toString() && !queries.includes(cleanName)) {
        queries.push(cleanName);
      }
    }

    let gameArticleUrl: string | null = null;

    for (const q of queries) {
      console.log(`[OnlineFixService] 正在搜索 online-fix.me: "${q}"...`);
      try {
        const searchUrl = `https://online-fix.me/index.php?do=search&subaction=search&story=${encodeURIComponent(q)}`;
        const res = await fetch(searchUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
          }
        });
        const html = await res.text();
        if (html.includes('По вашему запросу ничего не найдено') || html.includes('ничего не найдено')) {
          continue;
        }

        const contentMatch =
          html.match(/<div[^>]+id="dle-content"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i) ||
          html.match(/id="dle-content"[\s\S]*?(?=<div class="sidebar"|<aside|<\/section)/i);
        const searchSection = contentMatch ? contentMatch[0] : html;
        const links = [...searchSection.matchAll(/<a[^>]+href="(https:\/\/online-fix\.me\/games\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];

        for (const m of links) {
          const url = m[1];
          if (!url.includes('#') && !url.includes('/page,')) {
            gameArticleUrl = url;
            break;
          }
        }
        if (gameArticleUrl) break;
      } catch (err: any) {
        console.warn(`[OnlineFixService] 检索 "${q}" 异常:`, err.message);
      }
    }

    if (!gameArticleUrl) {
      return {
        found: false,
        message: `未在 online-fix.me 搜索到该游戏 (AppID: ${appId}) 的联机补丁`
      };
    }

    console.log(`[OnlineFixService] 匹配到游戏详情页: ${gameArticleUrl}`);
    const cookie = await this.ensureAuth();

    try {
      const gameRes = await fetch(gameArticleUrl, {
        headers: {
          'Cookie': cookie,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://online-fix.me/'
        }
      });
      const gameHtml = await gameRes.text();

      const hosterMatch = gameHtml.match(/href="(https:\/\/hosters\.online-fix\.me:2053\/[^"]+)"/i);
      if (!hosterMatch) {
        return {
          found: true,
          gameArticleUrl,
          message: '已找到游戏页面，但该页面暂无可用的联机补丁分流源'
        };
      }

      const hosterUrl = hosterMatch[1];
      const hosterRes = await fetch(hosterUrl, {
        headers: {
          'Cookie': cookie,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': gameArticleUrl
        }
      });
      const hosterHtml = await hosterRes.text();
      const dataLinksMatches = [...hosterHtml.matchAll(/data-links='([^']+)'/g)].map((m) => m[1]);

      const candidateFiles: Array<{ direct_link: string; file_name: string; id: number; is_dangerous: boolean }> = [];
      for (const raw of dataLinksMatches) {
        try {
          const parsed = JSON.parse(raw);
          for (const item of parsed) {
            candidateFiles.push(item);
          }
        } catch {}
      }

      const fixFiles = candidateFiles.filter((f) => {
        const lower = f.file_name.toLowerCase();
        return lower.includes('fix') || lower.includes('repair') || lower.includes('patch');
      });

      const targetList = fixFiles.length > 0 ? fixFiles : candidateFiles;
      if (targetList.length === 0) {
        return {
          found: true,
          gameArticleUrl,
          message: '未在分流页面中检索到可用的 Fix_Repair 补丁包'
        };
      }

      // 优先选取 PixelDrain
      let chosenFile = targetList.find((f) => f.direct_link && f.direct_link.includes('pixeldrain.com/u/'));
      let downloadUrl = '';
      let fileName = '';

      if (chosenFile) {
        const pixelIdMatch = chosenFile.direct_link.match(/pixeldrain\.com\/u\/([a-zA-Z0-9_-]+)/);
        if (pixelIdMatch) {
          downloadUrl = `https://pixeldrain.com/api/file/${pixelIdMatch[1]}`;
          fileName = chosenFile.file_name;
        }
      }

      if (!downloadUrl) {
        chosenFile = targetList[0];
        downloadUrl = chosenFile.direct_link;
        fileName = chosenFile.file_name;
      }

      return {
        found: true,
        gameArticleUrl,
        fileName,
        downloadUrl
      };
    } catch (err: any) {
      return {
        found: false,
        message: `解析补丁源异常: ${err.message}`
      };
    }
  }

  /**
   * 从 online-fix.me 自动检索、下载并解压安装联机补丁
   */
  public async downloadAndInstallOnlineFixPatch(
    gamePath: string,
    appId: number,
    gameName?: string
  ): Promise<OnlineFixPatchResult> {
    try {
      if (!fs.existsSync(gamePath)) {
        return {
          success: false,
          message: `目标游戏目录不存在: ${gamePath}`
        };
      }

      // 1. 在 online-fix.me 搜索补丁
      const searchRes = await this.searchOnlineFixPatch(appId, gameName);
      if (!searchRes.found || !searchRes.downloadUrl || !searchRes.fileName) {
        return {
          success: false,
          message: searchRes.message || `未在 online-fix.me 搜索到《${gameName || appId}》的联机补丁`
        };
      }

      // 2. 备份原版 DLL
      const api64 = path.join(gamePath, 'steam_api64.dll');
      const api32 = path.join(gamePath, 'steam_api.dll');
      const backup64 = path.join(gamePath, 'steam_api64_o.dll');
      const backup32 = path.join(gamePath, 'steam_api_o.dll');

      if (fs.existsSync(api64) && !fs.existsSync(backup64)) {
        fs.copyFileSync(api64, backup64);
      }
      if (fs.existsSync(api32) && !fs.existsSync(backup32)) {
        fs.copyFileSync(api32, backup32);
      }

      // 3. 下载补丁包
      const tempDir = path.join(os.tmpdir(), 'steammaster_onlinefix_downloads');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

      const ext = path.extname(searchRes.fileName) || '.rar';
      const tempFilePath = path.join(tempDir, `patch_${appId}_${Date.now()}${ext}`);

      console.log(`[OnlineFixService] 正在从 ${searchRes.downloadUrl} 下载补丁包 (${searchRes.fileName})...`);
      const res = await fetch(searchRes.downloadUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      if (!res.ok) {
        return {
          success: false,
          message: `从 online-fix.me 下载补丁失败，HTTP 状态码: ${res.status}`
        };
      }

      const fileStream = fs.createWriteStream(tempFilePath);
      if (!res.body) {
        return { success: false, message: '无法获取下载数据流' };
      }
      await pipeline(Readable.fromWeb(res.body as any), fileStream);

      // 4. 解压到游戏目录 (密码 online-fix.me)
      console.log(`[OnlineFixService] 下载完成，正在解压补丁至: ${gamePath}...`);
      let extractedCount = 0;

      if (ext.toLowerCase() === '.rar' || searchRes.fileName.toLowerCase().endsWith('.rar')) {
        const fileBuffer = fs.readFileSync(tempFilePath);
        const extractor = await createExtractorFromData({
          data: fileBuffer.buffer.slice(fileBuffer.byteOffset, fileBuffer.byteOffset + fileBuffer.byteLength),
          password: 'online-fix.me'
        });

        const extracted = extractor.extract();
        const files = [...extracted.files];
        for (const f of files) {
          if (f.extraction && f.fileHeader.name) {
            const destPath = path.join(gamePath, f.fileHeader.name);
            fs.mkdirSync(path.dirname(destPath), { recursive: true });
            fs.writeFileSync(destPath, Buffer.from(f.extraction));
            extractedCount++;
          }
        }
      } else {
        const zip = new AdmZip(tempFilePath);
        zip.extractAllTo(gamePath, true, false, 'online-fix.me');
        extractedCount = zip.getEntries().length;
      }

      // 清理临时包
      try { fs.unlinkSync(tempFilePath); } catch {}

      return {
        success: true,
        extractedCount,
        fileName: searchRes.fileName,
        articleUrl: searchRes.gameArticleUrl,
        downloadUrl: searchRes.downloadUrl,
        message: `成功从 online-fix.me 下载并安装联机补丁 (${searchRes.fileName})，共部署 ${extractedCount} 个文件！`
      };
    } catch (err: any) {
      console.error('[OnlineFixService] 安装补丁失败:', err);
      return {
        success: false,
        message: `安装联机补丁异常: ${err.message}`
      };
    }
  }

  /**
   * 检查指定游戏目录的联机补丁状态
   */
  public checkGameDirectory(dirPath: string): OnlineFixStatus {
    if (!dirPath || !fs.existsSync(dirPath)) {
      return {
        gamePath: dirPath,
        hasBackup: false,
        isPatched: false,
        mode: 'none'
      };
    }

    const backup64 = path.join(dirPath, 'steam_api64_o.dll');
    const backup32 = path.join(dirPath, 'steam_api_o.dll');
    const onlineFixIni = path.join(dirPath, 'OnlineFix.ini');
    const onlineFixDll = path.join(dirPath, 'OnlineFix64.dll');
    const goldbergSettings = path.join(dirPath, 'steam_settings');

    const hasBackup = fs.existsSync(backup64) || fs.existsSync(backup32);
    let isPatched = false;
    let mode: 'spacewar' | 'goldberg' | 'none' = 'none';
    let appId: number | undefined;

    // 递归检查是否存在 OnlineFix.ini / OnlineFix64.dll
    let foundOnlineFixIni = fs.existsSync(onlineFixIni) || fs.existsSync(onlineFixDll);
    if (!foundOnlineFixIni) {
      try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const subIni = path.join(dirPath, entry.name, 'OnlineFix.ini');
            const subDll = path.join(dirPath, entry.name, 'OnlineFix64.dll');
            if (fs.existsSync(subIni) || fs.existsSync(subDll)) {
              foundOnlineFixIni = true;
              break;
            }
          }
        }
      } catch {}
    }

    if (foundOnlineFixIni) {
      isPatched = true;
      mode = 'spacewar';
      try {
        if (fs.existsSync(onlineFixIni)) {
          const content = fs.readFileSync(onlineFixIni, 'utf-8');
          const match = content.match(/RealAppId\s*=\s*(\d+)/i);
          if (match && match[1]) {
            appId = parseInt(match[1], 10);
          }
        }
      } catch {}
    } else if (fs.existsSync(goldbergSettings)) {
      isPatched = true;
      mode = 'goldberg';
      try {
        const appIdFile = path.join(goldbergSettings, 'steam_appid.txt');
        if (fs.existsSync(appIdFile)) {
          appId = parseInt(fs.readFileSync(appIdFile, 'utf-8').trim(), 10);
        }
      } catch {}
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

      if (fs.existsSync(api64) && !fs.existsSync(backup64)) {
        fs.copyFileSync(api64, backup64);
      }
      if (fs.existsSync(api32) && !fs.existsSync(backup32)) {
        fs.copyFileSync(api32, backup32);
      }

      const iniContent = `[Main]
RealAppId=${realAppId}
FakeAppId=480
Language=schinese
Overlay=1

[Steam]
FakeSteamId=1
`;
      fs.writeFileSync(onlineFixIni, iniContent, 'utf-8');

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

      fs.writeFileSync(path.join(settingsDir, 'steam_appid.txt'), appId.toString(), 'utf-8');
      fs.writeFileSync(path.join(dirPath, 'steam_appid.txt'), appId.toString(), 'utf-8');
      fs.writeFileSync(path.join(settingsDir, 'force_account_name.txt'), playerName, 'utf-8');

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
      const onlineFixDll = path.join(dirPath, 'OnlineFix64.dll');
      const onlineFixUrl = path.join(dirPath, 'OnlineFix.url');
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
      if (fs.existsSync(onlineFixDll)) {
        try { fs.unlinkSync(onlineFixDll); } catch {}
      }
      if (fs.existsSync(onlineFixUrl)) {
        try { fs.unlinkSync(onlineFixUrl); } catch {}
      }
      if (fs.existsSync(appidTxt)) {
        try { fs.unlinkSync(appidTxt); } catch {}
      }
      if (fs.existsSync(settingsDir)) {
        try { fs.rmSync(settingsDir, { recursive: true, force: true }); } catch {}
      }

      // 递归寻找并清理子目录中备份的 DLL
      const searchAndRestore = (currentDir: string, depth = 0) => {
        if (depth > 3) return;
        try {
          const entries = fs.readdirSync(currentDir, { withFileTypes: true });
          for (const entry of entries) {
            const full = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
              searchAndRestore(full, depth + 1);
            } else if (entry.name === 'steam_api64_o.dll') {
              const mainDll = path.join(currentDir, 'steam_api64.dll');
              fs.copyFileSync(full, mainDll);
              try { fs.unlinkSync(full); } catch {}
            } else if (entry.name === 'steam_api_o.dll') {
              const mainDll = path.join(currentDir, 'steam_api.dll');
              fs.copyFileSync(full, mainDll);
              try { fs.unlinkSync(full); } catch {}
            } else if (entry.name === 'OnlineFix.ini' || entry.name === 'OnlineFix64.dll' || entry.name === 'OnlineFix.url') {
              try { fs.unlinkSync(full); } catch {}
            }
          }
        } catch {}
      };
      searchAndRestore(dirPath, 0);

      return { success: true, message: '已完全恢复游戏原版状态与 DLL 文件！' };
    } catch (e: any) {
      return { success: false, message: `还原失败: ${e.message}` };
    }
  }

  /**
   * 获取所有已知的 Steam 库目录路径
   */
  public getSteamLibraryPaths(steamPath: string): string[] {
    const libraries: string[] = [];
    if (!steamPath || !fs.existsSync(steamPath)) return libraries;

    const mainApps = path.join(steamPath, 'steamapps');
    if (fs.existsSync(mainApps)) {
      libraries.push(mainApps);
    }

    const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
    if (fs.existsSync(vdfPath)) {
      try {
        const content = fs.readFileSync(vdfPath, 'utf-8');
        const pathMatches = content.matchAll(/"path"\s+"([^"]+)"/gi);
        for (const match of pathMatches) {
          const rawPath = match[1];
          const cleanPath = rawPath.replace(/\\\\/g, '\\');
          const appsDir = path.join(cleanPath, 'steamapps');
          if (fs.existsSync(appsDir) && !libraries.includes(appsDir)) {
            libraries.push(appsDir);
          }
        }
      } catch {}
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

    const skipAppIds = new Set<number>([
      228980,
      1070560,
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

            let name = `AppID ${appId}`;
            const nameMatch = content.match(/"name"\s+"([^"]+)"/i);
            if (nameMatch && nameMatch[1]) {
              name = nameMatch[1];
            }

            let installDir = '';
            const dirMatch = content.match(/"installdir"\s+"([^"]+)"/i);
            if (dirMatch && dirMatch[1]) {
              installDir = dirMatch[1];
            } else {
              installDir = name;
            }

            let sizeOnDisk = 0;
            const sizeMatch = content.match(/"SizeOnDisk"\s+"([^"]+)"/i);
            if (sizeMatch && sizeMatch[1]) {
              sizeOnDisk = parseInt(sizeMatch[1], 10) || 0;
            }

            const fullInstallPath = path.join(libDir, 'common', installDir);

            let executableFiles: string[] = [];
            let primaryExe: string | undefined;
            let hasSteamlessBackup = false;

            if (fs.existsSync(fullInstallPath)) {
              executableFiles = steamlessService.findExecutableFiles(fullInstallPath, 2);
              if (executableFiles.length > 0) {
                const lowerInstall = installDir.toLowerCase().replace(/\s+/g, '');
                const matchedExe = executableFiles.find((p) => {
                  const base = path.basename(p, '.exe').toLowerCase().replace(/\s+/g, '');
                  return base === lowerInstall || lowerInstall.includes(base) || base.includes(lowerInstall);
                });
                primaryExe = matchedExe || executableFiles[0];
              }

              try {
                const rootEntries = fs.readdirSync(fullInstallPath);
                hasSteamlessBackup = rootEntries.some((f) => f.toLowerCase().endsWith('.bak'));
              } catch {}
            }

            const patchStatus = this.checkGameDirectory(fullInstallPath);

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
              hasSteamlessBackup,
              isPatched: patchStatus.isPatched,
              patchMode: patchStatus.mode,
              hasBackup: patchStatus.hasBackup
            });
          } catch (e: any) {
            console.warn(`[OnlineFixService] 解析 manifest ${file} 失败:`, e.message);
          }
        }
      } catch (e: any) {
        console.warn(`[OnlineFixService] 扫描库目录 ${libDir} 失败:`, e.message);
      }
    }

    return games.sort((a, b) => {
      const aExists = fs.existsSync(a.fullInstallPath) ? 1 : 0;
      const bExists = fs.existsSync(b.fullInstallPath) ? 1 : 0;
      if (aExists !== bExists) return bExists - aExists;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }

  /**
   * 启动指定游戏的联机模式
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
        await shell.openExternal(`steam://rungameid/${appId}`);
        return {
          success: true,
          message: `已通过 Steam 协议唤起游戏 (AppID: ${appId})`
        };
      }

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
