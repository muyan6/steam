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
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  HOST: process.env.HOST || '0.0.0.0',
  ADMIN_SECRET: process.env.ADMIN_SECRET || 'steammaster_admin_8888',
  DATA_DIR: resolveDataDir(),
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*'
};
