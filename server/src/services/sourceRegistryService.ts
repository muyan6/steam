import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';

export interface DataSourceInfo {
  id: string;
  name: string;
  author: string;
  category: 'depot_keys' | 'tokens' | 'games' | 'manifests' | 'core_hook';
  sourceUrl: string;
  endpointUrl?: string;
  syncFrequency: string;
  status: 'active' | 'syncing' | 'error' | 'ready';
  lastSyncTime: string;
  totalRecordsCount: number;
  description: string;
  licenseOrNote: string;
  /** 最近一次同步失败的错误信息（同步成功后清除） */
  lastError?: string;
}

export class SourceRegistryService {
  private sources: Record<string, DataSourceInfo> = {
    sudama_keys: {
      id: 'sudama_keys',
      name: 'Steam清单云 @苏大猫 (DepotKey 实时解密密钥库)',
      author: '苏大猫 (QQ: 993499094 / 开源社区)',
      category: 'depot_keys',
      sourceUrl: 'https://api.993499094.xyz/',
      endpointUrl: 'https://api.993499094.xyz/depotkeys.json',
      syncFrequency: '每日自动定时轮询同步 (24h)',
      status: 'active',
      lastSyncTime: '未同步',
      totalRecordsCount: 221346,
      description: '国内最活跃的 Steam DepotKey 实时社区分发源，汇聚最新发售游戏的 64 位 AES-256 分包解密密钥。',
      licenseOrNote: '感谢 @苏大猫 993499094 及全体开源贡献者为 Steam 解锁生态提供的高速开放接口。'
    },
    sudama_tokens: {
      id: 'sudama_tokens',
      name: 'Steam清单云 @苏大猫 (PICS AccessToken 访问令牌库)',
      author: '苏大猫 (QQ: 993499094 / 开源社区)',
      category: 'tokens',
      sourceUrl: 'https://api.993499094.xyz/',
      endpointUrl: 'https://api.993499094.xyz/appaccesstokens.json',
      syncFrequency: '每日自动定时轮询同步 (24h)',
      status: 'active',
      lastSyncTime: '未同步',
      totalRecordsCount: 8367,
      description: '汇聚 Steam 重点保护与新发售游戏的 PICS 访问令牌，绕过 Valve 官方 Package 访问限制，确保能够正常下发 Manifest。',
      licenseOrNote: '感谢 @苏大猫 提供的实时 Token 镜像支持。'
    },
    manifesthub_keys: {
      id: 'manifesthub_keys',
      name: 'SteamAutoCracks / ManifestHub 历史全量密钥字典',
      author: 'SteamAutoCracks / SteamRE / CS.RIN.RU',
      category: 'depot_keys',
      sourceUrl: 'https://github.com/SteamAutoCracks/ManifestHub',
      endpointUrl: 'https://raw.githubusercontent.com/SteamAutoCracks/ManifestHub/main/depotkeys.json',
      syncFrequency: '每日自动定时镜像同步 (24h)',
      status: 'active',
      lastSyncTime: '未同步',
      totalRecordsCount: 288381,
      description: '全球开源社区沉淀的经典历史 DepotKey 全量字典，涵盖数十万款历史经典商业单机、3A 大作与冷门 DLC 密钥。',
      licenseOrNote: '遵循开源社区共享准则，数据持久化于后端 server/data/ 目录。'
    },
    steamtools_gamelist: {
      id: 'steamtools_gamelist',
      name: 'SteamTools-Team 全量应用基础数据库',
      author: 'SteamTools-Team',
      category: 'games',
      sourceUrl: 'https://github.com/SteamTools-Team/GameList',
      endpointUrl: 'https://raw.githubusercontent.com/SteamTools-Team/GameList/main/games.json',
      syncFrequency: '每日自动定时镜像同步 (24h)',
      status: 'active',
      lastSyncTime: '未同步',
      totalRecordsCount: 183751,
      description: '全量 18.3万+ Steam 官方发售游戏 AppID 与全称基础字典，支撑后端毫秒级中文拼音检索与别名命中。',
      licenseOrNote: '基于开源 GameList 维护，支持镜像网络加速分发。'
    },
    valve_steampipe: {
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
      licenseOrNote: '官方正版 CDN 分发协议直连。'
    },
    steamcmd_api: {
      id: 'steamcmd_api',
      name: 'SteamCMD Public Web API',
      author: 'SteamCMD Community',
      category: 'manifests',
      sourceUrl: 'https://api.steamcmd.net/',
      endpointUrl: 'https://api.steamcmd.net/v1/info',
      syncFrequency: '按需实时动态解析',
      status: 'ready',
      lastSyncTime: '实时在线',
      totalRecordsCount: 0,
      description: '提供精准的 Depots 架构树与最新 Manifest GID（清单版本号）实时校验。',
      licenseOrNote: '公共只读 API。'
    },
    remlua_cdn: {
      id: 'remlua_cdn',
      name: 'Remlua AWS CloudFront 全球 CDN 清单库',
      author: 'Remlua / OpenSteam Community',
      category: 'manifests',
      sourceUrl: 'https://d2xt384j51hxca.cloudfront.net/',
      endpointUrl: 'https://d2xt384j51hxca.cloudfront.net/manifests/{depotId}_{gid}.manifest',
      syncFrequency: '并发按需毫秒级竞速拉取',
      status: 'ready',
      lastSyncTime: '实时加速',
      totalRecordsCount: 45000,
      description: 'AWS 边缘高速全球分发网络，覆盖最新 3A 大作与主流热门游戏二进制清单实体。',
      licenseOrNote: '全球 CDN 静态直连。'
    },
    steamml_r2: {
      id: 'steamml_r2',
      name: 'SteamML Cloudflare R2 实体清单存储桶',
      author: 'SteamML 团队 / 社区贡献者',
      category: 'manifests',
      sourceUrl: 'https://pub-5b6d3b7c03fd4ac1afb5bd3017850e20.r2.dev/',
      endpointUrl: 'https://pub-5b6d3b7c03fd4ac1afb5bd3017850e20.r2.dev/{appId}.zip',
      syncFrequency: '并发按需并行提取',
      status: 'ready',
      lastSyncTime: '实时在线',
      totalRecordsCount: 82000,
      description: 'Cloudflare 全球 R2 零出口费用对象存储桶，打包提供全量分包的二进制清单文件与 DLC 架构。',
      licenseOrNote: '社区开源 R2 镜像分发。'
    },
    opensteam_hook: {
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
      description: '通过 Windows DLL 侧载机制挂钩 steamclient64.dll，在内存中动态执行 config/lua/<appid>.lua 规则，实现免重启秒级点亮入库。',
      licenseOrNote: '开源 DLL 注入核心模块。'
    }
  };

  private registryFilePath: string;

  constructor() {
    this.registryFilePath = path.join(CONFIG.DATA_DIR, 'source_registry.json');
    this.loadRegistry();
  }

  private loadRegistry(): void {
    try {
      if (fs.existsSync(this.registryFilePath)) {
        const raw = JSON.parse(fs.readFileSync(this.registryFilePath, 'utf-8'));
        if (raw && typeof raw === 'object') {
          for (const [k, v] of Object.entries(raw)) {
            if (this.sources[k]) {
              this.sources[k] = { ...this.sources[k], ...(v as any) };
            }
          }
        }
      }
    } catch {}
  }

  private saveRegistry(): void {
    try {
      writeJsonAtomic(this.registryFilePath, this.sources);
    } catch {}
  }

  public getAllSources(): DataSourceInfo[] {
    return Object.values(this.sources);
  }

  public updateSourceStatus(
    id: string,
    update: Partial<DataSourceInfo>
  ): void {
    if (this.sources[id]) {
      this.sources[id] = { ...this.sources[id], ...update };
      this.saveRegistry();
    }
  }

  public recordSyncSuccess(id: string, count: number): void {
    if (this.sources[id]) {
      const nowStr = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
      this.sources[id].lastSyncTime = nowStr;
      this.sources[id].status = 'active';
      this.sources[id].totalRecordsCount = count;
      // 同步成功后清除上次的错误记录，且绝不覆盖 upstream 引用说明字段
      if (this.sources[id].lastError) {
        this.sources[id].lastError = undefined;
      }
      this.saveRegistry();
    }
  }

  public recordSyncError(id: string, errorMessage: string): void {
    if (this.sources[id]) {
      this.sources[id].status = 'error';
      // 错误信息写入独立的 lastError 字段（截断防超大），不再覆盖 licenseOrNote
      this.sources[id].lastError = `最后一次同步报错: ${String(errorMessage || '').slice(0, 500)}`;
      this.saveRegistry();
    }
  }
}

export const sourceRegistryService = new SourceRegistryService();
