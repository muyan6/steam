import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
/// 竞速下载单条清单时的更紧上限。
///
/// 注释里写的是「单个清单实体不可能达到 50MB 量级，用更紧的上限避免 16 路竞速
/// 各自缓冲超大响应」，但实现此前传的是 MAX_MANIFEST_BYTES = 512MB ——
/// 该 URL 列表最多 16 路（2 候选 AppID × 4 镜像 × 2 仓库）全部并发，
/// 恶意/异常上游可让单次沉淀在内存里缓冲 16 × 512MB。这里与注释对齐。
const MAX_SINGLE_MANIFEST_BYTES = 16 * 1024 * 1024;

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
  /**
   * 这个码来自过期缓存（上游当下取不到，用旧码顶用）。
   *
   * 注意它**不代表内容版本旧**：code 只是下载凭据，内容版本由 gid 决定，
   * 而 gid 只在 depot 内容更新时才变。用旧 code 配当前 gid，拉到的仍是当前版本。
   *
   * 真实含义是「这个码很可能已失效」—— 实测码龄超过约 30 分钟后基本一律 401
   * （见 CODE_STORE_STALE_MAX_MS 的注释）。客户端据此可以让 Steam 更快重试，
   * 而不是把它当成一个可靠的码。
   */
  stale?: boolean;
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
    this.loadCodeStore();
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
      // 只缓存成功结果。失败（上游 429/超时）同样带 10 分钟 TTL 写进缓存的话，
      // 一次抖动就会让该 appId|dlcs 组合在 10 分钟内对**所有**客户端都返回
      // 「上游不可用」，即使上游早已恢复 —— 注释里辛苦区分的「未收录 vs 上游故障」
      // 会被缓存层直接抹掉。失败结果由下一次请求重新探测。
      if (result.success) this.setManifestResultCache(cacheKey, result);
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
    // 仅当本地缓存**覆盖了全部候选分包**时才走快路径短路返回。
    //
    // 旧实现只要命中任意一个非空本地结果就 success:true 返回，且该结果被缓存
    // 10 分钟 —— 一个 100 分包的游戏只要本地恰好有 1 个清单，客户端拿到的就是
    // 「成功 + 仅 1 个分包」，其余 99 个分包在缓存期内永久不可见。
    // 少挂几个无害，但把「不完整」当「完整」下发会让用户永远装不全。
    if (localDepots.length > 0 && localDepots.length >= candidateDepotIds.length) {
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
  /// ManifestHub.uk 兜底下载的总时间预算：超过即放弃剩余链接，避免长时间占住请求
  private static readonly UK_TOTAL_BUDGET_MS = 20 * 1000;
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

    // 串行尝试下载链接，但设**总预算**上限。
    //
    // 旧实现逐个 await，每个 timeout 10 秒、最多 8 个链接 —— 上游全部返回失效
    // 链接时最坏阻塞约 80 秒。而本函数既被 /api/manifests 列表链路调用，也被
    // ensureManifestCachedInner 的下载链路复用，长时间占住 Express 连接会连带
    // 拖慢其它请求。这里超预算即放弃剩余链接（兜底源本就是尽力而为）。
    const deadline = Date.now() + ManifestService.UK_TOTAL_BUDGET_MS;
    for (const href of downloadMatches) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        console.warn('[ManifestService] ManifestHub.uk 兜底下载超出总预算，放弃剩余链接');
        break;
      }
      try {
        const dlUrl = `https://api.manifesthub.uk${href}`;
        const zipResp = await axios.get(dlUrl, {
          responseType: 'arraybuffer',
          timeout: Math.min(10000, remaining),
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
      } catch (e: any) {
        // 不再静默：UK 源长期挂掉时，日志里必须能看到是哪条链接、什么错
        console.warn(`[ManifestService] ManifestHub.uk 链接下载失败 ${href}:`, e?.message || e);
      }
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
          // .lua 条目此前**完全没有体积校验**：条目数上限 2000 拦不住单个条目的
          // 高压缩比膨胀 —— 50MB 的上游 zip 里一个 .lua 即可解压出数十 GB 文本，
          // readAsText 的字符串拼接会直接把 Node 堆打爆。
          const luaSize = Number(entry.header?.size ?? 0);
          if (luaSize > MAX_ZIP_ENTRY_BYTES) {
            console.warn(`[ManifestService] ZIP 内 .lua 条目过大已跳过 (${luaSize} 字节): ${name}`);
            continue;
          }
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
          // 同上：.lua 条目必须做体积校验，否则单个高压缩比条目即可撑爆内存
          const luaSize = Number(e.header?.size ?? 0);
          if (luaSize > MAX_ZIP_ENTRY_BYTES) {
            console.warn(`[ManifestService] ZIP 内 .lua 条目过大已跳过 (${luaSize} 字节): ${e.entryName}`);
            continue;
          }
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
        { responseType: 'arraybuffer', timeout: 3500, maxContentLength: MAX_SINGLE_MANIFEST_BYTES },
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

  /**
   * @param truncated 传入的 buffer 是否为文件的**前缀片段**（未读全）。
   *
   * protobuf 分支的长度自洽校验（offset + length <= buf.length）依赖 buffer 总长度：
   * 只读前 1KB 时，任何声明长度 >1KB 的合法清单都会被判无效 —— 而这类清单正是靠
   * protobuf 分支才被承认为有效的（zip/魔数分支另说）。结果是
   * getLocalManifestFilePath 恒返回 null，每次下载都回源。
   * 因此截断读取时只要求「首字段是合法 varint 长度前缀且长度非 0」。
   */
  public isValidManifestBuffer(buf: Buffer, truncated = false): boolean {
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
      // 长度分隔字段：声明的长度必须落在剩余缓冲内，否则不是有效清单。
      // 截断读取（只读了文件前缀）时无法做这一步自洽校验，只要求长度非 0。
      if (buf[0] === 0x0a || buf[0] === 0x12) {
        if (truncated) return terminated && length > 0;
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
        const size = fs.fstatSync(fd).size;
        // 文件大于 1KB 时本次读取是前缀片段，按 truncated 语义校验
        if (this.isValidManifestBuffer(head.subarray(0, read), size > read)) {
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
    if (this.pruneScheduled) return;
    // 原实现在 saveManifestFile 里同步递归 readdirSync + 逐文件 statSync
    // （上限 2 万文件），在下载高峰期会阻塞事件循环数百毫秒，所有在途 HTTP
    // 响应被一起拖慢。改为让出当前 tick 后台异步执行，并加去重标志防止
    // 每次触发都叠一个任务。
    this.pruneScheduled = true;
    setImmediate(() => {
      void this.pruneManifestDir().finally(() => {
        this.pruneScheduled = false;
      });
    });
  }

  private pruneScheduled = false;

  /** 异步清理清单缓存目录：按 mtime 最旧优先淘汰，回到上限以内 */
  private async pruneManifestDir(): Promise<void> {
    try {
      const all: Array<{ p: string; mtime: number }> = [];
      const collect = async (dir: string): Promise<void> => {
        let entries: fs.Dirent[];
        try {
          entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const p = path.join(dir, e.name);
          if (e.isFile() && e.name.endsWith('.manifest')) {
            let mtime = 0;
            try { mtime = (await fs.promises.stat(p)).mtimeMs; } catch {}
            all.push({ p, mtime });
          } else if (e.isDirectory() && /^\d+$/.test(e.name)) {
            await collect(p);
          }
        }
      };
      await collect(this.manifestDir);
      if (all.length <= this.MANIFEST_DIR_MAX_FILES) return;

      all.sort((a, b) => a.mtime - b.mtime);
      const removeCount = all.length - this.MANIFEST_DIR_MAX_FILES;
      for (let i = 0; i < removeCount; i++) {
        try {
          await fs.promises.unlink(all[i].p);
          this.indexRemoveFile(all[i].p);
        } catch {}
      }
      console.log(`[ManifestService] 清单缓存目录超限，已按最旧优先淘汰 ${removeCount} 个文件（上限 ${this.MANIFEST_DIR_MAX_FILES}）`);
    } catch (e) {
      console.warn('[ManifestService] 清单缓存目录清理失败:', e);
    }
  }

  // ==================== 持久化码库（自建，不依赖任何上游） ====================
  //
  // 为什么必须落盘：原先码只存在内存 Map 里，5 分钟 TTL 一过就没了，进程重启
  // 更是全清。于是上游一挂，中继手里一个码都没有 —— 2026-09-20 ManifestDeX
  // 的 manifest 子域整体 521 时，中继只能对每个 gid 回 503，全线停摆。
  //
  // 早期判断「旧码不会立刻失效」是**错的**，已被直接实测推翻（见下面
  // CODE_STORE_STALE_MAX_MS）。持久化的真实价值因此收窄为两点：
  //   ① 半小时内扛住上游抖动（这才是「第一次点下载报无网络」的直接对策）
  //   ② 累积 depot→gid 索引，供后续按需补码 —— 这一项不随码过期而失效，
  //      因为 gid 是稳定的（只在 depot 内容更新时才变）。
  //
  // 这是完全自有的能力：上游健康时自动积累，上游挂了不依赖任何人。
  private manifestCodeStorePath = path.join(CONFIG.DATA_DIR, 'manifest_code_store.json');
  /** 落盘节流：写盘是 IO，不能每个 gid 都写一次 */
  private codeStoreDirty = false;
  private codeStoreFlushTimer: NodeJS.Timeout | null = null;
  private static readonly CODE_STORE_FLUSH_MS = 30 * 1000;
  /** 持久化条目条数上限：超出按最近使用淘汰 */
  private static readonly CODE_STORE_MAX = 50000;
  /**
   * 过期码的可用窗口。**30 分钟，不是 7 天。**
   *
   * 这里曾写 7 天，依据是「日志里同一 (depot,gid) 的历史码当时都返回 200」。
   * 那个依据是错的 —— 那些 200 是**当时**的成功记录，不是「今天再用仍会成功」。
   *
   * 直接向 Valve CDN 复测（2026-09-20 18:40，按码龄分桶）：
   *     0~15 分钟   27/27 可用
   *    15~30 分钟    1/1  可用
   *    45~60 分钟   10/27 可用
   *   120 分钟以上    0/27 可用
   *
   * 即旧码只在约半小时内能顶用。窗口取 30 分钟，正好落在实测的可用区间内。
   * 再长就是下发一个几乎必然 401 的码 —— Steam 拉不到清单，下载反而卡住，
   * 比直接回 503 让它立刻重试更糟。
   */
  private static readonly CODE_STORE_STALE_MAX_MS = 30 * 60 * 1000;

  /**
   * 落盘条目的保留窗口 —— 与「可下发的窗口」是两件事，必须分开。
   *
   * 码本身 30 分钟后基本没用，但 `depot→gid` 索引不会过期：gid 只在 depot
   * 内容更新时才变，它是长期资产，也是主动补码唯一的枚举依据。
   * 若按 30 分钟淘汰落盘条目，重启后索引就空了，补码循环随即失效。
   *
   * 所以：保留 7 天（够覆盖「入库后隔几天才下载」），可下发仍只看 30 分钟。
   */
  private static readonly CODE_STORE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

  /**
   * depotId -> 该 depot 最近一次见到的 gid 集合。
   *
   * 为什么需要它：gid 是 Valve 为 depot 内容算出的内容指纹，**只在 depot 内容
   * 真正更新时才变**（实测 17 天内 115 个 depot 里 92 个 gid 一次未变；变的那
   * 23 个确实发过版本更新）。所以 (depotId, gid) 是一个**缓慢增长且可枚举**的
   * 集合 —— 这正是「主动补码」能成立的前提：不需要遍历整个 Steam 目录，
   * 只要覆盖真实被请求过的 depot 即可。
   *
   * 它由客户端上报与实时取码两条路径共同填充，随码库一起落盘。
   */
  private depotGidIndex = new Map<string, Set<string>>();

  private loadCodeStore(): void {
    try {
      if (!fs.existsSync(this.manifestCodeStorePath)) return;
      const raw = fs.readFileSync(this.manifestCodeStorePath, 'utf-8');
      const parsed = JSON.parse(raw) as {
        codes?: Record<string, { code: string; fetchedAt: number; depotId?: string }>;
        depots?: Record<string, string[]>;
      };
      // 兼容旧格式（顶层直接就是 gid -> entry 的扁平对象）。
      // 显式标注类型而不是靠 ?? 推导：两个分支的元素类型不同（旧格式没有 depotId），
      // 推导出来是联合类型，后面读 entry.depotId 会报 TS2339。
      const codes: Record<string, { code: string; fetchedAt: number; depotId?: string }> =
        parsed.codes ?? (parsed as unknown as Record<string, { code: string; fetchedAt: number; depotId?: string }>);
      const now = Date.now();
      let loaded = 0;
      let expired = 0;
      for (const [gid, entry] of Object.entries(codes)) {
        if (!entry || typeof entry.code !== 'string' || !/^\d+$/.test(entry.code)) continue;
        if (typeof entry.fetchedAt !== 'number') continue;
        // 用保留窗口而非可下发窗口：过期的码仍要留着撑起 depot→gid 索引，
        // 否则重启后补码循环就没有枚举依据了。能不能下发由
        // serveStaleOrTransient 按 CODE_STORE_STALE_MAX_MS 单独判定。
        if (now - entry.fetchedAt >= ManifestService.CODE_STORE_RETENTION_MS) {
          expired++;
          continue;
        }
        this.manifestCodeCache.set(gid, {
          code: entry.code,
          fetchedAt: entry.fetchedAt,
          depotId: typeof entry.depotId === 'string' ? entry.depotId : undefined
        });
        loaded++;
      }
      for (const [depotId, gids] of Object.entries(parsed.depots ?? {})) {
        if (!Array.isArray(gids)) continue;
        const set = new Set<string>();
        for (const g of gids) {
          if (typeof g === 'string' && /^\d+$/.test(g) && this.manifestCodeCache.has(g)) set.add(g);
        }
        if (set.size > 0) this.depotGidIndex.set(depotId, set);
      }
      console.log(
        `[ManifestService] 码库已载入 ${loaded} 条（过期丢弃 ${expired}）｜` +
          `depot 索引 ${this.depotGidIndex.size} 个`
      );
    } catch (e) {
      console.warn('[ManifestService] 码库载入失败（不影响运行）:', e);
    }
  }

  /** 标记脏并由定时器批量落盘，避免每个 gid 都触发一次写文件 */
  private markCodeStoreDirty(): void {
    this.codeStoreDirty = true;
    if (this.codeStoreFlushTimer) return;
    this.codeStoreFlushTimer = setTimeout(() => {
      this.codeStoreFlushTimer = null;
      this.flushCodeStore();
    }, ManifestService.CODE_STORE_FLUSH_MS);
    // 不能因为一个待写的定时器把进程钉住不退
    this.codeStoreFlushTimer.unref?.();
  }

  /**
   * 把内存码库落盘。
   *
   * 超过上限时按 fetchedAt 从旧到新淘汰 —— 越新的码越可能仍在生效窗口内。
   * 写盘用「临时文件 + rename」：进程在写一半时被杀不会留下半个损坏的 JSON，
   * 否则下次启动整个码库都读不出来，白白损失全部积累。
   */
  public flushCodeStore(): void {
    if (!this.codeStoreDirty) return;
    try {
      const entries = [...this.manifestCodeCache.entries()];
      if (entries.length > ManifestService.CODE_STORE_MAX) {
        entries.sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
        entries.length = ManifestService.CODE_STORE_MAX;
      }
      const codes: Record<string, { code: string; fetchedAt: number; depotId?: string }> = {};
      for (const [gid, entry] of entries) {
        codes[gid] = entry.depotId
          ? { code: entry.code, fetchedAt: entry.fetchedAt, depotId: entry.depotId }
          : { code: entry.code, fetchedAt: entry.fetchedAt };
      }
      // depot 索引只保留仍在码库里的 gid，避免文件随淘汰无限增长
      const depots: Record<string, string[]> = {};
      for (const [depotId, gids] of this.depotGidIndex) {
        const alive = [...gids].filter((g) => codes[g] !== undefined);
        if (alive.length > 0) depots[depotId] = alive;
      }

      // 临时文件名必须唯一：固定 `.tmp` 在并发/多进程 flush 时会互相截断，
      // 把半截 JSON rename 成正式码库。带 pid + 随机串后 rename 是原子的。
      const tmp = `${this.manifestCodeStorePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(3).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ codes, depots }), 'utf-8');
      fs.renameSync(tmp, this.manifestCodeStorePath);
      this.codeStoreDirty = false;
    } catch (e) {
      console.warn('[ManifestService] 码库落盘失败:', e);
    }
  }

  /** 记录 depot 与 gid 的归属关系（供主动补码枚举，不影响取码路径） */
  private indexDepotGid(depotId: string, gid: string): void {
    if (!depotId || !/^\d+$/.test(depotId)) return;
    let set = this.depotGidIndex.get(depotId);
    if (!set) {
      set = new Set<string>();
      this.depotGidIndex.set(depotId, set);
    }
    if (!set.has(gid)) {
      set.add(gid);
      this.markCodeStoreDirty();
    }
  }

  /**
   * 由 gid 反查 depotId（仅在调用方没带 depotId 时使用）。
   *
   * 为什么需要：老版 OST 内核的 `fetch_manifest_code` 只回调 gid，不带 depot_id。
   * 而末位兜底源古韵 `index.php/{depot}/{gid}` 与 20770407 都以 (depot, gid)
   * 为联合键 —— 缺 depotId 时只能退到**已知必然 502** 的 `dex.php/{gid}`，
   * 整条兜底链等于哑掉。
   *
   * depotGidIndex 里通常早就记着这个 gid 的归属：任意一次带 depotId 的请求、
   * 或任意一条客户端上报，都会写入。反查出来即可复活这两个端点。
   *
   * 线性扫描在这里是可接受的：本函数只在 depotId 缺失时调用，而其后紧跟的
   * 至少是一次 15 秒超时的上游 HTTP 请求 —— 数千次 Set 查找（亚毫秒）与之
   * 相比完全可以忽略。
   */
  private findDepotIdForGid(gid: string): string | undefined {
    if (!gid) return undefined;
    for (const [depotId, gids] of this.depotGidIndex) {
      if (gids.has(gid)) return depotId;
    }
    return undefined;
  }

  /**
   * 客户端上报取码结果 —— 这是码库最重要的数据来源。
   *
   * 为什么不让服务端自己去扒：古韵的接口按 (depot, gid) 查询，服务端要主动
   * 扒就得先枚举出全部组合。虽然 gid 稳定（只在 depot 内容更新时才变）使枚举
   * 可行，但**集中从一个出口 IP 高频请求第三方服务**极易触发风控 —— 封的是
   * 服务器，沉淀管道就断了。
   *
   * 客户端上报天然分散：每个用户入库时本来就已经取到了这些码，顺手回传即可，
   * 服务端零额外出网流量。用户越多覆盖越全，且完全不受单一来源的限制。
   *
   * 只接受 (depotId, gid, code) 三元组，逐条校验；不合法的直接丢弃，
   * 绝不因为一条脏数据让整批失败。
   */
  public reportManifestCodes(
    entries: Array<{ depotId: string; gid: string; code: string }>
  ): { accepted: number; rejected: number } {
    let accepted = 0;
    let rejected = 0;
    const now = Date.now();
    for (const e of entries) {
      const depotId = String(e?.depotId ?? '').trim();
      const gid = String(e?.gid ?? '').trim();
      const code = String(e?.code ?? '').trim();
      if (!/^\d+$/.test(depotId) || !/^\d+$/.test(gid) || !/^\d+$/.test(code) || code === '0') {
        rejected++;
        continue;
      }
      this.indexDepotGid(depotId, gid);
      const cur = this.manifestCodeCache.get(gid);
      if (cur) {
        // 同码重复上报：纯 no-op，不刷新时间戳也不做无谓写
        if (cur.code === code) continue;
        // 不覆盖「刚刚由权威源取到」的码。
        //
        // 旧实现写的是 `if (cur && cur.fetchedAt >= now) continue;` —— 而 cur.fetchedAt
        // 必然 ≤ now（都是 Date.now()），该条件恒假，注释承诺的「不覆盖更新的码」
        // 从未生效：客户端跑了几分钟后上报的**旧码**会以 fetchedAt=now 覆盖服务端
        // 刚取到的新码，并被当作新鲜码下发给全体客户端。
        //
        // 上报请求不带采集时间戳（客户端会跑很久才回传），无法精确比较新旧，
        // 因此采用保守判据：60 秒内写入的条目视为权威新码，不接受客户端覆盖。
        if (now - cur.fetchedAt < 60 * 1000) continue;
      }
      // 必须走 setManifestCodeCache：它带 MANIFEST_CODE_CACHE_MAX 容量检查。
      // 旧实现直接 manifestCodeCache.set()，绕过了唯一的容量上限 ——
      // 而这里是 /manifests/code/report 这条公开写入口的**主写路径**，
      // 持续上报不同 (depotId,gid,code) 即可让 Map 无界增长直至 OOM。
      this.setManifestCodeCache(gid, code, depotId);
      // 上报是对「确认存在」的正向证据，清掉可能存在的负缓存
      this.negativeCodeCache.delete(gid);
      accepted++;
    }
    if (accepted > 0) this.markCodeStoreDirty();
    return { accepted, rejected };
  }

  /** 该 gid 当前是否只有过期码（供 controller 决定是否加 stale 响应头） */
  public getCodeStaleness(gid: string): { hasCode: boolean; stale: boolean; ageMs: number } {
    const e = this.manifestCodeCache.get(gid);
    if (!e) return { hasCode: false, stale: false, ageMs: 0 };
    const ageMs = Date.now() - e.fetchedAt;
    return { hasCode: true, stale: ageMs >= this.MANIFEST_CODE_TTL_MS, ageMs };
  }

  /** 码库概览（供后台诊断，不暴露任何具体码值） */
  public getCodeStoreStats(): {
    total: number;
    fresh: number;
    depots: number;
    indexEntries: number;
  } {
    const now = Date.now();
    let fresh = 0;
    for (const v of this.manifestCodeCache.values()) {
      if (now - v.fetchedAt < this.MANIFEST_CODE_TTL_MS) fresh++;
    }
    let indexEntries = 0;
    for (const s of this.depotGidIndex.values()) indexEntries += s.size;
    return {
      total: this.manifestCodeCache.size,
      fresh,
      depots: this.depotGidIndex.size,
      indexEntries
    };
  }

  /**
   * 列出「已知但码已不新鲜」的 (depotId, gid) 组合，供低频主动补码使用。
   *
   * 只返回真实被请求过、且 gid 仍在索引里的组合 —— 绝不遍历整个 Steam 目录。
   * 按码龄从旧到新排序：越旧的越可能已轮换，补它收益最高。
   */
  public listStaleCodeTargets(limit: number): Array<{ depotId: string; gid: string; ageMs: number }> {
    const now = Date.now();
    const out: Array<{ depotId: string; gid: string; ageMs: number }> = [];
    for (const [depotId, gids] of this.depotGidIndex) {
      for (const gid of gids) {
        const entry = this.manifestCodeCache.get(gid);
        if (!entry) {
          // 从未取到过码的 gid 同样要纳入补码 —— 旧实现 `if (!entry) continue`
          // 把它们 100% 排除在外，于是补码循环只能反复刷新「本来就有码」的条目，
          // 而真正缺码的长尾（当初请求时全线上游不可用、或码已被容量淘汰但
          // depot→gid 索引仍在）永远得不到后台拯救。
          //
          // 但**不能无条件优先**：确有一部分 gid 是永久没有码的（例如无 GID 的
          // 免费分包），若给它们最高优先级，每轮 8 个名额会被这些填不上的条目
          // 长期霸占。因此按「上次尝试时间」计算码龄，并强制一个重试间隔 ——
          // 等价于带退避的负缓存：试过一次后要等 BACKFILL_MISS_RETRY_MS 才再试。
          const missedAt = this.codeMissAt.get(gid);
          const ageMs = now - (missedAt ?? 0);
          if (ageMs < ManifestService.BACKFILL_MISS_RETRY_MS) continue;
          out.push({ depotId, gid, ageMs });
          continue;
        }
        const ageMs = now - entry.fetchedAt;
        if (ageMs < this.MANIFEST_CODE_TTL_MS) continue;
        out.push({ depotId, gid, ageMs });
      }
    }
    out.sort((a, b) => b.ageMs - a.ageMs);
    return out.slice(0, Math.max(0, limit));
  }

  /**
   * gid -> 最近一次「问了但没拿到码」的时间戳。
   *
   * 只用于 listStaleCodeTargets 计算重试间隔，不参与任何下发决策 ——
   * 「问不到」不等于「没有码」，不能拿它当负缓存用（负缓存有自己的
   * negativeCodeCache 与更严格的写入条件）。
   */
  private codeMissAt = new Map<string, number>();
  /** 未出码 gid 的后台重试间隔：避免每轮补码反复打同一批永久无码的条目 */
  private static readonly BACKFILL_MISS_RETRY_MS = 30 * 60 * 1000;
  private static readonly CODE_MISS_MAP_MAX = 20000;

  private noteCodeMiss(gid: string): void {
    // 上限保护：公开接口可枚举 gid，无界会随随机请求持续膨胀
    if (this.codeMissAt.size >= ManifestService.CODE_MISS_MAP_MAX && !this.codeMissAt.has(gid)) {
      const oldest = this.codeMissAt.keys().next().value;
      if (oldest !== undefined) this.codeMissAt.delete(oldest);
    }
    this.codeMissAt.set(gid, Date.now());
  }

  private manifestCodeCache = new Map<string, { code: string; fetchedAt: number; depotId?: string }>();
  // 缓存时长：请求码按时间轮换 —— 从本机 Steam 日志解析出的 (depot,gid) 组合里
  // 有 34 个先后出现过多个不同值，最频繁的 depot 281992 / gid 3306222774754384885
  // 在 28 分钟内换了 6 个码（08:44→08:49→08:56→09:01→09:06→09:12），约 5~6 分钟一换。
  //
  // 取 5 分钟：正好贴合轮换节奏，保证下发的总是当前窗口的码。
  // 曾以为「旧码也一直可用所以 TTL 可以放松」—— 已被实测推翻（见
  // CODE_STORE_STALE_MAX_MS 的注释：45~60 分钟只有 10/27 可用）。
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
  private setManifestCodeCache(gid: string, code: string, depotId?: string): void {
    this.manifestCodeCache.set(gid, { code, fetchedAt: Date.now(), depotId });
    if (depotId) this.indexDepotGid(depotId, gid);
    this.markCodeStoreDirty();
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

  /**
   * 该 GID 是否已有新鲜正缓存 —— 供限流器放行「必然零上游流量」的请求。
   *
   * 限流器的目的是防止公开接口被用来枚举随机 GID、把中继变成对上游的放大器。
   * 但命中正缓存的请求**根本不碰上游**，把它计入额度只会让合法用户先撞墙：
   * 一个 28 分包的游戏，Steam 是逐分包回调取码的，点一次下载就是 28 次请求，
   * 点两次 56 次 —— 120/分钟的额度撑不住几轮重试，而其中绝大多数是缓存命中。
   */
  public hasFreshCode(gid: string): boolean {
    const cached = this.manifestCodeCache.get(gid);
    return !!cached && Date.now() - cached.fetchedAt < this.MANIFEST_CODE_TTL_MS;
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
  public async getManifestCode(gid: string, depotId?: string): Promise<ManifestCodeResult> {
    if (!gid || !/^\d+$/.test(gid)) {
      // 非法 gid 是**请求方**错误（controller 已在更外层回 400），
      // 这里报 definitiveMiss 只是为了让返回值语义完整，不会真的写负缓存。
      return { code: null, definitiveMiss: true, transient: false };
    }
    // depotId 是可选的：内核老版本回调只给 gid，不带它也要能正常工作。
    //
    // 缺了它时先尝试从 depot 索引反查 —— 末位兜底源（古韵 index.php /
    // 20770407）都以 (depot, gid) 为联合键，光有 gid 只能退到必然 502 的
    // dex.php，整条兜底链哑掉。索引里通常早有归属记录。
    const resolvedDepotId =
      depotId && /^\d+$/.test(depotId) ? depotId : this.findDepotIdForGid(gid);
    if (resolvedDepotId) this.indexDepotGid(resolvedDepotId, gid);

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

    const task = this.fetchManifestCodeFromUpstream(gid, resolvedDepotId);
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
  private async fetchManifestCodeFromUpstream(gid: string, depotId?: string): Promise<ManifestCodeResult> {
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
          // 403 = Cloudflare 拒绝。我们的 UA 已在白名单里（实测只有
          // ManifestDeX/1.0 能过），所以 403 不可能是 UA 问题，而是出口 IP 被拦。
          // **不重试** —— 3 秒退避不可能改变 IP 的封锁状态，重试只是白等一轮。
          // 分类上仍属瞬时（不写负缓存），交给熔断把后续请求也快速失败。
          sawTransient = true;
          break;
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

    // 熔断期间若手里有旧码，前面已经返回；走到这里说明码库也没有。
    // 下面这跳**不受熔断影响** —— 否则上游一挂，本中继就再也拿不到新码，
    // 码库只能吃老本，永远等不到恢复。
    //
    // 末位兜底：第三方码库。顺序按「先准后宽、先快后慢」：
    //   ① 古韵 index.php —— 有缓存层（实测 X-Cache: HIT，热请求 0.15 秒）
    //   ② 20770407.xyz  —— 与古韵**同源数据**（实测 10/10 组合逐字节相同），
    //                      但恒为 ~1.0 秒且不缓存。放在古韵之后当第二条命：
    //                      它不提供新码，只保证古韵域名挂掉时还有路可走。
    //   ③ 古韵 dex.php  —— gid-only 实时聚合层，上游全挂时它自己就回 502。
    //                      没有 depotId 时的最后选择。
    // 兜底源失败与「权威源瞬时故障」必须分开计数：
    //
    // 旧实现把兜底源的任何非码响应都置 sawTransient = true，后果有二：
    // ① 负缓存永不可达 —— `sawDefinitiveMiss && !sawTransient` 恒假，于是公开接口
    //    每次随机 gid 请求都要串行打 3~4 个第三方源，正是注释所担心的「放大器」；
    // ② 任何人用随机 gid 打公开接口，兜底源对未知 gid 必然返回非码，
    //    从而把 upstreamBreakerOpenUntil 推后 —— **全站所有 gid** 的取码在 20 秒内
    //    只剩旧码或 503。一次随机请求即可让全体用户取不到码，属放大攻击面。
    //
    // 只有权威源自身出现 429/403/5xx/网络异常才算 transient 并允许开熔断。
    let sawFallbackFailure = false;
    const guyunUrls: string[] = [];
    if (depotId && /^\d+$/.test(depotId)) {
      guyunUrls.push(`https://gmrc.guyunsq.com/index.php/${depotId}/${gid}`);
      guyunUrls.push(`https://20770407.xyz/manifest/${depotId}/${gid}`);
    }
    guyunUrls.push(`https://gmrc.guyunsq.com/dex.php/${gid}`);
    for (const url of guyunUrls) {
      try {
        const fb = await axios.get(url, {
          timeout: this.MANIFEST_CODE_UPSTREAM_TIMEOUT_MS,
          responseType: 'text',
          validateStatus: () => true
        });
        if (fb.status === 200 && typeof fb.data === 'string') {
          const t = fb.data.trim();
          if (/^\d+$/.test(t) && t !== '0') {
            this.setManifestCodeCache(gid, t, depotId);
            this.upstreamBreakerOpenUntil = 0;
            return { code: t, definitiveMiss: false, transient: false };
          }
          // 200 但不是码：该源没有，不算权威判定（它是聚合层，不是权威源）
          sawFallbackFailure = true;
        } else {
          sawFallbackFailure = true;
        }
      } catch {
        sawFallbackFailure = true;
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
    // 权威源已明确判定「没有这个 gid」，且兜底源也没给出码：
    // 此时应如实回 404（让客户端写负缓存），而不是因为兜底源的一次失败就
    // 谎报 transient —— 后者会让客户端反复重试同一个必然不存在的 gid。
    if (sawDefinitiveMiss) {
      return { code: null, definitiveMiss: true, transient: false };
    }
    // 权威源没给出结论、兜底源也全失败：确实不知道有没有，报 transient 让客户端稍后重试
    if (sawFallbackFailure) {
      return { code: null, definitiveMiss: false, transient: true };
    }
    return { code: null, definitiveMiss: false, transient: false };
  }

  /**
   * 上游不可用时的兜底：优先下发仍在 STALE 窗口内的旧码，否则才回 503。
   *
   * 旧码只在**约半小时内**真的还能用（实测 0~15 分钟 27/27 可用、45~60 分钟
   * 只剩 10/27、120 分钟以上 0/27）。半小时内它远比 503 有价值 —— 能让下载立刻
   * 开始，而 503 会让 Steam 的下载流程停在那里等重试；超过半小时则相反：
   * 下发一个几乎必然 401 的码会让下载卡住，不如回 503 让客户端立刻重试。
   *
   * 注意此处**不刷新** fetchedAt：旧码只是「能顶用」，不该被当成新鲜码再锁 5 分钟，
   * 否则上游一恢复我们仍会继续用旧码。
   */
  private serveStaleOrTransient(gid: string, transient: boolean): ManifestCodeResult {
    const stale = this.manifestCodeCache.get(gid);
    // 窗口取 30 分钟（CODE_STORE_STALE_MAX_MS），落在实测可用区间内。
    // 不能用更长窗口：旧码越老，Steam 拿它拉不到清单的概率越高。
    if (stale && Date.now() - stale.fetchedAt < ManifestService.CODE_STORE_STALE_MAX_MS) {
      return { code: stale.code, definitiveMiss: false, transient: false, stale: true };
    }
    return { code: null, definitiveMiss: false, transient };
  }

  /** 重试退避：优先读上游 Retry-After，缺失时按 3 秒递增 */
  private async sleepCodeRetry(attempt: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, Math.min(3000 * (attempt - 1), 6000)));
  }

  // ==================== 低频主动补码 ====================
  //
  // 定位：**只补客户端上报覆盖不到的长尾**，不是主力数据来源。
  //
  // 为什么必须低频：第三方接口现在完全不设防（实测 UA 不校验、20 次连打零限流、
  // 伪造 XFF 不分桶），但那是针对**分散的客户端 IP**。若服务端从一个出口 IP
  // 每天打它几十万次，它必然会发现并封掉 —— 封的是服务器，沉淀管道就断了。
  // 而客户端上报天然分散，主力必须走那条路。
  //
  // 为什么不会失控：补码目标来自 depotGidIndex —— 只包含**真实被请求过**的
  // (depot, gid)，绝不遍历整个 Steam 目录。gid 稳定（只在 depot 内容更新时才变）
  // 使这个集合缓慢增长，因此长期看它是收敛的，不是无限膨胀的爬取任务。
  private backfillRunning = false;
  /** 每轮补码条数上限。取小值：宁可慢，不可把对端惹毛。 */
  private static readonly BACKFILL_BATCH = 8;
  /** 每条之间的间隔。合起来把速率压在约 1 条/秒以内。 */
  private static readonly BACKFILL_GAP_MS = 1500;

  /**
   * 补一轮过期码。返回实际补到的条数。
   *
   * 走 index.php/{depot}/{gid} 而非 dex.php：前者查自有库（实测正确组合 200
   * 且 X-Cache: HIT），后者是实时聚合层，上游全挂时它自己就回 502。
   */
  public async backfillStaleCodes(): Promise<number> {
    if (this.backfillRunning) return 0;
    const targets = this.listStaleCodeTargets(ManifestService.BACKFILL_BATCH);
    if (targets.length === 0) return 0;

    this.backfillRunning = true;
    let filled = 0;
    try {
      for (const t of targets) {
        let got = false;
        // 两个同源端点轮流当备份：古韵有缓存层（热 0.15 秒）优先，
        // 20770407.xyz 恒定 ~1.0 秒但可用性独立，古韵一挂就顶上。
        // 两者数据逐字节相同（实测 10/10），所以谁先谁后只影响延迟，不影响结果。
        for (const url of [
          `https://gmrc.guyunsq.com/index.php/${t.depotId}/${t.gid}`,
          `https://20770407.xyz/manifest/${t.depotId}/${t.gid}`
        ]) {
          try {
            const resp = await axios.get(url, {
              timeout: this.MANIFEST_CODE_UPSTREAM_TIMEOUT_MS,
              responseType: 'text',
              validateStatus: () => true
            });
            if (resp.status === 200 && typeof resp.data === 'string') {
              const code = resp.data.trim();
              if (/^\d+$/.test(code) && code !== '0') {
                // 注意这里用 setManifestCodeCache 而非 reportManifestCodes：
                // 前者按 fetchedAt 直接覆盖（补码的目的就是刷新时间戳），
                // 后者会跳过「不够新」的条目，正好与补码意图相反。
                this.setManifestCodeCache(t.gid, code, t.depotId);
                this.codeMissAt.delete(t.gid);
                filled++;
                got = true;
                break; // 拿到就够了，不必再问第二个端点
              }
            }
          } catch {
            // 单条失败无所谓，下一轮还会再试；继续试下一个端点
          }
        }
        // 两个端点都没给出码：记下本次尝试时间。
        // listStaleCodeTargets 据此计算码龄并强制重试间隔 —— 否则
        // 「从未有码」的条目会在每一轮补码中反复占据名额。
        if (!got) this.noteCodeMiss(t.gid);
        await new Promise((r) => setTimeout(r, ManifestService.BACKFILL_GAP_MS));
      }
    } finally {
      this.backfillRunning = false;
      if (filled > 0) {
        console.log(
          `[ManifestService] 主动补码完成: ${filled}/${targets.length} 条` +
            `｜码库 ${this.manifestCodeCache.size} 条 / ${this.depotGidIndex.size} 个 depot`
        );
      }
    }
    return filled;
  }

  /**
   * 手动体检：并发探测取码链路上的每个上游源，返回状态码、延迟与结果摘要。
   *
   * 用途：上游挂掉时，过去只能从用户反馈或日志里间接推断「是哪一跳坏了」。
   * 有了它，管理端点一下就能看到「ManifestDeX 521 / 古韵 200 / 20770407 401」
   * 这样的逐源快照，不必再去翻 diag 日志。
   *
   * 探测对象是**取码源**，不含清单实体镜像（P-ToyStore / SteamML / Remlua /
   * ManifestHub.uk）—— 那几条只在下载实体清单时用到，与日常取码故障无关。
   *
   * 探针目标 (depotId, gid)：优先从码库/索引里取一条真实记录（这样探测的是
   * 真实存在的组合，结果才有意义）；取不到时允许调用方显式传入。
   * **绝不随机造 gid** —— 那只会让所有源都返回 404，看起来像"全部挂了"。
   */
  public async checkAllSources(override?: {
    depotId?: string;
    gid?: string;
  }): Promise<{
    checkedAt: string;
    probe: { depotId: string; gid: string; from: 'override' | 'code_store' | 'preset' } | null;
    probes: Array<{
      id: string;
      label: string;
      url: string;
      ok: boolean;
      httpStatus: number | null;
      latencyMs: number;
      codeFingerprint: string | null;
      detail: string;
    }>;
    /** 各源返回的码值是否互相矛盾（滞后码/陈旧节点的核心信号） */
    codeConsistent: boolean;
    distinctCodeCount: number;
    note: string;
  }> {
    const checkedAt = new Date().toISOString();

    // 1. 选定探针目标：显式传入 > 码库里最新鲜的一条（带 depotId 的）> 预设测试 ID
    //
    // 预设目标（Depot 731 / GID 7537979033605526179）只在码库为空时兜底。
    // 它必须用独立的 from='preset' 上报 —— 早期实现把它标成 'code_store'，
    // 界面于是显示成"码库中最新鲜的一条"，与事实不符，也会让排障者
    // 误以为探测的是自己刚入库的真实组合。
    let depotId = String(override?.depotId || '').trim();
    let gid = String(override?.gid || '').trim();
    let from: 'override' | 'code_store' | 'preset' = 'override';
    if (!/^\d+$/.test(depotId) || !/^\d+$/.test(gid) || gid === '0') {
      depotId = '';
      gid = '';
      from = 'code_store';
      let bestTs = -1;
      for (const [g, entry] of this.manifestCodeCache) {
        if (!entry.depotId || !/^\d+$/.test(entry.depotId)) continue;
        if (entry.fetchedAt > bestTs) {
          bestTs = entry.fetchedAt;
          gid = g;
          depotId = entry.depotId;
        }
      }
    }

    if (!gid || !depotId) {
      // 码库尚无带 depotId 的记录：退回稳定小游戏测试目标（Depot 731），
      // 明确标记为 preset，界面按"预设测试ID"如实展示
      depotId = '731';
      gid = '7537979033605526179';
      from = 'preset';
    }

    // 2. 逐源定义。顺序与客户端 manifest.lua 的取码链路一致。
    const targets: Array<{ id: string; label: string; url: string; headers: Record<string, string> }> = [
      {
        id: 'manifestdex',
        label: 'ManifestDeX 权威码源',
        url: `https://manifest.manifestdex.com/${gid}`,
        // 必须恰好是这个 UA —— 上游按 provider 白名单校验，缺失一律 403
        headers: { 'User-Agent': 'ManifestDeX/1.0' }
      },
      {
        id: 'guyun_index',
        label: '古韵自有码库 (Depot+GID主通道)',
        url: `https://gmrc.guyunsq.com/index.php/${depotId}/${gid}`,
        headers: { 'User-Agent': 'ChunFengDu/1.0' }
      },
      {
        id: 'x20770407',
        label: '20770407.xyz (同源冗余镜像)',
        url: `https://20770407.xyz/manifest/${depotId}/${gid}`,
        headers: { 'User-Agent': 'ChunFengDu/1.0' }
      },
      {
        id: 'guyun_dex',
        label: '古韵聚合接口 (纯GID备用通道)',
        url: `https://gmrc.guyunsq.com/dex.php/${gid}`,
        headers: { 'User-Agent': 'ChunFengDu/1.0' }
      }
    ];

    // 3. 并发探测。单个源失败不影响其它源 —— 体检的全部价值就在于逐个独立判断。
    const settled = await Promise.allSettled(
      targets.map(async (t) => {
        const started = Date.now();
        const resp = await axios.get(t.url, {
          timeout: 20000,
          responseType: 'text',
          headers: t.headers,
          // 与取码链路一致：不让 axios 对 4xx/5xx 抛异常，
          // 必须看到状态码才能区分「源挂了」与「这个 gid 它没有」
          validateStatus: () => true
        });
        return { t, resp, latencyMs: Date.now() - started };
      })
    );

    const probes = settled.map((s, i) => {
      const t = targets[i];
      if (s.status === 'rejected') {
        return {
          id: t.id,
          label: t.label,
          url: t.url,
          ok: false,
          httpStatus: null,
          latencyMs: -1,
          codeFingerprint: null,
          detail: `请求异常：${s.reason?.message || String(s.reason)}`
        };
      }
      const { resp, latencyMs } = s.value;
      const body = typeof resp.data === 'string' ? resp.data.trim() : '';
      const isCode = /^\d+$/.test(body) && body !== '0';
      // 码值只回指纹（前 4 + 后 4）：这是排障用的，没必要把完整码暴露在响应里
      const fp = isCode ? `${body.slice(0, 4)}…${body.slice(-4)}（${body.length} 位）` : null;

      let detail: string;
      if (isCode) {
        detail = '正常，返回有效码';
      } else if (resp.status === 200) {
        detail = `HTTP 200 但内容不是纯数字码：${body.slice(0, 80) || '(空响应)'}`;
      } else if (resp.status === 404) {
        detail = 'HTTP 404 — 该源没有这条 gid（不等于源故障）';
      } else if (resp.status === 401) {
        detail = 'HTTP 401 — 该源库里没有这个 (depot, gid) 组合（确认查不到）';
      } else if (resp.status === 403) {
        detail = 'HTTP 403 — Cloudflare 质询，通常是出口 IP 被拦或 UA 不符';
      } else if (resp.status === 429) {
        detail = 'HTTP 429 — 该源按 IP 限流中，稍后重试';
      } else if (resp.status >= 500 && resp.status <= 599) {
        detail =
          resp.status >= 520 && resp.status <= 526
            ? `HTTP ${resp.status} — Cloudflare 源站不可达（521 源站挂 / 522 连接超时 / 523 源不可达 / 524 响应超时）`
            : `HTTP ${resp.status} — 上游过载或故障`;
      } else {
        detail = `HTTP ${resp.status}`;
      }

      return {
        id: t.id,
        label: t.label,
        url: t.url,
        ok: isCode,
        httpStatus: resp.status,
        latencyMs,
        codeFingerprint: fp,
        detail
      };
    });

    const okCount = probes.filter((p) => p.ok).length;

    // 码值一致性判定：只数「出码」不够 —— 一个源可以返回 HTTP 200 + 纯数字，
    // 但那个数字是**滞后码**（上游还没刷新完），用它向 Valve CDN 请求清单会拿不到数据，
    // 表现为「无网络连接 / 0 字节下载」。多源码值不一致正是滞后节点的唯一可观测信号。
    // 说明：只统计原始码，指纹（含位数）不参与比较，避免同码不同位数被误判。
    const rawCodes = settled
      .map((s) => (s.status === 'fulfilled' && typeof s.value.resp.data === 'string' ? s.value.resp.data.trim() : ''))
      .filter((b) => /^\d+$/.test(b) && b !== '0');
    const distinctCodeCount = new Set(rawCodes).size;
    const codeConsistent = distinctCodeCount <= 1;

    let note: string;
    if (okCount === 0) {
      note = `本次探测中 ${probes.length} 个源都未返回有效码。注意：若探针 gid 恰好已被 Valve 轮换，各源返回 404/401 也属正常，请换一条较新的 (depotId, gid) 复测。`;
    } else if (!codeConsistent) {
      note = `⚠️ ${okCount}/${probes.length} 个源出码，但各源返回了 ${distinctCodeCount} 个**互相矛盾**的码值。这通常意味着部分源（通常是刷新节奏滞后的镜像）给出了陈旧值 —— 用陈旧码向 Valve CDN 请求清单会失败，表现为「无网络连接 / 0 字节下载」。请以上方 ManifestDeX 权威源的码值为准，并优先排查给出不同码值的镜像源。`;
    } else {
      note = `${okCount}/${probes.length} 个源可正常出码，且各源码值一致。只要权威源（ManifestDeX）恢复，客户端就会自动跳过后续兜底源 —— 熔断窗口仅 60 秒，无需任何手动干预。`;
    }

    return {
      checkedAt,
      probe: { depotId, gid, from },
      probes,
      codeConsistent,
      distinctCodeCount,
      note
    };
  }

  /**
   * 上游清单数据源极速连通性与 Ping 延迟测试（纯网络连通性探测，对标 Fluent Steam Lua 连通测试，零输入、毫秒级响应）
   */
  async pingManifestSources(): Promise<{
    checkedAt: string;
    probes: Array<{
      id: string;
      label: string;
      host: string;
      ok: boolean;
      httpStatus: number | null;
      latencyMs: number;
      detail: string;
    }>;
  }> {
    const checkedAt = new Date().toISOString();
    const pingTargets = [
      {
        id: 'manifestdex',
        label: 'ManifestDeX 权威码源',
        host: 'https://manifest.manifestdex.com/',
        headers: { 'User-Agent': 'ManifestDeX/1.0' },
        note: '当前全网唯一实时维护的权威源（全球 CDN）'
      },
      {
        id: 'x20770407',
        label: '20770407.xyz 同源镜像',
        host: 'https://20770407.xyz/',
        headers: { 'User-Agent': 'ChunFengDu/1.0' },
        note: 'Fluent 常用镜像，与古韵码库互为冗余'
      },
      {
        id: 'guyun',
        label: '古韵 GMRC 自有码库',
        host: 'https://gmrc.guyunsq.com/',
        headers: { 'User-Agent': 'ChunFengDu/1.0' },
        note: '国内自有码库单点（国内直连）'
      },
      {
        id: 'cloud_direct',
        label: '春风渡 云端直连中继',
        host: `${CONFIG.CLOUD_API_BASE}/api/health`,
        headers: { 'User-Agent': 'ChunFengDu/1.0' },
        note: '服务端单航班收敛缓存，秒级下发'
      },
      {
        id: 'steamrun',
        label: 'SteamRun 官方源 (已停服)',
        host: 'https://manifest.steam.run/',
        headers: { 'User-Agent': 'ChunFengDu/1.0' },
        note: '早期老版源，目前已停服不可用'
      },
      {
        id: 'wudrm',
        label: 'WUDRM 高速源 (已停服)',
        host: 'http://gmrc.wudrm.com/',
        headers: { 'User-Agent': 'ChunFengDu/1.0' },
        note: '早期老版源，持续 503 已停服'
      },
      {
        id: 'opensteamtool',
        label: 'OpenSteamTool 社区源 (已停服)',
        host: 'https://opensteamtool.com/',
        headers: { 'User-Agent': 'ChunFengDu/1.0' },
        note: '早期 OST 社区源，已停服无法连通'
      }
    ];

    const settled = await Promise.allSettled(
      pingTargets.map(async (t) => {
        const started = Date.now();
        const resp = await axios.get(t.host, {
          // 与前端提示文案保持一致（"最长约 5 秒"）；原 6s 会让用户觉得已经卡住
          timeout: 5000,
          headers: t.headers,
          validateStatus: () => true
        });
        return { t, resp, latencyMs: Date.now() - started };
      })
    );

    const probes = settled.map((s, i) => {
      const t = pingTargets[i];
      if (s.status === 'rejected') {
        return {
          id: t.id,
          label: t.label,
          host: t.host,
          ok: false,
          httpStatus: null,
          latencyMs: -1,
          detail: `${t.note ? t.note + ' · ' : ''}连接失败：${s.reason?.message || '网络超时或服务已停机'}`
        };
      }
      const { resp, latencyMs } = s.value;
      // 纯连通性判定：收到任何 HTTP 响应就说明「DNS + TCP + TLS + 服务端在应答」都通了。
      // 4xx 也算连通（探测根路径时 403/404 很常见），但它**不代表该源可用** ——
      // 出码可用性由「出码体检」负责，两者语义必须分开，文案里已明确写清。
      const isAlive = resp.status > 0;
      return {
        id: t.id,
        label: t.label,
        host: t.host,
        ok: isAlive,
        httpStatus: resp.status,
        latencyMs,
        detail: isAlive
          ? `${t.note ? t.note + ' · ' : ''}连通正常 · 服务器在线响应 (HTTP ${resp.status})；本项只测连通与延迟，出码可用性请看「出码体检」`
          : `${t.note ? t.note + ' · ' : ''}服务器响应异常 (HTTP ${resp.status})`
      };
    });

    return { checkedAt, probes };
  }

  // 补码循环句柄：保存下来才能停止。旧实现丢弃 setInterval 返回值，
  // 进程退出时无法 clearInterval，且 server.ts 若被重复调用（热重载/多次初始化）
  // 会叠加多个循环 —— backfillRunning 只能防单轮重叠，防不住多循环并存。
  private backfillTimer: ReturnType<typeof setInterval> | null = null;

  /** 启动低频补码循环。由 server.ts 在启动时调用一次。 */
  public startBackfillLoop(intervalMs: number): void {
    this.stopBackfillLoop();
    this.backfillTimer = setInterval(() => {
      this.backfillStaleCodes().catch(() => {});
    }, intervalMs);
    (this.backfillTimer as any).unref?.();
  }

  /** 停止补码循环（重复启动前与进程退出时调用） */
  public stopBackfillLoop(): void {
    if (this.backfillTimer) {
      clearInterval(this.backfillTimer);
      this.backfillTimer = null;
    }
  }
}

export const manifestService = new ManifestService();

// 码库落盘钩子：正常退出与 SIGINT/SIGTERM 都要刷一次，
// 否则最近的取码成果会随进程一起丢掉（定时器最长 30 秒才落一次盘）。
// 与 dlcIndexService 同样的模式，保证 pm2 restart 不丢数据。
const flushCodeStoreOnExit = () => {
  manifestService.stopBackfillLoop();
  manifestService.flushCodeStore();
};
process.once('beforeExit', flushCodeStoreOnExit);
process.once('SIGINT', () => {
  flushCodeStoreOnExit();
  process.exit(0);
});
process.once('SIGTERM', () => {
  flushCodeStoreOnExit();
  process.exit(0);
});
