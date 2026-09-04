import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { VersionInfo } from '../types/index.js';

export class VersionService {
  private versionFilePath: string;

  constructor() {
    this.versionFilePath = path.join(CONFIG.DATA_DIR, 'version.json');
    this.ensureVersionFile();
  }

  private ensureVersionFile() {
    if (!fs.existsSync(CONFIG.DATA_DIR)) {
      fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(this.versionFilePath)) {
      const defaultVersion: VersionInfo = {
        version: '1.0.0',
        releaseDate: '2026-09-01',
        title: 'SteamMaster 商业版 v1.0.0 正式发布',
        changelog: [
          '🚀 首次发布 Steam 一键入库与多模式联机管理工具',
          '☁️ 全面接入云端数据库，支持 18 万+ 游戏秒搜与 28 万+ DepotKey 匹配',
          '💉 支持 Spacewar 官方大厅联机与 Goldberg 局域网/虚拟专网模式'
        ],
        downloadUrl: 'https://gitee.com/muyan6/steam',
        forceUpdate: false,
        minSupportedVersion: '1.0.0'
      };
      fs.writeFileSync(this.versionFilePath, JSON.stringify(defaultVersion, null, 2), 'utf-8');
    }
  }

  public getLatestVersion(): VersionInfo {
    this.ensureVersionFile();
    try {
      const content = fs.readFileSync(this.versionFilePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return {
        version: '1.0.0',
        releaseDate: '2026-09-01',
        title: 'SteamMaster 商业版',
        changelog: [],
        downloadUrl: '',
        forceUpdate: false,
        minSupportedVersion: '1.0.0'
      };
    }
  }

  /**
   * 简单的语义化版本号比较：v1 > v2 返回 1，v1 < v2 返回 -1，相等返回 0
   */
  private compareVersions(v1: string, v2: string): number {
    const parts1 = v1.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const parts2 = v2.replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < len; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  public checkUpdate(currentVersion: string): {
    hasUpdate: boolean;
    latest: VersionInfo;
    forceUpdate: boolean;
  } {
    const latest = this.getLatestVersion();
    const hasUpdate = this.compareVersions(latest.version, currentVersion) > 0;
    
    // 如果当前版本低于最低支持版本，或者服务端标记了 forceUpdate，则为强制更新
    let force = false;
    if (hasUpdate) {
      if (latest.forceUpdate) {
        force = true;
      } else if (latest.minSupportedVersion && this.compareVersions(latest.minSupportedVersion, currentVersion) > 0) {
        force = true;
      }
    }

    return {
      hasUpdate,
      latest,
      forceUpdate: force
    };
  }

  public updateVersion(info: Partial<VersionInfo>): VersionInfo {
    this.ensureVersionFile();
    const current = this.getLatestVersion();
    const updated: VersionInfo = {
      ...current,
      ...info
    };
    fs.writeFileSync(this.versionFilePath, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  }
}

export const versionService = new VersionService();
