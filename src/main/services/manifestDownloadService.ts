import fs from 'fs';
import path from 'path';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { DepotInfo, ManifestInstallResult, AppManifestStatus } from '../../types';

export class ManifestDownloadService {
  private cdnHostsCache: string[] = [];
  private cdnCacheTime: number = 0;
  private readonly CDN_CACHE_TTL = 1800; // 30 minutes

  private readonly FALLBACK_CDN_HOSTS = [
    'cache1-steamcontent.com',
    'cache2-steamcontent.com',
    'cache3-steamcontent.com',
    'cache4-steamcontent.com',
    'cache5-steamcontent.com',
    'cache6-steamcontent.com',
    'cache7-steamcontent.com',
    'cache8-steamcontent.com',
    'cache9-steamcontent.com',
    'cache10-steamcontent.com',
    'cache1-lax1.steamcontent.com',
    'cache2-lax1.steamcontent.com'
  ];

  /**
   * 确保 Steam 根目录下的 depotcache 目录存在
   */
  public ensureDepotCacheDir(steamPath: string): string {
    const depotCacheDir = path.join(steamPath, 'depotcache');
    if (!fs.existsSync(depotCacheDir)) {
      fs.mkdirSync(depotCacheDir, { recursive: true });
    }
    return depotCacheDir;
  }

  /**
   * 检查指定清单文件是否已存在
   */
  public checkManifestExists(steamPath: string, depotId: string, manifestGid: string): boolean {
    const filePath = path.join(steamPath, 'depotcache', `${depotId}_${manifestGid}.manifest`);
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  }

  /**
   * 检查游戏的清单就绪状态
   */
  public checkAppManifestStatus(steamPath: string, appId: number, dlcs: number[] = []): AppManifestStatus {
    const depotCacheDir = path.join(steamPath, 'depotcache');
    if (!fs.existsSync(depotCacheDir)) {
      return { appId, hasManifest: false, manifestCount: 0, matchedDepots: [], manifestFiles: [] };
    }

    try {
      const files = fs.readdirSync(depotCacheDir);
      const appPrefixes = [appId.toString(), ...dlcs.map(d => d.toString())];
      const matchedFiles: string[] = [];
      const matchedDepots: string[] = [];

      for (const f of files) {
        if (!f.endsWith('.manifest')) continue;
        const parts = f.replace('.manifest', '').split('_');
        if (parts.length >= 2) {
          const dId = parts[0];
          // 如果 depotId 等于 appId，或者在 appId 邻近范围内
          if (appPrefixes.some(prefix => dId.startsWith(prefix) || Math.abs(parseInt(dId, 10) - parseInt(prefix, 10)) <= 20)) {
            matchedFiles.push(f);
            if (!matchedDepots.includes(dId)) matchedDepots.push(dId);
          }
        }
      }

      return {
        appId,
        hasManifest: matchedFiles.length > 0,
        manifestCount: matchedFiles.length,
        matchedDepots,
        manifestFiles: matchedFiles
      };
    } catch {
      return { appId, hasManifest: false, manifestCount: 0, matchedDepots: [], manifestFiles: [] };
    }
  }

  /**
   * 获取活跃 Steam CDN 服务器主机列表
   */
  private async getCdnHosts(): Promise<string[]> {
    const now = Date.now() / 1000;
    if (this.cdnHostsCache.length > 0 && (now - this.cdnCacheTime < this.CDN_CACHE_TTL)) {
      return this.cdnHostsCache;
    }

    try {
      const url = 'https://api.steampowered.com/IContentServerDirectoryService/GetServersForSteamPipe/v1/?cell_id=33&max_servers=30';
      const resp = await axios.get(url, { timeout: 6000 });
      const servers = resp.data?.response?.servers;
      if (Array.isArray(servers) && servers.length > 0) {
        const hosts: string[] = [];
        for (const s of servers) {
          if (s.host && !hosts.includes(s.host)) {
            hosts.push(s.host);
          }
        }
        if (hosts.length > 0) {
          this.cdnHostsCache = hosts;
          this.cdnCacheTime = now;
          return hosts;
        }
      }
    } catch {}

    this.cdnHostsCache = this.FALLBACK_CDN_HOSTS;
    this.cdnCacheTime = now;
    return this.FALLBACK_CDN_HOSTS;
  }

  /**
   * 从 Steam CDN 下载单个 Depot Manifest 并解压保存
   */
  public async downloadSingleManifest(
    steamPath: string,
    depotId: string,
    manifestGid: string,
    size: number = 0
  ): Promise<{ success: boolean; filePath: string; message: string }> {
    const depotCacheDir = this.ensureDepotCacheDir(steamPath);
    const targetPath = path.join(depotCacheDir, `${depotId}_${manifestGid}.manifest`);

    if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
      return { success: true, filePath: targetPath, message: '已存在' };
    }

    const cdnHosts = await this.getCdnHosts();

    for (const host of cdnHosts) {
      const url = `https://${host}/depot/${depotId}/manifest/${manifestGid}/5/${size || 0}`;
      try {
        const resp = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 10000,
          headers: {
            'User-Agent': 'Valve/Steam HTTP Client 1.0',
            'Accept': '*/*'
          }
        });

        if (resp.status === 200 && resp.data && resp.data.length > 0) {
          const payload = this.extractManifestPayload(Buffer.from(resp.data));
          if (payload && payload.length > 0) {
            fs.writeFileSync(targetPath, payload);
            this.cleanOldManifests(depotCacheDir, depotId, manifestGid);
            console.log(`[ManifestDownloadService] 清单下载成功: ${depotId}_${manifestGid} (${payload.length} 字节) via ${host}`);
            return {
              success: true,
              filePath: targetPath,
              message: `已下载 (${payload.length} 字节)`
            };
          }
        }
      } catch {}
    }

    return {
      success: false,
      filePath: '',
      message: `所有 CDN 均未找到清单 ${depotId}_${manifestGid}`
    };
  }

  /**
   * 从 ZIP 数据提取真正的 manifest payload (通常为名为 'z' 的文件)
   */
  private extractManifestPayload(data: Buffer): Buffer {
    try {
      const zip = new AdmZip(data);
      const entries = zip.getEntries();
      for (const entry of entries) {
        if (!entry.isDirectory) {
          const decompressed = entry.getData();
          if (decompressed && decompressed.length > 0) {
            return decompressed;
          }
        }
      }
    } catch {
      // 若不是标准 zip 格式，直接返回原始二进制
      return data;
    }
    return data;
  }

  /**
   * 清理同一 Depot 的旧版本 manifest
   */
  private cleanOldManifests(depotCacheDir: string, depotId: string, currentGid: string): void {
    try {
      const currentFile = `${depotId}_${currentGid}.manifest`;
      const files = fs.readdirSync(depotCacheDir);
      for (const f of files) {
        if (f.startsWith(`${depotId}_`) && f.endsWith('.manifest') && f !== currentFile) {
          try {
            fs.unlinkSync(path.join(depotCacheDir, f));
            console.log(`[ManifestDownloadService] 清理旧版本清单: ${f}`);
          } catch {}
        }
      }
    } catch {}
  }

  /**
   * 批量下载指定游戏及其所有 Depot 的 Manifest
   */
  public async downloadDepotManifests(
    steamPath: string,
    appId: number,
    depots: DepotInfo[]
  ): Promise<ManifestInstallResult> {
    const validDepots = depots.filter(d => d.manifestGid && d.manifestGid !== '0');
    const downloadedFiles: string[] = [];
    const depotKeys: Record<string, string> = {};

    for (const d of depots) {
      if (d.depotKey) depotKeys[d.depotId] = d.depotKey;
    }

    if (validDepots.length === 0) {
      return {
        success: true,
        appId,
        downloadedCount: 0,
        totalDepots: depots.length,
        depotKeys,
        manifestFiles: [],
        source: 'cdn',
        message: '无需下载清单或由 DLL 运行时动态下发'
      };
    }

    console.log(`[ManifestDownloadService] 开始批量下载 ${validDepots.length} 个 Depot 清单 (AppID: ${appId})...`);

    // 控制并发下载
    const limit = 4;
    for (let i = 0; i < validDepots.length; i += limit) {
      const batch = validDepots.slice(i, i + limit);
      await Promise.all(
        batch.map(async (d) => {
          const res = await this.downloadSingleManifest(steamPath, d.depotId, d.manifestGid!, d.size || 0);
          if (res.success && res.filePath) {
            downloadedFiles.push(path.basename(res.filePath));
          }
        })
      );
    }

    return {
      success: downloadedFiles.length > 0,
      appId,
      downloadedCount: downloadedFiles.length,
      totalDepots: validDepots.length,
      depotKeys,
      manifestFiles: downloadedFiles,
      source: 'cdn',
      message: `成功就绪 ${downloadedFiles.length}/${validDepots.length} 个分包清单到 depotcache！`
    };
  }
}

export const manifestDownloadService = new ManifestDownloadService();
