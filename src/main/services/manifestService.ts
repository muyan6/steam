import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { steamService } from './steamService';
import { APP_CONFIG } from '../../config/appConfig';

export interface ManifestInstallResult {
  success: boolean;
  appId: number;
  downloadedCount: number;
  totalDepots: number;
  depotKeys: { [depotId: string]: string };
  manifestFiles: string[];
  source: 'backend' | 'gmrc' | 'manifesthub' | 'none';
  message: string;
}

export interface AppManifestStatus {
  appId: number;
  hasManifest: boolean;
  manifestCount: number;
  matchedDepots: string[];
  manifestFiles: string[];
}

export class ManifestService {
  /**
   * 确保 Steam 根目录下的 depotcache/ 目录存在
   */
  public async ensureDepotCacheDir(): Promise<string | null> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) return null;

    const depotCacheDir = path.join(steamPath, 'depotcache');
    if (!fs.existsSync(depotCacheDir)) {
      try {
        fs.mkdirSync(depotCacheDir, { recursive: true });
      } catch (e) {
        console.error('[ManifestService] 创建 depotcache 目录失败:', e);
      }
    }
    return depotCacheDir;
  }

  /**
   * 全自动检索、拉取并安装指定游戏的分包清单 (.manifest) 到 Steam depotcache/
   * 遵循策略：优先服务端拉取 -> 未命中/离线自动由公共清单源 (GMRC / ManifestHub / GitHub 镜像) 补充
   */
  public async fetchAndInstallManifests(
    appId: number,
    dlcs: number[] = [],
    presetKeys: { [depotId: string]: string } = {}
  ): Promise<ManifestInstallResult> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return {
        success: false,
        appId,
        downloadedCount: 0,
        totalDepots: 0,
        depotKeys: presetKeys,
        manifestFiles: [],
        source: 'none',
        message: '未检测到 Steam 客户端安装目录'
      };
    }

    const depotCacheDir = await this.ensureDepotCacheDir();
    if (!depotCacheDir) {
      return {
        success: false,
        appId,
        downloadedCount: 0,
        totalDepots: 0,
        depotKeys: presetKeys,
        manifestFiles: [],
        source: 'none',
        message: '无法初始化 Steam depotcache 缓存目录'
      };
    }

    const downloadedFiles: string[] = [];
    const aggregatedKeys: { [depotId: string]: string } = { ...presetKeys };
    let sourceUsed: 'backend' | 'gmrc' | 'manifesthub' | 'none' = 'none';

    // ==================== 策略一：优先请求后端 Manifest 聚合 API ====================
    try {
      const url = `${APP_CONFIG.API_BASE_URL}/api/manifests/${appId}`;
      const resp = await axios.get(url, {
        params: { dlcs: dlcs.join(',') },
        timeout: 3500
      });

      if (resp.data && resp.data.success) {
        if (resp.data.keys) {
          Object.assign(aggregatedKeys, resp.data.keys);
        }

        const depots = resp.data.depots || [];
        if (depots.length > 0) {
          for (const d of depots) {
            if (d.downloadUrl && d.manifestId && d.manifestId !== '0') {
              const fileName = `${d.depotId}_${d.manifestId}.manifest`;
              const targetPath = path.join(depotCacheDir, fileName);

              // 若本地已有则无需重复下载
              if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
                downloadedFiles.push(fileName);
                continue;
              }

              // 下载清单二进制流
              try {
                let fullDownloadUrl = d.downloadUrl;
                if (fullDownloadUrl.startsWith('/')) {
                  fullDownloadUrl = `${APP_CONFIG.API_BASE_URL}${fullDownloadUrl}`;
                }
                const fileResp = await axios.get(fullDownloadUrl, {
                  responseType: 'arraybuffer',
                  timeout: 5000
                });
                if (fileResp.data && fileResp.data.length > 0) {
                  fs.writeFileSync(targetPath, Buffer.from(fileResp.data));
                  downloadedFiles.push(fileName);
                }
              } catch (dlErr) {
                console.warn(`[ManifestService] 下载后端清单文件失败 (${fileName}):`, dlErr);
              }
            }
          }

          if (downloadedFiles.length > 0) {
            sourceUsed = resp.data.source === 'local_cache' ? 'backend' : (resp.data.source || 'backend');
          }
        }
      }
    } catch {
      // 后端离线或超时，自动流转到公共源兜底
    }

    // ==================== 策略二：若后端无清单或未联网，自动从 GMRC 公共清单源拉取 ====================
    let rateLimited = false;
    if (downloadedFiles.length === 0) {
      const gmrcUrls = [
        `http://gmrc.wudrm.com/manifest/${appId}`,
        `https://manifest.steam.run/manifest/${appId}`
      ];

      const axiosHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      };

      for (const gmrcUrl of gmrcUrls) {
        try {
          const resp = await axios.get(gmrcUrl, { timeout: 4000, headers: axiosHeaders });
          if (resp.data) {
            // 处理不同的返回格式：数字、纯文本或 JSON 对象
            const depotManifestPairs: Array<{ depotId: string; manifestId: string }> = [];

            if (typeof resp.data === 'number' || (typeof resp.data === 'string' && /^\d{10,}$/.test(resp.data.trim()))) {
              // 单个 ManifestID，关联主 Depot (通常为 appId + 1 或 appId)
              const mId = resp.data.toString().trim();
              const primaryDepot = Object.keys(aggregatedKeys)[0] || (appId + 1).toString();
              depotManifestPairs.push({ depotId: primaryDepot, manifestId: mId });
            } else if (Array.isArray(resp.data)) {
              for (const item of resp.data) {
                const dId = item.depot_id || item.depotId || (Array.isArray(item) ? item[0] : null);
                const mId = item.manifest_id || item.manifestId || (Array.isArray(item) ? item[1] : null);
                if (dId && mId) depotManifestPairs.push({ depotId: dId.toString(), manifestId: mId.toString() });
              }
            } else if (typeof resp.data === 'object') {
              for (const [dId, mId] of Object.entries(resp.data)) {
                if (mId && typeof mId === 'string' || typeof mId === 'number') {
                  depotManifestPairs.push({ depotId: dId, manifestId: mId.toString() });
                }
              }
            }

            for (const { depotId, manifestId } of depotManifestPairs) {
              if (depotId && manifestId && manifestId !== '0') {
                const fileName = `${depotId}_${manifestId}.manifest`;
                const targetPath = path.join(depotCacheDir, fileName);

                if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
                  downloadedFiles.push(fileName);
                  continue;
                }

                // 尝试下载 GMRC 提供的二进制清单
                const dlUrl = `${gmrcUrl}/${depotId}`;
                try {
                  const dlResp = await axios.get(dlUrl, {
                    responseType: 'arraybuffer',
                    timeout: 5000,
                    headers: axiosHeaders
                  });
                  if (dlResp.data && dlResp.data.length > 0) {
                    fs.writeFileSync(targetPath, Buffer.from(dlResp.data));
                    downloadedFiles.push(fileName);
                  }
                } catch (dlErr: any) {
                  if (dlErr.response && dlErr.response.status === 429) {
                    rateLimited = true;
                  }
                }
              }
            }

            if (downloadedFiles.length > 0) {
              sourceUsed = 'gmrc';
              break;
            }
          }
        } catch (err: any) {
          if (err.response && err.response.status === 429) {
            rateLimited = true;
          }
        }
      }
    }

    // ==================== 策略三：向 GitHub ManifestHub 加速镜像拉取 ====================
    if (downloadedFiles.length === 0) {
      try {
        const candidateDepotIds = Object.keys(aggregatedKeys);
        if (candidateDepotIds.length === 0) {
          // 兜底候选 depot ID
          candidateDepotIds.push(appId.toString(), (appId + 1).toString(), (appId + 2).toString());
        }

        const proxyBase = 'https://ghfast.top/https://raw.githubusercontent.com/ManifestHub';

        for (const dId of candidateDepotIds.slice(0, 5)) {
          const infoUrls = [
            `${proxyBase}/Manifest/main/${dId}.json`,
            `${proxyBase}/Manifest-Index/main/data/${appId}/${dId}.json`
          ];

          for (const iu of infoUrls) {
            try {
              const resp = await axios.get(iu, { timeout: 2500 });
              if (resp.data && (resp.data.manifest_id || resp.data.manifestId)) {
                const mId = (resp.data.manifest_id || resp.data.manifestId).toString();
                const fileName = `${dId}_${mId}.manifest`;
                const targetPath = path.join(depotCacheDir, fileName);

                if (fs.existsSync(targetPath) && fs.statSync(targetPath).size > 0) {
                  downloadedFiles.push(fileName);
                  continue;
                }

                const fileUrl = resp.data.download_url || `${proxyBase}/Manifest/main/${dId}_${mId}.manifest`;
                const dlResp = await axios.get(fileUrl, {
                  responseType: 'arraybuffer',
                  timeout: 5000
                });
                if (dlResp.data && dlResp.data.length > 0) {
                  fs.writeFileSync(targetPath, Buffer.from(dlResp.data));
                  downloadedFiles.push(fileName);
                }
              }
            } catch {}
          }
        }

        if (downloadedFiles.length > 0) {
          sourceUsed = 'manifesthub';
        }
      } catch {}
    }

    // 统计已有清单
    const currentStatus = await this.checkAppManifestStatus(appId, dlcs);
    const hasManifest = currentStatus.hasManifest || downloadedFiles.length > 0;

    let returnMessage = '';
    if (hasManifest) {
      returnMessage = `成功就绪 ${currentStatus.manifestCount || downloadedFiles.length} 个分包清单 (.manifest)！已完全消除“无许可”限制。`;
    } else if (rateLimited) {
      returnMessage = `上游公共清单源触发高频防刷限制 (429 限流)。请确保已部署 OST 注入内核并重启 Steam，Steam 将在下载时通过内部通道动态拉取！`;
    } else {
      returnMessage = `暂无预存静态清单。请确保已部署 OST 注入内核并重启 Steam，即可通过动态清单通道直接下载。`;
    }

    return {
      success: hasManifest,
      appId,
      downloadedCount: downloadedFiles.length,
      totalDepots: currentStatus.manifestCount,
      depotKeys: aggregatedKeys,
      manifestFiles: currentStatus.manifestFiles,
      source: sourceUsed,
      message: returnMessage
    };
  }

  /**
   * 检查本地 Steam/depotcache 目录中是否已存在该 App 的分包清单文件
   */
  public async checkAppManifestStatus(appId: number, dlcs: number[] = []): Promise<AppManifestStatus> {
    const steamPath = await steamService.detectSteamPath();
    if (!steamPath) {
      return { appId, hasManifest: false, manifestCount: 0, matchedDepots: [], manifestFiles: [] };
    }

    const depotCacheDir = path.join(steamPath, 'depotcache');
    if (!fs.existsSync(depotCacheDir)) {
      return { appId, hasManifest: false, manifestCount: 0, matchedDepots: [], manifestFiles: [] };
    }

    // 候选 depot 范围
    const candidateDepotIds = new Set<string>();
    for (let i = 0; i <= 30; i++) {
      candidateDepotIds.add((appId + i).toString());
    }
    for (const dlc of dlcs) {
      for (let j = 0; j <= 10; j++) {
        candidateDepotIds.add((dlc + j).toString());
      }
    }

    try {
      const files = fs.readdirSync(depotCacheDir);
      const matchedDepots = new Set<string>();
      const manifestFiles: string[] = [];

      for (const file of files) {
        const match = file.match(/^(\d+)_(\d+)\.manifest$/i);
        if (match) {
          const [, dId] = match;
          if (candidateDepotIds.has(dId)) {
            matchedDepots.add(dId);
            manifestFiles.push(file);
          }
        }
      }

      return {
        appId,
        hasManifest: manifestFiles.length > 0,
        manifestCount: manifestFiles.length,
        matchedDepots: Array.from(matchedDepots),
        manifestFiles
      };
    } catch {
      return { appId, hasManifest: false, manifestCount: 0, matchedDepots: [], manifestFiles: [] };
    }
  }
}

export const manifestService = new ManifestService();
