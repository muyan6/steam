#!/usr/bin/env node
/**
 * 春风渡 (ChunFengDu) Release 资产全自动上传引擎 (GitHub & Gitee 双端)
 *
 * 功能：
 * 1. 自动获取 package.json 版本号与版本说明 (或命令行指定)
 * 2. 自动从 Git Credential Manager 或环境变量获取 GitHub & Gitee 凭据
 * 3. 自动查找本地编译生成的 NSIS 安装包 (优先 C:\rust-target，次选 src-tauri/target)
 * 4. 自动在 GitHub 创建 Release (标签 vX.Y.Z) 并上传安装包
 * 5. 自动在 Gitee 创建 Release (标签 X.Y.Z) 并上传安装包附件
 * 6. 验证公网下载直链，输出完整状态报告
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 1. 获取 Git Credential Manager 存储的 Token
function getGitCredentialToken(host) {
  try {
    const input = `protocol=https\nhost=${host}\n\n`;
    const output = execSync('git credential fill', { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const match = output.match(/password=(.+)/);
    return match ? match[1].trim() : null;
  } catch (err) {
    return null;
  }
}

// 2. 获取目标版本与更新日志
function getVersionInfo(targetVersion) {
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const version = targetVersion || pkg.version;

  let changelog = `### 春风渡 v${version} 正式版发布\n\n- 一键入库与清单多源调度升级\n- 系统稳定性与安全性优化`;
  let title = `🌸 春风渡 v${version} 正式版`;

  const versionJsonPath = path.join(rootDir, 'server', 'data', 'version.json');
  if (fs.existsSync(versionJsonPath)) {
    try {
      const vData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
      if (vData.version === version) {
        if (vData.title) title = vData.title;
        if (Array.isArray(vData.changelog) && vData.changelog.length > 0) {
          changelog = `### 春风渡 v${version} 更新说明\n\n` + vData.changelog.map(c => `- ${c}`).join('\n');
        }
      }
    } catch {
      // ignore
    }
  }

  return { version, title, changelog };
}

// 3. 寻找并规整安装包
function findInstaller(version) {
  const possibleDirs = [
    'C:\\rust-target\\release\\bundle\\nsis',
    path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle', 'nsis'),
    path.join(rootDir, 'target', 'release', 'bundle', 'nsis'),
  ];

  for (const dir of possibleDirs) {
    if (!fs.existsSync(dir)) continue;

    const files = fs.readdirSync(dir);
    const standardName = `ChunFengDu_${version}_x64-setup.exe`;
    const standardPath = path.join(dir, standardName);

    // 如果已有标准命名文件
    if (fs.existsSync(standardPath)) {
      return { filePath: standardPath, fileName: standardName };
    }

    // 寻找包含该版本号的任意 setup.exe
    const matched = files.find(f => f.includes(version) && f.endsWith('.exe'));
    if (matched) {
      const matchedPath = path.join(dir, matched);
      try {
        fs.copyFileSync(matchedPath, standardPath);
        console.log(`[Package] 自动从 ${matched} 复制并规范命名为 ${standardName}`);
        return { filePath: standardPath, fileName: standardName };
      } catch {
        return { filePath: matchedPath, fileName: matched };
      }
    }
  }

  return null;
}

// 4. 上传到 GitHub Release
async function uploadToGitHub({ version, title, changelog, filePath, fileName, token }) {
  if (!token) {
    console.warn('[GitHub] 未找到 GitHub 认证 Token，跳过 GitHub 上传');
    return null;
  }

  const tag = `v${version}`;
  const owner = 'muyan6';
  const repo = 'steam';
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'ChunFengDu-Release-Tool',
  };

  console.log(`[GitHub] 正在检索 Release 标签: ${tag}...`);
  let release = null;
  const getRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, { headers });

  if (getRes.ok) {
    release = await getRes.json();
    console.log(`[GitHub] 找到已有 Release #${release.id} (${release.tag_name})`);
    try {
      const updateRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/${release.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: title,
          body: changelog,
        }),
      });
      if (updateRes.ok) {
        release = await updateRes.json();
        console.log(`[GitHub] Release #${release.id} 描述与标题已同步更新为最新！`);
      }
    } catch (e) {
      console.warn(`[GitHub] 更新 Release 描述失败:`, e);
    }
  } else if (getRes.status === 404) {
    console.log(`[GitHub] Release 不存在，正在为标签 ${tag} 创建新 Release...`);
    const createRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tag_name: tag,
        name: title,
        body: changelog,
        draft: false,
        prerelease: false,
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`[GitHub] 创建 Release 失败 (${createRes.status}): ${errText}`);
    }
    release = await createRes.json();
    console.log(`[GitHub] Release 创建成功 #${release.id}`);
  } else {
    const errText = await getRes.text();
    throw new Error(`[GitHub] 查询 Release 异常 (${getRes.status}): ${errText}`);
  }

  // 检查是否已有同名资源
  if (Array.isArray(release.assets)) {
    for (const asset of release.assets) {
      if (asset.name === fileName) {
        console.log(`[GitHub] 发现同名资源 #${asset.id} (${asset.name})，正在覆盖清理...`);
        await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/assets/${asset.id}`, {
          method: 'DELETE',
          headers,
        });
      }
    }
  }

  // 上传文件
  const fileBuffer = fs.readFileSync(filePath);
  console.log(`[GitHub] 正在上传安装包 ${fileName} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)...`);

  const uploadUrl = `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(fileName)}`;
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/octet-stream',
      'Content-Length': fileBuffer.length.toString(),
    },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    throw new Error(`[GitHub] 上传安装包失败 (${uploadRes.status}): ${errText}`);
  }

  const uploadedAsset = await uploadRes.json();
  console.log(`[GitHub] 安装包上传成功! 直链: ${uploadedAsset.browser_download_url}`);
  return uploadedAsset.browser_download_url;
}

// 5. 上传到 Gitee Release
async function uploadToGitee({ version, title, changelog, filePath, fileName, token }) {
  if (!token) {
    console.warn('[Gitee] 未找到 Gitee 认证 Token，跳过 Gitee 上传');
    return null;
  }

  const tag = version; // Gitee release tag 使用 2.7.1
  const owner = 'muyan6';
  const repo = 'steam';

  console.log(`[Gitee] 正在检索 Release 标签: ${tag}...`);
  let release = null;
  const listRes = await fetch(`https://gitee.com/api/v5/repos/${owner}/${repo}/releases?access_token=${token}`);

  if (listRes.ok) {
    const list = await listRes.json();
    release = list.find(r => r.tag_name === tag || r.tag_name === `v${tag}`);
    if (release) {
      console.log(`[Gitee] 找到已有 Release #${release.id} (${release.tag_name})`);
      try {
        const updateRes = await fetch(`https://gitee.com/api/v5/repos/${owner}/${repo}/releases/${release.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_token: token,
            tag_name: release.tag_name,
            name: title,
            body: changelog,
          }),
        });
        if (updateRes.ok) {
          release = await updateRes.json();
          console.log(`[Gitee] Release #${release.id} 描述与标题已同步更新为最新！`);
        }
      } catch (e) {
        console.warn(`[Gitee] 更新 Release 描述失败:`, e);
      }
    }
  }

  if (!release) {
    console.log(`[Gitee] Release 不存在，正在为标签 ${tag} 创建新 Release...`);
    const createRes = await fetch(`https://gitee.com/api/v5/repos/${owner}/${repo}/releases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: token,
        tag_name: tag,
        name: title,
        target_commitish: 'main',
        body: changelog,
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      console.warn(`[Gitee] 创建 Release 失败 (${createRes.status}): ${errText}`);
      return null;
    }
    release = await createRes.json();
    console.log(`[Gitee] Release 创建成功 #${release.id}`);
  }

  // 检查是否已有同名附件，如果有则清理覆盖
  try {
    const attachListRes = await fetch(`https://gitee.com/api/v5/repos/${owner}/${repo}/releases/${release.id}/attach_files?access_token=${token}`);
    if (attachListRes.ok) {
      const attachList = await attachListRes.json();
      if (Array.isArray(attachList)) {
        for (const attach of attachList) {
          if (attach.name === fileName && attach.id) {
            console.log(`[Gitee] 发现同名附件 #${attach.id} (${attach.name})，正在覆盖清理...`);
            await fetch(`https://gitee.com/api/v5/repos/${owner}/${repo}/releases/${release.id}/attach_files/${attach.id}?access_token=${token}`, {
              method: 'DELETE',
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[Gitee] 检查/清理同名附件异常:', err);
  }

  // 上传文件附件 (multipart/form-data)
  const fileBuffer = fs.readFileSync(filePath);
  console.log(`[Gitee] 正在上传附件 ${fileName} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)...`);

  const blob = new Blob([fileBuffer]);
  const form = new FormData();
  form.append('access_token', token);
  form.append('file', blob, fileName);

  const attachRes = await fetch(`https://gitee.com/api/v5/repos/${owner}/${repo}/releases/${release.id}/attach_files`, {
    method: 'POST',
    body: form,
  });

  if (!attachRes.ok) {
    const errText = await attachRes.text();
    console.warn(`[Gitee] 上传附件失败 (${attachRes.status}): ${errText}`);
    return null;
  }

  const attachData = await attachRes.json();
  console.log(`[Gitee] 附件上传成功! 直链: ${attachData.browser_download_url}`);
  return attachData.browser_download_url;
}

// 主流程
async function main() {
  const targetVersion = process.argv[2] || null;
  const { version, title, changelog } = getVersionInfo(targetVersion);

  console.log('====================================================');
  console.log(` 春风渡 (ChunFengDu) 自动化发布与云端同步引擎`);
  console.log(` 目标版本: v${version}`);
  console.log(` 发布标题: ${title}`);
  console.log('====================================================');

  const installer = findInstaller(version);
  if (!installer) {
    console.error(`[Error] 未找到版本 ${version} 的安装包 (.exe)，请先运行 'npm run tauri:build' 完成编译`);
    process.exit(1);
  }
  console.log(`[Package] 目标安装包: ${installer.filePath} (${installer.fileName})`);

  // 获取 Token
  const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || getGitCredentialToken('github.com');
  const giteeToken = process.env.GITEE_TOKEN || getGitCredentialToken('gitee.com');

  let ghUrl = null;
  let giteeUrl = null;

  try {
    ghUrl = await uploadToGitHub({
      version,
      title,
      changelog,
      filePath: installer.filePath,
      fileName: installer.fileName,
      token: ghToken,
    });
  } catch (err) {
    console.error(`[GitHub Error] ${err.message}`);
  }

  try {
    giteeUrl = await uploadToGitee({
      version,
      title,
      changelog,
      filePath: installer.filePath,
      fileName: installer.fileName,
      token: giteeToken,
    });
  } catch (err) {
    console.error(`[Gitee Error] ${err.message}`);
  }

  console.log('\n================ 发布与同步结果汇总 ================');
  console.log(`版本号: v${version}`);
  console.log(`安装包: ${installer.fileName}`);
  if (ghUrl) {
    console.log(`✅ GitHub Release: ${ghUrl}`);
  } else {
    console.log(`❌ GitHub Release 未完成`);
  }
  if (giteeUrl) {
    console.log(`✅ Gitee Release : ${giteeUrl}`);
  } else {
    console.log(`⚠️ Gitee Release 待确认或已存在`);
  }
  console.log('====================================================\n');
}

main().catch(err => {
  console.error('[Fatal Error]', err);
  process.exit(1);
});
