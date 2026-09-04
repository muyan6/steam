<template>
  <div class="flex h-screen w-screen theme-bg-base text-slate-100 font-sans select-none overflow-hidden transition-colors duration-300">
    <!-- 左侧导航侧边栏 -->
    <aside class="w-64 bg-slate-950/70 border-r border-slate-800/60 backdrop-blur-xl flex flex-col justify-between shrink-0 z-20">
      <div>
        <!-- 品牌 Logo -->
        <div class="p-5 flex items-center gap-3.5 border-b border-slate-800/60">
          <div class="w-10 h-10 rounded-xl theme-btn-primary flex items-center justify-center text-slate-950 font-black text-lg shadow-lg relative group">
            <Zap class="w-5 h-5 text-slate-950 fill-slate-950" />
            <div class="absolute inset-0 rounded-xl bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          </div>
          <div class="min-w-0 flex-1">
            <h1 class="font-bold text-sm tracking-wide text-slate-100 flex items-center gap-1.5">
              <span class="truncate">SteamMaster</span>
              <span class="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-800 text-sky-300 font-mono font-bold border border-slate-700">v{{ appVersion }}</span>
            </h1>
            <p class="text-[11px] text-slate-400 truncate">一键入库 · 联机管理助手</p>
          </div>
        </div>

        <!-- 导航菜单 -->
        <nav class="p-3 space-y-1.5">
          <button
            v-for="item in navItems"
            :key="item.id"
            @click="currentTab = item.id"
            class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all duration-200 text-left relative group"
            :class="currentTab === item.id 
              ? 'theme-nav-active border' 
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60 border border-transparent'"
          >
            <component 
              :is="item.iconComponent" 
              class="w-4 h-4 transition-colors shrink-0" 
              :class="currentTab === item.id ? 'theme-text-accent' : 'text-slate-400 group-hover:text-slate-200'"
            />
            <span class="truncate">{{ item.label }}</span>
            <span 
              v-if="currentTab === item.id" 
              class="absolute right-2.5 w-1.5 h-1.5 rounded-full bg-current opacity-80"
            ></span>
          </button>
        </nav>
      </div>

      <!-- 底部状态指示面板 -->
      <div class="p-4 m-3 rounded-2xl bg-slate-900/70 border border-slate-800/80 backdrop-blur-md text-xs shadow-inner">
        <div class="flex items-center justify-between mb-2.5">
          <span class="text-slate-400 flex items-center gap-1.5">
            <Activity class="w-3.5 h-3.5 text-slate-400" />
            <span>Steam 客户端:</span>
          </span>
          <div class="flex items-center gap-1.5">
            <span
              v-if="steamInfo.steamBitness && steamInfo.steamBitness !== 'unknown'"
              class="px-1.5 py-0.5 rounded text-[10px] bg-slate-800/90 text-slate-300 font-mono font-semibold border border-slate-700/60"
            >
              {{ steamInfo.steamBitness === 'x86' ? '32位' : '64位' }}
            </span>
            <span class="flex items-center gap-1.5 font-bold" :class="steamInfo.isRunning ? 'text-emerald-400' : 'text-slate-400'">
              <span class="w-2 h-2 rounded-full" :class="steamInfo.isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'"></span>
              {{ steamInfo.isRunning ? '运行中' : '未启动' }}
            </span>
          </div>
        </div>

        <div class="flex items-center justify-between mb-3 text-[11px] bg-slate-950/50 px-2.5 py-1.5 rounded-lg border border-slate-800/60">
          <span class="text-slate-400">已生效规则:</span>
          <span class="theme-text-accent font-mono font-bold">{{ steamInfo.scriptsCount }} 款应用</span>
        </div>

        <button
          @click="handleRestartSteam"
          class="w-full py-2 bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl transition duration-200 border border-slate-700/60 hover:border-slate-600 flex items-center justify-center gap-2 group shadow-sm active:scale-95"
        >
          <RotateCw class="w-3.5 h-3.5 text-slate-400 group-hover:text-sky-300 transition group-hover:rotate-180 duration-500" />
          <span>重启 Steam</span>
        </button>
      </div>
    </aside>

    <!-- 右侧主体内容区域 -->
    <main class="flex-1 flex flex-col h-full overflow-hidden theme-bg-subtle relative">
      <!-- 顶部轻量状态条 -->
      <header class="h-12 border-b border-slate-800/60 px-6 flex items-center justify-between shrink-0 bg-slate-950/30 backdrop-blur-md z-10">
        <div class="flex items-center gap-2 text-xs text-slate-400 min-w-0">
          <Folder class="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span class="shrink-0">Steam 路径:</span>
          <span class="font-mono text-slate-300 truncate max-w-md bg-slate-900/60 px-2 py-0.5 rounded border border-slate-800/80 text-[11px]" :title="steamInfo.steamPath || '未检测到'">
            {{ steamInfo.steamPath || '正在探测中...' }}
          </span>
        </div>

        <div class="flex items-center gap-2.5 text-xs shrink-0">
          <span class="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-300 font-mono text-[11px] border border-sky-500/20">
            <Cloud class="w-3 h-3" />
            <span>18万+ 云端库</span>
          </span>
          <span 
            class="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-mono text-[11px] border"
            :class="steamInfo.ostInstalled ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border-amber-500/20'"
          >
            <ShieldCheck class="w-3 h-3" />
            <span>{{ steamInfo.ostInstalled ? 'OST 内核就绪' : '待同步环境' }}</span>
          </span>
        </div>
      </header>

      <!-- 顶部横幅公告 (如果类型为 banner) -->
      <div v-if="bannerNotice && bannerNotice.enabled" class="bg-gradient-to-r from-sky-950/80 via-slate-900/90 to-sky-950/80 border-b border-sky-500/30 px-6 py-2 flex items-center justify-between text-xs text-sky-200 shrink-0 backdrop-blur-md">
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
    <div v-if="popupNotice" class="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
      <div class="theme-card-static rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200 border">
        <div class="flex items-center gap-3.5 mb-4">
          <div class="w-10 h-10 rounded-xl bg-sky-500/10 text-sky-400 flex items-center justify-center border border-sky-500/20">
            <Bell class="w-5 h-5" />
          </div>
          <div>
            <h3 class="font-bold text-sm text-slate-100">{{ popupNotice.title }}</h3>
            <p class="text-[11px] text-slate-400">系统官方公告</p>
          </div>
        </div>

        <div class="text-xs text-slate-300 leading-relaxed whitespace-pre-line mb-6 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
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
    <div v-if="versionModal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div class="theme-card-static rounded-2xl w-full max-w-lg p-6 shadow-2xl border">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3.5">
            <div class="w-10 h-10 rounded-xl theme-btn-primary flex items-center justify-center text-slate-950 font-bold">
              <Sparkles class="w-5 h-5" />
            </div>
            <div>
              <h3 class="font-bold text-sm text-slate-100 flex items-center gap-2">
                <span>发现新版本 v{{ versionModal.latest.version }}</span>
                <span v-if="versionModal.forceUpdate" class="px-2 py-0.5 bg-rose-500/20 text-rose-300 text-[10px] rounded font-bold">强制更新</span>
              </h3>
              <p class="text-[11px] text-slate-400">发布日期: {{ versionModal.latest.releaseDate }}</p>
            </div>
          </div>
        </div>

        <div class="mb-4">
          <div class="text-xs font-bold text-slate-300 mb-2">更新日志：</div>
          <ul class="text-xs text-slate-300 space-y-1.5 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80 max-h-48 overflow-y-auto">
            <li v-for="(log, idx) in versionModal.latest.changelog" :key="idx" class="flex items-start gap-2">
              <span class="theme-text-accent font-bold">•</span>
              <span>{{ log }}</span>
            </li>
          </ul>
        </div>

        <div v-if="versionModal.forceUpdate" class="text-[11px] text-amber-400 mb-4 bg-amber-950/30 border border-amber-800/50 p-2.5 rounded-lg flex items-center gap-2">
          <AlertTriangle class="w-4 h-4 shrink-0" />
          <span>当前版本已停止支持，必须更新至最新版本方可继续使用。</span>
        </div>

        <div class="flex items-center justify-end gap-3">
          <button
            v-if="!versionModal.forceUpdate"
            @click="versionModal = null"
            class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-xl transition"
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
import { ref, onMounted } from 'vue';
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
  AlertTriangle 
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

const { initTheme } = useTheme();

const navItems = [
  { id: 'search' as const, label: '游戏检索与入库', iconComponent: Search },
  { id: 'library' as const, label: '已入库规则管理', iconComponent: Library },
  { id: 'onlinefix' as const, label: '联机修复中心', iconComponent: Gamepad2 },
  { id: 'settings' as const, label: '系统与环境设置', iconComponent: Settings2 },
];

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
    // 1. 检查最新公告
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

    // 2. 检查版本更新
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
    // 核心判定：若已检测到 Steam 路径、已部署注入核心且为 64 位，则直接进入主界面
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
