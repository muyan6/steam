import { Request, Response } from 'express';
import { gameService } from '../services/gameService.js';

export const getPopularGames = async (req: Request, res: Response) => {
  try {
    const list = gameService.getPopularGames();
    res.json({ success: true, data: list });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const searchGames = async (req: Request, res: Response) => {
  try {
    const q = (req.query.q as string) || '';
    const source = (req.query.source as any) || 'steam_official';
    const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
    const pageSize = req.query.pageSize ? parseInt(req.query.pageSize as string, 10) : (req.query.limit ? parseInt(req.query.limit as string, 10) : 48);

    const result = await gameService.searchGamesPaged({
      query: q,
      source,
      page,
      pageSize
    });
    res.json({ success: true, data: result });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const getGameDetail = async (req: Request, res: Response) => {
  try {
    const rawAppId = Array.isArray(req.params.appId) ? req.params.appId[0] : req.params.appId;
    const appId = parseInt(rawAppId, 10);
    if (isNaN(appId)) {
      return res.status(400).json({ success: false, message: '无效的 AppID' });
    }
    const game = await gameService.getGameByAppId(appId);
    if (!game) {
      return res.status(404).json({ success: false, message: '未收录该游戏' });
    }
    res.json({ success: true, data: game });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const getGameHeaderImage = async (req: Request, res: Response) => {
  try {
    const rawAppId = Array.isArray(req.params.appId) ? req.params.appId[0] : req.params.appId;
    const appId = parseInt(rawAppId, 10);
    if (isNaN(appId)) {
      return res.status(400).json({ success: false, message: '无效的 AppID' });
    }
    const headerUrl = await gameService.fetchRealSteamHeader(appId);
    if (headerUrl) {
      return res.json({ success: true, headerUrl });
    }
    res.status(404).json({ success: false, message: '该应用暂无官方封面图' });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};
