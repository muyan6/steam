import { Request, Response } from 'express';
import { depotService } from '../services/depotService.js';

export const getDepotsForGame = async (req: Request, res: Response) => {
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

    const depots = await depotService.getDepotsForGame(appId, dlcs);
    res.json({ success: true, data: depots });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const getSingleDepotKey = async (req: Request, res: Response) => {
  try {
    const depotId = Array.isArray(req.params.depotId) ? req.params.depotId[0] : req.params.depotId;
    const key = depotService.getDepotKey(depotId);
    if (!key) {
      return res.status(404).json({ success: false, message: '未找到该 Depot 解密密钥' });
    }
    res.json({ success: true, data: { depotId, key } });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};
