import { invoke } from '@tauri-apps/api/core';
import type { LuaToggleResult } from '../types/luaManager';

/**
 * 软切换游戏入库状态（移动至 Disable/ 目录或恢复生效，不物理删除文件）
 */
export async function toggleGameStatus(appId: number, disabled: boolean): Promise<LuaToggleResult> {
  try {
    return await invoke<LuaToggleResult>('toggle_game_status', { appId, disabled });
  } catch (error: any) {
    console.error(`[LuaManagerApi] 切换 AppID ${appId} 状态失败:`, error);
    return {
      success: false,
      appId,
      isDisabled: !disabled,
      message: typeof error === 'string' ? error : (error?.message || '规则状态切换失败'),
    };
  }
}
