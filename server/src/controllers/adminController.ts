import { Request, Response, NextFunction } from 'express';
import { noticeService } from '../services/noticeService.js';
import { versionService } from '../services/versionService.js';
import { syncService } from '../services/syncService.js';
import { gameService } from '../services/gameService.js';
import { depotService } from '../services/depotService.js';
import { tokenService } from '../services/tokenService.js';
import { authService } from '../services/authService.js';
import { ServerStats } from '../types/index.js';

// 客户端 IP 只取 socket 真实地址；X-Forwarded-For 可被任意伪造，仅当部署在可信反代之后才可用
const getClientIp = (req: Request): string => {
  return req.socket.remoteAddress || '127.0.0.1';
};

/**
 * 管理员安全鉴权中间件：仅接受 JWT 令牌验证。
 * 安全策略：已移除 x-admin-key 静态密钥后门与 ?token=/adminKey 查询参数通道。
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  let token: string | undefined;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.headers['x-admin-token']) {
    token = req.headers['x-admin-token'] as string;
  }

  if (token) {
    const payload = authService.verifyToken(token);
    if (payload) {
      (req as any).adminUser = payload;
      return next();
    }
  }

  return res.status(401).json({
    success: false,
    message: '访问被拒绝：未提供有效的管理员身份认证令牌 (Token)'
  });
};

export const updateNotice = (req: Request, res: Response) => {
  try {
    const updated = noticeService.updateNotice(req.body.id || 'notice_default', req.body);
    res.json({ success: true, message: '公告已成功更新并对所有客户端生效', data: updated });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const updateVersion = (req: Request, res: Response) => {
  try {
    const updated = versionService.publishVersion(req.body);
    res.json({ success: true, message: '版本升级规则已成功更新', data: updated });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const triggerSyncGames = async (req: Request, res: Response) => {
  try {
    const operator = (req as any).adminUser?.username || 'admin';
    authService.recordAuditLog({
      action: 'SYNC_GAMES',
      operator,
      ip: getClientIp(req),
      details: '手动触发全量游戏索引同步',
      success: true
    });
    const result = await syncService.syncGames();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const triggerSyncDepots = async (req: Request, res: Response) => {
  try {
    const operator = (req as any).adminUser?.username || 'admin';
    authService.recordAuditLog({
      action: 'SYNC_DEPOTS',
      operator,
      ip: getClientIp(req),
      details: '手动触发 DepotKey 密钥库同步',
      success: true
    });
    const result = await syncService.syncDepotKeys();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const triggerSyncTokens = async (req: Request, res: Response) => {
  try {
    const operator = (req as any).adminUser?.username || 'admin';
    authService.recordAuditLog({
      action: 'SYNC_TOKENS',
      operator,
      ip: getClientIp(req),
      details: '手动触发 PICS Token 访问令牌同步',
      success: true
    });
    const result = await syncService.syncTokens();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const triggerSyncAll = async (req: Request, res: Response) => {
  try {
    const operator = (req as any).adminUser?.username || 'admin';
    authService.recordAuditLog({
      action: 'SYNC_ALL',
      operator,
      ip: getClientIp(req),
      details: '手动触发多源全量聚合调度同步',
      success: true
    });
    const result = await syncService.syncAll();
    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const getPublicStats = (req: Request, res: Response) => {
  try {
    const stats = {
      status: 'online',
      gamesCount: gameService.getTotalGamesCount(),
      depotKeysCount: depotService.getTotalKeysCount(),
      tokensCount: tokenService.getTotalTokensCount(),
      time: new Date().toISOString()
    };
    res.json({ success: true, data: stats });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const getServerStats = (req: Request, res: Response) => {
  try {
    const mem = process.memoryUsage();
    const allNotices = noticeService.getAllNotices();
    const activeNotices = noticeService.getActiveNotices();
    const allVersions = versionService.getAllVersions();

    const stats: ServerStats = {
      status: 'online',
      uptimeSeconds: Math.floor(process.uptime()),
      gamesCount: gameService.getTotalGamesCount(),
      depotKeysCount: depotService.getTotalKeysCount(),
      tokensCount: tokenService.getTotalTokensCount(),
      memoryUsageMb: Math.round(mem.rss / 1024 / 1024),
      nodeVersion: process.version,
      noticesCount: allNotices.length,
      activeNoticesCount: activeNotices.length,
      versionsCount: allVersions.length
    };
    res.json({ success: true, data: stats });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * 在线快速检索与排查 DepotKey / Token / 游戏
 */
export const searchDebugKeys = async (req: Request, res: Response) => {
  try {
    const query = ((req.query.q as string) || '').trim();
    if (!query) {
      return res.json({ success: true, data: { depotKey: null, token: null, game: null } });
    }

    const numericId = parseInt(query, 10);
    let depotKey: string | null = null;
    let token: string | null = null;
    let game: any = null;

    if (!isNaN(numericId)) {
      depotKey = depotService.getDepotKey(numericId.toString());
      token = tokenService.getTokenByAppId(numericId);
      game = await gameService.getGameByAppId(numericId);
    }

    res.json({
      success: true,
      data: {
        query,
        numericId: isNaN(numericId) ? null : numericId,
        depotKey,
        token,
        game
      }
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};
