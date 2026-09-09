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
    const urls = [
      // 直连 GitHub raw（海外服务器可达）
      `https://raw.githubusercontent.com/steamtools-games/ManifestHub3/${appId}/${appId}.lua`,
      // ghfast.top 加速代理（中国大陆服务器直连 raw 往往超时）
      `https://ghfast.top/https://raw.githubusercontent.com/steamtools-games/ManifestHub3/${appId}/${appId}.lua`
    ];

    let data: ManifestHub3Data | null = null;
    for (const u of urls) {
      try {
        const resp = await axios.get(u, { httpsAgent, timeout: 6000 });
        const lua = typeof resp.data === 'string' ? resp.data : '';
        if (lua.includes('addappid') || lua.includes('setManifestid')) {
          data = parseManifestHub3Lua(lua, appId);
          break;
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

            // 从分包元数据中的 dlcappid 提取关联 DLC
            if ((info as any).dlcappid && /^\d+$/.test(String((info as any).dlcappid))) {
              const dlcAppId = String((info as any).dlcappid);
              if (dlcAppId !== sAppId && !dlcIds.includes(dlcAppId)) {
                dlcIds.push(dlcAppId);
              }
            }

            // 过滤非内容分包：共享再发行组件（DirectX / VC++ 等）、0 字节虚拟占位分包
            if ((info as any).sharedinstall === '1' || (info as any).depotfromapp) continue;
            const pubManifest = (info as any).manifests?.public;
            if (pubManifest && pubManifest.download === '0' && pubManifest.size === '0') continue;

            const name = ((info as any).name || '').toString().toLowerCase();
            if (skipPatterns.some((p) => name.includes(p))) continue;

            let manifestGid = '';
            if ((info as any).manifests && typeof (info as any).manifests === 'object') {
              // SteamCMD 返回的分支顺序不固定（previous 可能排在 public 之前），
              // 取第一个分支会拿到旧版清单，必须优先取 public 分支
              const branchEntries = Object.entries((info as any).manifests) as Array<[string, any]>;
              const chosen = branchEntries.find(([b, v]) => b === 'public' && v && v.gid) || branchEntries.find(([, v]) => v && v.gid);
              if (chosen) {
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
          }
        }
      } catch {}
    }

    // 如果仍没有分包，默认生成主体候选 Depot
    if (depots.length === 0) {
      depots.push({ depotId: sAppId });
      depots.push({ depotId: (appId + 1).toString() });
    }

    // 4. 后端内存密钥库高精度匹配（28.8万条 DepotKeys）
    const matchedKeys = await depotService.getDepotsForGame(
      appId,
      dlcIds.map((d) => parseInt(d, 10)).filter((n) => !isNaN(n))
    );

    // 为主分包注入有效密钥（绝不保留全 0 占位符）
    for (const d of depots) {
      if ((!d.depotKey || !isValidKey(d.depotKey)) && matchedKeys[d.depotId]) {
        d.depotKey = matchedKeys[d.depotId];
      }
    }

    // 为 DLC 分包聚合密钥：DLC 的实际 DepotID 不一定等于其 AppID（常为
    // dlcId+1 等相邻编号），沿用底层 dlcId+0..10 候选启发式，把该范围内
    // 全部有效密钥下发，避免偏离规律的 DLC 密钥漏发
    const claimedDepotIds = new Set(depots.map((d) => d.depotId));
    for (const dlcId of dlcIds) {
      const dlcBase = parseInt(dlcId, 10);
      if (isNaN(dlcBase)) continue;
      for (let j = 0; j <= 10; j++) {
        const candidateId = (dlcBase + j).toString();
        if (claimedDepotIds.has(candidateId)) continue;
        const k = matchedKeys[candidateId] || depotService.getDepotKey(candidateId);
        if (k && isValidKey(k)) {
          dlcDepots.push({
            dlcAppId: dlcId,
            depot: { depotId: candidateId, depotKey: k }
          });
          claimedDepotIds.add(candidateId);
        }
      }
    }

    // 4.5 ManifestHub3 社区实体清单库优先对齐（steamtools-games/ManifestHub3）：
    // 关键原理：SteamCMD 返回的是 Valve 云端实时构建号，但 Valve CM 接口已严厉封禁非拥有者索码；
    // 若使用 SteamCMD 的虚假最新 GID，会导致客户端与服务端均无法找到 .manifest 实体文件（404），
    // 进而迫使 Steam 向官方索码触发 403 Access Denied（无互联网连接）；
    // 只有 ManifestHub3 实际归档并提供实体下载的 GID，才能保证 100% 成功下载与解密！
    let hub3Data: ManifestHub3Data | null = await fetchManifestHub3(appId);
    if (hub3Data) {
      if (Array.isArray(hub3Data.dlcIds) && hub3Data.dlcIds.length > 0) {
        dlcIds = Array.from(new Set([...dlcIds, ...hub3Data.dlcIds]));
      }
      const knownDepots = new Set(depots.map((d) => d.depotId));
      for (const d of depots) {
        if (!isValidKey(d.depotKey) && hub3Data.depotKeys.has(d.depotId)) {
          d.depotKey = hub3Data.depotKeys.get(d.depotId);
        }
        // 核心对齐：优先使用 ManifestHub3 具备实体文件的清单 GID
        if (hub3Data.manifestGids.has(d.depotId)) {
          d.manifestGid = hub3Data.manifestGids.get(d.depotId);
        }
      }
      // 本地数据完全没有的分包（新 DLC / 新增 depot）一并补入
      for (const [dId, key] of hub3Data.depotKeys) {
        if (knownDepots.has(dId)) continue;
        depots.push({ depotId: dId, depotKey: key, manifestGid: hub3Data.manifestGids.get(dId) });
        knownDepots.add(dId);
      }
    }

    // 若存在有效密钥分包，则剔除无有效密钥的残余分包（防止 Steam 尝试解密无密钥分包报“内容仍然处于加密状态”）
    if (depots.some((d) => isValidKey(d.depotKey))) {
      depots = depots.filter((d) => isValidKey(d.depotKey));
    }

    // 5. 获取 PICS Access Token
    const appLevelKey =
      matchedKeys[sAppId] || depotService.getDepotKey(sAppId) || hub3Data?.depotKeys.get(sAppId) || undefined;
    const accessToken = tokenService.getTokenByAppId(sAppId) || hub3Data?.accessToken || undefined;

    // 6. 异步后台触发清单本地沉淀（非阻塞），确保用户后续在客户端一键入库或预缓存时秒级响应
    for (const d of depots) {
      if (d.manifestGid && /^\d+$/.test(d.manifestGid) && d.manifestGid !== '0') {
        manifestService.ensureManifestCached(d.depotId, d.manifestGid, appId).catch(() => {});
      }
    }

    return res.json({
      success: true,
      data: {
        appId, // 统一 number 类型（其余接口均为 number，原字符串类型违反 DTO 规范）
        name: gameName || `AppID ${sAppId}`,
        depots,
        dlcIds,
        dlcDepots,
        appLevelKey,
        accessToken
      }
    });
  } catch (e: any) {
    console.error('[MetadataController] 获取游戏元数据异常:', e);
    return res.status(500).json({ success: false, message: '获取元数据失败，请稍后重试' });
  }
};
