import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { depotService } from '../services/depotService.js';
import { gameService } from '../services/gameService.js';
import { getPopularGames, searchGames, getGameDetail, getGameHeaderImage } from '../controllers/gameController.js';
import { getDepotsForGame, getSingleDepotKey } from '../controllers/depotController.js';
import { getGameMetadata } from '../controllers/metadataController.js';
import { getTokenForApp, getTokensStats } from '../controllers/tokenController.js';
import { getManifestsForApp, downloadManifestFile } from '../controllers/manifestController.js';
import {
  getLatestNotice,
  getActiveNoticesList,
  getAllNoticesAdmin,
  getNoticeDetailAdmin,
  createNoticeAdmin,
  updateNoticeAdmin,
  toggleNoticeAdmin,
  deleteNoticeAdmin
} from '../controllers/noticeController.js';
import {
  checkVersion,
  getLatestVersionInfo,
  getAllVersionsAdmin,
  getVersionDetailAdmin,
  publishVersionAdmin,
  updateVersionAdmin,
  toggleVersionAdmin,
  deleteVersionAdmin,
  pushBroadcastAdmin,
  getPushLogsAdmin
} from '../controllers/versionController.js';
import { getSourcesList, triggerSyncFromSources } from '../controllers/sourceController.js';
import {
  login,
  getProfile,
  changePassword,
  logout,
  getAuditLogs
} from '../controllers/authController.js';
import {
  requireAdmin,
  updateNotice,
  updateVersion,
  triggerSyncGames,
  triggerSyncDepots,
  triggerSyncTokens,
  triggerSyncAll,
  getServerStats,
  searchDebugKeys
} from '../controllers/adminController.js';
import {
  activateLicense,
  verifyLicense,
  getDeviceLicenseStatus,
  getLicenseListAdmin,
  getLicenseStatsAdmin,
  generateLicensesAdmin,
  unbindLicenseAdmin,
  toggleLicenseAdmin,
  deleteLicenseAdmin,
  extendLicenseAdmin
} from '../controllers/licenseController.js';
import {
  getManifestNodes,
  getSha256PackageInfo,
  reportRepairLog,
  getToolboxAdminStats,
  getSteamlessInfo,
  getOnlineModes,
  searchOnlineFix
} from '../controllers/toolboxController.js';
import { deviceService } from '../services/deviceService.js';
import { licenseService } from '../services/licenseService.js';

const router = Router();

// ==================== 1. 公开客户端 API ====================

// 健康与统计
router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// 客户端设备心跳与活跃度上报 (公开接口，限流防刷)
const heartbeatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 4,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '心跳上报过于频繁' }
});

router.post('/telemetry/heartbeat', heartbeatLimiter, (req: Request, res: Response) => {
  const { deviceId, clientVersion, osVersion, os, licenseCode, licenseType, isActivated, unlockedCount, steamPath } = req.body || {};
  // 字段校验：类型与长度受限，防止刷超大 payload 撑爆数据文件
  if (!deviceId || typeof deviceId !== 'string' || deviceId.length > 128) {
    return res.status(400).json({ success: false, message: '缺少或非法的 deviceId' });
  }
  const clean = (v: unknown, max: number): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v.slice(0, max) : undefined;
  const ip = req.socket.remoteAddress || '127.0.0.1';
  const record = deviceService.recordHeartbeat({
    deviceId,
    ip,
    clientVersion: clean(clientVersion, 32),
    // 兼容旧客户端的 os 字段
    osVersion: clean(osVersion, 64) ?? clean(os, 64),
    licenseCode: clean(licenseCode, 64),
    licenseType: clean(licenseType, 32),
    isActivated: typeof isActivated === 'boolean' ? isActivated : undefined,
    unlockedCount: typeof unlockedCount === 'number' ? unlockedCount : undefined,
    steamPath: clean(steamPath, 260)
  });
  res.json({ success: true, data: record });
});

// 管理员登录（公开接口，限流 + 服务端 IP 锁定双重防爆破）
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '登录尝试过于频繁，请稍后再试' }
});
router.post('/auth/login', loginLimiter, login);

// 溯源与上游引用清单只读查看
router.get('/sources', getSourcesList);

// 公告通知（客户端拉取）
router.get('/notice/latest', getLatestNotice);
router.get('/notice/list', getActiveNoticesList);

// 版本检测与升级
router.get('/version/check', checkVersion);
router.get('/version/latest', getLatestVersionInfo);

// 游戏库检索与详情
router.get('/games/popular', getPopularGames);
router.get('/games/search', searchGames);
router.get('/games/:appId/header', getGameHeaderImage);
router.get('/games/:appId', getGameDetail);

// 一站式元数据与密钥聚合查询
// 密钥类接口设备授权：仅允许持有有效授权的客户端获取 depotKey / token，
// 防止客户端激活拦截被绕过后直接调用云端接口拿走密钥
const requireLicensedDevice = (req: Request, res: Response, next: any) => {
  const deviceId = String(req.query.deviceId || '');
  if (!deviceId || deviceId.length > 128) {
    return res.status(401).json({ success: false, message: '缺少或非法的 deviceId，请升级客户端后使用' });
  }
  const info = licenseService.verify(deviceId);
  if (!info.isActivated) {
    return res.status(403).json({ success: false, message: info.message || '当前设备未激活，无法获取密钥数据' });
  }
  next();
};

router.get('/metadata/:appId', requireLicensedDevice, getGameMetadata);

// 公开只读统计数据 (客户端数据库统计使用，不暴露管理能力)
router.get('/stats', (req: Request, res: Response) => {
  try {
    res.json({
      success: true,
      data: {
        gamesCount: gameService.getTotalGamesCount(),
        keysCount: depotService.getTotalKeysCount()
      }
    });
  } catch (e: any) {
    res.status(500).json({ success: false, message: e.message });
  }
});

// DepotKey 密钥查询
router.get('/depots/:appId', requireLicensedDevice, getDepotsForGame);
router.get('/depots/key/:depotId', requireLicensedDevice, getSingleDepotKey);

// AccessToken 令牌查询
router.get('/tokens/stats', getTokensStats);
router.get('/tokens/:appId', requireLicensedDevice, getTokenForApp);

// Manifest 清单检索与下载
router.get('/manifests/:appId', getManifestsForApp);
router.get('/manifests/download/:depotId/:manifestId', downloadManifestFile);

// 客户端设备码绑定与激活码验证 (公开接口)
router.post('/license/activate', activateLicense);
router.post('/license/verify', verifyLicense);
router.get('/license/status/:deviceId', getDeviceLicenseStatus);

// 工具箱 (Toolbox) 与清单高可用节点 (公开接口)
router.get('/toolbox/nodes', getManifestNodes);
router.get('/toolbox/sha256-data', getSha256PackageInfo);
router.post('/toolbox/repair-log', heartbeatLimiter, reportRepairLog);
router.get('/toolbox/steamless-info', getSteamlessInfo);
router.get('/toolbox/online-modes', getOnlineModes);
router.get('/toolbox/onlinefix-search', searchOnlineFix);

// ==================== 2. 管理员认证受保护 API ====================

// 权限拦截中间件
router.use(['/admin', '/auth/profile', '/auth/change-password', '/auth/logout', '/auth/audit-logs', '/sources/sync'], requireAdmin);

// 账号安全与审计
router.get('/auth/profile', getProfile);
router.post('/auth/change-password', changePassword);
router.post('/auth/logout', logout);
router.get('/auth/audit-logs', getAuditLogs);

// 手动多源同步（受保护）
router.post('/sources/sync', triggerSyncFromSources);

// 系统统计与调试工具
router.get('/admin/stats', getServerStats);
router.get('/admin/search/debug', searchDebugKeys);
router.get('/admin/toolbox/stats', getToolboxAdminStats);

// 客户端设备管理与活跃度监控
router.get('/admin/devices/list', (req, res) => {
  const page = parseInt(req.query.page as string, 10) || 1;
  const limit = parseInt(req.query.limit as string, 10) || 20;
  const search = (req.query.search as string) || '';
  const status = (req.query.status as string) || 'all';
  const result = deviceService.getDeviceList({ page, limit, search, status });
  res.json({ success: true, data: result });
});
router.get('/admin/devices/stats', (req, res) => {
  const stats = deviceService.getDeviceStats();
  res.json({ success: true, data: stats });
});

// 卡密管理 CRUD 与批量生成
router.get('/admin/license/list', getLicenseListAdmin);
router.get('/admin/license/stats', getLicenseStatsAdmin);
router.post('/admin/license/generate', generateLicensesAdmin);
router.post('/admin/license/unbind', unbindLicenseAdmin);
router.post('/admin/license/toggle', toggleLicenseAdmin);
router.post('/admin/license/extend', extendLicenseAdmin);
router.delete('/admin/license/:code', deleteLicenseAdmin);

// 公告管理 CRUD
router.get('/admin/notices', getAllNoticesAdmin);
router.get('/admin/notices/:id', getNoticeDetailAdmin);
router.post('/admin/notices', createNoticeAdmin);
router.put('/admin/notices/:id', updateNoticeAdmin);
router.patch('/admin/notices/:id/toggle', toggleNoticeAdmin);
router.delete('/admin/notices/:id', deleteNoticeAdmin);

// 版本管理与推送广播 CRUD
router.get('/admin/versions', getAllVersionsAdmin);
router.get('/admin/versions/push/logs', getPushLogsAdmin);
router.get('/admin/versions/:version', getVersionDetailAdmin);
router.post('/admin/versions', publishVersionAdmin);
router.put('/admin/versions/:version', updateVersionAdmin);
router.patch('/admin/versions/:version/toggle', toggleVersionAdmin);
router.delete('/admin/versions/:version', deleteVersionAdmin);
router.post('/admin/versions/push', pushBroadcastAdmin);

// 爬虫与数据同步调度
router.post('/admin/sync/games', triggerSyncGames);
router.post('/admin/sync/depots', triggerSyncDepots);
router.post('/admin/sync/tokens', triggerSyncTokens);
router.post('/admin/sync/all', triggerSyncAll);

// 兼容旧版单一接口
router.post('/admin/notice', updateNotice);
router.post('/admin/version', updateVersion);

export default router;
