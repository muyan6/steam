#!/usr/bin/env node
/**
 * 春风渡 (ChunFengDu) 版本号单一源头全自动同步引擎 (Single Source of Truth)
 *
 * 核心机制：
 * 1. 以根目录 package.json 的 "version" 为全项目唯一版本号权威定义处。
 * 2. 构建/启动前自动将该版本号同步至：src-tauri/tauri.conf.json、server/package.json。
 * 3. server/data/versions.json 是「发布历史」的唯一权威数据；
 *    server/data/version.json 是**派生产物**（= versions.json 中最新一条），
 *    由本脚本与服务端 VersionService.syncLegacyFile() 共同保证一致，禁止把它当成第二份手写源。
 *
 * ⚠️ 更新日志 fail-closed（2026-09 事故修复）：
 * 旧实现只改版本号却**原样沿用上一版的 changelog / releaseDate / createdAt**，
 * 而 scripts/uploadRelease.mjs 在 version.json.version === 版本号时直接采用其 title/changelog
 * 作为 Release 说明 —— 于是 `npm run version:bump 2.9.0` 会把 2.8.0 的更新日志原封不动发到
 * GitHub/Gitee Release 上。现在：
 *   - 目标版本若没有任何可用更新日志来源，脚本**直接报错退出**（绝不静默沿用旧日志）；
 *   - releaseDate / createdAt / updatedAt 一律按目标版本重新生成，不再继承上一版。
 *
 * 用法：
 *   npm run version:bump 2.9.0 -- --title "春风渡 v2.9.0 xxx版" --changelog "🛠️ 第一条" --changelog "🛠️ 第二条"
 *   npm run version:bump 2.9.0 -- --notes-file RELEASE_NOTES.md   # 每行一条（可带 - 前缀）
 *   （也可以先手改 server/data/version.json 的 version/title/changelog，再只跑版本号同步）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// ==================== 参数解析 ====================

const argv = process.argv.slice(2);
let cliVersion = null;
let cliTitle = null;
let cliDate = null;
let cliForce = false;
let notesFile = null;
const cliChangelog = [];

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--title') {
    cliTitle = argv[++i] ?? null;
  } else if (a === '--date') {
    cliDate = argv[++i] ?? null;
  } else if (a === '--changelog' || a === '--note') {
    const v = argv[++i];
    if (v) cliChangelog.push(String(v).trim());
  } else if (a === '--notes-file') {
    notesFile = argv[++i] ?? null;
  } else if (a === '--force') {
    cliForce = true;
  } else if (!a.startsWith('-') && cliVersion === null) {
    cliVersion = a.replace(/^v/i, '').trim();
  }
}

if (notesFile) {
  const notesPath = path.isAbsolute(notesFile) ? notesFile : path.join(rootDir, notesFile);
  if (!fs.existsSync(notesPath)) {
    console.error(`[VersionSync] ❌ --notes-file 指定的文件不存在: ${notesPath}`);
    process.exit(1);
  }
  const lines = fs.readFileSync(notesPath, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .map((l) => l.replace(/^[-*]\s*/, '').trim())
    .filter((l) => l && !l.startsWith('#'));
  cliChangelog.push(...lines);
}

// ==================== 工具函数 ====================

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, data) {
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function semverParts(v) {
  return String(v || '0')
    .replace(/^v/i, '')
    .split('.')
    .map((n) => parseInt(n, 10) || 0);
}

/** 降序排序（新版本在前），保证 versions.json[0] 恒为最新发布 */
function sortDesc(list) {
  return list.sort((a, b) => {
    const x = semverParts(a.version);
    const y = semverParts(b.version);
    const len = Math.max(x.length, y.length);
    for (let i = 0; i < len; i++) {
      const p = x[i] || 0;
      const q = y[i] || 0;
      if (p !== q) return q - p;
    }
    return 0;
  });
}

function normalizeChangelog(items) {
  return (Array.isArray(items) ? items : [])
    .map((c) => String(c == null ? '' : c).trim())
    .filter(Boolean);
}

function isPlaceholderChangelog(items) {
  const list = normalizeChangelog(items);
  if (list.length === 0) return true;
  // 旧版本遗留的占位/兜底文案不算真正的更新日志
  return list.every((c) => /^[-\s]*$/.test(c));
}

// ==================== 1. 版本号主源：根 package.json ====================

const pkgPath = path.join(rootDir, 'package.json');
const pkg = readJson(pkgPath);

if (cliVersion && cliVersion !== pkg.version) {
  const oldVer = pkg.version;
  pkg.version = cliVersion;
  writeJson(pkgPath, pkg);
  console.log(`[VersionSync] 🎯 根目录 package.json 版本已更新: v${oldVer} -> v${cliVersion}`);
}

const targetVersion = String(pkg.version || '').trim();
if (!/^\d+\.\d+\.\d+/.test(targetVersion)) {
  console.error(`[VersionSync] ❌ 根目录 package.json 的 version 非法: "${targetVersion}"`);
  process.exit(1);
}

const versionJsonPath = path.join(rootDir, 'server', 'data', 'version.json');
const versionsJsonPath = path.join(rootDir, 'server', 'data', 'versions.json');

const hasVersionJson = fs.existsSync(versionJsonPath);
const hasVersionsJson = fs.existsSync(versionsJsonPath);

// ==================== 2. 判定目标版本的更新日志来源（fail-closed） ====================

const versionJson = hasVersionJson ? readJson(versionJsonPath) : null;
const versionsList = hasVersionsJson && Array.isArray(readJson(versionsJsonPath))
  ? readJson(versionsJsonPath)
  : [];

const versionJsonIsTarget = Boolean(versionJson && String(versionJson.version).trim() === targetVersion);
const existingEntry = versionsList.find((it) => String(it?.version).trim() === targetVersion) || null;

let releaseTitle = null;
let releaseChangelog = null;
let releaseDate = null;
let releaseSource = null;

// 优先级 1：命令行显式提供（version:bump 的标准用法）
if (cliChangelog.length > 0) {
  releaseChangelog = cliChangelog;
  releaseSource = '命令行 --changelog/--notes-file';
} else if (versionJsonIsTarget && !isPlaceholderChangelog(versionJson.changelog)) {
  // 优先级 2：开发者已手改 version.json 的当前版本日志（旧工作流，继续兼容）
  releaseChangelog = normalizeChangelog(versionJson.changelog);
  releaseSource = 'server/data/version.json 的手写日志';
} else if (existingEntry && !isPlaceholderChangelog(existingEntry.changelog)) {
  // 优先级 3：versions.json 中该版本已有日志（补跑同步时复用自己那一版，不会串版）
  releaseChangelog = normalizeChangelog(existingEntry.changelog);
  releaseSource = 'server/data/versions.json 中该版本已有条目';
}

const needsNewEntry = !existingEntry;

if (needsNewEntry && !releaseChangelog) {
  console.error(
    [
      '',
      `[VersionSync] ❌ 拒绝为新版本 v${targetVersion} 生成发布条目：没有可用的更新日志。`,
      '',
      '  旧实现会把上一版的 changelog 原样沿用到新版本，release:upload 再把它发到 GitHub/Gitee Release，',
      '  导致 Release 说明与实际改动完全不符。此路径现已 fail-closed。',
      '',
      '  请任选一种方式提供 v' + targetVersion + ' 的更新日志：',
      `    npm run version:bump ${targetVersion} -- --changelog "🛠️ 第一条改动" --changelog "🛠️ 第二条改动"`,
      `    npm run version:bump ${targetVersion} -- --notes-file RELEASE_NOTES.md`,
      `    或先手改 server/data/version.json 的 version/title/changelog，再执行本脚本`,
      '',
    ].join('\n')
  );
  process.exit(1);
}

if (releaseChangelog) {
  releaseTitle = cliTitle
    || (versionJsonIsTarget && versionJson.title ? String(versionJson.title) : null)
    || (existingEntry && existingEntry.title ? String(existingEntry.title) : null)
    || `春风渡 v${targetVersion} 版本`;
  // 标题里的版本号必须与目标版本一致，防止沿用上一版标题
  releaseTitle = releaseTitle.replace(/v?\d+\.\d+\.\d+/, `v${targetVersion}`);
  if (!releaseTitle.includes(`v${targetVersion}`)) {
    releaseTitle = `春风渡 v${targetVersion} ${releaseTitle}`.trim();
  }
  releaseDate = cliDate
    || (versionJsonIsTarget && versionJson.releaseDate ? String(versionJson.releaseDate) : null)
    || today();
}

// ==================== 3. 同步 src-tauri/tauri.conf.json ====================

let syncedAny = false;

const tauriConfPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
if (fs.existsSync(tauriConfPath)) {
  const tauriConf = readJson(tauriConfPath);
  if (tauriConf.version !== targetVersion) {
    const old = tauriConf.version;
    tauriConf.version = targetVersion;
    writeJson(tauriConfPath, tauriConf);
    console.log(`[VersionSync] ✅ src-tauri/tauri.conf.json 已自动对齐: v${old} -> v${targetVersion}`);
    syncedAny = true;
  }
}

// ==================== 4. 同步 server/package.json ====================

const serverPkgPath = path.join(rootDir, 'server', 'package.json');
if (fs.existsSync(serverPkgPath)) {
  const serverPkg = readJson(serverPkgPath);
  if (serverPkg.version !== targetVersion) {
    const old = serverPkg.version;
    serverPkg.version = targetVersion;
    writeJson(serverPkgPath, serverPkg);
    console.log(`[VersionSync] ✅ server/package.json 已自动对齐: v${old} -> v${targetVersion}`);
    syncedAny = true;
  }
}

// ==================== 5. 写入 versions.json（发布历史唯一权威） ====================

const nowIso = new Date().toISOString();
const giteeUrl = `https://gitee.com/muyan6/steam/releases/download/${targetVersion}/ChunFengDu_${targetVersion}_x64-setup.exe`;
const githubUrl = `https://github.com/muyan6/steam/releases/download/v${targetVersion}/ChunFengDu_${targetVersion}_x64-setup.exe`;

if (hasVersionsJson) {
  if (needsNewEntry) {
    versionsList.unshift({
      version: targetVersion,
      channel: 'stable',
      releaseDate,
      title: releaseTitle,
      changelog: releaseChangelog,
      downloadUrl: giteeUrl,
      downloadUrlBackup: githubUrl,
      forceUpdate: cliForce,
      minSupportedVersion: '1.0.0',
      enabled: true,
      downloadCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso
    });
    console.log(`[VersionSync] ✅ server/data/versions.json 已追加新版本 v${targetVersion}（日志来源：${releaseSource}）`);
    syncedAny = true;
  } else {
    let touched = false;
    if (releaseChangelog) {
      const prevLog = JSON.stringify(normalizeChangelog(existingEntry.changelog));
      const nextLog = JSON.stringify(releaseChangelog);
      if (prevLog !== nextLog) {
        existingEntry.changelog = releaseChangelog;
        touched = true;
      }
      if (releaseTitle && existingEntry.title !== releaseTitle) {
        existingEntry.title = releaseTitle;
        touched = true;
      }
      if (releaseDate && existingEntry.releaseDate !== releaseDate) {
        existingEntry.releaseDate = releaseDate;
        touched = true;
      }
    }
    if (existingEntry.downloadUrl !== giteeUrl) {
      existingEntry.downloadUrl = giteeUrl;
      touched = true;
    }
    if (existingEntry.downloadUrlBackup !== githubUrl) {
      existingEntry.downloadUrlBackup = githubUrl;
      touched = true;
    }
    if (cliForce && existingEntry.forceUpdate !== true) {
      existingEntry.forceUpdate = true;
      touched = true;
    }
    if (touched) {
      existingEntry.updatedAt = nowIso;
      console.log(`[VersionSync] ✅ server/data/versions.json 中 v${targetVersion} 条目已更新（日志来源：${releaseSource || '既有条目'}）`);
      syncedAny = true;
    }
  }

  sortDesc(versionsList);
  writeJson(versionsJsonPath, versionsList);
} else {
  console.warn('[VersionSync] ⚠️ 未找到 server/data/versions.json，跳过发布历史同步');
}

// ==================== 6. 由 versions.json 派生 version.json（不再双写） ====================

if (hasVersionsJson && versionsList.length > 0) {
  const latest = versionsList[0];
  const derived = {
    version: latest.version,
    channel: latest.channel || 'stable',
    releaseDate: latest.releaseDate,
    title: latest.title,
    changelog: normalizeChangelog(latest.changelog),
    downloadUrl: latest.downloadUrl,
    downloadUrlBackup: latest.downloadUrlBackup,
    forceUpdate: Boolean(latest.forceUpdate),
    minSupportedVersion: latest.minSupportedVersion || '1.0.0',
    enabled: latest.enabled !== false,
    downloadCount: latest.downloadCount || 0,
    createdAt: latest.createdAt || nowIso,
    updatedAt: latest.updatedAt || nowIso
  };

  const prevRaw = versionJson ? JSON.stringify(versionJson, null, 2) : null;
  const nextRaw = JSON.stringify(derived, null, 2);
  if (prevRaw !== nextRaw) {
    writeJson(versionJsonPath, derived);
    if (versionJson && versionJson.version !== derived.version) {
      console.log(`[VersionSync] ✅ server/data/version.json 已由发布历史派生对齐: v${versionJson.version} -> v${derived.version}`);
    } else {
      console.log(`[VersionSync] ✅ server/data/version.json 已由发布历史派生对齐 (v${derived.version})`);
    }
    syncedAny = true;
  }
} else if (!hasVersionsJson) {
  // 极端兜底：只有 version.json 的老仓库形态
  if (hasVersionJson && versionJson.version !== targetVersion && releaseChangelog) {
    const old = versionJson.version;
    versionJson.version = targetVersion;
    versionJson.title = releaseTitle;
    versionJson.changelog = releaseChangelog;
    versionJson.releaseDate = releaseDate;
    versionJson.downloadUrl = giteeUrl;
    versionJson.downloadUrlBackup = githubUrl;
    versionJson.updatedAt = nowIso;
    writeJson(versionJsonPath, versionJson);
    console.log(`[VersionSync] ✅ server/data/version.json 已自动对齐: v${old} -> v${targetVersion}`);
    syncedAny = true;
  }
}

if (!syncedAny) {
  console.log(`[VersionSync] ✨ 全项目版本号与发布日志已高度一致 (v${targetVersion})，无需重复同步。`);
}
