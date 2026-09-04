import { Router } from 'express';
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

const router = Router();

// ==================== 1. 公开客户端 API ====================

// 健康与统计
router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// 管理员登录（公开接口，带防爆破保护）
router.post('/auth/login', login);

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
router.get('/metadata/:appId', getGameMetadata);

// DepotKey 密钥查询
router.get('/depots/:appId', getDepotsForGame);
router.get('/depots/key/:depotId', getSingleDepotKey);

// AccessToken 令牌查询
router.get('/tokens/stats', getTokensStats);
router.get('/tokens/:appId', getTokenForApp);

// Manifest 清单检索与下载
router.get('/manifests/:appId', getManifestsForApp);
router.get('/manifests/download/:depotId/:manifestId', downloadManifestFile);

// 客户端设备码绑定与激活码验证 (公开接口)
router.post('/license/activate', activateLicense);
router.post('/license/verify', verifyLicense);
router.get('/license/status/:deviceId', getDeviceLicenseStatus);

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
