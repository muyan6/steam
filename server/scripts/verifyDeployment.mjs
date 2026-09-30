#!/usr/bin/env node
// Read-only preflight for routine server updates. Key rotation is a separate deployment.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

const serverDir = path.resolve(process.argv[2] || '.');
const envPath = path.join(serverDir, '.env');
if (!fs.existsSync(envPath)) throw new Error('缺少 server/.env');
const env = { ...dotenv.parse(fs.readFileSync(envPath)), ...process.env };
if (!env.JWT_SECRET) throw new Error('缺少 JWT_SECRET');
const dataDir = path.resolve(serverDir, env.DATA_DIR || 'data');
const read = name => fs.readFileSync(path.join(dataDir, name), 'utf8').trim();
const privateKey = crypto.createPrivateKey(read('license_ed25519_private.pem'));
if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('会员签名私钥不是 Ed25519');
const publicKey = crypto.createPublicKey(privateKey);
const rawHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
const publicPemHex = crypto.createPublicKey(read('license_ed25519_public.pem'))
  .export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
if (rawHex !== publicPemHex || rawHex !== read('license_ed25519_public.hex').toLowerCase()) {
  throw new Error('会员签名私钥与公钥文件不匹配；本次未替换任何服务文件');
}
if (rawHex === '34c2a8ab59b1d134bd32091c62525aa392c6bada97d4480f9d21abf0b9eae5a4') {
  throw new Error('旧签名密钥已撤销；必须先完成配套密钥迁移');
}
for (const expected of [env.LICENSE_PUBLIC_KEY_HEX, env.EXPECTED_LICENSE_PUBLIC_KEY_HEX]) {
  if (expected && rawHex !== expected.trim().toLowerCase()) {
    throw new Error('服务端签名密钥与配置或本次客户端公钥不匹配；本次未替换任何服务文件');
  }
}
console.log(`部署密钥校验通过：${rawHex}`);
