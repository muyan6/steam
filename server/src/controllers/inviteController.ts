import { Request, Response } from 'express';
import { inviteService } from '../services/inviteService.js';
import { appSettingsService } from '../services/appSettingsService.js';
import { licenseService } from '../services/licenseService.js';
import { deviceService } from '../services/deviceService.js';
import { authService } from '../services/authService.js';

const getClientIp = (req: Request): string => req.socket.remoteAddress || '127.0.0.1';

// ==================== 1. 公开客户端接口 ====================

/**
 * 查询本机邀请状态：本机邀请码 / 已邀请人数 / 累计获得天数 / 是否已绑定邀请码
 */
export function getInviteStatus(req: Request, res: Response) {
  try {
    const queryDeviceId = Array.isArray(req.query.deviceId) ? req.query.deviceId[0] : req.query.deviceId;
    const rawDeviceId =
      (typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'] : '') ||
      (typeof queryDeviceId === 'string' ? queryDeviceId : '');
    const deviceId = String(rawDeviceId || '').trim();
    if (!deviceId) {
      return res.status(400).json({ success: false, message: '缺少 deviceId' });
    }
    if (deviceId.length > 128) {
      return res.status(400).json({ success: false, message: '设备码格式非法' });
    }

    return res.json({ success: true, data: inviteService.getStatus(deviceId) });
  } catch (e) {
    console.error('[InviteController] 查询邀请状态异常:', e);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}

/**
 * 绑定邀请码：被邀请人获得 N 天赞助版，邀请人同步获得 N 天
 */
export function bindInviteCode(req: Request, res: Response) {
  try {
    const { code, deviceId } = req.body || {};
    if (!code || !deviceId) {
      return res.status(400).json({ success: false, message: '邀请码 (code) 与设备码 (deviceId) 均为必填项' });
    }
    if (typeof code !== 'string' || typeof deviceId !== 'string' || code.length > 64 || deviceId.length > 128) {
      return res.status(400).json({ success: false, message: '邀请码或设备码格式非法' });
    }

    const result = inviteService.bindInviteCode(code, deviceId);
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.message });
    }

    // 奖励到账后同步设备档案的激活态与卡密信息，控制台零延迟可见
    try {
      const info = licenseService.verify(deviceId);
      if (info.isActivated) {
        deviceService.updateDeviceActivation(deviceId, true, info.code, info.type);
      }
    } catch (err) {
      console.warn('[InviteController] 同步设备激活状态失败:', err);
    }

    return res.json({ success: true, message: result.message, data: result.status });
  } catch (e) {
    console.error('[InviteController] 绑定邀请码异常:', e);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}

// ==================== 2. 管理员受保护接口 ====================

/**
 * 管理端：邀请记录列表 + 概览统计（含邀请排行榜）
 */
export function getInviteOverviewAdmin(req: Request, res: Response) {
  try {
    const { page, limit, search } = req.query;
    const result = inviteService.getAdminOverview({
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 20,
      search: typeof search === 'string' ? search : ''
    });
    return res.json({ success: true, data: result });
  } catch (e) {
    console.error('[InviteController] 查询邀请记录异常:', e);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}

/**
 * 管理端：更新邀请奖励天数（邀请人与被邀请人同步生效，立即生效无需重启）
 */
export function updateInviteRewardDaysAdmin(req: Request, res: Response) {
  try {
    const operator = (req as any).adminUser?.username || 'admin';
    const raw = req.body?.days;
    const days = typeof raw === 'number' ? Math.floor(raw) : parseInt(String(raw), 10);
    if (isNaN(days) || days < 1 || days > 3650) {
      return res.status(400).json({ success: false, message: '邀请奖励天数需在 1 ~ 3650 之间' });
    }

    const before = appSettingsService.getInviteRewardDays();
    const next = appSettingsService.setInviteRewardDays(days);

    authService.recordAuditLog({
      action: 'SETTINGS_INVITE_REWARD',
      operator,
      ip: getClientIp(req),
      details: `邀请奖励天数: ${before} → ${next.inviteRewardDays} 天（邀请人与被邀请人同步）`,
      success: true
    });

    return res.json({
      success: true,
      message: `已生效：邀请人与被邀请人各获得 ${next.inviteRewardDays} 天赞助版`,
      data: { inviteRewardDays: next.inviteRewardDays, updatedAt: next.updatedAt }
    });
  } catch (e) {
    console.error('[InviteController] 更新邀请奖励天数异常:', e);
    return res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}