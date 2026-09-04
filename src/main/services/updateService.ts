import axios from 'axios';
import { APP_CONFIG } from '../../config/appConfig';
import { DataSourceInfo } from '../../types';

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
   * 获取数据源与上游引用清单
   */
  public async getSourcesList(): Promise<DataSourceInfo[]> {
    try {
      const url = `${APP_CONFIG.API_BASE_URL}/api/sources`;
      const resp = await axios.get(url, { timeout: 4000 });
      if (resp.data && resp.data.success && resp.data.data?.sources) {
        return resp.data.data.sources;
      }
    } catch {}

    // 默认内置上游引用回退列表
    return [
      {
        id: 'sudama_keys',
        name: 'Steam清单云 @苏大猫 (DepotKey 实时解密密钥库)',
        author: '苏大猫 (QQ: 993499094 / 开源社区)',
        category: 'depot_keys',
        sourceUrl: 'https://api.993499094.xyz/',
        endpointUrl: 'https://api.993499094.xyz/depotkeys.json',
        syncFrequency: '每日自动定时轮询同步 (24h)',
        status: 'active',
        lastSyncTime: '云端同步中',
        totalRecordsCount: 221346,
        description: '国内最活跃的 Steam DepotKey 实时社区分发源，汇聚最新发售游戏的 64 位 AES-256 分包解密密钥。',
        licenseOrNote: '感谢 @苏大猫 993499094 及全体开源贡献者。'
      },
      {
        id: 'sudama_tokens',
        name: 'Steam清单云 @苏大猫 (PICS AccessToken 访问令牌库)',
        author: '苏大猫 (QQ: 993499094 / 开源社区)',
        category: 'tokens',
        sourceUrl: 'https://api.993499094.xyz/',
        endpointUrl: 'https://api.993499094.xyz/appaccesstokens.json',
        syncFrequency: '每日自动定时轮询同步 (24h)',
        status: 'active',
        lastSyncTime: '云端同步中',
        totalRecordsCount: 8367,
        description: '汇聚 Steam 重点保护与新发售游戏的 PICS 访问令牌，绕过 Valve 官方 Package 访问限制。',
        licenseOrNote: '感谢 @苏大猫 提供的实时 Token 镜像支持。'
      },
      {
        id: 'manifesthub_keys',
        name: 'SteamAutoCracks / ManifestHub 历史全量密钥字典',
        author: 'SteamAutoCracks / SteamRE / CS.RIN.RU',
        category: 'depot_keys',
        sourceUrl: 'https://github.com/SteamAutoCracks/ManifestHub',
        endpointUrl: 'https://raw.githubusercontent.com/SteamAutoCracks/ManifestHub/main/depotkeys.json',
        syncFrequency: '每日自动定时镜像同步 (24h)',
        status: 'active',
        lastSyncTime: '已持久化',
        totalRecordsCount: 288381,
        description: '全球开源社区沉淀的经典历史 DepotKey 全量字典，涵盖数十万款历史经典商业单机与 3A 大作。',
        licenseOrNote: '遵循开源共享准则。'
      },
      {
        id: 'steamtools_gamelist',
        name: 'SteamTools-Team 全量应用基础数据库',
        author: 'SteamTools-Team',
        category: 'games',
        sourceUrl: 'https://github.com/SteamTools-Team/GameList',
        endpointUrl: 'https://raw.githubusercontent.com/SteamTools-Team/GameList/main/games.json',
        syncFrequency: '每日自动定时镜像同步 (24h)',
        status: 'active',
        lastSyncTime: '已持久化',
        totalRecordsCount: 183751,
        description: '全量 18.3万+ Steam 官方发售游戏 AppID 与全称基础字典，支撑后端毫秒级中文拼音检索。',
        licenseOrNote: '基于开源 GameList 维护。'
      },
      {
        id: 'valve_steampipe',
        name: 'Valve 官方 SteamPipe CDN & Store API',
        author: 'Valve Corporation (Steam 官方)',
        category: 'manifests',
        sourceUrl: 'https://store.steampowered.com/',
        endpointUrl: 'https://store.steampowered.com/api/appdetails + cache*-steamcontent.com',
        syncFrequency: '按需实时动态下发',
        status: 'ready',
        lastSyncTime: '实时在线',
        totalRecordsCount: 0,
        description: 'Valve 原生游戏分包结构索引、实时 DLC 架构及 SteamPipe 官方加密 Chunks 分块下载节点。',
        licenseOrNote: '官方正版协议直连。'
      },
      {
        id: 'opensteam_hook',
        name: 'OpenSteamTool 64位注入 Hook 核心组件',
        author: 'OpenSteamTool Core Developers',
        category: 'core_hook',
        sourceUrl: 'https://github.com/OpenSteamTool',
        endpointUrl: '内置核心 OpenSteamTool.dll / dwmapi.dll / xinput1_4.dll',
        syncFrequency: '内置核心静态托管',
        status: 'ready',
        lastSyncTime: '已就绪',
        totalRecordsCount: 3,
        description: '通过 Windows DLL 侧载挂钩 steamclient64.dll，在内存中动态执行 config/lua/<appid>.lua 规则。',
        licenseOrNote: '开源 DLL 注入核心模块。'
      }
    ];
  }

  /**
   * 手动触发后端全量数据源同步
   */
  public async triggerSyncSources(): Promise<{ success: boolean; message: string; results?: any }> {
    try {
      const url = `${APP_CONFIG.API_BASE_URL}/api/sources/sync`;
      const resp = await axios.post(url, {}, { timeout: 35000 });
      if (resp.data) {
        return resp.data;
      }
      return { success: false, message: '同步响应超时' };
    } catch (e: any) {
      return { success: false, message: `触发同步失败: ${e.message}` };
    }
  }

  /**
   * 获取数据库及云端连接状态统计
   */
  public async getDatabaseStats(): Promise<DatabaseStats> {
    try {
      const url = `${APP_CONFIG.API_BASE_URL}/api/admin/stats`;
      const resp = await axios.get(url, {
        headers: { 'x-admin-key': 'steammaster_admin_8888' },
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
      // ignore
    }

    return {
      gamesCount: 183751,
      keysCount: 304624,
      lastUpdated: '本地持久化模式',
      serverStatus: 'offline'
    };
  }
}

export const updateService = new UpdateService();
