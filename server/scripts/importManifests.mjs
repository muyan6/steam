#!/usr/bin/env node

/**
 * ManifestHub3 本地离线 20G 清单快速导入与统计工具
 * 
 * 用法:
 *   node scripts/importManifests.mjs                        # 扫描并统计当前服务端的本地清单库
 *   node scripts/importManifests.mjs /path/to/ManifestHub3  # 将外部 ManifestHub3 文件夹导入/软链接到服务端清单库
 *   node scripts/importManifests.mjs /path/to/ManifestHub3 --copy # 强制以文件复制方式导入
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.resolve(ROOT_DIR, 'data');
const MANIFESTS_DIR = path.resolve(DATA_DIR, 'manifests');

if (!fs.existsSync(MANIFESTS_DIR)) {
  fs.mkdirSync(MANIFESTS_DIR, { recursive: true });
}

const args = process.argv.slice(2);
const sourcePath = args.find((a) => !a.startsWith('--'));
const isCopy = args.includes('--copy');
const isStatsOnly = args.includes('--stats') || !sourcePath;

// 格式化文件大小
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// 统计目标目录下的清单文件
function inspectManifestsDir(dir) {
  let appDirsCount = 0;
  let manifestFilesCount = 0;
  let totalBytes = 0;
  let jsonFilesCount = 0;

  if (!fs.existsSync(dir)) {
    return { appDirsCount, manifestFilesCount, totalBytes, jsonFilesCount };
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/^\d+$/.test(entry.name)) {
        appDirsCount++;
        try {
          const subFiles = fs.readdirSync(fullPath);
          for (const sub of subFiles) {
            if (sub.endsWith('.manifest')) {
              manifestFilesCount++;
              totalBytes += fs.statSync(path.join(fullPath, sub)).size;
            } else if (sub.endsWith('.json')) {
              jsonFilesCount++;
            }
          }
        } catch {}
      }
    } else if (entry.isFile()) {
      if (entry.name.endsWith('.manifest')) {
        manifestFilesCount++;
        totalBytes += fs.statSync(fullPath).size;
      } else if (entry.name.endsWith('.json')) {
        jsonFilesCount++;
      }
    }
  }

  return { appDirsCount, manifestFilesCount, totalBytes, jsonFilesCount };
}

async function main() {
  console.log('==================================================================');
  console.log('   春风渡 (ChunFengDu) 20G 离线清单库管理与导入引擎   ');
  console.log('==================================================================');
  console.log(`[服务端清单根目录] ${MANIFESTS_DIR}`);

  if (isStatsOnly) {
    console.log('\n[正在扫描服务端本地清单库状态]...');
    const stats = inspectManifestsDir(MANIFESTS_DIR);
    console.log(`✓ 游戏专属目录 (AppID 子文件夹): ${stats.appDirsCount} 个`);
    console.log(`✓ 清单实体文件 (.manifest): ${stats.manifestFilesCount} 个`);
    console.log(`✓ 元数据映射文件 (.json): ${stats.jsonFilesCount} 个`);
    console.log(`✓ 本地清单总占用体积: ${formatBytes(stats.totalBytes)}`);

    if (stats.manifestFilesCount === 0) {
      console.log('\n💡 提示:');
      console.log('  当前服务端本地清单库为空。');
      console.log('  您可以将下载好的 20GB ManifestHub3 解压文件直接上传到:');
      console.log(`  👉 ${MANIFESTS_DIR}`);
      console.log('  或执行:');
      console.log('  👉 node scripts/importManifests.mjs /外部ManifestHub3解压路径');
    }
    return;
  }

  const resolvedSource = path.resolve(sourcePath);
  if (!fs.existsSync(resolvedSource)) {
    console.error(`[错误] 指定的源目录不存在: ${resolvedSource}`);
    process.exit(1);
  }

  console.log(`[导入源路径] ${resolvedSource}`);
  console.log(`[导入模式] ${isCopy ? '直接复制 (Copy)' : '秒级软链接 (Symlink)'}`);

  const sourceStats = inspectManifestsDir(resolvedSource);
  console.log(`[源目录检测] 发现 ${sourceStats.appDirsCount} 个游戏目录, ${sourceStats.manifestFilesCount} 个清单文件, 总计 ${formatBytes(sourceStats.totalBytes)}`);

  let linked = 0;
  let copied = 0;
  let errors = 0;

  const entries = fs.readdirSync(resolvedSource, { withFileTypes: true });
  for (const entry of entries) {
    const srcItem = path.join(resolvedSource, entry.name);
    const dstItem = path.join(MANIFESTS_DIR, entry.name);

    if (fs.existsSync(dstItem)) {
      continue; // 已存在则跳过
    }

    try {
      if (!isCopy) {
        // 创建软链接（秒级完成，不占用额外磁盘空间）
        fs.symlinkSync(srcItem, dstItem, entry.isDirectory() ? 'junction' : 'file');
        linked++;
      } else {
        if (entry.isDirectory()) {
          fs.cpSync(srcItem, dstItem, { recursive: true });
        } else {
          fs.copyFileSync(srcItem, dstItem);
        }
        copied++;
      }
    } catch (e) {
      errors++;
    }
  }

  console.log('\n======================== 导入完成 ========================');
  console.log(`✓ 成功软链接: ${linked} 项`);
  console.log(`✓ 成功物理复制: ${copied} 项`);
  if (errors > 0) {
    console.log(`⚠ 遇到错误: ${errors} 项（请检查文件权限）`);
  }

  const finalStats = inspectManifestsDir(MANIFESTS_DIR);
  console.log(`\n[服务端当前生效总量]`);
  console.log(`✓ 游戏目录: ${finalStats.appDirsCount} 款`);
  console.log(`✓ 实体清单: ${finalStats.manifestFilesCount} 个文件`);
  console.log(`✓ 总占用体积: ${formatBytes(finalStats.totalBytes)}`);
  console.log('✓ 服务端已无缝就绪，客户端发起下载请求时将直接以零延迟下发！');
}

main().catch((err) => {
  console.error('[导入异常]', err);
  process.exit(1);
});
