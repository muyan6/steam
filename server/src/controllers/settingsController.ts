import { Request, Response } from 'express';
import { appSettingsService } from '../services/appSettingsService.js';
import { appLinksService } from '../services/appLinksService.js';
import { authService } from '../services/authService.js';

const getClientIp = (req: Request): string => {
  return req.socket.remoteAddress || '127.0.0.1';
};

/**
 * 读取全局运行时设置（当前：未激活每日免费额度）+ 应用内跳转链接
 */
export const getSettingsAdmin = (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        freeDailyLimit: appSettingsService.getFreeDailyLimit(),
        links: appLinksService.getLinks()
      }
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

/**
 * 更新未激活设备每日免费入库次数（0~999，立即生效无需重启）
 */
export const updateFreeQuotaLimitAdmin = (req: Request, res: Response) => {
  try {
    const operator = (req as any).adminUser?.username || 'admin';
    const raw = req.body?.limit;
    const limit = typeof raw === 'number' ? Math.floor(raw) : parseInt(String(raw), 10);
    if (isNaN(limit) || limit < 0 || limit > 999) {
      return res.status(400).json({ success: false, message: '每日免费次数需在 0 ~ 999 之间' });
    }
    const before = appSettingsService.getFreeDailyLimit();
    const next = appSettingsService.setFreeDailyLimit(limit);

    authService.recordAuditLog({
      action: 'SETTINGS_FREE_QUOTA',
      operator,
      ip: getClientIp(req),
      details: `未激活每日免费入库次数: ${before} → ${next.freeDailyLimit}`,
      success: true
    });

    res.json({
      success: true,
      message: `已生效：未激活用户每日免费入库 ${next.freeDailyLimit} 次`,
      data: next
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};
