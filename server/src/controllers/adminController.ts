import { Request, Response, NextFunction } from 'express';
import { CONFIG } from '../config/index.js';
import { noticeService } from '../services/noticeService.js';
import { versionService } from '../services/versionService.js';
import { syncService } from '../services/syncService.js';
import { gameService } from '../services/gameService.js';
import { depotService } from '../services/depotService.js';
import { ServerStats } from '../types/index.js';

/**
 * 管理员鉴权中间件
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  const adminKey = req.headers['x-admin-key'] || req.query.adminKey;
  if (!adminKey || adminKey !== CONFIG.ADMIN_SECRET) {
    return res.status(403).json({ success: false, message: '权限不足：无效的管理员密钥 (x-admin-key)' });
  }
  next();
};

export const updateNotice = (req: Request, res: Response) => {
  try {
    const updated = noticeService.updateNotice(req.body);
    res.json({ success: true, message: '公告已成功更新并对所有客户端生效', data: updated });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const updateVersion = (req: Request, res: Response) => {
  try {
    const updated = versionService.updateVersion(req.body);
    res.json({ success: true, message: '版本升级规则已成功更新', data: updated });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const triggerSyncGames = async (req: Request, res: Response) => {
  try {
    const result = await syncService.syncGames();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const triggerSyncDepots = async (req: Request, res: Response) => {
  try {
    const result = await syncService.syncDepotKeys();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const getServerStats = (req: Request, res: Response) => {
  try {
    const mem = process.memoryUsage();
    const stats: ServerStats = {
      status: 'online',
      uptimeSeconds: Math.floor(process.uptime()),
      gamesCount: gameService.getTotalGamesCount(),
      depotKeysCount: depotService.getTotalKeysCount(),
      memoryUsageMb: Math.round(mem.rss / 1024 / 1024),
      nodeVersion: process.version
    };
    res.json({ success: true, data: stats });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};
