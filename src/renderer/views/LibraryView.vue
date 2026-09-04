<template>
  <div class="h-full flex flex-col p-6 overflow-hidden">
    <!-- 头部统计与操作 -->
    <div class="flex items-center justify-between mb-5 flex-wrap gap-3 shrink-0">
      <div>
        <h2 class="text-xl font-bold text-slate-100 flex items-center gap-2.5">
          <Library class="w-6 h-6 theme-text-accent" />
          <span>已入库规则管理</span>
          <span class="text-xs px-2.5 py-0.5 rounded-full bg-sky-500/10 theme-text-accent font-mono font-bold border border-sky-500/20">
            {{ unlockedGames.length }} 款应用
          </span>
        </h2>
        <p class="text-xs text-slate-400 mt-1">
          OpenSteamTool 标准规则目录：<code class="text-slate-300 font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-800">config/lua/*.lua</code>
        </p>
      </div>

      <div class="flex items-center gap-2.5">
        <button
          v-if="unlockedGames.length > 0"
          @click="handleClearAll"
          class="px-3.5 py-2 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-400 rounded-xl text-xs font-medium transition flex items-center gap-1.5"
        >
          <Trash2 class="w-3.5 h-3.5" />
          <span>清空所有</span>
        </button>

        <button
          @click="loadLibrary"
          class="px-3.5 py-2 bg-slate-800/80 hover:bg-slate-700 border border-white/10 rounded-xl text-xs font-medium text-slate-200 transition flex items-center gap-1.5"
        >
          <RotateCw class="w-3.5 h-3.5" />
          <span>刷新列表</span>
        </button>

        <button
          @click="handleRestartSteam"
          class="theme-btn-primary px-4 py-2 text-xs font-bold rounded-xl shadow transition flex items-center gap-1.5"
        >
          <RotateCw class="w-3.5 h-3.5" />
          <span>重启 Steam 生效</span>
        </button>
      </div>
    </div>

    <!-- 搜索过滤栏 (如果有入库游戏) -->
    <div v-if="unlockedGames.length > 0" class="mb-4 flex items-center gap-3 shrink-0">
      <div class="relative flex-1 max-w-sm">
        <input
          v-model="filterKeyword"
          type="text"
          placeholder="在已入库游戏中快速过滤 (AppID / 游戏名)..."
          class="w-full bg-slate-900/80 border border-white/10 rounded-xl px-3.5 py-2 pl-9 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30 transition shadow-inner"
        />
        <Search class="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
      </div>
      <span class="text-xs text-slate-400 font-mono">显示 {{ filteredGames.length }} / {{ unlockedGames.length }} 款</span>
    </div>

    <!-- 游戏列表展示 -->
    <div class="flex-1 overflow-y-auto pr-1">
      <div v-if="unlockedGames.length === 0" class="flex flex-col items-center justify-center h-72 text-slate-400">
        <div class="w-14 h-14 rounded-2xl bg-slate-900/80 border border-white/10 flex items-center justify-center text-2xl mb-3 shadow-inner">
          <Library class="w-6 h-6 text-slate-400" />
        </div>
        <p class="text-sm font-bold text-slate-200 mb-1">当前游戏库为空</p>
        <p class="text-xs text-slate-400">前往「游戏检索与入库」页面，点击任意游戏的「一键入库」即可瞬间点亮</p>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-8">
        <div
          v-for="game in filteredGames"
          :key="game.appId"
          class="theme-card rounded-2xl p-4 flex flex-col justify-between gap-3 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
        >
          <!-- 封面小图与信息 -->
          <div class="flex items-center gap-3 min-w-0">
            <img
              :src="`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_184x69.jpg`"
              class="w-20 h-10 object-cover rounded-lg bg-slate-900 shadow shrink-0 border border-white/10"
              loading="lazy"
              @error="handleImgError"
            />
            <div class="min-w-0 flex-1">
              <div class="font-bold text-xs text-slate-100 truncate" :title="game.name">
                {{ game.name }}
              </div>
              <div class="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span class="text-[10px] font-mono theme-text-accent bg-sky-500/10 px-1.5 py-0.2 rounded border border-sky-500/20 font-bold">
                  ID: {{ game.appId }}
                </span>

                <!-- 密钥状态 -->
                <span
                  v-if="game.hasDepotKeys"
                  class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-mono flex items-center gap-1 border border-emerald-500/30"
                  title="已注入 Depot 解密密钥"
                >
                  <Key class="w-2.5 h-2.5" />
                  <span>密钥已注入</span>
                </span>

                <!-- Token 状态 -->
                <span
                  v-if="game.hasToken"
                  class="text-[10px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-400 font-mono flex items-center gap-1 border border-purple-500/30"
                  title="已配置 PICS Token"
                >
                  <Zap class="w-2.5 h-2.5" />
                  <span>Token</span>
                </span>

                <!-- 清单状态 -->
                <span
                  v-if="manifestStatuses[game.appId]?.hasManifest || game.hasManifest"
                  class="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 font-mono flex items-center gap-1 border border-emerald-500/30"
                  title="本地 depotcache 清单文件已就绪"
                >
                  <Box class="w-2.5 h-2.5" />
                  <span>本地清单</span>
                </span>
                <span
                  v-else
                  class="text-[10px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-400 font-mono flex items-center gap-1 border border-sky-500/30"
                  title="OpenSteamTool 动态清单就绪，点击下载时 DLL 将自动拉取清单"
                >
                  <Zap class="w-2.5 h-2.5" />
                  <span>动态清单</span>
                </span>
              </div>
            </div>
          </div>

          <!-- 操作按钮条 -->
          <div class="flex items-center justify-between gap-2 pt-2.5 border-t border-white/10">
            <div class="flex items-center gap-1.5 flex-wrap">
              <a
                :href="`steam://install/${game.appId}`"
                title="在 Steam 客户端直接触发下载"
                class="px-3 py-1.5 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white text-xs font-bold rounded-lg transition flex items-center gap-1 shadow"
              >
                <Download class="w-3 h-3" />
                <span>下载</span>
              </a>

              <a
                :href="`steam://rungameid/${game.appId}`"
                title="在 Steam 客户端启动游戏"
                class="px-2.5 py-1.5 bg-emerald-600/20 hover:bg-emerald-600/40 border border-emerald-500/30 text-emerald-400 text-xs font-semibold rounded-lg transition flex items-center gap-1"
              >
                <Play class="w-3 h-3 fill-current" />
                <span>运行</span>
              </a>

              <button
                v-if="!manifestStatuses[game.appId]?.hasManifest && !game.hasManifest"
                @click="handleRepairManifest(game.appId)"
                :disabled="repairingAppId === game.appId"
                title="手动将清单预缓存到本地 Steam/depotcache 目录"
                class="px-2 py-1.5 bg-slate-800/80 hover:bg-slate-700 border border-white/10 text-slate-300 text-xs rounded-lg transition flex items-center gap-1"
              >
                <RotateCw v-if="repairingAppId === game.appId" class="w-3 h-3 animate-spin" />
                <FolderSync v-else class="w-3 h-3" />
                <span>{{ repairingAppId === game.appId ? '拉取中...' : '预缓存' }}</span>
              </button>
            </div>

            <button
              @click="removeGame(game.appId, game.name)"
              title="将该游戏移出库（删除 Lua 规则）"
              class="px-2.5 py-1.5 bg-rose-600/20 hover:bg-rose-600/40 border border-rose-500/30 text-rose-400 text-xs font-medium rounded-lg transition flex items-center gap-1"
            >
              <Trash2 class="w-3 h-3" />
              <span>出库</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { 
  Library, 
  Trash2, 
  RotateCw, 
  Search, 
  Key, 
  Zap, 
  Box, 
  Download, 
  Play, 
  FolderSync 
} from 'lucide-vue-next';
import { AppManifestStatus, LuaGameInfo } from '../../types';

const emit = defineEmits<{
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
  (e: 'refresh-status'): void;
}>();

const unlockedGames = ref<LuaGameInfo[]>([]);
const manifestStatuses = reactive<Record<number, AppManifestStatus>>({});
const repairingAppId = ref<number | null>(null);
const filterKeyword = ref('');

const filteredGames = computed(() => {
  const kw = filterKeyword.value.trim().toLowerCase();
  if (!kw) return unlockedGames.value;
  return unlockedGames.value.filter(
    (g) => g.appId.toString().includes(kw) || g.name.toLowerCase().includes(kw)
  );
});

const loadLibrary = async () => {
  try {
    const details = await window.electronAPI.getUnlockedDetails();
    unlockedGames.value = details || [];
    emit('refresh-status');

    for (const g of unlockedGames.value) {
      if (!g.hasManifest) {
        window.electronAPI.checkManifestStatus(g.appId).then((status) => {
          if (status) manifestStatuses[g.appId] = status;
        }).catch(() => {});
      }
    }
  } catch (e: any) {
    emit('notify', `加载游戏库失败: ${e.message}`, 'error');
  }
};

const handleRepairManifest = async (appId: number) => {
  repairingAppId.value = appId;
  try {
    emit('notify', '正在从 SteamPipe CDN 下载分包清单并解压...', 'info');
    const res = await window.electronAPI.downloadManifest(appId);
    if (res && res.success) {
      emit('notify', res.message || '分包清单已就绪！', 'success');
      const status = await window.electronAPI.checkManifestStatus(appId);
      if (status) {
        manifestStatuses[appId] = status;
      }
      await loadLibrary();
    } else {
      emit('notify', res?.message || '清单获取完成，DLL 运行时将自动调度。', 'info');
    }
  } catch (e: any) {
    emit('notify', `下载清单失败: ${e.message}`, 'error');
  } finally {
    repairingAppId.value = null;
  }
};

const removeGame = async (appId: number, name: string) => {
  try {
    const res = await window.electronAPI.removeUnlockedGame(appId);
    if (res.success) {
      emit('notify', `已成功将「${name || appId}」移出库！`, 'success');
      await loadLibrary();
    } else {
      emit('notify', res.message, 'error');
    }
  } catch (e: any) {
    emit('notify', `出库失败: ${e.message}`, 'error');
  }
};

const handleClearAll = async () => {
  if (!confirm('确定要清空所有已入库的游戏规则吗？此操作将删除所有 config/lua 配置文件。')) {
    return;
  }
  try {
    const res = await window.electronAPI.clearAllGames();
    if (res.success) {
      emit('notify', res.message, 'success');
      await loadLibrary();
    }
  } catch (e: any) {
    emit('notify', `清空失败: ${e.message}`, 'error');
  }
};

const handleRestartSteam = async () => {
  try {
    emit('notify', '正在安全重启 Steam 客户端以加载规则与清单...', 'info');
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
