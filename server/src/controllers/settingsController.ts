import { Request, Response } from 'express';
import { appSettingsService } from '../services/appSettingsService.js';
import { appLinksService } from '../services/appLinksService.js';
import { authService } from '../services/authService.js';
import { licenseService } from '../services/licenseService.js';
import { freeQuotaService } from '../services/freeQuotaService.js';

const getClientIp = (req: Request): string => {
  return req.socket.remoteAddress || '127.0.0.1';
};

/**
 * 客户端公开查询当前设备每日免费配额与云端最新上限（免登录）
 */
export const getDeviceQuotaStatus = (req: Request, res: Response) => {
  try {
    // 查询参数可能是数组（?deviceId=a&deviceId=b），需归一为字符串
    const queryDeviceId = Array.isArray(req.query.deviceId) ? req.query.deviceId[0] : req.query.deviceId;
    const rawDeviceId =
      (typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'] : '') ||
      (typeof queryDeviceId === 'string' ? queryDeviceId : '');
    const deviceId = rawDeviceId.trim();
    if (!deviceId) {
      return res.status(400).json({ success: false, message: '缺少 deviceId' });
    }
    const info = licenseService.verify(deviceId);
    if (info.isActivated) {
      return res.json({
        success: true,
        data: {
          isActivated: true,
          limit: appSettingsService.getFreeDailyLimit(),
          used: 0,
          remaining: 999999
        }
      });
    }
    const st = freeQuotaService.status(deviceId);
    return res.json({
      success: true,
      data: {
        isActivated: false,
        limit: st.limit,
        used: st.used,
        remaining: st.remaining
      }
    });
  } catch (e) {
    console.error('[Settings] 查询设备配额异常:', e);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

/**
 * 读取全局运行时设置（当前：未激活每日免费入库款数，按游戏计、含全部 DLC）+ 应用内跳转链接
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
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
    }
};

/**
 * 更新未激活设备每日免费入库款数（0~999，按游戏计数、含全部 DLC，立即生效无需重启）
 */
export const updateFreeQuotaLimitAdmin = (req: Request, res: Response) => {
  try {
    const operator = (req as any).adminUser?.username || 'admin';
    const raw = req.body?.limit;
    const limit = typeof raw === 'number' ? Math.floor(raw) : parseInt(String(raw), 10);
    if (isNaN(limit) || limit < 0 || limit > 999) {
      return res.status(400).json({ success: false, message: '每日免费款数需在 0 ~ 999 之间' });
    }
    const before = appSettingsService.getFreeDailyLimit();
    const next = appSettingsService.setFreeDailyLimit(limit);

    authService.recordAuditLog({
      action: 'SETTINGS_FREE_QUOTA',
      operator,
      ip: getClientIp(req),
      details: `未激活每日免费入库款数: ${before} → ${next.freeDailyLimit}`,
      success: true
    });

    res.json({
      success: true,
      message: `已生效：未激活用户每日免费入库 ${next.freeDailyLimit} 款游戏（含全部 DLC）`,
      data: next
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
    }
};

