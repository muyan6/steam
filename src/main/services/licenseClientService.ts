import fs from 'fs';
import path from 'path';
import https from 'https';
import axios from 'axios';
import { app } from 'electron';
import { deviceService } from './deviceService';
import { APP_CONFIG } from '../../config/appConfig';
import { ClientLicenseInfo } from '../../types';

export class LicenseClientService {
  private localLicensePath: string;
  private httpsAgent = new https.Agent({ rejectUnauthorized: false });
  private cachedLicense: ClientLicenseInfo | null = null;

  constructor() {
    let baseDir = process.cwd();
    try {
      if (typeof app !== 'undefined' && app && typeof app.getPath === 'function') {
        baseDir = app.getPath('userData');
      }
    } catch {
      baseDir = process.cwd();
    }
    this.localLicensePath = path.join(baseDir, 'license.json');
    this.loadLocalLicense();
  }

  private loadLocalLicense(): void {
    try {
      if (fs.existsSync(this.localLicensePath)) {
        const raw = fs.readFileSync(this.localLicensePath, 'utf-8');
        const info = JSON.parse(raw);
        if (info && info.deviceId) {
          this.cachedLicense = info;
        }
      }
    } catch (e: any) {
      console.warn('[LicenseClientService] 载入本地授权文件异常:', e.message);
    }
  }

  private saveLocalLicense(info: ClientLicenseInfo | null): void {
    try {
      this.cachedLicense = info;
      if (!info) {
        if (fs.existsSync(this.localLicensePath)) {
          fs.unlinkSync(this.localLicensePath);
        }
        return;
      }
      const dir = path.dirname(this.localLicensePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.localLicensePath, JSON.stringify(info, null, 2), 'utf-8');
    } catch (e: any) {
      console.warn('[LicenseClientService] 保存本地授权文件异常:', e.message);
    }
  }

  /**
   * 获取本机设备码
   */
  public getDeviceId(): string {
    return deviceService.getDeviceId();
  }

  /**
   * 获取当前授权状态（自动在线校验并结合本地缓存）
   */
  public async getLicenseInfo(forceVerifyOnline: boolean = false): Promise<ClientLicenseInfo> {
    const deviceId = this.getDeviceId();

    // 1. 本地缓存快速校验
    if (!forceVerifyOnline && this.cachedLicense && this.cachedLicense.deviceId === deviceId) {
      // 检查本地到期时间
      if (this.cachedLicense.isActivated && !this.cachedLicense.isLifetime && this.cachedLicense.expiresAt) {
        const expMs = new Date(this.cachedLicense.expiresAt).getTime();
        if (!isNaN(expMs) && expMs < Date.now()) {
          this.cachedLicense.isActivated = false;
          this.cachedLicense.status = 'expired';
          this.cachedLicense.remainingDays = 0;
          this.cachedLicense.message = '您的会员授权已到期，请续费使用！';
          this.saveLocalLicense(this.cachedLicense);
        } else if (!isNaN(expMs)) {
          this.cachedLicense.remainingDays = Math.max(0, Math.ceil((expMs - Date.now()) / (24 * 3600 * 1000)));
        }
      }
    }

    // 2. 向云端发起实时验签
    try {
      const url = `${APP_CONFIG.API_BASE_URL}/api/license/verify`;
      const resp = await axios.post(url, {
        deviceId,
        code: this.cachedLicense?.code
      }, {
        timeout: 4000,
        httpsAgent: this.httpsAgent,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ChunFengDu-Client'
        }
      });

      if (resp.data && resp.data.success && resp.data.data) {
        const liveInfo: ClientLicenseInfo = resp.data.data;
        this.saveLocalLicense(liveInfo);
        return liveInfo;
      }
    } catch (e: any) {
      console.warn('[LicenseClientService] 云端授权验签未连接，启用本地离线凭证:', e.message);
    }

    // 3. 离线兜底
    if (this.cachedLicense && this.cachedLicense.deviceId === deviceId) {
      return this.cachedLicense;
    }

    return {
      isActivated: false,
      status: 'unactivated',
      deviceId,
      message: '当前设备未激活，支持月卡/季卡/年卡与永久卡'
    };
  }

  /**
   * 客户端核销激活卡密
   */
  public async activateLicense(code: string): Promise<{
    success: boolean;
    message: string;
    license?: ClientLicenseInfo;
  }> {
    if (!code || !code.trim()) {
      return { success: false, message: '请输入激活码' };
    }

    const deviceId = this.getDeviceId();
    const cleanCode = code.trim().toUpperCase();

    try {
      const url = `${APP_CONFIG.API_BASE_URL}/api/license/activate`;
      const resp = await axios.post(url, {
        code: cleanCode,
        deviceId
      }, {
        timeout: 6000,
        httpsAgent: this.httpsAgent,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'ChunFengDu-Client'
        }
      });

      if (resp.data && resp.data.success && resp.data.data) {
        const info: ClientLicenseInfo = resp.data.data;
        this.saveLocalLicense(info);
        console.log(`[LicenseClientService] 激活成功: ${info.typeName} (剩余 ${info.remainingDays} 天)`);
        return {
          success: true,
          message: resp.data.message || '恭喜，激活成功！',
          license: info
        };
      } else {
        return {
          success: false,
          message: (resp.data && resp.data.message) ? resp.data.message : '激活失败，卡密可能不存在或已过期'
        };
      }
    } catch (e: any) {
      const msg = e.response?.data?.message || e.message;
      return {
        success: false,
        message: `激活请求失败: ${msg}`
      };
    }
  }

  /**
   * 清除本地授权缓存
   */
  public unbindLocal(): { success: boolean; message: string } {
    this.saveLocalLicense(null);
    return { success: true, message: '已清除本地卡密授权记录' };
  }
}

export const licenseClientService = new LicenseClientService();
