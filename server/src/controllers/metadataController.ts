import { Request, Response } from 'express';
import axios from 'axios';
import https from 'https';
import { gameService } from '../services/gameService.js';
import { depotService } from '../services/depotService.js';
import { tokenService } from '../services/tokenService.js';

const httpsAgent = new https.Agent({ rejectUnauthorized: false });

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
    const preset = await gameService.getGameByAppId(appId);
    if (preset) {
      gameName = preset.nameZh || preset.name || gameName;
      if (Array.isArray(preset.dlcs)) {
        dlcIds = preset.dlcs.map((d) => d.toString());
      }
      if (preset.depots) {
        for (const [dId, key] of Object.entries(preset.depots)) {
          depots.push({ depotId: dId, depotKey: key });
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
            for (const branchData of Object.values((info as any).manifests) as any[]) {
              if (branchData && branchData.gid) {
                manifestGid = branchData.gid.toString();
                break;
              }
            }
          }

          const existing = depots.find((d) => d.depotId === dId);
          if (existing) {
            if (manifestGid && !existing.manifestGid) existing.manifestGid = manifestGid;
          } else {
            depots.push({ depotId: dId, manifestGid });
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

    // 为主分包注入密钥
    for (const d of depots) {
      if (!d.depotKey && matchedKeys[d.depotId]) {
        d.depotKey = matchedKeys[d.depotId];
      }
    }

    // 为 DLC 分包聚合密钥
    for (const dlcId of dlcIds) {
      const dlcKey = matchedKeys[dlcId] || depotService.getDepotKey(dlcId);
      if (dlcKey) {
        dlcDepots.push({
          dlcAppId: dlcId,
          depot: { depotId: dlcId, depotKey: dlcKey }
        });
      }
    }

    // 5. 获取 PICS Access Token
    const appLevelKey = matchedKeys[sAppId] || depotService.getDepotKey(sAppId) || undefined;
    const accessToken = tokenService.getTokenByAppId(sAppId) || undefined;

    return res.json({
      success: true,
      data: {
        appId: sAppId,
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
