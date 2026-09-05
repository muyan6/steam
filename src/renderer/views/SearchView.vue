<template>
  <div class="h-full flex flex-col p-5 xl:p-6 overflow-hidden">
    <!-- 顶部搜索栏与操作栏 -->
    <div class="flex items-center gap-3 mb-3.5 shrink-0 flex-wrap">
      <div class="relative flex-1 min-w-[280px]">
        <input
          v-model="searchQuery"
          @keydown.enter="handleSearch(1)"
          type="text"
          placeholder="输入游戏中文名、英文名、拼音缩写或 Steam AppID (如 BOMBANANA / 2358720 / wukong / 后室)..."
          class="w-full theme-card-static rounded-2xl px-4 py-2.5 pl-11 text-xs text-slate-100 placeholder-slate-400 focus:outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-400/20 transition shadow-inner"
        />
        <Search class="w-[18px] h-[18px] absolute left-3.5 top-3 text-slate-400 pointer-events-none" />
        <button
          v-if="searchQuery"
          @click="searchQuery = ''; handleSearch(1)"
          class="absolute right-3 top-3 text-slate-400 hover:text-slate-200 p-0.5 rounded-full hover:bg-white/10 transition cursor-pointer"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- 搜索按钮与刷新按钮 -->
      <div class="flex items-center gap-2 shrink-0">
        <button
          @click="handleSearch(1)"
          :disabled="loading"
          class="px-5 py-2.5 theme-btn-primary rounded-2xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
        >
          <Search class="w-3.5 h-3.5" />
          <span>搜索</span>
        </button>

        <button
          @click="refreshData"
          :disabled="loading"
          class="px-3.5 py-2.5 btn-soft-action rounded-2xl text-xs font-bold transition flex items-center gap-1.5 shadow-sm cursor-pointer"
          title="刷新数据"
        >
          <RotateCw class="w-3.5 h-3.5" :class="{ 'animate-spin': loading }" />
          <span>刷新</span>
        </button>

        <!-- 数据源切换下拉/指示器 -->
        <div class="relative">
          <button
            @click="showSourceDropdown = !showSourceDropdown"
            class="px-3.5 py-2.5 btn-soft-action border-sky-500/30 text-sky-400 rounded-2xl text-xs font-bold transition flex items-center gap-2 cursor-pointer shadow-sm"
            title="点击切换搜索数据源"
          >
            <Server class="w-3.5 h-3.5 text-sky-400" />
            <span>{{ currentSourceConfig.name }}</span>
            <ChevronDown class="w-3.5 h-3.5 text-slate-400 transition-transform" :class="{ 'rotate-180': showSourceDropdown }" />
          </button>

          <!-- 数据源切换下拉浮层 -->
          <div
            v-if="showSourceDropdown"
            class="absolute right-0 top-full mt-2 w-64 theme-card-static rounded-2xl p-2 shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-150 border"
          >
            <div class="text-[11px] text-slate-400 px-2.5 py-1 font-semibold border-b border-white/5 mb-1">
              选择搜索接口与数据引擎:
            </div>
            <button
              v-for="src in searchSources"
              :key="src.id"
              :disabled="loading"
              @click="selectSource(src.id)"
              class="w-full text-left p-2.5 rounded-xl transition flex items-center justify-between text-xs cursor-pointer group"
              :class="currentSource === src.id ? 'bg-sky-500/15 border border-sky-500/30 text-sky-300 font-bold' : 'text-slate-300 hover:bg-white/5'"
            >
              <div>
                <div class="flex items-center gap-1.5">
                  <span>{{ src.name }}</span>
                  <span v-if="src.id === 'local_db'" class="text-[10px] px-1.5 py-[2px] rounded bg-amber-500/20 text-amber-300 font-mono">18万+</span>
                </div>
                <div class="text-[11px] text-slate-400 font-normal mt-0.5">{{ src.desc }}</div>
              </div>
              <Check v-if="currentSource === src.id" class="w-4 h-4 text-sky-400 shrink-0" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 快捷标签与统计信息 -->
    <div class="flex items-center justify-between mb-3 text-xs text-slate-400 shrink-0 flex-wrap gap-2">
      <div class="flex items-center gap-2 flex-wrap">
        <span class="flex items-center gap-1.5 text-slate-400 font-semibold text-xs">
          <Sparkles class="w-4 h-4 text-amber-500" />
          <span>热门推荐:</span>
        </span>
        <button
          v-for="tag in quickTags"
          :key="tag"
          :disabled="loading"
          @click="searchQuery = tag; handleSearch(1)"
          class="px-3 py-1 rounded-xl btn-soft-action transition text-xs font-medium cursor-pointer"
        >
          {{ tag }}
        </button>
      </div>

      <div class="flex items-center gap-2 text-xs font-mono">
        <span class="btn-soft-action px-3 py-1 rounded-xl border text-slate-300">
          共 <strong class="theme-text-accent font-bold">{{ totalItems.toLocaleString() }}</strong> 款 · 第 <strong class="text-slate-100">{{ currentPage }}</strong> / {{ totalPages.toLocaleString() }} 页
        </span>
      </div>
    </div>

    <!-- 游戏卡片网格列表 (外层 relative 用于承载换源提示浮层) -->
    <div class="flex-1 relative min-h-0">
      <div ref="listViewportEl" class="h-full overflow-y-auto pr-1" @scroll="handleListScroll">
      <div v-if="loading && games.length === 0" class="flex flex-col items-center justify-center h-64 text-slate-400">
        <RotateCw class="w-8 h-8 animate-spin theme-text-accent mb-3" />
        <p class="text-sm">正在从 {{ currentSourceConfig.name }} 检索游戏数据...</p>
      </div>

      <div v-else-if="games.length === 0" class="flex flex-col items-center justify-center h-72 text-slate-400 p-6">
        <div class="w-16 h-16 rounded-2xl theme-card-static flex items-center justify-center text-2xl mb-3 shadow-inner">
          <Search class="w-7 h-7 text-slate-400" />
        </div>
        <p class="text-base font-bold text-slate-200 mb-1">未找到与「{{ searchQuery }}」匹配的游戏</p>
        
        <div v-if="/[\u4e00-\u9fa5]/.test(searchQuery)" class="mt-3 max-w-lg rounded-2xl p-5 text-center text-xs leading-relaxed shadow-sm bg-sky-500/10 border border-sky-500/30 text-sky-200">
          <div class="font-bold flex items-center justify-center gap-1.5 mb-1.5 text-sky-400 text-sm">
            <Sparkles class="w-4 h-4 text-sky-400" />
            <span>检索小贴士</span>
          </div>
          <p class="font-medium">当前接口未命中？您可以点击下方<strong>「切换下一个搜索接口」</strong>，或尝试输入<strong>英文原名</strong>与<strong>纯数字 AppID</strong> 秒级匹配！</p>
        </div>

        <p v-else class="text-xs text-slate-400 mt-2">
          请检查拼写，或点击下方按钮切换搜索数据源重试
        </p>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 pb-28">
        <div
          v-for="game in games"
          :key="game.appId"
          class="game-card-surface flex flex-col group"
        >
          <!-- 封面图 (支持多 CDN 智能镜像平滑加载) -->
          <div class="relative w-full aspect-[460/215] bg-slate-950 overflow-hidden flex items-center justify-center shrink-0">
            <img
              v-if="!failedImgs.has(game.appId)"
              :src="game.headerUrl || getGameCdnUrl(game.appId, 0)"
              :alt="game.name"
              class="w-full h-full object-cover group-hover:scale-[1.08] transition-transform duration-500 ease-out"
              loading="lazy"
              @error="handleImgError(game)"
            />
            
            <!-- 精致缺图占位卡片 -->
            <div v-else class="w-full h-full p-4 flex flex-col justify-between bg-gradient-to-br from-slate-900 via-slate-950 to-slate-900 border-b border-white/10">
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

            <div class="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent pointer-events-none"></div>

            <div class="absolute top-2.5 right-2.5 theme-card-static px-2.5 py-1 rounded-lg text-xs font-mono theme-text-accent font-bold shadow-sm border">
              ID: {{ game.appId }}
            </div>
            <div
              v-if="unlockedAppIds.includes(game.appId)"
              class="absolute top-2.5 left-2.5 bg-emerald-500/90 backdrop-blur-md px-2.5 py-1 rounded-lg text-xs font-bold text-slate-950 shadow-sm flex items-center gap-1.5"
            >
              <Check class="w-3.5 h-3.5 stroke-[3]" />
              <span>已在库中</span>
            </div>
          </div>

          <!-- 内容信息与操作栏 -->
          <div class="p-4 flex-1 flex flex-col justify-between gap-3">
            <div>
              <h3 class="font-bold text-slate-100 text-sm line-clamp-1 group-hover:theme-text-accent transition duration-150" :title="game.nameZh || game.name">
                {{ game.nameZh || game.name }}
              </h3>
              <p class="text-xs text-slate-400 line-clamp-1 mb-1 font-mono" :title="game.name">
                {{ game.name }}
              </p>
              <p class="text-xs text-slate-400 line-clamp-2 leading-relaxed mb-1" :title="game.description">
                {{ game.description || 'Steam 官方收录应用' }}
              </p>
            </div>

            <!-- 操作按钮条 -->
            <div class="pt-3 border-t border-white/10 flex items-center justify-between gap-2">
              <button
                v-if="!unlockedAppIds.includes(game.appId)"
                @click="unlockGame(game)"
                :disabled="unlockingId !== null"
                class="flex-1 py-2.5 theme-btn-primary disabled:opacity-50 text-xs font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RotateCw v-if="unlockingId !== null" class="w-4 h-4 animate-spin" />
                <PlusCircle v-else class="w-4 h-4" />
                <span>{{ unlockingId === game.appId ? '匹配清单与密钥...' : (unlockingId !== null ? '等待队列中...' : '一键入库 (含清单)') }}</span>
              </button>

              <template v-else>
                <a
                  :href="`steam://install/${game.appId}`"
                  title="在 Steam 中启动直接下载"
                  class="flex-1 py-2.5 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white text-xs font-bold rounded-xl shadow transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Download class="w-4 h-4" />
                  <span>Steam 下载</span>
                </a>

                <button
                  @click="removeGame(game.appId)"
                  title="从入库规则中移除"
                  class="px-3.5 py-2.5 btn-soft-action hover:bg-rose-900/60 hover:border-rose-500/40 text-slate-400 hover:text-rose-200 text-xs font-medium rounded-xl transition flex items-center justify-center cursor-pointer"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </template>

              <a
                :href="`https://store.steampowered.com/app/${game.appId}`"
                target="_blank"
                title="在 Steam 商店中查看"
                class="p-2.5 btn-soft-action hover:theme-text-accent rounded-xl transition shrink-0"
              >
                <ExternalLink class="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </div>
      </div>

      <!-- 底部浮动控制区：分页器常驻 + 换源提示按需浮现，同层堆叠互不遮挡 -->
      <div class="absolute inset-x-0 bottom-3 z-20 flex flex-col items-center gap-2 pointer-events-none px-4">
        <!-- 换源提示浮层：搜索后滚动到列表底部时浮现（悬浮展示不挤压列表，避免高度抖动导致闪烁） -->
        <Transition
          enter-active-class="transition duration-200 ease-out"
          enter-from-class="opacity-0 translate-y-2"
          enter-to-class="opacity-100 translate-y-0"
          leave-active-class="transition duration-150 ease-in"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <div v-if="hasSearched && listAtBottom" class="pointer-events-auto flex flex-col sm:flex-row items-center justify-center gap-3 text-xs text-slate-400 py-2.5 px-5 rounded-2xl theme-card-static shadow-2xl max-w-full">
            <div class="flex items-center gap-2 text-center">
              <Info class="w-4 h-4 text-sky-400 shrink-0" />
              <span>
                当前使用 <strong class="text-sky-400 font-bold font-mono">{{ currentSourceConfig.name }}</strong>
                <span class="mx-1 text-slate-500">|</span>
                对当前搜索内容满意吗，不满意点击切换下一个搜索接口
              </span>
            </div>

            <button
              @click="handleSwitchNextSource"
              :disabled="loading"
              class="px-4 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 active:bg-sky-500/35 border border-sky-500/40 text-sky-300 font-bold text-xs transition flex items-center gap-1.5 shadow-sm cursor-pointer shrink-0"
            >
              <ArrowLeftRight class="w-3.5 h-3.5 text-sky-400" />
              <span>切换下一个搜索接口</span>
            </button>
          </div>
        </Transition>

        <!-- 分页器浮层 -->
        <div v-if="totalPages > 1" class="pointer-events-auto flex items-center justify-center gap-1.5 flex-wrap theme-card-static shadow-2xl rounded-2xl px-3 py-2 text-xs max-w-full">
          <button
            @click="goToPage(1)"
            :disabled="currentPage === 1 || loading"
            class="px-3 py-1.5 rounded-xl btn-soft-action text-xs disabled:opacity-40 cursor-pointer font-medium"
            title="首页"
          >
            首页
          </button>
          <button
            @click="goToPage(currentPage - 1)"
            :disabled="currentPage === 1 || loading"
            class="px-3 py-1.5 rounded-xl btn-soft-action text-xs disabled:opacity-40 cursor-pointer flex items-center gap-1 font-medium"
          >
            <ChevronLeft class="w-3.5 h-3.5" />
            <span>上一页</span>
          </button>

          <!-- 快捷数字页码 -->
          <div class="hidden sm:flex items-center gap-1">
            <button
              v-for="p in visiblePages"
              :key="p"
              @click="goToPage(p)"
              class="w-7 h-7 rounded-lg text-xs font-mono font-bold transition flex items-center justify-center cursor-pointer"
              :class="currentPage === p ? 'theme-btn-primary shadow-sm' : 'btn-soft-action text-slate-300'"
            >
              {{ p }}
            </button>
          </div>

          <button
            @click="goToPage(currentPage + 1)"
            :disabled="currentPage === totalPages || loading"
            class="px-3 py-1.5 rounded-xl btn-soft-action text-xs disabled:opacity-40 cursor-pointer flex items-center gap-1 font-medium"
          >
            <span>下一页</span>
            <ChevronRight class="w-3.5 h-3.5" />
          </button>
          <button
            @click="goToPage(totalPages)"
            :disabled="currentPage === totalPages || loading"
            class="px-3 py-1.5 rounded-xl btn-soft-action text-xs disabled:opacity-40 cursor-pointer font-medium"
            title="末页"
          >
            末页 ({{ totalPages.toLocaleString() }})
          </button>

          <span class="h-4 w-px bg-slate-500/25 mx-1"></span>

          <!-- 页面直达跳转 -->
          <div class="flex items-center gap-1.5">
            <span class="text-slate-400">跳至</span>
            <input
              v-model.number="jumpPageInput"
              @keydown.enter="handleJumpPage"
              type="number"
              :min="1"
              :max="totalPages"
              placeholder="页码"
              class="w-16 theme-card-static rounded-xl px-2 py-1 text-center text-xs font-mono focus:outline-none focus:border-sky-400"
            />
            <span class="text-slate-400">页</span>
            <button
              @click="handleJumpPage"
              class="px-3 py-1.5 rounded-xl btn-soft-action text-xs font-bold hover:theme-text-accent cursor-pointer"
            >
              跳转
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, nextTick, onMounted, onUnmounted } from 'vue';
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
  ExternalLink,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Server,
  Info,
  ArrowLeftRight
} from 'lucide-vue-next';
import { SteamGame, SearchSourceId, SearchSourceConfig } from '../../types';

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

// 数据源系统
const searchSources: SearchSourceConfig[] = [
  { id: 'local_db', name: '本地18万+全量库', nameEn: 'Local 180K+ DB', desc: '纯客户端本地内存检索与分页 (3,800+页 0延迟/0服务器流量)', badge: '18万+' },
  { id: 'steam_official', name: 'Steam官方API', nameEn: 'Steam Official', desc: '直连 Steam 官方 Store 实时搜索，涵盖最新上架与热门游戏', badge: '官方' },
  { id: 'steam_community', name: 'Steam社区搜索源', nameEn: 'Steam Community', desc: '直连 Steam 社区应用与创意工坊检索', badge: '社区' },
  { id: 'hybrid', name: '全域智能聚合源', nameEn: 'Hybrid Aggregate', desc: '本地全量库与 Steam 官方源智能融合并去重', badge: '聚合' }
];

const currentSource = ref<SearchSourceId>('local_db');
const showSourceDropdown = ref(false);
const currentSourceConfig = computed(() => {
  return searchSources.find(s => s.id === currentSource.value) || searchSources[0];
});

// 分页系统
const currentPage = ref(1);
// 60 可被网格每行 1~5 列全部整除，保证任何屏宽下最后一行都不留空位
const pageSize = ref(60);
const totalItems = ref(0);
const totalPages = ref(1);
const jumpPageInput = ref<number | null>(null);

// 计算显示的快捷页码
const visiblePages = computed(() => {
  const current = currentPage.value;
  const max = totalPages.value;
  const delta = 2;
  const range: number[] = [];
  for (let i = Math.max(1, current - delta); i <= Math.min(max, current + delta); i++) {
    range.push(i);
  }
  return range;
});

// 换源提示浮层显隐：仅搜索后且列表滚动到底部时展示，首页不常驻
// 通过 ResizeObserver 兼顾窗口缩放与内容高度变化，避免放大窗口后状态失真
const listViewportEl = ref<HTMLElement | null>(null);
const hasSearched = ref(false);
const listAtBottom = ref(false);
let viewportResizeObserver: ResizeObserver | null = null;

const handleListScroll = () => {
  const el = listViewportEl.value;
  if (!el) return;
  listAtBottom.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
};

// 图片多 CDN 智能镜像加速与容错系统
const failedImgs = reactive(new Set<number>());
const imgCdnIndices = reactive(new Map<number, number>());

const CDN_TEMPLATES = [
  (id: number) => `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`,
  (id: number) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${id}/header.jpg`,
  (id: number) => `https://steamcdn-a.akamaihd.net/steam/apps/${id}/header.jpg`,
  (id: number) => `https://cdn.steamstatic.com/steam/apps/${id}/header.jpg`
];

const getGameCdnUrl = (appId: number, cdnIndex = 0): string => {
  const idx = cdnIndex % CDN_TEMPLATES.length;
  return CDN_TEMPLATES[idx](appId);
};

const handleImgError = async (game: SteamGame) => {
  // 已判定彻底失败的游戏不再重试，避免 error -> 请求 -> error 死循环
  if (failedImgs.has(game.appId)) return;

  const currentIdx = imgCdnIndices.get(game.appId) || 0;
  if (currentIdx + 1 < CDN_TEMPLATES.length) {
    const nextIdx = currentIdx + 1;
    imgCdnIndices.set(game.appId, nextIdx);
    game.headerUrl = getGameCdnUrl(game.appId, nextIdx);
    return;
  }

  // 所有 CDN 均失败：尝试一次 Steam 官方 API 动态获取（每 appId 仅一次，超过 CDN
  // 模板数的索引表示 API 已尝试过，直接判定失败）
  if (currentIdx > CDN_TEMPLATES.length) return;
  imgCdnIndices.set(game.appId, CDN_TEMPLATES.length + 1);
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${game.appId}&l=schinese`;
    const resp = await axios.get(url, { timeout: 3500 });
    const data = resp.data?.[game.appId.toString()];
    if (data && data.data && data.data.header_image) {
      // 先更新 URL 再保持"未失败"状态，让模板渲染新封面
      game.headerUrl = data.data.header_image;
      return;
    }
  } catch {}
  failedImgs.add(game.appId);
};

const quickTags = ['后室', '艾尔登法环', '双人成行', '只狼', '博德之门', '幻兽帕鲁', '太空狼人杀'];

// 搜索竞态守卫：只有最新一次请求的结果才允许落地
let searchRequestId = 0;

// 执行搜索
const handleSearch = async (page = 1) => {
  const requestId = ++searchRequestId;
  loading.value = true;
  currentPage.value = page;
  showSourceDropdown.value = false;

  try {
    const res = await window.electronAPI.searchGames({
      query: searchQuery.value,
      source: currentSource.value,
      page,
      pageSize: pageSize.value
    });

    if (requestId !== searchRequestId) return; // 已有更新的请求，丢弃过期结果

    if (res && res.items) {
      games.value = res.items;
      totalItems.value = res.total || res.items.length;
      totalPages.value = res.totalPages || Math.max(1, Math.ceil(totalItems.value / pageSize.value));
      currentPage.value = res.page || page;
    } else if (Array.isArray(res)) {
      games.value = res;
      totalItems.value = res.length;
      totalPages.value = 1;
      currentPage.value = 1;
    }

    if (searchQuery.value.trim()) hasSearched.value = true;

    // 新结果集就绪后重置图片容错状态，避免跨搜索/跨分页无限增长
    failedImgs.clear();
    imgCdnIndices.clear();

    // 回到列表顶部并重置底部检测，让换源提示条重新等用户翻到底
    await nextTick();
    if (listViewportEl.value) listViewportEl.value.scrollTop = 0;
    listAtBottom.value = false;
  } catch (e: any) {
    if (requestId === searchRequestId) emit('notify', `搜索失败: ${e.message}`, 'error');
  } finally {
    if (requestId === searchRequestId) loading.value = false;
  }
};

// 换源
const selectSource = (sourceId: SearchSourceId) => {
  currentSource.value = sourceId;
  showSourceDropdown.value = false;
  emit('notify', `已切换至「${currentSourceConfig.value.name}」`, 'info');
  handleSearch(1);
};

const handleSwitchNextSource = () => {
  const currentIndex = searchSources.findIndex(s => s.id === currentSource.value);
  const nextIndex = (currentIndex + 1) % searchSources.length;
  currentSource.value = searchSources[nextIndex].id;
  emit('notify', `已切换至「${searchSources[nextIndex].name}」！`, 'success');
  handleSearch(1);
};

// 分页跳转
const goToPage = (page: number) => {
  if (page >= 1 && page <= totalPages.value && page !== currentPage.value) {
    handleSearch(page);
  }
};

const handleJumpPage = () => {
  if (jumpPageInput.value && jumpPageInput.value >= 1 && jumpPageInput.value <= totalPages.value) {
    goToPage(jumpPageInput.value);
    jumpPageInput.value = null;
  }
};

const refreshData = async () => {
  await Promise.all([handleSearch(currentPage.value), loadUnlockedList()]);
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
  let activated = false;
  try {
    const lic = await window.electronAPI.getLicenseInfo();
    activated = !!(lic && lic.isActivated);
    if (!activated) {
      // 未激活设备：每日 2 次免费入库额度（按天刷新），用完需激活
      const quota = await window.electronAPI.getFreeUnlockQuota(false);
      if (!quota || !quota.allowed) {
        emit('notify', '今日免费入库次数已用完，请激活使用！激活后入库不限次数。', 'warning');
        emit('open-license-modal');
        return;
      }
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
      let message = res.message;
      if (!activated) {
        // 入库成功后扣减今日免费额度并提示剩余次数
        try {
          const q = await window.electronAPI.consumeFreeUnlockQuota(false);
          if (q && typeof q.remaining === 'number') {
            message += q.remaining > 0
              ? `（今日剩余免费入库 ${q.remaining} 次）`
              : '（今日免费次数已用完，再次入库请激活使用）';
          }
        } catch {}
      }
      emit('notify', message, 'success');
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

  // 视口尺寸变化（窗口缩放/缩放比例调整）时重新评估是否处于列表底部
  if (listViewportEl.value && typeof ResizeObserver !== 'undefined') {
    viewportResizeObserver = new ResizeObserver(handleListScroll);
    viewportResizeObserver.observe(listViewportEl.value);
  }
});

onUnmounted(() => {
  if (viewportResizeObserver) {
    viewportResizeObserver.disconnect();
    viewportResizeObserver = null;
  }
});
</script>
