import { Request, Response } from 'express';
import axios from 'axios';
import https from 'https';
import { gameService } from '../services/gameService.js';
import { depotService } from '../services/depotService.js';
import { tokenService } from '../services/tokenService.js';
import { manifestService } from '../services/manifestService.js';
import { dlcIndexService } from '../services/dlcIndexService.js';
import { parseLuaManifestText } from '../utils/luaManifestParser.js';

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
// 负结果（上游暂时失败）短 TTL：避免把一次抖动固化成 6 小时空窗
const manifestHub3Negative = new Map<number, number>();
const MANIFEST_HUB3_NEGATIVE_TTL_MS = 60 * 1000;
// 同一 AppID 的在途请求去重：并发请求共享同一次上游拉取
const manifestHub3InFlight = new Map<number, Promise<ManifestHub3Data | null>>();
// 缓存条目硬上限，超限时先清过期再淘汰最旧，防止被脚本灌海量 AppID 撑爆内存
const MANIFEST_HUB3_CACHE_MAX = 500;

/**
 * 并发竞速下载（JSON）：首个通过校验的响应胜出，并取消其余在途请求。
 * 裸 Promise.any 不会取消失败者，多镜像竞速会留下多个连接空跑。
 */
async function raceJsonDownload(
  urls: string[],
  accept: (data: any) => boolean
): Promise<any | null> {
  const controller = new AbortController();
  const tasks = urls.map(async (url) => {
    const resp = await axios.get(url, { httpsAgent, timeout: 2500, signal: controller.signal });
    if (accept(resp.data)) return resp.data;
    throw new Error('Not valid json');
  });
  try {
    return await Promise.any(tasks);
  } catch {
    return null;
  } finally {
    controller.abort();
  }
}

/** 并发竞速下载（文本），语义同上 */
async function raceTextDownload(
  urls: string[],
  accept: (text: any) => boolean
): Promise<string | null> {
  const controller = new AbortController();
  const tasks = urls.map(async (url) => {
    const resp = await axios.get(url, { httpsAgent, timeout: 2500, signal: controller.signal });
    const text = typeof resp.data === 'string' ? resp.data : '';
    if (accept(text)) return text;
    throw new Error('Not valid text');
  });
  try {
    return await Promise.any(tasks);
  } catch {
    return null;
  } finally {
    controller.abort();
  }
}

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

/**
 * ManifestHub3 Lua 解析。
 *
 * 复用 utils/luaManifestParser 的单一实现：原先是本文件内联的第四份 Lua 解析
 * 副本，且正则与 manifestService 里的三份不一致（setManifestid 一处要求
 * GID ≥5 位、其余只排除 "0"），导致同一份上游 Lua 在不同链路下被判为有效/无效。
 */
function parseManifestHub3Lua(lua: string, targetAppId?: number): ManifestHub3Data {
  const parsed = parseLuaManifestText(lua, targetAppId);
  return {
    depotKeys: parsed.depotKeys,
    manifestGids: parsed.manifestGids,
    dlcIds: parsed.dlcIds,
    accessToken: parsed.accessToken
  };
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
    // 负缓存条目按短 TTL 处理，过期即视为未命中并重试上游
    if (cached.data === null) {
      const negTs = manifestHub3Negative.get(appId);
      if (negTs && now - negTs < MANIFEST_HUB3_NEGATIVE_TTL_MS) return null;
    } else {
      // 返回副本：调用方会就地合并其他源的数据，直接交出缓存本体将造成缓存污染
      return cloneHub3Data(cached.data);
    }
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

    // 1. 并发探测 {appId}.json（首个成功即取消其余请求，避免失败者继续跑完）
    const jsonData = await raceJsonDownload(
      fastBases.map((base) => `${base}/${appId}/${appId}.json`),
      (d) => !!d && typeof d === 'object' && !!d.depot && typeof d.depot === 'object'
    );
    if (jsonData) {
      data = parseManifestHub3Json(jsonData, appId);
    }

    // 2. 若 json 未命中，并发探测 {appId}.lua 与 {appId}_public.lua
    if (!data) {
      const luaUrls: string[] = [];
      for (const base of fastBases) {
        luaUrls.push(`${base}/${appId}/${appId}.lua`);
        luaUrls.push(`${base}/${appId}/${appId}_public.lua`);
      }
      const luaText = await raceTextDownload(
        luaUrls,
        (t) => typeof t === 'string' && (t.includes('addappid') || t.includes('setManifestid'))
      );
      if (luaText) {
        data = parseManifestHub3Lua(luaText, appId);
      }
    }

    // 空结果（上游抖动/超时）绝不按 6 小时缓存：
    // 原实现把 data=null 也写入 6 小时 TTL，一次网络抖动就让该 AppID
    // 在半天内始终拿不到社区 GID。改为短负缓存，让下一次请求有机会重试。
    if (!data) {
      if (manifestHub3Negative.size >= MANIFEST_HUB3_CACHE_MAX) {
        const ts0 = Date.now();
        for (const [k, t] of manifestHub3Negative) {
          if (ts0 - t >= MANIFEST_HUB3_NEGATIVE_TTL_MS) manifestHub3Negative.delete(k);
        }
        while (manifestHub3Negative.size >= MANIFEST_HUB3_CACHE_MAX) {
          const oldestNeg = manifestHub3Negative.keys().next().value;
          if (oldestNeg === undefined) break;
          manifestHub3Negative.delete(oldestNeg);
        }
      }
      manifestHub3Negative.set(appId, Date.now());
      // 负缓存条目同样必须受容量约束：原实现的淘汰逻辑只在成功分支里，
      // 海量不存在/持续失败的 AppID 会以 {data:null} 永久堆积在这里。
      if (manifestHub3Cache.size >= MANIFEST_HUB3_CACHE_MAX) {
        const tsN = Date.now();
        for (const [k, v] of manifestHub3Cache) {
          if (tsN - v.fetchedAt >= MANIFEST_HUB3_NEGATIVE_TTL_MS) manifestHub3Cache.delete(k);
        }
        while (manifestHub3Cache.size >= MANIFEST_HUB3_CACHE_MAX) {
          const oldestNull = manifestHub3Cache.keys().next().value;
          if (oldestNull === undefined) break;
          manifestHub3Cache.delete(oldestNull);
        }
      }
      manifestHub3Cache.set(appId, { data: null, fetchedAt: Date.now() });
      return null;
    }
    manifestHub3Negative.delete(appId);

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
  depots: Array<{ depotId: string; depotKey?: string; manifestGid?: string; size?: number; keyMissing?: boolean }>;
  dlcIds: string[];
  dlcDepots: Array<{ dlcAppId: string; depot: { depotId: string; depotKey?: string; manifestGid?: string; keyMissing?: boolean } }>;
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
    // withGids=1 → 「只要 GID，不要实体清单」的轻量模式，专供客户端入库时预取
    // 清单请求码使用。它与 needGid 的关键差别是**不触发 ensureManifestCached**：
    // 我们只要 manifestGid 这个数字去换请求码，绝不把清单实体下载到服务端。
    //
    // 为什么必须有这个独立参数：默认模式命中 dlc_index 时会 skipUpstream，
    // 而索引里刻意不存 manifestGid（GID 随官方更新变化），于是响应里 GID 全为空 ——
    // 客户端的预取函数拿不到输入，静默空转。用 needGid=1 代替则会把实体清单
    // 一起拉下来（见下方第 7 步），既有磁盘代价也不是我们想要的。
    const withGids = needGid || req.query.withGids === '1' || req.query.withGids === 'true';

    // 命中缓存直接返回（manifestInfo 必须重算，depotcache 实时变化）
    const cached = readMetadataCache(appId, withGids);
    if (cached) {
      // 返回副本：缓存条目在 10 分钟 TTL 内会被反复复用，直接交出内部数组引用
      // 会让任何下游就地修改永久污染缓存（与 cloneHub3Data 的处理保持一致）
      const cachedDepots = cached.depots.map((d) => ({ ...d }));
      return res.json({
        success: true,
        data: {
          appId: cached.appId,
          name: cached.name,
          depots: cachedDepots,
          dlcIds: [...cached.dlcIds],
          dlcDepots: cached.dlcDepots.map((x) => ({ dlcAppId: x.dlcAppId, depot: { ...x.depot } })),
          appLevelKey: cached.appLevelKey,
          accessToken: cached.accessToken,
          manifestInfo: computeManifestInfo(appId, cachedDepots, !cached.withGid)
        }
      });
    }

    let gameName = hintName;
    let dlcIds: string[] = [];
    let depots: Array<{ depotId: string; depotKey?: string; manifestGid?: string; size?: number; keyMissing?: boolean }> = [];
    let dlcDepots: Array<{ dlcAppId: string; depot: { depotId: string; depotKey?: string; manifestGid?: string; keyMissing?: boolean } }> = [];
    // SteamCMD 分包元数据的 dlcappid 是权威的「DLC → 分包」关联，
    // 先记录映射，待分包密钥/GID 全部补全后再生成 dlcDepots
    const dlcDepotMap = new Map<string, Set<string>>();

    // 是否已获得**权威分包归属**（SteamCMD depots / 精修预设库 / 索引回填）。
    //
    // 这个标志决定启发式扫描的角色：
    // - true ：启发式只用于给「已列出的分包」补密钥，绝不新增 depot
    // - false：无任何权威来源，才用启发式扫描兜底补分包
    //
    // 为什么必须区分：密钥库的启发式扫描按「appId + 0..100」取邻近 ID，
    // 相邻不等于属于本作。实测 Brotato (1942280) 权威分包仅 4 个
    // （1942281/1942282/1942283/2868390），但启发式会额外捞入
    // 1942291/1942321/1942361/1942381/1942391/1942440... 等 10 个非本作 ID，
    // 表现为「同一游戏每次入库分包数在 9/11/15 之间跳动」。
    let authoritativeDepotSource = false;

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
          // 精修预设库是人工维护的权威归属
          authoritativeDepotSource = true;
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
      // 索引里的分包是首次采集时从 SteamCMD 落盘的，同样属权威归属
      if (indexEntry.depots.length > 0) authoritativeDepotSource = true;
    }

    // 索引命中且不需要 GID：上游全部跳过（零网络请求）。
    // 需要 GID（锁定版本 或 客户端预取）时必须查上游：清单 GID 随官方更新变化，
    // 索引里刻意不存它 —— 这正是客户端预取曾静默空转的原因。
    const skipUpstream = !!indexEntry && !withGids;

    if (!skipUpstream) {
      // SteamCMD：一次请求同时给出游戏名、listofdlc、分包与 GID。
      //
      // 它是**不可替代的权威源**，不能用 ManifestHub3 顶替：实测 Brotato (1942280)
      // SteamCMD 报 4 个分包（1942281/1942282/1942283/2868390），而 Hub3 只报 2 个
      // （缺 1942282、1942283），且 GID 与 Valve 当前 public 分支全部不一致（旧构建）。
      // 用 Hub3 降级会直接丢掉分包、并把版本钉死在过期快照上。
      //
      // 但 api.steamcmd.net 是社区自建裸服务器（DNS 157.180.25.24，无 Cloudflare
      // 兜底），偶发首包慢或失败。因此失败后重试一次 —— 这比降级到不完整的源
      // 安全得多：成功一次就拿到完整权威结构，失败也只是多等 400ms。
      let appRaw: any = null;
      for (let attempt = 0; attempt < 2 && !appRaw; attempt++) {
        if (attempt > 0) await new Promise((r) => setTimeout(r, 400));
        try {
          const cmdResp = await axios.get(`https://api.steamcmd.net/v1/info/${sAppId}`, {
            httpsAgent,
            timeout: 5000,
            headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster-Server/1.0' }
          });
          appRaw = cmdResp.data?.data?.[sAppId] || null;
        } catch {}
      }

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
        // 统计本段实际采纳的权威分包数：为 0 说明 SteamCMD 没给出分包归属，
        // 此时才允许启发式扫描兜底补分包
        let steamCmdDepotAccepted = 0;
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
            steamCmdDepotAccepted++;
            // 记录权威 DLC→分包关联（仅记入实际保留的内容分包）
            if (associatedDlc && associatedDlc !== sAppId) {
              if (!dlcDepotMap.has(associatedDlc)) dlcDepotMap.set(associatedDlc, new Set());
              dlcDepotMap.get(associatedDlc)!.add(dId);
            }
          }
        }
        if (steamCmdDepotAccepted > 0) authoritativeDepotSource = true;
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

    // 4.1 为已识别分包注入有效密钥（只补缺失的 key，不改分包集合）
    for (const d of depots) {
      if ((!d.depotKey || !isValidKey(d.depotKey)) && matchedKeys[d.depotId]) {
        d.depotKey = matchedKeys[d.depotId];
      }
    }

    // 4.2 仅在**无权威分包归属**时，才用启发式扫描结果补充分包。
    //
    // 有权威来源时绝不并入：启发式按 ID 邻近取值，会把 AppID 相邻的
    // 无关游戏 depot 一起带进来（Brotato 实测多出 10 个非本作 ID），
    // 表现为同一游戏每次入库分包数不一致。少挂几个无害，
    // 挂错却可能让 Steam 去下载并不属于本作的内容。
    if (!authoritativeDepotSource) {
      for (const [dId, key] of Object.entries(matchedKeys)) {
        if (!isValidKey(key)) continue;
        if (!depots.some((d) => d.depotId === dId)) {
          depots.push({ depotId: dId, depotKey: key });
        }
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

    // 铁律防御：分包必须具备有效解密密钥（非全0、长度>=32），防止 Steam 尝试解密无密钥分包报“内容仍然处于加密状态”。
    //
    // 但**不能静默删行**：原实现直接 filter 掉无密钥分包，导致同一个 AppID 的
    // depots 数量随上游抖动在 4/9/11 之间跳变，客户端与运营都无法判断是
    // “本作只有这些分包”还是“这次上游没给全”。改为保留条目并显式标记
    // keyMissing，由客户端决定是否跳过该分包。
    for (const d of depots) {
      if (!isValidKey(d.depotKey)) {
        d.depotKey = undefined;
        d.keyMissing = true;
      }
    }

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
            depot: { depotId: d.depotId, depotKey: d.depotKey, manifestGid: d.manifestGid, keyMissing: d.keyMissing }
          });
        }
      }
    }

    // 7. 【已移除】此前的 `if (needGid)` 批量实体清单沉淀循环。
    //
    // 移除理由（全仓库调用链已核实）：
    // 1. 客户端**从不发送** needGid=1。入库走的是 ost.rs → parse_metadata_with_gids
    //    → `&withGids=1`（见 manifests.rs:1034-1051 与 ost.rs:786-792 的注释），
    //    该参数的设计初衷正是「只要 GID 数字，绝不触发实体清单下载」。
    //    因此这段循环对现有客户端从不执行 —— 但它是「一旦有人发 needGid=1 就爆」
    //    的隐患：100 分包的游戏会一次性起 100 路 ensureManifestCached，
    //    每路又是最多 16 个镜像竞速 + 整包解压落盘。
    // 2. 锁定版本真正需要的实体清单，由**客户端自己**在入库时预缓存
    //    （lib.rs:275 `if lock_mode { precache_manifests }`），服务端无需代劳。
    // 3. 服务端的按需兜底路径仍然完整保留：
    //    /api/manifests/download/:depotId/:manifestId → ensureManifestCached，
    //    客户端在所有直连镜像都失败后才回退到它（manifests.rs:1380-1393），
    //    且是单文件、按需触发，不存在批量放大的问题。
    //
    // 若将来确实需要服务端预热实体清单，请新增一个**显式**的
    // `?precache=1` 开关并单独限流，不要复用 needGid —— 那个参数同时承担
    // 「走 Hub3 GID 对齐」的语义，混在一起会再次让 GID 查询顺带拉实体。

    // 8. 写入响应缓存（10 分钟 TTL）
    writeMetadataCache({
      appId,
      name: gameName || `AppID ${sAppId}`,
      depots,
      dlcIds,
      dlcDepots,
      appLevelKey,
      accessToken,
      // 用 withGids 而非 needGid 作为标记：只要本次响应里带了真实 GID，
      // 就应当能被下一次「需要 GID」的请求（含客户端预取）复用 ——
      // 否则预取每次都要重跑一遍 SteamCMD 上游，白等 0.3~1.6 秒。
      withGid: withGids,
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

/**
 * 核验客户端已有 DLC 与服务端最新 DLC 的差异，计算缺失增量
 */
export const checkDlcDiff = async (req: Request, res: Response) => {
  try {
    const raw = Array.isArray(req.params.appId) ? req.params.appId[0] : req.params.appId;
    const appId = parseInt(String(raw), 10);
    if (isNaN(appId) || appId <= 0) {
      return res.status(400).json({ success: false, message: '无效的 AppID' });
    }

    // 客户端传入的已持有 DLC 列表
    let existingDlcIds: number[] = [];
    if (Array.isArray(req.body?.existingDlcIds)) {
      existingDlcIds = req.body.existingDlcIds
        .map((x: any) => parseInt(String(x), 10))
        .filter((n: number) => !isNaN(n) && n > 0);
    } else if (typeof req.query.existingDlcIds === 'string') {
      existingDlcIds = req.query.existingDlcIds
        .split(',')
        .map((x: string) => parseInt(x.trim(), 10))
        .filter((n: number) => !isNaN(n) && n > 0);
    }

    let remoteDlcIds: number[] = [];

    // 1. 尝试从 DLC 索引服务获取已有的 DLC
    const indexed = dlcIndexService.get(appId);
    if (indexed && Array.isArray(indexed.dlcIds)) {
      for (const d of indexed.dlcIds) {
        const dId = parseInt(String(d), 10);
        if (!isNaN(dId) && dId > 0 && dId !== appId && !remoteDlcIds.includes(dId)) {
          remoteDlcIds.push(dId);
        }
      }
    }

    // 2. 如果索引为空或较少，尝试从元数据缓存获取
    const cached = readMetadataCache(appId, false);
    if (cached && Array.isArray(cached.dlcDepots)) {
      for (const dep of cached.dlcDepots) {
        const dId = parseInt(String(dep.dlcAppId), 10);
        if (!isNaN(dId) && dId > 0 && dId !== appId && !remoteDlcIds.includes(dId)) {
          remoteDlcIds.push(dId);
        }
      }
    }

    // 3. 兜底：索引/缓存给出的 DLC 明显少于元数据缓存里的权威分包关联时，从
    //    ManifestHub3 补齐。
    //
    // 原实现的条件是 `remoteDlcIds.length === 0`，与上面的注释「索引为空或较少」
    // 不符：只要索引里恰好有 1 条 DLC，就永远不会走兜底，返回残缺结果。
    // 判据改为「与已缓存元数据的 DLC 数量比对」，只有确实更少时才补。
    const cachedDlcCount = new Set(
      (cached?.dlcDepots || [])
        .map((x) => parseInt(String(x.dlcAppId), 10))
        .filter((n) => !isNaN(n) && n > 0 && n !== appId)
    ).size;
    if (remoteDlcIds.length === 0 || remoteDlcIds.length < cachedDlcCount) {
      const hubData = await fetchManifestHub3(appId);
      if (hubData && hubData.dlcIds) {
        for (const idStr of hubData.dlcIds) {
          const dId = parseInt(idStr, 10);
          if (!isNaN(dId) && dId > 0 && dId !== appId && !remoteDlcIds.includes(dId)) {
            remoteDlcIds.push(dId);
          }
        }
      }
    }

    const existingSet = new Set(existingDlcIds);
    const missingDlcIds = remoteDlcIds.filter((id) => !existingSet.has(id));

    return res.json({
      success: true,
      data: {
        appId,
        totalRemoteDlcs: remoteDlcIds.length,
        existingCount: existingDlcIds.length,
        missingDlcIds,
        missingCount: missingDlcIds.length
      }
    });
  } catch (e: any) {
    console.error('[MetadataController] 比对 DLC 差异异常:', e);
    return res.status(500).json({ success: false, message: '服务器比对 DLC 差异异常' });
  }
};

