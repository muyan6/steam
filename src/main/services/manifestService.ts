import { steamService } from './steamService';
import { metadataService } from './metadataService';
import { manifestDownloadService } from './manifestDownloadService';
import { ManifestInstallResult, AppManifestStatus } from '../../types';

export class ManifestService {
  public async ensureDepotCacheDir(): Promise<string | null> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) return null;
    return manifestDownloadService.ensureDepotCacheDir(steamPath);
  }

  public async checkAppManifestStatus(appId: number, dlcs: number[] = []): Promise<AppManifestStatus> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return { appId, hasManifest: false, manifestCount: 0, matchedDepots: [], manifestFiles: [] };
    }
    return manifestDownloadService.checkAppManifestStatus(steamPath, appId, dlcs);
  }

  public async fetchAndInstallManifests(
    appId: number,
    _dlcs: number[] = [],
    _presetKeys: { [depotId: string]: string } = {}
  ): Promise<ManifestInstallResult> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return {
        success: false,
        appId,
        downloadedCount: 0,
        totalDepots: 0,
        depotKeys: {},
        manifestFiles: [],
        source: 'none',
        message: '未检测到 Steam 客户端安装目录'
      };
    }

    // 1. 获取完整元数据 (含真实 Depot 树及 manifestGid)
    const metadata = await metadataService.fetchMetadata(appId);

    // 2. 通过 SteamPipe CDN 批量下载并解压 payload 到 depotcache/
    return manifestDownloadService.downloadDepotManifests(steamPath, appId, metadata.depots);
  }
}

export const manifestService = new ManifestService();
