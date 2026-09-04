export type AppThemeId = 'midnight' | 'neon' | 'emerald' | 'frost' | 'dawn' | 'mint';

export interface ThemeConfig {
  id: AppThemeId;
  name: string;
  nameEn: string;
  type: 'dark' | 'light';
  description: string;
  bgHex: string;
  cardHex: string;
  accentHex: string;
  secondaryHex: string;
}

export interface SteamGame {
  appId: number;
  name: string;
  nameZh?: string;
  pinyin?: string;
  bannerUrl?: string;
  headerUrl?: string;
  description?: string;
  releaseDate?: string;
  depots?: { [depotId: number]: string }; // depotId -> key
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

export interface DepotInfo {
  depotId: string;
  manifestGid?: string;
  size?: number;
  depotKey?: string;
}

export interface GameMetadata {
  appId: string;
  name: string;
  depots: DepotInfo[];
  dlcIds: string[];
  dlcDepots: Array<{ dlcAppId: string; depot: DepotInfo }>;
  accessToken?: string;
  workshopKey?: string;
  appLevelKey?: string;
}

export interface LuaGameInfo {
  appId: number;
  name: string;
  hasToken: boolean;
  hasManifest: boolean;
  hasDepotKeys: boolean;
  depotsCount: number;
  dlcCount: number;
  luaPath: string;
}

export interface SteamEnvironmentInfo {
  steamPath: string | null;
  isRunning: boolean;
  ostInstalled: boolean;
  ostVersion?: string;
  scriptsCount: number;
  globalOnlineFixEnabled: boolean;
  steamBitness?: 'x86' | 'x64' | 'unknown';
}

export interface OnlineFixStatus {
  gamePath: string;
  hasBackup: boolean;
  isPatched: boolean;
  mode: 'spacewar' | 'goldberg' | 'none';
  appId?: number;
}

export interface SpacewarStatus {
  isInstalled: boolean;
  path?: string;
  appName?: string;
  appId: number;
}

export type OnlineLaunchMode = 'open' | 'spacewar' | 'bat';

export interface LocalInstalledGame {
  appId: number;
  name: string;
  nameZh?: string;
  installDir: string;
  fullInstallPath: string;
  libraryPath: string;
  sizeOnDisk?: number;
  executableFiles: string[];
  primaryExe?: string;
  hasSteamlessBackup?: boolean;
  isRepaired?: boolean;
  isPatched?: boolean;
  patchMode?: 'spacewar' | 'goldberg' | 'none';
  hasBackup?: boolean;
}

export interface OnlineFixPatchResult {
  success: boolean;
  message: string;
  fileName?: string;
  extractedCount?: number;
  articleUrl?: string;
  downloadUrl?: string;
}

export interface OnlineFixSearchResult {
  found: boolean;
  message?: string;
  gameArticleUrl?: string;
  fileName?: string;
  downloadUrl?: string;
}

export interface SteamlessRepairResult {
  success: boolean;
  message: string;
  totalFound: number;
  repairedCount: number;
  backupCount: number;
  skippedCount: number;
  details: Array<{
    file: string;
    status: 'unpacked' | 'already_clean' | 'error' | 'skipped';
    message?: string;
  }>;
}

export interface SteamlessStatusInfo {
  available: boolean;
  engine: string;
  cliPath?: string;
}

export interface AppSettings {
  steamPath: string;
  manifestApi: 'opensteamtool' | 'steamrun' | 'wudrm' | 'custom';
  customManifestApiUrl?: string;
  autoRestartSteam: boolean;
  theme: AppThemeId | 'dark' | 'light';
}

export interface EnvironmentCheckItem {
  name: string;
  category: 'path' | 'hook' | 'config' | 'scripts' | 'process' | 'network';
  status: 'success' | 'warning' | 'error';
  message: string;
  detail?: string;
}

export interface EnvironmentDiagnosticResult {
  overallStatus: 'ready' | 'partial' | 'error';
  summary: string;
  items: EnvironmentCheckItem[];
  checkedAt: string;
}

export interface AppManifestStatus {
  appId: number;
  hasManifest: boolean;
  manifestCount: number;
  matchedDepots: string[];
  manifestFiles: string[];
}

export interface ManifestInstallResult {
  success: boolean;
  appId: number;
  downloadedCount: number;
  totalDepots: number;
  depotKeys: { [depotId: string]: string };
  manifestFiles: string[];
  source: 'backend' | 'gmrc' | 'manifesthub' | 'cdn' | 'none';
  message: string;
}

export interface DataSourceInfo {
  id: string;
  name: string;
  author: string;
  category: 'depot_keys' | 'tokens' | 'games' | 'manifests' | 'core_hook';
  sourceUrl: string;
  endpointUrl?: string;
  syncFrequency: string;
  status: 'active' | 'syncing' | 'error' | 'ready';
  lastSyncTime: string;
  totalRecordsCount: number;
  description: string;
  licenseOrNote: string;
}

export interface IpcResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

export type LicenseType = 'monthly' | 'quarterly' | 'yearly' | 'lifetime';
export type LicenseStatus = 'unused' | 'active' | 'expired' | 'disabled';

export interface LicenseKey {
  id: string;
  code: string;
  type: LicenseType;
  durationDays: number;
  status: LicenseStatus;
  createdAt: string;
  deviceId?: string;
  boundAt?: string;
  expiresAt?: string | null;
  remark?: string;
  createdBy?: string;
}

export interface ClientLicenseInfo {
  isActivated: boolean;
  status: 'unactivated' | 'active' | 'expired' | 'disabled' | 'error';
  type?: LicenseType;
  typeName?: string;
  code?: string;
  deviceId: string;
  boundAt?: string;
  expiresAt?: string | null;
  remainingDays?: number;
  isLifetime?: boolean;
  message?: string;
}

export interface LicenseStats {
  total: number;
  unused: number;
  active: number;
  expired: number;
  disabled: number;
  monthlyCount: number;
  quarterlyCount: number;
  yearlyCount: number;
  lifetimeCount: number;
}

export interface ToolboxActionResult {
  success: boolean;
  message: string;
  steps: string[];
  cleanedFilesCount?: number;
  restartedSteam?: boolean;
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

export interface ToolboxStatusInfo {
  steamPath: string | null;
  isRunning: boolean;
  hasOpenSteamTool: boolean;
  hasSha256Cache: boolean;
  autoSwitchEnabled: boolean;
  currentManifestServer: string;
}

export interface ToolboxRepairLog {
  actionType: 'clear_cache' | 'repair_kernel' | 'fill_sha256' | 'auto_switch_manifest';
  success: boolean;
  deviceId?: string;
  details?: string;
  timestamp: string;
}

