import fs from 'fs';
import path from 'path';
import axios, { AxiosRequestConfig } from 'axios';
import AdmZip from 'adm-zip';
import { CONFIG } from '../config/index.js';
import { depotService } from './depotService.js';
import { parseLuaManifestText } from '../utils/luaManifestParser.js';

/// 上游清单 ZIP 下载体积上限（50MB）：防止超大响应或 zip 炸弹耗尽服务端内存
const MAX_UPSTREAM_ZIP_BYTES = 50 * 1024 * 1024;
/// 解压侧限制：单条目 ≤50MB，总条目数 ≤2000，防止声明式膨胀与海量写入阻塞事件循环
const MAX_ZIP_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;
/// 单个清单实体落盘上限：清单本体不应达到该量级，超过即为异常/劫持内容
const MAX_MANIFEST_BYTES = 512 * 1024 * 1024;

/**
 * 并发竞速下载：首个通过 accept 校验的响应胜出，并在返回前 abort 其余请求。
 *
 * 为什么必须 abort：原实现用裸 Promise.any，失败者不会被取消 —— 每次回源
 * 最坏 16 个 URL（2 个候选 AppID × 4 镜像 × 2 个仓库）各自带 50MB 上限
 * 继续跑完，单次请求可产生数百 MB 的无用下行，并被上层「每个 depot 一路」
 * 的沉淀循环再放大一遍。
 */
async function raceDownload(
  urls: string[],
  config: AxiosRequestConfig,
  accept: (data: any, response: any) => boolean
): Promise<any | null> {
  const controller = new AbortController();
  const tasks = urls.map(async (url) => {
    const resp = await axios.get(url, { ...config, signal: controller.signal });
    if (resp.status === 200 && accept(resp.data, resp)) return resp.data;
    throw new Error('Upstream response rejected');
  });
  try {
    return await Promise.any(tasks);
  } catch {
    return null;
  } finally {
    // 胜出/全败后立即取消仍在途的连接，避免带宽与套接字被失败者白占
    controller.abort();
  }
}

export interface DepotManifestInfo {
  depotId: string;
  manifestId: string;
  manifestFileName?: string;
  downloadUrl?: string;
  source?: string;
  key?: string;
  /** 该分包所属 DLC 的 AppID（P-ToyStore appinfo.vdf 的 dlcappid），用于补齐 dlcIds */
  dlcAppId?: string;
}

/**
 * 清单请求码的查询结果。
 *
 * 存在的唯一理由：把「权威源确认没有这个 gid」与「上游暂时不可用」分开。
 * 前者应回 404 并允许客户端写负缓存；后者必须回 503 且**绝不**允许写负缓存 ——
 * 混为一谈会让一次上游 429 抖动被固化成「该 gid 两分钟内所有客户端都取不到码」。
 */
export interface ManifestCodeResult {
  /** 取到的请求码；为 null 时依据下面两个标志决定回 404 还是 503 */
  code: string | null;
  /** 权威源明确回答「没有这个 gid」—— 只有它为真才该回 404 并写负缓存 */
  definitiveMiss: boolean;
  /** 至少一轮遇到上游过载/超时/质询 —— 必须回 503，让客户端立刻重试 */
  transient: boolean;
}

export interface AppManifestResult {
  success: boolean;
  appId: number;
  source: 'local_cache' | 'gmrc' | 'manifesthub' | 'steamml' | 'remlua' | 'manifesthub_uk' | 'ptystore' | 'none';
  depots: DepotManifestInfo[];
  keys: { [depotId: string]: string };
  message: string;
  /** 上游失败明细：区分「确实未收录」与「上游全挂」，便于排障与客户端降级提示 */
  upstreamErrors?: Array<{ source: string; error: string }>;
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
  // 结果缓存 + 在途去重：该端点是完整上游链（P-ToyStore 4 镜像 → SteamML/Remlua/ManifestHub3
  // 并发 → ManifestHub.uk）的入口，原实现每个请求都重跑一遍全部上游。
  private manifestResultCache = new Map<string, { ts: number; result: AppManifestResult }>();
  private manifestResultInFlight = new Map<string, Promise<AppManifestResult>>();
  private static readonly MANIFEST_RESULT_TTL_MS = 10 * 60 * 1000;
  private static readonly MANIFEST_RESULT_CACHE_MAX = 500;

  public async getManifestsForApp(appId: number, dlcs: number[] = []): Promise<AppManifestResult> {
    const cacheKey = `${appId}|${[...dlcs].sort((a, b) => a - b).join(',')}`;
    const cached = this.manifestResultCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < ManifestService.MANIFEST_RESULT_TTL_MS) {
      return cached.result;
    }
    const running = this.manifestResultInFlight.get(cacheKey);
    if (running) return running;

    const task = this.buildManifestsForApp(appId, dlcs);
    this.manifestResultInFlight.set(cacheKey, task);
    try {
      const result = await task;
      this.setManifestResultCache(cacheKey, result);
      return result;
    } finally {
      this.manifestResultInFlight.delete(cacheKey);
    }
  }

  private setManifestResultCache(key: string, result: AppManifestResult): void {
    this.manifestResultCache.set(key, { ts: Date.now(), result });
    if (this.manifestResultCache.size <= ManifestService.MANIFEST_RESULT_CACHE_MAX) return;
    const now = Date.now();
    for (const [k, v] of this.manifestResultCache) {
      if (now - v.ts >= ManifestService.MANIFEST_RESULT_TTL_MS) this.manifestResultCache.delete(k);
    }
    while (this.manifestResultCache.size > ManifestService.MANIFEST_RESULT_CACHE_MAX) {
      const oldest = this.manifestResultCache.keys().next().value;
      if (oldest === undefined) break;
      this.manifestResultCache.delete(oldest);
    }
  }

  private async buildManifestsForApp(appId: number, dlcs: number[] = []): Promise<AppManifestResult> {
    // 清单链路不需要 Store API 头图：跳过可省去服务器侧 4 秒超时白等
    const keys = await depotService.getDepotsForGame(appId, dlcs, { skipRemoteHeader: true });
    const candidateDepotIds = Object.keys(keys);
    const upstreamErrors: Array<{ source: string; error: string }> = [];

    // 1. 检查服务端本地 manifests/ 缓存目录（支持扁平与 ManifestHub3 标准 AppID 树形目录）
    const localDepots = this.scanLocalManifests(candidateDepotIds, appId);
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

    // 2. 核心分级检索：优先尝试每日自动同步的 P-ToyStore (涵盖最新热门与付费大作最新 GID)
    try {
      const pToy = await this.fetchFromPToyStore(appId, candidateDepotIds);
      if (pToy.depots.length > 0) {
        return {
          success: true,
          appId,
          source: 'ptystore',
          depots: pToy.depots,
          keys,
          message: `从云端日更清单库极速检索到 ${pToy.depots.length} 个最新分包清单！`
        };
      }
    } catch (err: any) {
      upstreamErrors.push({ source: 'ptystore', error: err?.message || String(err) });
      console.warn(`[ManifestService] P-ToyStore 检索异常 (${appId}):`, err?.message || err);
    }

    // 3. 多源并发竞速兜底：SteamML (Cloudflare R2) + Remlua (AWS CloudFront) + ManifestHub3 高速镜像并行检索 (全量与免费游戏)
    const [steamResult, remluaResult, hubResult] = await Promise.allSettled([
      this.fetchFromSteamML(appId, candidateDepotIds),
      this.fetchFromRemlua(appId, candidateDepotIds),
      this.fetchFromManifestHub(appId, candidateDepotIds)
    ]);

    if (steamResult.status === 'rejected') {
      upstreamErrors.push({ source: 'steamml', error: steamResult.reason?.message || String(steamResult.reason) });
    }
    if (remluaResult.status === 'rejected') {
      upstreamErrors.push({ source: 'remlua', error: remluaResult.reason?.message || String(remluaResult.reason) });
    }
    if (hubResult.status === 'rejected') {
      upstreamErrors.push({ source: 'manifesthub', error: hubResult.reason?.message || String(hubResult.reason) });
    }

    const smlList = steamResult.status === 'fulfilled' ? steamResult.value : [];
    const remluaList = remluaResult.status === 'fulfilled' ? remluaResult.value : [];
    const hubList = hubResult.status === 'fulfilled' ? hubResult.value : [];

    // 优先采用具备完整实体文件的全球边缘 CDN (SteamML R2 / Remlua CloudFront)
    if (smlList && smlList.length > 0) {
      return {
        success: true,
        appId,
        source: 'steamml',
        depots: smlList,
        keys,
        message: `从 SteamML 清单库极速检索到 ${smlList.length} 个分包清单！`
      };
    }

    if (remluaList && remluaList.length > 0) {
      return {
        success: true,
        appId,
        source: 'remlua',
        depots: remluaList,
        keys,
        message: `从 Remlua CloudFront 极速检索到 ${remluaList.length} 个分包清单！`
      };
    }

    if (hubList && hubList.length > 0) {
      return {
        success: true,
        appId,
        source: 'manifesthub',
        depots: hubList,
        keys,
        message: `从云端清单库检索到 ${hubList.length} 个分包清单！`
      };
    }

    // 4. 末位冷备容灾：ManifestHub.uk（严格限制触发条件，防止触发单 IP 频控，且一旦命中即落盘本地缓存）
    try {
      const mhUkResult = await this.fetchFromManifestHubUK(appId, candidateDepotIds);
      if (mhUkResult && mhUkResult.length > 0) {
        return {
          success: true,
          appId,
          source: 'manifesthub_uk',
          depots: mhUkResult,
          keys,
          message: `从 ManifestHub.uk 检索到 ${mhUkResult.length} 个分包清单！`
        };
      }
    } catch (err: any) {
      upstreamErrors.push({ source: 'manifesthub_uk', error: err?.message || String(err) });
      console.warn(`[ManifestService] ManifestHub.uk 检索失败 (${appId}):`, err?.message || err);
    }

    // 全部来源均失败且确有错误记录 → 这是上游故障，不是「未收录」，必须区分开
    if (upstreamErrors.length > 0 && this.manifestDirHasNoLocalEvidence(candidateDepotIds)) {
      return {
        success: false,
        appId,
        source: 'none',
        depots: [],
        keys,
        message: '上游清单源暂时不可用，请稍后重试（并非确认未收录）',
        upstreamErrors
      };
    }

    return {
      success: false,
      appId,
      source: 'none',
      depots: [],
      keys,
      message: '暂时没有这款游戏（云端暂未收录该游戏的清单文件）',
      upstreamErrors: upstreamErrors.length > 0 ? upstreamErrors : undefined
    };
  }

  /** 本地是否没有任何相关清单实体（用于区分「未收录」与「上游故障」） */
  private manifestDirHasNoLocalEvidence(depotIds: string[]): boolean {
    const index = this.getManifestIndex();
    if (depotIds.length === 0) return index.flat.size === 0;
    for (const d of depotIds) {
      if (index.flatByDepot.has(d) || index.appDirByDepot.has(d)) return false;
    }
    return true;
  }

  // ==================== 清单目录内存索引 ====================
  //
  // 原实现每次 getLocalManifestFilePath / scanLocalManifests 都同步 readdirSync
  // 整个 manifests 目录（上限 2 万个文件），而 metadataController.computeManifestInfo
  // 会为每个 depot 各调用一次 —— 100 分包的游戏 = 上百次同步全目录扫描，
  // 全部阻塞事件循环。改为启动时建立一次索引、写入时增量维护。
  private manifestIndex: {
    flat: Map<string, string>;
    appDir: Map<string, Map<string, string>>;
    flatByDepot: Map<string, string[]>;
    appDirByDepot: Map<string, string[]>;
  } | null = null;

  private getManifestIndex() {
    if (this.manifestIndex) return this.manifestIndex;
    const flat = new Map<string, string>();
    const appDir = new Map<string, Map<string, string>>();
    const flatByDepot = new Map<string, string[]>();
    const appDirByDepot = new Map<string, string[]>();

    const addFlat = (name: string, fullPath: string) => {
      flat.set(name, fullPath);
      const depotId = name.split('_')[0];
      if (/^\d+$/.test(depotId)) {
        const arr = flatByDepot.get(depotId);
        if (arr) arr.push(name);
        else flatByDepot.set(depotId, [name]);
      }
    };
    const addAppDir = (appId: string, name: string, fullPath: string) => {
      let m = appDir.get(appId);
      if (!m) { m = new Map(); appDir.set(appId, m); }
      m.set(name, fullPath);
      const depotId = name.split('_')[0];
      if (/^\d+$/.test(depotId)) {
        const arr = appDirByDepot.get(depotId);
        if (arr) arr.push(name);
        else appDirByDepot.set(depotId, [name]);
      }
    };

    try {
      for (const entry of fs.readdirSync(this.manifestDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.manifest')) {
          addFlat(entry.name, path.join(this.manifestDir, entry.name));
        } else if (entry.isDirectory() && /^\d+$/.test(entry.name)) {
          const dir = path.join(this.manifestDir, entry.name);
          try {
            for (const f of fs.readdirSync(dir)) {
              if (f.endsWith('.manifest')) addAppDir(entry.name, f, path.join(dir, f));
            }
          } catch {}
        }
      }
    } catch (e) {
      console.warn('[ManifestService] 建立清单目录索引失败:', e);
    }

    this.manifestIndex = { flat, appDir, flatByDepot, appDirByDepot };
    return this.manifestIndex;
  }

  private indexAddFile(filePath: string, appId?: number | string): void {
    const index = this.getManifestIndex();
    const name = path.basename(filePath);
    if (!name.endsWith('.manifest')) return;
    const parent = path.dirname(filePath);
    if (parent === this.manifestDir) {
      index.flat.set(name, filePath);
      const depotId = name.split('_')[0];
      const arr = index.flatByDepot.get(depotId);
      if (arr) { if (!arr.includes(name)) arr.push(name); }
      else index.flatByDepot.set(depotId, [name]);
    } else if (appId !== undefined) {
      let m = index.appDir.get(String(appId));
      if (!m) { m = new Map(); index.appDir.set(String(appId), m); }
      m.set(name, filePath);
      const depotId = name.split('_')[0];
      const arr = index.appDirByDepot.get(depotId);
      if (arr) { if (!arr.includes(name)) arr.push(name); }
      else index.appDirByDepot.set(depotId, [name]);
    }
  }

  private indexRemoveFile(filePath: string): void {
    const index = this.getManifestIndex();
    const name = path.basename(filePath);
    const parent = path.dirname(filePath);
    if (parent === this.manifestDir) {
      index.flat.delete(name);
      const depotId = name.split('_')[0];
      const arr = index.flatByDepot.get(depotId);
      if (arr) {
        const i = arr.indexOf(name);
        if (i >= 0) arr.splice(i, 1);
      }
    } else {
      const appId = path.basename(parent);
      const m = index.appDir.get(appId);
      if (m) m.delete(name);
      const depotId = name.split('_')[0];
      const arr = index.appDirByDepot.get(depotId);
      if (arr) {
        const i = arr.indexOf(name);
        if (i >= 0) arr.splice(i, 1);
      }
    }
  }

  /**
   * 扫描本地 manifests/ 目录下匹配 depotId 的 .manifest 文件
   * 支持两种存放方式：
   * 1. ManifestHub3 标准树形结构：manifests/<appId>/<depotId>_<manifestId>.manifest 及 <appId>.json
   * 2. 全局扁平存放：manifests/<depotId>_<manifestId>.manifest
   */
  private scanLocalManifests(depotIds: string[], appId?: number): DepotManifestInfo[] {
    const results: DepotManifestInfo[] = [];
    const matchedDepots = new Set<string>();
    const index = this.getManifestIndex();
    const want = (dId: string) => depotIds.length === 0 || depotIds.includes(dId);

    // 1. 优先检查本地 ManifestHub3 标准 AppID 结构目录: manifests/<appId>/
    if (appId) {
      const appDir = path.join(this.manifestDir, String(appId));
      const appJsonPath = path.join(appDir, `${appId}.json`);

      // 若存在本地 {appId}.json，直接解析提取精准的 depotId -> gid 映射与密钥
      if (fs.existsSync(appJsonPath)) {
        try {
          const raw = fs.readFileSync(appJsonPath, 'utf-8');
          const data = JSON.parse(raw);
          if (data && data.depot && typeof data.depot === 'object') {
            for (const [dId, dInfo] of Object.entries<any>(data.depot)) {
              if (!want(dId)) continue;
              let gid: string | undefined;
              if (dInfo.manifests && typeof dInfo.manifests === 'object') {
                gid = dInfo.manifests.public?.gid || Object.values<any>(dInfo.manifests)[0]?.gid;
              }
              if (gid && gid !== '0' && /^\d+$/.test(gid.toString())) {
                const manifestFile = path.join(appDir, `${dId}_${gid}.manifest`);
                const flatFile = path.join(this.manifestDir, `${dId}_${gid}.manifest`);
                // 无论清单实体在 appDir 还是平铺在 manifestDir，只要存在即可（走内存索引）
                if (index.flat.has(`${dId}_${gid}.manifest`) || index.appDir.get(String(appId))?.has(`${dId}_${gid}.manifest`)) {
                  matchedDepots.add(dId);
                  results.push({
                    depotId: dId,
                    manifestId: gid.toString(),
                    manifestFileName: `${dId}_${gid}.manifest`,
                    downloadUrl: `/api/manifests/download/${dId}/${gid}?appId=${appId}`,
                    source: 'local_cache',
                    key: (dInfo.decryptionkey && typeof dInfo.decryptionkey === 'string' && dInfo.decryptionkey.length >= 32)
                      ? dInfo.decryptionkey
                      : (depotService.getDepotKey(dId) || undefined)
                  });
                }
              }
            }
          }
        } catch {}
      }

      // 扫描 appId 子目录下的所有 .manifest 实体（内存索引，无同步 readdir）
      const appFiles = index.appDir.get(String(appId));
      if (appFiles) {
        for (const file of appFiles.keys()) {
          const match = file.match(/^(\d+)_(\d+)\.manifest$/i);
          if (match) {
            const [, dId, mId] = match;
            if (!matchedDepots.has(dId) && want(dId)) {
              matchedDepots.add(dId);
              results.push({
                depotId: dId,
                manifestId: mId,
                manifestFileName: file,
                downloadUrl: `/api/manifests/download/${dId}/${mId}?appId=${appId}`,
                source: 'local_cache',
                key: depotService.getDepotKey(dId) || undefined
              });
            }
          }
        }
      }
    }

    // 2. 扫描扁平根目录: manifests/<depotId>_<manifestId>.manifest（内存索引）
    for (const file of index.flat.keys()) {
      const match = file.match(/^(\d+)_(\d+)\.manifest$/i);
      if (match) {
        const [, dId, mId] = match;
        if (!matchedDepots.has(dId) && want(dId)) {
          matchedDepots.add(dId);
          results.push({
            depotId: dId,
            manifestId: mId,
            manifestFileName: file,
            downloadUrl: `/api/manifests/download/${dId}/${mId}${appId ? `?appId=${appId}` : ''}`,
            source: 'local_cache',
            key: depotService.getDepotKey(dId) || undefined
          });
        }
      }
    }

    return results;
  }

  /**
   * 解析 P-ToyStore 的 appinfo.vdf 纯文本，提取各分包的最新 GID、DLC 关联与 buildId
   */
  public parseAppInfoVdf(text: string): {
    depots: Map<string, { gid?: string; dlcAppId?: string }>;
    buildId?: string;
  } {
    const result = {
      depots: new Map<string, { gid?: string; dlcAppId?: string }>(),
      buildId: undefined as string | undefined
    };

    if (!text) return result;

    const buildMatch = text.match(/"buildid"\s+"(\d+)"/i);
    if (buildMatch) {
      result.buildId = buildMatch[1];
    }

    const depotsIndex = text.search(/"depots"\s*\{/i);
    if (depotsIndex === -1) return result;

    const braceIndex = text.indexOf('{', depotsIndex);
    if (braceIndex === -1) return result;

    let depth = 0;
    let endIndex = -1;
    for (let i = braceIndex; i < text.length; i++) {
      const char = text[i];
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }

    if (endIndex === -1) endIndex = text.length;
    const depotsContent = text.substring(braceIndex + 1, endIndex);

    const depotRegex = /"(\d+)"\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = depotRegex.exec(depotsContent)) !== null) {
      const depotId = match[1];
      const blockStart = match.index + match[0].length - 1;
      let dDepth = 0;
      let blockEnd = -1;
      for (let j = blockStart; j < depotsContent.length; j++) {
        if (depotsContent[j] === '{') dDepth++;
        else if (depotsContent[j] === '}') {
          dDepth--;
          if (dDepth === 0) {
            blockEnd = j;
            break;
          }
        }
      }
      if (blockEnd !== -1) {
        const depotBlock = depotsContent.substring(blockStart, blockEnd + 1);
        let gidMatch = depotBlock.match(/"public"\s*\{[^}]*?"gid"\s*"(\d+)"/s);
        if (!gidMatch) {
          gidMatch = depotBlock.match(/"gid"\s*"(\d+)"/);
        }
        const dlcMatch = depotBlock.match(/"dlcappid"\s*"(\d+)"/i);
        const gid = gidMatch && gidMatch[1] !== '0' ? gidMatch[1] : undefined;
        const dlcAppId = dlcMatch ? dlcMatch[1] : undefined;

        if (gid || dlcAppId) {
          result.depots.set(depotId, { gid, dlcAppId });
        }
      }
    }

    return result;
  }

  /**
   * 从 P-ToyStore (SteamManifestCache_Pro) 高速镜像源检索（独立 App 分支，每日自动同步最新付费大作）。
   * 返回 depots 的同时带出 buildId，供上层做跨源"取最新"裁决。
   *
   * 注意：本函数**不做**清单沉淀（不调用 ensureManifestCached）。
   * 它会被 metadata 查询热路径调用，若在此逐个触发下载，等于每次查询都为该游戏所有
   * depot 起一轮后台回源，既耗服务器带宽又极易触发上游频控。
   */
  public async fetchFromPToyStore(
    appId: number,
    depotIds: string[] = []
  ): Promise<{ depots: DepotManifestInfo[]; buildId?: string }> {
    const results: DepotManifestInfo[] = [];
    const fastBases = [
      'https://steam.os.kg/https://raw.githubusercontent.com/P-ToyStore/SteamManifestCache_Pro',
      'https://ghfast.top/https://raw.githubusercontent.com/P-ToyStore/SteamManifestCache_Pro',
      'https://gh-proxy.com/https://raw.githubusercontent.com/P-ToyStore/SteamManifestCache_Pro',
      'https://cece.guyunsq.com/https://raw.githubusercontent.com/P-ToyStore/SteamManifestCache_Pro'
    ];

    let buildId: string | undefined;
    const urls = fastBases.map((base) => `${base}/${appId}/appinfo.vdf`);
    const vdfText = await raceDownload(
      urls,
      { timeout: 2500, responseType: 'text', transformResponse: [(data: any) => data] },
      (data) => typeof data === 'string' && data.includes('"depots"')
    );

    if (typeof vdfText === 'string') {
      const parsed = this.parseAppInfoVdf(vdfText);
      buildId = parsed.buildId;
      for (const [dId, dInfo] of parsed.depots) {
        if (depotIds.length > 0 && !depotIds.includes(dId)) continue;
        if (dInfo.gid && dInfo.gid !== '0' && /^\d+$/.test(dInfo.gid)) {
          const key = depotService.getDepotKey(dId) || undefined;
          results.push({
            depotId: dId,
            manifestId: dInfo.gid,
            manifestFileName: `${dId}_${dInfo.gid}.manifest`,
            downloadUrl: `/api/manifests/download/${dId}/${dInfo.gid}?appId=${appId}`,
            source: 'ptystore',
            key,
            // 带上 DLC 归属，避免上层丢失 DLC 列表
            dlcAppId: dInfo.dlcAppId
          });
        }
      }
    }

    return { depots: results, buildId };
  }

  /**
   * 从 GitHub ManifestHub3 加速源检索（并发竞速极速通道）
   */
  private async fetchFromManifestHub(appId: number, depotIds: string[]): Promise<DepotManifestInfo[]> {
    const results: DepotManifestInfo[] = [];
    const fastBases = [
      'https://steam.os.kg/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://ghfast.top/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://gh-proxy.com/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://cece.guyunsq.com/https://raw.githubusercontent.com/steamtools-games/ManifestHub3'
    ];

    // 1. 优先并发拉取 {appId}.json（首个成功即取消其余请求）
    const data = await raceDownload(
      fastBases.map((base) => `${base}/${appId}/${appId}.json`),
      { timeout: 2500 },
      (d) => !!d && typeof d === 'object' && !!d.depot && typeof d.depot === 'object'
    );

    if (data && data.depot) {
      for (const [dId, dInfo] of Object.entries<any>(data.depot)) {
        if (depotIds.length > 0 && !depotIds.includes(dId)) continue;
        let gid: string | undefined;
        if (dInfo.manifests && typeof dInfo.manifests === 'object') {
          gid = dInfo.manifests.public?.gid || Object.values<any>(dInfo.manifests)[0]?.gid;
        }
        if (gid && gid !== '0' && /^\d+$/.test(gid.toString())) {
          const key = (dInfo.decryptionkey && typeof dInfo.decryptionkey === 'string' && dInfo.decryptionkey.length >= 32)
            ? dInfo.decryptionkey
            : (depotService.getDepotKey(dId) || undefined);
          results.push({
            depotId: dId,
            manifestId: gid.toString(),
            manifestFileName: `${dId}_${gid}.manifest`,
            downloadUrl: `/api/manifests/download/${dId}/${gid}?appId=${appId}`,
            source: 'manifesthub',
            key
          });
        }
      }
    }

    // 2. 若 json 失败，兜底并发尝试拉取 {appId}.lua / {appId}_public.lua
    if (results.length === 0) {
      const luaUrls: string[] = [];
      for (const base of fastBases) {
        luaUrls.push(`${base}/${appId}/${appId}.lua`);
        luaUrls.push(`${base}/${appId}/${appId}_public.lua`);
      }
      const lua = await raceDownload(
        luaUrls,
        { timeout: 2500 },
        (d) => typeof d === 'string' && (d.includes('setManifestid') || d.includes('addappid'))
      );
      if (typeof lua === 'string') {
        // 统一解析器：与其它源/其它链路使用完全一致的正则规则
        const parsed = parseLuaManifestText(lua, appId);
        for (const [dId, gid] of parsed.manifestGids) {
          if (depotIds.length > 0 && !depotIds.includes(dId)) continue;
          const key = parsed.depotKeys.get(dId) || depotService.getDepotKey(dId) || undefined;
          results.push({
            depotId: dId,
            manifestId: gid,
            manifestFileName: `${dId}_${gid}.manifest`,
            downloadUrl: `/api/manifests/download/${dId}/${gid}?appId=${appId}`,
            source: 'manifesthub',
            key
          });
        }
      }
    }

    // 注意：此处**不**触发沉淀。该函数会被 getManifestsForApp 调用，
    // 若为每个结果各起一路回源下载，等价于每个清单列表请求都为该 App
    // 全部 depot 发起一轮上游请求（每路又是多镜像竞速），带宽与频控双爆。
    // 沉淀只由明确的下载路径（/api/manifests/download → ensureManifestCached）触发。
    return results;
  }

  /**
   * ManifestHub.uk 确定性密钥代换加密算法
   */
  public encodeManifestHubUKCipher(appId: number | string): string {
    // 密钥可经环境变量覆盖；默认值仅为兼容上游协议的历史常量，不构成安全边界
    const SECRET_KEY = process.env.MANIFESTHUB_UK_SECRET || 'N4F1S_FU4D_OWN_SYSTEM_2025';
    const str = String(appId);
    const table = '0123456789'.split('');
    let seed = 0;
    for (let i = 0; i < SECRET_KEY.length; i++) {
      seed = (seed * 31 + SECRET_KEY.charCodeAt(i)) & 0xffff;
    }
    for (let i = table.length - 1; i > 0; i--) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const j = seed % (i + 1);
      [table[i], table[j]] = [table[j], table[i]];
    }
    let substituted = '';
    for (let i = 0; i < str.length; i++) {
      substituted += table[parseInt(str[i], 10)];
    }
    const lengthChar = String.fromCharCode(65 + (str.length - 1));
    let sum = 0;
    for (let i = 0; i < str.length; i++) {
      sum += parseInt(str[i], 10);
    }
    const checksum = (sum * 7) % 10;
    return lengthChar + checksum + substituted;
  }

  /**
   * 从 SteamML (Cloudflare R2 直连桶) 检索并解压清单实体
   */
  public async fetchFromSteamML(appId: number, depotIds: string[] = []): Promise<DepotManifestInfo[]> {
    const url = `https://pub-5b6d3b7c03fd4ac1afb5bd3017850e20.r2.dev/${appId}.zip`;
    const data = await raceDownload(
      [url],
      { responseType: 'arraybuffer', timeout: 7000, maxContentLength: MAX_UPSTREAM_ZIP_BYTES },
      (d) => !!d && d.byteLength > 0
    );
    if (data) {
      return this.unpackZipAndExtractManifests(appId, Buffer.from(data), depotIds, 'steamml');
    }
    return [];
  }

  /**
   * 从 Remlua (AWS CloudFront 直连 CDN) 检索并解压清单实体
   */
  public async fetchFromRemlua(appId: number, depotIds: string[] = []): Promise<DepotManifestInfo[]> {
    const url = `https://d41hvr6rtvs2p.cloudfront.net/${appId}.zip`;
    const data = await raceDownload(
      [url],
      { responseType: 'arraybuffer', timeout: 7000, maxContentLength: MAX_UPSTREAM_ZIP_BYTES },
      (d) => !!d && d.byteLength > 0
    );
    if (data) {
      return this.unpackZipAndExtractManifests(appId, Buffer.from(data), depotIds, 'remlua');
    }
    return [];
  }

  /** 单次检索允许跟随的下载链接数上限（防上游 HTML 异常导致无界顺序下载） */
  private static readonly MAX_UK_DOWNLOAD_LINKS = 8;

  /**
   * 从 ManifestHub.uk 检索并解压清单实体
   */
  public async fetchFromManifestHubUK(appId: number, depotIds: string[] = []): Promise<DepotManifestInfo[]> {
    const encId = this.encodeManifestHubUKCipher(appId);
    const proxyUrl = `https://api.manifesthub.uk/proxy?id=${encId}`;
    const htmlResp = await axios.get(proxyUrl, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://steamtools.pages.dev/'
      }
    });
    const html = typeof htmlResp.data === 'string' ? htmlResp.data : '';
    const downloadMatches = Array.from(html.matchAll(/href="(\/download\?[^"]+)"/g))
      .map((m) => m[1])
      .slice(0, ManifestService.MAX_UK_DOWNLOAD_LINKS);

    for (const href of downloadMatches) {
      try {
        const dlUrl = `https://api.manifesthub.uk${href}`;
        const zipResp = await axios.get(dlUrl, {
          responseType: 'arraybuffer',
          timeout: 10000,
          maxContentLength: MAX_UPSTREAM_ZIP_BYTES,
          headers: {
            'User-Agent': 'Mozilla/5.0',
            Referer: proxyUrl
          }
        });
        if (zipResp.status === 200 && zipResp.data && zipResp.data.byteLength > 0) {
          const list = this.unpackZipAndExtractManifests(appId, Buffer.from(zipResp.data), depotIds, 'manifesthub_uk');
          if (list.length > 0) return list;
        }
      } catch {}
    }
    return [];
  }

  /**
   * 解包 ZIP 归档，从中提取 Lua 规则并沉淀 .manifest 实体到本地缓存目录
   */
  public unpackZipAndExtractManifests(
    appId: number,
    zipBuffer: Buffer,
    filterDepotIds: string[] = [],
    sourceName: string = 'upstream_zip'
  ): DepotManifestInfo[] {
    const results: DepotManifestInfo[] = [];
    try {
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();

      // 条目数上限：与 parseLuaFromZip 保持一致的入口防护，
      // 否则几十万条目会被逐个 readFile 解压并写盘
      if (entries.length > MAX_ZIP_ENTRIES) {
        console.warn(`[ManifestService] ZIP 条目数超限 (${entries.length} > ${MAX_ZIP_ENTRIES})，已跳过解包 (${appId})`);
        return results;
      }

      let luaContent = '';
      const manifestEntries: Array<{ depotId: string; manifestId: string; entry: any }> = [];

      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const name = path.basename(entry.entryName);
        if (name.endsWith('.lua')) {
          luaContent += zip.readAsText(entry) + '\n';
        } else {
          const match = name.match(/^(\d+)_(\d+)\.manifest$/i);
          if (match) {
            manifestEntries.push({
              depotId: match[1],
              manifestId: match[2],
              entry
            });
          }
        }
      }

      // 解析 Lua 获取 key 和 gid（统一解析器，正则与其它链路一致）
      const parsedLua = parseLuaManifestText(luaContent, appId);
      const gidMap = parsedLua.manifestGids;
      const keyMap = parsedLua.depotKeys;

      // 解压并落盘所有 .manifest 文件
      let extractedBytes = 0;
      for (const item of manifestEntries) {
        // 解压体积上限：必须在**真实解压后**按 fileData.length 计量。
        // 原先用 entry.header.size（zip 中央目录里的声明值）判断，攻击者
        // 可把它伪造成 0 绕过限制，而 readFile 仍会在内存中真实解压出全部内容。
        const declared = typeof item.entry?.header?.size === 'number' ? item.entry.header.size : 0;
        if (declared > MAX_ZIP_ENTRY_BYTES || extractedBytes + declared > MAX_UPSTREAM_ZIP_BYTES) {
          console.warn(`[ManifestService] ZIP 声明体积超限，已跳过剩余条目 (已解压 ${extractedBytes} 字节)`);
          break;
        }
        const fileData = zip.readFile(item.entry);
        if (!fileData) continue;
        // 真实体积复核：以解压结果为准累计，声明值不可信
        if (fileData.length > MAX_ZIP_ENTRY_BYTES || extractedBytes + fileData.length > MAX_UPSTREAM_ZIP_BYTES) {
          console.warn(`[ManifestService] ZIP 实际解压量超限，已停止解包 (已解压 ${extractedBytes} 字节)`);
          break;
        }
        extractedBytes += fileData.length;

        if (this.isValidManifestBuffer(fileData)) {
          // 单一落盘位置（扁平目录）：getLocalManifestFilePath 优先查扁平，
          // 原先再往 manifests/<appId>/ 写一份副本会造成磁盘双份且子目录文件
          // 不受淘汰上限约束，长期无界增长。
          this.saveManifestFile(item.depotId, item.manifestId, fileData);

          if (filterDepotIds.length === 0 || filterDepotIds.includes(item.depotId)) {
            const key = keyMap.get(item.depotId) || depotService.getDepotKey(item.depotId) || undefined;
            results.push({
              depotId: item.depotId,
              manifestId: item.manifestId,
              manifestFileName: `${item.depotId}_${item.manifestId}.manifest`,
              downloadUrl: `/api/manifests/download/${item.depotId}/${item.manifestId}?appId=${appId}`,
              source: sourceName,
              key
            });
          }
        }
      }

      // 若 manifestEntries 中没有但 Lua 中标明了 GID，且过滤允许，也可加入
      for (const [dId, gid] of gidMap) {
        if (!results.some((r) => r.depotId === dId)) {
          if (filterDepotIds.length === 0 || filterDepotIds.includes(dId)) {
            const key = keyMap.get(dId) || depotService.getDepotKey(dId) || undefined;
            results.push({
              depotId: dId,
              manifestId: gid,
              manifestFileName: `${dId}_${gid}.manifest`,
              downloadUrl: `/api/manifests/download/${dId}/${gid}?appId=${appId}`,
              source: sourceName,
              key
            });
          }
        }
      }
    } catch (e: any) {
      console.warn(`[ManifestService] 解压上游清单 ZIP 异常 (${appId}):`, e.message);
    }
    return results;
  }

  /**
   * 从 SteamML / ManifestHubUK 多源解析 Lua 并提取元数据（用于 metadataController 兜底补全）
   */
  public async extractParsedDataFromMultiSources(appId: number): Promise<{
    depotKeys: Map<string, string>;
    manifestGids: Map<string, string>;
    dlcIds: string[];
    accessToken?: string;
    /** 源构建号，用于上层跨源"取最新"裁决 */
    buildId?: string;
  } | null> {
    // 0. 优先尝试每日自动同步的 P-ToyStore (SteamManifestCache_Pro) 提取最新公网 GID
    const pToy = await this.fetchFromPToyStore(appId);
    if (pToy.depots.length > 0) {
      const depotKeys = new Map<string, string>();
      const manifestGids = new Map<string, string>();
      const dlcIds: string[] = [];
      for (const item of pToy.depots) {
        if (item.manifestId) manifestGids.set(item.depotId, item.manifestId);
        if (item.key) depotKeys.set(item.depotId, item.key);
        // appinfo.vdf 中的 dlcappid 是权威的 DLC 归属：此前被解析后丢弃，
        // 导致命中 P-ToyStore 的游戏丢失 DLC 列表
        if (item.dlcAppId && item.dlcAppId !== appId.toString() && !dlcIds.includes(item.dlcAppId)) {
          dlcIds.push(item.dlcAppId);
        }
      }
      return { depotKeys, manifestGids, dlcIds, buildId: pToy.buildId };
    }

    // 1. 优先尝试全球顶级边缘 CDN：SteamML (R2) 与 Remlua (CloudFront)
    // 注意：本函数运行在 metadata 查询热路径上，这里**只解析、不沉淀**。
    try {
      const smlUrl = `https://pub-5b6d3b7c03fd4ac1afb5bd3017850e20.r2.dev/${appId}.zip`;
      const data = await raceDownload(
        [smlUrl],
        { responseType: 'arraybuffer', timeout: 6000, maxContentLength: MAX_UPSTREAM_ZIP_BYTES },
        (d) => !!d && d.byteLength > 0
      );
      if (data) {
        const parsed = this.parseLuaFromZip(Buffer.from(data), appId);
        if (parsed && (parsed.depotKeys.size > 0 || parsed.manifestGids.size > 0)) {
          return parsed;
        }
      }
    } catch {}

    try {
      const remluaUrl = `https://d41hvr6rtvs2p.cloudfront.net/${appId}.zip`;
      const data = await raceDownload(
        [remluaUrl],
        { responseType: 'arraybuffer', timeout: 6000, maxContentLength: MAX_UPSTREAM_ZIP_BYTES },
        (d) => !!d && d.byteLength > 0
      );
      if (data) {
        const parsed = this.parseLuaFromZip(Buffer.from(data), appId);
        if (parsed && (parsed.depotKeys.size > 0 || parsed.manifestGids.size > 0)) {
          return parsed;
        }
      }
    } catch {}

    // 2. 备用尝试 ManifestHub.uk
    try {
      const encId = this.encodeManifestHubUKCipher(appId);
      const proxyUrl = `https://api.manifesthub.uk/proxy?id=${encId}`;
      const htmlResp = await axios.get(proxyUrl, {
        timeout: 7000,
        headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://steamtools.pages.dev/' }
      });
      const html = typeof htmlResp.data === 'string' ? htmlResp.data : '';
      const downloadMatches = Array.from(html.matchAll(/href="(\/download\?[^"]+)"/g))
        .map((m) => m[1])
        .slice(0, ManifestService.MAX_UK_DOWNLOAD_LINKS);
      for (const href of downloadMatches) {
        try {
          const zipResp = await axios.get(`https://api.manifesthub.uk${href}`, {
            responseType: 'arraybuffer',
            maxContentLength: MAX_UPSTREAM_ZIP_BYTES,
            timeout: 8000,
            headers: { 'User-Agent': 'Mozilla/5.0', Referer: proxyUrl }
          });
          if (zipResp.status === 200 && zipResp.data && zipResp.data.byteLength > 0) {
            // 同上：热路径只解析不沉淀
            const parsed = this.parseLuaFromZip(Buffer.from(zipResp.data), appId);
            if (parsed && (parsed.depotKeys.size > 0 || parsed.manifestGids.size > 0)) {
              return parsed;
            }
          }
        } catch {}
      }
    } catch {}

    return null;
  }

  /**
   * 从 ZIP 归档中的 Lua 脚本提取 depotKeys, manifestGids, dlcIds 与 accessToken
   */
  public parseLuaFromZip(
    zipBuffer: Buffer,
    targetAppId?: number
  ): {
    depotKeys: Map<string, string>;
    manifestGids: Map<string, string>;
    dlcIds: string[];
    accessToken?: string;
  } | null {
    try {
      const zip = new AdmZip(zipBuffer);
      const entries = zip.getEntries();
      // 条目数上限：本函数只解析 Lua 文本，无需处理海量条目的异常归档
      if (entries.length > MAX_ZIP_ENTRIES) {
        console.warn(`[ManifestService] ZIP 条目数超限 (${entries.length} > ${MAX_ZIP_ENTRIES})，已跳过解析`);
        return null;
      }
      let lua = '';
      for (const e of entries) {
        if (!e.isDirectory && e.entryName.endsWith('.lua')) {
          lua += zip.readAsText(e) + '\n';
        }
      }
      if (!lua) return null;
      // 统一解析器
      return parseLuaManifestText(lua, targetAppId);
    } catch {
      return null;
    }
  }

  /**
   * 确保指定清单在服务端本地 manifests/ 目录中就绪
   * 若本地不存在，则从 steamtools-games/ManifestHub3 回源拉取并沉淀落盘（Cache-Through 模式）
   */
  // 在途沉淀去重：同一 (depotId, manifestId) 并发只回源一次，
  // 防止多个请求（含 metadata 热路径）同时为该分包起多轮上游下载
  private manifestInFlight = new Map<string, Promise<string | null>>();
  // 本地清单缓存目录文件数上限：GID 变化会生成新文件、旧文件不会自动消失，
  // 不加约束会无限增长；超过上限时按 mtime 淘汰最旧
  private readonly MANIFEST_DIR_MAX_FILES = 20000;
  private manifestSaveCounter = 0;

  // 进程级回源并发闸门：
  // 上游放大点有两处 —— metadataController 为每个 depot 各起一路沉淀，
  // 而每次 ensureManifestCachedInner 内部又展开最多 16 个竞速 URL。
  // 不设闸门时，一个 100 分包的游戏可瞬间拉起上百路上游请求。
  private readonly MAX_CONCURRENT_FETCHES = 4;
  private activeFetches = 0;
  private fetchWaiters: Array<() => void> = [];

  private async acquireFetchSlot(): Promise<void> {
    if (this.activeFetches < this.MAX_CONCURRENT_FETCHES) {
      this.activeFetches++;
      return;
    }
    await new Promise<void>((resolve) => this.fetchWaiters.push(resolve));
    this.activeFetches++;
  }

  private releaseFetchSlot(): void {
    this.activeFetches = Math.max(0, this.activeFetches - 1);
    const next = this.fetchWaiters.shift();
    if (next) next();
  }

  public async ensureManifestCached(depotId: string, manifestId: string, appId?: number): Promise<string | null> {
    if (!/^\d+$/.test(String(depotId)) || !/^\d+$/.test(String(manifestId))) {
      return null;
    }
    const dedupKey = `${depotId}_${manifestId}`;
    const running = this.manifestInFlight.get(dedupKey);
    if (running) return running;

    const task = (async () => {
      await this.acquireFetchSlot();
      try {
        return await this.ensureManifestCachedInner(depotId, manifestId, appId);
      } finally {
        this.releaseFetchSlot();
      }
    })();
    this.manifestInFlight.set(dedupKey, task);
    try {
      return await task;
    } finally {
      this.manifestInFlight.delete(dedupKey);
    }
  }

  private async ensureManifestCachedInner(depotId: string, manifestId: string, appId?: number): Promise<string | null> {
    if (!/^\d+$/.test(String(depotId)) || !/^\d+$/.test(String(manifestId))) {
      return null;
    }

    const localPath = this.getLocalManifestFilePath(depotId, manifestId, appId);
    if (localPath && fs.existsSync(localPath)) {
      return localPath;
    }

    const targetFile = path.join(this.manifestDir, `${depotId}_${manifestId}.manifest`);

    // 确定上游回源 AppID 候选分支
    const candidateAppIds: string[] = [];
    if (appId && appId > 0) {
      candidateAppIds.push(appId.toString());
    }
    if (!candidateAppIds.includes(depotId)) {
      candidateAppIds.push(depotId);
    }

    // 1. 并发竞速回源：P-ToyStore (日更付费游戏) + ManifestHub3 (全量与免费游戏) 极速镜像直拉 vs SteamML R2 全包解压沉淀
    const fastMirrors = [
      'https://steam.os.kg/https://raw.githubusercontent.com',
      'https://ghfast.top/https://raw.githubusercontent.com',
      'https://gh-proxy.com/https://raw.githubusercontent.com',
      'https://cece.guyunsq.com/https://raw.githubusercontent.com'
    ];

    const hubManifestUrls: string[] = [];
    for (const targetApp of candidateAppIds) {
      for (const mirror of fastMirrors) {
        // 优先 P-ToyStore（日更最新大作）
        hubManifestUrls.push(`${mirror}/P-ToyStore/SteamManifestCache_Pro/${targetApp}/${depotId}_${manifestId}.manifest`);
        // 兜底 ManifestHub3（免费与全量游戏）
        hubManifestUrls.push(`${mirror}/steamtools-games/ManifestHub3/${targetApp}/${depotId}_${manifestId}.manifest`);
      }
    }

    const hubDownloadTask = async (): Promise<string | null> => {
      // 单个清单实体不可能达到 50MB 量级：这里用更紧的上限，
      // 避免 16 路竞速各自在内存里缓冲超大响应
      const buf = await raceDownload(
        hubManifestUrls,
        { responseType: 'arraybuffer', timeout: 3500, maxContentLength: MAX_MANIFEST_BYTES },
        (d) => !!d && d.byteLength > 0
      );
      if (buf && this.isValidManifestBuffer(Buffer.from(buf))) {
        const saved = this.saveManifestFile(depotId, manifestId, Buffer.from(buf));
        if (saved) {
          console.log(`[ManifestService] 成功从云端高速镜像沉淀清单到本地: ${depotId}_${manifestId}.manifest (${buf.byteLength} 字节)`);
          return targetFile;
        }
      }
      return null;
    };

    const searchAppId = appId && appId > 0 ? appId : Number(depotId);
    const steamMlTask = async (): Promise<string | null> => {
      if (searchAppId > 0) {
        try {
          await this.fetchFromSteamML(searchAppId, [depotId]);
          const recheck = this.getLocalManifestFilePath(depotId, manifestId, appId);
          if (recheck && fs.existsSync(recheck)) {
            console.log(`[ManifestService] 成功从 SteamML R2 沉淀清单到本地: ${depotId}_${manifestId}.manifest`);
            return recheck;
          }
        } catch {}
      }
      return null;
    };

    const remluaTask = async (): Promise<string | null> => {
      if (searchAppId > 0) {
        try {
          await this.fetchFromRemlua(searchAppId, [depotId]);
          const recheck = this.getLocalManifestFilePath(depotId, manifestId, appId);
          if (recheck && fs.existsSync(recheck)) {
            console.log(`[ManifestService] 成功从 Remlua CloudFront 沉淀清单到本地: ${depotId}_${manifestId}.manifest`);
            return recheck;
          }
        } catch {}
      }
      return null;
    };

    const [hubResult, smlResult, remluaResult] = await Promise.allSettled([
      hubDownloadTask(),
      steamMlTask(),
      remluaTask()
    ]);
    if (hubResult.status === 'fulfilled' && hubResult.value) {
      return hubResult.value;
    }
    if (smlResult.status === 'fulfilled' && smlResult.value) {
      return smlResult.value;
    }
    if (remluaResult.status === 'fulfilled' && remluaResult.value) {
      return remluaResult.value;
    }

    // 2. 末位冷备容灾：ManifestHub.uk 代理下载与解压沉淀
    if (searchAppId > 0) {
      try {
        await this.fetchFromManifestHubUK(searchAppId, [depotId]);
        const recheck2 = this.getLocalManifestFilePath(depotId, manifestId, appId);
        if (recheck2 && fs.existsSync(recheck2)) {
          console.log(`[ManifestService] 成功从 ManifestHub.uk 沉淀清单到本地: ${depotId}_${manifestId}.manifest`);
          return recheck2;
        }
      } catch {}
    }

    return null;
  }

  public isValidManifestBuffer(buf: Buffer): boolean {
    if (!buf || buf.length < 32) return false;
    const str128 = buf.subarray(0, 128).toString('utf8').toLowerCase();
    if (
      str128.includes('<!doctype') ||
      str128.includes('<html') ||
      str128.includes('<!--') ||
      str128.includes('404: not found') ||
      str128.includes('domain is for sale') ||
      str128.includes('"error"') ||
      str128.includes('"message"')
    ) {
      return false;
    }
    // Zip: PK\x03\x04
    if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return true;
    // Magic: 0x71F617D0, 0x71F617B0, 0x71F617D1, 0x71F617B1
    if (
      (buf[0] === 0xd0 || buf[0] === 0xb0 || buf[0] === 0xd1 || buf[0] === 0xb1) &&
      buf[1] === 0x17 && buf[2] === 0xf6 && buf[3] === 0x71
    ) {
      return true;
    }
    // Protobuf 清单：收窄判定 —— 原实现只要前 32 字节出现任一 >0x7f 或 0 字节就接受，
    // 随机二进制/被劫持内容几乎必然满足，等于没有校验。
    // 现要求首字段是合法 varint 长度前缀（field 1 为长度分隔）且后续长度自洽。
    if (buf[0] === 0x0a || buf[0] === 0x12 || buf[0] === 0x08) {
      let offset = 1;
      let length = 0;
      let shift = 0;
      let terminated = false;
      while (offset < buf.length && shift <= 28) {
        const b = buf[offset++];
        length |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) { terminated = true; break; }
        shift += 7;
      }
      // 长度分隔字段：声明的长度必须落在剩余缓冲内，否则不是有效清单
      if (buf[0] === 0x0a || buf[0] === 0x12) {
        return terminated && length > 0 && offset + length <= buf.length;
      }
      // 0x08 为 varint 字段：只需确认后续是可解析的 varint 序列（非全 0 文本）
      return terminated && buf.subarray(1, 32).some((b) => b === 0 || b > 0x7f);
    }
    return false;
  }

  private checkAndReturnManifestFile(filePath: string): string | null {
    if (!fs.existsSync(filePath)) return null;
    try {
      // 只读路径：仅读前 1KB 判断魔数，命中即返回，绝不在此删除文件。
      // 原实现每次下载都同步读入整个清单（可达上百 MB）并在启发式判无效时删文件；
      // 启发式存在误判，删除会静默毁掉有效缓存（删除应走显式修复/维护路径）。
      const fd = fs.openSync(filePath, 'r');
      try {
        const head = Buffer.alloc(1024);
        const read = fs.readSync(fd, head, 0, head.length, 0);
        if (this.isValidManifestBuffer(head.subarray(0, read))) {
          return filePath;
        }
      } finally {
        fs.closeSync(fd);
      }
      console.warn(`[ManifestService] 跳过疑似损坏的清单缓存（保留原文件，不做删除）: ${filePath}`);
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 获取本地指定清单文件路径
   * 支持以下检索优先级：
   * 1. 扁平存放: manifests/<depotId>_<manifestId>.manifest
   * 2. ManifestHub3 标准 AppID 分组: manifests/<appId>/<depotId>_<manifestId>.manifest
   * 3. 分包 DepotID 分组: manifests/<depotId>/<depotId>_<manifestId>.manifest
   * 4. 模糊匹配同 depotId 清单实体
   *
   * 全部走内存索引，不再同步 readdirSync 整个目录。
   */
  public getLocalManifestFilePath(depotId: string, manifestId: string, appId?: number | string): string | null {
    const index = this.getManifestIndex();
    const fileName = `${depotId}_${manifestId}.manifest`;

    // 1. 扁平根目录（精确）
    const flat = index.flat.get(fileName);
    if (flat) {
      const valid = this.checkAndReturnManifestFile(flat);
      if (valid) return valid;
    }

    // 2. 按 AppID 子目录 (ManifestHub3 标准仓库目录)
    if (appId) {
      const appMap = index.appDir.get(String(appId));
      const p = appMap?.get(fileName);
      if (p) {
        const valid = this.checkAndReturnManifestFile(p);
        if (valid) return valid;
      }
    }

    // 3. 按 DepotID 子目录
    const depotMap = index.appDir.get(String(depotId));
    const depotPath = depotMap?.get(fileName);
    if (depotPath) {
      const valid = this.checkAndReturnManifestFile(depotPath);
      if (valid) return valid;
    }

    // 4. 若指定了 appId 子目录，尝试该目录下的同 depotId 模糊匹配
    if (appId) {
      const appMap = index.appDir.get(String(appId));
      if (appMap) {
        const prefix = `${depotId}_`;
        for (const [name, p] of appMap) {
          if (name.startsWith(prefix) && name.endsWith('.manifest')) {
            const valid = this.checkAndReturnManifestFile(p);
            if (valid) return valid;
            break;
          }
        }
      }
    }

    // 5. 扁平根目录模糊匹配
    const candidates = index.flatByDepot.get(depotId);
    if (candidates) {
      for (const name of candidates) {
        if (!name.endsWith('.manifest')) continue;
        const p = index.flat.get(name);
        if (!p) continue;
        const valid = this.checkAndReturnManifestFile(p);
        if (valid) return valid;
        break;
      }
    }

    return null;
  }

  /**
   * 保存清单文件到服务端缓存。
   * 写入采用「临时文件 + rename」：客户端可能正在读取同一路径下发的清单，
   * 直接覆盖会写坏在途响应（内容截断/交错）。
   */
  public saveManifestFile(depotId: string, manifestId: string, buffer: Buffer): boolean {
    // depotId/manifestId 必须是纯数字：防止路径穿越等非法 ID 拼进文件名
    if (!/^\d+$/.test(String(depotId)) || !/^\d+$/.test(String(manifestId))) {
      console.error('[ManifestService] 保存清单文件失败: 非法的 depotId/manifestId');
      return false;
    }
    if (!this.isValidManifestBuffer(buffer)) {
      console.warn(`[ManifestService] 忽略非清单数据写入: ${depotId}_${manifestId}.manifest`);
      return false;
    }
    const filePath = path.join(this.manifestDir, `${depotId}_${manifestId}.manifest`);
    const tmpPath = path.join(
      this.manifestDir,
      `.${depotId}_${manifestId}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2, 10)}.tmp`
    );
    try {
      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, filePath);
      this.indexAddFile(filePath, undefined);
      this.maybePruneManifestDir();
      return true;
    } catch (e) {
      try { fs.unlinkSync(tmpPath); } catch {}
      console.error('[ManifestService] 保存清单文件失败:', e);
      return false;
    }
  }

  /**
   * 本地清单缓存目录容量约束。
   * GID 更新会写入新文件名，旧 GID 文件不会自动消失；若不淘汰，磁盘只增不减。
   * 为避免每次保存都全量 readdir，每 200 次保存才检查一次。
   *
   * 统计范围包含 appId 子目录：原实现只统计根目录文件，子目录（历史上由
   * unpackZipAndExtractManifests 双写产生）从不计数、从不淘汰。
   */
  private maybePruneManifestDir(): void {
    this.manifestSaveCounter += 1;
    if (this.manifestSaveCounter % 200 !== 0) return;
    try {
      const all: Array<{ p: string; mtime: number }> = [];
      const collect = (dir: string) => {
        let entries: fs.Dirent[];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const p = path.join(dir, e.name);
          if (e.isFile() && e.name.endsWith('.manifest')) {
            let mtime = 0;
            try { mtime = fs.statSync(p).mtimeMs; } catch {}
            all.push({ p, mtime });
          } else if (e.isDirectory() && /^\d+$/.test(e.name)) {
            collect(p);
          }
        }
      };
      collect(this.manifestDir);
      if (all.length <= this.MANIFEST_DIR_MAX_FILES) return;

      all.sort((a, b) => a.mtime - b.mtime);
      const removeCount = all.length - this.MANIFEST_DIR_MAX_FILES;
      for (let i = 0; i < removeCount; i++) {
        try {
          fs.unlinkSync(all[i].p);
          this.indexRemoveFile(all[i].p);
        } catch {}
      }
      console.log(`[ManifestService] 清单缓存目录超限，已按最旧优先淘汰 ${removeCount} 个文件（上限 ${this.MANIFEST_DIR_MAX_FILES}）`);
    } catch (e) {
      console.warn('[ManifestService] 清单缓存目录清理失败:', e);
    }
  }

  private manifestCodeCache = new Map<string, { code: string; fetchedAt: number }>();
  // 缓存时长：请求码确实会随时间轮换 —— 从本机 Steam 日志解析出的 158 个
  // (depot,gid) 组合里有 34 个先后出现过多个不同值，最频繁的
  // depot 281992 / gid 3306222774754384885 在 28 分钟内换了 6 个码
  // （08:44→08:49→08:56→09:01→09:06→09:12），即约 5~6 分钟一换。
  // 但同一份日志里所有历史码当时都返回了 200 —— 旧码不会立刻失效。
  // 故 5 分钟 TTL 既能贴合轮换节奏，又不会因偶发命中旧码而失败。
  private readonly MANIFEST_CODE_TTL_MS = 5 * 60 * 1000;
  // 容量上限：公开接口可枚举 gid，仅靠 TTL 惰性淘汰不足以防止内存无界增长
  private readonly MANIFEST_CODE_CACHE_MAX = 20000;
  // 负结果短 TTL 缓存：/api/manifests/code/:gid 是公开接口且 gid 由 URL 决定，
  // 不缓存负结果时随机 gid 的每次 miss 都会打上游（实测单次 4.5~18.6 秒），
  // 等于把本服务变成对上游的放大器。
  // 但**只对「确认查不到」写入**：429/5xx 属上游瞬时过载，写进去会让一次抖动
  // 冻结该 gid 60 秒，期间所有客户端都拿到 404（这正是「再点一次也不行」的成因）。
  private negativeCodeCache = new Map<string, number>();
  private readonly NEGATIVE_CODE_TTL_MS = 60 * 1000;
  private readonly NEGATIVE_CODE_CACHE_MAX = 20000;
  // 单航班去重：本中继存在的全部价值就是「把 N 客户端 x M 分包收敛成
  // 每 gid 每 5 分钟 1 次上游请求」。没有它，同一瞬间 N 个客户端请求同一 gid
  // 会各自打一遍上游，收敛效果归零 —— 而上游限流实测仅 60 次/分钟。
  private manifestCodeInFlight = new Map<string, Promise<ManifestCodeResult>>();
  // 上游实测 ttfb 4.5~18.6 秒。原实现超时 3500ms，意味着**从未等到过答案**，
  // 这才是「中继几乎没有缓存到码」的真正原因 —— 不是上游没码，是我们先放弃了。
  private readonly MANIFEST_CODE_UPSTREAM_TIMEOUT_MS = 15000;
  private readonly MANIFEST_CODE_MAX_ATTEMPTS = 2;

  // 上游熔断：上游拿不到码时，在窗口内直接失败，不再逐个 gid 去等 15 秒超时。
  //
  // 为什么必须有：实测上游被限流时，单次请求要 10~36 秒才回（多数是 429）。
  // 中继原本对每个 gid 都重试 2 次，于是一个冷请求就要 25~60 秒 —— 实测
  // 25.55s / 26.5s / 60.93s / 19.15s。上游持续不可用时，每个客户端、每个分包
  // 都要付这个代价，用户看到的就是「点下载后长时间卡住」。
  // 熔断打开后这段时间内所有请求立即失败，客户端得以马上走自己的直连源。
  private upstreamBreakerOpenUntil = 0;
  private readonly UPSTREAM_BREAKER_MS = 20 * 1000;

  // 过期正缓存仍可顶用：实测同一 depot+gid 的请求码约 5~6 分钟轮换一次，
  // 但**旧码不会立刻失效** —— content_log.txt 里所有历史码当时都返回了 200。
  // 因此上游不可用时，宁可下发一个 30 分钟内的旧码，也不要回 503 让下载彻底停摆：
  // 旧码让下载立刻开始，503 会让 Steam 的下载流程停在那里等重试。
  private readonly MANIFEST_CODE_STALE_MAX_MS = 30 * 60 * 1000;

  /** 写入清单代码缓存，并在超限时清理过期项/按插入序淘汰 */
  private setManifestCodeCache(gid: string, code: string): void {
    this.manifestCodeCache.set(gid, { code, fetchedAt: Date.now() });
    if (this.manifestCodeCache.size <= this.MANIFEST_CODE_CACHE_MAX) return;
    const now = Date.now();
    for (const [k, v] of this.manifestCodeCache) {
      if (now - v.fetchedAt >= this.MANIFEST_CODE_TTL_MS) this.manifestCodeCache.delete(k);
    }
    while (this.manifestCodeCache.size > this.MANIFEST_CODE_CACHE_MAX) {
      const oldest = this.manifestCodeCache.keys().next().value;
      if (oldest === undefined) break;
      this.manifestCodeCache.delete(oldest);
    }
  }

  private setNegativeCodeCache(gid: string): void {
    this.negativeCodeCache.set(gid, Date.now());
    if (this.negativeCodeCache.size <= this.NEGATIVE_CODE_CACHE_MAX) return;
    const now = Date.now();
    for (const [k, ts] of this.negativeCodeCache) {
      if (now - ts >= this.NEGATIVE_CODE_TTL_MS) this.negativeCodeCache.delete(k);
    }
    while (this.negativeCodeCache.size > this.NEGATIVE_CODE_CACHE_MAX) {
      const oldest = this.negativeCodeCache.keys().next().value;
      if (oldest === undefined) break;
      this.negativeCodeCache.delete(oldest);
    }
  }

  /**
   * 获取指定 GID 的清单请求代码（Manifest Request Code）。
   *
   * ManifestDeX 是唯一权威源 —— 实测同一 depot+gid 下，wudrm / 古韵 / steamrun
   * 返回的请求码与 ManifestDeX 并不一致（例：depot 1086941 / gid 2613374344895573127，
   * ManifestDeX 给 16792007641517249214，而 wudrm 与 steamrun 一致给
   * 5615254503045846791）。旧实现按 ManifestDeX → wudrm → 古韵 → steamrun 逐级降级，
   * 且把首个成功结果写进 2 小时正缓存：一旦 ManifestDeX 抖动，错码就会被固化并
   * 经 /api/manifests/code/:gid 下发给所有客户端，客户端用它向 Valve CDN 拉清单
   * 必然 404，表现为入库即报「无网络连接 / 0 字节下载」。
   *
   * 因此这里只保留权威源：拿不到就返回 null（客户端会走自己的直连源），
   * 绝不回退到会返回错值的第三方源，更不把错值写进正缓存。
   *
   * 返回 `ManifestCodeResult` 而非裸 string|null —— 调用方必须能区分
   * 「权威源确认没有」与「上游暂时问不到」，否则会把一次 429 抖动翻译成 404、
   * 再被客户端固化成两分钟负缓存。
   */
  public async getManifestCode(gid: string): Promise<ManifestCodeResult> {
    if (!gid || !/^\d+$/.test(gid)) {
      // 非法 gid 是**请求方**错误（controller 已在更外层回 400），
      // 这里报 definitiveMiss 只是为了让返回值语义完整，不会真的写负缓存。
      return { code: null, definitiveMiss: true, transient: false };
    }

    // 0. 优先命中内存缓存
    const cached = this.manifestCodeCache.get(gid);
    if (cached && Date.now() - cached.fetchedAt < this.MANIFEST_CODE_TTL_MS) {
      return { code: cached.code, definitiveMiss: false, transient: false };
    }
    // 负缓存命中：短时间内不重复打上游。
    // 只有「确认查不到且无瞬时故障」才写它，所以这里可以安全地报 definitiveMiss。
    const negTs = this.negativeCodeCache.get(gid);
    if (negTs && Date.now() - negTs < this.NEGATIVE_CODE_TTL_MS) {
      return { code: null, definitiveMiss: true, transient: false };
    }

    // 单航班：并发请求同一 gid 只打一次上游，其余等同一个 Promise。
    // 这是中继相对「客户端各自直连」的核心优势，缺了它收敛效果归零。
    const running = this.manifestCodeInFlight.get(gid);
    if (running) return running;

    const task = this.fetchManifestCodeFromUpstream(gid);
    this.manifestCodeInFlight.set(gid, task);
    try {
      return await task;
    } finally {
      this.manifestCodeInFlight.delete(gid);
    }
  }

  /**
   * 向唯一权威源取码，带有限重试。
   *
   * 关键区分（直接决定回给客户端的是 404 还是 503）：
   * - 200 + 合法纯数字码 → 写正缓存返回
   * - 200 + 非码内容（如 HTML 质询页）→ 权威源明确回答「没有」→ definitiveMiss
   * - 404 → 权威源明确回答「没有这个 gid」→ definitiveMiss
   * - 403（Cloudflare 质询）→ 换时机/换出口即可恢复 → transient，**不写负缓存**
   * - 429 / 5xx / 网络异常 → 上游过载 → transient，退避重试，**不写负缓存**
   *
   * 为什么必须分开：中继原先把所有 null 一律回 404，而客户端把 404 读作
   * 「权威源确认没有」。于是上游一次 429 抖动会被中继翻译成 404、再被客户端
   * 固化成 CFD_CODE_NEG_TTL(120s) 负缓存 —— 该 gid 在两分钟内对**所有**客户端
   * 都取不到码。这正是「第一次点下载报无网络、等一两分钟再点才行」的完整链路。
   */
  private async fetchManifestCodeFromUpstream(gid: string): Promise<ManifestCodeResult> {
    let sawDefinitiveMiss = false;
    let sawTransient = false;

    // 熔断打开：立即失败，完全不碰网络。
    // 这是把「上游持续不可用」从「每个请求等 15~30 秒」降为「立即返回」的关键，
    // 也是让客户端能迅速改走自己直连源的前提。
    if (Date.now() < this.upstreamBreakerOpenUntil) {
      return this.serveStaleOrTransient(gid, true);
    }

    for (let attempt = 1; attempt <= this.MANIFEST_CODE_MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await this.sleepCodeRetry(attempt);
      }
      try {
        const resp = await axios.get(`https://manifest.manifestdex.com/${gid}`, {
          timeout: this.MANIFEST_CODE_UPSTREAM_TIMEOUT_MS,
          responseType: 'text',
          // 必须**恰好**是这个 UA —— 实测这是 ManifestDeX 的准入闸门：
          //   ManifestDeX/1.0 → 通过（429 说明已进限流窗口，不是被拒）
          //   ChunFengDu/1.0 / Mozilla/5.0 / 空 → 一律 403
          // 依据 OpenSteamTool PR #200：上游只为 manifestdex 这个 provider
          // 单独挂了 `User-Agent: ManifestDeX/1.0`，其余 provider 都不带头。
          headers: { 'User-Agent': 'ManifestDeX/1.0' },
          // 不让 axios 对 4xx/5xx 抛异常：必须看到状态码才能区分
          // 「上游过载」与「这个 gid 确实没有码」
          validateStatus: () => true
        });
        if (resp.status === 200 && typeof resp.data === 'string') {
          const text = resp.data.trim();
          if (/^\d+$/.test(text) && text !== '0') {
            this.setManifestCodeCache(gid, text);
            this.upstreamBreakerOpenUntil = 0; // 成功即闭合熔断
            return { code: text, definitiveMiss: false, transient: false };
          }
          // 200 但内容不是码：上游明确回答「没有」，重试无意义
          sawDefinitiveMiss = true;
          break;
        }
        if (resp.status === 404) {
          // 权威源的 404 = 明确没有这个 gid，重试无意义
          sawDefinitiveMiss = true;
          break;
        }
        if (resp.status === 403) {
          // Cloudflare 质询：换时机/换出口即可恢复，属瞬时
          sawTransient = true;
          continue;
        }
        if (resp.status === 429) {
          // 限流：**不重试**。限流窗口不会在 3 秒退避内解除，重试只是再等一个
          // 15 秒超时 —— 这是冷请求耗时 25~60 秒的主要来源。改为立刻跳出，
          // 交给熔断把后续请求也一并快速失败。
          sawTransient = true;
          break;
        }
        if (resp.status >= 500) {
          // 5xx 可能是瞬时抖动，值得重试一次
          sawTransient = true;
          continue;
        }
        // 其余 4xx：请求本身有问题，重试无意义；但也不该固化成
        // 「这个 gid 没有码」—— 标为瞬时，让客户端稍后重试。
        sawTransient = true;
        break;
      } catch {
        // 网络层异常（超时 / 连接重置）：瞬时故障，继续重试
        sawTransient = true;
      }
    }

    // 只有「确认查不到」且**没有任何瞬时故障迹象**时才写负缓存。
    // 只要有一轮是超时/429/403，我们就不知道这个 gid 到底有没有码 ——
    // 写进去等于把它冻结 NEGATIVE_CODE_TTL_MS，期间所有客户端都拿到 404。
    if (sawDefinitiveMiss && !sawTransient) {
      this.setNegativeCodeCache(gid);
    }
    if (sawTransient) {
      this.upstreamBreakerOpenUntil = Date.now() + this.UPSTREAM_BREAKER_MS;
      return this.serveStaleOrTransient(gid, true);
    }
    return { code: null, definitiveMiss: sawDefinitiveMiss, transient: false };
  }

  /**
   * 上游不可用时的兜底：优先下发仍在 STALE 窗口内的旧码，否则才回 503。
   *
   * 旧码可用性有实测依据 —— content_log.txt 里同一 (depot,gid) 的历史码当时**都**
   * 返回 200，轮换只是「新码生效」，并非「旧码作废」。所以旧码远比 503 有价值：
   * 它能让下载立刻开始，而 503 会让 Steam 的下载流程停在那里等重试。
   *
   * 注意此处**不刷新** fetchedAt：旧码只是「能顶用」，不该被当成新鲜码再锁 5 分钟，
   * 否则上游一恢复我们仍会继续用旧码。
   */
  private serveStaleOrTransient(gid: string, transient: boolean): ManifestCodeResult {
    const stale = this.manifestCodeCache.get(gid);
    if (stale && Date.now() - stale.fetchedAt < this.MANIFEST_CODE_STALE_MAX_MS) {
      return { code: stale.code, definitiveMiss: false, transient: false };
    }
    return { code: null, definitiveMiss: false, transient };
  }

  /** 重试退避：优先读上游 Retry-After，缺失时按 3 秒递增 */
  private async sleepCodeRetry(attempt: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, Math.min(3000 * (attempt - 1), 6000)));
  }
}

export const manifestService = new ManifestService();
