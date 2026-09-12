import fs from 'fs';
import path from 'path';
import axios from 'axios';
import AdmZip from 'adm-zip';
import { CONFIG } from '../config/index.js';
import { depotService } from './depotService.js';

/// 上游清单 ZIP 下载体积上限（50MB）：防止超大响应或 zip 炸弹耗尽服务端内存
const MAX_UPSTREAM_ZIP_BYTES = 50 * 1024 * 1024;
/// 解压侧限制：单条目 ≤50MB，总条目数 ≤2000，防止声明式膨胀与海量写入阻塞事件循环
const MAX_ZIP_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 2000;

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

export interface AppManifestResult {
  success: boolean;
  appId: number;
  source: 'local_cache' | 'gmrc' | 'manifesthub' | 'steamml' | 'remlua' | 'manifesthub_uk' | 'ptystore' | 'none';
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
          message: `从 P-ToyStore 极速检索到 ${pToy.depots.length} 个最新分包清单！`
        };
      }
    } catch (err: any) {
      console.warn(`[ManifestService] P-ToyStore 检索异常 (${appId}):`, err.message);
    }

    // 3. 多源并发竞速兜底：SteamML (Cloudflare R2) + Remlua (AWS CloudFront) + ManifestHub3 高速镜像并行检索 (全量与免费游戏)
    try {
      const [steamResult, remluaResult, hubResult] = await Promise.allSettled([
        this.fetchFromSteamML(appId, candidateDepotIds),
        this.fetchFromRemlua(appId, candidateDepotIds),
        this.fetchFromManifestHub(appId, candidateDepotIds)
      ]);

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
    } catch (err: any) {
      console.warn(`[ManifestService] 并发清单检索异常 (${appId}):`, err.message);
    }

    // 3. 末位冷备容灾：ManifestHub.uk（严格限制触发条件，防止触发单 IP 频控，且一旦命中即落盘本地缓存）
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
      console.warn(`[ManifestService] ManifestHub.uk 检索失败 (${appId}):`, err.message);
    }

    // 若本地缓存与各云端源均未找到清单文件，直接返回未收录提示
    return {
      success: false,
      appId,
      source: 'none',
      depots: [],
      keys,
      message: '暂时没有这款游戏（云端暂未收录该游戏的清单文件）'
    };
  }

  /**
   * 扫描本地 manifests/ 目录下匹配 depotId 的 .manifest 文件
   * 支持两种存放方式：
   * 1. ManifestHub3 标准树形结构：manifests/<appId>/<depotId>_<manifestId>.manifest 及 <appId>.json
   * 2. 全局扁平存放：manifests/<depotId>_<manifestId>.manifest
   */
  private scanLocalManifests(depotIds: string[], appId?: number): DepotManifestInfo[] {
    if (!fs.existsSync(this.manifestDir)) return [];
    const results: DepotManifestInfo[] = [];
    const matchedDepots = new Set<string>();

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
              if (depotIds.length > 0 && !depotIds.includes(dId)) continue;
              let gid: string | undefined;
              if (dInfo.manifests && typeof dInfo.manifests === 'object') {
                gid = dInfo.manifests.public?.gid || Object.values<any>(dInfo.manifests)[0]?.gid;
              }
              if (gid && gid !== '0' && /^\d+$/.test(gid.toString())) {
                const manifestFile = path.join(appDir, `${dId}_${gid}.manifest`);
                const flatFile = path.join(this.manifestDir, `${dId}_${gid}.manifest`);
                // 无论清单实体在 appDir 还是平铺在 manifestDir，只要存在即可
                if (fs.existsSync(manifestFile) || fs.existsSync(flatFile)) {
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

      // 扫描 appId 子目录下的所有 .manifest 实体
      if (fs.existsSync(appDir) && fs.statSync(appDir).isDirectory()) {
        try {
          const files = fs.readdirSync(appDir);
          for (const file of files) {
            const match = file.match(/^(\d+)_(\d+)\.manifest$/i);
            if (match) {
              const [, dId, mId] = match;
              if (!matchedDepots.has(dId) && (depotIds.length === 0 || depotIds.includes(dId))) {
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
        } catch {}
      }
    }

    // 2. 扫描扁平根目录: manifests/<depotId>_<manifestId>.manifest
    try {
      const files = fs.readdirSync(this.manifestDir);
      for (const file of files) {
        const match = file.match(/^(\d+)_(\d+)\.manifest$/i);
        if (match) {
          const [, dId, mId] = match;
          if (!matchedDepots.has(dId) && (depotIds.length === 0 || depotIds.includes(dId))) {
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
    } catch {}

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
   * 沉淀应由明确的下载路径（getManifestsForApp / 客户端请求清单文件）按需触发。
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
    try {
      const vdfPromises = fastBases.map(async (base) => {
        const resp = await axios.get(`${base}/${appId}/appinfo.vdf`, {
          timeout: 2500,
          responseType: 'text',
          transformResponse: [(data) => data]
        });
        if (resp.status === 200 && typeof resp.data === 'string' && resp.data.includes('"depots"')) {
          return resp.data;
        }
        throw new Error('Invalid appinfo.vdf');
      });

      const vdfText = await Promise.any(vdfPromises);
      if (vdfText) {
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
    } catch {}

    return { depots: results, buildId };
  }

  /**
   * 从 GitHub ManifestHub3 加速源检索（并发竞速极速通道：ghfast.top 与 gh-proxy.com）
   */
  private async fetchFromManifestHub(appId: number, depotIds: string[]): Promise<DepotManifestInfo[]> {
    const results: DepotManifestInfo[] = [];
    const fastBases = [
      'https://steam.os.kg/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://ghfast.top/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://gh-proxy.com/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://cece.guyunsq.com/https://raw.githubusercontent.com/steamtools-games/ManifestHub3'
    ];

    // 1. 优先并发拉取 {appId}.json
    try {
      const jsonPromises = fastBases.map(async (base) => {
        const resp = await axios.get(`${base}/${appId}/${appId}.json`, { timeout: 2500 });
        if (resp.status === 200 && resp.data && resp.data.depot && typeof resp.data.depot === 'object') {
          return resp.data;
        }
        throw new Error('Invalid json');
      });
      const data = await Promise.any(jsonPromises);
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
              downloadUrl: `/api/manifests/download/${dId}/${gid}?appId=${appId}`,
              source: 'manifesthub',
              key
            });
          }
        }
      }
    } catch {}

    // 2. 若 json 失败，兜底并发尝试拉取 {appId}.lua / {appId}_public.lua
    if (results.length === 0) {
      const luaUrls: string[] = [];
      for (const base of fastBases) {
        luaUrls.push(`${base}/${appId}/${appId}.lua`);
        luaUrls.push(`${base}/${appId}/${appId}_public.lua`);
      }
      try {
        const luaPromises = luaUrls.map(async (lu) => {
          const resp = await axios.get(lu, { timeout: 2500 });
          const lua = typeof resp.data === 'string' ? resp.data : '';
          if (lua.includes('setManifestid') || lua.includes('addappid')) {
            return lua;
          }
          throw new Error('Invalid lua');
        });
        const lua = await Promise.any(luaPromises);
        if (lua) {
          const gidMap = new Map<string, string>();
          const keyMap = new Map<string, string>();

          for (const rawLine of lua.split('\n')) {
            const line = rawLine.trim();
            const mMatch = line.match(/^setManifestid\((\d+)\s*,\s*"(\d+)"/);
            if (mMatch && mMatch[2] !== '0') {
              gidMap.set(mMatch[1], mMatch[2]);
            }
            const kMatch = line.match(/^(?:addappid|setDepotKey)\((\d+)\s*,\s*(?:\d+\s*,\s*)?"([0-9a-fA-F]{32,})"/);
            if (kMatch && !/^0+$/.test(kMatch[2])) {
              keyMap.set(kMatch[1], kMatch[2]);
            }
          }

          for (const [dId, gid] of gidMap) {
            if (depotIds.length > 0 && !depotIds.includes(dId)) continue;
            const key = keyMap.get(dId) || depotService.getDepotKey(dId) || undefined;
            results.push({
              depotId: dId,
              manifestId: gid,
              downloadUrl: `/api/manifests/download/${dId}/${gid}?appId=${appId}`,
              source: 'manifesthub',
              key
            });
          }
        }
      } catch {}
    }

    // 3. 异步后台触发沉淀落盘（非阻塞），确保后续下载请求秒级响应
    for (const item of results) {
      this.ensureManifestCached(item.depotId, item.manifestId, appId).catch(() => {});
    }

    return results;
  }

  /**
   * ManifestHub.uk 确定性密钥代换加密算法
   */
  public encodeManifestHubUKCipher(appId: number | string): string {
    const SECRET_KEY = 'N4F1S_FU4D_OWN_SYSTEM_2025';
    const str = String(appId);
    let table = '0123456789'.split('');
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
    try {
      const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 7000, maxContentLength: MAX_UPSTREAM_ZIP_BYTES });
      if (resp.status === 200 && resp.data && resp.data.byteLength > 0) {
        return this.unpackZipAndExtractManifests(appId, Buffer.from(resp.data), depotIds, 'steamml');
      }
    } catch {}
    return [];
  }

  /**
   * 从 Remlua (AWS CloudFront 直连 CDN) 检索并解压清单实体
   */
  public async fetchFromRemlua(appId: number, depotIds: string[] = []): Promise<DepotManifestInfo[]> {
    const url = `https://d41hvr6rtvs2p.cloudfront.net/${appId}.zip`;
    try {
      const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 7000, maxContentLength: MAX_UPSTREAM_ZIP_BYTES });
      if (resp.status === 200 && resp.data && resp.data.byteLength > 0) {
        return this.unpackZipAndExtractManifests(appId, Buffer.from(resp.data), depotIds, 'remlua');
      }
    } catch {}
    return [];
  }

  /**
   * 从 ManifestHub.uk 检索并解压清单实体
   */
  public async fetchFromManifestHubUK(appId: number, depotIds: string[] = []): Promise<DepotManifestInfo[]> {
    const encId = this.encodeManifestHubUKCipher(appId);
    const proxyUrl = `https://api.manifesthub.uk/proxy?id=${encId}`;
    try {
      const htmlResp = await axios.get(proxyUrl, {
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Referer': 'https://steamtools.pages.dev/'
        }
      });
      const html = typeof htmlResp.data === 'string' ? htmlResp.data : '';
      const downloadMatches = Array.from(html.matchAll(/href="(\/download\?[^"]+)"/g)).map((m) => m[1]);
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
    } catch {}
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

      // 解析 Lua 获取 key 和 gid
      const gidMap = new Map<string, string>();
      const keyMap = new Map<string, string>();
      if (luaContent) {
        for (const rawLine of luaContent.split('\n')) {
          const line = rawLine.trim();
          const mMatch = line.match(/^setManifestid\((\d+)\s*,\s*"(\d+)"/);
          if (mMatch && mMatch[2] !== '0') {
            gidMap.set(mMatch[1], mMatch[2]);
          }
          const kMatch = line.match(/^(?:addappid|setDepotKey)\((\d+)\s*,\s*(?:\d+\s*,\s*)?"([0-9a-fA-F]{32,})"/);
          if (kMatch && !/^0+$/.test(kMatch[2])) {
            keyMap.set(kMatch[1], kMatch[2]);
          }
        }
      }

      // 解压并落盘所有 .manifest 文件
      let extractedBytes = 0;
      for (const item of manifestEntries) {
        // 解压体积上限：阻止声明式膨胀（zip 炸弹）
        const declared = typeof item.entry?.header?.size === 'number' ? item.entry.header.size : 0;
        if (declared > MAX_ZIP_ENTRY_BYTES || extractedBytes + declared > MAX_UPSTREAM_ZIP_BYTES) {
          console.warn(`[ManifestService] ZIP 解压量超限，已跳过剩余条目 (已解压 ${extractedBytes} 字节)`);
          break;
        }
        const fileData = zip.readFile(item.entry);
        if (fileData && this.isValidManifestBuffer(fileData)) {
          extractedBytes += fileData.length;
          this.saveManifestFile(item.depotId, item.manifestId, fileData);
          try {
            const appDir = path.join(this.manifestDir, String(appId));
            if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true });
            fs.writeFileSync(path.join(appDir, `${item.depotId}_${item.manifestId}.manifest`), fileData);
          } catch {}

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
    try {
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
    } catch {}

    // 1. 优先尝试全球顶级边缘 CDN：SteamML (R2) 与 Remlua (CloudFront)
    // 注意：本函数运行在 metadata 查询热路径上，这里**只解析、不沉淀**。
    // 此前每轮查询都会顺带把上游 zip 内全部清单写盘（unpackZipAndExtractManifests
    // 的返回值本就未使用），等于每次查询都为该游戏做一次全量缓存，
    // 既耗服务器带宽与磁盘、又容易触发上游频控。沉淀改由客户端真正
    // 请求某个清单文件时按需触发（/api/manifests/download → ensureManifestCached）。
    try {
      const smlUrl = `https://pub-5b6d3b7c03fd4ac1afb5bd3017850e20.r2.dev/${appId}.zip`;
      const resp = await axios.get(smlUrl, { responseType: 'arraybuffer', timeout: 6000, maxContentLength: MAX_UPSTREAM_ZIP_BYTES });
      if (resp.status === 200 && resp.data && resp.data.byteLength > 0) {
        const parsed = this.parseLuaFromZip(Buffer.from(resp.data), appId);
        if (parsed && (parsed.depotKeys.size > 0 || parsed.manifestGids.size > 0)) {
          return parsed;
        }
      }
    } catch {}

    try {
      const remluaUrl = `https://d41hvr6rtvs2p.cloudfront.net/${appId}.zip`;
      const resp = await axios.get(remluaUrl, { responseType: 'arraybuffer', timeout: 6000, maxContentLength: MAX_UPSTREAM_ZIP_BYTES });
      if (resp.status === 200 && resp.data && resp.data.byteLength > 0) {
        const parsed = this.parseLuaFromZip(Buffer.from(resp.data), appId);
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
      const downloadMatches = Array.from(html.matchAll(/href="(\/download\?[^"]+)"/g)).map((m) => m[1]);
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

      const depotKeys = new Map<string, string>();
      const manifestGids = new Map<string, string>();
      const dlcIds: string[] = [];
      const sTarget = targetAppId ? targetAppId.toString() : '';
      let accessToken: string | undefined;

      for (const rawLine of lua.split('\n')) {
        const line = rawLine.trim();
        const addMatch = line.match(/^addappid\((\d+)\s*,\s*\d+\s*,\s*"([0-9a-fA-F]{32,})"\s*\)/);
        const setKeyMatch = line.match(/^setDepotKey\((\d+)\s*,\s*"([0-9a-fA-F]{32,})"\s*\)/);
        const keyMatch = addMatch || setKeyMatch;
        if (keyMatch) {
          const depotId = keyMatch[1];
          const key = keyMatch[2];
          if (!/^0+$/.test(key)) depotKeys.set(depotId, key);
          continue;
        }
        const simpleAddMatch = line.match(/^addappid\((\d+)\s*(?:,\s*\d+)?\s*\)/);
        if (simpleAddMatch) {
          const id = simpleAddMatch[1];
          if (id !== sTarget && !dlcIds.includes(id)) {
            dlcIds.push(id);
          }
          continue;
        }
        const gidMatch = line.match(/^setManifestid\((\d+)\s*,\s*"(\d{5,})"/);
        if (gidMatch && gidMatch[2] !== '0') {
          manifestGids.set(gidMatch[1], gidMatch[2]);
          continue;
        }
        const tokenMatch = line.match(/^addtoken\((\d+)\s*,\s*"([0-9a-fA-F]+)"\s*\)/);
        if (tokenMatch) {
          accessToken = tokenMatch[2];
        }
      }
      return { depotKeys, manifestGids, dlcIds, accessToken };
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

  public async ensureManifestCached(depotId: string, manifestId: string, appId?: number): Promise<string | null> {
    if (!/^\d+$/.test(String(depotId)) || !/^\d+$/.test(String(manifestId))) {
      return null;
    }
    const dedupKey = `${depotId}_${manifestId}`;
    const running = this.manifestInFlight.get(dedupKey);
    if (running) return running;

    const task = this.ensureManifestCachedInner(depotId, manifestId, appId);
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
      try {
        const promises = hubManifestUrls.map(async (url) => {
          const resp = await axios.get(url, { responseType: 'arraybuffer', timeout: 3500, maxContentLength: MAX_UPSTREAM_ZIP_BYTES });
          if (resp.status === 200 && resp.data && resp.data.byteLength > 0) {
            return Buffer.from(resp.data);
          }
          throw new Error('Not found');
        });
        const buf = await Promise.any(promises);
        if (buf && this.isValidManifestBuffer(buf)) {
          const saved = this.saveManifestFile(depotId, manifestId, buf);
          if (saved) {
            console.log(`[ManifestService] 成功从云端高速镜像沉淀清单到本地: ${depotId}_${manifestId}.manifest (${buf.byteLength} 字节)`);
            return targetFile;
          }
        }
      } catch {}
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
    // Protobuf 清单：保持宽松接受（清单格式存在多个世代，过度收紧会误杀有效实体），
    // 上面的 HTML/错误页特征已覆盖最常见的"文本被当清单"场景
    if ((buf[0] === 0x08 || buf[0] === 0x0a || buf[0] === 0x12) && buf.subarray(0, 32).some((b) => b > 0x7f || b === 0)) {
      return true;
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
   */
  public getLocalManifestFilePath(depotId: string, manifestId: string, appId?: number | string): string | null {
    // 1. 扁平根目录
    const candidateFlat = path.join(this.manifestDir, `${depotId}_${manifestId}.manifest`);
    const validFlat = this.checkAndReturnManifestFile(candidateFlat);
    if (validFlat) return validFlat;

    // 2. 按 AppID 子目录 (ManifestHub3 标准仓库目录)
    if (appId) {
      const candidateAppDir = path.join(this.manifestDir, String(appId), `${depotId}_${manifestId}.manifest`);
      const validAppDir = this.checkAndReturnManifestFile(candidateAppDir);
      if (validAppDir) return validAppDir;
    }

    // 3. 按 DepotID 子目录
    const candidateDepotDir = path.join(this.manifestDir, String(depotId), `${depotId}_${manifestId}.manifest`);
    const validDepotDir = this.checkAndReturnManifestFile(candidateDepotDir);
    if (validDepotDir) return validDepotDir;

    // 4. 若指定了 appId 子目录，尝试该目录下的同 depotId 模糊匹配
    if (appId) {
      try {
        const appDir = path.join(this.manifestDir, String(appId));
        if (fs.existsSync(appDir) && fs.statSync(appDir).isDirectory()) {
          const appFiles = fs.readdirSync(appDir);
          const found = appFiles.find((f) => f.startsWith(`${depotId}_`) && f.endsWith('.manifest'));
          if (found) {
            const valid = this.checkAndReturnManifestFile(path.join(appDir, found));
            if (valid) return valid;
          }
        }
      } catch {}
    }

    // 5. 扁平根目录模糊匹配
    try {
      const files = fs.readdirSync(this.manifestDir);
      const found = files.find((f) => f.startsWith(`${depotId}_`) && f.endsWith('.manifest'));
      if (found) {
        const valid = this.checkAndReturnManifestFile(path.join(this.manifestDir, found));
        if (valid) return valid;
      }
    } catch {}

    return null;
  }

  /**
   * 保存清单文件到服务端缓存
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
    try {
      const filePath = path.join(this.manifestDir, `${depotId}_${manifestId}.manifest`);
      fs.writeFileSync(filePath, buffer);
      this.maybePruneManifestDir();
      return true;
    } catch (e) {
      console.error('[ManifestService] 保存清单文件失败:', e);
      return false;
    }
  }

  /**
   * 本地清单缓存目录容量约束。
   * GID 更新会写入新文件名，旧 GID 文件不会自动消失；若不淘汰，磁盘只增不减。
   * 为避免每次保存都全量 readdir，每 200 次保存才检查一次。
   */
  private maybePruneManifestDir(): void {
    this.manifestSaveCounter += 1;
    if (this.manifestSaveCounter % 200 !== 0) return;
    try {
      const entries = fs.readdirSync(this.manifestDir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.manifest'));
      if (entries.length <= this.MANIFEST_DIR_MAX_FILES) return;

      const stats = entries.map((e) => {
        const p = path.join(this.manifestDir, e.name);
        let mtime = 0;
        try {
          mtime = fs.statSync(p).mtimeMs;
        } catch {}
        return { p, mtime };
      });
      stats.sort((a, b) => a.mtime - b.mtime);
      const removeCount = stats.length - this.MANIFEST_DIR_MAX_FILES;
      for (let i = 0; i < removeCount; i++) {
        try {
          fs.unlinkSync(stats[i].p);
        } catch {}
      }
      console.log(`[ManifestService] 清单缓存目录超限，已按最旧优先淘汰 ${removeCount} 个文件（上限 ${this.MANIFEST_DIR_MAX_FILES}）`);
    } catch (e) {
      console.warn('[ManifestService] 清单缓存目录清理失败:', e);
    }
  }

  private manifestCodeCache = new Map<string, { code: string; fetchedAt: number }>();
  private readonly MANIFEST_CODE_TTL_MS = 2 * 60 * 60 * 1000; // 2小时内存缓存
  // 容量上限：公开接口可枚举 gid，仅靠 TTL 惰性淘汰不足以防止内存无界增长
  private readonly MANIFEST_CODE_CACHE_MAX = 20000;

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

  /**
   * 获取指定 GID 的清单请求代码（Manifest Request Code）
   * 优先内存缓存 -> wudrm 官方源 -> 古韵国内镜像源 -> steamrun 亚太源
   */
  public async getManifestCode(gid: string): Promise<string | null> {
    if (!gid || !/^\d+$/.test(gid)) return null;

    // 0. 优先命中内存缓存
    const cached = this.manifestCodeCache.get(gid);
    if (cached && Date.now() - cached.fetchedAt < this.MANIFEST_CODE_TTL_MS) {
      return cached.code;
    }

    // 1. wudrm 官方清单代码源（全球最大覆盖面与最新数据）
    // 走 HTTPS：明文 HTTP 可被中间人替换返回任意数字代码，进而被客户端 Lua 内核使用
    try {
      const resp = await axios.get(`https://gmrc.wudrm.com/manifest/${gid}`, { timeout: 3500, responseType: 'text' });
      if (resp.status === 200 && typeof resp.data === 'string') {
        const text = resp.data.trim();
        if (/^\d+$/.test(text)) {
          this.setManifestCodeCache(gid, text);
          return text;
        }
      }
    } catch {}

    // 2. 古韵国内镜像源
    try {
      const resp = await axios.get(`https://gmrc.guyunsq.com/${gid}`, { timeout: 3000, responseType: 'text' });
      if (resp.status === 200 && typeof resp.data === 'string') {
        const text = resp.data.trim();
        if (/^\d+$/.test(text)) {
          this.setManifestCodeCache(gid, text);
          return text;
        }
      }
    } catch {}

    // 3. steamrun 官方镜像源
    try {
      const resp = await axios.get(`https://manifest.steam.run/api/manifest/${gid}`, { timeout: 3000 });
      if (resp.status === 200 && resp.data) {
        const code = typeof resp.data === 'string' ? resp.data.match(/"content":"(\d+)"/)?.[1] : (resp.data as any).content;
        if (code && /^\d+$/.test(String(code))) {
          const sCode = String(code);
          this.setManifestCodeCache(gid, sCode);
          return sCode;
        }
      }
    } catch {}

    return null;
  }
}

export const manifestService = new ManifestService();
