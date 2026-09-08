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
  private degraded: boolean = false;

  constructor() {
    this.filePath = path.join(CONFIG.DATA_DIR, 'devices.json');
    this.loadDevices();
    this.startDailyCleanup();
  }

  /**
   * 每日自动清理：删除 30 天以上未活跃、且未绑定任何卡密授权（无 licenseCode
   * 且未激活）的设备档案。绑定了卡密的设备档案永不自动删除，交由管理员手动处理。
   */
  private startDailyCleanup(): void {
    const run = () => {
      try {
        const removed = this.cleanupInactiveUnlicensed(30);
        if (removed > 0) {
          console.log(`[DeviceService] 每日自动清理完成：移除 ${removed} 台 30 天未活跃且未绑定卡密的设备档案`);
        }
      } catch (e) {
        console.error('[DeviceService] 每日自动清理失败:', e);
      }
    };
    // 启动 1 分钟后先跑一次，之后每 24 小时一次；计时器不阻止进程退出
    const initial = setTimeout(run, 60 * 1000);
    (initial as any).unref?.();
    const timer = setInterval(run, 24 * 3600 * 1000);
    (timer as any).unref?.();
  }

  /**
   * 清理超过 inactiveDays 天未活跃、且没有任何卡密绑定痕迹的设备档案
   */
  private cleanupInactiveUnlicensed(inactiveDays: number): number {
    const cutoff = Date.now() - Math.max(1, inactiveDays) * 24 * 3600 * 1000;
    let removed = 0;
    for (const [id, d] of this.devicesMap) {
      if (
        new Date(d.lastSeenAt).getTime() < cutoff &&
        !d.licenseCode &&
        !d.isActivated
      ) {
        this.devicesMap.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      this.devicesDirty = true;
      this.flushDevices();
    }
    return removed;
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
      // fail-closed：损坏文件备份为 .corrupt 并拒绝写回，防止空档案覆写全量设备数据
      try { if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, this.filePath + '.corrupt'); } catch {}
      this.degraded = true;
      console.error('[DeviceService] 设备数据文件损坏！已备份到 .corrupt，写入功能已禁用，请修复文件后重启服务:', e);
    }
  }

  // 心跳级高频写入防抖：内存态即时更新供查询，落盘合并为 10 秒批量，
  // 设备档案为统计数据，丢失最后几秒可接受
  private devicesDirty = false;
  private devicesFlushTimer: ReturnType<typeof setTimeout> | null = null;

  private saveDevices(): void {
    this.devicesDirty = true;
    if (this.devicesFlushTimer) return;
    this.devicesFlushTimer = setTimeout(() => {
      this.devicesFlushTimer = null;
      this.flushDevices();
    }, 10 * 1000);
    // 计时器不阻止进程退出
    (this.devicesFlushTimer as any).unref?.();
  }

  private flushDevices(): void {
    if (!this.devicesDirty) return;
    this.devicesDirty = false;
    if (this.degraded) {
      console.error('[DeviceService] 数据文件已损坏（.corrupt），拒绝写入以保护数据。');
      return;
    }
    try {
      const list = Array.from(this.devicesMap.values());
      writeJsonAtomic(this.filePath, list);
    } catch (e) {
      this.devicesDirty = true;
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

  /**
   * 删除单条设备档案（仅移除监控记录，不影响卡密库中的授权绑定；
   * 设备再次上线心跳会自动重建档案）。
   */
  public deleteDevice(deviceId: string): boolean {
    if (!this.devicesMap.has(deviceId)) return false;
    this.devicesMap.delete(deviceId);
    // 立即落盘，避免 10 秒防抖窗口内进程退出导致"删了又回来"
    this.devicesDirty = true;
    this.flushDevices();
    return true;
  }

  /**
   * 批量清理超过 inactiveDays 天未活跃的设备档案，返回清理数量。
   */
  public deleteInactiveDevices(inactiveDays: number): number {
    const cutoff = Date.now() - Math.max(1, inactiveDays) * 24 * 3600 * 1000;
    let removed = 0;
    for (const [id, d] of this.devicesMap) {
      if (new Date(d.lastSeenAt).getTime() < cutoff) {
        this.devicesMap.delete(id);
        removed++;
      }
    }
    if (removed > 0) {
      this.devicesDirty = true;
      this.flushDevices();
    }
    return removed;
  }

  private licenseVerifier: ((deviceId: string) => { isActivated: boolean; code?: string; type?: string }) | null = null;

  public setLicenseVerifier(verifier: (deviceId: string) => { isActivated: boolean; code?: string; type?: string }): void {
    this.licenseVerifier = verifier;
  }

  /**
   * 权威核验并同步指定设备记录的激活态与卡密信息
   */
  public syncActivationWithVerifier(d: DeviceRecord): void {
    if (!this.licenseVerifier) return;
    try {
      const verified = this.licenseVerifier(d.deviceId);
      if (verified) {
        let changed = false;
        if (d.isActivated !== verified.isActivated) {
          d.isActivated = verified.isActivated;
          changed = true;
        }
        if (verified.code && d.licenseCode !== verified.code) {
          d.licenseCode = verified.code;
          changed = true;
        }
        if (verified.type && d.licenseType !== verified.type) {
          d.licenseType = verified.type;
          changed = true;
        }
        if (changed) {
          this.devicesDirty = true;
        }
      }
    } catch {}
  }

  /**
   * 客户端核销激活、换机迁移或管理员解绑时，主动即时同步设备档案
   */
  public updateDeviceActivation(
    deviceId: string,
    isActivated: boolean,
    licenseCode?: string,
    licenseType?: string
  ): void {
    const existing = this.devicesMap.get(deviceId);
    if (existing) {
      existing.isActivated = isActivated;
      if (licenseCode !== undefined) existing.licenseCode = licenseCode;
      if (licenseType !== undefined) existing.licenseType = licenseType;
      existing.lastSeenAt = new Date().toISOString();
      this.devicesDirty = true;
      this.flushDevices();
    } else {
      this.recordHeartbeat({
        deviceId,
        isActivated,
        licenseCode,
        licenseType
      });
    }
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
      this.syncActivationWithVerifier(d);
      const lastMs = new Date(d.lastSeenAt).getTime();
      if (now - lastMs <= oneDayMs) todayActive++;
      if (now - lastMs <= sevenDaysMs) weeklyActive++;
      if (d.isActivated) activated++;
      else unactivated++;
    }

    if (this.devicesDirty) {
      this.saveDevices();
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
    for (const d of all) {
      this.syncActivationWithVerifier(d);
    }
    if (this.devicesDirty) {
      this.saveDevices();
    }

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
