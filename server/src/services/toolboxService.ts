import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { ManifestServerNode, ToolboxRepairLog, ToolboxStatsResponse } from '../types/index.js';

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
        fs.writeFileSync(this.logFilePath, JSON.stringify([], null, 2), 'utf-8');
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
   * 获取 OpenSteamTool 所需的 SHA256 校验包元数据
   */
  public getSha256PackageInfo(): {
    version: string;
    totalHashes: number;
    fileSize: string;
    updatedAt: string;
    recommendedDir: string;
    hashes: Record<string, string>;
  } {
    return {
      version: '2026.09.04',
      totalHashes: 18650,
      fileSize: '4.8 MB',
      updatedAt: '2026-09-04T12:00:00Z',
      recommendedDir: 'opensteamtool',
      hashes: {
        'OpenSteamTool.dll': '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b',
        'dwmapi.dll': 'a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e',
        'xinput1_4.dll': 'f0e1d2c3b4a5968778695a4b3c2d1e0f12345678'
      }
    };
  }

  /**
   * 记录客户端修复诊断与执行日志
   */
  public recordRepairLog(log: Omit<ToolboxRepairLog, 'id' | 'timestamp'> & { ip?: string }): ToolboxRepairLog {
    const newRecord: ToolboxRepairLog = {
      id: `repair_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      actionType: log.actionType,
      success: log.success,
      deviceId: log.deviceId,
      ip: log.ip,
      details: log.details,
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
      fs.writeFileSync(this.logFilePath, JSON.stringify(logs, null, 2), 'utf-8');
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
}

export const toolboxService = new ToolboxService();
