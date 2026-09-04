<template>
  <div class="h-full flex flex-col p-6 overflow-hidden">
    <!-- 顶部搜索栏与操作栏 -->
    <div class="flex items-center gap-4 mb-6">
      <div class="relative flex-1">
        <input
          v-model="searchQuery"
          @input="handleSearch"
          type="text"
          placeholder="输入游戏中文名、英文名、拼音缩写或 Steam AppID (如 2358720 / wukong)..."
          class="w-full bg-steam-card/80 border border-slate-700/60 rounded-xl px-4 py-3 pl-11 text-sm text-slate-100 placeholder-slate-400 focus:outline-none focus:border-steam-accent focus:ring-1 focus:ring-steam-accent transition"
        />
        <svg
          class="w-5 h-5 absolute left-3.5 top-3.5 text-slate-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <button
          v-if="searchQuery"
          @click="searchQuery = ''; handleSearch()"
          class="absolute right-3 top-3 text-slate-400 hover:text-slate-200"
        >
          ✕
        </button>
      </div>

      <button
        @click="refreshData"
        :disabled="loading"
        class="px-4 py-3 bg-steam-card hover:bg-steam-cardHover border border-slate-700/60 rounded-xl text-sm font-medium text-slate-200 transition flex items-center gap-2"
      >
        <span :class="{ 'animate-spin': loading }">🔄</span>
        <span>刷新</span>
      </button>
    </div>

    <!-- 状态指示与快捷标签 -->
    <div class="flex items-center justify-between mb-4 text-xs text-slate-400">
      <div class="flex items-center gap-2">
        <span>快捷推荐:</span>
        <button
          v-for="tag in quickTags"
          :key="tag"
          @click="searchQuery = tag; handleSearch()"
          class="px-2.5 py-1 rounded-md bg-slate-800/80 hover:bg-slate-700 text-slate-300 transition"
        >
          {{ tag }}
        </button>
      </div>
      <div>共匹配到 {{ games.length }} 款游戏</div>
    </div>

    <!-- 游戏卡片网格列表 -->
    <div class="flex-1 overflow-y-auto pr-1">
      <div v-if="loading && games.length === 0" class="flex flex-col items-center justify-center h-64 text-slate-400">
        <div class="animate-spin text-3xl mb-3">🌀</div>
        <p>正在搜索 Steam 数据库与云端端点...</p>
      </div>

      <div v-else-if="games.length === 0" class="flex flex-col items-center justify-center h-72 text-slate-400 p-6">
        <div class="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-2xl mb-3 shadow-inner">
          🔍
        </div>
        <p class="text-base font-bold text-slate-200 mb-1">未找到与「{{ searchQuery }}」匹配的游戏</p>
        
        <div v-if="/[\u4e00-\u9fa5]/.test(searchQuery)" class="mt-3 max-w-md bg-sky-950/30 border border-sky-500/30 rounded-xl p-3.5 text-center text-xs text-sky-200/90 leading-relaxed shadow">
          <div class="font-bold flex items-center justify-center gap-1.5 mb-1 text-sky-300">
            <span>💡</span>
            <span>温馨提示</span>
          </div>
          <p>Steam 官方数据库中超 90% 的应用以 <strong>英文原名</strong> 登记收录。</p>
          <p class="mt-1 text-slate-300">建议尝试输入该游戏的 <strong>英文原名</strong> 或 <strong>纯数字 AppID</strong> 即可精准秒搜！</p>
        </div>

        <p v-else class="text-xs text-slate-400 mt-2">
          请检查拼写，或直接输入纯数字 Steam AppID 进行实时匹配
        </p>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 pb-8">
        <div
          v-for="game in games"
          :key="game.appId"
          class="bg-steam-card/90 hover:bg-steam-cardHover border border-slate-700/40 hover:border-steam-accent/40 rounded-xl overflow-hidden transition-all duration-200 flex flex-col group shadow-lg"
        >
          <!-- 封面图 -->
          <div class="relative w-full aspect-[460/215] bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 overflow-hidden flex items-center justify-center">
            <img
              v-if="!failedImgs.has(game.appId)"
              :src="game.headerUrl || `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/header.jpg`"
              :alt="game.name"
              class="w-full h-full object-cover group-hover:scale-105 transition duration-300"
              loading="lazy"
              @error="handleImgError(game)"
            />
            
            <!-- 精致 Fluent 缺图占位卡片 -->
            <div v-else class="w-full h-full p-4 flex flex-col justify-between bg-gradient-to-br from-slate-900 via-sky-950/30 to-slate-950 border border-slate-700/30">
              <div class="flex items-center justify-between text-xs text-sky-400/80">
                <span class="text-base">🎮</span>
                <span class="font-mono text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">Steam App</span>
              </div>
              <div class="font-bold text-xs text-slate-200 line-clamp-2 leading-tight">
                {{ game.nameZh || game.name }}
              </div>
              <div class="text-[10px] text-slate-500 font-mono">
                Steam 官方收录应用
              </div>
            </div>

            <div class="absolute top-2 right-2 bg-slate-950/80 backdrop-blur-md px-2 py-0.5 rounded text-[11px] font-mono text-steam-accent border border-steam-accent/20">
              ID: {{ game.appId }}
            </div>
            <div
              v-if="unlockedAppIds.includes(game.appId)"
              class="absolute top-2 left-2 bg-emerald-600/90 backdrop-blur-md px-2 py-0.5 rounded text-[11px] font-bold text-white shadow"
            >
              ✓ 已在库中
            </div>
          </div>

          <!-- 内容信息 -->
          <div class="p-4 flex-1 flex flex-col justify-between">
            <div>
              <h3 class="font-bold text-slate-100 text-sm line-clamp-1 group-hover:text-steam-accent transition">
                {{ game.nameZh || game.name }}
              </h3>
              <p class="text-xs text-slate-400 line-clamp-1 mb-2 font-mono">
                {{ game.name }}
              </p>
              <p class="text-xs text-slate-400 line-clamp-2 leading-relaxed mb-3">
                {{ game.description || 'Steam 官方收录应用' }}
              </p>
            </div>

            <!-- 操作按钮 -->
            <div class="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
              <button
                v-if="!unlockedAppIds.includes(game.appId)"
                @click="unlockGame(game)"
                :disabled="unlockingId === game.appId"
                class="flex-1 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg shadow transition flex items-center justify-center gap-1.5"
              >
                <span v-if="unlockingId === game.appId" class="animate-spin">⏳</span>
                <span v-else>➕</span>
                <span>{{ unlockingId === game.appId ? '正在匹配清单与密钥...' : '一键入库 (含清单)' }}</span>
              </button>

              <template v-else>
                <a
                  :href="`steam://install/${game.appId}`"
                  title="在 Steam 中启动直接下载 (清单已挂载，无许可报错已消除)"
                  class="flex-1 py-2 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white text-xs font-bold rounded-lg shadow transition flex items-center justify-center gap-1"
                >
                  <span>🚀</span>
                  <span>Steam 下载</span>
                </a>

                <button
                  @click="removeGame(game.appId)"
                  title="从入库规则中移除"
                  class="px-2.5 py-2 bg-slate-800 hover:bg-rose-900/60 border border-slate-700/60 hover:border-rose-500/40 text-slate-400 hover:text-rose-200 text-xs font-medium rounded-lg transition"
                >
                  移除
                </button>
              </template>

              <a
                :href="`https://store.steampowered.com/app/${game.appId}`"
                target="_blank"
                title="在 Steam 商店中查看"
                class="p-2 bg-slate-800/80 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-steam-accent transition"
              >
                🔗
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import axios from 'axios';
import { SteamGame } from '../../types';
import { APP_CONFIG } from '../../config/appConfig';

const emit = defineEmits<{
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
  (e: 'refresh-status'): void;
}>();

const searchQuery = ref('');
const games = ref<SteamGame[]>([]);
const unlockedAppIds = ref<number[]>([]);
const loading = ref(false);
const unlockingId = ref<number | null>(null);
const failedImgs = reactive(new Set<number>());
const retriedImgs = new Set<number>();

const quickTags = ['后室', '黑神话', '艾尔登法环', '双人成行', '只狼', '博德之门', '幻兽帕鲁', '太空狼人杀'];

const handleImgError = async (game: SteamGame) => {
  if (retriedImgs.has(game.appId)) {
    failedImgs.add(game.appId);
    return;
  }
  retriedImgs.add(game.appId);

  // 1. 尝试向 Steam 官方 AppDetails 接口解析带 Hash 的最新海报地址
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${game.appId}&l=schinese`;
    const resp = await axios.get(url, { timeout: 3500 });
    const data = resp.data?.[game.appId.toString()];
    if (data && data.data && data.data.header_image) {
      game.headerUrl = data.data.header_image;
      return;
    }
  } catch {
    // ignore
  }

  // 2. 尝试向后端代理/缓存获取
  try {
    const resp = await axios.get(`${APP_CONFIG.API_BASE_URL}/api/games/${game.appId}/header`, { timeout: 2500 });
    if (resp.data && resp.data.success && resp.data.headerUrl) {
      game.headerUrl = resp.data.headerUrl;
      return;
    }
  } catch {
    // ignore
  }

  failedImgs.add(game.appId);
};

const handleSearch = async () => {
  loading.value = true;
  try {
    const results = await window.electronAPI.searchGames(searchQuery.value);
    games.value = results;
  } catch (e: any) {
    emit('notify', `搜索失败: ${e.message}`, 'error');
  } finally {
    loading.value = false;
  }
};

const refreshData = async () => {
  await Promise.all([handleSearch(), loadUnlockedList()]);
  emit('refresh-status');
};

const loadUnlockedList = async () => {
  try {
    const ids = await window.electronAPI.getUnlockedGames();
    unlockedAppIds.value = ids;
  } catch {
    unlockedAppIds.value = [];
  }
};

const unlockGame = async (game: SteamGame) => {
  unlockingId.value = game.appId;
  try {
    const plainGame: SteamGame = {
      appId: game.appId,
      name: game.name,
      nameZh: game.nameZh,
      pinyin: game.pinyin,
      bannerUrl: game.bannerUrl,
      headerUrl: game.headerUrl,
      description: game.description,
      depots: game.depots ? { ...game.depots } : undefined,
      dlcs: game.dlcs ? [...game.dlcs] : undefined,
      type: game.type
    };
    const res = await window.electronAPI.unlockGame(plainGame);
    if (res.success) {
      emit('notify', res.message, 'success');
      await loadUnlockedList();
      emit('refresh-status');
    } else {
      emit('notify', res.message, 'error');
    }
  } catch (e: any) {
    emit('notify', `操作异常: ${e.message}`, 'error');
  } finally {
    unlockingId.value = null;
  }
};

const removeGame = async (appId: number) => {
  try {
    const res = await window.electronAPI.removeUnlockedGame(appId);
    if (res.success) {
      emit('notify', res.message, 'info');
      await loadUnlockedList();
      emit('refresh-status');
    }
  } catch (e: any) {
    emit('notify', `移除失败: ${e.message}`, 'error');
  }
};

onMounted(() => {
  refreshData();
});
</script>
