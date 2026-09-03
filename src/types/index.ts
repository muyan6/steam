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
  theme: 'dark' | 'light';
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
  source: 'backend' | 'gmrc' | 'manifesthub' | 'none';
  message: string;
}

export interface IpcResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
}

