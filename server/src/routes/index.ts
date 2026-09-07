import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { depotService } from '../services/depotService.js';
import { gameService } from '../services/gameService.js';
import { getPopularGames, searchGames, getGameDetail, getGameHeaderImage, getGameLibraryVersion, downloadGameLibrary } from '../controllers/gameController.js';
import { getDepotsForGame, getSingleDepotKey } from '../controllers/depotController.js';
import { licenseSignService } from '../services/licenseSignService.js';
import { getGameMetadata } from '../controllers/metadataController.js';
import { getTokenForApp, getTokensStats } from '../controllers/tokenController.js';
import { getManifestsForApp, downloadManifestFile } from '../controllers/manifestController.js';
import { getLatestOstRelease, downloadOstAsset } from '../controllers/ostController.js';
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
import { getAppLinks, updateAppLinks } from '../controllers/linksController.js';
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
  rebindLicense,
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
import { freeQuotaService } from '../services/freeQuotaService.js';
import { appLinksService } from '../services/appLinksService.js';
import { authService } from '../services/authService.js';
import { getSettingsAdmin, updateFreeQuotaLimitAdmin } from '../controllers/settingsController.js';

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
  // 激活状态以服务端卡密库为准，不信任客户端自报（防伪造统计）
  const verified = licenseService.verify(deviceId);
  const record = deviceService.recordHeartbeat({
    deviceId,
    ip,
    clientVersion: clean(clientVersion, 32),
    // 兼容旧客户端的 os 字段
    osVersion: clean(osVersion, 64) ?? clean(os, 64),
    licenseCode: clean(licenseCode, 64),
    licenseType: clean(licenseType, 32) ?? (verified.isActivated ? verified.type : undefined),
    isActivated: verified.isActivated,
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

// 应用内跳转链接 (教程/FAQ，由服务端数据文件配置，未配置为空串)
router.get('/links', getAppLinks);

// 游戏库检索与详情
router.get('/games/popular', getPopularGames);
router.get('/games/search', searchGames);

// 游戏字典（客户端离线检索基线）版本查询与二进制下载
// 注意：必须注册在 /games/:appId 之前，否则 "library" 会被动态段吞掉
// 版本查询：公开只读，客户端比对 SHA256 后决定是否增量下载
router.get('/games/library/version', getGameLibraryVersion);

// 字典下载设备授权：仅需设备标识（不校验激活、不扣免费入库配额），
// 但施加轻量内存级每日限次（每设备每日 20 次），防止字典被脚本批量扒取。
// 本地 Map 每日按日期重置；条目数超上限时先清理过期日再按插入序淘汰，防内存无限膨胀。
const LIBRARY_DAILY_LIMIT = 20;
const LIBRARY_USAGE_MAP_MAX = 10000;
const libraryDailyUsage = new Map<string, { date: string; count: number }>();
const requireLibraryDeviceAccess = (req: Request, res: Response, next: any) => {
  // 优先请求头，兼容旧客户端 query 传参（与 requireKeyAccess 一致）
  const headerId = typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'] : '';
  const deviceId = String(headerId || req.query.deviceId || '').trim();
  if (!deviceId || deviceId.length > 128) {
    return res.status(401).json({ success: false, message: '缺少或非法的 deviceId，请升级客户端后使用' });
  }
  const today = new Date().toISOString().slice(0, 10);
  const record = libraryDailyUsage.get(deviceId);
  if (!record || record.date !== today) {
    // 每日零点后首次访问自然重置计数
    if (libraryDailyUsage.size >= LIBRARY_USAGE_MAP_MAX) {
      // 先清理所有非当日旧记录
      for (const [k, v] of libraryDailyUsage) {
        if (v.date !== today) libraryDailyUsage.delete(k);
      }
      // 仍超限（当日设备数异常多）则按插入序淘汰最旧条目
      while (libraryDailyUsage.size >= LIBRARY_USAGE_MAP_MAX) {
        const oldest = libraryDailyUsage.keys().next().value;
        if (oldest === undefined) break;
        libraryDailyUsage.delete(oldest);
      }
    }
    libraryDailyUsage.set(deviceId, { date: today, count: 1 });
    return next();
  }
  if (record.count >= LIBRARY_DAILY_LIMIT) {
    return res.status(429).json({ success: false, message: '今日字典下载次数已达上限，请明日再试' });
  }
  record.count += 1;
  return next();
};
router.get('/games/library/download', requireLibraryDeviceAccess, downloadGameLibrary);

router.get('/games/:appId/header', getGameHeaderImage);
router.get('/games/:appId', getGameDetail);

// 一站式元数据与密钥聚合查询
// 密钥类接口设备授权：激活设备直通；未激活设备按「每日免费入库配额」放行
// （按 AppID 维度计数，同一 AppID 当天重复请求不重复扣），额度耗尽返回 403。
// 防止客户端激活拦截被绕过后无限制直接调用云端接口拿走密钥
const requireKeyAccess = (req: Request, res: Response, next: any) => {
  // 优先读取请求头（减少 deviceId 经 URL 泄露到访问日志），兼容旧客户端 query 传参
  const headerId = typeof req.headers['x-device-id'] === 'string' ? req.headers['x-device-id'] : '';
  const deviceId = String(headerId || req.query.deviceId || '').trim();
  if (!deviceId || deviceId.length > 128) {
    return res.status(401).json({ success: false, message: '缺少或非法的 deviceId，请升级客户端后使用' });
  }
  const info = licenseService.verify(deviceId);
  if (info.isActivated) {
    return next();
  }
  // 未激活：免费配额检查。带 :appId 参数的路由按 AppID 计数；
  // 其余密钥类路由（如 manifest 文件下载、单 depotKey、OST 中转）按「当日不同 depotId」计数
  const quotaExhausted = { success: false, message: '', data: { quotaExhausted: true, remaining: 0 } };
  // 二级 IP 限制：同 IP 每日最多 30 台独立未激活设备，防止批量伪造 deviceId 刷免费配额
  if (!freeQuotaService.consumeIpDevice(req.ip || '', deviceId)) {
    quotaExhausted.message = '当前网络环境下免费设备数已达上限，请激活后使用';
    return res.status(403).json(quotaExhausted);
  }
  const appIdRaw = req.params && req.params.appId ? String(req.params.appId) : '';
  const appId = parseInt(appIdRaw, 10);
  if (!isNaN(appId) && appId > 0) {
    const r = freeQuotaService.checkAndConsume(deviceId, appId);
    if (!r.allowed) {
      quotaExhausted.message = r.message || '今日免费入库额度已用完，请激活后使用';
      return res.status(403).json(quotaExhausted);
    }
    res.setHeader('X-Free-Quota-Remaining', String(r.remaining));
    return next();
  }
  // 无 appId 的密钥类路由：按「当日不同 depotId」扣减配额（每日最多 100 个不同 depotId）
  const depotId = String(
    (req.params && (req.params.depotId || req.params.asset || req.params.tag)) || 'ost:latest'
  ).trim();
  if (freeQuotaService.consumeKeyAccess(deviceId, depotId)) {
    return next();
  }
  quotaExhausted.message = '今日免费入库额度已用完，请激活后使用';
  return res.status(403).json(quotaExhausted);
};

router.get('/metadata/:appId', requireKeyAccess, getGameMetadata);

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
    console.error('[Routes] 统计查询异常:', e);
    res.status(500).json({ success: false, message: '服务器内部错误' });
  }
});

// DepotKey 密钥查询
router.get('/depots/:appId', requireKeyAccess, getDepotsForGame);
router.get('/depots/key/:depotId', requireKeyAccess, getSingleDepotKey);

// AccessToken 令牌查询
router.get('/tokens/stats', getTokensStats);
router.get('/tokens/:appId', requireKeyAccess, getTokenForApp);

// Manifest 清单检索与下载（与密钥接口同一设备授权：绕过激活不得直接拉取清单）
router.get('/manifests/:appId', requireKeyAccess, getManifestsForApp);
router.get('/manifests/download/:depotId/:manifestId', requireKeyAccess, downloadManifestFile);

// OST 内核中转：客户端 GitHub 完全不可达时的最终兜底（查询最新版本 / 流式转发 release 包）
router.get('/ost/latest', requireKeyAccess, getLatestOstRelease);
router.get('/ost/download/:tag/:asset', requireKeyAccess, downloadOstAsset);

// 卡密激活/验签/迁移：公开接口但限流防爆破
const activateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '激活请求过于频繁，请稍后再试' }
});
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '验签请求过于频繁，请稍后再试' }
});
// 设备授权状态查询：仅凭 deviceId 即可调用，必须重限流防探测枚举
const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '状态查询过于频繁，请稍后再试' }
});

// 客户端设备码绑定与激活码验证 (公开接口)
router.post('/license/activate', activateLimiter, activateLicense);
router.post('/license/verify', verifyLimiter, verifyLicense);
router.post('/license/rebind', activateLimiter, rebindLicense);
router.get('/license/status/:deviceId', statusLimiter, getDeviceLicenseStatus);
router.get('/license/pubkey', (req: Request, res: Response) => {
  res.json({ success: true, data: { publicKeyHex: licenseSignService.getPublicKeyRawHex() } });
});

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

// 应用内跳转链接配置 (管理端)
router.post('/admin/links', updateAppLinks);

// 客户端设备管理与活跃度监控
router.get('/admin/devices/list', (req, res) => {  const page = parseInt(req.query.page as string, 10) || 1;
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
// 删除单条设备档案：仅清理监控记录，不影响卡密库授权绑定（设备上线自动重建）
router.delete('/admin/devices/:deviceId', (req, res) => {
  const deviceId = String(req.params.deviceId || '').trim();
  if (!deviceId || deviceId.length > 128) {
    return res.status(400).json({ success: false, message: '缺少或非法的 deviceId' });
  }
  const operator = (req as any).adminUser?.username || 'admin';
  const removed = deviceService.deleteDevice(deviceId);
  if (!removed) {
    return res.status(404).json({ success: false, message: '设备档案不存在或已被删除' });
  }
  authService.recordAuditLog({
    action: 'DEVICE_DELETE',
    operator,
    ip: req.socket.remoteAddress || '127.0.0.1',
    details: `删除设备档案: ${deviceId}（不影响其授权绑定）`,
    success: true
  });
  res.json({ success: true, message: '设备档案已删除（授权绑定不受影响）' });
});
// 批量清理 N 天以上未活跃的设备档案
router.post('/admin/devices/cleanup', (req, res) => {
  const days = parseInt(req.body?.days, 10);
  const inactiveDays = isNaN(days) ? 30 : Math.min(365, Math.max(1, days));
  const operator = (req as any).adminUser?.username || 'admin';
  const removed = deviceService.deleteInactiveDevices(inactiveDays);
  authService.recordAuditLog({
    action: 'DEVICE_CLEANUP',
    operator,
    ip: req.socket.remoteAddress || '127.0.0.1',
    details: `批量清理 ${inactiveDays} 天未活跃设备档案: ${removed} 台`,
    success: true
  });
  res.json({ success: true, message: `已清理 ${inactiveDays} 天以上未活跃设备 ${removed} 台`, data: { removed } });
});

// 全局运行时设置（未激活每日免费额度）与应用内跳转链接
router.get('/admin/settings', getSettingsAdmin);
router.post('/admin/settings/free-quota', updateFreeQuotaLimitAdmin);
// 管理端读取链接配置（更新复用下方 POST /admin/links）
router.get('/admin/links', (req, res) => {
  res.json({ success: true, data: appLinksService.getLinks() });
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
