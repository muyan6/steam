import fs from 'fs';
import path from 'path';
import os from 'os';
import axios from 'axios';
import { DepotInfo, GameMetadata } from '../../types';

export class MetadataService {
  private cacheDir: string;
  private nameCachePath: string;
  private tokenCachePath: string;
  private sudamaCachePath: string;

  private nameCache: Record<string, string> = {};
  private tokenCache: Record<string, { token: string; ts: number }> = {};
  private sudamaAllKeys: Record<string, string> = {};
  private sudamaFetchTime: number = 0;
  private offlineDepotKeys: Record<string, string> | null = null;

  private readonly STEAM_STORE_API = 'https://store.steampowered.com/api/appdetails';
  private readonly STEAMCMD_API = 'https://api.steamcmd.net/v1/info';
  private readonly TOKEN_API = 'https://api.993499094.xyz/appaccesstokens.json';
  private readonly DEPOT_KEYS_API = 'https://api.993499094.xyz/depotkeys.json';

  private readonly axiosHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8'
  };

  constructor() {
    this.cacheDir = path.join(os.homedir(), '.SteamMaster', 'cache');
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
    } catch {}

    this.nameCachePath = path.join(this.cacheDir, 'name_cache.json');
    this.tokenCachePath = path.join(this.cacheDir, 'token_cache.json');
    this.sudamaCachePath = path.join(this.cacheDir, 'sudama_cache.json');

    this.loadCaches();
    this.loadOfflineDepotKeys();
  }

  private loadCaches(): void {
    try {
      if (fs.existsSync(this.nameCachePath)) {
        this.nameCache = JSON.parse(fs.readFileSync(this.nameCachePath, 'utf-8'));
      }
    } catch {}

    try {
      if (fs.existsSync(this.tokenCachePath)) {
        this.tokenCache = JSON.parse(fs.readFileSync(this.tokenCachePath, 'utf-8'));
      }
    } catch {}

    try {
      if (fs.existsSync(this.sudamaCachePath)) {
        const raw = JSON.parse(fs.readFileSync(this.sudamaCachePath, 'utf-8'));
        if (raw && typeof raw === 'object') {
          this.sudamaAllKeys = raw.data || raw;
          this.sudamaFetchTime = raw.timestamp || Date.now() / 1000;
        }
      }
    } catch {}
  }

  private loadOfflineDepotKeys(): void {
    if (this.offlineDepotKeys) return;
    const candidatePaths = [
      path.join(process.cwd(), 'server/data/steam_depot_keys.json'),
      path.join(process.cwd(), 'data/steam_depot_keys.json')
    ];
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        try {
          this.offlineDepotKeys = JSON.parse(fs.readFileSync(p, 'utf-8'));
          console.log(`[MetadataService] 已载入离线 28.8万条 DepotKey 库 (${Object.keys(this.offlineDepotKeys!).length} 条)`);
          break;
        } catch {}
      }
    }
  }

  private saveJson(filePath: string, data: any): void {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {}
  }

  /**
   * 完整获取指定 AppID 的所有元数据（多源组合，优雅降级）
   */
  public async fetchMetadata(appId: string | number, hintName: string = ''): Promise<GameMetadata> {
    const sAppId = appId.toString();
    const metadata: GameMetadata = {
      appId: sAppId,
      name: hintName || this.nameCache[sAppId] || '',
      depots: [],
      dlcIds: [],
      dlcDepots: []
    };

    console.log(`[MetadataService] 正在获取 AppID ${sAppId} 元数据...`);

    // 1. 获取 Steam Store API 信息（名称、DLC、基础 Depots）
    const storeData = await this.fetchStoreApi(sAppId);
    if (storeData) {
      if (!metadata.name && storeData.name) {
        metadata.name = storeData.name;
        this.nameCache[sAppId] = storeData.name;
        this.saveJson(this.nameCachePath, this.nameCache);
      }

      if (Array.isArray(storeData.dlc)) {
        metadata.dlcIds = storeData.dlc.map((d: any) => d.toString());
      }

      if (storeData.depots && typeof storeData.depots === 'object') {
        metadata.depots = this.parseDepots(storeData.depots);
      }
    }

    // 2. SteamCMD API 补充并精确化 Depot 信息
    const steamcmdDepots = await this.fetchSteamCmdApi(sAppId);
    if (steamcmdDepots.length > 0) {
      if (metadata.depots.length === 0) {
        metadata.depots = steamcmdDepots;
      } else {
        const existingIds = new Set(metadata.depots.map(d => d.depotId));
        for (const cmdDepot of steamcmdDepots) {
          if (!existingIds.has(cmdDepot.depotId)) {
            metadata.depots.push(cmdDepot);
          } else {
            // 合并更准确的 manifestGid
            const existing = metadata.depots.find(d => d.depotId === cmdDepot.depotId);
            if (existing && !existing.manifestGid && cmdDepot.manifestGid) {
              existing.manifestGid = cmdDepot.manifestGid;
            }
          }
        }
      }
    }

    // 3. 关联 DLC 的 Depots 并行解析
    if (metadata.dlcIds.length > 0) {
      metadata.dlcDepots = await this.fetchDlcDepots(metadata.dlcIds);
    }

    // 4. 社区与离线密钥库补充解密密钥
    await this.enrichDepotKeys(metadata);

    // 5. 获取 PICS Access Token
    metadata.accessToken = await this.fetchAccessToken(sAppId);

    const keyCount = metadata.depots.filter(d => d.depotKey).length;
    const dlcKeyCount = metadata.dlcDepots.filter(d => d.depot.depotKey).length;

    console.log(
      `[MetadataService] 元数据获取完成: ${metadata.name} (AppID: ${sAppId}), ` +
      `Depots: ${metadata.depots.length} (匹配 ${keyCount} 密钥), ` +
      `DLCs: ${metadata.dlcIds.length} (DLC Depots: ${metadata.dlcDepots.length}, 匹配 ${dlcKeyCount} 密钥), ` +
      `Token: ${metadata.accessToken ? '已获取' : '无'}`
    );

    return metadata;
  }

  /**
   * Steam Store API 查询
   */
  private async fetchStoreApi(appId: string): Promise<any | null> {
    try {
      const resp = await axios.get(`${this.STEAM_STORE_API}`, {
        params: { appids: appId, l: 'zh-CN', cc: 'CN' },
        headers: this.axiosHeaders,
        timeout: 8000
      });
      if (resp.data && resp.data[appId] && resp.data[appId].success) {
        return resp.data[appId].data;
      }
    } catch (e: any) {
      console.warn(`[MetadataService] Store API 请求失败 (${appId}):`, e.message);
    }
    return null;
  }

  /**
   * SteamCMD API 查询 Depots 详细信息
   */
  private async fetchSteamCmdApi(appId: string): Promise<DepotInfo[]> {
    try {
      const resp = await axios.get(`${this.STEAMCMD_API}/${appId}`, {
        headers: this.axiosHeaders,
        timeout: 10000
      });
      const depotsData = resp.data?.data?.[appId]?.depots;
      if (depotsData && typeof depotsData === 'object') {
        return this.parseDepots(depotsData);
      }
    } catch (e: any) {
      console.warn(`[MetadataService] SteamCMD API 请求失败 (${appId}):`, e.message);
    }
    return [];
  }

  /**
   * 并发解析关联 DLC 的 Depots（受控并发）
   */
  private async fetchDlcDepots(dlcIds: string[]): Promise<Array<{ dlcAppId: string; depot: DepotInfo }>> {
    const results: Array<{ dlcAppId: string; depot: DepotInfo }> = [];
    const limit = 5;
    const chunks: string[][] = [];

    for (let i = 0; i < dlcIds.length; i += limit) {
      chunks.push(dlcIds.slice(i, i + limit));
    }

    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (dlcId) => {
          try {
            const resp = await axios.get(`${this.STEAMCMD_API}/${dlcId}`, {
              headers: this.axiosHeaders,
              timeout: 8000
            });
            const depotsData = resp.data?.data?.[dlcId]?.depots;
            if (depotsData && typeof depotsData === 'object') {
              const parsed = this.parseDepots(depotsData);
              for (const d of parsed) {
                results.push({ dlcAppId: dlcId, depot: d });
              }
            }
          } catch {}
        })
      );
    }

    return results;
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

      // 提取 Manifest GID (遍历 manifests 分支)
      if (info.manifests && typeof info.manifests === 'object') {
        for (const branchData of Object.values(info.manifests) as any[]) {
          if (branchData && branchData.gid) {
            manifestGid = branchData.gid.toString();
            size = branchData.download ? parseInt(branchData.download, 10) : 0;
            break;
          }
        }
      }

      // 提取自带的 key
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

  /**
   * 获取 PICS Access Token
   */
  private async fetchAccessToken(appId: string): Promise<string> {
    const now = Date.now() / 1000;
    if (this.tokenCache[appId] && (now - this.tokenCache[appId].ts < 86400)) {
      return this.tokenCache[appId].token;
    }

    try {
      const resp = await axios.get(this.TOKEN_API, { timeout: 8000 });
      if (resp.data && typeof resp.data === 'object') {
        const token = resp.data[appId] || '';
        if (token) {
          this.tokenCache[appId] = { token, ts: now };
          this.saveJson(this.tokenCachePath, this.tokenCache);
          return token;
        }
      }
    } catch {}

    return '';
  }

  /**
   * 整合社区 Sudama 与本地 28.8万离线库为所有 Depot 注入真实有效密钥
   */
  private async enrichDepotKeys(metadata: GameMetadata): Promise<void> {
    const allKeys = await this.getAllDepotKeys();

    const isValidKey = (k?: string) => k && k.length >= 32 && !/^0+$/.test(k);

    // 1. 主应用级密钥
    if (!metadata.appLevelKey) {
      const appKey = allKeys[metadata.appId];
      if (isValidKey(appKey)) {
        metadata.appLevelKey = appKey;
      }
    }

    // 2. 主 Depots 专属密钥
    for (const depot of metadata.depots) {
      if (!isValidKey(depot.depotKey)) {
        const k = allKeys[depot.depotId];
        if (isValidKey(k)) {
          depot.depotKey = k;
        }
      }
    }

    // 3. DLC Depots 专属密钥
    for (const item of metadata.dlcDepots) {
      if (!isValidKey(item.depot.depotKey)) {
        const k = allKeys[item.depot.depotId];
        if (isValidKey(k)) {
          item.depot.depotKey = k;
        }
      }
    }
  }

  /**
   * 聚合全量密钥字典（本地 28.8万离线库 + Sudama 云端库）
   */
  public async getAllDepotKeys(): Promise<Record<string, string>> {
    const merged: Record<string, string> = {};

    // 1. 优先载入本地 28.8万离线密钥库
    this.loadOfflineDepotKeys();
    if (this.offlineDepotKeys) {
      Object.assign(merged, this.offlineDepotKeys);
    }

    // 2. 检查 Sudama 内存与本地缓存
    const now = Date.now() / 1000;
    if (Object.keys(this.sudamaAllKeys).length > 0 && (now - this.sudamaFetchTime < 86400)) {
      Object.assign(merged, this.sudamaAllKeys);
      return merged;
    }

    // 3. 异步拉取 Sudama 云端最新库
    try {
      const resp = await axios.get(this.DEPOT_KEYS_API, { timeout: 15000 });
      if (resp.data && typeof resp.data === 'object') {
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(resp.data)) {
          if (typeof v === 'string' && v.length >= 32) {
            clean[k] = v;
          }
        }
        if (Object.keys(clean).length > 0) {
          this.sudamaAllKeys = clean;
          this.sudamaFetchTime = now;
          this.saveJson(this.sudamaCachePath, { timestamp: now, data: clean });
          Object.assign(merged, clean);
        }
      }
    } catch (e: any) {
      console.warn('[MetadataService] 拉取 Sudama 云端密钥异常 (平滑回退离线库):', e.message);
    }

    return merged;
  }
}

export const metadataService = new MetadataService();
