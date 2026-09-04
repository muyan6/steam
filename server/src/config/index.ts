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

export const CONFIG = {
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 1257,
  HOST: process.env.HOST || '0.0.0.0',
  ADMIN_SECRET: process.env.ADMIN_SECRET || 'steammaster_admin_8888',
  DEFAULT_ADMIN_USER: process.env.ADMIN_USER || 'admin',
  DEFAULT_ADMIN_PASS: process.env.ADMIN_PASS || 'admin123',
  JWT_SECRET: process.env.JWT_SECRET || 'steammaster_jwt_secret_key_2026',
  TOKEN_EXPIRES_SECONDS: 7 * 24 * 3600, // 7天有效
  MAX_LOGIN_ATTEMPTS: 5,
  LOCKOUT_TIME_MS: 15 * 60 * 1000, // 输错5次锁定15分钟
  DATA_DIR: resolveDataDir(),
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*'
};
