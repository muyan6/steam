import { Request, Response } from 'express';
import axios from 'axios';

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
    const asset =
      assets.find((a) => typeof a?.name === 'string' && a.name.includes('Release.zip') && !a.name.includes('Debug'))?.name ||
      assets.find((a) => typeof a?.name === 'string' && a.name.endsWith('.zip'))?.name ||
      null;
    res.json({ success: true, tag, publishedAt: resp.data.published_at || null, asset });
  } catch (e: any) {
    res.status(502).json({ success: false, message: `中转查询 GitHub 失败: ${e.message}` });
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
    upstream.data.pipe(res);
  } catch (e: any) {
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: `中转下载失败: ${e.message}` });
    } else {
      res.end();
    }
  }
};
