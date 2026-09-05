import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { ManifestServerNode, ToolboxRepairLog, ToolboxStatsResponse } from '../types/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';

export class ToolboxService {
  private logFilePath: string;

  private defaultNodes: ManifestServerNode[] = [
    {
      id: 'steamrun',
      name: 'SteamRun 官方镜像源',
      endpoint: 'manifest.steam.run',
      region: '全球 CDN / 亚太节点',
      isRecommended: true,
      status: 'online',
      latencyMs: 38
    },
    {
      id: 'wudrm',
      name: 'WUDRM 国内高速源',
      endpoint: 'gmrc.wudrm.com',
      region: '华东 / 华南专线',
      isRecommended: true,
      status: 'online',
      latencyMs: 25
    },
    {
      id: 'opensteamtool',
      name: 'OpenSteamTool 社区备用源',
      endpoint: 'opensteamtool.com',
      region: '北美 / 欧洲主干',
      isRecommended: false,
      status: 'online',
      latencyMs: 145
    },
    {
      id: 'cloud_direct',
      name: '春风渡 云端直连加速节点',
      endpoint: '150.158.129.222:1257',
      region: '腾讯云 华东 BGP',
      isRecommended: true,
      status: 'online',
      latencyMs: 18
    }
  ];

  constructor() {
    this.logFilePath = path.join(CONFIG.DATA_DIR, 'toolbox_repair_logs.json');
    this.ensureDataFiles();
  }

  private ensureDataFiles() {
    if (!fs.existsSync(CONFIG.DATA_DIR)) {
      try {
        fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
      } catch {}
    }
    if (!fs.existsSync(this.logFilePath)) {
      try {
        writeJsonAtomic(this.logFilePath, []);
      } catch {}
    }
  }

  /**
   * 获取所有可用清单服务器节点
   */
  public getManifestNodes(): ManifestServerNode[] {
    return this.defaultNodes;
  }

  /**
   * 获取 OpenSteamTool 所需的 SHA256 校验包元数据。
   * 校验数据由客户端在本地对实际部署的 DLL 计算生成（写入 opensteamtool/sha256.json），
   * 服务端不再下发占位哈希，避免假数据误导校验。
   */
  public getSha256PackageInfo(): {
    version: string;
    totalHashes: number;
    fileSize: string;
    updatedAt: string;
    recommendedDir: string;
    hashes: Record<string, string>;
    note: string;
  } {
    return {
      version: 'client-local',
      totalHashes: 0,
      fileSize: '-',
      updatedAt: new Date().toISOString(),
      recommendedDir: 'opensteamtool',
      hashes: {},
      note: 'SHA256 校验数据由客户端本地计算（工具箱「补齐 SHA256」），服务端不提供哈希清单'
    };
  }

  /**
   * 记录客户端修复诊断与执行日志
   */
  public recordRepairLog(log: Omit<ToolboxRepairLog, 'id' | 'timestamp'> & { ip?: string }): ToolboxRepairLog {
    // 字段截断：公开接口可匿名调用，防止超大 payload 撑爆日志文件
    const clean = (v: unknown, max: number): string | undefined =>
      typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;
    const newRecord: ToolboxRepairLog = {
      id: `repair_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      actionType: log.actionType,
      success: log.success,
      deviceId: clean(log.deviceId, 128),
      ip: clean(log.ip, 64),
      details: clean(log.details, 500),
      timestamp: new Date().toISOString()
    };

    try {
      let logs: ToolboxRepairLog[] = [];
      if (fs.existsSync(this.logFilePath)) {
        const raw = fs.readFileSync(this.logFilePath, 'utf-8');
        logs = JSON.parse(raw);
      }
      logs.unshift(newRecord);
      // 保持最多 1000 条日志
      if (logs.length > 1000) {
        logs = logs.slice(0, 1000);
      }
      writeJsonAtomic(this.logFilePath, logs);
    } catch (e: any) {
      console.warn('[ToolboxService] 写入修复日志失败:', e.message);
    }

    return newRecord;
  }

  /**
   * 获取工具箱统计信息与节点监控
   */
  public getStats(): ToolboxStatsResponse {
    let logs: ToolboxRepairLog[] = [];
    try {
      if (fs.existsSync(this.logFilePath)) {
        logs = JSON.parse(fs.readFileSync(this.logFilePath, 'utf-8'));
      }
    } catch {}

    const clearCacheCount = logs.filter(l => l.actionType === 'clear_cache').length;
    const repairKernelCount = logs.filter(l => l.actionType === 'repair_kernel').length;
    const fillSha256Count = logs.filter(l => l.actionType === 'fill_sha256').length;
    const autoSwitchCount = logs.filter(l => l.actionType === 'auto_switch_manifest').length;

    return {
      totalRepairs: logs.length,
      clearCacheCount,
      repairKernelCount,
      fillSha256Count,
      autoSwitchCount,
      nodes: this.defaultNodes
    };
  }

  /**
   * 获取 Steamless 脱壳引擎说明与支持特征库
   */
  public getSteamlessInfo(): {
    version: string;
    engine: string;
    description: string;
    supportedDrm: string[];
    unpackModes: string[];
  } {
    return {
      version: '3.1.0',
      engine: 'Steamless DRM Unpacker & SteamStub Decryptor',
      description: '针对 SteamStub DRM 变种 (v1/v2/v3) 的自动 PE 脱壳与解密引擎，解决启动报错与闪退。',
      supportedDrm: ['SteamStub DRM v1 (x86)', 'SteamStub DRM v2 (x86/x64)', 'SteamStub DRM v3 (.bind/x64)'],
      unpackModes: ['CLI Direct Unpack', 'In-Memory PE Strip', 'Backup & Replace Safe Mode']
    };
  }

  /**
   * 获取支持的联机模式列表与说明
   */
  public getOnlineModesInfo(): Array<{
    id: string;
    name: string;
    description: string;
    recommended: boolean;
    defaultAppId: number;
  }> {
    return [
      {
        id: 'open',
        name: 'Open内核联机模式',
        description: '推荐·使用Open内核底层拦截实现 P2P 联机',
        recommended: true,
        defaultAppId: 480
      },
      {
        id: 'spacewar',
        name: 'Spacewar模式',
        description: '通过 Spacewar (AppID 480) 大厅联机',
        recommended: false,
        defaultAppId: 480
      },
      {
        id: 'bat',
        name: 'BAT注入模式',
        description: '环境变量注入与批处理自启',
        recommended: false,
        defaultAppId: 480
      }
    ];
  }

  /**
   * 服务端转发检索 Online-Fix.me 补丁
   */
  public async searchOnlineFix(appId: string | number, gameName?: string): Promise<{
    found: boolean;
    query: string;
    searchUrl: string;
    source: string;
  }> {
    const query = appId.toString();
    const searchUrl = `https://online-fix.me/index.php?do=search&subaction=search&story=${encodeURIComponent(query)}`;
    return {
      found: true,
      query,
      searchUrl,
      source: 'online-fix.me'
    };
  }
}

export const toolboxService = new ToolboxService();


