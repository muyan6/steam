import { ref } from 'vue';
import type { GameFilterMode } from '../types/luaManager';
import { toggleGameStatus } from '../api/luaManagerApi';

export function useLuaManager() {
  const filterMode = ref<GameFilterMode>('all');
  const togglingAppId = ref<number | null>(null);

  /**
   * 切换指定游戏的启用/禁用状态
   */
  async function handleToggleStatus(
    appId: number,
    targetDisabled: boolean,
    onSuccess?: () => void,
    onNotify?: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void
  ): Promise<boolean> {
    if (togglingAppId.value === appId) return false;
    togglingAppId.value = appId;
    try {
      const res = await toggleGameStatus(appId, targetDisabled);
      if (res.success) {
        onNotify?.(res.message, 'success');
        onSuccess?.();
        return true;
      } else {
        onNotify?.(res.message, 'error');
        return false;
      }
    } catch (e: any) {
      onNotify?.(e?.message || '规则状态切换异常', 'error');
      return false;
    } finally {
      togglingAppId.value = null;
    }
  }

  return {
    filterMode,
    togglingAppId,
    handleToggleStatus,
  };
}
