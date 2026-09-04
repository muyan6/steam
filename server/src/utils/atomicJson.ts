import fs from 'fs';
import path from 'path';

/**
 * 原子化写入 JSON 文件：先写临时文件再 rename 替换，
 * 避免进程崩溃/断电产生截断 JSON 导致数据静默丢失。
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw e;
  }
}

/**
 * 读取 JSON 文件；损坏时将原文件移入 .corrupt 备份后抛出错误，
 * 绝不静默返回默认值或清空数据。
 */
export function readJsonOrThrow<T>(filePath: string, label: string): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
  } catch (e) {
    const corruptPath = `${filePath}.corrupt`;
    try {
      if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, corruptPath);
      }
    } catch {}
    throw new Error(`${label} 数据文件损坏，已备份到 ${corruptPath}，请修复后重启服务: ${(e as Error).message}`);
  }
}

/**
 * 读取 JSON 文件（宽松模式，仅用于非关键数据），失败返回 fallback。
 */
export function readJsonSafe<T>(filePath: string, fallback: T): T {
  try {
    if (fs.existsSync(filePath)) {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
    }
  } catch {}
  return fallback;
}
