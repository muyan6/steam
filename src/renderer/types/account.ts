export interface LocalSteamAccount {
  steamId: string;
  accountName: string;
  personaName: string;
  timestamp: number;
  isMostRecent: boolean;
  isCurrentAutoLogin: boolean;
  avatarBase64?: string | null;
  wantsOfflineMode: boolean;
}

export interface SwitchAccountResult {
  success: boolean;
  message: string;
  targetAccount: string;
  restartedSteam: boolean;
}
