export interface SteamGame {
  appId: number;
  name: string;
  nameZh?: string;
  pinyin?: string;
  bannerUrl?: string;
  headerUrl?: string;
  description?: string;
  releaseDate?: string;
  depots?: { [depotId: number]: string };
  dlcs?: number[];
  installed?: boolean;
  unlocked?: boolean;
  type?: 'game' | 'dlc' | 'tool';
}

export type SearchSourceId = 'steam_official' | 'cloud_db' | 'steam_community' | 'hybrid' | 'local_db';

export interface SearchSourceConfig {
  id: SearchSourceId;
  name: string;
  nameEn: string;
  desc: string;
  badge: string;
}

export interface SearchPaginationParams {
  query?: string;
  source?: SearchSourceId;
  page?: number;
  pageSize?: number;
}

export interface SearchPaginationResult {
  items: SteamGame[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  source: SearchSourceId;
  sourceName: string;
}

export interface CompactGame {
  appId: number;
  name: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'popup' | 'banner' | 'notification';
  level?: 'info' | 'warning' | 'danger' | 'success';
  priority?: number; // 优先级：数字越大越靠前
  popupOnce: boolean; // 是否只弹出一次
  interaction?: 'confirm' | 'consent'; // 交互方式：confirm=普通通知(仅"我知道了")，consent=强制同意/拒绝(拒绝退出)
  link?: string;
  targetVersion?: string; // 目标生效版本，例如 '*' 或 '>=1.0.0'
  enabled: boolean;
  startTime?: string; // 定时开始时间 (ISO)
  endTime?: string; // 定时结束时间 (ISO)
  createdAt: string;
  updatedAt: string;
}

export interface VersionRelease {
  version: string;
  channel?: 'stable' | 'beta' | 'preview';
  releaseDate: string;
  title: string;
  changelog: string[];
  downloadUrl: string;
  downloadUrlBackup?: string;
  forceUpdate: boolean; // 是否强制更新
  minSupportedVersion: string;
  fileSize?: string;
  sha256?: string;
  enabled?: boolean;
  downloadCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

// 保持与旧版 VersionInfo 的向下兼容引用
export type VersionInfo = VersionRelease;

export interface ServerStats {
  status: string;
  uptimeSeconds: number;
  gamesCount: number;
  depotKeysCount: number;
  tokensCount?: number;
  memoryUsageMb: number;
  nodeVersion: string;
  noticesCount?: number;
  activeNoticesCount?: number;
  versionsCount?: number;
}

export interface AdminCredentials {
  username: string;
  passwordHash: string;
  salt: string;
  updatedAt: string;
  /** 递增后使所有旧 JWT 失效（修改密码时递增） */
  tokenVersion?: number;
  /** PBKDF2 迭代次数；历史凭据无此字段时视为 10000，登录成功后透明升级 */
  pbkdf2Iterations?: number;
}

export interface AdminUser {
  username: string;
  role: 'superadmin' | 'admin';
  lastLoginAt?: string;
  lastLoginIp?: string;
}

export interface AuthTokenPayload {
  username: string;
  role: string;
  iat: number;
  exp: number;
  /** tokenVersion：修改密码后递增，使旧 token 失效 */
  tv?: number;
}

export interface AuditLog {
  id: string;
  action: string;
  operator: string;
  ip: string;
  userAgent?: string;
  details?: string;
  timestamp: string;
  success: boolean;
}

export interface PushUpdateRecord {
  id: string;
  version: string;
  targetChannel: string;
  title: string;
  content: string;
  pushedAt: string;
  operator: string;
}

export interface ManifestServerNode {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  isRecommended: boolean;
  status: 'online' | 'degraded' | 'offline';
  latencyMs?: number;
}

export interface ToolboxRepairLog {
  id: string;
  actionType: 'clear_cache' | 'repair_kernel' | 'fill_sha256' | 'auto_switch_manifest';
  success: boolean;
  deviceId?: string;
  ip?: string;
  details?: string;
  timestamp: string;
}

export interface ToolboxStatsResponse {
  totalRepairs: number;
  clearCacheCount: number;
  repairKernelCount: number;
  fillSha256Count: number;
  autoSwitchCount: number;
  nodes: ManifestServerNode[];
}

export interface SpacewarStatus {
  isInstalled: boolean;
  path?: string;
  appName?: string;
  appId: number;
}

export interface OnlineFixMetadata {
  fakeAppId: number;
  fakeAppName: string;
  recommendedMode: 'onlinefix_global' | 'spacewar_single' | 'goldberg_lan';
  docUrl?: string;
}

export interface SponsorItem {
  id: string;             // 爱发电 user_id 或本地唯一ID
  name: string;           // 昵称
  avatar: string;         // 头像图片链接
  allSumAmount: number;   // 累计赞助金额 (元)
  planTitle?: string;     // 方案名称 (如 "终身赞助" / "月度支持" / "爱心发电")
  lastPayTime: string;    // 最后赞助日期 (YYYY-MM-DD 或 ISO)
  firstPayTime?: string;  // 首次赞助时间
  rank?: number;          // 排名
  isLifetime?: boolean;   // 是否终身
  comment?: string;       // 留言寄语
}

export interface SponsorDataResponse {
  totalCount: number;
  totalAmount: number;
  updatedAt: string;
  source: 'afdian' | 'cache' | 'fallback';
  sponsorUrl?: string;
  sponsors: SponsorItem[];
}

export interface AfdianConfig {
  userId: string;
  token: string;
  autoSync: boolean;
  syncIntervalMinutes: number;
  sponsorUrl: string;
  updatedAt: string;
}

