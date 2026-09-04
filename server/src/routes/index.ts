import { Router } from 'express';
import { getPopularGames, searchGames, getGameDetail, getGameHeaderImage } from '../controllers/gameController.js';
import { getDepotsForGame, getSingleDepotKey } from '../controllers/depotController.js';
import { getGameMetadata } from '../controllers/metadataController.js';
import { getTokenForApp, getTokensStats } from '../controllers/tokenController.js';
import { getManifestsForApp, downloadManifestFile } from '../controllers/manifestController.js';
import { getLatestNotice } from '../controllers/noticeController.js';
import { checkVersion, getLatestVersionInfo } from '../controllers/versionController.js';
import {
  requireAdmin,
  updateNotice,
  updateVersion,
  triggerSyncGames,
  triggerSyncDepots,
  triggerSyncTokens,
  triggerSyncAll,
  getServerStats
} from '../controllers/adminController.js';

const router = Router();

// ==================== 1. 公开客户端 API ====================

// 健康与统计
router.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// 商业版：公告通知
router.get('/notice/latest', getLatestNotice);

// 商业版：版本检测与自动更新
router.get('/version/check', checkVersion);
router.get('/version/latest', getLatestVersionInfo);

// 游戏库检索与详情
router.get('/games/popular', getPopularGames);
router.get('/games/search', searchGames);
router.get('/games/:appId/header', getGameHeaderImage);
router.get('/games/:appId', getGameDetail);

// 一站式元数据与密钥聚合查询 (客户端一键入库专属按需接口)
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

// ==================== 2. 运营管理 API (需要 x-admin-key) ====================

router.use('/admin', requireAdmin);
router.get('/admin/stats', getServerStats);
router.post('/admin/notice', updateNotice);
router.post('/admin/version', updateVersion);
router.post('/admin/sync/games', triggerSyncGames);
router.post('/admin/sync/depots', triggerSyncDepots);
router.post('/admin/sync/tokens', triggerSyncTokens);
router.post('/admin/sync/all', triggerSyncAll);

export default router;
