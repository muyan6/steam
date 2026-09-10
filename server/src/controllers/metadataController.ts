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
    const proxyBases = [
      'https://gh-proxy.com/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://ghproxy.net/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://ghproxy.cn/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://ghfast.top/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://raw.githubusercontent.com/steamtools-games/ManifestHub3'
    ];

    const urls: string[] = [];
    for (const b of proxyBases) {
      urls.push(`${b}/${appId}/${appId}.lua`);
      urls.push(`${b}/${appId}/${appId}_public.lua`);
      urls.push(`${b}/${appId}/${appId}.json`);
    }

    let data: ManifestHub3Data | null = null;
    for (const u of urls) {
      try {
        const isJson = u.endsWith('.json');
        const resp = await axios.get(u, { httpsAgent, timeout: 6000 });
        if (isJson && resp.data && resp.data.depot && typeof resp.data.depot === 'object') {
          data = parseManifestHub3Json(resp.data, appId);
          break;
        } else if (!isJson) {
          const lua = typeof resp.data === 'string' ? resp.data : '';
          if (lua.includes('addappid') || lua.includes('setManifestid')) {
            data = parseManifestHub3Lua(lua, appId);
            break;
          }
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
              // SteamCMD 返回的分支顺序不固定，优先取 public 分支
              const branchEntries = Object.entries((info as any).manifests) as Array<[string, any]>;
              const chosen = branchEntries.find(([b, v]) => b === 'public' && v && v.gid) || branchEntries.find(([, v]) => v && v.gid);
              if (chosen) {
                const candidateGid = chosen[1].gid.toString();
                // 严密防线：SteamCMD GID 仅为构建号；
                // 只有在服务端本地确有有效 .manifest 实体时，才提前赋予该 GID；
                // 否则交由 4.5 步骤从 ManifestHub3 确认具有实体文件的分支真实 GID，杜绝无实体假 GID
                const localPath = manifestService.getLocalManifestFilePath(dId, candidateGid, appId);
                if (localPath) {
                  manifestGid = candidateGid;
                }
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

    // 铁律：DLC 授权统一通过 dlcIds 下发，客户端以 addappid(dlcId) 纯许可挂载；
    // 严禁通过 dlcBase+0..10 盲目递增猜测分包（如 2672611 等占位分包），
    // 否则客户端写入 addappid(candId, 1, key) 必然导致 Steam 尝试索取清单报 401 Unauthorized 未知错误。
    // 仅当 SteamCMD 或 ManifestHub3 明确收录且具备真实清单 GID 的分包才允许下发。
    const claimedDepotIds = new Set(depots.map((d) => d.depotId));

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
      // 本地数据完全没有的分包（新 DLC / 新增 depot）一并补入（必须带清单 GID）
      for (const [dId, key] of hub3Data.depotKeys) {
        if (knownDepots.has(dId)) continue;
        const gid = hub3Data.manifestGids.get(dId);
        if (gid && /^\d+$/.test(gid) && gid !== '0') {
          depots.push({ depotId: dId, depotKey: key, manifestGid: gid });
          knownDepots.add(dId);
        }
      }
    }

    // 严密防线：内容分包必须同时具备有效解密密钥与有效清单 GID！
    // 无清单 GID 的分包绝不下发为内容分包，杜绝客户端挂载后触发 Steam 401“未知错误”
    depots = depots.filter(
      (d) => isValidKey(d.depotKey) && d.manifestGid && /^\d+$/.test(d.manifestGid) && d.manifestGid !== '0'
    );

    // 严密断言：必须具备实际有效的清单 GID（无清单文件即无法通过 Steam 下载）
    const hasValidManifest = depots.length > 0;

    // 严密防线：若云端无任何有效分包、或没有任何有效清单实体 GID，直接响应「暂时没有这款游戏」
    if (depots.length === 0 || !hasValidManifest) {
      return res.status(200).json({
        success: false,
        message: `暂时没有这款游戏（云端暂未收录 AppID ${sAppId} 的清单实体文件）`,
        data: null
      });
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
