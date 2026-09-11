import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { appSettingsService } from './appSettingsService.js';
import { licenseService } from './licenseService.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';

/**
 * 未激活设备每日免费入库配额（服务端权威版本）。
 *
 * 设计要点：
 * - 以 deviceId（统一 trim + 小写归一化）为维度，每日（服务器本地日期）免费获取
 *   FREE_DAILY_LIMIT 个不同 AppID 的密钥/清单；同一 AppID 当天内重复请求不重复计数。
 * - 无 AppID 的密钥类路由（单 depotKey / 清单文件下载 / OST 中转）按「当日不同
 *   depotId 数」计数（keyIds），防止逐 depot 遍历绕过配额。
 * - 附带同 IP 每日最大独立设备数限制（防单 IP 批量伪造设备刷配额）。
 * - 内存态 + 防抖批量落盘（30 秒），心跳级高频请求不会阻塞事件循环；
 *   落盘数据只保留当日记录，跨天自动清零。
 */

interface DeviceQuota {
  date: string;
  used: number;
  appIds: number[];
  /** 当日已使用配额的不同 depotId 列表（无 AppID 路由的计数维度，最多保留 100 个） */
  keyIds?: string[];
}

// 同 IP 每日最大独立设备数（超过即判定为批量刷量）
const MAX_DEVICES_PER_IP_PER_DAY = 30;
// IP 限流表自身容量上限，超过时清理非当日记录
const MAX_IP_ENTRIES = 5000;

interface IpDailyDevices {
  date: string;
  devices: Set<string>;
}

class FreeQuotaService {
  private filePath = path.join(CONFIG.DATA_DIR, 'free_quota.json');
  private cache: Map<string, DeviceQuota> = new Map();
  private loaded = false;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  // 同 IP 每日独立设备数限制表（纯内存，跨天自动清零）
  private ipDevices: Map<string, IpDailyDevices> = new Map();

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (fs.existsSync(this.filePath)) {
        const data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (data && typeof data === 'object') {
          for (const [k, v] of Object.entries(data as Record<string, any>)) {
            if (
              v &&
              typeof v.date === 'string' &&
              typeof v.used === 'number' &&
              Array.isArray(v.appIds)
            ) {
              this.cache.set(k, {
                date: v.date,
                used: v.used,
                appIds: v.appIds,
                keyIds: Array.isArray(v.keyIds) ? v.keyIds : []
              });
            }
          }
        }
      }
    } catch (e) {
      console.error('[FreeQuota] 配额文件读取失败，按空库处理:', e);
    }
  }

  /**
   * 配额键归一化：trim + 小写。旧数据/请求中同一设备不同大小写
   * 必须落到同一条当日记录，否则可变换大小写绕过配额。
   */
  private normalizeId(deviceId: string): string {
    return String(deviceId || '').trim().toLowerCase();
  }

  private today(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, 30 * 1000);
    // 计时器不阻止进程退出
    (this.flushTimer as any).unref?.();
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    try {
      const today = this.today();
      const obj: Record<string, DeviceQuota> = {};
      for (const [k, v] of this.cache) {
        // 只持久化当日记录，天然实现跨天清零
        if (v.date === today && (v.used > 0 || v.appIds.length > 0 || (v.keyIds && v.keyIds.length > 0))) {
          obj[k] = v;
        }
      }
      writeJsonAtomic(this.filePath, obj);
    } catch (e) {
      this.dirty = true;
      console.error('[FreeQuota] 配额落盘失败:', e);
    }
  }

  private getRecord(deviceId: string): DeviceQuota | null {
    this.load();
    const q = this.cache.get(this.normalizeId(deviceId));
    if (!q || q.date !== this.today()) return null;
    return q;
  }

  // 额度上限走运行时设置（后台可改，立即生效）；app_settings.json 未配置时回落 env/默认值
  private get limit(): number {
    return appSettingsService.getFreeDailyLimit() ?? CONFIG.FREE_DAILY_LIMIT;
  }

  /**
   * 获取（或创建）当日配额记录；创建时顺带清理跨天残留条目，防止内存缓慢膨胀
   */
  private getOrCreateRecord(deviceId: string): DeviceQuota {
    this.load();
    const key = this.normalizeId(deviceId);
    const today = this.today();
    let q = this.cache.get(key);
    if (!q || q.date !== today) {
      q = { date: today, used: 0, appIds: [], keyIds: [] };
      this.cache.set(key, q);
      // 内存清理：删除所有非当日记录
      for (const [k, v] of this.cache) {
        if (v.date !== today) this.cache.delete(k);
      }
    }
    return q;
  }

  /**
   * 查询剩余额度（不扣减）
   */
  public status(deviceId: string): { used: number; limit: number; remaining: number } {
    const q = this.getRecord(deviceId);
    const used = q ? q.used : 0;
    return { used, limit: this.limit, remaining: Math.max(0, this.limit - used) };
  }

  /**
   * 按appId 维度的授权检查与计数：
   * - 该 AppID 当天已获取过：放行且不重复计数
   * - 尚有剩余额度：扣 1 次并放行
   * - 额度耗尽：拒绝并返回明确提示
   */
  public checkAndConsume(
    deviceId: string,
    appId: number
  ): { allowed: boolean; consumed: boolean; remaining: number; message?: string } {
    const q = this.getOrCreateRecord(deviceId);
    if (q.appIds.includes(appId)) {
      return { allowed: true, consumed: false, remaining: Math.max(0, this.limit - q.used) };
    }
    if (q.used >= this.limit) {
      return {
        allowed: false,
        consumed: false,
        remaining: 0,
        message: `今日免费入库额度已用完（每日 ${this.limit} 次），请激活后不限次使用`
      };
    }
    q.used += 1;
    q.appIds.push(appId);
    this.dirty = true;
    this.scheduleFlush();
    return { allowed: true, consumed: true, remaining: Math.max(0, this.limit - q.used) };
  }

  /**
   * 无 AppID 的密钥类路由（单 depotKey / 清单下载 / OST 中转）的配额扣减：
   * 按当日「不同 depotId 数」计数，防止逐 depot 遍历绕过每日配额拿走整库密钥。
   * - 激活设备：直通
   * - 当日已请求过该 depotId：放行不重复计数
   * - 当日不同 depotId 已达 100 个：拒绝
   */
  public consumeKeyAccess(deviceId: string, depotId: string): boolean {
    // 激活设备始终放行（幂等保护，正常由路由层提前拦截）
    if (licenseService.verify(deviceId).isActivated) {
      return true;
    }
    const q = this.getOrCreateRecord(deviceId);
    if (!q.keyIds) q.keyIds = [];
    const normalizedDepot = String(depotId || '').trim();
    if (q.keyIds.includes(normalizedDepot)) {
      return true;
    }
    if (q.keyIds.length >= 100) {
      return false;
    }
    q.keyIds.push(normalizedDepot);
    this.dirty = true;
    this.scheduleFlush();
    return true;
  }

  /**
   * 同 IP 每日独立设备数限制：防止单 IP 批量伪造 deviceId 刷免费配额。
   * 超 30 台/日返回 false；跨天自动清零，IP 表容量超限时清理非当日条目。
   */
  public consumeIpDevice(ip: string, deviceId: string): boolean {
    const normalizedIp = String(ip || '').trim() || 'unknown';
    // 设备标识归一化（trim+小写），避免同一设备变换大小写被算作多台独立设备绕过上限
    const normalizedDevice = this.normalizeId(deviceId);
    const today = this.today();
    let entry = this.ipDevices.get(normalizedIp);
    if (!entry || entry.date !== today) {
      entry = { date: today, devices: new Set() };
      this.ipDevices.set(normalizedIp, entry);
    }
    if (entry.devices.has(normalizedDevice)) {
      return true;
    }
    if (entry.devices.size >= MAX_DEVICES_PER_IP_PER_DAY) {
      return false;
    }
    entry.devices.add(normalizedDevice);
    // IP 表自身防膨胀：超限清理非当日记录
    if (this.ipDevices.size > MAX_IP_ENTRIES) {
      for (const [k, v] of this.ipDevices) {
        if (v.date !== today) this.ipDevices.delete(k);
      }
    }
    return true;
  }
}

export const freeQuotaService = new FreeQuotaService();
