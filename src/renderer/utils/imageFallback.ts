/**
 * 游戏封面加载失败统一兜底工具。
 * 此前 LibraryView / OnlineFixView / SearchView 各自实现且守卫不完整，
 * OnlineFixView 在 logo 也 404 时会重新设回 header.jpg 形成
 * error→请求→error 无限循环；统一用 dataset 记录阶段并设上限。
 */

const STEAM_FALLBACK_LOGO =
  'https://store.cloudflare.steamstatic.com/public/shared/images/header/globalheader_logo.png';

/** 直接落到 Steam 占位 logo（单步兜底），带守卫防 404 循环 */
export function applyImageFallback(e: Event): void {
  const target = e.target as HTMLImageElement;
  if (!target || target.tagName !== 'IMG') return;
  if (target.dataset.fallbackTried === '1') return;
  target.dataset.fallbackTried = '1';
  target.src = STEAM_FALLBACK_LOGO;
}

/** Steam 卡片两步兜底：capsule → header.jpg → 占位 logo，阶段封顶防循环 */
export function steamCardImageFallback(e: Event, appId: number): void {
  const target = e.target as HTMLImageElement;
  if (!target || target.tagName !== 'IMG') return;
  const stage = Number(target.dataset.fallbackStage || '0');
  if (stage >= 2) return;
  target.dataset.fallbackStage = String(stage + 1);
  target.src =
    stage === 0
      ? `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`
      : STEAM_FALLBACK_LOGO;
}
