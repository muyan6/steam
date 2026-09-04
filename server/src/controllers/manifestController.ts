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
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const downloadManifestFile = async (req: Request, res: Response) => {
  try {
    const depotId = Array.isArray(req.params.depotId) ? req.params.depotId[0] : req.params.depotId;
    const manifestId = Array.isArray(req.params.manifestId) ? req.params.manifestId[0] : req.params.manifestId;

    if (!depotId || !manifestId || !/^\d+$/.test(depotId) || !/^\d+$/.test(manifestId)) {
      return res.status(400).json({ success: false, message: '参数缺失或格式非法' });
    }

    const filePath = manifestService.getLocalManifestFilePath(depotId, manifestId);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: '未找到该清单文件缓存' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${depotId}_${manifestId}.manifest"`);
    fs.createReadStream(filePath).pipe(res);
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};
