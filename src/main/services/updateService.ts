import axios from 'axios';
import { APP_CONFIG } from '../../config/appConfig';

export interface DatabaseStats {
  gamesCount: number;
  keysCount: number;
  lastUpdated: string;
  serverStatus: 'online' | 'offline';
}

export interface AppNotice {
  id: string;
  title: string;
  content: string;
  type: 'popup' | 'banner';
  popupOnce: boolean;
  link?: string;
  enabled: boolean;
}

export interface VersionCheckResult {
  hasUpdate: boolean;
  forceUpdate: boolean;
  latest: {
    version: string;
    releaseDate: string;
    title: string;
    changelog: string[];
    downloadUrl: string;
  };
}

export class UpdateService {
  /**
   * 商业版：检查云端系统公告
   */
  public async checkNotice(): Promise<AppNotice | null> {
    try {
      const url = `${APP_CONFIG.API_BASE_URL}/api/notice/latest`;
      const resp = await axios.get(url, { timeout: APP_CONFIG.REQUEST_TIMEOUT_MS });
      if (resp.data && resp.data.success && resp.data.data) {
        return resp.data.data;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 商业版：检查客户端版本升级与强制更新
   */
  public async checkVersion(currentVersion: string = APP_CONFIG.VERSION): Promise<VersionCheckResult | null> {
    try {
      const url = `${APP_CONFIG.API_BASE_URL}/api/version/check`;
      const resp = await axios.get(url, {
        params: { version: currentVersion },
        timeout: APP_CONFIG.REQUEST_TIMEOUT_MS
      });
      if (resp.data && resp.data.success && resp.data.data) {
        return resp.data.data;
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * 获取数据库及云端连接状态统计
   */
  public async getDatabaseStats(): Promise<DatabaseStats> {
    try {
      const url = `${APP_CONFIG.API_BASE_URL}/api/stats`;
      const resp = await axios.get(url, {
        timeout: 3000
      });

      if (resp.data && resp.data.success && resp.data.data) {
        return {
          gamesCount: resp.data.data.gamesCount || 0,
          keysCount: resp.data.data.depotKeysCount || 0,
          lastUpdated: '已连接云端实时数据库',
          serverStatus: 'online'
        };
      }
    } catch {
      // 备用兜底尝试 admin/stats
      try {
        const adminUrl = `${APP_CONFIG.API_BASE_URL}/api/admin/stats`;
        const resp = await axios.get(adminUrl, {
          headers: { 'x-admin-key': 'steammaster_admin_8888' },
          timeout: 2500
        });
        if (resp.data && resp.data.success && resp.data.data) {
          return {
            gamesCount: resp.data.data.gamesCount || 0,
            keysCount: resp.data.data.depotKeysCount || 0,
            lastUpdated: '已连接云端实时数据库',
            serverStatus: 'online'
          };
        }
      } catch {}
    }

    return {
      gamesCount: 0,
      keysCount: 0,
      lastUpdated: '云端服务离线',
      serverStatus: 'offline'
    };
  }
}

export const updateService = new UpdateService();
