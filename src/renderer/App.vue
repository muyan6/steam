<template>
  <div class="flex h-screen w-screen bg-steam-darker text-slate-100 font-sans select-none overflow-hidden">
    <!-- 左侧导航侧边栏 -->
    <aside class="w-64 bg-slate-950/80 border-r border-slate-800/80 flex flex-col justify-between shrink-0">
      <div>
        <!-- 品牌 Logo -->
        <div class="p-5 flex items-center gap-3 border-b border-slate-800/60">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-lg shadow-lg">
            ⚡
          </div>
          <div>
            <h1 class="font-bold text-sm tracking-wide text-slate-100 flex items-center gap-1.5">
              <span>SteamMaster</span>
              <span class="text-[10px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-400 font-mono">v{{ appVersion }}</span>
            </h1>
            <p class="text-[11px] text-slate-400">商业版 · 一键入库 & 联机助手</p>
          </div>
        </div>

        <!-- 导航菜单 -->
        <nav class="p-3 space-y-1.5">
          <button
            v-for="item in navItems"
            :key="item.id"
            @click="currentTab = item.id"
            class="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-semibold transition text-left"
            :class="currentTab === item.id ? 'bg-gradient-to-r from-sky-600/30 to-teal-600/20 text-sky-300 border border-sky-500/30 shadow-sm' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'"
          >
            <span class="text-base">{{ item.icon }}</span>
            <span>{{ item.label }}</span>
          </button>
        </nav>
      </div>

      <!-- 底部状态指示面板 -->
      <div class="p-4 m-3 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs">
        <div class="flex items-center justify-between mb-2">
          <span class="text-slate-400">Steam 状态:</span>
          <div class="flex items-center gap-1.5">
            <span
              v-if="steamInfo.steamBitness && steamInfo.steamBitness !== 'unknown'"
              class="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-300 font-mono"
            >
              {{ steamInfo.steamBitness === 'x86' ? '32位' : '64位' }}
            </span>
            <span class="flex items-center gap-1.5 font-bold" :class="steamInfo.isRunning ? 'text-emerald-400' : 'text-slate-400'">
              <span class="w-2 h-2 rounded-full" :class="steamInfo.isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'"></span>
              {{ steamInfo.isRunning ? '运行中' : '已停止' }}
            </span>
          </div>
        </div>

        <div class="flex items-center justify-between mb-3 text-[11px]">
          <span class="text-slate-400">已生效规则:</span>
          <span class="text-sky-300 font-mono font-bold">{{ steamInfo.scriptsCount }} 个应用</span>
        </div>

        <button
          @click="handleRestartSteam"
          class="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition border border-slate-700/60 flex items-center justify-center gap-1.5"
        >
          <span>⚡ 重启 Steam</span>
        </button>
      </div>
    </aside>

    <!-- 右侧主体内容区域 -->
    <main class="flex-1 flex flex-col h-full overflow-hidden bg-gradient-to-br from-steam-darker via-steam-dark to-slate-950">
      <!-- 顶部轻量状态条 -->
      <header class="h-12 border-b border-slate-800/60 px-6 flex items-center justify-between shrink-0 bg-slate-950/40 backdrop-blur-sm">
        <div class="flex items-center gap-2 text-xs text-slate-400">
          <span>Steam 路径:</span>
          <span class="font-mono text-slate-300 truncate max-w-md" :title="steamInfo.steamPath || '未检测到'">
            {{ steamInfo.steamPath || '正在探测中...' }}
          </span>
        </div>

        <div class="flex items-center gap-3 text-xs">
          <span class="text-slate-400">云端引擎:</span>
          <span class="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono text-[11px]">
            ☁️ 18万+ 实时云端库
          </span>
          <span class="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-[11px]">
            {{ steamInfo.ostInstalled ? '✓ OST 就绪' : '⚠️ 待同步' }}
          </span>
        </div>
      </header>

      <!-- 顶部横幅公告 (如果类型为 banner) -->
      <div v-if="bannerNotice && bannerNotice.enabled" class="bg-gradient-to-r from-sky-900/60 via-indigo-900/50 to-slate-900/60 border-b border-sky-500/30 px-6 py-2 flex items-center justify-between text-xs text-sky-200 shrink-0">
        <div class="flex items-center gap-2 truncate">
          <span>📢</span>
          <span class="font-bold">{{ bannerNotice.title }}:</span>
          <span class="text-slate-300 truncate">{{ bannerNotice.content }}</span>
        </div>
        <button @click="bannerNotice = null" class="text-slate-400 hover:text-slate-200 ml-4 shrink-0">✕</button>
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

    <!-- 启动向导模态框：检测 Steam -> 询问是否注入 (否直接退出) -> 激活注入 -> 进入主界面 -->
    <StartupWizardModal
      v-if="showStartupWizard"
      @completed="onStartupCompleted"
      @notify="addToast"
    />

    <!-- 全局系统公告弹窗 -->
    <div v-if="popupNotice" class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in-95">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-10 h-10 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center text-xl">
            📢
          </div>
          <div>
            <h3 class="font-bold text-sm text-slate-100">{{ popupNotice.title }}</h3>
            <p class="text-[11px] text-slate-400">系统官方公告</p>
          </div>
        </div>

        <div class="text-xs text-slate-300 leading-relaxed whitespace-pre-line mb-6 bg-slate-950/60 p-4 rounded-xl border border-slate-800">
          {{ popupNotice.content }}
        </div>

        <div class="flex items-center justify-end gap-3">
          <button
            @click="closePopupNotice"
            class="px-5 py-2.5 bg-gradient-to-r from-sky-600 to-teal-600 hover:from-sky-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl transition shadow"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>

    <!-- 全局版本更新弹窗 -->
    <div v-if="versionModal" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div class="bg-slate-900 border border-sky-500/50 rounded-2xl w-full max-w-lg p-6 shadow-2xl">
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-teal-400 text-slate-950 flex items-center justify-center text-xl font-bold">
              🚀
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
          <ul class="text-xs text-slate-300 space-y-1.5 bg-slate-950/60 p-4 rounded-xl border border-slate-800 max-h-48 overflow-y-auto">
            <li v-for="(log, idx) in versionModal.latest.changelog" :key="idx" class="flex items-start gap-1.5">
              <span class="text-sky-400">•</span>
              <span>{{ log }}</span>
            </li>
          </ul>
        </div>

        <div v-if="versionModal.forceUpdate" class="text-[11px] text-amber-400 mb-4 bg-amber-950/30 border border-amber-800/50 p-2.5 rounded-lg flex items-center gap-2">
          <span>⚠️</span>
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
            class="px-5 py-2 bg-gradient-to-r from-sky-600 to-teal-600 hover:from-sky-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl transition shadow flex items-center gap-1.5"
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
import SearchView from './views/SearchView.vue';
import LibraryView from './views/LibraryView.vue';
import OnlineFixView from './views/OnlineFixView.vue';
import SettingsView from './views/SettingsView.vue';
import StartupWizardModal from './components/StartupWizardModal.vue';
import Toast, { ToastItem } from './components/Toast.vue';
import { SteamEnvironmentInfo } from '../types';

const appVersion = '1.0.0';
const currentTab = ref<'search' | 'library' | 'onlinefix' | 'settings'>('search');
const showStartupWizard = ref(false);

const navItems = [
  { id: 'search' as const, label: '游戏检索与入库', icon: '🔍' },
  { id: 'library' as const, label: '已入库规则管理', icon: '📚' },
  { id: 'onlinefix' as const, label: '联机修复中心', icon: '🎮' },
  { id: 'settings' as const, label: '系统与环境设置', icon: '⚙️' },
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
    addToast('正在重启 Steam 客户端...', 'info');
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
  try {
    const info = await fetchSteamInfo();
    // 核心判定：若已检测到 Steam 路径、已部署注入核心且为 64 位，则直接进入主界面
    if (info && info.steamPath && info.ostInstalled && info.steamBitness === 'x64') {
      showStartupWizard.value = false;
    } else {
      // 首次使用、未注入或检测到 32 位老版本异常时唤起启动引导
      showStartupWizard.value = true;
    }
  } catch {
    showStartupWizard.value = true;
  }

  checkNoticeAndVersion();
};

onMounted(() => {
  initApp();
  // 每隔 5 秒自动同步一次 Steam 运行状态
  setInterval(fetchSteamInfo, 5000);
});
</script>
