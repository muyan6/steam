import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';

export interface AppSettings {
  /** 未激活设备每日免费入库次数（运行时可在管理后台调整，立即生效） */
  freeDailyLimit: number;
  updatedAt: string;
}

const MIN_LIMIT = 0;
const MAX_LIMIT = 999;

/**
 * 全局应用设置（服务端持久化 KV，data/app_settings.json）。
 * 与环境变量 CONFIG.FREE_DAILY_LIMIT 的关系：
 * - 未写过设置文件时使用 env/默认值；
 * - 后台保存后以文件值为准（立即生效，无需重启）。
 */
export class AppSettingsService {
  private filePath: string;
  private cache: AppSettings | null = null;

  constructor() {
    this.filePath = path.join(CONFIG.DATA_DIR, 'app_settings.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        this.cache = {
          freeDailyLimit: this.clampLimit(raw.freeDailyLimit, CONFIG.FREE_DAILY_LIMIT),
          updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString()
        };
      }
    } catch (e) {
      console.warn('[AppSettings] 读取设置文件失败，使用默认值:', (e as Error).message);
      this.cache = null;
    }
  }

  private clampLimit(v: unknown, fallback: number): number {
    const n = typeof v === 'number' ? Math.floor(v) : parseInt(String(v), 10);
    if (isNaN(n)) return fallback;
    return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, n));
  }

  public getSettings(): AppSettings {
    return (
      this.cache || {
        freeDailyLimit: CONFIG.FREE_DAILY_LIMIT,
        updatedAt: new Date().toISOString()
      }
    );
  }

  public getFreeDailyLimit(): number {
    return this.getSettings().freeDailyLimit;
  }

  public setFreeDailyLimit(limit: number): AppSettings {
    const next: AppSettings = {
      ...this.getSettings(),
      freeDailyLimit: this.clampLimit(limit, CONFIG.FREE_DAILY_LIMIT),
      updatedAt: new Date().toISOString()
    };
    writeJsonAtomic(this.filePath, next);
    this.cache = next;
    console.log(`[AppSettings] 未激活每日免费额度已更新为 ${next.freeDailyLimit} 次/日`);
    return next;
  }
}

export const appSettingsService = new AppSettingsService();
