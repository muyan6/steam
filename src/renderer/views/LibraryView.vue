<template>
  <div class="h-full flex flex-col p-6 overflow-hidden">
    <!-- 头部统计与操作 -->
    <div class="flex items-center justify-between mb-6">
      <div>
        <h2 class="text-xl font-bold text-slate-100 flex items-center gap-2">
          <span>📚 已入库游戏规则</span>
          <span class="text-xs px-2.5 py-0.5 rounded-full bg-steam-accent/20 text-steam-accent font-mono">
            {{ unlockedAppIds.length }} 款应用
          </span>
        </h2>
        <p class="text-xs text-slate-400 mt-1">
          管理存储于 Steam 根目录下 <code class="text-slate-300 font-mono">st_scripts/</code> 的 Lua 自动化解锁规则
        </p>
      </div>

      <div class="flex items-center gap-3">
        <button
          @click="loadLibrary"
          class="px-4 py-2 bg-steam-card hover:bg-steam-cardHover border border-slate-700/60 rounded-xl text-xs font-medium text-slate-200 transition"
        >
          🔄 刷新列表
        </button>

        <button
          @click="handleRestartSteam"
          class="px-4 py-2 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white text-xs font-bold rounded-xl shadow transition flex items-center gap-1.5"
        >
          <span>⚡ 重启 Steam 生效</span>
        </button>
      </div>
    </div>

    <!-- 游戏列表展示 -->
    <div class="flex-1 overflow-y-auto pr-1">
      <div v-if="unlockedAppIds.length === 0" class="flex flex-col items-center justify-center h-72 text-slate-400">
        <div class="text-4xl mb-3">📭</div>
        <p class="text-sm font-medium text-slate-300 mb-1">当前暂无已入库的规则文件</p>
        <p class="text-xs">前往「游戏搜索」页面，点击任意游戏的「一键入库」即可点亮</p>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-8">
        <div
          v-for="appId in unlockedAppIds"
          :key="appId"
          class="bg-steam-card/80 border border-slate-700/40 rounded-xl p-4 flex items-center justify-between gap-4 hover:border-slate-600 transition"
        >
          <!-- 封面小图与信息 -->
          <div class="flex items-center gap-3 min-w-0">
            <img
              :src="`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/capsule_184x69.jpg`"
              class="w-20 h-10 object-cover rounded bg-slate-900 shadow"
              @error="handleImgError"
            />
            <div class="min-w-0">
              <div class="font-bold text-sm text-slate-200 truncate">
                {{ getGameName(appId) }}
              </div>
              <div class="text-xs font-mono text-steam-accent mt-0.5">
                AppID: {{ appId }}
              </div>
            </div>
          </div>

          <!-- 操作 -->
          <div class="flex items-center gap-2">
            <a
              :href="`steam://rungameid/${appId}`"
              title="在 Steam 客户端启动"
              class="px-2.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 text-emerald-300 text-xs rounded-lg transition"
            >
              启动
            </a>

            <button
              @click="removeGame(appId)"
              title="删除此规则"
              class="px-2.5 py-1.5 bg-rose-600/20 hover:bg-rose-600/40 border border-rose-500/30 text-rose-300 text-xs rounded-lg transition"
            >
              移除
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { POPULAR_GAMES_DATABASE } from '../../main/database/gamesData';

const emit = defineEmits<{
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
  (e: 'refresh-status'): void;
}>();

const unlockedAppIds = ref<number[]>([]);

const loadLibrary = async () => {
  try {
    const ids = await window.electronAPI.getUnlockedGames();
    unlockedAppIds.value = ids;
    emit('refresh-status');
  } catch (e: any) {
    emit('notify', `加载列表失败: ${e.message}`, 'error');
  }
};

const getGameName = (appId: number) => {
  const game = POPULAR_GAMES_DATABASE.find((g) => g.appId === appId);
  return game ? (game.nameZh || game.name) : `Steam 应用 (${appId})`;
};

const removeGame = async (appId: number) => {
  try {
    const res = await window.electronAPI.removeUnlockedGame(appId);
    if (res.success) {
      emit('notify', res.message, 'success');
      await loadLibrary();
    } else {
      emit('notify', res.message, 'error');
    }
  } catch (e: any) {
    emit('notify', `移除失败: ${e.message}`, 'error');
  }
};

const handleRestartSteam = async () => {
  try {
    emit('notify', '正在安全重启 Steam 客户端以加载规则...', 'info');
    await window.electronAPI.restartSteam();
    emit('notify', 'Steam 已重新启动！', 'success');
  } catch (e: any) {
    emit('notify', `重启 Steam 异常: ${e.message}`, 'error');
  }
};

const handleImgError = (e: Event) => {
  const target = e.target as HTMLImageElement;
  target.src = 'https://store.cloudflare.steamstatic.com/public/shared/images/header/globalheader_logo.png';
};

onMounted(() => {
  loadLibrary();
});
</script>
