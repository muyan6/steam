import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { CONFIG } from '../config/index.js';
import { writeJsonAtomic } from '../utils/atomicJson.js';
import { licenseSignService } from './licenseSignService.js';

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
  signature?: string;
  issuedAt?: number;
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
  // deviceId(小写) -> 卡密 code 列表 的反向索引：verify 是心跳与密钥类
  // 请求的热点路径，避免每次全表扫描；saveKeys 时失效重建
  private deviceIndex: Map<string, string[]> | null = null;

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

  private saveKeys(): boolean {
    // 任何持久化前数据都已变动，反向索引必须失效重建
    this.deviceIndex = null;
    if (this.degraded) {
      console.error('[LicenseService] 数据文件已损坏（.corrupt），拒绝写入以保护数据。请修复后重启服务。');
      return false;
    }
    try {
      const targetDir = path.dirname(this.dataFilePath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      const list = Array.from(this.keysCache.values());
      writeJsonAtomic(this.dataFilePath, list);
      return true;
    } catch (e: any) {
      console.error('[LicenseService] 保存激活码数据失败:', e.message);
      return false;
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
   * 生成单个随机卡密字符串（每组 4 字节 = 8 hex，共 96 位熵，防公网爆破）
   */
  private generateRandomCode(type: LicenseType, customPrefix?: string): string {
    // 自定义前缀统一大写，与 loadKeys 的 code 大写键约定一致，避免小写前缀造成重复码
    const prefix = (customPrefix || TYPE_PREFIX_MAP[type] || 'CFD').toUpperCase();
    const randPart1 = crypto.randomBytes(4).toString('hex').toUpperCase();
    const randPart2 = crypto.randomBytes(4).toString('hex').toUpperCase();
    const randPart3 = crypto.randomBytes(4).toString('hex').toUpperCase();
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

    // 持久化失败必须向上传递失败结果，绝不能返回"生成成功"却丢数据
    if (!this.saveKeys()) {
      return {
        success: false,
        generatedKeys: [],
        message: '数据保存失败，请稍后重试'
      };
    }
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
        const info = this.buildClientLicenseInfo(key, cleanDeviceId, true);
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

    // 核销前先确定到期时间：校验失败时直接返回，避免留下"已绑定但未落盘"的半改状态
    let nextExpiresAt: string | null;
    if (key.type === 'lifetime' || key.durationDays === -1) {
      nextExpiresAt = null;
    } else if (key.expiresAt && !isNaN(new Date(key.expiresAt).getTime())) {
      // 已带有效期（多为解绑时保留的绝对到期时间）：固定复用，绝不重新计满整期，
      // 否则「用一段时间 → 解绑 → 重新激活」可不断刷新有效期、变相无限续期
      const preserved = new Date(key.expiresAt).getTime();
      if (preserved <= Date.now()) {
        return { success: false, message: '该激活码有效期限已过，无法再次激活。' };
      }
      nextExpiresAt = new Date(preserved).toISOString();
    } else {
      nextExpiresAt = new Date(Date.now() + key.durationDays * 24 * 60 * 60 * 1000).toISOString();
    }

    const now = new Date();
    key.deviceId = cleanDeviceId;
    key.boundAt = now.toISOString();
    key.status = 'active';
    key.expiresAt = nextExpiresAt;

    // 保存失败时返回失败结果（内存态已变更，但未落盘不能算激活成功）
    if (!this.saveKeys()) {
      return { success: false, message: '数据保存失败，请稍后重试' };
    }
    console.log(`[LicenseService] 成功为设备 [${cleanDeviceId}] 绑定激活码: ${cleanCode} (${key.type})`);

    const clientInfo = this.buildClientLicenseInfo(key, cleanDeviceId, true);
    return {
      success: true,
      message: `恭喜！已成功激活「${TYPE_NAMES[key.type]}」！`,
      license: clientInfo
    };
  }

  /**
   * 换机迁移：将卡密绑定从旧设备迁移到新设备。
   * 安全约束：必须持有卡密且原设备码与绑定记录完全匹配才放行；
   * 剩余有效期沿用原到期时间（迁移不重置计时）。
   */
  public rebind(code: string, oldDeviceId: string, newDeviceId: string): {
    success: boolean;
    message: string;
    license?: ClientLicenseInfo;
  } {
    if (!code || !code.trim()) return { success: false, message: '请输入有效的激活码。' };
    if (!oldDeviceId || !oldDeviceId.trim()) return { success: false, message: '请输入原设备码。' };
    if (!newDeviceId || !newDeviceId.trim()) return { success: false, message: '未获取到本机设备码，无法迁移。' };

    const cleanCode = code.trim().toUpperCase();
    const cleanOld = oldDeviceId.trim();
    const cleanNew = newDeviceId.trim();

    if (cleanOld.toLowerCase() === cleanNew.toLowerCase()) {
      return { success: false, message: '原设备码与本机设备码相同，无需迁移。' };
    }

    const key = this.keysCache.get(cleanCode);
    if (!key) {
      return { success: false, message: '激活码不存在，请核对卡密后重试。' };
    }

    this.checkAndExpireKey(key);

    if (key.status === 'disabled') {
      return { success: false, message: '该激活码已被管理员冻结或停用。' };
    }
    if (key.status === 'expired') {
      return { success: false, message: '该激活码已过期失效。' };
    }
    if (key.status !== 'active' || !key.deviceId) {
      return { success: false, message: '该激活码尚未绑定任何设备，请直接在本机激活。' };
    }
    if (key.deviceId.toLowerCase() !== cleanOld.toLowerCase()) {
      return { success: false, message: '原设备码与卡密绑定记录不符，迁移被拒绝。' };
    }

    const previousDevice = key.deviceId;
    key.deviceId = cleanNew;
    key.boundAt = new Date().toISOString();
    // 到期时间保持不变：迁移不重置/顺延会员有效期

    if (!this.saveKeys()) {
      return { success: false, message: '数据保存失败，请稍后重试' };
    }
    console.log(`[LicenseService] 卡密 ${cleanCode} 已从设备 [${previousDevice}] 迁移至 [${cleanNew}]`);

    return {
      success: true,
      message: `绑定已成功迁移到本机！有效期不变${key.expiresAt ? `（至 ${key.expiresAt.slice(0, 10)}）` : ''}。`,
      license: this.buildClientLicenseInfo(key, cleanNew, true)
    };
  }

  /** 构建/获取 deviceId -> codes 反向索引 */
  private getDeviceIndex(): Map<string, string[]> {
    if (this.deviceIndex) return this.deviceIndex;
    const index = new Map<string, string[]>();
    for (const [code, key] of this.keysCache) {
      if (key.deviceId) {
        const k = key.deviceId.toLowerCase();
        const arr = index.get(k);
        if (arr) arr.push(code);
        else index.set(k, [code]);
      }
    }
    this.deviceIndex = index;
    return index;
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
          return this.buildClientLicenseInfo(key, cleanDeviceId, true);
        }
      }
    }

    // 通过反向索引取该设备码绑定的所有激活码，选取最高特权或最晚到期的卡密
    const matchedKeys: LicenseKey[] = [];
    const boundCodes = this.getDeviceIndex().get(cleanDeviceId.toLowerCase()) || [];
    for (const code of boundCodes) {
      const key = this.keysCache.get(code);
      if (!key) continue;
      this.checkAndExpireKey(key);
      if (key.status === 'active') {
        matchedKeys.push(key);
      }
    }

    if (matchedKeys.length === 0) {
      const now = Date.now();
      const payload = {
        deviceId: cleanDeviceId,
        isActivated: false,
        status: 'unactivated',
        type: '',
        isLifetime: false,
        expiresAt: null,
        issuedAt: now
      };
      const { signature } = licenseSignService.sign(payload);
      return {
        isActivated: false,
        status: 'unactivated',
        deviceId: cleanDeviceId,
        message: '当前设备尚未激活授权',
        signature,
        issuedAt: now
      };
    }

    // 优先选取永久卡，其次选取到期时间最长的卡
    matchedKeys.sort((a, b) => {
      if (a.type === 'lifetime' && b.type === 'lifetime') return 0;
      if (a.type === 'lifetime') return -1;
      if (b.type === 'lifetime') return 1;
      const tA = a.expiresAt ? new Date(a.expiresAt).getTime() : 0;
      const tB = b.expiresAt ? new Date(b.expiresAt).getTime() : 0;
      return tB - tA;
    });

    const primaryKey = matchedKeys[0];
    // 仅凭 deviceId 匹配（未提供卡密证明）：返回掩码卡密，防探测抢绑
    return this.buildClientLicenseInfo(primaryKey, cleanDeviceId, false);
  }

  /**
   * 卡密掩码：客户端 DTO 只返回部分明文，防止仅凭 deviceId 即可
   * 通过 /license/status、/license/verify 探测到完整卡密后抢绑。
   * 请求方已证明持有完整卡密（激活/重绑/按卡密验签）时才返回明文。
   */
  private maskCode(code: string): string {
    const c = (code || '').toUpperCase();
    if (c.length <= 12) return c.slice(0, 4) + '-****';
    return `${c.slice(0, 8)}****${c.slice(-4)}`;
  }

  /**
   * 构建客户端授权 DTO
   * @param revealCode 仅在请求方能证明持有完整卡密时为 true
   */
  private buildClientLicenseInfo(key: LicenseKey, deviceId: string, revealCode: boolean = false): ClientLicenseInfo {
    const isLifetime = key.type === 'lifetime' || key.durationDays === -1;
    let remainingDays = -1;

    if (!isLifetime && key.expiresAt) {
      const expMs = new Date(key.expiresAt).getTime();
      const nowMs = Date.now();
      remainingDays = Math.max(0, Math.ceil((expMs - nowMs) / (24 * 60 * 60 * 1000)));
    }

    const isActivated = key.status === 'active';
    const now = Date.now();
    const { signature } = licenseSignService.sign({
      deviceId,
      isActivated,
      status: key.status,
      type: key.type,
      isLifetime,
      expiresAt: key.expiresAt,
      issuedAt: now
    });

    return {
      isActivated,
      status: key.status as any,
      type: key.type,
      typeName: TYPE_NAMES[key.type] || key.type,
      code: revealCode ? key.code : this.maskCode(key.code),
      deviceId,
      boundAt: key.boundAt,
      expiresAt: key.expiresAt,
      remainingDays,
      isLifetime,
      message: isLifetime
        ? '永久卡授权有效'
        : (isActivated ? `会员授权有效，剩余 ${remainingDays} 天` : '授权已失效'),
      signature,
      issuedAt: now
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
  public unbind(code: string): { success: boolean; message: string; oldDeviceId?: string } {
    if (!code) return { success: false, message: '请指定激活码' };
    const clean = code.trim().toUpperCase();
    const key = this.keysCache.get(clean);
    if (!key) return { success: false, message: '激活码不存在' };

    const oldDevice = key.deviceId || '无';
    const oldDevId = key.deviceId;
    // 非永久卡已过到期时间的，解绑后应标记为过期而不是回退为未使用（防止过期卡被再次领取激活）
    const isExpired =
      key.type !== 'lifetime' &&
      !!key.expiresAt &&
      !isNaN(new Date(key.expiresAt).getTime()) &&
      new Date(key.expiresAt).getTime() < Date.now();
    key.deviceId = undefined;
    key.boundAt = undefined;
    key.status = isExpired ? 'expired' : 'unused';
    // 保留 expiresAt（未过期时）：重新激活将复用该到期时间，防止解绑变相续期。
    // 已过期的卡密本身就会在激活时被状态判定拦截，无需清除。

    if (!this.saveKeys()) {
      return { success: false, message: '数据保存失败，请稍后重试' };
    }
    console.log(`[LicenseService] 成功解除卡密 ${clean} 与设备 [${oldDevice}] 的绑定`);
    return {
      success: true,
      message: `已成功解绑设备 [${oldDevice}]，该卡密已重置为未使用状态！`,
      oldDeviceId: oldDevId
    };
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
      // 恢复状态：已过到期时间的卡密解冻后应标记为过期，不能凭空复活为有效激活
      if (key.deviceId) {
        const expTime =
          key.type !== 'lifetime' && key.expiresAt ? new Date(key.expiresAt).getTime() : NaN;
        key.status = !isNaN(expTime) && expTime < Date.now() ? 'expired' : 'active';
      } else {
        key.status = 'unused';
      }
    }

    if (!this.saveKeys()) {
      return { success: false, message: '数据保存失败，请稍后重试' };
    }
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
    if (!this.saveKeys()) {
      return { success: false, message: '数据保存失败，请稍后重试' };
    }
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
    // 天数夹取：1~3650，非法/NaN 一律回落默认 30
    const clampDays = (v: number): number => {
      const n = Number(v);
      return Math.min(3650, Math.max(1, isNaN(n) || n <= 0 ? 30 : Math.floor(n)));
    };
    // 未绑定的卡密只能改"可用时长"，已冻结的卡密须先解冻，防止凭空激活
    if (key.status === 'unused') {
      const addDays = clampDays(additionalDays);
      key.durationDays = (key.durationDays || 0) + addDays;
      // 若携带解绑保留的绝对到期时间，延期时须一并顺延，
      // 否则重新激活会复用旧的 expiresAt、忽略本次延期
      const carried = key.expiresAt ? new Date(key.expiresAt).getTime() : NaN;
      if (!isNaN(carried)) {
        key.expiresAt = new Date(carried + addDays * 24 * 60 * 60 * 1000).toISOString();
      }
      if (!this.saveKeys()) {
        return { success: false, message: '数据保存失败，请稍后重试' };
      }
      return { success: true, message: `卡密尚未绑定设备，已将可用时长增加 ${addDays} 天`, key };
    }
    if (key.status === 'disabled') {
      return { success: false, message: '卡密已冻结，请先解冻再延期', key };
    }

    const days = clampDays(additionalDays);
    const baseTime = (key.expiresAt && new Date(key.expiresAt).getTime() > Date.now())
      ? new Date(key.expiresAt).getTime()
      : Date.now();

    const newExp = new Date(baseTime + days * 24 * 60 * 60 * 1000);
    key.expiresAt = newExp.toISOString();
    key.durationDays = (key.durationDays || 0) + days;
    key.status = 'active';

    if (!this.saveKeys()) {
      return { success: false, message: '数据保存失败，请稍后重试' };
    }
    return {
      success: true,
      message: `已成功为卡密 ${clean} 延长 ${days} 天有效期 (新到期时间: ${newExp.toLocaleDateString()})！`,
      key
    };
  }
}

export const licenseService = new LicenseService();
