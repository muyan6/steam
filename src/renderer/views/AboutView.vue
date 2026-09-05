<template>
  <div class="h-full flex flex-col p-6 xl:p-8 overflow-y-auto space-y-6">
    <!-- 顶部品牌 Header -->
    <div class="flex items-center justify-between gap-4 pb-5 border-b border-white/10 flex-wrap shrink-0">
      <div class="flex items-center gap-4">
        <div class="w-14 h-14 rounded-2xl theme-btn-primary flex items-center justify-center text-slate-950 font-black text-2xl shadow-lg relative shrink-0">
          <Zap class="w-8 h-8 text-slate-950 fill-slate-950" />
        </div>
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="text-xl font-black tracking-wide text-slate-100">春风渡</h1>
            <span class="text-xs px-2.5 py-0.5 rounded-full theme-btn-primary text-slate-950 font-mono font-bold shadow-sm">
              v{{ appVersion }}
            </span>
          </div>
          <p class="text-xs text-slate-400 mt-1">极速入库 · 联机生态引擎 · 专为 Steam 玩家打造的高性能工具</p>
        </div>
      </div>

      <div class="flex items-center gap-2.5">
        <button
          @click="checkUpdates"
          :disabled="isCheckingUpdate"
          class="px-4 py-2.5 btn-soft-action rounded-xl text-xs font-bold transition flex items-center gap-2 cursor-pointer"
        >
          <RotateCw class="w-3.5 h-3.5" :class="{ 'animate-spin': isCheckingUpdate }" />
          <span>{{ isCheckingUpdate ? '正在检查...' : '检查最新版本' }}</span>
        </button>

        <button
          @click="emit('open-disclaimer')"
          class="px-4 py-2.5 theme-btn-primary rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-sm cursor-pointer"
        >
          <ShieldAlert class="w-3.5 h-3.5" />
          <span>查看免责声明</span>
        </button>
      </div>
    </div>

    <!-- 功能详解 (Features Matrix) -->
    <div class="theme-card rounded-3xl p-6 xl:p-7 space-y-5">
      <div class="flex items-center justify-between">
        <div>
          <div class="flex items-center gap-2 text-xs font-mono font-bold theme-text-accent uppercase tracking-wider">
            <Sparkles class="w-4 h-4" />
            <span>Core Features</span>
          </div>
          <h2 class="text-lg font-black text-slate-100 mt-1">功能详解</h2>
        </div>
        <span class="text-xs px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 font-semibold border border-emerald-500/20">
          全功能开箱即用
        </span>
      </div>

      <!-- 10 项特性网格列表 (对齐参考界面) -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          v-for="(feature, idx) in featuresList"
          :key="idx"
          class="flex items-center gap-3.5 p-3.5 rounded-2xl bg-slate-950/40 border border-white/5 hover:border-sky-500/30 transition group"
        >
          <div class="w-7 h-7 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20 group-hover:scale-110 transition-transform">
            <Check class="w-4 h-4 stroke-[3]" />
          </div>
          <div class="min-w-0">
            <div class="font-bold text-xs text-slate-100">{{ feature.title }}</div>
            <div class="text-[11px] text-slate-400 truncate mt-0.5">{{ feature.desc }}</div>
          </div>
        </div>

        <!-- 红色警告项：不支持类型 -->
        <div class="md:col-span-2 flex items-start gap-3.5 p-4 rounded-2xl bg-rose-500/10 border border-rose-500/25 text-rose-200">
          <div class="w-7 h-7 rounded-xl bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0 border border-rose-500/30 mt-0.5">
            <X class="w-4 h-4 stroke-[3]" />
          </div>
          <div class="text-xs leading-relaxed">
            <strong class="font-bold text-rose-300 block mb-0.5">不支持游戏类型提示：</strong>
            <span>不支持 D 加密（Denuvo）、第三方独立启动器（如育碧 Ubisoft Connect / EA 橘子 / 暴雪战网）、以及必须通过官方服务器进行高强度联网验证的特定游戏（如使命召唤战区/黑色行动等）。</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 教程与支持中心 -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
      <!-- 使用教程卡片 -->
      <div class="theme-card rounded-3xl p-6 flex flex-col justify-between space-y-4">
        <div>
          <div class="flex items-center gap-2 text-xs font-mono font-bold theme-text-accent uppercase tracking-wider">
            <BookOpen class="w-4 h-4" />
            <span>Tutorial & Guide</span>
          </div>
          <h3 class="text-base font-bold text-slate-100 mt-1">使用图文教程</h3>
          <p class="text-xs text-slate-400 mt-2 leading-relaxed">
            首次使用或入库遇到疑问？查看完整的快速上手指南与一键入库全流程演示。
          </p>
        </div>

        <a
          v-if="appLinks.tutorialUrl"
          :href="appLinks.tutorialUrl"
          target="_blank"
          class="p-3.5 rounded-2xl bg-slate-950/40 border border-white/10 hover:border-sky-500/40 hover:bg-sky-500/5 transition flex items-center justify-between text-xs text-slate-200 group cursor-pointer"
        >
          <div class="flex items-center gap-2.5">
            <FileText class="w-4 h-4 theme-text-accent" />
            <span>查看完整图文使用教程</span>
          </div>
          <ExternalLink class="w-4 h-4 text-slate-400 group-hover:theme-text-accent transition" />
        </a>
        <div
          v-else
          class="p-3.5 rounded-2xl bg-slate-950/40 border border-white/10 transition flex items-center justify-between text-xs text-slate-500 select-none"
          title="链接暂未配置，敬请期待"
        >
          <div class="flex items-center gap-2.5">
            <FileText class="w-4 h-4 text-slate-500" />
            <span>查看完整图文使用教程（暂未开放）</span>
          </div>
          <ExternalLink class="w-4 h-4 text-slate-600" />
        </div>
      </div>

      <!-- 问题大全与排错中心 -->
      <div class="theme-card rounded-3xl p-6 flex flex-col justify-between space-y-4">
        <div>
          <div class="flex items-center gap-2 text-xs font-mono font-bold theme-text-accent uppercase tracking-wider">
            <HelpCircle class="w-4 h-4" />
            <span>Troubleshoot</span>
          </div>
          <h3 class="text-base font-bold text-slate-100 mt-1">入库没有效果？</h3>
          <p class="text-xs text-slate-400 mt-2 leading-relaxed">
            遇到 Steam 提示清单缺失、无下载权限或杀毒软件拦截？一键排查常见问题。
          </p>
        </div>

        <a
          v-if="appLinks.faqUrl"
          :href="appLinks.faqUrl"
          target="_blank"
          class="p-3.5 rounded-2xl bg-slate-950/40 border border-white/10 hover:border-sky-500/40 hover:bg-sky-500/5 transition flex items-center justify-between text-xs text-slate-200 group cursor-pointer"
        >
          <div class="flex items-center gap-2.5">
            <HelpCircle class="w-4 h-4 theme-text-accent" />
            <span>查看常见问题大全与自愈中心</span>
          </div>
          <ExternalLink class="w-4 h-4 text-slate-400 group-hover:theme-text-accent transition" />
        </a>
        <div
          v-else
          class="p-3.5 rounded-2xl bg-slate-950/40 border border-white/10 transition flex items-center justify-between text-xs text-slate-500 select-none"
          title="链接暂未配置，敬请期待"
        >
          <div class="flex items-center gap-2.5">
            <HelpCircle class="w-4 h-4 text-slate-500" />
            <span>查看常见问题大全与自愈中心（暂未开放）</span>
          </div>
          <ExternalLink class="w-4 h-4 text-slate-600" />
        </div>
      </div>
    </div>

    <!-- 运行环境与设备参数 -->
    <div class="theme-card rounded-3xl p-6 space-y-4">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-bold text-slate-100 flex items-center gap-2">
          <Cpu class="w-4 h-4 theme-text-accent" />
          <span>本地运行环境与设备标识</span>
        </h3>
        <span class="text-xs font-mono text-slate-400">{{ isTauriEnvironment() ? 'Tauri 2.0 + WebView2' : 'Node.js + Electron' }}</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div class="p-3 rounded-2xl bg-slate-950/40 border border-white/5">
          <div class="text-slate-400 text-[11px] mb-1">本机唯一设备码 (Device ID)</div>
          <div class="font-mono text-slate-200 font-bold truncate" :title="deviceId">
            {{ deviceId || '正在探测...' }}
          </div>
        </div>

        <div class="p-3 rounded-2xl bg-slate-950/40 border border-white/5">
          <div class="text-slate-400 text-[11px] mb-1">Steam 内核状态</div>
          <div class="font-bold flex items-center gap-1.5" :class="ostInstalled ? 'text-emerald-400' : 'text-amber-400'">
            <span class="w-2 h-2 rounded-full" :class="ostInstalled ? 'bg-emerald-400' : 'bg-amber-400'"></span>
            <span>{{ ostInstalled ? 'OpenSteamTool 已挂载' : '待同步/未安装' }}</span>
          </div>
        </div>

        <div class="p-3 rounded-2xl bg-slate-950/40 border border-white/5">
          <div class="text-slate-400 text-[11px] mb-1">授权状态</div>
          <div class="font-bold" :class="isActivated ? 'text-emerald-400' : 'text-slate-300'">
            {{ isActivated ? '已激活正版授权' : '公益基础版' }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { isTauriEnvironment } from '../api/tauriBridge';
import { ref, onMounted } from 'vue';
import { 
  Zap, 
  RotateCw, 
  ShieldAlert, 
  Check, 
  X, 
  Sparkles, 
  BookOpen, 
  FileText, 
  HelpCircle, 
  ExternalLink,
  Cpu
} from 'lucide-vue-next';

const emit = defineEmits<{
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
  (e: 'open-disclaimer'): void;
}>();

const appVersion = '1.0.0';
const isCheckingUpdate = ref(false);
const deviceId = ref('');
const ostInstalled = ref(false);
const isActivated = ref(false);
// 教程/FAQ 跳转链接由服务端配置 (GET /api/links)，未配置时按钮置灰
const appLinks = ref<{ tutorialUrl: string; faqUrl: string }>({ tutorialUrl: '', faqUrl: '' });

const loadAppLinks = async () => {
  try {
    const links = await window.electronAPI.getAppLinks();
    if (links) {
      appLinks.value = {
        tutorialUrl: links.tutorialUrl || '',
        faqUrl: links.faqUrl || ''
      };
    }
  } catch {
    // 服务端不可用时保持置灰，不阻塞页面
  }
};

const featuresList = [
  { title: '创意工坊支持', desc: '一键订阅与模组自动同步下载' },
  { title: '游戏实时更新', desc: '云端与官方清单数据保持实时同步更新' },
  { title: '可视化游戏列表', desc: '超清海报封面、AppID、中文别名与状态呈现' },
  { title: '每天更新新游戏', desc: '每日持续收录 Steam 官方最新上架与热门力作' },
  { title: '完整入库 + 全部 DLC', desc: '一键自动匹配全量 DLC 清单与 DepotKey 密钥' },
  { title: '提前游玩 / 锁区游戏', desc: '支持锁区与预载应用清单直接入库与下载' },
  { title: '联机补丁一键启动', desc: '内置 SpaceWar、Goldberg 与 OnlineFix 原生联机修复' },
  { title: '双入库内核自由切换', desc: 'OpenSteamTool 与 GreenLuma (AppList) 双轨自由兼容' },
  { title: '真实免费无隐瞒', desc: '核心功能纯净体验，永久持续维护' },
  { title: '轻量好用教程齐全', desc: '操作简单直观，新手秒上手，配套完整使用文档' }
];

const checkUpdates = async () => {
  isCheckingUpdate.value = true;
  try {
    const res = await window.electronAPI.checkVersion(appVersion);
    if (res && res.hasUpdate) {
      emit('notify', `发现新版本 v${res.latest.version}，可前往下载！`, 'info');
    } else {
      emit('notify', '当前已是最新版本 (v' + appVersion + ')！', 'success');
    }
  } catch (e: any) {
    emit('notify', '检查更新失败: ' + e.message, 'warning');
  } finally {
    isCheckingUpdate.value = false;
  }
};

const loadEnvInfo = async () => {
  try {
    const info = await window.electronAPI.getSteamInfo();
    if (info) {
      ostInstalled.value = !!info.ostInstalled;
    }
    const lic = await window.electronAPI.getLicenseInfo();
    if (lic) {
      deviceId.value = lic.deviceId || '';
      isActivated.value = !!lic.isActivated;
    }
  } catch (e) {
    console.warn('获取环境信息失败:', e);
  }
};

onMounted(() => {
  loadEnvInfo();
  loadAppLinks();
});
</script>
