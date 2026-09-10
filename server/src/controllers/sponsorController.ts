import { Request, Response } from 'express';
import { sponsorService } from '../services/sponsorService.js';
import { authService } from '../services/authService.js';

const getClientIp = (req: Request): string => {
  return req.socket.remoteAddress || '127.0.0.1';
};

// ==================== 客户端公开端点 ====================

/**
 * 客户端公开获取爱发电赞助者荣誉榜单
 */
export function getPublicSponsors(_req: Request, res: Response) {
  try {
    const data = sponsorService.getSponsors();
    res.json({ success: true, data });
  } catch (e: any) {
    console.error('[SponsorController] 获取赞助榜异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}

/**
 * 客户端/公网触发同步爱发电最新数据（配合限流中间件）
 */
export async function syncAfdianSponsors(_req: Request, res: Response) {
  try {
    const result = await sponsorService.syncFromAfdian();
    res.json(result);
  } catch (e: any) {
    console.error('[SponsorController] 同步爱发电异常:', e);
    res.status(500).json({ success: false, message: '同步爱发电异常: ' + e.message });
  }
}

// ==================== 管理员管理端点 ====================

/**
 * 管理端获取爱发电开发者对接配置
 */
export function getAfdianConfigAdmin(_req: Request, res: Response) {
  try {
    const config = sponsorService.getAfdianConfig();
    res.json({ success: true, data: config });
  } catch (e: any) {
    console.error('[SponsorController] 获取爱发电配置异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}

/**
 * 管理端更新爱发电开发者对接配置
 */
export function updateAfdianConfigAdmin(req: Request, res: Response) {
  try {
    const operator = (req as any).adminUser?.username || 'admin';
    const updated = sponsorService.updateAfdianConfig(req.body || {});

    authService.recordAuditLog({
      action: 'AFDIAN_CONFIG_UPDATE',
      operator,
      ip: getClientIp(req),
      details: `更新爱发电配置: userId=${updated.userId ? updated.userId : '(未设置)'} autoSync=${updated.autoSync}`,
      success: true
    });

    res.json({ success: true, message: '爱发电配置已保存', data: updated });
  } catch (e: any) {
    console.error('[SponsorController] 保存爱发电配置异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}

/**
 * 管理端获取赞助者完整管理列表
 */
export function getSponsorsAdmin(_req: Request, res: Response) {
  try {
    const data = sponsorService.getSponsors();
    res.json({ success: true, data });
  } catch (e: any) {
    console.error('[SponsorController] 获取管理端赞助列表异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}

/**
 * 管理端手动录入或编辑赞助者
 */
export function saveSponsorAdmin(req: Request, res: Response) {
  try {
    const operator = (req as any).adminUser?.username || 'admin';
    const saved = sponsorService.saveSponsor(req.body || {});

    authService.recordAuditLog({
      action: 'SPONSOR_SAVE',
      operator,
      ip: getClientIp(req),
      details: `编辑赞助者: ${saved.name} (¥${saved.allSumAmount})`,
      success: true
    });

    res.json({ success: true, message: `赞助者「${saved.name}」已保存`, data: saved });
  } catch (e: any) {
    console.error('[SponsorController] 保存赞助者异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}

/**
 * 管理端删除赞助者
 */
export function deleteSponsorAdmin(req: Request, res: Response) {
  try {
    const id = String(req.params.id || '').trim();
    if (!id) {
      return res.status(400).json({ success: false, message: '缺少赞助者 ID' });
    }
    const operator = (req as any).adminUser?.username || 'admin';
    const ok = sponsorService.deleteSponsor(id);
    if (!ok) {
      return res.status(404).json({ success: false, message: '赞助者未找到' });
    }

    authService.recordAuditLog({
      action: 'SPONSOR_DELETE',
      operator,
      ip: getClientIp(req),
      details: `删除赞助者 ID: ${id}`,
      success: true
    });

    res.json({ success: true, message: '赞助者记录已删除' });
  } catch (e: any) {
    console.error('[SponsorController] 删除赞助者异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
}
