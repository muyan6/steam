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

    // 2. 尝试向 ManifestHub3 社区镜像清单库检索
    try {
      const mhResult = await this.fetchFromManifestHub(appId, candidateDepotIds);
      if (mhResult && mhResult.length > 0) {
        return {
          success: true,
          appId,
          source: 'manifesthub',
          depots: mhResult,
          keys,
          message: `从云端清单库检索到 ${mhResult.length} 个分包清单！`
        };
      }
    } catch (err: any) {
      console.warn(`[ManifestService] ManifestHub 镜像检索失败 (${appId}):`, err.message);
    }

    // 3. [已封存] GMRC 与向 Steam 请求清单的其它失效源均已封存
    // 若本地缓存与云端均未找到清单文件，直接返回未收录提示
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
   * 从 GMRC 清单分发源拉取 AppID 的清单元数据
   */
  private async fetchFromGMRC(appId: number): Promise<DepotManifestInfo[]> {
    const urls = [
      `https://gmrc.guyunsq.com/${appId}`,
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
                // 上游 download_url 白名单校验：仅允许 https，或 GMRC 源自身的 http 地址，
                // 其余一律回落为默认构造地址，防止客户端被引导到任意 http 端点
                const rawUrl = typeof item.download_url === 'string' ? item.download_url : '';
                const safeUrl =
                  rawUrl.startsWith('https://') || rawUrl.startsWith('http://gmrc.wudrm.com/')
                    ? rawUrl
                    : `${u}/${item.depot_id}`;
                list.push({
                  depotId: item.depot_id.toString(),
                  manifestId: item.manifest_id.toString(),
                  downloadUrl: safeUrl,
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
   * 从 GitHub ManifestHub3 加速源检索（steamtools-games/ManifestHub3）
   */
  private async fetchFromManifestHub(appId: number, depotIds: string[]): Promise<DepotManifestInfo[]> {
    const results: DepotManifestInfo[] = [];
    const proxyBases = [
      'https://gh-proxy.com/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://ghproxy.net/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://ghproxy.cn/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://ghfast.top/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://raw.githubusercontent.com/steamtools-games/ManifestHub3'
    ];

    // 1. 优先拉取 {appId}.json
    const jsonUrls = proxyBases.map((base) => `${base}/${appId}/${appId}.json`);

    for (const ju of jsonUrls) {
      try {
        const resp = await axios.get(ju, { timeout: 4000 });
        if (resp.data && resp.data.depot && typeof resp.data.depot === 'object') {
          for (const [dId, dInfo] of Object.entries<any>(resp.data.depot)) {
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
          if (results.length > 0) break;
        }
      } catch {}
    }

    // 2. 若 json 失败，兜底尝试拉取 {appId}.lua / {appId}_public.lua
    if (results.length === 0) {
      const luaUrls = proxyBases.flatMap((base) => [
        `${base}/${appId}/${appId}.lua`,
        `${base}/${appId}/${appId}_public.lua`
      ]);
      for (const lu of luaUrls) {
        try {
          const resp = await axios.get(lu, { timeout: 4000 });
          const lua = typeof resp.data === 'string' ? resp.data : '';
          if (lua.includes('setManifestid') || lua.includes('addappid')) {
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
            if (results.length > 0) break;
          }
        } catch {}
      }
    }

    // 3. 异步后台触发沉淀落盘（非阻塞），确保后续下载请求秒级响应
    for (const item of results) {
      this.ensureManifestCached(item.depotId, item.manifestId, appId).catch(() => {});
    }

    return results;
  }

  /**
   * 确保指定清单在服务端本地 manifests/ 目录中就绪
   * 若本地不存在，则从 steamtools-games/ManifestHub3 回源拉取并沉淀落盘（Cache-Through 模式）
   */
  public async ensureManifestCached(depotId: string, manifestId: string, appId?: number): Promise<string | null> {
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

    const proxyBases = [
      'https://gh-proxy.com/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://ghproxy.net/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://ghproxy.cn/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://ghfast.top/https://raw.githubusercontent.com/steamtools-games/ManifestHub3',
      'https://raw.githubusercontent.com/steamtools-games/ManifestHub3'
    ];

    for (const targetApp of candidateAppIds) {
      for (const base of proxyBases) {
        const manifestUrl = `${base}/${targetApp}/${depotId}_${manifestId}.manifest`;
        try {
          const resp = await axios.get(manifestUrl, {
            responseType: 'arraybuffer',
            timeout: 8000
          });
          if (resp.status === 200 && resp.data && resp.data.byteLength > 0) {
            const buf = Buffer.from(resp.data);
            const saved = this.saveManifestFile(depotId, manifestId, buf);
            if (saved) {
              console.log(`[ManifestService] 成功从 ManifestHub3 回源沉淀清单到本地: ${depotId}_${manifestId}.manifest (${buf.byteLength} 字节)`);
              return targetFile;
            }
          }
        } catch {}
      }
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
    // Protobuf
    if ((buf[0] === 0x08 || buf[0] === 0x0a || buf[0] === 0x12) && buf.subarray(0, 32).some((b) => b > 0x7f || b === 0)) {
      return true;
    }
    return false;
  }

  private checkAndReturnManifestFile(filePath: string): string | null {
    if (!fs.existsSync(filePath)) return null;
    try {
      const buf = fs.readFileSync(filePath);
      if (this.isValidManifestBuffer(buf)) {
        return filePath;
      } else {
        console.warn(`[ManifestService] 清理损坏的非清单实体缓存: ${filePath}`);
        fs.unlinkSync(filePath);
        return null;
      }
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
      return true;
    } catch (e) {
      console.error('[ManifestService] 保存清单文件失败:', e);
      return false;
    }
  }

  private manifestCodeCache = new Map<string, { code: string; fetchedAt: number }>();
  private readonly MANIFEST_CODE_TTL_MS = 2 * 60 * 60 * 1000; // 2小时内存缓存

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
    try {
      const resp = await axios.get(`http://gmrc.wudrm.com/manifest/${gid}`, { timeout: 3500, responseType: 'text' });
      if (resp.status === 200 && typeof resp.data === 'string') {
        const text = resp.data.trim();
        if (/^\d+$/.test(text)) {
          this.manifestCodeCache.set(gid, { code: text, fetchedAt: Date.now() });
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
          this.manifestCodeCache.set(gid, { code: text, fetchedAt: Date.now() });
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
          this.manifestCodeCache.set(gid, { code: sCode, fetchedAt: Date.now() });
          return sCode;
        }
      }
    } catch {}

    return null;
  }
}

export const manifestService = new ManifestService();
