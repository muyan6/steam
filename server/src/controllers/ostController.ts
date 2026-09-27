import { Request, Response } from 'express';
import axios from 'axios';
import { pipeWithByteCap } from '../utils/streamCap.js';

/// OST 内核中转体积上限：Release 包约 28MB，512MB 是充裕上限
const MAX_OST_PROXY_BYTES = 512 * 1024 * 1024;

// OST 内核中转：客户端网络可能完全无法访问 GitHub（检测与下载双双失败），
// 服务器侧可达 GitHub，作为最终兜底回退。仅中转固定仓库的 release，
// tag/asset 严格白名单校验防止路径注入。

const OST_REPO = 'OpenSteam001/OpenSteamTool';
const isValidIdentifier = (s: string) => /^[\w.\-]{1,128}$/.test(s);

export const getLatestOstRelease = async (_req: Request, res: Response) => {
  try {
    const resp = await axios.get(`https://api.github.com/repos/${OST_REPO}/releases/latest`, {
      timeout: 10000,
      headers: { 'User-Agent': 'chunfengdu-server', Accept: 'application/vnd.github+json' }
    });
    const tag = resp.data?.tag_name;
    if (!tag || typeof tag !== 'string' || !isValidIdentifier(tag)) {
      return res.status(502).json({ success: false, message: '上游 GitHub 返回数据异常' });
    }
    const assets: any[] = Array.isArray(resp.data.assets) ? resp.data.assets : [];
    // 优先取体积小的 Release 包（Debug 包 28MB 且非分发用途）
    const picked =
      assets.find((a) => typeof a?.name === 'string' && a.name.includes('Release.zip') && !a.name.includes('Debug')) ||
      assets.find((a) => typeof a?.name === 'string' && a.name.endsWith('.zip')) ||
      null;
    const asset = picked?.name || null;
    // 透传 GitHub 提供的 sha256 摘要（形如 "sha256:<64hex>"），供客户端校验镜像内容，
    // 防止第三方镜像投递被替换的内核 DLL
    const digest =
      typeof picked?.digest === 'string' && /^sha256:[0-9a-fA-F]{64}$/.test(picked.digest)
        ? picked.digest.toLowerCase()
        : null;
    res.json({ success: true, tag, publishedAt: resp.data.published_at || null, asset, digest });
  } catch (e: any) {
    console.error('[OstController] 中转查询 GitHub 失败:', e.message);
    res.status(502).json({ success: false, message: '中转查询 GitHub 失败，请稍后重试' });
  }
};

export const downloadOstAsset = async (req: Request, res: Response) => {
  try {
    const tag = String(req.params.tag || '');
    const asset = String(req.params.asset || '');
    if (!isValidIdentifier(tag) || !isValidIdentifier(asset)) {
      return res.status(400).json({ success: false, message: '参数缺失或格式非法' });
    }
    const url = `https://github.com/${OST_REPO}/releases/download/${tag}/${asset}`;
    const upstream = await axios.get(url, {
      timeout: 120000,
      responseType: 'stream',
      maxRedirects: 5,
      headers: { 'User-Agent': 'chunfengdu-server' }
    });
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${asset}"`);
    // 带体积上限的流式转发，避免上游异常时本服务变成无界代理
    pipeWithByteCap(upstream.data, res, MAX_OST_PROXY_BYTES);
  } catch (e: any) {
    console.error('[OstController] 中转下载失败:', e.message);
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: '中转下载失败，请稍后重试' });
    } else {
      res.destroy();
    }
  }
};
