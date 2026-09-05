import { Request, Response } from 'express';
import axios from 'axios';
import https from 'https';
import { gameService } from '../services/gameService.js';
import { depotService } from '../services/depotService.js';
import { tokenService } from '../services/tokenService.js';

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
}

const manifestHub3Cache = new Map<number, { data: ManifestHub3Data | null; fetchedAt: number }>();
const MANIFEST_HUB3_TTL_MS = 6 * 60 * 60 * 1000; // 6 小时内存缓存，避免逐请求拉取

function parseManifestHub3Lua(lua: string): ManifestHub3Data {
  const depotKeys = new Map<string, string>();
  const manifestGids = new Map<string, string>();
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

  return { depotKeys, manifestGids, accessToken };
}

async function fetchManifestHub3(appId: number): Promise<ManifestHub3Data | null> {
  const cached = manifestHub3Cache.get(appId);
  if (cached && Date.now() - cached.fetchedAt < MANIFEST_HUB3_TTL_MS) {
    return cached.data;
  }

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
        data = parseManifestHub3Lua(lua);
        break;
      }
    } catch {}
  }

  manifestHub3Cache.set(appId, { data, fetchedAt: Date.now() });
  return data;
}

export const getGameMetadata = async (req: Request, res: Response) => {
  try {
    const rawAppId = Array.isArray(req.params.appId) ? req.params.appId[0] : req.params.appId;
    const appId = parseInt(rawAppId, 10);
    if (isNaN(appId)) {
      return res.status(400).json({ success: false, message: '无效的 AppID' });
    }

    const sAppId = appId.toString();
    const hintName = typeof req.query.name === 'string' ? req.query.name : '';

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

    // 2. 若缺少详细信息，由后端向 Steam 官方 Store API 实时聚合
    if (!gameName || dlcIds.length === 0 || depots.length === 0) {
      try {
        const storeResp = await axios.get('https://store.steampowered.com/api/appdetails', {
          params: { appids: sAppId, l: 'zh-CN', cc: 'CN' },
          httpsAgent,
          timeout: 4000,
          headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster-Server/1.0' }
        });

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

    // 3. 从 SteamCMD API 补全精确的分包与 Manifest GID
    try {
      const cmdResp = await axios.get(`https://api.steamcmd.net/v1/info/${sAppId}`, {
        httpsAgent,
        timeout: 5000,
        headers: { 'User-Agent': 'Mozilla/5.0 SteamMaster-Server/1.0' }
      });
      const depotsData = cmdResp.data?.data?.[sAppId]?.depots;
      if (depotsData && typeof depotsData === 'object') {
        const skipPatterns = ['config', 'sharedinstall', 'shareddepot', 'redist'];
        for (const [dId, info] of Object.entries(depotsData)) {
          if (!info || typeof info !== 'object') continue;
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

    // 4.5 ManifestHub3 社区清单库兜底（steamtools-games/ManifestHub3，约 6.2 万 AppID）：
    // 本地密钥库/GID 缺失时拉取该 AppID 分支的 Lua 解析补全。
    // 铁律：只补缺，绝不覆盖已有有效数据——其 GID 可能与 SteamCMD public 不一致
    let hub3Data: ManifestHub3Data | null = null;
    if (depots.some((d) => !isValidKey(d.depotKey) || !d.manifestGid)) {
      hub3Data = await fetchManifestHub3(appId);
      if (hub3Data) {
        const knownDepots = new Set(depots.map((d) => d.depotId));
        for (const d of depots) {
          if (!isValidKey(d.depotKey) && hub3Data.depotKeys.has(d.depotId)) {
            d.depotKey = hub3Data.depotKeys.get(d.depotId);
          }
          if (!d.manifestGid && hub3Data.manifestGids.has(d.depotId)) {
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
    }

    // 5. 获取 PICS Access Token
    const appLevelKey =
      matchedKeys[sAppId] || depotService.getDepotKey(sAppId) || hub3Data?.depotKeys.get(sAppId) || undefined;
    const accessToken = tokenService.getTokenByAppId(sAppId) || hub3Data?.accessToken || undefined;

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
    return res.status(500).json({ success: false, message: `获取元数据失败: ${e.message}` });
  }
};
