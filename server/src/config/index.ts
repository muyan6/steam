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

export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 1257,
  HOST: process.env.HOST || '0.0.0.0',
  // 安全策略：管理密钥/JWT 密钥必须显式配置，无任何代码内默认值
  ADMIN_SECRET: requireSecret('ADMIN_SECRET'),
  DEFAULT_ADMIN_USER: process.env.ADMIN_USER || 'admin',
  // 仅用于首次初始化凭据文件；登录校验只走 PBKDF2 哈希，不存在密码回退
  DEFAULT_ADMIN_PASS: process.env.ADMIN_PASS || 'admin123',
  JWT_SECRET: requireSecret('JWT_SECRET'),
  TOKEN_EXPIRES_SECONDS: 7 * 24 * 3600, // 7天有效
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_TIME_MS: 15 * 60 * 1000, // 输错5次锁定15分钟
  DATA_DIR: resolveDataDir(),
  CORS_ORIGIN: process.env.CORS_ORIGIN || ''
};
