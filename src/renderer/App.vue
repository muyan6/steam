<template>
  <div class="flex h-screen w-screen theme-bg-base text-slate-100 font-sans select-none overflow-hidden transition-colors duration-300">
    <!-- 左侧导航侧边栏 -->
    <aside class="w-60 xl:w-64 bg-slate-950/40 border-r border-white/5 backdrop-blur-2xl flex flex-col justify-between shrink-0 z-20 transition-all duration-300">
      <div>
        <!-- 品牌 Logo & 窗口拖拽区域 -->
        <div class="p-4 flex items-center gap-3 border-b border-white/5 app-drag-region">
          <div class="w-9 h-9 rounded-2xl theme-btn-primary flex items-center justify-center text-slate-950 font-black text-lg shadow-lg relative group shrink-0 app-no-drag">
            <Zap class="w-5 h-5 text-slate-950 fill-slate-950" />
            <div class="absolute inset-0 rounded-2xl bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          </div>
          <div class="min-w-0 flex-1 app-no-drag">
            <h1 class="font-bold text-base tracking-wide text-slate-100 flex items-center gap-2">
              <span class="truncate font-black text-slate-100">春风渡</span>
              <span class="text-[11px] px-2 py-0.5 rounded-full bg-slate-800/80 theme-text-accent font-mono font-bold border border-white/10">v{{ appVersion }}</span>
            </h1>
            <p class="text-[11px] text-slate-400 truncate mt-0.5">极速入库 · 联机生态引擎</p>
          </div>
        </div>

        <!-- 导航菜单 -->
        <nav class="p-3 space-y-1.5 app-no-drag">
          <button
            v-for="item in navItems"
            :key="item.id"
            @click="currentTab = item.id"
            class="w-full flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-xs font-bold transition-all duration-200 text-left relative group cursor-pointer"
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
              class="absolute right-3 w-1.5 h-1.5 rounded-full bg-current opacity-90 shadow-sm"
            ></span>
          </button>
        </nav>
      </div>

      <!-- 底部状态指示面板 -->
      <div class="p-3 m-3 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-md text-xs shadow-inner app-no-drag">
        <div class="flex items-center justify-between mb-2">
          <span class="text-slate-400 flex items-center gap-1.5 text-xs">
            <Activity class="w-3.5 h-3.5 text-slate-400" />
            <span>Steam 客户端:</span>
          </span>
          <div class="flex items-center gap-1.5">
            <span
              v-if="steamInfo.steamBitness && steamInfo.steamBitness !== 'unknown'"
              class="px-1.5 py-0.5 rounded text-[11px] bg-slate-800/80 text-slate-300 font-mono font-semibold border border-white/10"
            >
              {{ steamInfo.steamBitness === 'x86' ? '32位' : '64位' }}
            </span>
            <span class="flex items-center gap-1 text-xs font-bold" :class="steamInfo.isRunning ? 'text-emerald-400' : 'text-slate-400'">
              <span class="w-2 h-2 rounded-full" :class="steamInfo.isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'"></span>
              {{ steamInfo.isRunning ? '运行中' : '未启动' }}
            </span>
          </div>
        </div>

        <div class="flex items-center justify-between mb-2 text-xs bg-slate-950/40 px-2.5 py-1.5 rounded-xl border border-white/5">
          <span class="text-slate-400">已生效规则:</span>
          <span class="theme-text-accent font-mono font-bold">{{ steamInfo.scriptsCount }} 款应用</span>
        </div>

        <button
          @click="handleRestartSteam"
          class="w-full py-2 bg-slate-800/80 hover:bg-slate-700/90 text-slate-200 text-xs font-semibold rounded-xl transition duration-200 border border-white/10 flex items-center justify-center gap-2 group shadow-sm active:scale-95 cursor-pointer"
        >
          <RotateCw class="w-3.5 h-3.5 text-slate-400 group-hover:theme-text-accent transition group-hover:rotate-180 duration-500" />
          <span>重启 Steam</span>
        </button>
      </div>
    </aside>

    <!-- 右侧主体内容区域 (全沉浸式标题栏设计) -->
    <main class="flex-1 flex flex-col h-full overflow-hidden theme-bg-subtle relative">
      <!-- 顶部沉浸式自定义窗口栏 (兼具拖拽区与窗口控制) -->
      <header class="h-12 border-b border-white/5 px-4 flex items-center justify-between shrink-0 bg-slate-950/20 backdrop-blur-md z-30 app-drag-region">
        <!-- 左侧：路径与状态 -->
        <div class="flex items-center gap-2 text-xs text-slate-400 min-w-0 flex-1 mr-4 app-no-drag">
          <Folder class="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span class="shrink-0 text-xs">Steam 根目录:</span>
          <span class="font-mono text-slate-300 truncate max-w-xs bg-white/5 px-2 py-0.5 rounded-lg border border-white/5 text-xs" :title="steamInfo.steamPath || '未检测到'">
            {{ steamInfo.steamPath || '正在探测中...' }}
          </span>
        </div>

        <!-- 右侧：云端引擎状态与无边框原生感窗口控制按钮 -->
        <div class="flex items-center gap-2.5 shrink-0">
          <div class="flex items-center gap-2 text-xs app-no-drag">
            <!-- 授权状态指示徽章 -->
            <button
              @click="showLicenseModal = true"
              class="flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-xs font-semibold border transition shadow-sm hover:scale-105 active:scale-95 cursor-pointer"
              :class="getLicenseHeaderBadgeClass(licenseInfo)"
              :title="licenseInfo.isActivated ? (licenseInfo.isLifetime ? '永久卡会员' : `会员到期剩余 ${licenseInfo.remainingDays} 天`) : '点击输入激活码'"
            >
              <Crown class="w-3.5 h-3.5" :class="licenseInfo.isActivated ? 'text-amber-400' : 'text-slate-400'" />
              <span>{{ getLicenseHeaderBadgeText(licenseInfo) }}</span>
            </button>

            <span class="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-sky-500/10 text-sky-300 font-mono text-xs font-semibold border border-sky-500/20">
              <Cloud class="w-3.5 h-3.5" />
              <span>18万+ 本地全量库</span>
            </span>
            <span 
              class="flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-xs font-semibold border"
              :class="steamInfo.ostInstalled ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border-amber-500/20'"
            >
              <ShieldCheck class="w-3.5 h-3.5" />
              <span>{{ steamInfo.ostInstalled ? 'OST 内核' : '待同步' }}</span>
            </span>
          </div>

          <!-- 沉浸式窗口最小化、最大化、关闭按钮组 -->
          <div class="flex items-center pl-2 ml-1 border-l border-white/10 app-no-drag">
            <button
              @click="handleWindowMinimize"
              title="最小化"
              class="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-white/10 rounded-lg transition cursor-pointer"
            >
              <Minus class="w-3.5 h-3.5" />
            </button>
            <button
              @click="handleWindowMaximize"
              :title="isMaximized ? '还原' : '最大化'"
              class="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-white/10 rounded-lg transition cursor-pointer"
            >
              <Square v-if="!isMaximized" class="w-3 h-3" />
              <Copy v-else class="w-3 h-3" />
            </button>
            <button
              @click="handleWindowClose"
              title="关闭程序"
              class="w-8 h-7 flex items-center justify-center text-slate-400 hover:text-white hover:bg-rose-600 rounded-lg transition cursor-pointer"
            >
              <X class="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </header>

      <!-- 顶部横幅公告 (如果类型为 banner) -->
      <div v-if="bannerNotice && bannerNotice.enabled" class="bg-sky-500/10 border-b border-sky-500/30 px-6 py-2 flex items-center justify-between text-xs text-sky-300 shrink-0 backdrop-blur-md z-10">
        <div class="flex items-center gap-2 truncate">
          <Bell class="w-3.5 h-3.5 text-sky-400 shrink-0" />
          <span class="font-bold shrink-0 text-sky-400">{{ bannerNotice.title }}:</span>
          <span class="text-slate-200 truncate">{{ bannerNotice.content }}</span>
        </div>
        <button @click="bannerNotice = null" class="text-slate-400 hover:text-slate-200 ml-4 shrink-0 p-1 hover:bg-white/10 rounded cursor-pointer">
          <X class="w-3.5 h-3.5" />
        </button>
      </div>

      <!-- 动态视图区域 -->
      <div class="flex-1 overflow-hidden">
        <SearchView
          v-if="currentTab === 'search'"
          @notify="addToast"
          @refresh-status="fetchSteamInfo"
          @open-license-modal="showLicenseModal = true"
        />
        <LibraryView
          v-else-if="currentTab === 'library'"
          @notify="addToast"
          @refresh-status="fetchSteamInfo"
          @open-license-modal="showLicenseModal = true"
        />
        <OnlineFixView
          v-else-if="currentTab === 'onlinefix'"
          @notify="addToast"
        />
        <ToolboxView
          v-else-if="currentTab === 'toolbox'"
          @notify="addToast"
          @refresh-status="fetchSteamInfo"
          @open-license-modal="showLicenseModal = true"
        />
        <AboutView
          v-else-if="currentTab === 'about'"
          @notify="addToast"
          @open-disclaimer="openDisclaimerModal"
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

    <!-- 全局系统公告 / 免责声明弹窗 -->
    <div v-if="popupNotice" class="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
      <div class="theme-card-static rounded-3xl w-full max-w-lg p-7 shadow-2xl animate-in fade-in zoom-in-95 duration-200 border flex flex-col items-center">
        <!-- 顶部黄色警告感叹号圆圈图标 -->
        <div class="w-16 h-16 rounded-full bg-amber-400/95 text-slate-950 flex items-center justify-center shadow-lg shadow-amber-400/30 mb-3 select-none">
          <span class="text-3xl font-black font-sans leading-none">!</span>
        </div>

        <!-- 标题 -->
        <h2 class="text-xl font-bold text-slate-100 text-center mb-5 tracking-wide">
          {{ popupNotice.title || '免责声明' }}
        </h2>

        <!-- 免责条款列表 (浅底色容器) -->
        <div class="w-full text-xs text-slate-300 leading-relaxed space-y-3 bg-slate-950/60 p-5 rounded-2xl border border-white/10 mb-6 font-medium max-h-72 overflow-y-auto">
          <div v-if="popupNotice.kind === 'disclaimer'" class="space-y-3">
            <p class="text-justify">1. 本工具仅供学习和技术研究用途，严禁用于任何商业用途。</p>
            <p class="text-justify">2. 本工具所生成的文件内容由用户自行上传，开发者不对内容的合法性、准确性、完整性承担任何责任。</p>
            <p class="text-justify">3. 使用本工具所产生的一切后果由使用者自行承担，与开发者无关。</p>
            <p class="text-justify">4. 本工具不提供任何破解、盗版相关的技术支持或服务。</p>
            <p class="text-justify">5. 如有权利方认为本工具涉及侵权，请联系官网邮箱进行下架处理。</p>
          </div>
          <div v-else class="whitespace-pre-line text-justify">
            {{ popupNotice.content }}
          </div>
        </div>

        <!-- 底部按钮组 (左: ✓ 同意, 右: ✕ 拒绝 -> 退出软件) -->
        <div class="w-full grid grid-cols-2 gap-4">
          <button
            @click="handleAgreeNotice"
            class="w-full py-3 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-xs font-bold rounded-2xl transition shadow-lg shadow-blue-600/30 flex items-center justify-center gap-1.5"
          >
            <Check class="w-4 h-4 stroke-[3]" />
            <span>同意</span>
          </button>
          <button
            @click="handleDeclineNotice"
            class="w-full py-3 bg-slate-700/90 hover:bg-slate-600 active:scale-[0.98] text-slate-200 hover:text-white text-xs font-bold rounded-2xl transition shadow flex items-center justify-center gap-1.5 border border-white/10"
          >
            <X class="w-4 h-4 stroke-[3]" />
            <span>拒绝</span>
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

    <!-- 激活码与设备绑定弹窗 -->
    <LicenseModal
      v-if="showLicenseModal"
      :license-info="licenseInfo"
      @close="showLicenseModal = false"
      @refresh="loadLicenseInfo(true)"
      @notify="addToast"
    />

    <!-- 全局 Toast 提示 -->
    <Toast :toasts="toasts" />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, provide } from 'vue';
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
  Copy,
  Crown,
  Wrench,
  Check,
  Info
} from 'lucide-vue-next';
import SearchView from './views/SearchView.vue';
import LibraryView from './views/LibraryView.vue';
import OnlineFixView from './views/OnlineFixView.vue';
import ToolboxView from './views/ToolboxView.vue';
import AboutView from './views/AboutView.vue';
import SettingsView from './views/SettingsView.vue';
import StartupWizardModal from './components/StartupWizardModal.vue';
import LicenseModal from './components/LicenseModal.vue';
import Toast, { ToastItem } from './components/Toast.vue';
import { SteamEnvironmentInfo, ClientLicenseInfo } from '../types';
import { useTheme } from './composables/useTheme';

const appVersion = '1.0.0';
const currentTab = ref<'search' | 'library' | 'onlinefix' | 'toolbox' | 'about' | 'settings'>('search');
const showStartupWizard = ref(false);
const showLicenseModal = ref(false);
const isMaximized = ref(false);

// -------------------------------------------------------------
// 全局 UI 界面与字体缩放自适应系统 (UI Scale System)
// -------------------------------------------------------------
export type UiScaleOption = 'auto' | '100%' | '105%' | '110%' | '115%' | '125%';

const currentUiScale = ref<UiScaleOption>((localStorage.getItem('chunfengdu_ui_scale') as UiScaleOption) || 'auto');
const computedZoomValue = ref<number>(1.0);
const windowResolution = ref({ width: window.innerWidth, height: window.innerHeight });

const calculateDynamicZoom = (screenWidth: number): number => {
  // 窗口以 1200x800 为基准标准比例(1.0x)
  // 基于屏幕物理分辨率（不随页面 zoom 变化）计算，避免 zoom 改变 outerWidth 引发的死循环振荡
  if (screenWidth < 1280) return 1.0;
  if (screenWidth < 1550) return 1.05;
  if (screenWidth < 1850) return 1.10;
  if (screenWidth < 2200) return 1.15;
  return 1.25; // 2K/4K 超大屏
};

const applyUiScale = () => {
  windowResolution.value = { width: window.innerWidth, height: window.innerHeight };

  let zoom = 1.0;
  if (currentUiScale.value === 'auto') {
    // 使用不随 zoom 变化的 screen 尺寸作为依据
    const screenW = (typeof screen !== 'undefined' && screen.availWidth) || window.innerWidth;
    zoom = calculateDynamicZoom(screenW);
  } else {
    switch (currentUiScale.value) {
      case '100%': zoom = 1.0; break;
      case '105%': zoom = 1.05; break;
      case '110%': zoom = 1.10; break;
      case '115%': zoom = 1.15; break;
      case '125%': zoom = 1.25; break;
      default: zoom = 1.0; break;
    }
  }

  // zoom 未变化时不重复设置，避免 setZoomFactor -> resize 反复触发
  if (zoom === computedZoomValue.value) return;
  computedZoomValue.value = zoom;
  if (window.electronAPI && typeof window.electronAPI.setZoomFactor === 'function') {
    window.electronAPI.setZoomFactor(zoom);
  }
};

const setUiScale = (scale: UiScaleOption) => {
  currentUiScale.value = scale;
  localStorage.setItem('chunfengdu_ui_scale', scale);
  applyUiScale();
};

provide('uiScaleState', {
  currentUiScale,
  computedZoomValue,
  windowResolution,
  setUiScale
});

const licenseInfo = ref<ClientLicenseInfo>({
  isActivated: false,
  status: 'unactivated',
  deviceId: ''
});

const { initTheme } = useTheme();

const navItems = [
  { id: 'search' as const, label: '游戏检索与入库', iconComponent: Search },
  { id: 'library' as const, label: '已入库规则管理', iconComponent: Library },
  { id: 'onlinefix' as const, label: '联机修复中心', iconComponent: Gamepad2 },
  { id: 'toolbox' as const, label: '实用工具箱', iconComponent: Wrench },
  { id: 'about' as const, label: '功能详解与关于', iconComponent: Info },
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
  addToast('春风渡 启动引导完成，已进入主界面！', 'success');
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
interface NoticePayload {
  id?: string;
  title?: string;
  content?: string;
  type?: 'popup' | 'banner';
  popupOnce?: boolean;
  link?: string;
  enabled?: boolean;
  kind?: 'disclaimer' | 'notice';
}
const popupNotice = ref<NoticePayload | null>(null);
const bannerNotice = ref<NoticePayload | null>(null);
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

const DISCLAIMER_STORAGE_KEY = 'chunfengdu_disclaimer_accepted_v1';

const openDisclaimerModal = () => {
  popupNotice.value = {
    id: 'notice_disclaimer_01',
    title: '免责声明',
    kind: 'disclaimer',
    content: '1. 本工具仅供学习和技术研究用途，严禁用于任何商业用途。\n2. 本工具所生成的文件内容由用户自行上传，开发者不对内容的合法性、准确性、完整性承担任何责任。\n3. 使用本工具所产生的一切后果由使用者自行承担，与开发者无关。\n4. 本工具不提供任何破解、盗版相关的技术支持或服务。\n5. 如有权利方认为本工具涉及侵权，请联系官网邮箱进行下架处理。',
    popupOnce: false
  };
};

// 免责声明展示完毕后待展示的公告队列
let queuedNotice: NoticePayload | null = null;

const showQueuedNoticeIfAny = () => {
  if (!popupNotice.value && queuedNotice) {
    popupNotice.value = queuedNotice;
    queuedNotice = null;
  }
};

const closePopupNotice = () => {
  if (popupNotice.value && popupNotice.value.popupOnce) {
    localStorage.setItem(`read_notice_${popupNotice.value.id}`, 'true');
  }
  popupNotice.value = null;
  showQueuedNoticeIfAny();
};

const handleAgreeNotice = () => {
  localStorage.setItem(DISCLAIMER_STORAGE_KEY, 'true');
  closePopupNotice();
  addToast('您已同意免责声明，欢迎使用春风渡！', 'success');
};

const handleDeclineNotice = async () => {
  try {
    await window.electronAPI.quitApp();
  } catch {
    window.close();
  }
};

const checkNoticeAndVersion = async () => {
  try {
    const hasAcceptedDisclaimer = localStorage.getItem(DISCLAIMER_STORAGE_KEY) === 'true';

    const notice = await window.electronAPI.checkNotice();
    let activeNotice: NoticePayload | null = null;
    if (notice && notice.enabled) {
      if (notice.type === 'banner') {
        bannerNotice.value = notice;
      } else {
        const isRead = notice.popupOnce && localStorage.getItem(`read_notice_${notice.id}`);
        if (!isRead) {
          activeNotice = notice;
        }
      }
    }

    // 免责声明独立于公告判断：从未同意过免责声明时必须展示（公告排队在其后）
    if (!hasAcceptedDisclaimer) {
      queuedNotice = activeNotice;
      openDisclaimerModal();
    } else if (activeNotice) {
      popupNotice.value = activeNotice;
    }

    const versionRes = await window.electronAPI.checkVersion(appVersion);
    if (versionRes && versionRes.hasUpdate) {
      versionModal.value = versionRes;
    }
  } catch (e) {
    console.warn('检查公告与版本失败:', e);
    // 云端不可达时仍需保证免责声明可展示
    if (localStorage.getItem(DISCLAIMER_STORAGE_KEY) !== 'true') {
      openDisclaimerModal();
    }
  }
};

const loadLicenseInfo = async (forceVerify: boolean = false) => {
  try {
    const info = await window.electronAPI.getLicenseInfo(forceVerify);
    if (info) {
      licenseInfo.value = info;
    }
  } catch (e: any) {
    console.warn('获取授权状态失败:', e.message);
  }
};

const getLicenseHeaderBadgeClass = (info: ClientLicenseInfo) => {
  if (info.isActivated) {
    if (info.type === 'lifetime' || info.isLifetime) {
      return 'bg-amber-500/10 text-amber-300 border-amber-500/30 hover:bg-amber-500/20';
    }
    return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20';
  }
  if (info.status === 'expired') {
    return 'bg-rose-500/10 text-rose-300 border-rose-500/30 hover:bg-rose-500/20';
  }
  return 'bg-slate-800/80 text-slate-300 border-white/10 hover:bg-white/10';
};

const getLicenseHeaderBadgeText = (info: ClientLicenseInfo) => {
  if (info.isActivated) {
    if (info.type === 'lifetime' || info.isLifetime) {
      return '👑 永久会员';
    }
    const days = info.remainingDays ?? 0;
    return `👑 ${info.typeName?.replace('会员', '') || 'VIP'} (剩${days}天)`;
  }
  if (info.status === 'expired') {
    return '⏱️ 授权已到期';
  }
  return '🔑 未激活';
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
  loadLicenseInfo(true);
};

const syncMaximizedState = async () => {
  try {
    if (window.electronAPI && typeof window.electronAPI.isWindowMaximized === 'function') {
      isMaximized.value = await window.electronAPI.isWindowMaximized();
    }
  } catch {}
};

let steamInfoTimer: ReturnType<typeof setInterval> | null = null;
let licenseTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  initApp();
  applyUiScale();
  syncMaximizedState();
  window.addEventListener('resize', applyUiScale);
  window.addEventListener('resize', syncMaximizedState);
  steamInfoTimer = setInterval(fetchSteamInfo, 5000);
  licenseTimer = setInterval(() => loadLicenseInfo(false), 30000);
});

onUnmounted(() => {
  window.removeEventListener('resize', applyUiScale);
  window.removeEventListener('resize', syncMaximizedState);
  if (steamInfoTimer) { clearInterval(steamInfoTimer); steamInfoTimer = null; }
  if (licenseTimer) { clearInterval(licenseTimer); licenseTimer = null; }
});
</script>
