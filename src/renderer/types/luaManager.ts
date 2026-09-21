export interface LuaToggleResult {
  success: boolean;
  appId: number;
  isDisabled: boolean;
  message: string;
}

export type GameFilterMode = 'all' | 'active' | 'disabled';
