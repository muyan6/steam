import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';

export interface DeviceRecord {
  deviceId: string;
  ip: string;
  firstSeenAt: string;
  lastSeenAt: string;
  clientVersion: string;
  osVersion?: string;
  licenseCode?: string;
  licenseType?: string;
  isActivated?: boolean;
  unlockedCount?: number;
  steamPath?: string;
}

export interface DeviceStats {
  totalDevices: number;
  todayActiveDevices: number;
  weeklyActiveDevices: number;
  activatedDevices: number;
  unactivatedDevices: number;
}

export class DeviceService {
  private devicesMap: Map<string, DeviceRecord> = new Map();
  private filePath: string;

  constructor() {
    this.filePath = path.join(CONFIG.DATA_DIR, 'devices.json');
    this.loadDevices();
  }

  private loadDevices(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const content = fs.readFileSync(this.filePath, 'utf-8');
        const list: DeviceRecord[] = JSON.parse(content);
        if (Array.isArray(list)) {
          for (const d of list) {
            if (d && d.deviceId) {
              this.devicesMap.set(d.deviceId, d);
            }
          }
          console.log(`[DeviceService] 成功载入 ${this.devicesMap.size} 台客户端设备档案！`);
        }
      }
    } catch (e) {
      console.error('[DeviceService] 加载设备数据失败:', e);
    }
  }

  private saveDevices(): void {
    try {
      const list = Array.from(this.devicesMap.values());
      writeJsonAtomic(this.filePath, list);
    } catch (e) {
      console.error('[DeviceService] 保存设备数据失败:', e);
    }
  }

  public recordHeartbeat(payload: {
    deviceId: string;
    ip?: string;
    clientVersion?: string;
    osVersion?: string;
    licenseCode?: string;
    licenseType?: string;
    isActivated?: boolean;
    unlockedCount?: number;
    steamPath?: string;
  }): DeviceRecord {
    const { deviceId } = payload;
    const now = new Date().toISOString();
    const existing = this.devicesMap.get(deviceId);

    const record: DeviceRecord = {
      deviceId,
      ip: payload.ip || existing?.ip || '127.0.0.1',
      firstSeenAt: existing ? existing.firstSeenAt : now,
      lastSeenAt: now,
      clientVersion: payload.clientVersion || existing?.clientVersion || '1.0.0',
      osVersion: payload.osVersion || existing?.osVersion || 'Windows',
      licenseCode: payload.licenseCode !== undefined ? payload.licenseCode : existing?.licenseCode,
      licenseType: payload.licenseType !== undefined ? payload.licenseType : existing?.licenseType,
      isActivated: payload.isActivated !== undefined ? payload.isActivated : existing?.isActivated || false,
      unlockedCount: payload.unlockedCount !== undefined ? payload.unlockedCount : existing?.unlockedCount || 0,
      steamPath: payload.steamPath !== undefined ? payload.steamPath : existing?.steamPath
    };

    this.devicesMap.set(deviceId, record);
    this.saveDevices();
    return record;
  }

  public getDeviceStats(): DeviceStats {
    const now = Date.now();
    const oneDayMs = 24 * 3600 * 1000;
    const sevenDaysMs = 7 * oneDayMs;

    let todayActive = 0;
    let weeklyActive = 0;
    let activated = 0;
    let unactivated = 0;

    for (const d of this.devicesMap.values()) {
      const lastMs = new Date(d.lastSeenAt).getTime();
      if (now - lastMs <= oneDayMs) todayActive++;
      if (now - lastMs <= sevenDaysMs) weeklyActive++;
      if (d.isActivated) activated++;
      else unactivated++;
    }

    return {
      totalDevices: this.devicesMap.size,
      todayActiveDevices: todayActive,
      weeklyActiveDevices: weeklyActive,
      activatedDevices: activated,
      unactivatedDevices: unactivated
    };
  }

  public getDeviceList(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
  }): {
    list: DeviceRecord[];
    total: number;
    page: number;
    limit: number;
    stats: DeviceStats;
  } {
    const page = Math.max(1, params.page || 1);
    const limit = Math.max(1, Math.min(100, params.limit || 20));
    const search = (params.search || '').trim().toLowerCase();
    const status = params.status || 'all';

    let all = Array.from(this.devicesMap.values());

    // 搜索过滤
    if (search) {
      all = all.filter(
        d =>
          d.deviceId.toLowerCase().includes(search) ||
          (d.licenseCode && d.licenseCode.toLowerCase().includes(search)) ||
          (d.ip && d.ip.includes(search)) ||
          (d.clientVersion && d.clientVersion.toLowerCase().includes(search))
      );
    }

    // 状态过滤（兼容旧版 Dashboard 发送的 active/inactive 过滤值）
    const normalizedStatus = status === 'active' ? 'activated' : status === 'inactive' ? 'unactivated' : status;
    if (normalizedStatus === 'activated') {
      all = all.filter(d => d.isActivated);
    } else if (normalizedStatus === 'unactivated') {
      all = all.filter(d => !d.isActivated);
    } else if (normalizedStatus === 'today') {
      const oneDayAgo = Date.now() - 24 * 3600 * 1000;
      all = all.filter(d => new Date(d.lastSeenAt).getTime() >= oneDayAgo);
    }

    // 按最近活跃时间倒序
    all.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());

    const total = all.length;
    const start = (page - 1) * limit;
    const list = all.slice(start, start + limit);

    return {
      list,
      total,
      page,
      limit,
      stats: this.getDeviceStats()
    };
  }
}

export const deviceService = new DeviceService();
