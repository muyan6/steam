import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';

/**
 * 未激活设备每日免费入库配额（服务端权威版本）。
 *
 * 设计要点：
 * - 以 deviceId 为维度，每日（服务器本地日期）免费获取 FREE_DAILY_LIMIT 个
 *   不同 AppID 的密钥/清单；同一 AppID 当天内重复请求不重复计数。
 * - 内存态 + 防抖批量落盘（30 秒），心跳级高频请求不会阻塞事件循环；
 *   落盘数据只保留当日记录，跨天自动清零。
 */

interface DeviceQuota {
  date: string;
  used: number;
  appIds: number[];
}

class FreeQuotaService {
  private filePath = path.join(CONFIG.DATA_DIR, 'free_quota.json');
  private cache: Map<string, DeviceQuota> = new Map();
  private loaded = false;
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

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
              this.cache.set(k, { date: v.date, used: v.used, appIds: v.appIds });
            }
          }
        }
      }
    } catch (e) {
      console.error('[FreeQuota] 配额文件读取失败，按空库处理:', e);
    }
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
        if (v.date === today && (v.used > 0 || v.appIds.length > 0)) {
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
    const q = this.cache.get(deviceId);
    if (!q || q.date !== this.today()) return null;
    return q;
  }

  /**
   * 查询剩余额度（不扣减）
   */
  public status(deviceId: string): { used: number; limit: number; remaining: number } {
    const q = this.getRecord(deviceId);
    const used = q ? q.used : 0;
    return { used, limit: CONFIG.FREE_DAILY_LIMIT, remaining: Math.max(0, CONFIG.FREE_DAILY_LIMIT - used) };
  }

  /**
   * 是否仍有剩余额度（不计数，用于无 appId 的密钥类路由）
   */
  public hasRemaining(deviceId: string): boolean {
    return this.status(deviceId).remaining > 0;
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
    this.load();
    const today = this.today();
    let q = this.cache.get(deviceId);
    if (!q || q.date !== today) {
      q = { date: today, used: 0, appIds: [] };
      this.cache.set(deviceId, q);
    }
    if (q.appIds.includes(appId)) {
      return { allowed: true, consumed: false, remaining: Math.max(0, CONFIG.FREE_DAILY_LIMIT - q.used) };
    }
    if (q.used >= CONFIG.FREE_DAILY_LIMIT) {
      return {
        allowed: false,
        consumed: false,
        remaining: 0,
        message: `今日免费入库额度已用完（每日 ${CONFIG.FREE_DAILY_LIMIT} 次），请激活后不限次使用`
      };
    }
    q.used += 1;
    q.appIds.push(appId);
    this.dirty = true;
    this.scheduleFlush();
    return { allowed: true, consumed: true, remaining: Math.max(0, CONFIG.FREE_DAILY_LIMIT - q.used) };
  }
}

export const freeQuotaService = new FreeQuotaService();
