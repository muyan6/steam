import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIG } from '../config/index.js';

export interface SignedLicensePayload {
  deviceId: string;
  isActivated: boolean;
  status: string;
  type?: string;
  isLifetime?: boolean;
  expiresAt?: string | null;
  issuedAt: number;
}

const DEFAULT_PRIVATE_KEY_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIPMnembY+F7yq+HpTfNcUCF7VpcjTdN9gHV87FK5//Ez
-----END PRIVATE KEY-----`;

export class LicenseSignService {
  private privateKeyPem: string = '';
  private publicKeyPem: string = '';
  private publicKeyRawHex: string = '';

  constructor() {
    this.initKeys();
  }

  private initKeys(): void {
    const keyFile = path.join(CONFIG.DATA_DIR, 'license_ed25519_private.pem');
    const pubFile = path.join(CONFIG.DATA_DIR, 'license_ed25519_public.pem');
    const pubRawFile = path.join(CONFIG.DATA_DIR, 'license_ed25519_public.hex');

    try {
      if (fs.existsSync(keyFile) && fs.existsSync(pubFile)) {
        this.privateKeyPem = fs.readFileSync(keyFile, 'utf-8');
        this.publicKeyPem = fs.readFileSync(pubFile, 'utf-8');
        if (fs.existsSync(pubRawFile)) {
          this.publicKeyRawHex = fs.readFileSync(pubRawFile, 'utf-8').trim();
        } else {
          const pubKeyObj = crypto.createPublicKey(this.publicKeyPem);
          const der = pubKeyObj.export({ type: 'spki', format: 'der' });
          this.publicKeyRawHex = der.subarray(-32).toString('hex');
          fs.writeFileSync(pubRawFile, this.publicKeyRawHex, 'utf-8');
        }
        return;
      }

      // 默认使用与客户端公钥对齐的权威密钥（可通过环境变量 LICENSE_PRIVATE_KEY 覆盖）
      const initialPrivate = (process.env.LICENSE_PRIVATE_KEY || DEFAULT_PRIVATE_KEY_PEM).trim();
      const pubKeyObj = crypto.createPublicKey(initialPrivate);
      const publicKeyPem = pubKeyObj.export({ type: 'spki', format: 'pem' }) as string;
      const der = pubKeyObj.export({ type: 'spki', format: 'der' });
      const pubRawHex = der.subarray(-32).toString('hex');

      this.privateKeyPem = initialPrivate;
      this.publicKeyPem = publicKeyPem;
      this.publicKeyRawHex = pubRawHex;

      fs.writeFileSync(keyFile, this.privateKeyPem, 'utf-8');
      fs.writeFileSync(pubFile, this.publicKeyPem, 'utf-8');
      fs.writeFileSync(pubRawFile, this.publicKeyRawHex, 'utf-8');

      console.log(`[LicenseSignService] 签名密钥初始化成功，公钥指纹: ${this.publicKeyRawHex}`);
    } catch (e: any) {
      console.error('[LicenseSignService] 初始化签名密钥对失败:', e.message);
    }
  }

  /**
   * 规范化构建待签名字符串（Canonical String）
   * 格式: deviceId|isActivated|status|type|isLifetime|expiresAt|issuedAt
   */
  public buildCanonicalString(payload: SignedLicensePayload): string {
    const dev = (payload.deviceId || '').trim().toLowerCase();
    const act = payload.isActivated ? 'true' : 'false';
    const sta = (payload.status || 'unactivated').trim().toLowerCase();
    const typ = (payload.type || '').trim().toLowerCase();
    const lft = payload.isLifetime ? 'true' : 'false';
    const exp = payload.expiresAt ? String(payload.expiresAt).trim() : '';
    const iss = String(payload.issuedAt || 0);

    return `${dev}|${act}|${sta}|${typ}|${lft}|${exp}|${iss}`;
  }

  /**
   * 用云端私钥对授权信息签名
   */
  public sign(payload: SignedLicensePayload): { signature: string; issuedAt: number } {
    const canonical = this.buildCanonicalString(payload);
    if (!this.privateKeyPem) {
      this.initKeys();
    }
    const signature = crypto.sign(null, Buffer.from(canonical, 'utf-8'), this.privateKeyPem);
    return {
      signature: signature.toString('base64'),
      issuedAt: payload.issuedAt
    };
  }

  /**
   * 验证签名有效性
   */
  public verify(payload: SignedLicensePayload, signatureBase64: string): boolean {
    if (!this.publicKeyPem || !signatureBase64) return false;
    try {
      const canonical = this.buildCanonicalString(payload);
      const sigBuf = Buffer.from(signatureBase64, 'base64');
      return crypto.verify(null, Buffer.from(canonical, 'utf-8'), this.publicKeyPem, sigBuf);
    } catch {
      return false;
    }
  }

  public getPublicKeyRawHex(): string {
    return this.publicKeyRawHex;
  }
}

export const licenseSignService = new LicenseSignService();
