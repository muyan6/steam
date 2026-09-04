import axios from 'axios';
import { DepotInfo, GameMetadata } from '../../types';
import { APP_CONFIG } from '../../config/appConfig';
import { licenseClientService } from './licenseClientService';

export class MetadataService {
  private readonly STEAM_STORE_API = 'https://store.steampowered.com/api/appdetails';
  private readonly STEAMCMD_API = 'https://api.steamcmd.net/v1/info';


  private readonly axiosHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  };

  /**
   * 完整获取指定 AppID 的所有元数据与精准解密密钥（纯按需请求，本地不存储全量数据）
   */
  public async fetchMetadata(appId: string | number, hintName: string = ''): Promise<GameMetadata> {
    const sAppId = appId.toString();

    // 0. 未激活时严禁向云端发起密钥请求
    const license = await licenseClientService.getLicenseInfo(false);
    if (!license || !license.isActivated) {
      throw new Error('当前设备尚未激活软件授权，无法调用云端数据引擎获取游戏密钥。请先输入卡密激活。');
    }

    console.log(`[MetadataService] 正在按需获取 AppID ${sAppId} 元数据与解密密钥...`);

    // 1. 优先向云端后端发起按需聚合查询（由后端统一完成 28.8万条密钥与 Token 匹配并精准下发）
    try {
      const url = `${APP_CONFIG.API_BASE_URL}/api/metadata/${sAppId}`;
      const resp = await axios.get(url, {
        params: { name: hintName },
        timeout: 5000,
        headers: this.axiosHeaders
      });

      if (resp.data && resp.data.success && resp.data.data) {
        const data = resp.data.data;
        const keyCount = (data.depots || []).filter((d: any) => d.depotKey).length;
        const dlcKeyCount = (data.dlcDepots || []).filter((d: any) => d.depot?.depotKey).length;

        console.log(
          `[MetadataService] ✅ 成功从云端后端获取: ${data.name} (AppID: ${sAppId}), ` +
          `Depots: ${data.depots?.length || 0} (匹配 ${keyCount} 密钥), ` +
          `DLCs: ${data.dlcIds?.length || 0} (DLC Depots: ${data.dlcDepots?.length || 0}, 匹配 ${dlcKeyCount} 密钥), ` +
          `Token: ${data.accessToken ? '已注入' : '无'}`
        );

        return data;
      }
    } catch (e: any) {
      console.warn(`[MetadataService] 云端后端接口未连接 (${e.message})，启用直连轻量降级解析...`);
    }

    // 2. 离线/直连轻量降级模式（仅针对当前单款 AppID 向官方公共接口查询基础结构，本地不落盘全量数据）
    const fallbackMetadata: GameMetadata = {
      appId: sAppId,
      name: hintName || `AppID ${sAppId}`,
      depots: [],
      dlcIds: [],
      dlcDepots: []
    };

    // 2.1 Steam Store API 基础信息查询
    const storeData = await this.fetchStoreApi(sAppId);
    if (storeData) {
      if (storeData.name) fallbackMetadata.name = storeData.name;
      if (Array.isArray(storeData.dlc)) {
        fallbackMetadata.dlcIds = storeData.dlc.map((d: any) => d.toString());
      }
      if (storeData.depots && typeof storeData.depots === 'object') {
        fallbackMetadata.depots = this.parseDepots(storeData.depots);
      }
    }

    // 2.2 SteamCMD API 补充分包与 Manifest GID
    const steamcmdDepots = await this.fetchSteamCmdApi(sAppId);
    if (steamcmdDepots.length > 0) {
      if (fallbackMetadata.depots.length === 0) {
        fallbackMetadata.depots = steamcmdDepots;
      } else {
        const existingIds = new Set(fallbackMetadata.depots.map(d => d.depotId));
        for (const cmdDepot of steamcmdDepots) {
          if (!existingIds.has(cmdDepot.depotId)) {
            fallbackMetadata.depots.push(cmdDepot);
          } else {
            const existing = fallbackMetadata.depots.find(d => d.depotId === cmdDepot.depotId);
            if (existing && !existing.manifestGid && cmdDepot.manifestGid) {
              existing.manifestGid = cmdDepot.manifestGid;
            }
          }
        }
      }
    }

    // 2.3 若未获取到任何分包，兜底添加自身
    if (fallbackMetadata.depots.length === 0) {
      fallbackMetadata.depots.push({ depotId: sAppId });
    }

    return fallbackMetadata;
  }

  /**
   * Steam Store API 单个 AppID 查询
   */
  private async fetchStoreApi(appId: string): Promise<any | null> {
    try {
      const resp = await axios.get(`${this.STEAM_STORE_API}`, {
        params: { appids: appId, l: 'zh-CN', cc: 'CN' },
        headers: this.axiosHeaders,
        timeout: 4000
      });
      if (resp.data && resp.data[appId] && resp.data[appId].success) {
        return resp.data[appId].data;
      }
    } catch (e: any) {
      console.warn(`[MetadataService] Store API 请求异常 (${appId}):`, e.message);
    }
    return null;
  }

  /**
   * SteamCMD API 单个 AppID Depots 查询
   */
  private async fetchSteamCmdApi(appId: string): Promise<DepotInfo[]> {
    try {
      const resp = await axios.get(`${this.STEAMCMD_API}/${appId}`, {
        headers: this.axiosHeaders,
        timeout: 5000
      });
      const depotsData = resp.data?.data?.[appId]?.depots;
      if (depotsData && typeof depotsData === 'object') {
        return this.parseDepots(depotsData);
      }
    } catch (e: any) {
      console.warn(`[MetadataService] SteamCMD API 请求异常 (${appId}):`, e.message);
    }
    return [];
  }

  /**
   * 解析 Steam/SteamCMD Depots 字典为 DepotInfo 列表
   */
  public parseDepots(depotsObj: Record<string, any>): DepotInfo[] {
    const skipPatterns = ['config', 'sharedinstall', 'shareddepot', 'redist'];
    const results: DepotInfo[] = [];

    for (const [depotId, info] of Object.entries(depotsObj)) {
      if (!info || typeof info !== 'object') continue;

      const name = (info.name || '').toString().toLowerCase();
      if (skipPatterns.some(p => name.includes(p))) continue;

      let manifestGid = '';
      let size = 0;

      if (info.manifests && typeof info.manifests === 'object') {
        for (const branchData of Object.values(info.manifests) as any[]) {
          if (branchData && branchData.gid) {
            manifestGid = branchData.gid.toString();
            size = branchData.download ? parseInt(branchData.download, 10) : 0;
            break;
          }
        }
      }

      let depotKey = '';
      for (const k of ['decryption_key', 'depot_key', 'depotkey', 'key', 'sharedsecret']) {
        if (info[k] && typeof info[k] === 'string' && info[k].length >= 32) {
          depotKey = info[k];
          break;
        }
      }

      results.push({
        depotId,
        manifestGid,
        size,
        depotKey
      });
    }

    return results;
  }
}

export const metadataService = new MetadataService();
