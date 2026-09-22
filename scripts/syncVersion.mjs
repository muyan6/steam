#!/usr/bin/env node
/**
 * 春风渡 (ChunFengDu) 版本号单一源头全自动同步引擎 (Single Source of Truth)
 *
 * 核心机制：
 * 1. 以根目录 package.json 的 "version" 为全项目唯一版本权威定义处。
 * 2. 开发者只需修改根目录 package.json 一处（或运行 `npm run version:bump <版本号>`），
 *    本脚本会在构建/启动前自动将该版本号无缝同步至：
 *    - src-tauri/tauri.conf.json
 *    - server/package.json
 *    - server/data/version.json
 *    - server/data/versions.json
 * 3. 彻底杜绝多处手写版本号导致的「改了安装包漏改后端 / 客户端无限提示更新」历史痛点。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 允许通过命令行传参快速修改版本: `npm run version:bump 2.8.1`
const cliVersion = process.argv[2] ? process.argv[2].replace(/^v/i, '').trim() : null;

const pkgPath = path.join(rootDir, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

if (cliVersion && cliVersion !== pkg.version) {
  const oldVer = pkg.version;
  pkg.version = cliVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  console.log(`[VersionSync] 🎯 根目录 package.json 版本已更新: v${oldVer} -> v${cliVersion}`);
}

const targetVersion = pkg.version;

let syncedAny = false;

// 1. 同步 src-tauri/tauri.conf.json
const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
if (fs.existsSync(tauriConfPath)) {
  const tauriConf = JSON.parse(fs.readFileSync(tauriConfPath, 'utf8'));
  if (tauriConf.version !== targetVersion) {
    const old = tauriConf.version;
    tauriConf.version = targetVersion;
    fs.writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf8');
    console.log(`[VersionSync] ✅ src-tauri/tauri.conf.json 已自动对齐: v${old} -> v${targetVersion}`);
    syncedAny = true;
  }
}

// 2. 同步 server/package.json
const serverPkgPath = path.join(rootDir, 'server', 'package.json');
if (fs.existsSync(serverPkgPath)) {
  const serverPkg = JSON.parse(fs.readFileSync(serverPkgPath, 'utf8'));
  if (serverPkg.version !== targetVersion) {
    const old = serverPkg.version;
    serverPkg.version = targetVersion;
    fs.writeFileSync(serverPkgPath, JSON.stringify(serverPkg, null, 2) + '\n', 'utf8');
    console.log(`[VersionSync] ✅ server/package.json 已自动对齐: v${old} -> v${targetVersion}`);
    syncedAny = true;
  }
}

// 3. 同步 server/data/version.json
const versionJsonPath = path.join(rootDir, 'server', 'data', 'version.json');
if (fs.existsSync(versionJsonPath)) {
  try {
    const vData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
    if (vData.version !== targetVersion) {
      const old = vData.version;
      vData.version = targetVersion;
      if (vData.title && typeof vData.title === 'string') {
        vData.title = vData.title.replace(/v?\d+\.\d+\.\d+/, `v${targetVersion}`);
      }
      vData.downloadUrl = `https://gitee.com/muyan6/steam/releases/download/${targetVersion}/ChunFengDu_${targetVersion}_x64-setup.exe`;
      vData.downloadUrlBackup = `https://github.com/muyan6/steam/releases/download/v${targetVersion}/ChunFengDu_${targetVersion}_x64-setup.exe`;
      vData.updatedAt = new Date().toISOString();
      fs.writeFileSync(versionJsonPath, JSON.stringify(vData, null, 2) + '\n', 'utf8');
      console.log(`[VersionSync] ✅ server/data/version.json 已自动对齐: v${old} -> v${targetVersion}`);
      syncedAny = true;
    }
  } catch (err) {
    console.warn('[VersionSync] ⚠️ 读取 server/data/version.json 异常:', err.message);
  }
}

// 4. 同步 server/data/versions.json
const versionsJsonPath = path.join(rootDir, 'server', 'data', 'versions.json');
if (fs.existsSync(versionsJsonPath)) {
  try {
    const list = JSON.parse(fs.readFileSync(versionsJsonPath, 'utf8'));
    if (Array.isArray(list)) {
      const existingIdx = list.findIndex(item => item.version === targetVersion);
      if (existingIdx === -1 && fs.existsSync(versionJsonPath)) {
        const latestInfo = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
        list.unshift(latestInfo);
        fs.writeFileSync(versionsJsonPath, JSON.stringify(list, null, 2) + '\n', 'utf8');
        console.log(`[VersionSync] ✅ server/data/versions.json 已自动追加并置顶新版本: v${targetVersion}`);
        syncedAny = true;
      } else if (existingIdx > 0) {
        const [item] = list.splice(existingIdx, 1);
        list.unshift(item);
        fs.writeFileSync(versionsJsonPath, JSON.stringify(list, null, 2) + '\n', 'utf8');
        console.log(`[VersionSync] ✅ server/data/versions.json 已置顶当前版本: v${targetVersion}`);
        syncedAny = true;
      }
    }
  } catch (err) {
    console.warn('[VersionSync] ⚠️ 读取 server/data/versions.json 异常:', err.message);
  }
}

if (!syncedAny) {
  console.log(`[VersionSync] ✨ 全项目版本号已高度一致 (v${targetVersion})，无需重复同步。`);
}
