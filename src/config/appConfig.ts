/**
 * SteamMaster 商业版应用核心配置
 */

const isDev = process.env.NODE_ENV !== 'production' || !process.env.NODE_ENV;

export const APP_CONFIG = {
  APP_NAME: 'SteamMaster',
  VERSION: '1.0.0',
  
  // 云端官方服务器地址
  // 开发模式下自动走 127.0.0.1:3000，编译打包生产环境走云端服务器地址
  API_BASE_URL: isDev 
    ? 'http://127.0.0.1:3000' 
    : 'http://127.0.0.1:3000', // 部署到服务器后，在此填入你的正式服务器公网 IP 或域名，如 'http://1.2.3.4:3000'

  REQUEST_TIMEOUT_MS: 8000
};
