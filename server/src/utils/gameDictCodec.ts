// 游戏字典二进制编解码器（与服务端 scripts/build-game-dict.mjs、Rust 客户端
// src-tauri/src/manifests.rs 三方保持字节级一致）。
//
// 格式规范（CFGD v1）：
//   Header（9 字节）: 魔数 'C''F''G''D' + 版本 u8=1 + 条目数 u32 LE
//   条目（按 appId 升序去重）:
//     varint(appId 与前一条的增量) + u16 LE 原名长度 + 原名 UTF-8
//     + u16 LE 中文名长度 + 中文名 UTF-8（可为 0 长）
//   varint = 无符号 LEB128（7 bit 一组，最高位为续位标志）
// 文件整体 SHA256 即字典版本号，客户端据此判断是否需要增量更新。

import crypto from 'crypto';

/** 字典魔数 'CFGD'（latin1 单字节编码） */
const DICT_MAGIC = 'CFGD';
/** 当前字典格式版本 */
const DICT_VERSION = 1;
/** 头部总长度：4 魔数 + 1 版本 + 4 条目数 */
const HEADER_SIZE = 9;

/** 单条名称 UTF-8 编码后的最大字节数（u16 LE 长度上限，超出截断） */
const MAX_NAME_BYTES = 0xffff;

export interface DictSourceGame {
  appId: number;
  name: string;
}

export interface DictSourceZhGame {
  appId: number;
  name: string;
  nameZh?: string;
}

export interface DictEntry {
  appId: number;
  name: string;
  nameZh: string;
}

/** 无符号 LEB128 varint 编码为 Buffer（7 bit 一组，最高位为续位标志） */
function encodeVarint(value: number): Buffer {
  if (!Number.isInteger(value) || value <= 0 || value > 0xffffffff) {
    throw new Error(`游戏字典 varint 数值非法: ${value}`);
  }
  const out: number[] = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
  return Buffer.from(out);
}

/**
 * 把全量游戏库与中文缓存合并并编译为 CFGD v1 二进制字典。
 * 合并规则与 build-game-dict.mjs 完全一致：
 *  - 全量库按 appId 去重（后写覆盖前写）；
 *  - 中文名来自中文缓存 nameZh（缺失时回退原名）；
 *  - 中文缓存中存在而全量库缺失的 AppID（较新应用）也并入字典。
 */
export function buildGameDictBinary(allGames: DictSourceGame[], zhGames: DictSourceZhGame[]): Buffer {
  // 中文名映射表：appId -> nameZh（nameZh 缺失回退原名，去空白）
  const zhMap = new Map<number, string>();
  for (const g of zhGames) {
    const appId = Number(g?.appId);
    const nameZh = String(g?.nameZh || g?.name || '').trim();
    if (appId > 0 && nameZh) zhMap.set(appId, nameZh);
  }

  // 合并主表：appId -> 原名
  const merged = new Map<number, string>();
  for (const g of allGames) {
    const appId = Number((g as any)?.appId ?? (g as any)?.appid);
    const name = String(g?.name || '').trim();
    if (appId > 0 && name) merged.set(appId, name);
  }
  // 中文缓存中的 AppID 若不在全量库（较新的应用），也并入字典
  for (const [appId, nameZh] of zhMap) {
    if (!merged.has(appId)) merged.set(appId, nameZh);
  }

  // 展开为条目并按 appId 升序排序（varint delta 编码要求严格递增）
  const entries: DictEntry[] = [...merged.entries()]
    .map(([appId, name]) => ({ appId, name, nameZh: zhMap.get(appId) || '' }))
    .sort((a, b) => a.appId - b.appId);

  // 编码条目体：按 Buffer 分块收集，避免用 number[] + push(...bytes) 展开——
  // 单个名称最大 65535 字节，展开传参恰好触及 V8 参数上限，且 number[] 会先放大成
  // 数千万个元素再复制进 Buffer，内存与耗时都不必要
  const chunks: Buffer[] = [];
  let prev = 0;
  for (const e of entries) {
    const delta = e.appId - prev;
    if (delta <= 0) throw new Error(`游戏字典 appId 非升序: ${prev} -> ${e.appId}`);
    chunks.push(encodeVarint(delta));
    prev = e.appId;

    const nameBytes = Buffer.from(e.name, 'utf-8');
    const zhBytes = Buffer.from(e.nameZh, 'utf-8');
    if (nameBytes.length > MAX_NAME_BYTES || zhBytes.length > MAX_NAME_BYTES) {
      console.warn(`[gameDictCodec] appId ${e.appId} 名称过长，已截断`);
    }
    const nameCut = nameBytes.subarray(0, MAX_NAME_BYTES);
    const zhCut = zhBytes.subarray(0, MAX_NAME_BYTES);
    // 严格保持字节序：u16 原名长度 + 原名 + u16 中文长度 + 中文
    const nameLen = Buffer.alloc(2);
    nameLen.writeUInt16LE(nameCut.length, 0);
    const zhLen = Buffer.alloc(2);
    zhLen.writeUInt16LE(zhCut.length, 0);
    chunks.push(nameLen, nameCut, zhLen, zhCut);
  }

  // 头部：'CFGD' + 版本 1 + 条目数 u32 LE
  const header = Buffer.alloc(HEADER_SIZE);
  header.write(DICT_MAGIC, 0, 'latin1');
  header.writeUInt8(DICT_VERSION, 4);
  header.writeUInt32LE(entries.length, 5);

  return Buffer.concat([header, ...chunks]);
}

/**
 * 解码 CFGD v1 二进制字典（用于校验与自检）。
 * 遇到魔数/版本不符或数据截断立即抛错，避免静默产出残缺数据。
 */
export function parseGameDictBinary(buf: Buffer): DictEntry[] {
  if (!buf || buf.length < HEADER_SIZE) {
    throw new Error('游戏字典数据过短，头部不完整');
  }
  if (buf.toString('latin1', 0, 4) !== DICT_MAGIC) {
    throw new Error('游戏字典魔数不正确（期望 CFGD）');
  }
  const version = buf.readUInt8(4);
  if (version !== DICT_VERSION) {
    throw new Error(`不支持的字典版本: ${version}`);
  }
  const count = buf.readUInt32LE(5);

  const entries: DictEntry[] = [];
  let offset = HEADER_SIZE;
  let appId = 0;
  for (let i = 0; i < count; i++) {
    // varint 增量解码
    let delta = 0;
    let shift = 0;
    for (;;) {
      if (offset >= buf.length) throw new Error('游戏字典数据截断（varint）');
      const b = buf.readUInt8(offset++);
      delta |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) break;
      shift += 7;
      if (shift > 35) throw new Error('游戏字典 varint 编码非法（超长）');
    }
    appId += delta;

    const readString = (): string => {
      if (offset + 2 > buf.length) throw new Error('游戏字典数据截断（字符串长度）');
      const len = buf.readUInt16LE(offset);
      offset += 2;
      if (offset + len > buf.length) throw new Error('游戏字典数据截断（字符串内容）');
      const s = buf.toString('utf-8', offset, offset + len);
      offset += len;
      return s;
    };
    const name = readString();
    const nameZh = readString();
    entries.push({ appId, name, nameZh });
  }

  return entries;
}

/** 计算字典二进制的 SHA256（即客户端版本号） */
export function hashGameDictBinary(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
