export interface LuaToggleResult {
  success: boolean;
  appId: number;
  isDisabled: boolean;
  message: string;
}

export type GameFilterMode = 'all' | 'active' | 'disabled';

export interface DlcDiffResult {
  success: boolean;
  appId: number;
  totalRemoteDlcs: number;
  localDlcCount: number;
  missingDlcIds: number[];
  message: string;
}

export interface DlcAppendResult {
  success: boolean;
  appId: number;
  addedCount: number;
  addedDlcIds: number[];
  message: string;
}

