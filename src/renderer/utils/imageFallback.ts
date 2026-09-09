/**
 * 游戏封面多 CDN 智能保底分发引擎
 * 对标 Fluent Steam / SteamTools 官方集群：
 * 1. Store API (Fastly 默认节点)
 * 2. Akamai 主节点
 * 3. Akamai 备用节点
 * 4. Cloudflare CDN 节点
 * 5. Akamai 大图 / 官方基础通用节点
 * 
 * 在静默无感（界面无需多余选项）的前提下，实现全自动的多 CDN 节点轮询与分辨率降级保底：
 * capsule_616 / capsule_184 -> header.jpg -> 官方占位，彻底杜绝红叉破图与死循环。
 */

export interface SteamCdnNode {
  id: string;
  name: string;
  base: string;
}

export const STEAM_IMAGE_CDNS: SteamCdnNode[] = [
  {
    id: 'fastly',
    name: 'Store API (默认节点)',
    base: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps'
  },
  {
    id: 'akamai_primary',
    name: 'Akamai 主节点',
    base: 'https://cdn.akamai.steamstatic.com/steam/apps'
  },
  {
    id: 'akamai_backup',
    name: 'Akamai 备用',
    base: 'https://steamcdn-a.akamaihd.net/steam/apps'
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare CDN',
    base: 'https://cdn.cloudflare.steamstatic.com/steam/apps'
  },
  {
    id: 'akamai_large',
    name: 'Akamai 大图 / 官方通用',
    base: 'https://cdn.steamstatic.com/steam/apps'
  }
];

export const STEAM_FALLBACK_LOGO =
  'https://store.cloudflare.steamstatic.com/public/shared/images/header/globalheader_logo.png';

/**
 * 获取指定游戏在指定 CDN 上的图片 URL
 */
export function getSteamCdnImageUrl(appId: number, asset = 'header.jpg', cdnIndex = 0): string {
  const node = STEAM_IMAGE_CDNS[cdnIndex % STEAM_IMAGE_CDNS.length];
  return `${node.base}/${appId}/${asset}`;
}

/**
 * 获取游戏封面主图的默认最佳地址（Store API 优先）
 */
export function getPrimaryGameHeader(appId: number): string {
  return getSteamCdnImageUrl(appId, 'header.jpg', 0);
}

/**
 * 获取游戏大胶囊卡片图
 */
export function getPrimaryGameCapsule(appId: number): string {
  return getSteamCdnImageUrl(appId, 'capsule_616x353.jpg', 0);
}

/**
 * 获取游戏小胶囊图（库列表小图）
 */
export function getPrimarySmallCapsule(appId: number): string {
  return getSteamCdnImageUrl(appId, 'capsule_184x69.jpg', 0);
}

const realHeaderCache = new Map<number, string>();

/**
 * 动态解析 Steam 新版带 Content-Hash 的封面图
 * （针对新发布、独立游戏没有静态通用 header.jpg 的情况，直接通过第三方公共免费接口获取真实封面）
 * 注意：严格执行客户端直连第三方，严禁通过用户自有云端中继图片或请求，确保云端零带宽消耗
 */
export async function resolveRealGameHeader(appId: number): Promise<string | null> {
  if (!appId || appId <= 0) return null;
  if (realHeaderCache.has(appId)) return realHeaderCache.get(appId)!;

  // 1. 优先使用第三方公共免费的 SteamCMD 元数据接口 (直连第三方，零占用用户云端带宽，国内免翻墙直通)
  try {
    const res = await fetch(`https://api.steamcmd.net/v1/info/${appId}`, {
      signal: AbortSignal.timeout(3500)
    });
    if (res.ok) {
      const json = await res.json();
      const common = json?.data?.[String(appId)]?.common;
      const libraryAssets = common?.library_assets_full?.library_header?.image;
      const relPath =
        common?.header_image?.schinese ||
        common?.header_image?.english ||
        libraryAssets?.schinese ||
        libraryAssets?.english ||
        common?.small_capsule?.schinese ||
        common?.small_capsule?.english;
      if (relPath && typeof relPath === 'string') {
        const url = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/${relPath}`;
        realHeaderCache.set(appId, url);
        return url;
      }
    }
  } catch {}

  // 2. 备用直接从 Steam 官方公共网关获取公开元数据（客户端直接发起）
  try {
    const res = await fetch(
      `https://store.cloudflare.steamstatic.com/api/appdetails?appids=${appId}&filters=basic`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (res.ok) {
      const json = await res.json();
      const header = json?.[String(appId)]?.data?.header_image;
      if (header && typeof header === 'string') {
        realHeaderCache.set(appId, header);
        return header;
      }
    }
  } catch {}

  return null;
}

/**
 * 多 CDN 智能保底轮询核心实现
 * 流程：
 * 1. 尝试当前分辨率资源在 5 大 CDN 节点的依次轮询
 * 2. 若当前分辨率所有 CDN 均失败，自动降级切换至高兼容度的 `header.jpg` 并重新轮询 5 大 CDN
 * 3. 若所有静态 CDN 均为 404（新游戏 Valve Asset Hash 机制），触发动态哈希封面自动解析
 * 4. 若最终均不可达，优雅展示官方安全占位图并终止重试
 */
export function smartMultiCdnImageFallback(
  e: Event,
  appId: number,
  initialAsset = 'header.jpg'
): void {
  const target = e.target as HTMLImageElement;
  if (!target || target.tagName !== 'IMG') return;

  // 终态熔断保护：已彻底失败或无有效 AppID，直接给占位图并锁定，防止死循环
  if (target.dataset.fallbackDone === '1' || !appId || appId <= 0) {
    target.src = STEAM_FALLBACK_LOGO;
    target.dataset.fallbackDone = '1';
    return;
  }

  const assetStages = [initialAsset];
  if (initialAsset !== 'header.jpg') {
    assetStages.push('header.jpg');
  }
  if (initialAsset !== 'capsule_231x87.jpg') {
    assetStages.push('capsule_231x87.jpg');
  }

  let stageIdx = Number(target.dataset.assetStage || '0');
  let cdnIdx = Number(target.dataset.cdnIndex || '0');

  // 尝试同一个资产在下一个 CDN 节点
  if (cdnIdx + 1 < STEAM_IMAGE_CDNS.length) {
    cdnIdx += 1;
    target.dataset.cdnIndex = String(cdnIdx);
    const asset = assetStages[stageIdx] || 'header.jpg';
    target.src = getSteamCdnImageUrl(appId, asset, cdnIdx);
    return;
  }

  // 当前资产在所有 5 个 CDN 都失败，尝试切换到下一个备选分辨率资产
  if (stageIdx + 1 < assetStages.length) {
    stageIdx += 1;
    cdnIdx = 0;
    target.dataset.assetStage = String(stageIdx);
    target.dataset.cdnIndex = String(cdnIdx);
    const asset = assetStages[stageIdx];
    target.src = getSteamCdnImageUrl(appId, asset, cdnIdx);
    return;
  }

  // 所有标准静态 CDN 路径均 404：针对新版 Valve 带 Hash 机制的游戏发起动态封面解析
  if (target.dataset.hashResolved !== '1') {
    target.dataset.hashResolved = '1';
    resolveRealGameHeader(appId)
      .then((realUrl) => {
        if (realUrl) {
          target.src = realUrl;
        } else {
          target.dataset.fallbackDone = '1';
          target.src = STEAM_FALLBACK_LOGO;
        }
      })
      .catch(() => {
        target.dataset.fallbackDone = '1';
        target.src = STEAM_FALLBACK_LOGO;
      });
    return;
  }

  // 所有资产在所有 CDN 均无法加载：转为官方安全兜底 Logo
  target.dataset.fallbackDone = '1';
  target.src = STEAM_FALLBACK_LOGO;
}

/** 直接落到 Steam 占位 logo（单步兜底），带守卫防 404 循环 */
export function applyImageFallback(e: Event, appId?: number): void {
  if (appId && appId > 0) {
    smartMultiCdnImageFallback(e, appId, 'header.jpg');
  } else {
    const target = e.target as HTMLImageElement;
    if (!target || target.tagName !== 'IMG') return;
    if (target.dataset.fallbackDone === '1') return;
    target.dataset.fallbackDone = '1';
    target.src = STEAM_FALLBACK_LOGO;
  }
}

/** Steam 卡片两步兜底（保留方法签名向前兼容，底层已升级为 5 大 CDN 矩阵保底） */
export function steamCardImageFallback(e: Event, appId: number): void {
  smartMultiCdnImageFallback(e, appId, 'capsule_616x353.jpg');
}


