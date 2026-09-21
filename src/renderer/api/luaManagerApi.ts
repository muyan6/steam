import { invoke } from '@tauri-apps/api/core';
import type { LuaToggleResult, DlcDiffResult, DlcAppendResult } from '../types/luaManager';

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

/**
 * 核验已入库游戏与云端最新 DLC 的差异（提取增量缺失的 DLC）
 */
export async function checkGameDlcDiff(appId: number): Promise<DlcDiffResult> {
  try {
    return await invoke<DlcDiffResult>('check_game_dlc_diff', { appId });
  } catch (error: any) {
    console.error(`[LuaManagerApi] 核验 AppID ${appId} DLC 失败:`, error);
    return {
      success: false,
      appId,
      totalRemoteDlcs: 0,
      localDlcCount: 0,
      missingDlcIds: [],
      message: typeof error === 'string' ? error : (error?.message || 'DLC 差异核验失败'),
    };
  }
}

/**
 * 一键向已入库游戏的规则中增量追加新 DLC
 */
export async function appendGameDlcs(appId: number, dlcIds: number[]): Promise<DlcAppendResult> {
  try {
    return await invoke<DlcAppendResult>('append_game_dlcs', { appId, dlcIds });
  } catch (error: any) {
    console.error(`[LuaManagerApi] 追加 AppID ${appId} DLC 失败:`, error);
    return {
      success: false,
      appId,
      addedCount: 0,
      addedDlcIds: [],
      message: typeof error === 'string' ? error : (error?.message || 'DLC 追加写入失败'),
    };
  }
}

