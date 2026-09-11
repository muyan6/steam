import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIG } from '../config/index.js';
import { VersionRelease, PushUpdateRecord } from '../types/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';
import { compareVersions, isRetiredVersion } from '../utils/version.js';

export class VersionService {
  private versionsFilePath: string;
  private legacyVersionFilePath: string;
  private pushLogsFilePath: string;

  constructor() {
    this.versionsFilePath = path.join(CONFIG.DATA_DIR, 'versions.json');
    this.legacyVersionFilePath = path.join(CONFIG.DATA_DIR, 'version.json');
    this.pushLogsFilePath = path.join(CONFIG.DATA_DIR, 'push_logs.json');
    this.ensureVersionFiles();
  }

  private ensureVersionFiles() {
    if (!fs.existsSync(CONFIG.DATA_DIR)) {
      fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
    }

    let initialVersions: VersionRelease[] = [];

    // 如果旧版 version.json 存在但 versions.json 不存在，进行平滑迁移
    if (fs.existsSync(this.legacyVersionFilePath) && !fs.existsSync(this.versionsFilePath)) {
      try {
        const oldContent = fs.readFileSync(this.legacyVersionFilePath, 'utf-8');
        const oldVer = JSON.parse(oldContent);
        if (oldVer && oldVer.version) {
          initialVersions.push({
            version: oldVer.version,
            channel: 'stable',
            releaseDate: oldVer.releaseDate || '2026-09-01',
            title: oldVer.title || `SteamMaster v${oldVer.version}`,
            changelog: Array.isArray(oldVer.changelog) ? oldVer.changelog : [],
            downloadUrl: oldVer.downloadUrl || 'https://gitee.com/muyan6/steam',
            forceUpdate: Boolean(oldVer.forceUpdate),
            minSupportedVersion: oldVer.minSupportedVersion || '1.0.0',
            enabled: true,
            downloadCount: 0,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });
        }
      } catch (e) {
        console.warn('[VersionService] 迁移旧版 version.json 失败:', e);
      }
    }

    if (!fs.existsSync(this.versionsFilePath)) {
      if (initialVersions.length === 0) {
        initialVersions = [
          {
            version: '1.0.0',
            channel: 'stable',
            releaseDate: '2026-09-01',
            title: 'SteamMaster 商业版 v1.0.0 正式发布',
            changelog: [
              '🚀 首次发布 Steam 一键入库与多模式联机管理工具',
              '☁️ 全面接入云端数据库，支持 18 万+ 游戏秒搜与 28 万+ DepotKey 匹配',
              '💉 支持 Spacewar 官方大厅联机与 Goldberg 局域网/虚拟专网模式',
              '🛡️ 内置 OpenSteamTool 64位无感知注入核心'
            ],
            downloadUrl: 'https://gitee.com/muyan6/steam/releases',
            downloadUrlBackup: 'https://github.com/muyan6/steam/releases',
            forceUpdate: false,
            minSupportedVersion: '1.0.0',
            fileSize: '48.5 MB',
            enabled: true,
            downloadCount: 128,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ];
      }
      writeJsonAtomic(this.versionsFilePath, initialVersions);
    }

    this.syncLegacyFile();
  }

  private readAll(): VersionRelease[] {
    try {
      if (fs.existsSync(this.versionsFilePath)) {
        // mtime 缓存：版本文件读多写少，内容未变化时避免每次请求同步读盘
        const stat = fs.statSync(this.versionsFilePath);
        if (this.readCache && this.readCacheMtimeMs === stat.mtimeMs) {
          return this.readCache;
        }
        const content = fs.readFileSync(this.versionsFilePath, 'utf-8');
        const list: VersionRelease[] = JSON.parse(content);
        const result = Array.isArray(list) ? list : [];
        this.readCache = result;
        this.readCacheMtimeMs = stat.mtimeMs;
        return result;
      }
    } catch (e) {
      console.error('[VersionService] 读取版本列表失败:', e);
    }
    return [];
  }

  // 版本文件 mtime 缓存（写路径失效）
  private readCache: VersionRelease[] | null = null;
  private readCacheMtimeMs: number = -1;

  private saveAll(versions: VersionRelease[]) {
    try {
      writeJsonAtomic(this.versionsFilePath, versions);
      // 写入后立即失效缓存，保证同进程读写一致
      this.readCache = null;
      this.readCacheMtimeMs = -1;
      this.syncLegacyFile();
    } catch (e) {
      console.error('[VersionService] 保存版本列表失败:', e);
    }
  }

  private syncLegacyFile() {
    try {
      const latest = this.getLatestVersion() || this.defaultRelease();
      writeJsonAtomic(this.legacyVersionFilePath, latest);
    } catch (e) {
      console.error('[VersionService] 同步 legacyVersionFile 失败:', e);
    }
  }

  public getAllVersions(): VersionRelease[] {
    const list = this.readAll();
    return list.sort((a, b) => compareVersions(b.version, a.version));
  }

  public getVersionByNumber(version: string): VersionRelease | null {
    const clean = version.replace(/^v/i, '');
    const list = this.readAll();
    return list.find((v) => v.version.replace(/^v/i, '') === clean) || null;
  }

  /**
   * 渠道兜底默认对象（无任何可用版本时返回）
   */
  private defaultRelease(): VersionRelease {
    return {
      version: '1.0.0',
      channel: 'stable',
      releaseDate: '2026-09-01',
      title: 'SteamMaster 商业版',
      changelog: [],
      downloadUrl: 'https://gitee.com/muyan6/steam',
      forceUpdate: false,
      minSupportedVersion: '1.0.0',
      enabled: true
    };
  }

  /**
   * 获取指定渠道的最新已上架版本。
   * 安全语义：只在请求渠道自身的已上架版本中取最新，绝不跨渠道回退
   * （stable 请求永远不能拿到 beta/preview 版本）。
   * 请求渠道没有任何已上架版本时返回 null。
   */
  public getLatestVersion(channel: string = 'stable'): VersionRelease | null {
    const list = this.getAllVersions();
    const enabledList = list.filter((v) => v.enabled !== false);

    const matched = enabledList.find((v) => (v.channel || 'stable') === channel);
    if (matched) {
      return matched;
    }

    return null;
  }

  public checkUpdate(currentVersion: string, channel: string = 'stable'): {
    hasUpdate: boolean;
    latest: VersionRelease;
    forceUpdate: boolean;
  } {
    const latest = this.getLatestVersion(channel) || this.defaultRelease();

    // 退役版本（历史误发布的 5.6.0）一律强制更新：客户端已无法通过普通比较收到更新，
    // 必须显式拉回正式序列。详见 utils/version.ts 的 RETIRED_VERSIONS。
    const isRetired = isRetiredVersion(currentVersion);
    const isLower = compareVersions(latest.version, currentVersion) > 0;

    let hasUpdate = false;
    let force = false;

    // 严格语义版本比对：只有当服务端最新版本严格高于客户端当前版本时，才判定存在更新
    // 若客户端版本 >= 服务端版本（例如开发/构建的本地新版本），坚决不提示更新，杜绝倒挂反向弹窗！
    if (isRetired || isLower) {
      hasUpdate = true;
      if (latest.forceUpdate || isRetired) {
        force = true;
      } else if (
        latest.minSupportedVersion &&
        compareVersions(latest.minSupportedVersion, currentVersion) > 0
      ) {
        force = true;
      }
    } else {
      hasUpdate = false;
      force = false;
    }

    return {
      hasUpdate,
      latest,
      forceUpdate: force
    };
  }

  public publishVersion(data: Partial<VersionRelease>): VersionRelease {
    const list = this.readAll();
    const cleanVersion = (data.version || '').replace(/^v/i, '').trim();

    if (!cleanVersion) {
      throw new Error('版本号不能为空，例如 1.0.1');
    }

    const existingIdx = list.findIndex((v) => v.version.replace(/^v/i, '') === cleanVersion);

    const newRelease: VersionRelease = {
      version: cleanVersion,
      channel: data.channel || 'stable',
      releaseDate: data.releaseDate || new Date().toISOString().split('T')[0],
      title: data.title || `SteamMaster v${cleanVersion}`,
      changelog: Array.isArray(data.changelog)
        ? (data.changelog as unknown[])
            .filter((l): l is string => typeof l === 'string')
            .map((l) => l.trim())
            .filter((l) => l.length > 0)
        : [],
      downloadUrl: data.downloadUrl || 'https://gitee.com/muyan6/steam/releases',
      downloadUrlBackup: data.downloadUrlBackup || '',
      forceUpdate: Boolean(data.forceUpdate),
      minSupportedVersion: data.minSupportedVersion || '1.0.0',
      fileSize: data.fileSize || '',
      sha256: data.sha256 || '',
      enabled: data.enabled !== false,
      downloadCount: data.downloadCount || 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      list[existingIdx] = {
        ...list[existingIdx],
        ...newRelease,
        createdAt: list[existingIdx].createdAt || newRelease.createdAt,
        updatedAt: new Date().toISOString()
      };
    } else {
      list.unshift(newRelease);
    }

    this.saveAll(list);
    return newRelease;
  }

  /**
   * 更新指定版本（PUT 语义）：版本不存在时抛错由控制器返回 404，
   * 绝不静默自动创建新版本
   */
  public updateVersion(version: string, data: Partial<VersionRelease>): VersionRelease {
    const list = this.readAll();
    const clean = version.replace(/^v/i, '');
    const idx = list.findIndex((v) => v.version.replace(/^v/i, '') === clean);

    if (idx === -1) {
      throw new Error(`版本不存在: ${version}，请刷新列表后重试`);
    }

    list[idx] = {
      ...list[idx],
      ...data,
      version: data.version ? data.version.replace(/^v/i, '') : list[idx].version,
      updatedAt: new Date().toISOString()
    };

    this.saveAll(list);
    return list[idx];
  }

  public toggleVersion(version: string, enabled?: boolean): VersionRelease | null {
    const list = this.readAll();
    const clean = version.replace(/^v/i, '');
    const idx = list.findIndex((v) => v.version.replace(/^v/i, '') === clean);
    if (idx === -1) return null;

    list[idx].enabled = enabled !== undefined ? enabled : !list[idx].enabled;
    list[idx].updatedAt = new Date().toISOString();
    this.saveAll(list);
    return list[idx];
  }

  public deleteVersion(version: string): boolean {
    const list = this.readAll();
    const clean = version.replace(/^v/i, '');
    const nextList = list.filter((v) => v.version.replace(/^v/i, '') !== clean);
    if (nextList.length === list.length) return false;

    this.saveAll(nextList);
    return true;
  }

  public pushBroadcast(
    version: string,
    customTitle?: string,
    customContent?: string,
    operator: string = 'admin'
  ): PushUpdateRecord {
    // 指定版本号必须真实存在，绝不静默回退为"推送最新版"造成误导性广播
    const targetVer = this.getVersionByNumber(version);
    if (!targetVer) {
      throw new Error(`版本不存在: ${version}，请刷新列表后重试`);
    }
    const record: PushUpdateRecord = {
      id: `push_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
      version: targetVer.version,
      targetChannel: targetVer.channel || 'stable',
      title: customTitle || `🚀 全新版本 v${targetVer.version} 推送`,
      content: customContent || `SteamMaster v${targetVer.version} 现已发布！请及时前往更新下载。`,
      pushedAt: new Date().toISOString(),
      operator
    };

    try {
      let logs: PushUpdateRecord[] = [];
      if (fs.existsSync(this.pushLogsFilePath)) {
        logs = JSON.parse(fs.readFileSync(this.pushLogsFilePath, 'utf-8'));
      }
      logs.unshift(record);
      if (logs.length > 100) logs = logs.slice(0, 100);
      writeJsonAtomic(this.pushLogsFilePath, logs);
    } catch (e) {
      console.error('[VersionService] 保存推送记录失败:', e);
    }

    return record;
  }

  public getPushLogs(limit: number = 30): PushUpdateRecord[] {
    try {
      if (fs.existsSync(this.pushLogsFilePath)) {
        const logs: PushUpdateRecord[] = JSON.parse(fs.readFileSync(this.pushLogsFilePath, 'utf-8'));
        return logs.slice(0, limit);
      }
    } catch (e) {
      console.error('[VersionService] 读取推送记录失败:', e);
    }
    return [];
  }
}

export const versionService = new VersionService();
