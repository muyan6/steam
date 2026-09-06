import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIG } from '../config/index.js';
import { AdminCredentials, AdminUser, AuthTokenPayload, AuditLog } from '../types/index.js';
import { writeJsonAtomic, readJsonOrThrow } from '../utils/atomicJson.js';

export class AuthService {
  private credFilePath: string;
  private auditFilePath: string;
  // 新哈希使用的 PBKDF2 迭代次数（OWASP 2023 推荐 sha512 ≥ 210000）
  private static PBKDF2_ITERATIONS = 210000;
  private static LEGACY_PBKDF2_ITERATIONS = 10000;
  // 失败计数带时间窗：窗口外未锁定的记录自动清理，避免任意时间跨度内累计触发锁定
  private loginAttempts: Map<string, { count: number; lockedUntil: number; lastAttemptAt: number }> = new Map();
  // 凭据内存缓存：verifyToken 是每个管理请求的热点路径，避免每次同步读盘；
  // 在任何凭据写入点（初始化/改密/透明升级）失效
  private credsCache: AdminCredentials | null = null;
  // 审计日志内存态：加载一次 + 防抖批量落盘，避免每次失败尝试都全量读+写
  private auditLogs: AuditLog[] | null = null;
  private auditDirty = false;
  private auditFlushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.credFilePath = path.join(CONFIG.DATA_DIR, 'admin_credentials.json');
    this.auditFilePath = path.join(CONFIG.DATA_DIR, 'admin_audit.json');
    this.ensureCredentials();
  }

  private hashPassword(password: string, salt: string, iterations: number = AuthService.PBKDF2_ITERATIONS): string {
    return crypto.pbkdf2Sync(password, salt, iterations, 64, 'sha512').toString('hex');
  }

  /** 凭据存储迭代次数：历史记录无字段视为旧版 10000 */
  private storedIterations(creds: AdminCredentials): number {
    return creds.pbkdf2Iterations && creds.pbkdf2Iterations > 0
      ? creds.pbkdf2Iterations
      : AuthService.LEGACY_PBKDF2_ITERATIONS;
  }

  private ensureCredentials() {
    if (!fs.existsSync(CONFIG.DATA_DIR)) {
      fs.mkdirSync(CONFIG.DATA_DIR, { recursive: true });
    }

    if (!fs.existsSync(this.credFilePath)) {
      const salt = crypto.randomBytes(16).toString('hex');
      const passwordHash = this.hashPassword(CONFIG.DEFAULT_ADMIN_PASS, salt);
      const defaultCreds: AdminCredentials = {
        username: CONFIG.DEFAULT_ADMIN_USER,
        passwordHash,
        salt,
        tokenVersion: 1,
        pbkdf2Iterations: AuthService.PBKDF2_ITERATIONS,
        updatedAt: new Date().toISOString()
      };
      writeJsonAtomic(this.credFilePath, defaultCreds);
      this.credsCache = defaultCreds;
      console.log(`[AuthService] 已初始化管理员账号: ${defaultCreds.username}（首次登录请立即在「安全配置」中修改密码）`);
    }
  }

  private getCredentials(): AdminCredentials {
    if (this.credsCache) {
      return this.credsCache;
    }
    this.ensureCredentials();
    // 凭据文件损坏时抛出错误拒绝服务，绝不静默重置为默认弱口令
    const creds = readJsonOrThrow<AdminCredentials>(this.credFilePath, '管理员凭据');
    this.credsCache = creds;
    return creds;
  }

  /** 写入凭据并失效内存缓存 */
  private saveCredentials(creds: AdminCredentials): void {
    writeJsonAtomic(this.credFilePath, creds);
    this.credsCache = creds;
  }

  // ==================== 审计日志：内存态 + 防抖落盘 ====================

  private loadAuditLogs(): AuditLog[] {
    if (this.auditLogs) return this.auditLogs;
    try {
      if (fs.existsSync(this.auditFilePath)) {
        try {
          this.auditLogs = JSON.parse(fs.readFileSync(this.auditFilePath, 'utf-8'));
        } catch {
          this.auditLogs = [];
        }
      } else {
        this.auditLogs = [];
      }
    } catch {
      this.auditLogs = [];
    }
    if (!Array.isArray(this.auditLogs)) this.auditLogs = [];
    return this.auditLogs;
  }

  private scheduleAuditFlush(): void {
    if (this.auditFlushTimer) return;
    this.auditFlushTimer = setTimeout(() => {
      this.auditFlushTimer = null;
      this.flushAuditLogs();
    }, 3 * 1000);
    // 计时器不阻止进程退出
    (this.auditFlushTimer as any).unref?.();
  }

  private flushAuditLogs(): void {
    if (!this.auditDirty || !this.auditLogs) return;
    this.auditDirty = false;
    try {
      writeJsonAtomic(this.auditFilePath, this.auditLogs);
    } catch (e) {
      this.auditDirty = true;
      console.error('[AuthService] 审计日志落盘失败:', e);
    }
  }

  public recordAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>) {
    try {
      const logs = this.loadAuditLogs();
      const entry: AuditLog = {
        id: `audit_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
        timestamp: new Date().toISOString(),
        ...log
      };
      logs.unshift(entry);
      // 保留最新的 200 条审计记录
      if (logs.length > 200) {
        logs.length = 200;
      }
      this.auditDirty = true;
      this.scheduleAuditFlush();
    } catch (e) {
      console.error('[AuthService] 记录审计日志失败:', e);
    }
  }

  public getAuditLogs(limit: number = 50): AuditLog[] {
    return this.loadAuditLogs().slice(0, limit);
  }

  public generateToken(username: string, role: string = 'superadmin'): string {
    const now = Math.floor(Date.now() / 1000);
    const creds = this.getCredentials();
    const payload: AuthTokenPayload = {
      username,
      role,
      iat: now,
      exp: now + CONFIG.TOKEN_EXPIRES_SECONDS,
      tv: creds.tokenVersion ?? 1
    } as AuthTokenPayload;

    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', CONFIG.JWT_SECRET)
      .update(`${header}.${body}`)
      .digest('base64url');

    return `${header}.${body}.${signature}`;
  }

  public verifyToken(token: string): AuthTokenPayload | null {
    if (!token) return null;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;

      const [header, body, signature] = parts;
      const expectedSignature = crypto
        .createHmac('sha256', CONFIG.JWT_SECRET)
        .update(`${header}.${body}`)
        .digest('base64url');

      const sigBuf = Buffer.from(signature);
      const expectedBuf = Buffer.from(expectedSignature);
      if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
        return null;
      }

      const payload: AuthTokenPayload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'));
      const now = Math.floor(Date.now() / 1000);
      // 强制要求 exp：缺少过期时间的 token 一律拒绝，避免历史 token 永久有效
      if (!payload.exp || payload.exp < now) {
        return null; // 过期或非法
      }

      // tokenVersion 吊销：修改密码后旧 token 一律失效
      const creds = this.getCredentials();
      const currentVersion = (payload as any).tv ?? 1;
      if (currentVersion < (creds.tokenVersion ?? 1)) {
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  /**
   * IP 锁定键归一化：IPv6 取前 4 个 hextet（/64 网段），
   * 防止攻击者在同一 /64 内轮换海量地址绕过失败锁定；IPv4 原样使用。
   */
  private normalizeLockKey(ip: string): string {
    const clean = (ip || '').trim();
    if (clean.includes(':')) {
      return clean.split(':').slice(0, 4).join(':');
    }
    return clean;
  }

  public login(
    username: string,
    pass: string,
    ip: string = '127.0.0.1',
    userAgent: string = ''
  ): { success: boolean; message: string; token?: string; user?: AdminUser } {
    const now = Date.now();
    const cleanUser = (username || '').trim();
    const cleanPass = (pass || '').trim();
    const lockKey = this.normalizeLockKey(ip);

    // 锁定检查必须先于凭据校验，防止爆破
    // 清理过期记录：已解除锁定、或超出失败计数窗口（15 分钟）的记录一律移除
    for (const [key, val] of this.loginAttempts) {
      const windowExpired = now - val.lastAttemptAt > CONFIG.LOCKOUT_TIME_MS;
      if (val.lockedUntil !== 0 && val.lockedUntil <= now) {
        this.loginAttempts.delete(key);
      } else if (val.lockedUntil === 0 && windowExpired) {
        this.loginAttempts.delete(key);
      }
    }
    const attempt = this.loginAttempts.get(lockKey);
    if (attempt && attempt.lockedUntil > now) {
      const remainMinutes = Math.ceil((attempt.lockedUntil - now) / 60000);
      this.recordAuditLog({
        action: 'LOGIN_LOCKED',
        operator: cleanUser,
        ip,
        userAgent,
        details: `IP 处于锁定状态，剩余 ${remainMinutes} 分钟`,
        success: false
      });
      return {
        success: false,
        message: `安全锁定：连续输错密码已超限，请 ${remainMinutes} 分钟后再试`
      };
    }

    // 安全策略：只接受 PBKDF2 哈希匹配，不存在默认密码/主密钥等任何回退通道
    const creds = this.getCredentials();
    const iterations = this.storedIterations(creds);
    const computedHash = this.hashPassword(cleanPass, creds.salt, iterations);
    const hashBuf = Buffer.from(computedHash);
    const storedBuf = Buffer.from(creds.passwordHash);
    const isPassValid =
      hashBuf.length === storedBuf.length && crypto.timingSafeEqual(hashBuf, storedBuf);
    const isUserValid =
      cleanUser.toLowerCase() === creds.username.toLowerCase();

    if (isUserValid && isPassValid) {
      this.loginAttempts.delete(lockKey);

      // 透明升级：旧迭代次数（10000）的哈希在登录成功时用新迭代次数重哈希落盘
      if (iterations < AuthService.PBKDF2_ITERATIONS) {
        try {
          const newSalt = crypto.randomBytes(16).toString('hex');
          this.saveCredentials({
            ...creds,
            passwordHash: this.hashPassword(cleanPass, newSalt),
            salt: newSalt,
            pbkdf2Iterations: AuthService.PBKDF2_ITERATIONS,
            updatedAt: new Date().toISOString()
          });
          console.log('[AuthService] 已将管理员凭据 PBKDF2 迭代次数透明升级至 210000');
        } catch (e) {
          console.error('[AuthService] 凭据哈希透明升级失败（不影响本次登录）:', e);
        }
      }

      const token = this.generateToken(creds.username, 'superadmin');
      const user: AdminUser = {
        username: creds.username,
        role: 'superadmin',
        lastLoginAt: new Date().toISOString(),
        lastLoginIp: ip
      };

      this.recordAuditLog({
        action: 'LOGIN_SUCCESS',
        operator: cleanUser,
        ip,
        userAgent,
        details: '管理员登录成功',
        success: true
      });

      return {
        success: true,
        message: '登录成功',
        token,
        user
      };
    }

    // 记录失败尝试
    const currentCount = (attempt ? attempt.count : 0) + 1;
    let lockedUntil = 0;
    let lockMsg = '';

    if (currentCount >= CONFIG.MAX_LOGIN_ATTEMPTS) {
      lockedUntil = now + CONFIG.LOCKOUT_TIME_MS;
      lockMsg = ' (连续错误已达上限，IP 将被锁定 15 分钟)';
    }

    this.loginAttempts.set(lockKey, { count: currentCount, lockedUntil, lastAttemptAt: now });
    this.recordAuditLog({
      action: 'LOGIN_FAILED',
      operator: cleanUser,
      ip,
      userAgent,
      details: `密码错误 (尝试次数: ${currentCount}/${CONFIG.MAX_LOGIN_ATTEMPTS})${lockMsg}`,
      success: false
    });

    return {
      success: false,
      message: `账号或密码错误${lockMsg}`
    };
  }

  public changePassword(
    currentPass: string,
    newUsername: string,
    newPass: string,
    operator: string,
    ip: string = '127.0.0.1',
    userAgent: string = ''
  ): { success: boolean; message: string; token?: string } {
    const creds = this.getCredentials();
    const cleanCurrent = (currentPass || '').trim();
    const currentHash = this.hashPassword(cleanCurrent, creds.salt, this.storedIterations(creds));
    const curBuf = Buffer.from(currentHash);
    const storedBuf = Buffer.from(creds.passwordHash);
    const isCurrentValid =
      curBuf.length === storedBuf.length && crypto.timingSafeEqual(curBuf, storedBuf);

    if (!isCurrentValid) {
      this.recordAuditLog({
        action: 'CHANGE_PASSWORD_FAILED',
        operator,
        ip,
        userAgent,
        details: '原密码验证失败',
        success: false
      });
      return { success: false, message: '原密码验证错误，无法修改' };
    }

    const cleanNewPass = (newPass || '').trim();
    if (!cleanNewPass || cleanNewPass.length < 6) {
      return { success: false, message: '新密码长度至少需要 6 位字符' };
    }

    const finalUsername = (newUsername && newUsername.trim()) || creds.username;
    const newSalt = crypto.randomBytes(16).toString('hex');
    const newPasswordHash = this.hashPassword(cleanNewPass, newSalt);

    const updatedCreds: AdminCredentials = {
      username: finalUsername,
      passwordHash: newPasswordHash,
      salt: newSalt,
      tokenVersion: (creds.tokenVersion ?? 1) + 1,
      pbkdf2Iterations: AuthService.PBKDF2_ITERATIONS,
      updatedAt: new Date().toISOString()
    };

    this.saveCredentials(updatedCreds);

    this.recordAuditLog({
      action: 'CHANGE_PASSWORD_SUCCESS',
      operator: finalUsername,
      ip,
      userAgent,
      details: `管理员账号/密码已成功更新 (账号: ${finalUsername})，旧会话已全部失效`,
      success: true
    });

    const newToken = this.generateToken(finalUsername, 'superadmin');

    return {
      success: true,
      message: '管理员账号及密码修改成功，所有旧登录会话已失效，请使用新凭证重新登录',
      token: newToken
    };
  }

  public getProfile(): AdminUser {
    const creds = this.getCredentials();
    return {
      username: creds.username,
      role: 'superadmin',
      lastLoginAt: creds.updatedAt
    };
  }
}

export const authService = new AuthService();
