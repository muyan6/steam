import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveDataDir(): string {
  if (process.env.DATA_DIR && fs.existsSync(process.env.DATA_DIR)) {
    return process.env.DATA_DIR;
  }

  // 1. dist/config/../../data => server/data
  const serverData = path.resolve(__dirname, '../../data');
  if (fs.existsSync(serverData)) {
    return serverData;
  }

  // 2. src/config/../../data => server/data
  const srcData = path.resolve(__dirname, '../data');
  if (fs.existsSync(srcData)) {
    return srcData;
  }

  // 3. cwd/server/data
  const cwdServerData = path.resolve(process.cwd(), 'server/data');
  if (fs.existsSync(cwdServerData)) {
    return cwdServerData;
  }

  // 4. cwd/data
  const cwdData = path.resolve(process.cwd(), 'data');
  if (fs.existsSync(cwdData)) {
    return cwdData;
  }

  return serverData;
}

function requireSecret(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    console.error(`[配置错误] 缺少必需的环境变量 ${name}。`);
    console.error(`安全策略：服务端不再内置任何默认密钥。请在部署环境中设置：`);
    console.error(`  export ${name}=<随机强密钥>`);
    console.error(`推荐生成方式：node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`);
    process.exit(1);
  }
  return value.trim();
}

/**
 * 解析 TRUST_PROXY 环境变量，供 app.set('trust proxy', ...) 使用。
 * 未配置时为 false（直连部署，按 socket 地址取 IP）；
 * 反向代理部署必须配置，否则限流按反代 IP 计数（全站共享额度）且审计 IP 失真。
 * 支持值：true / 1（信任一级）、纯数字（信任 N 级）、loopback 或具体 IP/CIDR。
 */
function resolveTrustProxy(): boolean | number | string {
  const raw = process.env.TRUST_PROXY;
  if (!raw || !raw.trim()) return false;
  const v = raw.trim();
  if (v === 'true' || v === '1') return true;
  if (/^\d+$/.test(v)) return parseInt(v, 10);
  return v;
}

export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 1257,
  HOST: process.env.HOST || '0.0.0.0',
  DEFAULT_ADMIN_USER: process.env.ADMIN_USER || 'admin',
  // 仅用于首次初始化凭据文件；登录校验只走 PBKDF2 哈希，不存在密码回退
  DEFAULT_ADMIN_PASS: process.env.ADMIN_PASS || 'admin123',
  JWT_SECRET: requireSecret('JWT_SECRET'),
  TOKEN_EXPIRES_SECONDS: 7 * 24 * 3600, // 7天有效
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_TIME_MS: 15 * 60 * 1000, // 输错5次锁定15分钟
  DATA_DIR: resolveDataDir(),
  CORS_ORIGIN: process.env.CORS_ORIGIN || '',
  TRUST_PROXY: resolveTrustProxy(),
  // 未激活设备每日免费入库次数（可按游戏重复获取同一 AppID，不重复计数）
  FREE_DAILY_LIMIT: process.env.FREE_DAILY_LIMIT ? parseInt(process.env.FREE_DAILY_LIMIT, 10) || 2 : 2
};
