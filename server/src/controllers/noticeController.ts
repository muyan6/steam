import { Request, Response } from 'express';
import { noticeService } from '../services/noticeService.js';
import { authService } from '../services/authService.js';

const getClientIp = (req: Request): string => {
  const raw = req.headers['x-forwarded-for'];
  if (Array.isArray(raw)) return raw[0];
  if (typeof raw === 'string') return raw.split(',')[0].trim();
  return req.socket.remoteAddress || '127.0.0.1';
};

const getParamStr = (val: any): string => {
  if (Array.isArray(val)) return val[0] || '';
  return typeof val === 'string' ? val : '';
};

// ==================== 客户端公共端点 ====================

export const getLatestNotice = (req: Request, res: Response) => {
  try {
    const version = req.query.version as string | undefined;
    const notice = noticeService.getLatestNotice(version);
    res.json({ success: true, data: notice });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const getActiveNoticesList = (req: Request, res: Response) => {
  try {
    const version = req.query.version as string | undefined;
    const list = noticeService.getActiveNotices(version);
    res.json({ success: true, data: list });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

// ==================== 管理员管理端点 ====================

export const getAllNoticesAdmin = (req: Request, res: Response) => {
  try {
    const list = noticeService.getAllNotices();
    res.json({ success: true, data: list });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const getNoticeDetailAdmin = (req: Request, res: Response) => {
  try {
    const id = getParamStr(req.params.id);
    const notice = noticeService.getNoticeById(id);
    if (!notice) {
      return res.status(404).json({ success: false, message: '公告不存在' });
    }
    res.json({ success: true, data: notice });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const createNoticeAdmin = (req: Request, res: Response) => {
  try {
    const operator = (req as any).adminUser?.username || 'admin';
    const newNotice = noticeService.createNotice(req.body);

    authService.recordAuditLog({
      action: 'NOTICE_CREATE',
      operator,
      ip: getClientIp(req),
      details: `创建公告: 【${newNotice.title}】 (ID: ${newNotice.id})`,
      success: true
    });

    res.json({ success: true, message: '公告创建成功并已即时生效', data: newNotice });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const updateNoticeAdmin = (req: Request, res: Response) => {
  try {
    const id = getParamStr(req.params.id);
    const operator = (req as any).adminUser?.username || 'admin';
    const updated = noticeService.updateNotice(id, req.body);

    authService.recordAuditLog({
      action: 'NOTICE_UPDATE',
      operator,
      ip: getClientIp(req),
      details: `更新公告: 【${updated.title}】 (ID: ${updated.id})`,
      success: true
    });

    res.json({ success: true, message: '公告信息已更新', data: updated });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const toggleNoticeAdmin = (req: Request, res: Response) => {
  try {
    const id = getParamStr(req.params.id);
    const { enabled } = req.body;
    const operator = (req as any).adminUser?.username || 'admin';
    const toggled = noticeService.toggleNotice(id, enabled);

    if (!toggled) {
      return res.status(404).json({ success: false, message: '公告不存在' });
    }

    authService.recordAuditLog({
      action: 'NOTICE_TOGGLE',
      operator,
      ip: getClientIp(req),
      details: `公告状态切换为 ${toggled.enabled ? '【启用】' : '【停用】'}: ${toggled.title}`,
      success: true
    });

    res.json({
      success: true,
      message: `公告已${toggled.enabled ? '启用' : '停用'}`,
      data: toggled
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const deleteNoticeAdmin = (req: Request, res: Response) => {
  try {
    const id = getParamStr(req.params.id);
    const operator = (req as any).adminUser?.username || 'admin';
    const success = noticeService.deleteNotice(id);

    if (!success) {
      return res.status(404).json({ success: false, message: '公告不存在或已被删除' });
    }

    authService.recordAuditLog({
      action: 'NOTICE_DELETE',
      operator,
      ip: getClientIp(req),
      details: `删除公告 ID: ${id}`,
      success: true
    });

    res.json({ success: true, message: '公告已成功删除' });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};
