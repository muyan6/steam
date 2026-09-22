/**
 * 春风渡 商业版应用核心配置
 */

export const APP_CONFIG = {
  APP_NAME: '春风渡',

  /**
   * 应用版本号：构建期由 vite.config.ts 从 src-tauri/tauri.conf.json 注入。
   *
   * 严禁在此手写常量 —— 该值会作为「当前版本」上报给服务端检查更新接口，
   * 一旦与真实发布版本漂移，装完新版的用户会被无限提示更新
   * （2026-09 事故：2.7.7 发布时漏改此处，客户端始终自称 2.7.6）。
   */
  VERSION: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.0.0-dev',

  // 云端官方服务器地址。
  //
  // 权限说明：src-tauri/capabilities/default.json 的 http:allow-fetch 现为
  // `https://*` 通配（客户端需要直连 FLiNG 与 Steam Community 抓取数据），
  // 因此**不再**需要为新增域名单独维护白名单。明文 `http://*` 已被刻意移除 ——
  // 客户端没有任何必须走明文 HTTP 的目标，保留它只会让 XSS 具备降级外发能力。
  API_BASE_URL: 'https://steam.myil.top',

  REQUEST_TIMEOUT_MS: 8000
};
