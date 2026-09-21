import { Request, Response } from 'express';
import axios from 'axios';

export interface AchievementItem {
  name?: string;
  title: string;
  description: string;
  icon: string;
  percent: string;
}

export interface GameAchievementsData {
  appId: number;
  count: number;
  achievements: AchievementItem[];
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const achievementCache = new Map<string, { data: GameAchievementsData; timestamp: number }>();

const SAM_REPO = 'gibbed/SteamAchievementManager';

/**
 * 获取指定游戏的 Steam 官方全量成就列表
 */
export const getGameAchievements = async (req: Request, res: Response) => {
  const appId = parseInt(String(req.params.appId || req.query.appId || '0'), 10);
  const lang = String(req.query.lang || 'schinese');

  if (!appId || isNaN(appId) || appId <= 0) {
    return res.status(400).json({ success: false, message: '无效的 AppID' });
  }

  const cacheKey = `achievements:${appId}:${lang}`;
  const cached = achievementCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.json({ success: true, data: cached.data });
  }

  try {
    // 1. 尝试从 Steam Community 页面抓取（包含高清图标、本地化中英文名称、描述及全球达成率）
    const communityUrl = `https://steamcommunity.com/stats/${appId}/achievements/?l=${encodeURIComponent(lang)}`;
    const resp = await axios.get(communityUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        Cookie: `Steam_Language=${encodeURIComponent(lang)}`
      }
    });

    const html = typeof resp.data === 'string' ? resp.data : '';
    const achievements: AchievementItem[] = [];

    // 正则解析 achieveRow
    const rowRegex = /<div class="achieveRow\s*">([\s\S]*?)<div style="clear: both;"><\/div>/g;
    let match;
    while ((match = rowRegex.exec(html)) !== null) {
      const block = match[1];
      const imgMatch = block.match(/<img[^>]+src="([^">]+)"/);
      const titleMatch = block.match(/<h3>([\s\S]*?)<\/h3>/);
      const descMatch = block.match(/<h5>([\s\S]*?)<\/h5>/);
      const percentMatch = block.match(/<div class="achievePercent">([^<]+)<\/div>/);

      const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';
      if (!title) continue;

      achievements.push({
        title,
        description: descMatch ? descMatch[1].replace(/<[^>]+>/g, '').trim() : '',
        icon: imgMatch ? imgMatch[1].trim() : '',
        percent: percentMatch ? percentMatch[1].trim() : '0%'
      });
    }

    // 若社区页面成功解析出成就
    if (achievements.length > 0) {
      const resultData: GameAchievementsData = {
        appId,
        count: achievements.length,
        achievements
      };
      achievementCache.set(cacheKey, { data: resultData, timestamp: Date.now() });
      return res.json({ success: true, data: resultData });
    }

    // 2. 备用兜底策略：调用官方免 Key 统计接口获取全球达成率
    const statsUrl = `https://api.steampowered.com/ISteamUserStats/GetGlobalAchievementPercentagesForApp/v0002/?gameid=${appId}`;
    const statsResp = await axios.get(statsUrl, {
      timeout: 8000,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const list = statsResp.data?.achievementpercentages?.achievements;
    if (Array.isArray(list) && list.length > 0) {
      const fallbackItems: AchievementItem[] = list.map((item: any) => ({
        name: String(item.name || ''),
        title: String(item.name || '未命名成就'),
        description: '',
        icon: `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_sm_120.jpg`,
        percent: `${parseFloat(item.percent || '0').toFixed(1)}%`
      }));

      const fallbackData: GameAchievementsData = {
        appId,
        count: fallbackItems.length,
        achievements: fallbackItems
      };
      achievementCache.set(cacheKey, { data: fallbackData, timestamp: Date.now() });
      return res.json({ success: true, data: fallbackData });
    }

    // 若两项均无成就，说明该游戏无成就系统（如纯单机老游戏或未配置成就）
    const emptyData: GameAchievementsData = { appId, count: 0, achievements: [] };
    achievementCache.set(cacheKey, { data: emptyData, timestamp: Date.now() });
    return res.json({ success: true, data: emptyData });
  } catch (err: any) {
    console.error(`[AchievementController] 拉取 AppID ${appId} 成就数据失败:`, err?.message || err);
    return res.status(502).json({
      success: false,
      message: `获取 Steam 成就列表超时或不可达: ${err?.message || '网络波动'}`
    });
  }
};

/**
 * 获取 Steam Achievement Manager (SAM) 最新发行版信息
 */
export const getSamDownloadInfo = async (_req: Request, res: Response) => {
  try {
    const resp = await axios.get(`https://api.github.com/repos/${SAM_REPO}/releases/latest`, {
      timeout: 10000,
      headers: { 'User-Agent': 'chunfengdu-server', Accept: 'application/vnd.github+json' }
    });

    const tag = resp.data?.tag_name || '7.0.25';
    const assets: any[] = Array.isArray(resp.data?.assets) ? resp.data.assets : [];
    const zipAsset = assets.find((a) => typeof a?.name === 'string' && a.name.endsWith('.zip'));

    const downloadUrl = zipAsset?.browser_download_url ||
      `https://github.com/${SAM_REPO}/releases/download/${tag}/SteamAchievementManager-${tag}.zip`;

    res.json({
      success: true,
      data: {
        version: tag,
        assetName: zipAsset?.name || `SteamAchievementManager-${tag}.zip`,
        downloadUrl,
        size: zipAsset?.size || 0,
        publishedAt: resp.data?.published_at
      }
    });
  } catch (err: any) {
    // 降级回退静态发行版信息
    res.json({
      success: true,
      data: {
        version: '7.0.25',
        assetName: 'SteamAchievementManager-7.0.25.zip',
        downloadUrl: `https://github.com/${SAM_REPO}/releases/download/7.0.25/SteamAchievementManager-7.0.25.zip`,
        size: 2600000,
        publishedAt: '2023-01-01T00:00:00Z'
      }
    });
  }
};

/**
 * 代理中转下载 SAM 安装包
 */
export const downloadSamProxy = async (_req: Request, res: Response) => {
  try {
    const url = 'https://github.com/gibbed/SteamAchievementManager/releases/download/7.0.25/SteamAchievementManager-7.0.25.zip';
    const upstream = await axios.get(url, {
      timeout: 120000,
      responseType: 'stream',
      maxRedirects: 5,
      headers: { 'User-Agent': 'chunfengdu-server' }
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="SteamAchievementManager-7.0.25.zip"');

    upstream.data.on('error', (err: any) => {
      console.error('[AchievementController] SAM 下载流出错:', err?.message || err);
      res.destroy();
    });

    res.on('close', () => {
      upstream.data.destroy();
    });

    upstream.data.pipe(res);
  } catch (e: any) {
    console.error('[AchievementController] 中转下载 SAM 失败:', e.message);
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: '下载 SAM 失败，请稍后重试' });
    } else {
      res.destroy();
    }
  }
};
