import { Request, Response } from 'express';
import { authService } from '../services/authService.js';

export const login = async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    // 审计/锁定统一用 req.ip（受 TRUST_PROXY 控制），与限流器口径一致；
    // 直接用 socket 地址在反向代理部署下会全是 127.0.0.1，审计失真、锁定形同虚设。
    const ip = req.ip || req.ip || req.socket.remoteAddress || '127.0.0.1';
    const userAgent = req.headers['user-agent'] || '';

    if (!username || !password) {
      return res.status(400).json({ success: false, message: '请输入管理员账号与密码' });
    }

    // login 内部用异步 PBKDF2，必须 await；同步哈希会阻塞事件循环造成 DoS
    const result = await authService.login(username.trim(), password, ip, userAgent);
    if (!result.success) {
      return res.status(401).json(result);
    }

    res.json(result);
  } catch (e) {
    console.error('[AuthController] 登录异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
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
  } catch (e) {
    console.error('[AuthController] 获取管理员信息异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

export const changePassword = (req: Request, res: Response) => {
  try {
    const { currentPassword, newUsername, newPassword } = req.body;
    const operator = (req as any).adminUser?.username || 'admin';
    const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
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
  } catch (e) {
    console.error('[AuthController] 修改密码异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

export const logout = (req: Request, res: Response) => {
  const operator = (req as any).adminUser?.username || 'admin';
  const ip = req.ip || req.socket.remoteAddress || '127.0.0.1';
  // 真正吊销：递增 tokenVersion，使该 token（及本会话全部 token）立即失效。
  // 原实现只记审计，token 仍可用到 7 天过期，拷贝出去的凭据在"已退出"后依然有效。
  try { authService.revokeAllTokens(); }
  catch (e) {
    console.error('[AuthController] 吊销持久化失败:', e);
    authService.recordAuditLog({ action: 'LOGOUT_FAILED', operator, ip, success: false, details: '本进程会话已失效，吊销状态持久化失败' });
    res.status(503).json({ success: false, message: '当前会话已失效，但退出状态保存失败，请联系管理员检查存储' });
    return;
  }
  authService.recordAuditLog({
    action: 'LOGOUT',
    operator,
    ip,
    userAgent: req.headers['user-agent'] || '',
    details: '管理员注销登录（已吊销全部令牌）',
    success: true
  });
  res.json({ success: true, message: '已安全退出登录' });
};

export const getAuditLogs = (req: Request, res: Response) => {
  try {
    // limit 夹取：1~200，非法/缺省回落 50
    const raw = parseInt(req.query.limit as string, 10);
    const limit = isNaN(raw) ? 50 : Math.min(200, Math.max(1, raw));
    const logs = authService.getAuditLogs(limit);
    res.json({ success: true, data: logs });
  } catch (e) {
    console.error('[AuthController] 读取审计日志异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};
