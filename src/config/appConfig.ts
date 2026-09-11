/**
 * 春风渡 商业版应用核心配置
 */

export const APP_CONFIG = {
  APP_NAME: '春风渡',
  VERSION: '2.7.2',

  // 云端官方服务器地址
  // 注意：修改此地址须同步更新 src-tauri/capabilities/default.json 的
  // http:allow-fetch 主机白名单，否则前端 fetch 将被拒绝
  API_BASE_URL: 'https://steam.myil.top',

  REQUEST_TIMEOUT_MS: 8000
};
