#!/usr/bin/env node

/**
 * ManifestHub3 云端全量清单多线程自动同步沉淀工具
 * 
 * 用法:
 *   node scripts/syncManifests.mjs                     # 默认同步热门与常用游戏（基于权威规则与本地密钥库）
 *   node scripts/syncManifests.mjs --full              # 全量同步 ManifestHub3 全部 62,000+ 款游戏清单
 *   node scripts/syncManifests.mjs --limit 500         # 仅同步前 500 款
 *   node scripts/syncManifests.mjs --appId 1966720     # 仅同步指定 AppID
 *   node scripts/syncManifests.mjs --concurrency 8     # 设定并发下载数为 8（默认 6）
 *   node scripts/syncManifests.mjs --proxy             # 强制走国内 ghfast.top 镜像
 *   node scripts/syncManifests.mjs --direct            # 强制走 GitHub Raw 直连（海外服务器推荐）
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import axios from 'axios';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const MANIFESTS_DIR = path.resolve(DATA_DIR, 'manifests');

if (!fs.existsSync(MANIFESTS_DIR)) {
  fs.mkdirSync(MANIFESTS_DIR, { recursive: true });
}

// ==================== CLI 参数解析 ====================
const args = process.argv.slice(2);
function getArg(name, defaultValue = null) {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  const prefix = `${name}=`;
  const found = args.find((a) => a.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  return defaultValue;
}
const hasFlag = (name) => args.includes(name);

const IS_FULL = hasFlag('--full') || hasFlag('--all');
const SPECIFIC_APP_ID = getArg('--appId') || getArg('--appid');
const LIMIT = getArg('--limit') ? parseInt(getArg('--limit'), 10) : null;
const CONCURRENCY = getArg('--concurrency') ? Math.max(1, parseInt(getArg('--concurrency'), 10)) : 6;
const FORCE_RELOAD = hasFlag('--force');
const FORCE_PROXY = hasFlag('--proxy');
const FORCE_DIRECT = hasFlag('--direct');

// ==================== 网络环境探活 ====================
let useProxy = true;

async function probeNetwork() {
  if (FORCE_PROXY) {
    useProxy = true;
    console.log('[网络策略] 显式指定使用 ghfast.top 镜像源加速');
    return;
  }
  if (FORCE_DIRECT) {
    useProxy = false;
    console.log('[网络策略] 显式指定使用 GitHub Raw 直连');
    return;
  }

  console.log('[网络探活] 正在检测当前服务器到 GitHub Raw 的连通性...');
  const t0 = Date.now();
  try {
    const res = await axios.get(
      'https://raw.githubusercontent.com/steamtools-games/ManifestHub3/main/README.md',
      { timeout: 2500 }
    );
    if (res.status === 200) {
      const elapsed = Date.now() - t0;
      console.log(`[网络策略] GitHub Raw 直连通畅（耗时 ${elapsed}ms），采用海外高速直连模式！`);
      useProxy = false;
      return;
    }
  } catch {}

  console.log('[网络策略] GitHub 直连受限或超时，自动切换为国内 ghfast.top 代理加速通道！');
  useProxy = true;
}

function getBaseUrl(appId, file) {
  if (useProxy) {
    return `https://ghfast.top/https://raw.githubusercontent.com/steamtools-games/ManifestHub3/${appId}/${file}`;
  }
  return `https://raw.githubusercontent.com/steamtools-games/ManifestHub3/${appId}/${file}`;
}

// ==================== 候选 AppID 获取 ====================
async function getCandidateAppIds() {
  if (SPECIFIC_APP_ID) {
    const list = SPECIFIC_APP_ID.split(',').map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
    console.log(`[任务模式] 针对指定 ${list.length} 个 AppID 进行清单同步`);
    return list;
  }

  const cacheFile = path.resolve(DATA_DIR, '.manifest_branches_cache.json');

  // 如果要求 --full，优先从 git ls-remote 获取全量 6.2万分支
  if (IS_FULL) {
    if (fs.existsSync(cacheFile) && !FORCE_RELOAD) {
      try {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        if (Array.isArray(cached) && cached.length > 50000) {
          console.log(`[索引载入] 从本地分支缓存载入 ${cached.length} 款 ManifestHub3 游戏`);
          return cached;
        }
      } catch {}
    }

    console.log('[索引抓取] 正在通过 Git 协议解析 ManifestHub3 全部分支列表（约 3~5 秒）...');
    try {
      const remoteUrl = 'https://github.com/steamtools-games/ManifestHub3.git';
      const output = execSync(`git ls-remote --heads ${remoteUrl}`, {
        timeout: 25000,
        encoding: 'utf-8',
        maxBuffer: 32 * 1024 * 1024
      });
      const branches = [];
      for (const line of output.split('\n')) {
        const match = line.match(/refs\/heads\/(\d+)$/);
        if (match) branches.push(match[1]);
      }
      if (branches.length > 1000) {
        console.log(`[索引抓取] 成功提取到 ${branches.length} 款有效游戏分支！已写入本地缓存`);
        fs.writeFileSync(cacheFile, JSON.stringify(branches));
        return branches;
      }
    } catch (e) {
      console.warn('[索引抓取] git ls-remote 失败或超时，回退从全量游戏数据库扫描:', e.message);
    }
  }

  // 非 full 模式或 git 失败时：从现有本地数据库中提取重点热门游戏
  const appSet = new Set();

  // 1. 载入权威在线规则游戏
  try {
    const onlineRulesPath = path.resolve(ROOT_DIR, 'src/data/onlineRules.ts');
    if (fs.existsSync(onlineRulesPath)) {
      const content = fs.readFileSync(onlineRulesPath, 'utf-8');
      const matches = content.matchAll(/appId:\s*(\d+)/g);
      for (const m of matches) appSet.add(m[1]);
      console.log(`[优先队列] 载入常用热门游戏: ${appSet.size} 款`);
    }
  } catch {}

  // 2. 载入本地已拥有有效解密密钥的 Depot 对应游戏
  const keyFile = path.resolve(DATA_DIR, 'steam_depot_keys.json');
  if (fs.existsSync(keyFile)) {
    try {
      const keys = JSON.parse(fs.readFileSync(keyFile, 'utf-8'));
      // keys 是 { depotId: key }，将常用 AppID 纳入
      for (const dId of Object.keys(keys)) {
        if (/^\d+$/.test(dId)) {
          // 一般本体 depotId 往往等于 appId 或 appId + 1
          appSet.add(dId);
        }
      }
    } catch {}
  }

  // 3. 补充 steam_all_games.json 中热门前列游戏
  const allGamesFile = path.resolve(DATA_DIR, 'steam_all_games.json');
  if (fs.existsSync(allGamesFile)) {
    try {
      const games = JSON.parse(fs.readFileSync(allGamesFile, 'utf-8'));
      if (Array.isArray(games)) {
        for (const g of games.slice(0, 8000)) {
          if (g.appId) appSet.add(g.appId.toString());
        }
      }
    } catch {}
  }

  return Array.from(appSet);
}

// ==================== 单游戏清单同步逻辑 ====================
async function syncSingleGame(appId) {
  const jsonUrl = getBaseUrl(appId, `${appId}.json`);
  let jsonData = null;

  try {
    const res = await axios.get(jsonUrl, { timeout: 6000 });
    if (res.data && res.data.depot && typeof res.data.depot === 'object') {
      jsonData = res.data.depot;
    }
  } catch (e) {
    // 404 表明该游戏无清单或分支不存在
    return { status: 'skipped', count: 0, bytes: 0 };
  }

  if (!jsonData) {
    return { status: 'skipped', count: 0, bytes: 0 };
  }

  let downloadedCount = 0;
  let downloadedBytes = 0;
  let alreadyCachedCount = 0;

  for (const [depotId, dInfo] of Object.entries(jsonData)) {
    if (!dInfo || typeof dInfo !== 'object') continue;
    let gid = null;
    if (dInfo.manifests && typeof dInfo.manifests === 'object') {
      gid = dInfo.manifests.public?.gid || Object.values(dInfo.manifests)[0]?.gid;
    }
    if (!gid || gid === '0' || !/^\d+$/.test(gid.toString())) {
      continue;
    }

    const filename = `${depotId}_${gid}.manifest`;
    const targetPath = path.join(MANIFESTS_DIR, filename);

    // 断点续传检查：若本地已有且大小大于 0，跳过
    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0 && !FORCE_RELOAD) {
      alreadyCachedCount++;
      continue;
    }

    // 下载实体 .manifest 文件
    const manifestUrl = getBaseUrl(appId, filename);
    try {
      const resp = await axios.get(manifestUrl, {
        responseType: 'arraybuffer',
        timeout: 10000
      });
      if (resp.status === 200 && resp.data && resp.data.byteLength > 0) {
        fs.writeFileSync(targetPath, Buffer.from(resp.data));
        downloadedCount++;
        downloadedBytes += resp.data.byteLength;
      }
    } catch {}
  }

  return {
    status: 'ok',
    count: downloadedCount,
    cached: alreadyCachedCount,
    bytes: downloadedBytes
  };
}

// ==================== 多并发任务调度引擎 ====================
async function run() {
  console.log('==================================================================');
  console.log('   春风渡 (ChunFengDu) ManifestHub3 云端全量清单同步引擎 v1.0   ');
  console.log('==================================================================');
  console.log(`[目标路径] ${MANIFESTS_DIR}`);

  await probeNetwork();

  let appIds = await getCandidateAppIds();
  if (LIMIT && LIMIT > 0) {
    appIds = appIds.slice(0, LIMIT);
    console.log(`[限额执行] 已限制同步前 ${LIMIT} 款游戏`);
  }

  const total = appIds.length;
  console.log(`[准备就绪] 待处理游戏总数: ${total} 款 | 并发通道数: ${CONCURRENCY}`);
  console.log('------------------------------------------------------------------');

  let cursor = 0;
  let totalDownloaded = 0;
  let totalCached = 0;
  let totalBytes = 0;
  let failedOrSkipped = 0;
  const startTime = Date.now();

  let isStopping = false;
  process.on('SIGINT', () => {
    console.log('\n[用户中断] 正在等待当前处理中的分包完成写入，随后安全退出...');
    isStopping = true;
  });

  async function worker(workerId) {
    while (cursor < total && !isStopping) {
      const idx = cursor++;
      const appId = appIds[idx];

      try {
        const res = await syncSingleGame(appId);
        if (res.status === 'ok') {
          totalDownloaded += res.count;
          totalCached += res.cached || 0;
          totalBytes += res.bytes;
        } else {
          failedOrSkipped++;
        }
      } catch {
        failedOrSkipped++;
      }

      // 进度打印（每 10 款打印一次，或单款游戏时打印）
      const done = cursor;
      if (done % 10 === 0 || done === total) {
        const percent = ((done / total) * 100).toFixed(1);
        const elapsedSec = Math.max(1, (Date.now() - startTime) / 1000);
        const speed = (totalDownloaded / elapsedSec).toFixed(1);
        const mb = (totalBytes / 1024 / 1024).toFixed(1);
        const etaSec = speed > 0 ? Math.round((total - done) / (done / elapsedSec)) : 0;
        const etaStr = etaSec > 3600 ? `${(etaSec / 3600).toFixed(1)}h` : `${Math.round(etaSec / 60)}m`;

        process.stdout.write(
          `\r[进度] ${done}/${total} (${percent}%) | 新沉淀: ${totalDownloaded} 个 (${mb}MB) | 已存在: ${totalCached} | 速度: ${speed}/s | 预估剩余: ${etaStr}   `
        );
      }
    }
  }

  const workers = Array.from({ length: CONCURRENCY }, (_, i) => worker(i + 1));
  await Promise.all(workers);

  const totalSec = Math.max(1, Math.round((Date.now() - startTime) / 1000));
  const finalMb = (totalBytes / 1024 / 1024).toFixed(2);
  const existingFiles = fs.readdirSync(MANIFESTS_DIR).filter((f) => f.endsWith('.manifest')).length;

  console.log('\n------------------------------------------------------------------');
  console.log('✅ 清单同步任务执行完成！统计结果如下：');
  console.log(`- 本次新下载沉淀清单: ${totalDownloaded} 个 (${finalMb} MB)`);
  console.log(`- 断点续传跳过已存在: ${totalCached} 个`);
  console.log(`- 总耗时: ${Math.floor(totalSec / 60)} 分 ${totalSec % 60} 秒`);
  console.log(`- 当前服务端本地 manifests/ 目录可用清单总数: ${existingFiles} 个`);
  console.log('==================================================================');
}

run().catch((e) => {
  console.error('\n[异常退出]:', e);
  process.exit(1);
});
