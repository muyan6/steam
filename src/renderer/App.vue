<template>
  <div class="flex h-screen w-screen theme-bg-base text-slate-100 font-sans select-none overflow-hidden transition-colors duration-300">
    <!-- 左侧导航侧边栏 -->
    <aside class="w-64 bg-slate-950/40 border-r border-white/5 backdrop-blur-2xl flex flex-col justify-between shrink-0 z-20">
      <div>
        <!-- 品牌 Logo & 窗口拖拽区域 -->
        <div class="p-4 flex items-center gap-3.5 border-b border-white/5 app-drag-region">
          <div class="w-9 h-9 rounded-xl theme-btn-primary flex items-center justify-center text-slate-950 font-black text-base shadow-lg relative group shrink-0 app-no-drag">
            <Zap class="w-4 h-4 text-slate-950 fill-slate-950" />
            <div class="absolute inset-0 rounded-xl bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          </div>
          <div class="min-w-0 flex-1 app-no-drag">
            <h1 class="font-bold text-sm tracking-wide text-slate-100 flex items-center gap-1.5">
              <span class="truncate font-black">SteamMaster</span>
              <span class="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800/80 theme-text-accent font-mono font-bold border border-white/10">v{{ appVersion }}</span>
            </h1>
            <p class="text-[10px] text-slate-400 truncate">极速入库 · 联机生态引擎</p>
          </div>
        </div>

        <!-- 导航菜单 -->
        <nav class="p-3 space-y-1.5 app-no-drag">
          <button
            v-for="item in navItems"
            :key="item.id"
            @click="currentTab = item.id"
            class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 text-left relative group"
            :class="currentTab === item.id 
              ? 'theme-nav-active border' 
              : 'text-slate-400 hover:text-slate-100 hover:bg-white/5 border border-transparent'"
          >
            <component 
              :is="item.iconComponent" 
              class="w-4 h-4 transition-colors shrink-0" 
              :class="currentTab === item.id ? 'theme-text-accent' : 'text-slate-400 group-hover:text-slate-100'"
            />
            <span class="truncate">{{ item.label }}</span>
            <span 
              v-if="currentTab === item.id" 
              class="absolute right-2.5 w-1.5 h-1.5 rounded-full bg-current opacity-90 shadow-sm"
            ></span>
          </button>
        </nav>
      </div>

      <!-- 底部状态指示面板 -->
      <div class="p-3.5 m-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md text-xs shadow-inner app-no-drag">
        <div class="flex items-center justify-between mb-2.5">
          <span class="text-slate-400 flex items-center gap-1.5 text-[11px]">
            <Activity class="w-3.5 h-3.5 text-slate-400" />
            <span>Steam 客户端:</span>
          </span>
          <div class="flex items-center gap-1.5">
            <span
              v-if="steamInfo.steamBitness && steamInfo.steamBitness !== 'unknown'"
              class="px-1.5 py-0.2 rounded text-[10px] bg-slate-800/80 text-slate-300 font-mono font-semibold border border-white/10"
            >
              {{ steamInfo.steamBitness === 'x86' ? '32位' : '64位' }}
            </span>
            <span class="flex items-center gap-1.5 text-[11px] font-bold" :class="steamInfo.isRunning ? 'text-emerald-400' : 'text-slate-400'">
              <span class="w-2 h-2 rounded-full" :class="steamInfo.isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'"></span>
              {{ steamInfo.isRunning ? '运行中' : '未启动' }}
            </span>
          </div>
        </div>

        <div class="flex items-center justify-between mb-2.5 text-[11px] bg-slate-950/40 px-2.5 py-1.5 rounded-xl border border-white/5">
          <span class="text-slate-400">已生效规则:</span>
          <span class="theme-text-accent font-mono font-bold">{{ steamInfo.scriptsCount }} 款应用</span>
        </div>

        <button
          @click="handleRestartSteam"
          class="w-full py-2 bg-slate-800/80 hover:bg-slate-700/90 text-slate-200 text-xs font-medium rounded-xl transition duration-200 border border-white/10 flex items-center justify-center gap-2 group shadow-sm active:scale-95"
        >
          <RotateCw class="w-3.5 h-3.5 text-slate-400 group-hover:theme-text-accent transition group-hover:rotate-180 duration-500" />
          <span>重启 Steam</span>
        </button>
      </div>
    </aside>

    <!-- 右侧主体内容区域 (全沉浸式标题栏设计) -->
    <main class="flex-1 flex flex-col h-full overflow-hidden theme-bg-subtle relative">
      <!-- 顶部沉浸式自定义窗口栏 (兼具拖拽区与窗口控制) -->
      <header class="h-11 border-b border-white/5 px-4 flex items-center justify-between shrink-0 bg-slate-950/20 backdrop-blur-md z-30 app-drag-region">
        <!-- 左侧：路径与状态 -->
        <div class="flex items-center gap-2 text-xs text-slate-400 min-w-0 app-no-drag">
          <Folder class="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span class="shrink-0 text-[11px]">Steam:</span>
          <span class="font-mono text-slate-300 truncate max-w-xs bg-white/5 px-2 py-0.5 rounded-lg border border-white/5 text-[11px]" :title="steamInfo.steamPath || '未检测到'">
            {{ steamInfo.steamPath || '正在探测中...' }}
          </span>
        </div>

        <!-- 中间：拖拽区域标签 -->
        <div class="text-[11px] font-mono text-slate-400/60 hidden lg:flex items-center gap-1.5 select-none pointer-events-none">
          <span>SteamMaster</span>
          <span>•</span>
          <span>{{ currentTabTitle }}</span>
        </div>

        <!-- 右侧：云端引擎状态与无边框原生感窗口控制按钮 -->
        <div class="flex items-center gap-2.5 shrink-0">
          <div class="flex items-center gap-2 text-xs app-no-drag">
            <span class="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 font-mono text-[10px] border border-sky-500/20">
              <Cloud class="w-3 h-3" />
              <span>18万+ 云端库</span>
            </span>
            <span 
              class="flex items-center gap-1.5 px-2 py-0.5 rounded-full font-mono text-[10px] border"
              :class="steamInfo.ostInstalled ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border-amber-500/20'"
            >
              <ShieldCheck class="w-3 h-3" />
              <span>{{ steamInfo.ostInstalled ? 'OST 内核' : '待同步' }}</span>
            </span>
          </div>

          <!-- 沉浸式窗口最小化、最大化、关闭按钮组 -->
          <div class="flex items-center pl-2 ml-1 border-l border-white/10 app-no-drag">
            <button
              @click="handleWindowMinimize"
              title="最小化"
              class="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-white/10 rounded-md transition"
            >
              <Minus class="w-3.5 h-3.5" />
            </button>
            <button
              @click="handleWindowMaximize"
              :title="isMaximized ? '还原' : '最大化'"
              class="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-white/10 rounded-md transition"
            >
              <Square v-if="!isMaximized" class="w-3 h-3" />
              <Copy v-else class="w-3 h-3" />
            </button>
            <button
              @click="handleWindowClose"
              title="关闭程序"
              class="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-white hover:bg-rose-600 rounded-md transition"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      <!-- 顶部横幅公告 (如果类型为 banner) -->
      <div v-if="bannerNotice && bannerNotice.enabled" class="bg-gradient-to-r from-sky-950/80 via-slate-900/90 to-sky-950/80 border-b border-sky-500/30 px-6 py-2 flex items-center justify-between text-xs text-sky-200 shrink-0 backdrop-blur-md z-10">
        <div class="flex items-center gap-2 truncate">
          <Bell class="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span class="font-bold shrink-0">{{ bannerNotice.title }}:</span>
          <span class="text-slate-300 truncate">{{ bannerNotice.content }}</span>
        </div>
        <button @click="bannerNotice = null" class="text-slate-400 hover:text-slate-200 ml-4 shrink-0 p-1 hover:bg-slate-800/60 rounded">
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- 动态视图区域 -->
      <div class="flex-1 overflow-hidden">
        <SearchView
          v-if="currentTab === 'search'"
          @notify="addToast"
          @refresh-status="fetchSteamInfo"
        />
        <LibraryView
          v-else-if="currentTab === 'library'"
          @notify="addToast"
          @refresh-status="fetchSteamInfo"
        />
        <OnlineFixView
          v-else-if="currentTab === 'onlinefix'"
          @notify="addToast"
        />
        <SettingsView
          v-else-if="currentTab === 'settings'"
          @notify="addToast"
          @refresh-status="fetchSteamInfo"
          @relaunch-wizard="showStartupWizard = true"
        />
      </div>
    </main>

    <!-- 启动向导模态框 -->
    <StartupWizardModal
      v-if="showStartupWizard"
      @completed="onStartupCompleted"
      @notify="addToast"
    />

    <!-- 全局系统公告弹窗 -->
    <div v-if="popupNotice" class="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4">
      <div class="theme-card-static rounded-3xl w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200 border">
        <div class="flex items-center gap-3.5 mb-4">
          <div class="w-10 h-10 rounded-2xl bg-sky-500/10 text-sky-400 flex items-center justify-center border border-sky-500/20">
            <Bell class="w-5 h-5" />
          </div>
          <div>
            <h3 class="font-bold text-sm text-slate-100">{{ popupNotice.title }}</h3>
            <p class="text-[11px] text-slate-400">系统官方公告</p>
          </div>
        </div>

        <div class="text-xs text-slate-300 leading-relaxed whitespace-pre-line mb-6 bg-slate-950/40 p-4 rounded-2xl border border-white/10">
          {{ popupNotice.content }}
        </div>

        <div class="flex items-center justify-end gap-3">
          <button
            @click="closePopupNotice"
            class="theme-btn-primary px-5 py-2.5 text-xs font-bold rounded-xl transition shadow"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>

    <!-- 全局版本更新弹窗 -->
    <div v-if="versionModal" class="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4">
      <div class="theme-card-static rounded-3xl w-full max-w-lg p-6 shadow-2xl border">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3.5">
            <div class="w-10 h-10 rounded-2xl theme-btn-primary flex items-center justify-center text-slate-950 font-bold">
              <Sparkles class="w-5 h-5" />
            </div>
            <div>
              <h3 class="font-bold text-sm text-slate-100 flex items-center gap-2">
                <span>发现新版本 v{{ versionModal.latest.version }}</span>
                <span v-if="versionModal.forceUpdate" class="px-2 py-0.5 bg-rose-500/20 text-rose-400 text-[10px] rounded font-bold border border-rose-500/30">强制更新</span>
              </h3>
              <p class="text-[11px] text-slate-400">发布日期: {{ versionModal.latest.releaseDate }}</p>
            </div>
          </div>
        </div>

        <div class="mb-4">
          <div class="text-xs font-bold text-slate-200 mb-2">更新日志：</div>
          <ul class="text-xs text-slate-300 space-y-1.5 bg-slate-950/40 p-4 rounded-2xl border border-white/10 max-h-48 overflow-y-auto">
            <li v-for="(log, idx) in versionModal.latest.changelog" :key="idx" class="flex items-start gap-2">
              <span class="theme-text-accent font-bold">•</span>
              <span>{{ log }}</span>
            </li>
          </ul>
        </div>

        <div v-if="versionModal.forceUpdate" class="text-[11px] text-amber-400 mb-4 bg-amber-950/30 border border-amber-800/50 p-2.5 rounded-xl flex items-center gap-2">
          <AlertTriangle class="w-4 h-4 shrink-0" />
          <span>当前版本已停止支持，必须更新至最新版本方可继续使用。</span>
        </div>

        <div class="flex items-center justify-end gap-3">
          <button
            v-if="!versionModal.forceUpdate"
            @click="versionModal = null"
            class="px-4 py-2 bg-slate-800/80 hover:bg-slate-700 border border-white/10 text-slate-300 text-xs rounded-xl transition"
          >
            稍后更新
          </button>
          <a
            :href="versionModal.latest.downloadUrl"
            target="_blank"
            class="theme-btn-primary px-5 py-2 text-xs font-bold rounded-xl transition shadow flex items-center gap-1.5"
          >
            <span>立即下载更新</span>
            <span>➔</span>
          </a>
        </div>
      </div>
    </div>

    <!-- 全局 Toast 提示 -->
    <Toast :toasts="toasts" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { 
  Search, 
  Library, 
  Gamepad2, 
  Settings2, 
  Zap, 
  RotateCw, 
  Folder, 
  Cloud, 
  ShieldCheck, 
  Bell, 
  X, 
  Sparkles, 
  Activity, 
  AlertTriangle,
  Minus,
  Square,
  Copy
} from 'lucide-vue-next';
import SearchView from './views/SearchView.vue';
import LibraryView from './views/LibraryView.vue';
import OnlineFixView from './views/OnlineFixView.vue';
import SettingsView from './views/SettingsView.vue';
import StartupWizardModal from './components/StartupWizardModal.vue';
import Toast, { ToastItem } from './components/Toast.vue';
import { SteamEnvironmentInfo } from '../types';
import { useTheme } from './composables/useTheme';

const appVersion = '1.0.0';
const currentTab = ref<'search' | 'library' | 'onlinefix' | 'settings'>('search');
const showStartupWizard = ref(false);
const isMaximized = ref(false);

const { initTheme } = useTheme();

const navItems = [
  { id: 'search' as const, label: '游戏检索与入库', iconComponent: Search },
  { id: 'library' as const, label: '已入库规则管理', iconComponent: Library },
  { id: 'onlinefix' as const, label: '联机修复中心', iconComponent: Gamepad2 },
  { id: 'settings' as const, label: '系统与环境设置', iconComponent: Settings2 },
];

const currentTabTitle = computed(() => {
  const match = navItems.find(i => i.id === currentTab.value);
  return match?.label || '控制台';
});

const steamInfo = ref<SteamEnvironmentInfo>({
  steamPath: null,
  isRunning: false,
  ostInstalled: false,
  scriptsCount: 0,
  globalOnlineFixEnabled: false
});

const onStartupCompleted = async () => {
  showStartupWizard.value = false;
  await fetchSteamInfo();
  addToast('SteamMaster 启动引导完成，已进入主界面！', 'success');
};

// 窗口控制
const handleWindowMinimize = async () => {
  try {
    await window.electronAPI.windowMinimize();
  } catch (e) {
    console.warn('窗口最小化失败:', e);
  }
};

const handleWindowMaximize = async () => {
  try {
    const res = await window.electronAPI.windowMaximize();
    isMaximized.value = res;
  } catch (e) {
    console.warn('窗口最大化失败:', e);
  }
};

const handleWindowClose = async () => {
  try {
    await window.electronAPI.windowClose();
  } catch (e) {
    await window.electronAPI.quitApp();
  }
};

// 公告与版本更新状态
const popupNotice = ref<any>(null);
const bannerNotice = ref<any>(null);
const versionModal = ref<any>(null);

const toasts = ref<ToastItem[]>([]);
let toastId = 0;

const addToast = (message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
  const id = ++toastId;
  toasts.value.push({ id, message, type });
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, 3500);
};

const fetchSteamInfo = async () => {
  try {
    const info = await window.electronAPI.getSteamInfo();
    steamInfo.value = info;
    return info;
  } catch (e: any) {
    console.error('获取 Steam 状态失败:', e);
    return null;
  }
};

const handleRestartSteam = async () => {
  try {
    addToast('正在安全重启 Steam 客户端...', 'info');
    await window.electronAPI.restartSteam();
    addToast('Steam 重启指令已发送！', 'success');
    await fetchSteamInfo();
  } catch (e: any) {
    addToast(`重启失败: ${e.message}`, 'error');
  }
};

const closePopupNotice = () => {
  if (popupNotice.value && popupNotice.value.popupOnce) {
    localStorage.setItem(`read_notice_${popupNotice.value.id}`, 'true');
  }
  popupNotice.value = null;
};

const checkNoticeAndVersion = async () => {
  try {
    const notice = await window.electronAPI.checkNotice();
    if (notice && notice.enabled) {
      if (notice.type === 'banner') {
        bannerNotice.value = notice;
      } else {
        const isRead = notice.popupOnce && localStorage.getItem(`read_notice_${notice.id}`);
        if (!isRead) {
          popupNotice.value = notice;
        }
      }
    }

    const versionRes = await window.electronAPI.checkVersion(appVersion);
    if (versionRes && versionRes.hasUpdate) {
      versionModal.value = versionRes;
    }
  } catch (e) {
    console.warn('检查公告与版本失败:', e);
  }
};

const initApp = async () => {
  initTheme();
  try {
    const info = await fetchSteamInfo();
    if (info && info.steamPath && info.ostInstalled && info.steamBitness === 'x64') {
      showStartupWizard.value = false;
    } else {
      showStartupWizard.value = true;
    }
  } catch {
    showStartupWizard.value = true;
  }

  checkNoticeAndVersion();
};

onMounted(() => {
  initApp();
  setInterval(fetchSteamInfo, 5000);
});
</script>
