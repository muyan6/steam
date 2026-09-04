import { Request, Response } from 'express';
import { authService } from '../services/authService.js';

export const login = (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    const ip = req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';

    if (!username || !password) {
      return res.status(400).json({ success: false, message: '请输入管理员账号与密码' });
    }

    const result = authService.login(username.trim(), password, ip, userAgent);
    if (!result.success) {
      return res.status(401).json(result);
    }

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const getProfile = (req: Request, res: Response) => {
  try {
    const user = (req as any).adminUser;
    const profile = authService.getProfile();
    res.json({
      success: true,
      data: {
        ...profile,
        currentOperator: user?.username || profile.username
      }
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const changePassword = (req: Request, res: Response) => {
  try {
    const { currentPassword, newUsername, newPassword } = req.body;
    const operator = (req as any).adminUser?.username || 'admin';
    const ip = req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: '原密码与新密码均为必填项' });
    }

    const result = authService.changePassword(
      currentPassword,
      newUsername,
      newPassword,
      operator,
      ip,
      userAgent
    );

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.json(result);
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};

export const logout = (req: Request, res: Response) => {
  const operator = (req as any).adminUser?.username || 'admin';
  const ip = req.socket.remoteAddress || '127.0.0.1';
  authService.recordAuditLog({
    action: 'LOGOUT',
    operator,
    ip,
    userAgent: req.headers['user-agent'] || '',
    details: '管理员注销登录',
    success: true
  });
  res.json({ success: true, message: '已安全退出登录' });
};

export const getAuditLogs = (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const logs = authService.getAuditLogs(limit);
    res.json({ success: true, data: logs });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
};
