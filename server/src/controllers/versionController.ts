import { Request, Response } from 'express';
import { versionService } from '../services/versionService.js';
import { authService } from '../services/authService.js';

// 审计 IP 只取 socket 真实地址（X-Forwarded-For 可任意伪造）
const getClientIp = (req: Request): string => {
  return req.socket.remoteAddress || '127.0.0.1';
};

const getParamStr = (val: any): string => {
  if (Array.isArray(val)) return val[0] || '';
  return typeof val === 'string' ? val : '';
};

// ==================== 客户端公共端点 ====================

export const checkVersion = (req: Request, res: Response) => {
  try {
    const currentVersion =
      (req.query.version as string) || (req.query.current as string) || '1.0.0';
    const channel = (req.query.channel as string) || 'stable';
    const result = versionService.checkUpdate(currentVersion, channel);
    res.json({ success: true, data: result });
  } catch (e) {
    console.error('[VersionController] 版本接口异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

export const getLatestVersionInfo = (req: Request, res: Response) => {
  try {
    const channel = (req.query.channel as string) || 'stable';
    const info = versionService.getLatestVersion(channel);
    res.json({ success: true, data: info });
  } catch (e) {
    console.error('[VersionController] 版本接口异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

export const getVersionChangelogs = (_req: Request, res: Response) => {
  try {
    const list = versionService.getAllVersions();
    // 仅过滤出启用的版本，供客户端展示公开更新日志
    const changelogs = list
      .filter(v => v.enabled !== false)
      .map(v => ({
        version: v.version,
        releaseDate: v.releaseDate,
        title: v.title,
        changelog: v.changelog,
        forceUpdate: v.forceUpdate,
        downloadUrl: v.downloadUrl
      }));
    res.json({ success: true, data: changelogs });
  } catch (e) {
    console.error('[VersionController] 获取历史更新日志异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

// ==================== 管理员管理端点 ====================

export const getAllVersionsAdmin = (req: Request, res: Response) => {
  try {
    const list = versionService.getAllVersions();
    res.json({ success: true, data: list });
  } catch (e) {
    console.error('[VersionController] 版本接口异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

export const getVersionDetailAdmin = (req: Request, res: Response) => {
  try {
    const version = getParamStr(req.params.version);
    const release = versionService.getVersionByNumber(version);
    if (!release) {
      return res.status(404).json({ success: false, message: '版本记录不存在' });
    }
    res.json({ success: true, data: release });
  } catch (e) {
    console.error('[VersionController] 版本接口异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

export const publishVersionAdmin = (req: Request, res: Response) => {
  try {
    const operator = (req as any).adminUser?.username || 'admin';
    const newRelease = versionService.publishVersion(req.body);

    authService.recordAuditLog({
      action: 'VERSION_PUBLISH',
      operator,
      ip: getClientIp(req),
      details: `发布版本 v${newRelease.version} 【${newRelease.title}】 (强更: ${newRelease.forceUpdate ? '是' : '否'})`,
      success: true
    });

    res.json({ success: true, message: `版本 v${newRelease.version} 已成功发布并上线`, data: newRelease });
  } catch (e: any) {
    res.status(400).json({ success: false, message: e.message });
  }
};

export const updateVersionAdmin = (req: Request, res: Response) => {
  try {
    const version = getParamStr(req.params.version);
    const operator = (req as any).adminUser?.username || 'admin';
    const updated = versionService.updateVersion(version, req.body);

    authService.recordAuditLog({
      action: 'VERSION_UPDATE',
      operator,
      ip: getClientIp(req),
      details: `更新版本信息: v${updated.version}`,
      success: true
    });

    res.json({ success: true, message: `版本 v${updated.version} 信息已更新`, data: updated });
  } catch (e: any) {
    // 业务性"不存在"错误返回 404，系统异常返回通用 500（不透出内部细节）
    if (e?.message && e.message.includes('不存在')) {
      return res.status(404).json({ success: false, message: e.message });
    }
    console.error('[VersionController] 更新版本信息失败:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

export const toggleVersionAdmin = (req: Request, res: Response) => {
  try {
    const version = getParamStr(req.params.version);
    const { enabled } = req.body;
    const operator = (req as any).adminUser?.username || 'admin';
    const toggled = versionService.toggleVersion(version, enabled);

    if (!toggled) {
      return res.status(404).json({ success: false, message: '版本记录不存在' });
    }

    authService.recordAuditLog({
      action: 'VERSION_TOGGLE',
      operator,
      ip: getClientIp(req),
      details: `版本 v${version} 状态切换为 ${toggled.enabled ? '【启用】' : '【停用/下架】'}`,
      success: true
    });

    res.json({
      success: true,
      message: `版本 v${version} 已${toggled.enabled ? '上架启用' : '下架停用'}`,
      data: toggled
    });
  } catch (e) {
    console.error('[VersionController] 版本接口异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

export const deleteVersionAdmin = (req: Request, res: Response) => {
  try {
    const version = getParamStr(req.params.version);
    const operator = (req as any).adminUser?.username || 'admin';
    const success = versionService.deleteVersion(version);

    if (!success) {
      return res.status(404).json({ success: false, message: '版本记录不存在' });
    }

    authService.recordAuditLog({
      action: 'VERSION_DELETE',
      operator,
      ip: getClientIp(req),
      details: `删除版本记录: v${version}`,
      success: true
    });

    res.json({ success: true, message: `版本 v${version} 记录已删除` });
  } catch (e) {
    console.error('[VersionController] 版本接口异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

export const pushBroadcastAdmin = (req: Request, res: Response) => {
  try {
    const { version, title, content } = req.body;
    const operator = (req as any).adminUser?.username || 'admin';

    if (!version) {
      return res.status(400).json({ success: false, message: '请指定要推送的目标版本号' });
    }

    const record = versionService.pushBroadcast(version, title, content, operator);

    authService.recordAuditLog({
      action: 'VERSION_PUSH_BROADCAST',
      operator,
      ip: getClientIp(req),
      details: `向全量客户端广播推送版本更新: v${version} 【${record.title}】`,
      success: true
    });

    res.json({
      success: true,
      message: `版本 v${version} 全网更新推送广播已发起！`,
      data: record
    });
  } catch (e: any) {
    // 指定版本号不存在时返回 404，绝不静默回退推送最新版
    if (e?.message && e.message.includes('不存在')) {
      return res.status(404).json({ success: false, message: e.message });
    }
    console.error('[VersionController] 发起推送广播失败:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};

export const getPushLogsAdmin = (req: Request, res: Response) => {
  try {
    const raw = parseInt(req.query.limit as string, 10);
    const limit = isNaN(raw) ? 30 : Math.min(200, Math.max(1, raw));
    const logs = versionService.getPushLogs(limit);
    res.json({ success: true, data: logs });
  } catch (e) {
    console.error('[VersionController] 读取推送记录失败:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
};
