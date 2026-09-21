import { Request, Response } from 'express';
import axios from 'axios';

interface CheatItem {
  raw: string;
  hotkey: string;
  descriptionEn: string;
  descriptionZh: string;
}

interface TrainerMatchData {
  matched: boolean;
  postTitle?: string;
  postUrl?: string;
  publishedAt?: string;
  version?: string;
  downloadUrl?: string;
  directDownloadUrl?: string;
  cheatsCount?: number;
  cheats?: CheatItem[];
}

// 内存缓存 24 小时
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const trainerCache = new Map<string, { data: TrainerMatchData; timestamp: number }>();

// 常见修改项高频英文词汇中英映射字典
const CHEAT_TRANSLATIONS: Array<[RegExp, string]> = [
  [/infinite\s+health/i, '无限生命'],
  [/god\s+mode/i, '无敌模式 / 锁血'],
  [/infinite\s+stamina/i, '无限耐力/体力'],
  [/infinite\s+mana|infinite\s+mp|infinite\s+fp/i, '无限法力/专注值'],
  [/infinite\s+items?|unlimited\s+items?/i, '无限道具/物品'],
  [/infinite\s+ammo|unlimited\s+ammo/i, '无限弹药'],
  [/no\s+reload/i, '无需装弹'],
  [/items?\s+won'?t\s+decrease/i, '道具数量不减'],
  [/healing\s+items?\s+no\s+cooldown/i, '治疗物品无冷却'],
  [/one\s+hit\s+kill|instant\s+kill/i, '一击必杀'],
  [/damage\s+multiplier/i, '伤害倍率调节'],
  [/defense\s+multiplier/i, '防御倍率调节'],
  [/set\s+player\s+speed/i, '设定玩家移速'],
  [/set\s+game\s+speed/i, '设定游戏速度'],
  [/super\s+jump/i, '超级跳跃'],
  [/infinite\s+jumps?/i, '无限连跳'],
  [/stealth\s+mode|invisible/i, '隐匿潜行 / 不被发现'],
  [/infinite\s+(?:money|gold|credits|cash|currency)/i, '无限金钱/货币'],
  [/infinite\s+(?:exp|experience)/i, '无限经验值'],
  [/exp\s+multiplier/i, '经验倍率调节'],
  [/zero\s+weight|max\s+weight/i, '负重清零 / 最大负重'],
  [/ignore\s+crafting\s+requirements/i, '无视制作/锻造需求'],
  [/easy\s+crafting/i, '简易制作'],
  [/freeze\s+daytime|freeze\s+timer?/i, '时间静止 / 冻结倒计时'],
  [/no\s+cooldown/i, '技能无冷却'],
  [/maximum\s+stats?/i, '属性全满'],
  [/infinite\s+durability/i, '装备无限耐久'],
  [/edit\s+(?:money|gold|credits)/i, '编辑金钱数额'],
  [/set\s+fly\s+speed/i, '设定飞行速度'],
  [/set\s+fly\s+height/i, '设定飞行高度']
];

function translateCheat(en: string): string {
  for (const [regex, zh] of CHEAT_TRANSLATIONS) {
    if (regex.test(en)) {
      return zh;
    }
  }
  return en;
}

function parseCheatsFromHtml(html: string): CheatItem[] {
  const items: CheatItem[] = [];
  // 去除 html 标签前把换行与段落分割
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/p>|<br\s*\/?>|<li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#8211;|–|—/g, '-');

  const lines = clean.split('\n');
  const hotkeyRegex = /^((?:(?:Shift|Ctrl|Alt)\s*\+\s*)?(?:Num\s*[\d\+\-\*\/]|F\d{1,2}|PageUp|PageDown|\d+))\s*[-–:]\s*(.+)$/i;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = line.match(hotkeyRegex);
    if (m) {
      const hotkey = m[1].trim();
      const descEn = m[2].trim();
      items.push({
        raw: line,
        hotkey,
        descriptionEn: descEn,
        descriptionZh: translateCheat(descEn)
      });
    }
  }
  return items;
}

/**
 * 依据游戏名称和 AppID 检索风灵月影官方修改器
 */
export const matchTrainer = async (req: Request, res: Response) => {
  const appId = req.query.appId ? String(req.query.appId).trim() : '';
  const rawName = req.query.name ? String(req.query.name).trim() : '';

  if (!rawName && !appId) {
    return res.status(400).json({ success: false, message: '请提供游戏名称或 AppID' });
  }

  // 清洗游戏英文名称：过滤掉特殊注册商标符号
  let cleanName = rawName
    .replace(/[\u2122\u00AE\u00A9]/g, '') // ™ ® ©
    .replace(/[:\-–—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const cacheKey = `trainer:${appId || cleanName.toLowerCase()}`;
  const cached = trainerCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return res.json({ success: true, data: cached.data });
  }

  try {
    // 1. 调用 FLiNG REST API 检索文章列表
    const searchUrl = `https://flingtrainer.com/wp-json/wp/v2/posts?search=${encodeURIComponent(cleanName)}&per_page=5`;
    const searchResp = await axios.get(searchUrl, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const posts = Array.isArray(searchResp.data) ? searchResp.data : [];
    if (posts.length === 0) {
      const emptyResult: TrainerMatchData = { matched: false };
      trainerCache.set(cacheKey, { data: emptyResult, timestamp: Date.now() });
      return res.json({ success: true, data: emptyResult });
    }

    // 选取最契合的文章（优先标题中含有 Trainer）
    const matchedPost = posts.find((p) => /trainer/i.test(p.title?.rendered || '')) || posts[0];
    const postTitle = (matchedPost.title?.rendered || '').replace(/&#8211;/g, '-').trim();
    const postUrl = matchedPost.link;
    const publishedAt = matchedPost.date;
    const contentHtml = matchedPost.content?.rendered || '';

    // 2. 解析修改项列表
    const cheats = parseCheatsFromHtml(contentHtml);

    // 3. 从 HTML 页面中提取下载链接
    let latestVersion = '';
    let latestDownloadPageUrl = '';
    let directDownloadUrl = '';

    try {
      const pageResp = await axios.get(postUrl, {
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://flingtrainer.com/'
        }
      });
      const pageHtml = typeof pageResp.data === 'string' ? pageResp.data : '';

      // 提取所有下载链接: <a href="https://flingtrainer.com/downloads/...">Cyberpunk.2077.v2.0...</a>
      const dlMatches = [...pageHtml.matchAll(/<a[^>]+href="(https:\/\/flingtrainer\.com\/downloads\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)];
      if (dlMatches.length > 0) {
        latestDownloadPageUrl = dlMatches[0][1];
        latestVersion = dlMatches[0][2].replace(/<[^>]+>/g, '').trim();

        // 跟踪 302 重定向获取直链
        try {
          const redirResp = await axios.get(latestDownloadPageUrl, {
            timeout: 6000,
            maxRedirects: 0,
            validateStatus: (s) => s >= 300 && s < 400,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
              Referer: postUrl
            }
          });
          const loc = redirResp.headers.location;
          if (loc) {
            directDownloadUrl = loc.startsWith('http') ? loc : `https://flingtrainer.com${loc}`;
          }
        } catch {
          // 若追踪重定向失败，保留 downloadPageUrl
        }
      }
    } catch {
      // 页面提取异常时容错降级
    }

    const resultData: TrainerMatchData = {
      matched: true,
      postTitle,
      postUrl,
      publishedAt,
      version: latestVersion || postTitle,
      downloadUrl: latestDownloadPageUrl || postUrl,
      directDownloadUrl: directDownloadUrl || latestDownloadPageUrl,
      cheatsCount: cheats.length,
      cheats
    };

    trainerCache.set(cacheKey, { data: resultData, timestamp: Date.now() });
    return res.json({ success: true, data: resultData });
  } catch (err: any) {
    console.error('[TrainerController] 检索修改器异常:', err?.message || err);
    return res.status(502).json({
      success: false,
      message: `FLiNG 修改器检索服务暂时不可达: ${err?.message || '网络超时'}`
    });
  }
};

/**
 * 修改器流式中转下载（针对直连受限或需保持 Referer 的环境）
 */
export const downloadTrainerProxy = async (req: Request, res: Response) => {
  const targetUrl = req.query.url ? String(req.query.url) : '';
  const referer = req.query.referer ? String(req.query.referer) : 'https://flingtrainer.com/';

  if (!targetUrl || !/^https?:\/\/flingtrainer\.com\//i.test(targetUrl)) {
    return res.status(400).json({ success: false, message: '非法的修改器下载地址' });
  }

  try {
    const upstream = await axios.get(targetUrl, {
      timeout: 60000,
      responseType: 'stream',
      maxRedirects: 5,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: referer
      }
    });

    const contentType = upstream.headers['content-type'];
    if (contentType) res.setHeader('Content-Type', String(contentType));
    const contentDisposition = upstream.headers['content-disposition'];
    if (contentDisposition) res.setHeader('Content-Disposition', String(contentDisposition));
    const contentLength = upstream.headers['content-length'];
    if (contentLength) res.setHeader('Content-Length', String(contentLength));

    upstream.data.on('error', (e: any) => {
      console.error('[TrainerController] 上游传输中断:', e?.message || e);
      res.destroy();
    });

    res.on('close', () => {
      upstream.data.destroy();
    });

    upstream.data.pipe(res);
  } catch (err: any) {
    console.error('[TrainerController] 代理下载修改器失败:', err?.message || err);
    if (!res.headersSent) {
      res.status(502).json({ success: false, message: '代理下载失败' });
    } else {
      res.destroy();
    }
  }
};
