import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');

// 导入权威初始规则
const onlineRulesPath = path.resolve(__dirname, '../src/data/onlineRules.ts');
const onlineRulesContent = fs.readFileSync(onlineRulesPath, 'utf-8');

// 解析现有 curated 规则
function extractCuratedRules() {
  const list = [];
  const regex = /\{\s*appId:\s*(\d+),\s*name:\s*"([^"]+)",(?:\s*nameZh:\s*"([^"]+)",)?\s*netType:\s*"([^"]+)",\s*recommend:\s*"([^"]+)",\s*signals:\s*(\[[^\]]+\]),\s*notes:\s*"([^"]+)"\s*\}/g;
  let match;
  while ((match = regex.exec(onlineRulesContent)) !== null) {
    let signals = [];
    try {
      signals = JSON.parse(match[6].replace(/'/g, '"'));
    } catch {
      signals = [match[6]];
    }
    list.push({
      appId: Number(match[1]),
      name: match[2],
      nameZh: match[3] || match[2],
      netType: match[4],
      recommend: match[5],
      signals,
      notes: match[7],
      source: 'curated'
    });
  }
  return list;
}

const curatedRules = extractCuratedRules();
console.log(`[Sync] 载入内置核心权威规则: ${curatedRules.length} 款`);

const curatedMap = new Map();
for (const r of curatedRules) {
  curatedMap.set(r.appId, r);
}

// 常见第三方平台与大型发行商（独立账号/自建网络）
const THIRDPARTY_PUBLISHERS = [
  'Electronic Arts', 'EA', 'Ubisoft', 'Blizzard Entertainment',
  'Rockstar Games', 'Take-Two', '2K', 'Gaggle Studios', 'Pocketpair'
];

async function fetchWithTimeout(url, ms = 6000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    return null;
  }
}

async function run() {
  console.log('[Sync] 正在拉取 SteamDB / Steam 双榜实时数据...');

  // 1. Steam Most Played Top 100
  const mostPlayedRes = await fetchWithTimeout('https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/');
  const mostPlayedList = (mostPlayedRes?.response?.ranks || []).map(x => ({
    appId: x.appid,
    rank: x.rank,
    peak: x.peak_in_game
  }));
  console.log(`[Sync] 成功拉取 Steam 热门在线榜: ${mostPlayedList.length} 款`);

  // 2. Steam Global Top Sellers Top 100
  const topSellersRes = await fetchWithTimeout('https://store.steampowered.com/search/results/?query&start=0&count=100&filter=topsellers&json=1');
  const topSellersList = [];
  for (const item of (topSellersRes?.items || [])) {
    const m = (item.logo || '').match(/apps\/(\d+)\//);
    if (m) {
      topSellersList.push({
        appId: Number(m[1]),
        name: item.name
      });
    }
  }
  console.log(`[Sync] 成功拉取 Steam 全球热销榜: ${topSellersList.length} 款`);

  // 合并双榜唯一 AppID
  const mergedApps = new Map();
  for (const mp of mostPlayedList) {
    mergedApps.set(mp.appId, {
      appId: mp.appId,
      mostPlayedRank: mp.rank,
      peak: mp.peak,
      inMostPlayed: true
    });
  }
  for (let i = 0; i < topSellersList.length; i++) {
    const ts = topSellersList[i];
    if (mergedApps.has(ts.appId)) {
      const obj = mergedApps.get(ts.appId);
      obj.topSellerRank = i + 1;
      obj.inTopSeller = true;
      if (!obj.name) obj.name = ts.name;
    } else {
      mergedApps.set(ts.appId, {
        appId: ts.appId,
        topSellerRank: i + 1,
        inTopSeller: true,
        name: ts.name
      });
    }
  }
  console.log(`[Sync] 双榜去重后累计独立热门应用: ${mergedApps.size} 款`);

  const finalRules = new Map(curatedMap);
  const uncachedAppIds = [];

  for (const [appId, info] of mergedApps.entries()) {
    if (finalRules.has(appId)) {
      // 已有权威规则，更新双榜排名信号
      const r = finalRules.get(appId);
      if (info.mostPlayedRank && !r.signals.some(s => s.includes('热门榜'))) {
        r.signals.unshift(`SteamDB热门榜 Top ${info.mostPlayedRank}`);
      }
      if (info.topSellerRank && !r.signals.some(s => s.includes('热销榜'))) {
        r.signals.unshift(`Steam热销榜 Top ${info.topSellerRank}`);
      }
    } else {
      uncachedAppIds.push(info);
    }
  }

  console.log(`[Sync] 需联网分类双榜新游: ${uncachedAppIds.length} 款，开始并发获取 Steam 商店元数据...`);

  const CONCURRENCY = 5;
  for (let i = 0; i < uncachedAppIds.length; i += CONCURRENCY) {
    const chunk = uncachedAppIds.slice(i, i + CONCURRENCY);
    await Promise.all(chunk.map(async (info) => {
      const detailsRes = await fetchWithTimeout(`https://store.steampowered.com/api/appdetails?appids=${info.appId}&l=schinese`, 5000);
      const appData = detailsRes ? detailsRes[info.appId]?.data : null;
      if (!appData) {
        console.warn(`[Sync] 获取 AppID ${info.appId} 商店元数据超时或未公开，使用基础信息`);
        finalRules.set(info.appId, {
          appId: info.appId,
          name: info.name || `Steam App ${info.appId}`,
          nameZh: info.name || `Steam App ${info.appId}`,
          netType: 'steamworks',
          recommend: 'scheme1',
          signals: [
            ...(info.mostPlayedRank ? [`SteamDB热门榜 Top ${info.mostPlayedRank}`] : []),
            ...(info.topSellerRank ? [`Steam热销榜 Top ${info.topSellerRank}`] : []),
            'Steamworks联机'
          ],
          notes: 'Steam 热门榜单应用，推荐优先尝试方案一免改直启',
          source: 'steam_charts'
        });
        return;
      }

      const name = appData.name || info.name || `Steam App ${info.appId}`;
      const nameZh = appData.name || info.name || name;
      const type = appData.type;
      const categories = (appData.categories || []).map(c => c.description);
      const genres = (appData.genres || []).map(g => g.description);
      const publishers = appData.publishers || [];
      const isFree = !!appData.is_free;

      // 判定逻辑
      const isTool = type === 'application' || genres.some(g => ['实用工具', '设计和插画', '照片编辑', '动画制作和建模'].includes(g));
      const hasMulti = categories.some(c => c.includes('多人') || c.includes('合作') || c.includes('对战'));
      const isMmo = genres.includes('大型多人在线') || (isFree && categories.some(c => c.includes('线上玩家对战')));
      const isThirdpartyPub = publishers.some(p => THIRDPARTY_PUBLISHERS.some(tp => p.toLowerCase().includes(tp.toLowerCase())));

      let netType = 'steamworks';
      let recommend = 'scheme1';
      let note = 'Steam 热门榜单收录，推荐方案一免改直启';
      const signals = [];

      if (info.mostPlayedRank) signals.push(`SteamDB热门榜 Top ${info.mostPlayedRank}`);
      if (info.topSellerRank) signals.push(`Steam热销榜 Top ${info.topSellerRank}`);

      if (isTool) {
        netType = 'tool';
        recommend = 'single_player';
        note = '实用软件/辅助工具，无需联机';
        signals.push('桌面工具应用');
      } else if (isMmo) {
        netType = 'official_server';
        recommend = 'unsupported';
        note = '官方专属竞技/MMO服务器与反作弊鉴权，无法自建大厅';
        signals.push('官方大型多人在线竞技');
      } else if (!hasMulti) {
        netType = 'single_player';
        recommend = 'single_player';
        note = '纯单机游戏，无需联机大厅通道';
        signals.push('单人游戏模式');
      } else if (isThirdpartyPub) {
        netType = 'thirdparty';
        recommend = 'scheme2';
        note = `${publishers[0] || '第三方'} 官方专属网络体系，推荐方案二联机补丁`;
        signals.push(`${publishers[0] || '第三方'} 账号体系`);
      } else {
        signals.push(categories.find(c => c.includes('合作')) || '多人联机');
        if (categories.includes('在线合作')) {
          signals.push('Steam 在线合作');
        }
      }

      finalRules.set(info.appId, {
        appId: info.appId,
        name,
        nameZh,
        netType,
        recommend,
        signals,
        notes: note,
        source: 'steam_charts'
      });
    }));
    console.log(`[Sync] 已完成 ${Math.min(i + CONCURRENCY, uncachedAppIds.length)} / ${uncachedAppIds.length}`);
  }

  const resultList = Array.from(finalRules.values()).sort((a, b) => a.appId - b.appId);

  const dbPayload = {
    version: new Date().toISOString().slice(0, 10).replace(/-/g, '.') + '.charts',
    updatedAt: new Date().toISOString(),
    count: resultList.length,
    charts: {
      mostPlayedCount: mostPlayedList.length,
      topSellersCount: topSellersList.length,
      mergedUnique: mergedApps.size
    },
    data: resultList
  };

  const outputPath = path.join(DATA_DIR, 'online_rules_db.json');
  fs.writeFileSync(outputPath, JSON.stringify(dbPayload, null, 2), 'utf-8');
  console.log(`[Sync] 成功将 ${resultList.length} 款规则落盘到 ${outputPath}！`);
}

run().catch(console.error);
