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
    dlcs: number[] = [],
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

    // 2. 合并本体 depot 与 DLC depot，使 dlcs 参数真正生效
    let depots = [...metadata.depots];
    const dlcDepots = (metadata.dlcDepots || []).map((d: any) => d.depot).filter(Boolean);
    if (dlcs.length > 0) {
      // 指定 DLC 列表时只附加列表内的 DLC depot
      const wanted = new Set(dlcs.map(String));
      const matched = dlcDepots.filter((d: any) => wanted.has(String(d.depotId)));
      // 元数据中未列出 depotId 的 DLC 也尽量纳入（保留旧语义）
      const known = new Set([...depots, ...matched].map((d: any) => String(d.depotId)));
      const extras = dlcDepots.filter((d: any) => !known.has(String(d.depotId)));
      depots = [...depots, ...matched, ...extras];
    } else {
      depots = [...depots, ...dlcDepots];
    }

    // 3. 通过 SteamPipe CDN 批量下载并解压 payload 到 depotcache/
    return manifestDownloadService.downloadDepotManifests(steamPath, appId, depots);
  }
}

export const manifestService = new ManifestService();
