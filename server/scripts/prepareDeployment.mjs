#!/usr/bin/env node
// 部署前初始化与显式迁移。秘密只写入本地 .env/data，绝不写进源码或输出日志。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(serverRoot, '.env');
const diskEnv = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};
const env = { ...diskEnv, ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== '')) };
const dataDir = path.resolve(env.DATA_DIR || path.join(serverRoot, 'data'));
fs.mkdirSync(dataDir, { recursive: true });
const revoked = '34c2a8ab59b1d134bd32091c62525aa392c6bada97d4480f9d21abf0b9eae5a4';
const keyFile = path.join(dataDir, 'license_ed25519_private.pem');
const rotate = process.argv.includes('--rotate-signing-key');
const syncClient = process.argv.includes('--sync-client-public-key');
let privatePem = !rotate && fs.existsSync(keyFile) ? fs.readFileSync(keyFile, 'utf8') : (!rotate && env.LICENSE_PRIVATE_KEY);
if (!privatePem) privatePem = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
const privateKey = crypto.createPrivateKey(privatePem);
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('授权签名必须使用 Ed25519 密钥');
const publicKey = crypto.createPublicKey(privateKey);
const publicHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
if (publicHex === revoked) throw new Error('现有签名密钥已撤销。请配套发布新客户端，并显式执行 --rotate-signing-key --sync-client-public-key');
const clientSource = path.resolve(serverRoot, '../src-tauri/src/license_verify.rs');
if (syncClient) {
  if (!fs.existsSync(clientSource)) throw new Error('需要完整源码 checkout 才能同步客户端信任公钥');
  const source = fs.readFileSync(clientSource, 'utf8');
  fs.writeFileSync(clientSource, source.replace(/(pub const DEFAULT_PUBKEY_HEX: &str = ")[0-9a-f]+(";)/, `$1${publicHex}$2`), 'utf8');
}
if (rotate && fs.existsSync(keyFile)) fs.copyFileSync(keyFile, `${keyFile}.previous`);
fs.writeFileSync(keyFile, privatePem, { mode: 0o600 });
try { fs.chmodSync(keyFile, 0o600); } catch {}
fs.writeFileSync(path.join(dataDir, 'license_ed25519_public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
fs.writeFileSync(path.join(dataDir, 'license_ed25519_public.hex'), publicHex);
const updates = { JWT_SECRET: env.JWT_SECRET || crypto.randomBytes(48).toString('hex'), LICENSE_PUBLIC_KEY_HEX: publicHex };
const credFile = path.join(dataDir, 'admin_credentials.json');
if (fs.existsSync(credFile)) {
  const creds = JSON.parse(fs.readFileSync(credFile, 'utf8'));
  const legacyHash = crypto.pbkdf2Sync('admin123', creds.salt, creds.pbkdf2Iterations || 10000, 64, 'sha512').toString('hex');
  if (legacyHash === creds.passwordHash) {
    updates.ADMIN_PASS = env.ADMIN_PASS || crypto.randomBytes(24).toString('base64url');
    const salt = crypto.randomBytes(16).toString('hex');
    const next = { ...creds, salt, passwordHash: crypto.pbkdf2Sync(updates.ADMIN_PASS, salt, 210000, 64, 'sha512').toString('hex'), pbkdf2Iterations: 210000, tokenVersion: (creds.tokenVersion || 1) + 1, updatedAt: new Date().toISOString() };
    fs.writeFileSync(`${credFile}.migration.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(`${credFile}.migration.tmp`, credFile);
    console.log('已替换仓库遗留的管理员初始凭据，并撤销旧会话；初始密码保存在 server/.env。');
  }
}
let envText = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
for (const [key, value] of Object.entries(updates)) {
  const line = `${key}=${JSON.stringify(value)}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  envText = pattern.test(envText) ? envText.replace(pattern, line) : `${envText.trimEnd()}\n${line}\n`;
}
fs.writeFileSync(envPath, envText.trimStart(), { mode: 0o600 });
try { fs.chmodSync(envPath, 0o600); } catch {}
console.log(`部署配置就绪；公开公钥指纹：${publicHex}`);
if (fs.existsSync(clientSource) && !fs.readFileSync(clientSource, 'utf8').includes(publicHex)) {
  console.log('当前客户端源码与此实例密钥不同；自部署实例须同步客户端公钥并重新构建客户端。');
}
