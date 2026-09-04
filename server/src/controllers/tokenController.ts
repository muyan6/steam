import { Request, Response } from 'express';
import { tokenService } from '../services/tokenService.js';

export const getTokenForApp = async (req: Request, res: Response) => {
  try {
    const rawAppId = Array.isArray(req.params.appId) ? req.params.appId[0] : req.params.appId;
    const appId = parseInt(rawAppId, 10);
    if (isNaN(appId)) {
      return res.status(400).json({ success: false, message: '无效的 AppID' });
    }

    const token = tokenService.getTokenByAppId(appId);
    if (!token) {
      return res.status(404).json({ success: false, message: '未找到该 AppID 的 PICS AccessToken' });
    }

    return res.json({ success: true, data: { appId, token } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};

export const getTokensStats = async (req: Request, res: Response) => {
  try {
    const count = tokenService.getTotalTokensCount();
    return res.json({ success: true, data: { count } });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
