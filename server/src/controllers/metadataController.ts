import { Request, Response } from 'express';
import axios from 'axios';
import https from 'https';
import { gameService } from '../services/gameService.js';
import { depotService } from '../services/depotService.js';
import { tokenService } from '../services/tokenService.js';
import { manifestService } from '../services/manifestService.js';
import { dlcIndexService } from '../services/dlcIndexService.js';

// 安全策略：不再关闭上游 HTTPS 证书校验（原 rejectUnauthorized:false 存在 MITM 注入密钥风险）
const httpsAgent = new https.Agent();

// ==================== ManifestHub3 兜底源 ====================
// steamtools-games/ManifestHub3：每 AppID 一个 Git 分支，内含 {AppID}.lua + key.vdf，
// 社区维护、活跃更新（约 6.2 万 AppID）。当本地密钥库没有某游戏的数据时，
// 拉取其分支 Lua 解析出 depotKey / manifestGid / accessToken 兜底补全。
// 铁律：只补缺，绝不覆盖已有有效数据——其 GID 可能与 SteamCMD public 分支不一致，
// SteamCMD 实时数据始终优先。

interface ManifestHub3Data {
  depotKeys: Map<string, string>;
  manifestGids: Map<string, string>;
  accessToken?: string;
  dlcIds: string[];
  /** 该源的构建号（P-ToyStore appinfo.vdf 的 buildid）：用于跨源"取最新"裁决 */
  buildId?: string;
}

const manifestHub3Cache = new Map<number, { data: ManifestHub3Data | null; fetchedAt: number }>();
const MANIFEST_HUB3_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时内存缓存，避免逐请求拉取
// 同一 AppID 的在途请求去重：并发请求共享同一次上游拉取
const manifestHub3InFlight = new Map<number, Promise<ManifestHub3Data | null>>();
// 缓存条目硬上限，超限时先清过期再淘汰最旧，防止被脚本灌海量 AppID 撑爆内存
const MANIFEST_HUB3_CACHE_MAX = 500;

/**
 * 深拷贝一份源数据。
 * fetchManifestHub3 命中缓存时返回的必须是副本：否则调用方合并多源数据时
 * 会对缓存本体就地 set()，把别源 GID 永久写进该 AppID 的缓存条目（TTL 内持续污染）。
 */
function cloneHub3Data(d: ManifestHub3Data | null): ManifestHub3Data | null {
  if (!d) return null;
  return {
    depotKeys: new Map(d.depotKeys),
    manifestGids: new Map(d.manifestGids),
    dlcIds: [...d.dlcIds],
    accessToken: d.accessToken,
    buildId: d.buildId
  };
}

function toBuildNum(v?: string): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 跨源 GID 择优裁决。
 * 铁律：既不能"谁先回应用谁"（旧源会抢答），也不能"后到的无条件覆盖"（过期数据会顶掉正确结果）。
 * 规则：
 * - 现有值缺失 → 采纳（补缺）
 * - 值相同 → 不动作
 * - 双方 buildid 均可比较 → 取更大者（真正的"取最新"）
 * - 无法比较（缺 buildid）→ 保持现状，避免误覆盖
 */
function pickNewerGid(
  currentGid?: string,
  candidateGid?: string,
  currentBuild?: string,
  candidateBuild?: string
): boolean {
  if (!candidateGid || candidateGid === '0') return false;
  if (!currentGid || currentGid === '0') return true;
  if (currentGid === candidateGid) return false;
  const a = toBuildNum(currentBuild);
  const b = toBuildNum(candidateBuild);
  if (a !== null && b !== null) return b > a;
  return false;
}

function parseManifestHub3Lua(lua: string, targetAppId?: number): ManifestHub3Data {
  const depotKeys = new Map<string, string>();
  const manifestGids = new Map<string, string>();
  const dlcIds: string[] = [];
  const sTarget = targetAppId ? targetAppId.toString() : '';
  let accessToken: string | undefined;

  for (const rawLine of lua.split('\n')) {
    const line = rawLine.trim();

    // addappid(<depot>, 0|1, "<key>") / setDepotKey(<depot>, "<key>")
    const addMatch = line.match(/^addappid\((\d+)\s*,\s*\d+\s*,\s*"([0-9a-fA-F]{32,})"\s*\)/);
    const setKeyMatch = line.match(/^setDepotKey\((\d+)\s*,\s*"([0-9a-fA-F]{32,})"\s*\)/);
    const keyMatch = addMatch || setKeyMatch;
    if (keyMatch) {
      const depotId = keyMatch[1];
      const key = keyMatch[2];
      // 绝不接受全 0 占位符
      if (!/^0+$/.test(key)) depotKeys.set(depotId, key);
      continue;
    }

    // addappid(<id>) 纯挂载行（通常为 DLC 挂载）
    const simpleAddMatch = line.match(/^addappid\((\d+)\s*(?:,\s*\d+)?\s*\)/);
    if (simpleAddMatch) {
      const id = simpleAddMatch[1];
      if (id !== sTarget && !dlcIds.includes(id)) {
        dlcIds.push(id);
      }
      continue;
    }

    // setManifestid(<depot>, "<gid>"[, 0])
    const gidMatch = line.match(/^setManifestid\((\d+)\s*,\s*"(\d{5,})"/);
    if (gidMatch && gidMatch[2] !== '0') {
      manifestGids.set(gidMatch[1], gidMatch[2]);
      continue;
    }

    // addtoken(<appid>, "<hex>")
    const tokenMatch = line.match(/^addtoken\((\d+)\s*,\s*"([0-9a-fA-F]+)"\s*\)/);
    if (tokenMatch) {
      accessToken = tokenMatch[2];
    }
  }

  return { depotKeys, manifestGids, accessToken, dlcIds };
}

function parseManifestHub3Json(json: any, targetAppId?: number): ManifestHub3Data {
  const depotKeys = new Map<string, string>();
  const manifestGids = new Map<string, string>();
  const dlcIds: string[] = [];
  // 若上游 JSON 携带 buildid，一并带出用于跨源版本裁决
  const buildId =
    json && json.buildid != null && /^\d+$/.test(String(json.buildid))
      ? String(json.buildid)
      : json && json.build_id != null && /^\d+$/.test(String(json.build_id))
      ? String(json.build_id)
      : undefined;
  if (json && json.depot && typeof json.depot === 'object') {
    for (const [dId, info] of Object.entries<any>(json.depot)) {
      if (!/^\d+$/.test(dId)) continue;
      if (
        info.decryptionkey &&
        typeof info.decryptionkey === 'string' &&
        info.decryptionkey.length >= 32 &&
        !/^0+$/.test(info.decryptionkey)
      ) {
        depotKeys.set(dId, info.decryptionkey);
      }
      let gid: string | undefined;
      if (info.manifests && typeof info.manifests === 'object') {
        gid = info.manifests.public?.gid || Object.values<any>(info.manifests)[0]?.gid;
      }
      if (gid && gid !== '0' && /^\d+$/.test(gid.toString())) {
        manifestGids.set(dId, gid.toString());
      }
      if (info.dlcappid && /^\d+$/.test(String(info.dlcappid))) {
        const dlcAppId = String(info.dlcappid);
        if (targetAppId && dlcAppId !== targetAppId.toString() && !dlcIds.includes(dlcAppId)) {
          dlcIds.push(dlcAppId);
        }
      }
    }
  }
  return { depotKeys, manifestGids, dlcIds, buildId };
}

async function fetchManifestHub3(appId: number): Promise<ManifestHub3Data | null> {
  const now = Date.now();
  const cached = manifestHub3Cache.get(appId);
  if (cached && now - cached.fetchedAt < MANIFEST_HUB3_TTL_MS) {
    // 返回副本：调用方会就地合并其他源的数据，直接交出缓存本体将造成缓存污染
    return cloneHub3Data(cached.data);
  }

  // 在途请求去重：同一 AppID 的并发请求共享同一次上游拉取
  const pending = manifestHub3InFlight.get(appId);
  if (pending) {
    return cloneHub3Data(await pending);
  }

  const task = (async (): Promise<ManifestHub3Data | null> => {
    // 采用国内响应最快且稳定的两大镜像：ghfast.top 与 gh-proxy.com，并发竞速探测
    const fastBases = [
      'https://steam.os.kg/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://ghfast.top/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://gh-proxy.com/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://cece.guyunsq.com/https://raw.githubusercontent.com/steamtools-games/ManifestHub3'
    ];

    let data: ManifestHub3Data | null = null;

    // 1. 并发探测 {appId}.json
    try {
      const jsonPromises = fastBases.map(async (base) => {
        const resp = await axios.get(`${base}/${appId}/${appId}.json`, { httpsAgent, timeout: 2500 });
        if (resp.data && resp.data.depot && typeof resp.data.depot === 'object') {
          return resp.data;
        }
        throw new Error('Not valid json');
      });
      const jsonData = await Promise.any(jsonPromises);
      if (jsonData) {
        data = parseManifestHub3Json(jsonData, appId);
      }
    } catch {}

    // 2. 若 json 未命中，并发探测 {appId}.lua 与 {appId}_public.lua
    if (!data) {
      try {
        const luaUrls: string[] = [];
        for (const base of fastBases) {
          luaUrls.push(`${base}/${appId}/${appId}.lua`);
          luaUrls.push(`${base}/${appId}/${appId}_public.lua`);
        }
        const luaPromises = luaUrls.map(async (u) => {
          const resp = await axios.get(u, { httpsAgent, timeout: 2500 });
          const text = typeof resp.data === 'string' ? resp.data : '';
          if (text.includes('addappid') || text.includes('setManifestid')) {
            return text;
          }
          throw new Error('Not valid lua');
        });
        const luaText = await Promise.any(luaPromises);
        if (luaText) {
          data = parseManifestHub3Lua(luaText, appId);
        }
      } catch {}
    }

    // 写入前先清理：删除全部过期条目；仍超限则按插入序淘汰最旧
    if (manifestHub3Cache.size >= MANIFEST_HUB3_CACHE_MAX) {
      const ts = Date.now();
      for (const [k, v] of manifestHub3Cache) {
        if (ts - v.fetchedAt >= MANIFEST_HUB3_TTL_MS) manifestHub3Cache.delete(k);
      }
      while (manifestHub3Cache.size >= MANIFEST_HUB3_CACHE_MAX) {
        const oldest = manifestHub3Cache.keys().next().value;
        if (oldest === undefined) break;
        manifestHub3Cache.delete(oldest);
      }
    }
    manifestHub3Cache.set(appId, { data, fetchedAt: Date.now() });
    return cloneHub3Data(data);
  })();

  manifestHub3InFlight.set(appId, task);
  try {
    return await task;
  } finally {
    manifestHub3InFlight.delete(appId);
  }
}

// ==================== 元数据响应缓存 ====================
// 同一 AppID 的 DepotKey / DLC / GID 元数据在官方出新版本前是稳定的。
// 加缓存后重复请求从 5~7 秒降到毫秒级，同时大幅削减对 SteamCMD 与
// ManifestHub3 镜像的上游压力。
//
// withGid 标记至关重要：
// - 「跟随官方最新」模式（needGid=false）：清单 GID 由 Steam 经 manifest.lua
//   动态获取，服务端跳过 ManifestHub3 社区对齐（省 2.5~4 秒）；
// - 「锁定版本」模式（needGid=true）：必须拿到社区对齐过的 GID，否则钉死的
//   清单实体在镜像里不存在，会下不动。
// 因此锁定模式绝不能复用 withGid=false 的轻量缓存条目。
interface CachedMetadata {
  appId: number;
  name: string;
  depots: Array<{ depotId: string; depotKey?: string; manifestGid?: string; size?: number }>;
  dlcIds: string[];
  dlcDepots: Array<{ dlcAppId: string; depot: { depotId: string; depotKey?: string; manifestGid?: string } }>;
  appLevelKey?: string;
  accessToken?: string;
  /** 是否包含社区对齐后的清单 GID（仅 needGid=true 的完整链路为 true） */
  withGid: boolean;
  fetchedAt: number;
}

const metadataCache = new Map<number, CachedMetadata>();
const METADATA_TTL_MS = 10 * 60 * 1000; // 10 分钟
const METADATA_CACHE_MAX = 500;

function readMetadataCache(appId: number, needGid: boolean): CachedMetadata | null {
  const entry = metadataCache.get(appId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt >= METADATA_TTL_MS) {
    metadataCache.delete(appId);
    return null;
  }
  // 锁定版本必须有社区对齐过的 GID，轻量缓存不可复用
  if (needGid && !entry.withGid) return null;
  return entry;
}

/** 清除单个 AppID 的响应缓存；返回是否确有条目被清除 */
function clearMetadataCache(appId: number): boolean {
  return metadataCache.delete(appId);
}

function writeMetadataCache(entry: CachedMetadata): void {
  // 写入前先清过期；仍超限则按插入序淘汰最旧
  if (metadataCache.size >= METADATA_CACHE_MAX) {
    const now = Date.now();
    for (const [k, v] of metadataCache) {
      if (now - v.fetchedAt >= METADATA_TTL_MS) metadataCache.delete(k);
    }
    while (metadataCache.size >= METADATA_CACHE_MAX) {
      const oldest = metadataCache.keys().next().value;
      if (oldest === undefined) break;
      metadataCache.delete(oldest);
    }
  }
  metadataCache.set(entry.appId, entry);
}

/**
 * 本地清单就绪状态（纯本地文件检查，微秒级）。
 * 命中缓存时必须重算：depotcache 会随后台沉淀与手动预缓存实时变化，
 * 把它一起缓存会让界面长期停留在过期状态。
 *
 * dynamicByDefault：默认「跟随官方最新」模式下清单由 OST 动态调度，
 * 本地没有实体文件属于正常状态，应报 dynamic 而非 missing。
 */
function computeManifestInfo(
  appId: number,
  depots: Array<{ depotId: string; manifestGid?: string }>,
  dynamicByDefault: boolean
): { status: 'ready' | 'dynamic' | 'missing'; hasPhysicalManifest: boolean; readyCount: number; totalCount: number } {
  let readyManifestCount = 0;
  let hasGidCount = 0;
  for (const d of depots) {
    if (d.manifestGid && /^\d+$/.test(d.manifestGid) && d.manifestGid !== '0') {
      hasGidCount++;
      if (manifestService.getLocalManifestFilePath(d.depotId, d.manifestGid, appId)) {
        readyManifestCount++;
      }
    }
  }
  const status: 'ready' | 'dynamic' | 'missing' =
    readyManifestCount > 0 && readyManifestCount >= depots.length
      ? 'ready'
      : hasGidCount > 0 || dynamicByDefault
      ? 'dynamic'
      : 'missing';
  return {
    status,
    hasPhysicalManifest: readyManifestCount > 0,
    readyCount: readyManifestCount,
    totalCount: depots.length
  };
}

export const getGameMetadata = async (req: Request, res: Response) => {
  try {
    const rawAppId = Array.isArray(req.params.appId) ? req.params.appId[0] : req.params.appId;
    const appId = parseInt(rawAppId, 10);
    if (isNaN(appId)) {
      return res.status(400).json({ success: false, message: '无效的 AppID' });
    }

    const sAppId = appId.toString();
    // 客户端自报的游戏名只作提示回显：去除控制字符并截断，防止反射注入与超大参数
    const rawHint = typeof req.query.name === 'string' ? req.query.name : '';
    const hintName = rawHint.replace(/[\x00-\x1F\x7F]/g, '').slice(0, 64);

    // needGid=1 → 「锁定版本」模式，走完整链路拿社区对齐 GID；
    // 缺省 → 「跟随官方最新」模式，跳过纯 GID 的社区源探测
    const needGid = req.query.needGid === '1' || req.query.needGid === 'true';

    // 命中缓存直接返回（manifestInfo 必须重算，depotcache 实时变化）
    const cached = readMetadataCache(appId, needGid);
    if (cached) {
      return res.json({
        success: true,
        data: {
          appId: cached.appId,
          name: cached.name,
          depots: cached.depots,
          dlcIds: cached.dlcIds,
          dlcDepots: cached.dlcDepots,
          appLevelKey: cached.appLevelKey,
          accessToken: cached.accessToken,
          manifestInfo: computeManifestInfo(appId, cached.depots, !cached.withGid)
        }
      });
    }

    let gameName = hintName;
    let dlcIds: string[] = [];
    let depots: Array<{ depotId: string; depotKey?: string; manifestGid?: string; size?: number }> = [];
    let dlcDepots: Array<{ dlcAppId: string; depot: { depotId: string; depotKey?: string; manifestGid?: string } }> = [];
    // SteamCMD 分包元数据的 dlcappid 是权威的「DLC → 分包」关联，
    // 先记录映射，待分包密钥/GID 全部补全后再生成 dlcDepots
    const dlcDepotMap = new Map<string, Set<string>>();

    // 1. 检查预设热门游戏库
    const isValidKey = (k?: string) => Boolean(k && k.length >= 32 && !/^0+$/.test(k));

    // 元数据链路不需要头图：跳过 Store API 图片查询，避免白等 4 秒超时
    const preset = await gameService.getGameByAppId(appId, { skipRemoteHeader: true });
    if (preset) {
      gameName = preset.nameZh || preset.name || gameName;
      if (Array.isArray(preset.dlcs)) {
        dlcIds = preset.dlcs.map((d) => d.toString());
      }
      if (preset.depots) {
        for (const [dId, key] of Object.entries(preset.depots)) {
          depots.push({
            depotId: dId,
            depotKey: isValidKey(key) ? key : undefined
          });
        }
      }
    }

    // 2/3. 游戏名 + DLC 列表：优先本地持久化索引（data/dlc_index.json）
    //
    // 为什么不再无条件并行查 Steam Store API + SteamCMD API：
    // - 两者的产出（游戏名 / DLC 列表）变化极低频，属于可长期缓存的数据；
    // - Steam Store API 从服务器侧实测 30 秒完全不可达（国内网络），而它给的
    //   游戏名与 DLC 列表 SteamCMD 全都有；
    // - 被 Promise.allSettled 包着 = 等最慢的那个 → 每次首访白等 Store 的 4 秒超时，
    //   这是「首次 8 秒」的主因。
    //
    // 现在的分层：
    //   索引命中且非锁定模式 → 零上游请求，毫秒级返回
    //   索引未命中          → 只查 SteamCMD（实测 0.3~1.6 秒），结果落盘
    //   SteamCMD 失败       → 才用 Store API 兜底（唯一保留它的地方）
    //
    // 锁定版本（needGid）必须实时查 SteamCMD：清单 GID 随官方更新变化，不入索引。
    // 索引总是读取：DLC 列表与 DLC→分包关联是稳定数据，锁定模式下也照样能用，
    // 只是锁定模式仍必须查上游拿实时 GID
    const indexEntry = dlcIndexService.get(appId);
    if (indexEntry) {
      if (!gameName && indexEntry.name) gameName = indexEntry.name;
      if (indexEntry.dlcIds.length > 0) {
        dlcIds = Array.from(new Set([...dlcIds, ...indexEntry.dlcIds]));
      }
      for (const [dlcAppId, depotIds] of Object.entries(indexEntry.dlcDepots)) {
        if (dlcAppId === sAppId) continue;
        if (!dlcDepotMap.has(dlcAppId)) dlcDepotMap.set(dlcAppId, new Set());
        for (const dId of depotIds) dlcDepotMap.get(dlcAppId)!.add(dId);
      }
      // 回填权威分包清单：缺了它，命中索引时只能靠 depotService 的
      // 「appId + 0..100」启发式扫描，返回的分包集合会与首次请求不一致
      const known = new Set(depots.map((d) => d.depotId));
      for (const d of indexEntry.depots) {
        if (known.has(d.depotId)) continue;
        depots.push({ depotId: d.depotId, depotKey: d.depotKey });
        known.add(d.depotId);
      }
    }

    // 索引命中且非锁定模式：上游全部跳过（零网络请求）。
    // 锁定模式必须查上游：清单 GID 随官方更新变化，索引里刻意不存它。
    const skipUpstream = !!indexEntry && !needGid;

    if (!skipUpstream) {
      // SteamCMD：一次请求同时给出游戏名、listofdlc、分包与 GID
      let appRaw: any = null;
      try {
        const cmdResp = await axios.get(`https://api.steamcmd.net/v1/info/${sAppId}`, {
          httpsAgent,
          timeout: 5000,
          headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster-Server/1.0' }
        });
        appRaw = cmdResp.data?.data?.[sAppId] || null;
      } catch {}

      // SteamCMD 完全失败时才动用 Store API 兜底（它只提供名称与 DLC，没有分包/GID）
      if (!appRaw) {
        try {
          const storeResp = await axios.get('https://store.steampowered.com/api/appdetails', {
            params: { appids: sAppId, l: 'zh-CN', cc: 'CN' },
            httpsAgent,
            timeout: 2500,
            headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster-Server/1.0' }
          });
          const sData = storeResp.data?.[sAppId];
          if (sData && sData.success && sData.data) {
            if (!gameName && sData.data.name) gameName = sData.data.name;
            if (Array.isArray(sData.data.dlc)) {
              const dlcs = sData.data.dlc.map((d: any) => d.toString());
              dlcIds = Array.from(new Set([...dlcIds, ...dlcs]));
            }
          }
        } catch {}
      }

      try {
        // 补全游戏名称（本地全量库已有名称时无需覆盖）
        if (!gameName && appRaw?.common?.name) {
          gameName = appRaw.common.name;
        }

        // 从 SteamCMD extended.listofdlc 提取官方全部 DLC 列表
        const listofdlc = appRaw?.extended?.listofdlc;
        if (typeof listofdlc === 'string' && listofdlc.trim()) {
          const parts = listofdlc
            .split(',')
            .map((s: string) => s.trim())
            .filter((s: string) => /^\d+$/.test(s) && s !== sAppId);
          dlcIds = Array.from(new Set([...dlcIds, ...parts]));
        }

        const depotsData = appRaw?.depots;
        if (depotsData && typeof depotsData === 'object') {
          const skipPatterns = ['config', 'sharedinstall', 'shareddepot', 'redist'];
          for (const [dId, info] of Object.entries(depotsData)) {
            if (!info || typeof info !== 'object') continue;
            // 严格校验分包 ID 必须为纯数字，过滤 branches/workshopdepot 等非分包元字段
            if (!/^\d+$/.test(dId)) continue;

            // 从分包元数据中的 dlcappid 提取关联 DLC（权威关联，用于填充 dlcDepots）
            const associatedDlc =
              (info as any).dlcappid && /^\d+$/.test(String((info as any).dlcappid))
                ? String((info as any).dlcappid)
                : null;
            if (associatedDlc && associatedDlc !== sAppId && !dlcIds.includes(associatedDlc)) {
              dlcIds.push(associatedDlc);
            }

            // 过滤非内容分包：共享再发行组件（DirectX / VC++ 等）、0 字节虚拟占位分包
            if ((info as any).sharedinstall === '1' || (info as any).depotfromapp) continue;
            const pubManifest = (info as any).manifests?.public;
            if (pubManifest && pubManifest.download === '0' && pubManifest.size === '0') continue;

            const name = ((info as any).name || '').toString().toLowerCase();
            if (skipPatterns.some((p) => name.includes(p))) continue;

            let manifestGid = '';
            if ((info as any).manifests && typeof (info as any).manifests === 'object') {
              // SteamCMD 返回的分支顺序不固定，优先取 public 分支真实构建 GID
              const branchEntries = Object.entries((info as any).manifests) as Array<[string, any]>;
              const chosen = branchEntries.find(([b, v]) => b === 'public' && v && v.gid) || branchEntries.find(([, v]) => v && v.gid);
              if (chosen && chosen[1].gid) {
                manifestGid = chosen[1].gid.toString();
              }
            }

            let depotKey = '';
            for (const k of ['decryption_key', 'depot_key', 'depotkey', 'key']) {
              if ((info as any)[k] && typeof (info as any)[k] === 'string' && isValidKey((info as any)[k])) {
                depotKey = (info as any)[k];
                break;
              }
            }

            const existing = depots.find((d) => d.depotId === dId);
            if (existing) {
              if (manifestGid && !existing.manifestGid) existing.manifestGid = manifestGid;
              if (depotKey && (!existing.depotKey || !isValidKey(existing.depotKey))) existing.depotKey = depotKey;
            } else {
              depots.push({ depotId: dId, manifestGid, depotKey: depotKey || undefined });
            }
            // 记录权威 DLC→分包关联（仅记入实际保留的内容分包）
            if (associatedDlc && associatedDlc !== sAppId) {
              if (!dlcDepotMap.has(associatedDlc)) dlcDepotMap.set(associatedDlc, new Set());
              dlcDepotMap.get(associatedDlc)!.add(dId);
            }
          }
        }
      } catch {}

      // 把本次从 SteamCMD 拿到的「稳定数据」落盘，下次同 AppID 即可零上游返回。
      //
      // 关键守卫 `if (appRaw)`：SteamCMD 超时/失败时 appRaw 为 null，此时
      // dlcIds 与 dlcDepotMap 都是残缺的（只剩本地密钥库启发式扫出的几个分包）。
      // 若照写不误，这份残缺数据会被永久固化 —— 此后每次命中索引都拿不到 DLC，
      // 而索引命中又会跳过上游，形成「再也修不回来」的死循环。
      // 不写索引的代价只是下次重查上游，可接受。
      if (appRaw) {
        try {
          const dlcDepotRecord: Record<string, string[]> = {};
          for (const [dlcAppId, set] of dlcDepotMap) {
            if (dlcAppId === sAppId || set.size === 0) continue;
            dlcDepotRecord[dlcAppId] = Array.from(set);
          }
          dlcIndexService.set(appId, {
            name: gameName || undefined,
            dlcIds: dlcIds.filter((d) => d !== sAppId),
            dlcDepots: dlcDepotRecord,
            // 只存 depotId 与密钥：manifestGid 随官方更新变化，绝不入索引
            depots: depots.map((d) => ({ depotId: d.depotId, depotKey: d.depotKey }))
          });
        } catch (e) {
          console.warn(`[MetadataController] 写入 DLC 索引失败 (${appId}):`, (e as Error).message);
        }
      } else {
        console.warn(`[MetadataController] SteamCMD 未返回数据 (${appId})，跳过索引写入以免固化残缺结果`);
      }
    }

    // 4. 后端内存密钥库高精度匹配（28.8万/30万条 DepotKeys - 核心旧源）
    const matchedKeys = await depotService.getDepotsForGame(
      appId,
      dlcIds.map((d) => parseInt(d, 10)).filter((n) => !isNaN(n)),
      { skipRemoteHeader: true }
    );

    // 为已识别分包注入有效密钥，并补入 30w 密钥库命中的其他关联有效分包（杜绝无许可）
    for (const d of depots) {
      if ((!d.depotKey || !isValidKey(d.depotKey)) && matchedKeys[d.depotId]) {
        d.depotKey = matchedKeys[d.depotId];
      }
    }
    for (const [dId, key] of Object.entries(matchedKeys)) {
      if (!isValidKey(key)) continue;
      if (!depots.some((d) => d.depotId === dId)) {
        depots.push({ depotId: dId, depotKey: key });
      }
    }

    // 4.5 社区实体清单库并发竞速对齐（ManifestHub3 镜像 + SteamML R2 并发并行提取）：
    // 关键原理：优先采用社区归档的清单 GID，保障物理清单下载成功率与密钥完整性
    //
    // 仅在「锁定版本」（needGid=true）时执行：该模式要钉死 GID 并从 depotcache
    // 载入实体清单，社区归档的 GID 才对应得上镜像里的文件。
    // 「跟随官方最新」模式下清单由 Steam 动态获取，这两轮纯 GID 的上游探测
    // （合计 2.5~4 秒）纯属浪费 —— 跳过它，密钥仍由本地 28.8 万条库与 SteamCMD
    // 完整提供。代码完整保留在 needGid 分支内（封存而非删除），
    // 点一下「锁定版本」即回到旧版完整行为。
    let hub3Data: ManifestHub3Data | null = null;
    if (needGid) try {
      const [hub3Res, multiRes] = await Promise.allSettled([
        fetchManifestHub3(appId),
        manifestService.extractParsedDataFromMultiSources(appId)
      ]);
      const hData = hub3Res.status === 'fulfilled' ? hub3Res.value : null;
      const mData = multiRes.status === 'fulfilled' ? multiRes.value : null;

      if (hData && hData.depotKeys && hData.depotKeys.size > 0) {
        hub3Data = hData;
        if (mData) {
          // 深度智能合并：补充分包密钥（只补缺），GID 按 buildid 择优而非无条件覆盖。
          // 无条件覆盖会让过期/错误的 GID 顶掉原本正确的结果；而"谁先回应用谁"
          // 又会让旧源抢答。只有能证明更新（buildid 更大）时才替换。
          for (const [dId, key] of mData.depotKeys) {
            if (!hub3Data.depotKeys.has(dId)) hub3Data.depotKeys.set(dId, key);
          }
          for (const [dId, gid] of mData.manifestGids) {
            if (pickNewerGid(hub3Data.manifestGids.get(dId), gid, hub3Data.buildId, mData.buildId)) {
              hub3Data.manifestGids.set(dId, gid);
            }
          }
          if (Array.isArray(mData.dlcIds)) {
            hub3Data.dlcIds = Array.from(new Set([...hub3Data.dlcIds, ...mData.dlcIds]));
          }
        }
      } else if (mData) {
        hub3Data = mData;
      }
    } catch (err: any) {
      console.warn(`[MetadataController] 并发多源清单库检索异常 (${appId}):`, err.message);
    }
    if (hub3Data) {
      if (Array.isArray(hub3Data.dlcIds) && hub3Data.dlcIds.length > 0) {
        dlcIds = Array.from(new Set([...dlcIds, ...hub3Data.dlcIds]));
      }
      const knownDepots = new Set(depots.map((d) => d.depotId));
      for (const d of depots) {
        if (!isValidKey(d.depotKey) && hub3Data.depotKeys.has(d.depotId)) {
          d.depotKey = hub3Data.depotKeys.get(d.depotId);
        }
        // 优先使用社区具备实体文件的清单 GID
        if (hub3Data.manifestGids.has(d.depotId)) {
          d.manifestGid = hub3Data.manifestGids.get(d.depotId);
        }
      }
      // 本地数据完全没有的分包一并补入
      for (const [dId, key] of hub3Data.depotKeys) {
        if (knownDepots.has(dId)) continue;
        const gid = hub3Data.manifestGids.get(dId);
        depots.push({ depotId: dId, depotKey: key, manifestGid: gid });
        knownDepots.add(dId);
      }
    }

    // 铁律防御：分包必须具备有效解密密钥（非全0、长度>=32），防止 Steam 尝试解密无密钥分包报“内容仍然处于加密状态”
    // 注意：绝不因为暂无清单 GID 过滤分包，所有拥有密钥的分包必须 100% 注入 Steam，彻底绝迹“无许可”！
    depots = depots.filter((d) => isValidKey(d.depotKey));

    // 5. 获取 PICS Access Token 与主游戏本体 Key
    const appLevelKey =
      matchedKeys[sAppId] || depotService.getDepotKey(sAppId) || hub3Data?.depotKeys.get(sAppId) || undefined;
    const accessToken = tokenService.getTokenByAppId(sAppId) || hub3Data?.accessToken || undefined;

    // 严密防线：若云端既无任何有效分包密钥、也无本体密钥，且无可用元数据，才响应「暂时没有这款游戏」
    if (depots.length === 0 && !isValidKey(appLevelKey)) {
      return res.status(200).json({
        success: false,
        message: `暂时没有这款游戏（云端暂未收录 AppID ${sAppId} 的解密密钥数据）`,
        data: null
      });
    }

    // 6. 物理清单可用性非破坏性轻量探针（Pre-flight Probe，纯本地文件检查）
    const manifestInfo = computeManifestInfo(appId, depots, !needGid);

    // 由权威 dlcappid 关联生成 dlcDepots（此时分包密钥/GID 已全部补全）
    for (const [dlcAppId, depotIdSet] of dlcDepotMap) {
      for (const depotId of depotIdSet) {
        const d = depots.find((x) => x.depotId === depotId);
        if (d) {
          dlcDepots.push({
            dlcAppId,
            depot: { depotId: d.depotId, depotKey: d.depotKey, manifestGid: d.manifestGid }
          });
        }
      }
    }

    // 7. 异步后台触发清单本地沉淀（非阻塞），确保后续秒级响应。
    // 默认模式没有社区对齐 GID，此循环自然空转，不会产生任何网络请求。
    for (const d of depots) {
      if (d.manifestGid && /^\d+$/.test(d.manifestGid) && d.manifestGid !== '0') {
        manifestService.ensureManifestCached(d.depotId, d.manifestGid, appId).catch(() => {});
      }
    }

    // 8. 写入响应缓存（10 分钟 TTL）
    writeMetadataCache({
      appId,
      name: gameName || `AppID ${sAppId}`,
      depots,
      dlcIds,
      dlcDepots,
      appLevelKey,
      accessToken,
      withGid: needGid,
      fetchedAt: Date.now()
    });

    return res.json({
      success: true,
      data: {
        appId, // 统一 number 类型
        name: gameName || `AppID ${sAppId}`,
        depots,
        dlcIds,
        dlcDepots,
        appLevelKey,
        accessToken,
        manifestInfo
      }
    });
  } catch (e: any) {
    console.error('[MetadataController] 获取游戏元数据异常:', e);
    return res.status(500).json({ success: false, message: '获取元数据失败，请稍后重试' });

  }
};

// ==================== 管理员：索引维护接口 ====================

/**
 * 重新采集指定 AppID 的元数据索引。
 *
 * 用途：某次采集恰好碰上 SteamCMD 抖动（超时或只回部分字段），索引里
 * 存下的 DLC 列表会不完整。删除该条目后，下次客户端查询会重新走上游，
 * 并把结果重新落盘 —— 这是索引唯一的修复出口（否则只能清空整个文件）。
 *
 * 同时清除 10 分钟响应缓存：只删索引不清内存缓存的话，请求仍会命中旧结果。
 */
export const refreshAppMetadataIndexAdmin = (req: Request, res: Response) => {
  try {
    const raw = Array.isArray(req.params.appId) ? req.params.appId[0] : req.params.appId;
    const appId = parseInt(String(raw), 10);
    if (isNaN(appId) || appId <= 0) {
      return res.status(400).json({ success: false, message: '无效的 AppID' });
    }

    const indexCleared = dlcIndexService.delete(appId);
    const cacheCleared = clearMetadataCache(appId);

    return res.json({
      success: true,
      message:
        indexCleared || cacheCleared
          ? `已清除 AppID ${appId} 的索引与响应缓存，下次查询将重新采集`
          : `AppID ${appId} 原本无索引与缓存记录，下次查询即会采集`,
      data: { appId, indexCleared, cacheCleared }
    });
  } catch (e: any) {
    console.error('[MetadataController] 清除索引异常:', e);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

/**
 * 查看索引概览（条目总数 / 指定 AppID 的明细），便于排障。
 * 带 ?appId=xxx 返回该应用明细，不带则只返回总数。
 */
export const getMetadataIndexAdmin = (req: Request, res: Response) => {
  try {
    const raw = Array.isArray(req.query.appId) ? req.query.appId[0] : req.query.appId;
    if (raw !== undefined && String(raw).trim() !== '') {
      const appId = parseInt(String(raw), 10);
      if (isNaN(appId)) {
        return res.status(400).json({ success: false, message: '无效的 AppID' });
      }
      const entry = dlcIndexService.get(appId);
      return res.json({
        success: true,
        data: {
          appId,
          indexed: !!entry,
          entry: entry || null,
          cachedInMemory: !!readMetadataCache(appId, false)
        }
      });
    }
    return res.json({
      success: true,
      data: { totalEntries: dlcIndexService.size() }
    });
  } catch (e: any) {
    console.error('[MetadataController] 查询索引异常:', e);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};
