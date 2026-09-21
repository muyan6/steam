import { ref, computed } from 'vue';
import type { LocalSteamAccount } from '../types/account';
import { getLocalSteamAccounts, switchSteamAccount } from '../api/accountApi';

const accounts = ref<LocalSteamAccount[]>([]);
const loading = ref<boolean>(false);
const switchingAccount = ref<string | null>(null);

export function useSteamAccount() {
  /**
   * 当前激活（或最近登录）的账号
   */
  const currentAccount = computed<LocalSteamAccount | undefined>(() => {
    return accounts.value.find((a) => a.isCurrentAutoLogin) || accounts.value[0];
  });

  /**
   * 刷新本地 Steam 账号列表
   */
  async function refreshAccounts() {
    loading.value = true;
    try {
      const res = await getLocalSteamAccounts();
      accounts.value = res;
    } finally {
      loading.value = false;
    }
  }

  /**
   * 执行免密切换账号
   */
  async function handleSwitch(accountName: string, onNotify?: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void) {
    if (switchingAccount.value) return false;
    switchingAccount.value = accountName;
    try {
      const res = await switchSteamAccount(accountName);
      if (res.success) {
        onNotify?.(res.message, 'success');
        // 成功切换后重新同步账号状态
        setTimeout(() => {
          refreshAccounts();
        }, 1500);
        return true;
      } else {
        onNotify?.(res.message, 'error');
        return false;
      }
    } catch (e: any) {
      onNotify?.(e?.message || '切换账号异常', 'error');
      return false;
    } finally {
      switchingAccount.value = null;
    }
  }

  /**
   * 格式化最后登录时间
   */
  function formatTimestamp(seconds: number): string {
    if (!seconds || seconds <= 0) return '未知时间';
    try {
      const date = new Date(seconds * 1000);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
      const diffDays = Math.floor(diffHours / 24);

      if (diffHours < 1) return '刚刚活跃';
      if (diffHours < 24) return `${diffHours} 小时前活跃`;
      if (diffDays < 30) return `${diffDays} 天前活跃`;
      return date.toLocaleDateString();
    } catch {
      return '未知时间';
    }
  }

  return {
    accounts,
    currentAccount,
    loading,
    switchingAccount,
    refreshAccounts,
    handleSwitch,
    formatTimestamp,
  };
}
