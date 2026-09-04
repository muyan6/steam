import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { VersionRelease, PushUpdateRecord } from '../types/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';

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
            downloadUrlBackup: 'https://github.com/SteamAutoCracks/ManifestHub',
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
        const content = fs.readFileSync(this.versionsFilePath, 'utf-8');
        const list: VersionRelease[] = JSON.parse(content);
        return Array.isArray(list) ? list : [];
      }
    } catch (e) {
      console.error('[VersionService] 读取版本列表失败:', e);
    }
    return [];
  }

  private saveAll(versions: VersionRelease[]) {
    try {
      writeJsonAtomic(this.versionsFilePath, versions);
      this.syncLegacyFile();
    } catch (e) {
      console.error('[VersionService] 保存版本列表失败:', e);
    }
  }

  private syncLegacyFile() {
    try {
      const latest = this.getLatestVersion();
      writeJsonAtomic(this.legacyVersionFilePath, latest);
    } catch (e) {
      console.error('[VersionService] 同步 legacyVersionFile 失败:', e);
    }
  }

  /**
   * 语义化版本号比较：v1 > v2 返回 1，v1 < v2 返回 -1，相等返回 0
   */
  public compareVersions(v1: string, v2: string): number {
    const parts1 = (v1 || '0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const parts2 = (v2 || '0').replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < len; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  public getAllVersions(): VersionRelease[] {
    const list = this.readAll();
    return list.sort((a, b) => this.compareVersions(b.version, a.version));
  }

  public getVersionByNumber(version: string): VersionRelease | null {
    const clean = version.replace(/^v/i, '');
    const list = this.readAll();
    return list.find((v) => v.version.replace(/^v/i, '') === clean) || null;
  }

  public getLatestVersion(channel: string = 'stable'): VersionRelease {
    const list = this.getAllVersions();
    const enabledList = list.filter((v) => v.enabled !== false);
    
    let matched = enabledList.find((v) => (v.channel || 'stable') === channel);
    if (!matched && enabledList.length > 0) {
      matched = enabledList[0];
    }

    if (matched) {
      return matched;
    }

    // 回退默认对象
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

  public checkUpdate(currentVersion: string, channel: string = 'stable'): {
    hasUpdate: boolean;
    latest: VersionRelease;
    forceUpdate: boolean;
  } {
    const latest = this.getLatestVersion(channel);
    const hasUpdate = this.compareVersions(latest.version, currentVersion) > 0;

    let force = false;
    if (hasUpdate) {
      if (latest.forceUpdate) {
        force = true;
      } else if (
        latest.minSupportedVersion &&
        this.compareVersions(latest.minSupportedVersion, currentVersion) > 0
      ) {
        force = true;
      }
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
        ? data.changelog.filter((l) => Boolean(l.trim()))
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

  public updateVersion(version: string, data: Partial<VersionRelease>): VersionRelease {
    const list = this.readAll();
    const clean = version.replace(/^v/i, '');
    const idx = list.findIndex((v) => v.version.replace(/^v/i, '') === clean);

    if (idx === -1) {
      return this.publishVersion({ ...data, version });
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
    const targetVer = this.getVersionByNumber(version) || this.getLatestVersion();
    const record: PushUpdateRecord = {
      id: `push_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
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
