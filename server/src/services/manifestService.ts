import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { CONFIG } from '../config/index.js';
import { depotService } from './depotService.js';

export interface DepotManifestInfo {
  depotId: string;
  manifestId: string;
  manifestFileName?: string;
  downloadUrl?: string;
  source?: string;
  key?: string;
}

export interface AppManifestResult {
  success: boolean;
  appId: number;
  source: 'local_cache' | 'gmrc' | 'manifesthub' | 'none';
  depots: DepotManifestInfo[];
  keys: { [depotId: string]: string };
  message: string;
}

export class ManifestService {
  private manifestDir: string;

  constructor() {
    this.manifestDir = path.join(CONFIG.DATA_DIR, 'manifests');
    if (!fs.existsSync(this.manifestDir)) {
      try {
        fs.mkdirSync(this.manifestDir, { recursive: true });
      } catch (e) {
        console.error('[ManifestService] 创建清单缓存目录失败:', e);
      }
    }
  }

  /**
   * 获取指定 App 的清单与分包元数据（优先本地缓存 -> 上游公共清单源检索与补全）
   */
  public async getManifestsForApp(appId: number, dlcs: number[] = []): Promise<AppManifestResult> {
    const keys = await depotService.getDepotsForGame(appId, dlcs);
    const candidateDepotIds = Object.keys(keys);

    // 1. 检查服务端本地 manifests/ 缓存目录
    const localDepots = this.scanLocalManifests(candidateDepotIds);
    if (localDepots.length > 0) {
      return {
        success: true,
        appId,
        source: 'local_cache',
        depots: localDepots,
        keys,
        message: `从服务端本地清单缓存命中 ${localDepots.length} 个分包清单！`
      };
    }

    // 2. 本地无缓存，尝试向上游 GMRC / WuDRM 清单源获取
    try {
      const gmrcResult = await this.fetchFromGMRC(appId);
      if (gmrcResult && gmrcResult.length > 0) {
        return {
          success: true,
          appId,
          source: 'gmrc',
          depots: gmrcResult,
          keys,
          message: `从 GMRC 清单源成功检索到 ${gmrcResult.length} 个分包清单！`
        };
      }
    } catch (err: any) {
      console.warn(`[ManifestService] GMRC 源查询失败 (${appId}):`, err.message);
    }

    // 3. 尝试向 ManifestHub / GitHub 镜像清单库检索
    try {
      const mhResult = await this.fetchFromManifestHub(appId, candidateDepotIds);
      if (mhResult && mhResult.length > 0) {
        return {
          success: true,
          appId,
          source: 'manifesthub',
          depots: mhResult,
          keys,
          message: `从 ManifestHub 镜像库检索到 ${mhResult.length} 个分包清单！`
        };
      }
    } catch (err: any) {
      console.warn(`[ManifestService] ManifestHub 镜像检索失败 (${appId}):`, err.message);
    }

    // 4. 若上游未找到清单文件，但有 DepotKey，返回基础 Depot 映射
    const fallbackDepots: DepotManifestInfo[] = candidateDepotIds.map((dId) => ({
      depotId: dId,
      manifestId: '0',
      key: keys[dId]
    }));

    return {
      success: true,
      appId,
      source: 'none',
      depots: fallbackDepots,
      keys,
      message: `已匹配 ${candidateDepotIds.length} 个分包密钥（需客户端通过 OST 动态代理拉取清单）`
    };
  }

  /**
   * 扫描本地 manifests/ 目录下匹配 depotId 的 .manifest 文件
   */
  private scanLocalManifests(depotIds: string[]): DepotManifestInfo[] {
    if (!fs.existsSync(this.manifestDir)) return [];
    try {
      const files = fs.readdirSync(this.manifestDir);
      const results: DepotManifestInfo[] = [];

      for (const file of files) {
        // 文件名格式通常为 <depotId>_<manifestId>.manifest
        const match = file.match(/^(\d+)_(\d+)\.manifest$/i);
        if (match) {
          const [, dId, mId] = match;
          // depotIds 为空视为未提供有效查询条件，不返回全部清单
          if (depotIds.includes(dId)) {
            results.push({
              depotId: dId,
              manifestId: mId,
              manifestFileName: file,
              downloadUrl: `/api/manifests/download/${dId}/${mId}`,
              source: 'local_cache',
              key: depotService.getDepotKey(dId) || undefined
            });
          }
        }
      }
      return results;
    } catch {
      return [];
    }
  }

  /**
   * 从 GMRC 清单分发源拉取 AppID 的清单元数据
   */
  private async fetchFromGMRC(appId: number): Promise<DepotManifestInfo[]> {
    const urls = [
      `http://gmrc.wudrm.com/manifest/${appId}`,
      `https://manifest.steam.run/manifest/${appId}`
    ];

    for (const u of urls) {
      try {
        const resp = await axios.get(u, { timeout: 3500 });
        if (resp.data) {
          const data = resp.data;
          const list: DepotManifestInfo[] = [];
          if (Array.isArray(data)) {
            for (const item of data) {
              if (item.depot_id && item.manifest_id) {
                list.push({
                  depotId: item.depot_id.toString(),
                  manifestId: item.manifest_id.toString(),
                  downloadUrl: item.download_url || `${u}/${item.depot_id}`,
                  source: 'gmrc',
                  key: depotService.getDepotKey(item.depot_id.toString()) || undefined
                });
              }
            }
          } else if (typeof data === 'object') {
            for (const [dId, mId] of Object.entries(data)) {
              if (typeof mId === 'string' || typeof mId === 'number') {
                list.push({
                  depotId: dId,
                  manifestId: mId.toString(),
                  source: 'gmrc',
                  key: depotService.getDepotKey(dId) || undefined
                });
              }
            }
          }
          if (list.length > 0) return list;
        }
      } catch {}
    }
    return [];
  }

  /**
   * 从 GitHub ManifestHub 加速源检索
   */
  private async fetchFromManifestHub(appId: number, depotIds: string[]): Promise<DepotManifestInfo[]> {
    const results: DepotManifestInfo[] = [];
    const proxyBase = 'https://ghfast.top/https://raw.githubusercontent.com/ManifestHub';

    for (const dId of depotIds.slice(0, 8)) {
      const candidateUrls = [
        `${proxyBase}/Manifest/main/${dId}.json`,
        `${proxyBase}/Manifest-Index/main/data/${appId}/${dId}.json`
      ];

      for (const cu of candidateUrls) {
        try {
          const resp = await axios.get(cu, { timeout: 2500 });
          if (resp.data && (resp.data.manifest_id || resp.data.manifestId)) {
            const mId = (resp.data.manifest_id || resp.data.manifestId).toString();
            results.push({
              depotId: dId,
              manifestId: mId,
              downloadUrl: resp.data.download_url || `${proxyBase}/Manifest/main/${dId}_${mId}.manifest`,
              source: 'manifesthub',
              key: depotService.getDepotKey(dId) || undefined
            });
            break;
          }
        } catch {}
      }
    }
    return results;
  }

  /**
   * 获取本地指定清单文件路径
   */
  public getLocalManifestFilePath(depotId: string, manifestId: string): string | null {
    const candidate1 = path.join(this.manifestDir, `${depotId}_${manifestId}.manifest`);
    if (fs.existsSync(candidate1)) return candidate1;

    try {
      const files = fs.readdirSync(this.manifestDir);
      const found = files.find((f) => f.startsWith(`${depotId}_`) && f.endsWith('.manifest'));
      if (found) {
        return path.join(this.manifestDir, found);
      }
    } catch {}

    return null;
  }

  /**
   * 保存清单文件到服务端缓存
   */
  public saveManifestFile(depotId: string, manifestId: string, buffer: Buffer): boolean {
    try {
      const filePath = path.join(this.manifestDir, `${depotId}_${manifestId}.manifest`);
      fs.writeFileSync(filePath, buffer);
      return true;
    } catch (e) {
      console.error('[ManifestService] 保存清单文件失败:', e);
      return false;
    }
  }
}

export const manifestService = new ManifestService();
