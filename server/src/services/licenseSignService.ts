import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { CONFIG } from '../config/index.js';
import { REVOKED_LICENSE_PUBLIC_KEYS } from '../config/licenseTrust.js';

export interface SignedLicensePayload {
  deviceId: string;
  isActivated: boolean;
  status: string;
  type?: string;
  isLifetime?: boolean;
  expiresAt?: string | null;
  issuedAt: number;
}

// 注意：这里**不再**内置任何默认私钥常量。旧版内置的密钥与客户端固化公钥配对，
// 等于把签发能力随源码一起公开（任何拿到源码的人都能离线伪造终身授权）。
// 私钥只能来自部署方：磁盘上的 license_ed25519_private.pem 或 LICENSE_PRIVATE_KEY 环境变量。

export class LicenseSignService {
  private privateKeyPem: string = '';
  private publicKeyPem: string = '';
  private publicKeyRawHex: string = '';

  constructor() {
    this.initKeys();
    const privateKey = crypto.createPrivateKey(this.privateKeyPem);
    if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('授权签名必须使用 Ed25519 密钥');
    const derived = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
    if (derived !== this.publicKeyRawHex) throw new Error('授权私钥、公钥文件不匹配，请修复部署密钥');
    if (REVOKED_LICENSE_PUBLIC_KEYS.has(derived)) throw new Error('已公开的授权签名密钥已撤销，请执行配套密钥迁移');
    const expected = (process.env.LICENSE_PUBLIC_KEY_HEX || '').trim().toLowerCase();
    if (expected && derived !== expected) throw new Error('授权签名密钥与本次客户端发行公钥不匹配');
  }

  private initKeys(): void {
    const keyFile = path.join(CONFIG.DATA_DIR, 'license_ed25519_private.pem');
    const pubFile = path.join(CONFIG.DATA_DIR, 'license_ed25519_public.pem');
    const pubRawFile = path.join(CONFIG.DATA_DIR, 'license_ed25519_public.hex');

    try {
      // 1) 已部署实例：优先使用磁盘上的既有密钥对（保持既有签发/验签结果不变）
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

      // 2) 全新实例：只接受环境变量提供的私钥。
      //
      // **绝不内置任何默认私钥**。旧实现内置了一把与客户端固化公钥配对的私钥作为兜底，
      // 这意味着任何拿到源码的人都能离线签发 isLifetime=true 的授权并让客户端验签通过
      // —— 等于把整个卡密体系公开。私钥必须是部署方独有的秘密。
      const envKey = String(process.env.LICENSE_PRIVATE_KEY || '').trim();
      if (!envKey) {
        throw new Error(
          '缺少 LICENSE_PRIVATE_KEY：未找到已部署的密钥文件，且未提供环境变量私钥。' +
            '请设置 LICENSE_PRIVATE_KEY 为 Ed25519 私钥 PEM（或用安装脚本生成一对新密钥）。' +
            '出于安全考虑，服务端不再内置任何默认私钥。'
        );
      }

      const pubKeyObj = crypto.createPublicKey(envKey);
      const publicKeyPem = pubKeyObj.export({ type: 'spki', format: 'pem' }) as string;
      const der = pubKeyObj.export({ type: 'spki', format: 'der' });
      const pubRawHex = der.subarray(-32).toString('hex');

      this.privateKeyPem = envKey;
      this.publicKeyPem = publicKeyPem;
      this.publicKeyRawHex = pubRawHex;

      fs.writeFileSync(keyFile, this.privateKeyPem, { encoding: 'utf-8', mode: 0o600 });
      fs.writeFileSync(pubFile, this.publicKeyPem, 'utf-8');
      fs.writeFileSync(pubRawFile, this.publicKeyRawHex, 'utf-8');
      // 显式收紧私钥文件权限：writeFileSync 的 mode 只在新建时生效，
      // 若文件已存在（默认 umask 0644）需再 chmod 一次，避免私钥对其他用户可读。
      try {
        fs.chmodSync(keyFile, 0o600);
      } catch (e: any) {
        console.warn('[LicenseSignService] 未能收紧私钥文件权限（非致命，请检查部署权限）:', e?.message);
      }

      console.log(`[LicenseSignService] 签名密钥初始化成功，公钥指纹: ${this.publicKeyRawHex}`);
    } catch (e: any) {
      // fail-closed：密钥不可用必须让服务启动失败，而不是带着空私钥继续跑
      // （否则所有签发都会抛错，或更糟——回退到某个默认密钥）
      console.error('[LicenseSignService] 初始化签名密钥对失败:', e.message);
      throw e;
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
      // 不再回退到任何内置密钥：无可用私钥必须显式失败
      throw new Error('签名私钥不可用，无法签发授权（请检查 LICENSE_PRIVATE_KEY / 密钥文件）');
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
