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

/**
 * 多 CDN 智能保底轮询核心实现
 * 流程：
 * 1. 尝试当前分辨率资源在 5 大 CDN 节点的依次轮询
 * 2. 若当前分辨率所有 CDN 均失败，自动降级切换至高兼容度的 `header.jpg` 并重新轮询 5 大 CDN
 * 3. 若全部 CDN 与备用分辨率均不可达，优雅展示官方安全占位图并终止重试
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

