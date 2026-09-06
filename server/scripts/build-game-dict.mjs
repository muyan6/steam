// 游戏字典二进制编译脚本：把 server/data/steam_all_games.json + chinese_games_cache.json
// 编译为 src-tauri/data/game_dict.bin（include_bytes! 嵌入 app.exe 的检索基线）。
// 格式规范（与 server/src/utils/gameDictCodec.ts 及 src-tauri/src/manifests.rs 三方一致）：
//   Header: 魔数 'C''F''G''D' + 版本 u8=1 + 条目数 u32 LE
//   条目（按 appId 升序去重）: varint(appId 与前一条的增量) + u16 LE 原名长度 + 原名 UTF-8
//             + u16 LE 中文名长度 + 中文名 UTF-8（可为 0 长）
//   varint = 无符号 LEB128（7 bit 一组，最高位为续位标志）
// 文件整体 SHA256 即字典版本号，客户端据此判断是否需要增量更新。
// 运行：node server/scripts/build-game-dict.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const outPath = path.join(__dirname, '..', '..', 'src-tauri', 'data', 'game_dict.bin');

function readJsonArray(file) {
  const p = path.join(dataDir, file);
  if (!fs.existsSync(p)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn(`[build-game-dict] ${file} 解析失败，已忽略: ${e.message}`);
    return [];
  }
}

function writeVarint(buf, value) {
  let v = value;
  while (v >= 0x80) {
    buf.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  buf.push(v);
}

const allGames = readJsonArray('steam_all_games.json');
const zhGames = readJsonArray('chinese_games_cache.json');
const zhMap = new Map();
for (const g of zhGames) {
  const appId = Number(g?.appId);
  const nameZh = String(g?.nameZh || g?.name || '').trim();
  if (appId > 0 && nameZh) zhMap.set(appId, nameZh);
}

const merged = new Map();
for (const g of allGames) {
  const appId = Number(g?.appId ?? g?.appid);
  const name = String(g?.name || '').trim();
  if (appId > 0 && name) merged.set(appId, name);
}
// 中文缓存中的 AppID 若不在全量库（较新的应用），也并入字典
for (const [appId, nameZh] of zhMap) {
  if (!merged.has(appId)) merged.set(appId, nameZh);
}

const entries = [...merged.entries()]
  .map(([appId, name]) => ({ appId, name, nameZh: zhMap.get(appId) || '' }))
  .sort((a, b) => a.appId - b.appId);

const body = [];
let prev = 0;
for (const e of entries) {
  const delta = e.appId - prev;
  if (delta <= 0) throw new Error(`appId 非升序: ${prev} -> ${e.appId}`);
  writeVarint(body, delta);
  prev = e.appId;
  const nameBytes = Buffer.from(e.name, 'utf-8');
  const zhBytes = Buffer.from(e.nameZh, 'utf-8');
  if (nameBytes.length > 0xffff || zhBytes.length > 0xffff) {
    console.warn(`[build-game-dict] appId ${e.appId} 名称过长，已截断`);
  }
  const nameCut = nameBytes.subarray(0, 0xffff);
  const zhCut = zhBytes.subarray(0, 0xffff);
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(nameCut.length, 0);
  body.push(...lenBuf, ...nameCut);
  lenBuf.writeUInt16LE(zhCut.length, 0);
  body.push(...lenBuf, ...zhCut);
}

const header = Buffer.alloc(9);
header.write('CFGD', 0, 'latin1');
header.writeUInt8(1, 4);
header.writeUInt32LE(entries.length, 5);

const payload = Buffer.concat([header, Buffer.from(body)]);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, payload);

const sha256 = crypto.createHash('sha256').update(payload).digest('hex');
const zhCount = entries.filter((e) => e.nameZh).length;
console.log(`[build-game-dict] 已生成 ${outPath}`);
console.log(`[build-game-dict] 条目 ${entries.length}（含中文名 ${zhCount}），体积 ${(payload.length / 1024 / 1024).toFixed(2)} MB，SHA256 ${sha256}`);
