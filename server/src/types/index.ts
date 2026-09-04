export interface SteamGame {
  appId: number;
  name: string;
  nameZh?: string;
  pinyin?: string;
  bannerUrl?: string;
  headerUrl?: string;
  description?: string;
  depots?: { [depotId: number]: string };
  dlcs?: number[];
  installed?: boolean;
  unlocked?: boolean;
  type?: 'game' | 'dlc' | 'tool';
}

export interface CompactGame {
  appId: number;
  name: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'popup' | 'banner';
  popupOnce: boolean; // 是否只弹出一次
  link?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface VersionInfo {
  version: string;
  releaseDate: string;
  title: string;
  changelog: string[];
  downloadUrl: string;
  forceUpdate: boolean; // 是否强制更新
  minSupportedVersion: string;
}

export interface ServerStats {
  status: string;
  uptimeSeconds: number;
  gamesCount: number;
  depotKeysCount: number;
  tokensCount?: number;
  memoryUsageMb: number;
  nodeVersion: string;
}
