import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIG } from '../config/index.js';
import { AdminCredentials, AdminUser, AuthTokenPayload, AuditLog } from '../types/index.js';
import { writeJsonAtomic, readJsonOrThrow } from '../utils/atomicJson.js';

export class AuthService {
  private credFilePath: string;
  private auditFilePath: string;
  private loginAttempts: Map<string, { count: number; lockedUntil: number }> = new Map();

  constructor() {
    this.credFilePath = path.join(CONFIG.DATA_DIR, 'admin_credentials.json');
    this.auditFilePath = path.join(CONFIG.DATA_DIR, 'admin_audit.json');
    this.ensureCredentials();
  }

  private hashPassword(password: string, salt: string): string {
    return crypto.pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
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
        updatedAt: new Date().toISOString()
      };
      writeJsonAtomic(this.credFilePath, defaultCreds);
      console.log(`[AuthService] 已初始化管理员账号: ${defaultCreds.username}（首次登录请立即在「安全配置」中修改密码）`);
    }
  }

  private getCredentials(): AdminCredentials {
    this.ensureCredentials();
    // 凭据文件损坏时抛出错误拒绝服务，绝不静默重置为默认弱口令
    return readJsonOrThrow<AdminCredentials>(this.credFilePath, '管理员凭据');
  }

  public recordAuditLog(log: Omit<AuditLog, 'id' | 'timestamp'>) {
    try {
      let logs: AuditLog[] = [];
      if (fs.existsSync(this.auditFilePath)) {
        try {
          logs = JSON.parse(fs.readFileSync(this.auditFilePath, 'utf-8'));
        } catch {
          logs = [];
        }
      }
      const entry: AuditLog = {
        id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: new Date().toISOString(),
        ...log
      };
      logs.unshift(entry);
      // 保留最新的 200 条审计记录
      if (logs.length > 200) {
        logs = logs.slice(0, 200);
      }
      writeJsonAtomic(this.auditFilePath, logs);
    } catch (e) {
      console.error('[AuthService] 记录审计日志失败:', e);
    }
  }

  public getAuditLogs(limit: number = 50): AuditLog[] {
    try {
      if (fs.existsSync(this.auditFilePath)) {
        const logs: AuditLog[] = JSON.parse(fs.readFileSync(this.auditFilePath, 'utf-8'));
        return logs.slice(0, limit);
      }
    } catch (e) {
      console.error('[AuthService] 读取审计日志失败:', e);
    }
    return [];
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
      if (payload.exp && payload.exp < now) {
        return null; // 过期
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

  public login(
    username: string,
    pass: string,
    ip: string = '127.0.0.1',
    userAgent: string = ''
  ): { success: boolean; message: string; token?: string; user?: AdminUser } {
    const now = Date.now();
    const cleanUser = (username || '').trim();
    const cleanPass = (pass || '').trim();

    // 锁定检查必须先于凭据校验，防止爆破
    // 清理已过期的锁定记录，防止长期运行内存缓慢增长
    for (const [key, val] of this.loginAttempts) {
      if (val.lockedUntil !== 0 && val.lockedUntil <= now) {
        this.loginAttempts.delete(key);
      }
    }
    const attempt = this.loginAttempts.get(ip);
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
    const computedHash = this.hashPassword(cleanPass, creds.salt);
    const hashBuf = Buffer.from(computedHash);
    const storedBuf = Buffer.from(creds.passwordHash);
    const isPassValid =
      hashBuf.length === storedBuf.length && crypto.timingSafeEqual(hashBuf, storedBuf);
    const isUserValid =
      cleanUser.toLowerCase() === creds.username.toLowerCase();

    if (isUserValid && isPassValid) {
      this.loginAttempts.delete(ip);
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

    this.loginAttempts.set(ip, { count: currentCount, lockedUntil });
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
    const currentHash = this.hashPassword(cleanCurrent, creds.salt);
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
      updatedAt: new Date().toISOString()
    };

    writeJsonAtomic(this.credFilePath, updatedCreds);

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
