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

    const result = await manifestService.getManifestCode(gid);
    const code = result.code;

    if (!code) {
      // 404 与 503 的语义必须严格区分，客户端据此决定「写负缓存」还是「立刻重试」：
      //
      // - 404：权威源明确回答「没有这个 gid」。客户端写 CFD_CODE_NEG_TTL 负缓存
      //   是正确的 —— 重复问也不会有码。
      // - 503：上游此刻过载/超时/被质询，我们**并不知道**有没有。客户端绝不能
      //   写负缓存，必须立刻重试。
      //
      // 旧实现把所有失败一律回 404，等于把上游一次 429 抖动翻译成「确认没有」，
      // 再被客户端固化成两分钟负缓存 —— 该 gid 期间对所有客户端都取不到码。
      // 这正是「第一次点下载报无网络、等一两分钟再点才行」的成因。
      if (result.transient && !result.definitiveMiss) {
        return res.status(503).json({ success: false, message: '上游暂时不可用，请稍后重试' });
      }
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

