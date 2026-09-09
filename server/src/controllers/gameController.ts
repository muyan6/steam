import { Request, Response } from 'express';
import { gameService } from '../services/gameService.js';

export const getPopularGames = async (req: Request, res: Response) => {
  try {
    const list = gameService.getPopularGames();
    res.json({ success: true, data: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
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
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
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
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
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
    const cdnCandidates = gameService.getSteamImageCdns(appId);
    return res.json({
      success: true,
      headerUrl: headerUrl || cdnCandidates[0],
      cdnCandidates
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

/**
 * 游戏字典版本查询（客户端比对 SHA256 决定是否需要静默增量更新）
 */
export const getGameLibraryVersion = async (req: Request, res: Response) => {
  try {
    const version = gameService.getLibraryVersion();
    res.json({ success: true, data: version });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

/**
 * 游戏字典二进制下载（客户端离线检索基线，需设备标识但不受免费配额限制）
 */
export const downloadGameLibrary = async (req: Request, res: Response) => {
  try {
    const lib = gameService.getLibraryBinary();
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Length', String(lib.buffer.length));
    res.setHeader('X-Dictionary-Sha256', lib.sha256);
    res.setHeader('X-Dictionary-Count', String(lib.count));
    res.setHeader('Content-Disposition', 'attachment; filename="game_dict.bin"');
    res.end(lib.buffer);
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};
