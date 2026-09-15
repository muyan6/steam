import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

/**
 * 原子化写入 JSON 文件：先写临时文件再 rename 替换，
 * 避免进程崩溃/断电产生截断 JSON 导致数据静默丢失。
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  writeStringAtomic(filePath, JSON.stringify(data, null, 2));
}

/**
 * 生成临时文件名。
 * 追加随机后缀：仅用 pid + Date.now() 时，同一毫秒内的并发写（或多进程/集群）
 * 会撞名并互相覆盖临时文件，进而 rename 出损坏内容。
 */
function buildTmpPath(dir: string, filePath: string): string {
  return path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`
  );
}

/**
 * 原子化写入文本文件（供超大库紧凑序列化使用：
 * 直接接收最终字符串，避免为 30 万条密钥额外构建一份对象副本）。
 * 注意：同步版本会阻塞事件循环，仅用于启动期/小文件；大库请用 Async 版本。
 */
export function writeStringAtomic(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = buildTmpPath(dir, filePath);
  try {
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch (e) {
    try { fs.unlinkSync(tmpPath); } catch {}
    throw e;
  }
}

/**
 * 异步原子写文本：18MB 密钥库 / 8MB 全量库 / 50 万条中文缓存走这里，
 * 落盘期间不再阻塞事件循环处理其它请求。
 */
export async function writeStringAtomicAsync(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tmpPath = buildTmpPath(dir, filePath);
  try {
    await fs.promises.writeFile(tmpPath, content, 'utf-8');
    await fs.promises.rename(tmpPath, filePath);
  } catch (e) {
    try { await fs.promises.unlink(tmpPath); } catch {}
    throw e;
  }
}

/**
 * 异步原子写 JSON（紧凑格式，避免为几十万条数据再加一份缩进膨胀）。
 */
export async function writeJsonAtomicAsync(filePath: string, data: unknown): Promise<void> {
  await writeStringAtomicAsync(filePath, JSON.stringify(data));
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
