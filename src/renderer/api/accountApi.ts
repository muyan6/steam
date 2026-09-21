import { invoke } from '@tauri-apps/api/core';
import type { LocalSteamAccount, SwitchAccountResult } from '../types/account';

/**
 * 读取本地 Steam 所有已记住凭证的账号列表
 */
export async function getLocalSteamAccounts(): Promise<LocalSteamAccount[]> {
  try {
    return await invoke<LocalSteamAccount[]>('get_local_steam_accounts');
  } catch (error) {
    console.error('[AccountApi] 获取本地账号列表失败:', error);
    return [];
  }
}

/**
 * 免密切换当前 Steam 账号并重启客户端
 */
export async function switchSteamAccount(accountName: string): Promise<SwitchAccountResult> {
  try {
    return await invoke<SwitchAccountResult>('switch_steam_account', { accountName });
  } catch (error: any) {
    console.error('[AccountApi] 切换账号失败:', error);
    return {
      success: false,
      message: typeof error === 'string' ? error : (error?.message || '切换账号执行失败'),
      targetAccount: accountName,
      restartedSteam: false,
    };
  }
}
