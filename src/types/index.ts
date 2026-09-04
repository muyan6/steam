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
  depots?: { [depotId: number]: string }; // depotId -> key
  dlcs?: number[];
  installed?: boolean;
  unlocked?: boolean;
  type?: 'game' | 'dlc' | 'tool';
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
