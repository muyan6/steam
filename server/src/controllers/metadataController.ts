import { Request, Response } from 'express';
import axios from 'axios';
import https from 'https';
import { gameService } from '../services/gameService.js';
import { depotService } from '../services/depotService.js';
import { tokenService } from '../services/tokenService.js';
import { manifestService } from '../services/manifestService.js';

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
}

const manifestHub3Cache = new Map<number, { data: ManifestHub3Data | null; fetchedAt: number }>();
const MANIFEST_HUB3_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时内存缓存，避免逐请求拉取
// 同一 AppID 的在途请求去重：并发请求共享同一次上游拉取
const manifestHub3InFlight = new Map<number, Promise<ManifestHub3Data | null>>();
// 缓存条目硬上限，超限时先清过期再淘汰最旧，防止被脚本灌海量 AppID 撑爆内存
const MANIFEST_HUB3_CACHE_MAX = 500;

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
  return { depotKeys, manifestGids, dlcIds };
}

async function fetchManifestHub3(appId: number): Promise<ManifestHub3Data | null> {
  const now = Date.now();
  const cached = manifestHub3Cache.get(appId);
  if (cached && now - cached.fetchedAt < MANIFEST_HUB3_TTL_MS) {
    return cached.data;
  }

  // 在途请求去重：同一 AppID 的并发请求共享同一次上游拉取
  const pending = manifestHub3InFlight.get(appId);
  if (pending) {
    return pending;
  }

  const task = (async (): Promise<ManifestHub3Data | null> => {
    // 采用国内响应最快且稳定的两大镜像：ghfast.top 与 gh-proxy.com，并发竞速探测
    const fastBases = [
      'https://ghfast.top/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://gh-proxy.com/https://raw.githubusercontent.com/steamtools-games/ManifestHub3'
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
    return data;
  })();

  manifestHub3InFlight.set(appId, task);
  try {
    return await task;
  } finally {
    manifestHub3InFlight.delete(appId);
  }
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

    let gameName = hintName;
    let dlcIds: string[] = [];
    let depots: Array<{ depotId: string; depotKey?: string; manifestGid?: string; size?: number }> = [];
    let dlcDepots: Array<{ dlcAppId: string; depot: { depotId: string; depotKey?: string; manifestGid?: string } }> = [];
    // SteamCMD 分包元数据的 dlcappid 是权威的「DLC → 分包」关联，
    // 先记录映射，待分包密钥/GID 全部补全后再生成 dlcDepots
    const dlcDepotMap = new Map<string, Set<string>>();

    // 1. 检查预设热门游戏库
    const isValidKey = (k?: string) => Boolean(k && k.length >= 32 && !/^0+$/.test(k));

    const preset = await gameService.getGameByAppId(appId);
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

    // 2/3. Steam Store API 与 SteamCMD API 相互独立（一个补名称/DLC，一个补分包/GID），
    // 并行发起以减半上游等待延迟；任一失败静默降级，不影响另一个的结果
    const needStoreInfo = !gameName || dlcIds.length === 0 || depots.length === 0;
    const storeRequest = needStoreInfo
      ? axios.get('https://store.steampowered.com/api/appdetails', {
          params: { appids: sAppId, l: 'zh-CN', cc: 'CN' },
          httpsAgent,
          timeout: 4000,
          headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster-Server/1.0' }
        })
      : Promise.resolve(null as any);
    const cmdRequest = axios.get(`https://api.steamcmd.net/v1/info/${sAppId}`, {
      httpsAgent,
      timeout: 5000,
      headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster-Server/1.0' }
    });
    const [storeSettled, cmdSettled] = await Promise.allSettled([storeRequest, cmdRequest]);

    // 处理 Store API 结果：补全游戏名与 DLC 列表
    if (storeSettled.status === 'fulfilled' && storeSettled.value) {
      try {
        const storeResp = storeSettled.value;
        if (storeResp.data && storeResp.data[sAppId] && storeResp.data[sAppId].success) {
          const sData = storeResp.data[sAppId].data;
          if (!gameName && sData.name) {
            gameName = sData.name;
          }
          if (Array.isArray(sData.dlc)) {
            const dlcs = sData.dlc.map((d: any) => d.toString());
            dlcIds = Array.from(new Set([...dlcIds, ...dlcs]));
          }
        }
      } catch {}
    }

    // 处理 SteamCMD 结果：补全精确的分包与 Manifest GID，并强力兜底游戏名称与 DLC 列表
    if (cmdSettled.status === 'fulfilled') {
      try {
        const cmdResp = cmdSettled.value;
        const appRaw = cmdResp.data?.data?.[sAppId];

        // 补全游戏名称（Store API 超时或网络失败时由 SteamCMD 兜底）
        if (!gameName && appRaw?.common?.name) {
          gameName = appRaw.common.name;
        }

        // 从 SteamCMD extended.listofdlc 提取官方全部 DLC 列表（彻底解决商店 API 超时导致的 DLC 漏发）
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
    }

    // 4. 后端内存密钥库高精度匹配（28.8万/30万条 DepotKeys - 核心旧源）
    const matchedKeys = await depotService.getDepotsForGame(
      appId,
      dlcIds.map((d) => parseInt(d, 10)).filter((n) => !isNaN(n))
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
    let hub3Data: ManifestHub3Data | null = null;
    try {
      const [hub3Res, multiRes] = await Promise.allSettled([
        fetchManifestHub3(appId),
        manifestService.extractParsedDataFromMultiSources(appId)
      ]);
      const hData = hub3Res.status === 'fulfilled' ? hub3Res.value : null;
      const mData = multiRes.status === 'fulfilled' ? multiRes.value : null;

      if (hData && hData.depotKeys && hData.depotKeys.size > 0) {
        hub3Data = hData;
        if (mData) {
          // 深度智能合并：补充 SteamML 中更多可用的 DLC 与最新分包密钥
          for (const [dId, key] of mData.depotKeys) {
            if (!hub3Data.depotKeys.has(dId)) hub3Data.depotKeys.set(dId, key);
          }
          for (const [dId, gid] of mData.manifestGids) {
            if (!hub3Data.manifestGids.has(dId)) hub3Data.manifestGids.set(dId, gid);
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

    // 6. 物理清单可用性非破坏性轻量探针（Pre-flight Probe）
    let readyManifestCount = 0;
    for (const d of depots) {
      if (d.manifestGid && /^\d+$/.test(d.manifestGid) && d.manifestGid !== '0') {
        const localPath = manifestService.getLocalManifestFilePath(d.depotId, d.manifestGid, appId);
        if (localPath) {
          readyManifestCount++;
        }
      }
    }

    const hasGidCount = depots.filter((d) => d.manifestGid && /^\d+$/.test(d.manifestGid) && d.manifestGid !== '0').length;
    const manifestStatus: 'ready' | 'dynamic' | 'missing' =
      readyManifestCount > 0 && readyManifestCount >= depots.length
        ? 'ready'
        : hasGidCount > 0
        ? 'dynamic'
        : 'missing';

    const manifestInfo = {
      status: manifestStatus,
      hasPhysicalManifest: readyManifestCount > 0,
      readyCount: readyManifestCount,
      totalCount: depots.length
    };

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

    // 7. 异步后台触发清单本地沉淀（非阻塞），确保后续秒级响应
    for (const d of depots) {
      if (d.manifestGid && /^\d+$/.test(d.manifestGid) && d.manifestGid !== '0') {
        manifestService.ensureManifestCached(d.depotId, d.manifestGid, appId).catch(() => {});
      }
    }

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
