import { Request, Response } from 'express';
import fs from 'fs';
import { manifestService } from '../services/manifestService.js';

export const getManifestsForApp = async (req: Request, res: Response) => {
  try {
    const rawAppId = Array.isArray(req.params.appId) ? req.params.appId[0] : req.params.appId;
    const appId = parseInt(rawAppId, 10);
    if (isNaN(appId)) {
      return res.status(400).json({ success: false, message: '无效的 AppID' });
    }

    let dlcs: number[] = [];
    if (req.query.dlcs) {
      if (typeof req.query.dlcs === 'string') {
        dlcs = req.query.dlcs.split(',').map((id) => parseInt(id.trim(), 10)).filter((n) => !isNaN(n));
      }
    }

    const result = await manifestService.getManifestsForApp(appId, dlcs);
    res.json(result);
  } catch (e) {
    console.error('[ManifestController] 获取清单列表异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

export const downloadManifestFile = async (req: Request, res: Response) => {
  try {
    const depotId = Array.isArray(req.params.depotId) ? req.params.depotId[0] : req.params.depotId;
    const manifestId = Array.isArray(req.params.manifestId) ? req.params.manifestId[0] : req.params.manifestId;

    if (!depotId || !manifestId || !/^\d+$/.test(depotId) || !/^\d+$/.test(manifestId)) {
      return res.status(400).json({ success: false, message: '参数缺失或格式非法' });
    }

    const rawAppId = req.query.appId ? (Array.isArray(req.query.appId) ? req.query.appId[0] : req.query.appId) : undefined;
    const appId = rawAppId ? parseInt(String(rawAppId), 10) : undefined;

    let filePath = manifestService.getLocalManifestFilePath(depotId, manifestId, appId);
    if (!filePath || !fs.existsSync(filePath)) {
      // 本地无缓存，尝试从 ManifestHub3 镜像拉取并沉淀在本地 server/data/manifests/ 目录
      filePath = await manifestService.ensureManifestCached(depotId, manifestId, appId);
    }

    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '未找到该清单文件缓存且回源拉取失败' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${depotId}_${manifestId}.manifest"`);
    // 文件流错误与客户端中途断开都必须显式销毁，防止读流句柄泄漏
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('[ManifestController] 清单文件读取流出错:', err.message);
      res.destroy();
    });
    res.on('close', () => {
      // 客户端中止下载时取消文件流
      stream.destroy();
    });
    stream.pipe(res);
  } catch (e) {
    console.error('[ManifestController] 清单下载异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

export const getManifestCode = async (req: Request, res: Response) => {
  try {
    const rawGid = Array.isArray(req.params.gid) ? req.params.gid[0] : req.params.gid;
    const gid = String(rawGid || '').trim();
    if (!gid || !/^\d+$/.test(gid)) {
      return res.status(400).json({ success: false, message: '无效的 GID' });
    }

    const code = await manifestService.getManifestCode(gid);
    if (!code) {
      return res.status(404).json({ success: false, message: '未找到清单请求代码' });
    }

    if (req.headers.accept && req.headers.accept.includes('application/json')) {
      return res.json({ success: true, gid, code });
    }
    return res.type('text/plain').send(code);
  } catch (e) {
    console.error('[ManifestController] 获取清单代码异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

