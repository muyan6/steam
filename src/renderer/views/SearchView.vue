<template>
  <div class="h-full flex flex-col p-5 xl:p-6 overflow-hidden">
    <!-- 顶部搜索栏与操作栏 -->
    <div class="flex items-center gap-3 mb-4 shrink-0">
      <div class="relative flex-1">
        <input
          v-model="searchQuery"
          @input="handleSearch"
          type="text"
          placeholder="输入游戏中文名、英文名、拼音缩写或 Steam AppID (如 2358720 / wukong / 后室)..."
          class="w-full bg-slate-900/80 border border-white/10 rounded-2xl px-4 py-3 pl-11 text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 transition shadow-inner backdrop-blur-md"
        />
        <Search class="w-4.5 h-4.5 absolute left-3.5 top-3 text-slate-400 pointer-events-none" />
        <button
          v-if="searchQuery"
          @click="searchQuery = ''; handleSearch()"
          class="absolute right-3 top-3 text-slate-400 hover:text-slate-200 p-0.5 rounded-full hover:bg-slate-800 transition cursor-pointer"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <button
        @click="refreshData"
        :disabled="loading"
        class="px-4 py-3 bg-slate-800/80 hover:bg-slate-700 border border-white/10 rounded-2xl text-xs font-bold text-slate-200 transition flex items-center gap-1.5 shadow-sm shrink-0 cursor-pointer"
      >
        <RotateCw class="w-3.5 h-3.5 text-slate-300" :class="{ 'animate-spin': loading }" />
        <span>刷新</span>
      </button>
    </div>

    <!-- 状态指示与快捷标签 -->
    <div class="flex items-center justify-between mb-4 text-xs text-slate-400 shrink-0 flex-wrap gap-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="flex items-center gap-1.5 text-slate-400 font-semibold text-xs">
          <Sparkles class="w-4 h-4 text-amber-500" />
          <span>热门推荐:</span>
        </span>
        <button
          v-for="tag in quickTags"
          :key="tag"
          @click="searchQuery = tag; handleSearch()"
          class="px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-slate-100 border border-white/10 transition duration-150 text-xs font-medium"
        >
          {{ tag }}
        </button>
      </div>
      <div class="font-mono text-xs bg-slate-900/60 px-3 py-1.5 rounded-xl border border-white/10">
        共匹配到 <span class="theme-text-accent font-bold">{{ games.length }}</span> 款游戏
      </div>
    </div>

    <!-- 游戏卡片网格列表 -->
    <div class="flex-1 overflow-y-auto pr-1">
      <div v-if="loading && games.length === 0" class="flex flex-col items-center justify-center h-64 text-slate-400">
        <RotateCw class="w-8 h-8 animate-spin theme-text-accent mb-3" />
        <p class="text-sm">正在搜索 Steam 官方数据库与 18 万+ 云端端点...</p>
      </div>

      <div v-else-if="games.length === 0" class="flex flex-col items-center justify-center h-72 text-slate-400 p-6">
        <div class="w-16 h-16 rounded-2xl bg-slate-900/80 border border-white/10 flex items-center justify-center text-2xl mb-3 shadow-inner">
          <Search class="w-7 h-7 text-slate-400" />
        </div>
        <p class="text-base font-bold text-slate-200 mb-1">未找到与「{{ searchQuery }}」匹配的游戏</p>
        
        <div v-if="/[\u4e00-\u9fa5]/.test(searchQuery)" class="mt-3 max-w-lg bg-sky-950/30 border border-sky-500/30 rounded-2xl p-5 text-center text-xs text-sky-200/90 leading-relaxed shadow">
          <div class="font-bold flex items-center justify-center gap-1.5 mb-1 text-sky-400 text-sm">
            <Sparkles class="w-4 h-4 text-sky-400" />
            <span>检索小贴士</span>
          </div>
          <p>Steam 官方应用库中超 90% 的应用以 <strong>英文原名</strong> 登记收录。</p>
          <p class="mt-1 text-slate-300">建议尝试输入该游戏的 <strong>英文原名</strong> 或 <strong>纯数字 AppID</strong> 即可秒级匹配！</p>
        </div>

        <p v-else class="text-xs text-slate-400 mt-2">
          请检查拼写，或直接输入纯数字 Steam AppID 进行实时匹配
        </p>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4.5 pb-8">
        <div
          v-for="game in games"
          :key="game.appId"
          class="theme-card rounded-2xl overflow-hidden flex flex-col group transition-all duration-200 hover:-translate-y-1 hover:shadow-xl"
        >
          <!-- 封面图 -->
          <div class="relative w-full aspect-[460/215] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 overflow-hidden flex items-center justify-center">
            <img
              v-if="!failedImgs.has(game.appId)"
              :src="game.headerUrl || `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/header.jpg`"
              :alt="game.name"
              class="w-full h-full object-cover group-hover:scale-105 transition duration-300"
              loading="lazy"
              @error="handleImgError(game)"
            />
            
            <!-- 精致缺图占位卡片 -->
            <div v-else class="w-full h-full p-4 flex flex-col justify-between bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 border border-white/10">
              <div class="flex items-center justify-between text-xs text-sky-400/80">
                <Gamepad2 class="w-5 h-5 text-slate-400" />
                <span class="font-mono text-xs px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 font-semibold">Steam App</span>
              </div>
              <div class="font-bold text-sm text-slate-200 line-clamp-2 leading-tight">
                {{ game.nameZh || game.name }}
              </div>
              <div class="text-xs text-slate-400 font-mono">
                Steam 官方收录应用
              </div>
            </div>

            <div class="absolute top-2.5 right-2.5 bg-slate-950/85 backdrop-blur-md px-2.5 py-1 rounded-lg text-xs font-mono theme-text-accent border border-white/10 font-bold">
              ID: {{ game.appId }}
            </div>
            <div
              v-if="unlockedAppIds.includes(game.appId)"
              class="absolute top-2.5 left-2.5 bg-emerald-600/90 backdrop-blur-md px-3 py-1 rounded-lg text-xs font-bold text-white shadow flex items-center gap-1.5"
            >
              <Check class="w-3.5 h-3.5 stroke-[3]" />
              <span>已在库中</span>
            </div>
          </div>

          <!-- 内容信息 -->
          <div class="p-4 flex-1 flex flex-col justify-between">
            <div>
              <h3 class="font-bold text-slate-100 text-sm line-clamp-1 group-hover:text-sky-300 transition duration-150">
                {{ game.nameZh || game.name }}
              </h3>
              <p class="text-xs text-slate-400 line-clamp-1 mb-1 font-mono">
                {{ game.name }}
              </p>
              <p class="text-xs text-slate-400 line-clamp-2 leading-relaxed mb-3">
                {{ game.description || 'Steam 官方收录应用' }}
              </p>
            </div>

            <!-- 操作按钮 -->
            <div class="pt-3 border-t border-white/10 flex items-center justify-between gap-2">
              <button
                v-if="!unlockedAppIds.includes(game.appId)"
                @click="unlockGame(game)"
                :disabled="unlockingId === game.appId"
                class="flex-1 py-2.5 theme-btn-primary disabled:opacity-50 text-xs font-bold rounded-xl shadow transition flex items-center justify-center gap-1.5"
              >
                <RotateCw v-if="unlockingId === game.appId" class="w-4 h-4 animate-spin" />
                <PlusCircle v-else class="w-4 h-4" />
                <span>{{ unlockingId === game.appId ? '匹配清单与密钥...' : '一键入库 (含清单)' }}</span>
              </button>

              <template v-else>
                <a
                  :href="`steam://install/${game.appId}`"
                  title="在 Steam 中启动直接下载"
                  class="flex-1 py-2.5 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white text-xs font-bold rounded-xl shadow transition flex items-center justify-center gap-1.5"
                >
                  <Download class="w-4 h-4" />
                  <span>Steam 下载</span>
                </a>

                <button
                  @click="removeGame(game.appId)"
                  title="从入库规则中移除"
                  class="px-3.5 py-2.5 bg-slate-800/80 hover:bg-rose-900/60 border border-white/10 hover:border-rose-500/40 text-slate-400 hover:text-rose-200 text-xs font-medium rounded-xl transition flex items-center justify-center"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </template>

              <a
                :href="`https://store.steampowered.com/app/${game.appId}`"
                target="_blank"
                title="在 Steam 商店中查看"
                class="p-2.5 bg-slate-800/80 hover:bg-slate-700 border border-white/10 rounded-xl text-slate-400 hover:text-sky-300 transition shrink-0"
              >
                <ExternalLink class="w-4 h-4" />
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
import { 
  Search, 
  X, 
  RotateCw, 
  Sparkles, 
  Gamepad2, 
  Check, 
  PlusCircle, 
  Download, 
  Trash2, 
  ExternalLink 
} from 'lucide-vue-next';
import { SteamGame } from '../../types';
import { APP_CONFIG } from '../../config/appConfig';

const emit = defineEmits<{
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
  (e: 'refresh-status'): void;
  (e: 'open-license-modal'): void;
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
  // 0. 前置严格授权检查：未激活时阻断入库，直接弹窗提示激活
  try {
    const lic = await window.electronAPI.getLicenseInfo();
    if (!lic || !lic.isActivated) {
      emit('notify', '当前设备尚未激活软件授权！无法使用一键入库与密钥调度，请先激活后使用。', 'warning');
      emit('open-license-modal');
      return;
    }
  } catch (e: any) {
    emit('notify', `授权检测异常: ${e.message}`, 'error');
    return;
  }

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
      if ((res as any).notActivated) {
        emit('open-license-modal');
      }
    }
  } catch (e: any) {
    emit('notify', `入库异常: ${e.message}`, 'error');
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
