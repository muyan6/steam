import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { CONFIG } from '../config/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';

let baseDir = process.cwd();
try {
  if (typeof __dirname !== 'undefined') {
    baseDir = __dirname;
  } else if (import.meta && import.meta.url) {
    baseDir = path.dirname(fileURLToPath(import.meta.url));
  }
} catch {
  baseDir = process.cwd();
}

export type LicenseType = 'monthly' | 'quarterly' | 'yearly' | 'lifetime';
export type LicenseStatus = 'unused' | 'active' | 'expired' | 'disabled';

export interface LicenseKey {
  id: string;
  code: string;
  type: LicenseType;
  durationDays: number;
  status: LicenseStatus;
  createdAt: string;
  deviceId?: string;
  boundAt?: string;
  expiresAt?: string | null;
  remark?: string;
  createdBy?: string;
}

export interface ClientLicenseInfo {
  isActivated: boolean;
  status: 'unactivated' | 'active' | 'expired' | 'disabled' | 'error';
  type?: LicenseType;
  typeName?: string;
  code?: string;
  deviceId: string;
  boundAt?: string;
  expiresAt?: string | null;
  remainingDays?: number;
  isLifetime?: boolean;
  message?: string;
}

export interface LicenseStats {
  total: number;
  unused: number;
  active: number;
  expired: number;
  disabled: number;
  monthlyCount: number;
  quarterlyCount: number;
  yearlyCount: number;
  lifetimeCount: number;
}

const TYPE_NAMES: Record<LicenseType, string> = {
  monthly: '月卡会员 (30天)',
  quarterly: '季卡会员 (90天)',
  yearly: '年卡会员 (365天)',
  lifetime: '永久尊享卡 (终身有效)'
};

const TYPE_DAYS: Record<LicenseType, number> = {
  monthly: 30,
  quarterly: 90,
  yearly: 365,
  lifetime: -1
};

const TYPE_PREFIX_MAP: Record<LicenseType, string> = {
  monthly: 'CFD-M',
  quarterly: 'CFD-Q',
  yearly: 'CFD-Y',
  lifetime: 'CFD-L'
};

export class LicenseService {
  private dataFilePath: string;
  private keysCache: Map<string, LicenseKey> = new Map();
  private initialized: boolean = false;
  private degraded: boolean = false;

  constructor() {
    this.dataFilePath = path.join(CONFIG.DATA_DIR, 'license_keys.json');
    this.resolveDataPath();
    this.migrateLegacyFile();
    this.loadKeys();
  }

  /**
   * 旧版本把卡密文件散落在 cwd/baseDir 等位置；
   * 统一迁移到 CONFIG.DATA_DIR（支持 DATA_DIR 环境变量部署）。
   */
  private migrateLegacyFile(): void {
    const canonical = path.join(CONFIG.DATA_DIR, 'license_keys.json');
    if (this.dataFilePath === canonical) return;
    if (fs.existsSync(this.dataFilePath) && !fs.existsSync(canonical)) {
      try {
        fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
        fs.copyFileSync(this.dataFilePath, canonical);
        console.log(`[LicenseService] 已迁移旧位置卡密库: ${this.dataFilePath} -> ${canonical}`);
        this.dataFilePath = canonical;
      } catch (e) {
        console.warn('[LicenseService] 迁移旧卡密库失败:', (e as Error).message);
      }
    }
  }

  private resolveDataPath(): void {
    const candidates = [
      this.dataFilePath,
      path.join(baseDir, '../data/license_keys.json'),
      path.join(baseDir, '../../data/license_keys.json'),
      path.join(process.cwd(), 'data', 'license_keys.json'),
      path.join(process.cwd(), 'server/data/license_keys.json')
    ];

    for (const p of candidates) {
      if (fs.existsSync(p)) {
        this.dataFilePath = p;
        return;
      }
    }

    const targetDir = path.dirname(this.dataFilePath);
    if (!fs.existsSync(targetDir)) {
      try { fs.mkdirSync(targetDir, { recursive: true }); } catch {}
    }
  }

  private loadKeys(): void {
    try {
      this.resolveDataPath();
      if (fs.existsSync(this.dataFilePath)) {
        const raw = fs.readFileSync(this.dataFilePath, 'utf-8');
        const list: LicenseKey[] = JSON.parse(raw);
        this.keysCache.clear();
        for (const item of list) {
          if (item && item.code) {
            this.checkAndExpireKey(item);
            this.keysCache.set(item.code.toUpperCase(), item);
          }
        }
        console.log(`[LicenseService] 成功载入 ${this.keysCache.size} 条激活码记录`);
      } else {
        this.keysCache.clear();
        this.saveKeys();
      }
      this.initialized = true;
    } catch (e: any) {
      // fail-closed：损坏文件备份为 .corrupt 并拒绝一切写回，防止空库覆写造成卡密永久丢失
      try { if (fs.existsSync(this.dataFilePath)) fs.copyFileSync(this.dataFilePath, this.dataFilePath + '.corrupt'); } catch {}
      this.degraded = true;
      console.error('[LicenseService] 激活码数据文件损坏！已备份到 .corrupt，写入功能已禁用，请修复文件后重启服务:', e.message);
      this.keysCache.clear();
    }
  }

  private saveKeys(): void {
    if (this.degraded) {
      console.error('[LicenseService] 数据文件已损坏（.corrupt），拒绝写入以保护数据。请修复后重启服务。');
      return;
    }
    try {
      const targetDir = path.dirname(this.dataFilePath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const list = Array.from(this.keysCache.values());
      writeJsonAtomic(this.dataFilePath, list);
    } catch (e: any) {
      console.error('[LicenseService] 保存激活码数据失败:', e.message);
    }
  }

  /**
   * 检查卡密是否过期并更新状态
   */
  private checkAndExpireKey(key: LicenseKey): void {
    if (key.status === 'active' && key.expiresAt && key.type !== 'lifetime') {
      const expTime = new Date(key.expiresAt).getTime();
      if (!isNaN(expTime) && expTime < Date.now()) {
        key.status = 'expired';
      }
    }
  }

  /**
   * 生成单个随机卡密字符串
   */
  private generateRandomCode(type: LicenseType, customPrefix?: string): string {
    const prefix = customPrefix || TYPE_PREFIX_MAP[type] || 'CFD';
    const randPart1 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const randPart2 = crypto.randomBytes(2).toString('hex').toUpperCase();
    const randPart3 = crypto.randomBytes(2).toString('hex').toUpperCase();
    return `${prefix}-${randPart1}-${randPart2}-${randPart3}`;
  }

  /**
   * 批量生成激活码
   */
  public generateBatch(params: {
    type: LicenseType;
    count: number;
    prefix?: string;
    remark?: string;
    createdBy?: string;
  }): { success: boolean; generatedKeys: LicenseKey[]; message: string } {
    const { type, count, prefix, remark, createdBy } = params;
    const safeCount = Math.min(Math.max(1, count || 1), 500);
    const durationDays = TYPE_DAYS[type] ?? 30;
    const nowStr = new Date().toISOString();
    const createdList: LicenseKey[] = [];

    for (let i = 0; i < safeCount; i++) {
      let code = this.generateRandomCode(type, prefix);
      while (this.keysCache.has(code)) {
        code = this.generateRandomCode(type, prefix);
      }

      const keyItem: LicenseKey = {
        id: crypto.randomUUID ? crypto.randomUUID() : `lic_${Date.now()}_${i}`,
        code,
        type,
        durationDays,
        status: 'unused',
        createdAt: nowStr,
        remark: remark || '',
        createdBy: createdBy || 'admin'
      };

      this.keysCache.set(code, keyItem);
      createdList.push(keyItem);
    }

    this.saveKeys();
    console.log(`[LicenseService] 成功批量生成 ${createdList.length} 张 [${TYPE_NAMES[type]}] 激活码`);

    return {
      success: true,
      generatedKeys: createdList,
      message: `成功生成 ${createdList.length} 张「${TYPE_NAMES[type]}」卡密！`
    };
  }

  /**
   * 客户端核销激活卡密并绑定设备码
   */
  public activate(code: string, deviceId: string): {
    success: boolean;
    message: string;
    license?: ClientLicenseInfo;
  } {
    if (!code || !code.trim()) {
      return { success: false, message: '请输入有效的激活码。' };
    }
    if (!deviceId || !deviceId.trim()) {
      return { success: false, message: '未获取到有效设备码，无法绑定。' };
    }

    const cleanCode = code.trim().toUpperCase();
    const cleanDeviceId = deviceId.trim();

    const key = this.keysCache.get(cleanCode);
    if (!key) {
      return { success: false, message: '激活码不存在，请核对卡密后重试。' };
    }

    this.checkAndExpireKey(key);

    if (key.status === 'disabled') {
      return { success: false, message: '该激活码已被管理员冻结或停用。' };
    }

    // 若已经激活
    if (key.status === 'active') {
      if (key.deviceId && key.deviceId.toLowerCase() === cleanDeviceId.toLowerCase()) {
        const info = this.buildClientLicenseInfo(key, cleanDeviceId);
        return {
          success: true,
          message: `设备已成功恢复「${TYPE_NAMES[key.type]}」激活状态！`,
          license: info
        };
      } else {
        return {
          success: false,
          message: '该激活码已被其他设备绑定使用！如需换机请联系管理员解绑。'
        };
      }
    }

    if (key.status === 'expired') {
      return { success: false, message: '该激活码已过期失效。' };
    }

    // 核销未使用卡密
    const now = new Date();
    key.deviceId = cleanDeviceId;
    key.boundAt = now.toISOString();
    key.status = 'active';

    if (key.type === 'lifetime' || key.durationDays === -1) {
      key.expiresAt = null;
    } else {
      const expDate = new Date(now.getTime() + key.durationDays * 24 * 60 * 60 * 1000);
      key.expiresAt = expDate.toISOString();
    }

    this.saveKeys();
    console.log(`[LicenseService] 成功为设备 [${cleanDeviceId}] 绑定激活码: ${cleanCode} (${key.type})`);

    const clientInfo = this.buildClientLicenseInfo(key, cleanDeviceId);
    return {
      success: true,
      message: `恭喜！已成功激活「${TYPE_NAMES[key.type]}」！`,
      license: clientInfo
    };
  }

  /**
   * 客户端验证设备绑定状态
   */
  public verify(deviceId: string, code?: string): ClientLicenseInfo {
    if (!deviceId || !deviceId.trim()) {
      return {
        isActivated: false,
        status: 'unactivated',
        deviceId: '',
        message: '未提供有效设备码'
      };
    }

    const cleanDeviceId = deviceId.trim();

    // 优先根据提供的特定卡密验证
    if (code && code.trim()) {
      const cleanCode = code.trim().toUpperCase();
      const key = this.keysCache.get(cleanCode);
      if (key && key.deviceId && key.deviceId.toLowerCase() === cleanDeviceId.toLowerCase()) {
        this.checkAndExpireKey(key);
        if (key.status === 'active') {
          return this.buildClientLicenseInfo(key, cleanDeviceId);
        }
      }
    }

    // 扫描该设备码已绑定的所有有效激活码，选取最高特权或最晚到期的卡密
    const matchedKeys: LicenseKey[] = [];
    for (const key of this.keysCache.values()) {
      if (key.deviceId && key.deviceId.toLowerCase() === cleanDeviceId.toLowerCase()) {
        this.checkAndExpireKey(key);
        if (key.status === 'active') {
          matchedKeys.push(key);
        }
      }
    }

    if (matchedKeys.length === 0) {
      return {
        isActivated: false,
        status: 'unactivated',
        deviceId: cleanDeviceId,
        message: '当前设备尚未激活授权'
      };
    }

    // 优先选取永久卡，其次选取到期时间最长的卡
    matchedKeys.sort((a, b) => {
      if (a.type === 'lifetime') return -1;
      if (b.type === 'lifetime') return 1;
      const tA = a.expiresAt ? new Date(a.expiresAt).getTime() : 0;
      const tB = b.expiresAt ? new Date(b.expiresAt).getTime() : 0;
      return tB - tA;
    });

    const primaryKey = matchedKeys[0];
    return this.buildClientLicenseInfo(primaryKey, cleanDeviceId);
  }

  /**
   * 构建客户端授权 DTO
   */
  private buildClientLicenseInfo(key: LicenseKey, deviceId: string): ClientLicenseInfo {
    const isLifetime = key.type === 'lifetime' || key.durationDays === -1;
    let remainingDays = -1;

    if (!isLifetime && key.expiresAt) {
      const expMs = new Date(key.expiresAt).getTime();
      const nowMs = Date.now();
      remainingDays = Math.max(0, Math.ceil((expMs - nowMs) / (24 * 60 * 60 * 1000)));
    }

    return {
      isActivated: key.status === 'active',
      status: key.status as any,
      type: key.type,
      typeName: TYPE_NAMES[key.type] || key.type,
      code: key.code,
      deviceId,
      boundAt: key.boundAt,
      expiresAt: key.expiresAt,
      remainingDays,
      isLifetime,
      message: isLifetime
        ? '永久卡授权有效'
        : `会员授权有效，剩余 ${remainingDays} 天`
    };
  }

  /**
   * 获取激活码列表 (支持分页、检索、筛选)
   */
  public getList(query: {
    search?: string;
    type?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): {
    list: LicenseKey[];
    total: number;
    page: number;
    limit: number;
    stats: LicenseStats;
  } {
    let all = Array.from(this.keysCache.values());

    // 状态刷新
    for (const k of all) {
      this.checkAndExpireKey(k);
    }

    // 过滤
    if (query.type && query.type !== 'all') {
      all = all.filter(k => k.type === query.type);
    }
    if (query.status && query.status !== 'all') {
      all = all.filter(k => k.status === query.status);
    }
    if (query.search && query.search.trim()) {
      const q = query.search.trim().toLowerCase();
      all = all.filter(k =>
        k.code.toLowerCase().includes(q) ||
        (k.deviceId && k.deviceId.toLowerCase().includes(q)) ||
        (k.remark && k.remark.toLowerCase().includes(q))
      );
    }

    // 排序：最新创建在最前
    all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const stats = this.getStats();
    const page = Math.max(1, Number(query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));
    const start = (page - 1) * limit;
    const paginated = all.slice(start, start + limit);

    return {
      list: paginated,
      total: all.length,
      page,
      limit,
      stats
    };
  }

  /**
   * 获取全量大盘统计
   */
  public getStats(): LicenseStats {
    let unused = 0;
    let active = 0;
    let expired = 0;
    let disabled = 0;
    let monthlyCount = 0;
    let quarterlyCount = 0;
    let yearlyCount = 0;
    let lifetimeCount = 0;

    for (const k of this.keysCache.values()) {
      this.checkAndExpireKey(k);
      if (k.status === 'unused') unused++;
      else if (k.status === 'active') active++;
      else if (k.status === 'expired') expired++;
      else if (k.status === 'disabled') disabled++;

      if (k.type === 'monthly') monthlyCount++;
      else if (k.type === 'quarterly') quarterlyCount++;
      else if (k.type === 'yearly') yearlyCount++;
      else if (k.type === 'lifetime') lifetimeCount++;
    }

    return {
      total: this.keysCache.size,
      unused,
      active,
      expired,
      disabled,
      monthlyCount,
      quarterlyCount,
      yearlyCount,
      lifetimeCount
    };
  }

  /**
   * 一键解绑设备码 (允许换机)
   */
  public unbind(code: string): { success: boolean; message: string } {
    if (!code) return { success: false, message: '请指定激活码' };
    const clean = code.trim().toUpperCase();
    const key = this.keysCache.get(clean);
    if (!key) return { success: false, message: '激活码不存在' };

    const oldDevice = key.deviceId || '无';
    key.deviceId = undefined;
    key.boundAt = undefined;
    key.status = 'unused';
    if (key.type !== 'lifetime') {
      key.expiresAt = undefined;
    }

    this.saveKeys();
    console.log(`[LicenseService] 成功解除卡密 ${clean} 与设备 [${oldDevice}] 的绑定`);
    return { success: true, message: `已成功解绑设备 [${oldDevice}]，该卡密已重置为未使用状态！` };
  }

  /**
   * 冻结 / 启用卡密
   */
  public toggleStatus(code: string, disabled: boolean): { success: boolean; message: string; key?: LicenseKey } {
    if (!code) return { success: false, message: '请指定激活码' };
    const clean = code.trim().toUpperCase();
    const key = this.keysCache.get(clean);
    if (!key) return { success: false, message: '激活码不存在' };

    if (disabled) {
      key.status = 'disabled';
    } else {
      // 恢复状态
      if (key.deviceId) {
        this.checkAndExpireKey(key);
        if (key.status === 'disabled') key.status = 'active';
      } else {
        key.status = 'unused';
      }
    }

    this.saveKeys();
    return {
      success: true,
      message: disabled ? `卡密 ${clean} 已被冻结停用！` : `卡密 ${clean} 已成功恢复启用！`,
      key
    };
  }

  /**
   * 删除卡密
   */
  public deleteKey(code: string): { success: boolean; message: string } {
    if (!code) return { success: false, message: '请指定激活码' };
    const clean = code.trim().toUpperCase();
    if (!this.keysCache.has(clean)) {
      return { success: false, message: '卡密不存在或已被删除' };
    }
    this.keysCache.delete(clean);
    this.saveKeys();
    return { success: true, message: `卡密 ${clean} 已成功删除！` };
  }

  /**
   * 延长卡密有效天数
   */
  public extendDays(code: string, additionalDays: number): { success: boolean; message: string; key?: LicenseKey } {
    if (!code) return { success: false, message: '请指定激活码' };
    const clean = code.trim().toUpperCase();
    const key = this.keysCache.get(clean);
    if (!key) return { success: false, message: '激活码不存在' };
    if (key.type === 'lifetime') {
      return { success: true, message: '永久卡无需延期', key };
    }
    // 未绑定的卡密只能改"可用时长"，已冻结的卡密须先解冻，防止凭空激活
    if (key.status === 'unused') {
      key.durationDays = (key.durationDays || 0) + Math.max(1, additionalDays || 30);
      this.saveKeys();
      return { success: true, message: `卡密尚未绑定设备，已将可用时长增加 ${Math.max(1, additionalDays || 30)} 天`, key };
    }
    if (key.status === 'disabled') {
      return { success: false, message: '卡密已冻结，请先解冻再延期', key };
    }

    const days = Math.max(1, additionalDays || 30);
    const baseTime = (key.expiresAt && new Date(key.expiresAt).getTime() > Date.now())
      ? new Date(key.expiresAt).getTime()
      : Date.now();

    const newExp = new Date(baseTime + days * 24 * 60 * 60 * 1000);
    key.expiresAt = newExp.toISOString();
    key.durationDays = (key.durationDays || 0) + days;
    key.status = 'active';

    this.saveKeys();
    return {
      success: true,
      message: `已成功为卡密 ${clean} 延长 ${days} 天有效期 (新到期时间: ${newExp.toLocaleDateString()})！`,
      key
    };
  }
}

export const licenseService = new LicenseService();
