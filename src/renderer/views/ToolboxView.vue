<template>
  <div class="h-full flex flex-col p-6 overflow-y-auto theme-bg-subtle">
    <!-- 顶部标题 -->
    <div class="mb-5">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-xl font-bold text-slate-100 flex items-center gap-2.5">
            <Wrench class="w-6 h-6 theme-text-accent" />
            <span>实用工具箱</span>
          </h2>
          <p class="text-xs text-slate-400 mt-1">
            专为 OpenSteamTool 打造的极速排障、缓存清理、内核修复与清单服务器高可用调度中心
          </p>
        </div>

        <!-- 快速刷新状态 -->
        <button
          @click="fetchStatus"
          :disabled="loadingStatus"
          class="px-3 py-1.5 rounded-xl btn-soft-action text-xs transition flex items-center gap-1.5 shadow-sm"
        >
          <RotateCw class="w-3.5 h-3.5 text-slate-400" :class="{ 'animate-spin': loadingStatus }" />
          <span>刷新状态</span>
        </button>
      </div>
    </div>

    <!-- 4 大核心工具卡片网格 (2x2 响应式布局) -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-5xl">
      <!-- 卡片 1: 清理Steam缓存 (主题强调色渐变) -->
      <div class="rounded-3xl tool-card overflow-hidden shadow-xl flex flex-col justify-between duration-300">
        <!-- 头部大图标横幅 -->
        <div class="h-28 tool-banner-a flex items-center justify-center relative overflow-hidden">
          <div class="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-inner">
            <Eraser class="w-8 h-8" />
          </div>
          <div class="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-white/10 blur-xl"></div>
        </div>

        <!-- 卡片主体内容 -->
        <div class="p-5 flex-1 flex flex-col justify-between">
          <div>
            <h3 class="text-base font-bold text-slate-100">清理Steam缓存</h3>
            <p class="text-xs text-slate-400 mt-1">解决内核报错、入库无效等问题，需重新入库</p>

            <!-- 检查清单 -->
            <div class="mt-4 space-y-2 text-xs">
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">结束Steam相关进程</span>
              </div>
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">删除DLL内核文件缓存文件相关残留</span>
              </div>
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">重新Steam，重启完成后需您重新入库一个游戏</span>
              </div>
            </div>
          </div>

          <!-- 执行动作按钮 -->
          <div class="mt-6">
            <button
              @click="handleClearCache"
              :disabled="activeAction !== null"
              class="w-full py-2.5 theme-btn-primary active:scale-[0.98] disabled:opacity-50 text-xs font-bold rounded-xl transition duration-200 flex items-center justify-center gap-2"
            >
              <RotateCw v-if="activeAction === 'clear_cache'" class="w-3.5 h-3.5 animate-spin" />
              <Play v-else class="w-3.5 h-3.5 fill-current" />
              <span>{{ activeAction === 'clear_cache' ? '正在清理中...' : '▶ 执行' }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 卡片 2: 修复OpenSteamTool内核 (主题强调色渐变) -->
      <div class="rounded-3xl tool-card overflow-hidden shadow-xl flex flex-col justify-between duration-300">
        <!-- 头部大图标横幅 -->
        <div class="h-28 tool-banner-d flex items-center justify-center relative overflow-hidden">
          <div class="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-inner">
            <Wrench class="w-8 h-8" />
          </div>
          <div class="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-white/10 blur-xl"></div>
        </div>

        <!-- 卡片主体内容 -->
        <div class="p-5 flex-1 flex flex-col justify-between">
          <div>
            <h3 class="text-base font-bold text-slate-100">修复OpenSteamTool内核</h3>
            <p class="text-xs text-slate-400 mt-1">清理缓存后修复OpenSteamTool内核，一键重新部署</p>

            <!-- 检查清单 -->
            <div class="mt-4 space-y-2 text-xs">
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">先执行清理Steam缓存</span>
              </div>
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">部署OpenSteamTool核心组件 (64位三件套)</span>
              </div>
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">修复内核注册表配置并启动Steam</span>
              </div>
            </div>
          </div>

          <!-- 执行动作按钮 -->
          <div class="mt-6">
            <button
              @click="handleRepairKernel"
              :disabled="activeAction !== null"
              class="w-full py-2.5 theme-btn-primary active:scale-[0.98] disabled:opacity-50 text-xs font-bold rounded-xl transition duration-200 flex items-center justify-center gap-2"
            >
              <RotateCw v-if="activeAction === 'repair_kernel'" class="w-3.5 h-3.5 animate-spin" />
              <Play v-else class="w-3.5 h-3.5 fill-current" />
              <span>{{ activeAction === 'repair_kernel' ? '正在修复内核中...' : '▶ 执行' }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 卡片 2.5: 同步最新内核 (GitHub release 在线同步) -->
      <div class="rounded-3xl tool-card overflow-hidden shadow-xl flex flex-col justify-between duration-300">
        <div class="h-28 tool-banner-e flex items-center justify-center relative overflow-hidden">
          <div class="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-inner">
            <CloudDownload class="w-8 h-8" />
          </div>
          <div class="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-white/10 blur-xl"></div>
        </div>

        <div class="p-5 flex-1 flex flex-col justify-between">
          <div>
            <h3 class="text-base font-bold text-slate-100">同步最新内核</h3>
            <p class="text-xs text-slate-400 mt-1">从 GitHub 官方 release 在线拉取最新 OpenSteamTool 内核并部署，无需等待春风渡发版</p>

            <div class="mt-4 space-y-2 text-xs">
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">需先退出 Steam（内核 DLL 被锁定时无法替换）</span>
              </div>
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">官方直链 ➔ 加速镜像 多级下载并校验核心三件套</span>
              </div>
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">覆盖部署并记录版本，重启 Steam 生效</span>
              </div>
              <div v-if="ostSyncInfo" class="pt-1.5 font-mono text-[11px] text-slate-400">
                当前内核：{{ ostSyncInfo.currentTag }}
                <template v-if="ostSyncInfo.latestTag">
                  ｜官方最新：{{ ostSyncInfo.latestTag }}
                  <span v-if="ostSyncInfo.updateAvailable" class="text-amber-400 font-bold">（可更新）</span>
                  <span v-else class="text-emerald-400 font-bold">（已是最新）</span>
                </template>
              </div>
              <div v-else-if="ostCheckFailed" class="pt-1.5 text-[11px] text-slate-500">未能获取官方最新版本信息（网络受限时可稍后重试）</div>
            </div>
          </div>

          <div class="mt-6 flex items-center gap-2">
            <button
              @click="handleCheckOstSync"
              :disabled="activeAction !== null"
              class="flex-1 py-2.5 bg-slate-800/80 hover:bg-slate-700 border border-white/10 text-slate-200 text-xs font-bold rounded-xl transition disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <RotateCw v-if="activeAction === 'ost_check'" class="w-3.5 h-3.5 animate-spin" />
              <Search v-else class="w-3.5 h-3.5" />
              <span>{{ activeAction === 'ost_check' ? '检测中...' : '检测版本' }}</span>
            </button>
            <button
              @click="handleSyncOst"
              :disabled="activeAction !== null"
              class="flex-1 py-2.5 theme-btn-primary active:scale-[0.98] disabled:opacity-50 text-xs font-bold rounded-xl transition flex items-center justify-center gap-2"
            >
              <RotateCw v-if="activeAction === 'ost_sync'" class="w-3.5 h-3.5 animate-spin" />
              <CloudDownload v-else class="w-3.5 h-3.5" />
              <span>{{ activeAction === 'ost_sync' ? '正在同步内核中...' : '▶ 同步' }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 卡片 3: 补齐Open内核SHA256 (主题强调色渐变) -->
      <div class="rounded-3xl tool-card overflow-hidden shadow-xl flex flex-col justify-between duration-300">
        <!-- 头部大图标横幅 -->
        <div class="h-28 tool-banner-b flex items-center justify-center relative overflow-hidden">
          <div class="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-inner">
            <Puzzle class="w-8 h-8" />
          </div>
          <div class="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-white/10 blur-xl"></div>
        </div>

        <!-- 卡片主体内容 -->
        <div class="p-5 flex-1 flex flex-col justify-between">
          <div>
            <h3 class="text-base font-bold text-slate-100">补齐Open内核SHA256</h3>
            <p class="text-xs text-slate-400 mt-1">补齐Open内核所需SHA256，一般都用不上</p>

            <!-- 检查清单 -->
            <div class="mt-4 space-y-2 text-xs">
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">结束Steam相关进程</span>
              </div>
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">删除旧的opensteamtool文件夹</span>
              </div>
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">下载内核相关文件并解压到opensteamtool</span>
              </div>
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">重新启动Steam</span>
              </div>
            </div>
          </div>

          <!-- 执行动作按钮 -->
          <div class="mt-6">
            <button
              @click="handleFillSha256"
              :disabled="activeAction !== null"
              class="w-full py-2.5 theme-btn-primary active:scale-[0.98] disabled:opacity-50 text-xs font-bold rounded-xl transition duration-200 flex items-center justify-center gap-2"
            >
              <RotateCw v-if="activeAction === 'fill_sha256'" class="w-3.5 h-3.5 animate-spin" />
              <Play v-else class="w-3.5 h-3.5 fill-current" />
              <span>{{ activeAction === 'fill_sha256' ? '正在补齐SHA256中...' : '▶ 执行' }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 卡片 4: Open内核清单服务器自动切换 (主题强调色渐变) -->
      <div class="rounded-3xl tool-card overflow-hidden shadow-xl flex flex-col justify-between duration-300">
        <!-- 头部大图标横幅 -->
        <div class="h-28 tool-banner-c flex items-center justify-center relative overflow-hidden">
          <div class="w-16 h-16 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-inner">
            <ArrowLeftRight class="w-8 h-8" />
          </div>
          <div class="absolute -right-6 -bottom-6 w-24 h-24 rounded-full bg-white/10 blur-xl"></div>
        </div>

        <!-- 卡片主体内容 -->
        <div class="p-5 flex-1 flex flex-col justify-between">
          <div>
            <h3 class="text-base font-bold text-slate-100">Open内核清单服务器自动切换</h3>
            <p class="text-xs text-slate-400 mt-1">自动轮询全球高速清单节点（①官方直链加速 ➔ ②全球CDN镜像 ➔ ③本地缓存），修复下载无联网与清单缺失</p>

            <!-- 检查清单 -->
            <div class="mt-4 space-y-2 text-xs">
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">结束Steam进程</span>
              </div>
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">开启Open内核清单服务器自动轮询与智能故障自愈</span>
              </div>
              <div class="flex items-center gap-2 text-emerald-400 font-medium">
                <Check class="w-4 h-4 shrink-0 stroke-[2.5]" />
                <span class="text-slate-200">重新启动Steam</span>
              </div>
            </div>
          </div>

          <!-- 执行动作按钮 -->
          <div class="mt-6">
            <button
              @click="handleAutoSwitchManifest"
              :disabled="activeAction !== null"
              class="w-full py-2.5 theme-btn-primary active:scale-[0.98] disabled:opacity-50 text-xs font-bold rounded-xl transition duration-200 flex items-center justify-center gap-2"
            >
              <RotateCw v-if="activeAction === 'auto_switch'" class="w-3.5 h-3.5 animate-spin" />
              <Play v-else class="w-3.5 h-3.5 fill-current" />
              <span>{{ activeAction === 'auto_switch' ? '正在配置切换中...' : '▶ 执行' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部环境状态指示条 -->
    <div class="mt-6 max-w-5xl p-4 rounded-2xl theme-card-static flex items-center justify-between flex-wrap gap-3 text-xs">
      <div class="flex items-center gap-3">
        <span class="text-slate-400">当前环境:</span>
        <span class="font-mono text-slate-200 truncate max-w-xs">{{ statusInfo.steamPath || '未检测到Steam路径' }}</span>
      </div>

      <div class="flex items-center gap-3">
        <span class="flex items-center gap-1.5" :class="statusInfo.hasOpenSteamTool ? 'text-emerald-400' : 'text-amber-400'">
          <span class="w-2 h-2 rounded-full" :class="statusInfo.hasOpenSteamTool ? 'bg-emerald-400' : 'bg-amber-400'"></span>
          <span>{{ statusInfo.hasOpenSteamTool ? 'OpenSteamTool 已挂载' : '待修复内核' }}</span>
        </span>

        <span class="flex items-center gap-1.5" :class="statusInfo.autoSwitchEnabled ? 'text-emerald-400' : 'text-slate-400'">
          <span class="w-2 h-2 rounded-full" :class="statusInfo.autoSwitchEnabled ? 'bg-emerald-400' : 'bg-slate-500'"></span>
          <span>{{ statusInfo.autoSwitchEnabled ? '清单高可用自动轮询: 已开启' : '清单自动切换: 未开启' }}</span>
        </span>
      </div>
    </div>

    <!-- 执行结果日志弹窗 -->
    <div v-if="resultModal" class="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4">
      <div class="rounded-3xl theme-card-static w-full max-w-md p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div class="flex items-center gap-3.5 mb-4">
          <div
            class="w-10 h-10 rounded-2xl flex items-center justify-center text-white"
            :class="resultModal.success ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'"
          >
            <CheckCircle2 v-if="resultModal.success" class="w-5 h-5" />
            <AlertCircle v-else class="w-5 h-5" />
          </div>
          <div>
            <h3 class="font-bold text-sm text-slate-100">{{ resultModal.title }}</h3>
            <p class="text-[11px] text-slate-400">{{ resultModal.success ? '执行完毕并已生效' : '执行遇到问题' }}</p>
          </div>
        </div>

        <div class="text-xs text-slate-300 leading-relaxed mb-4 bg-slate-950/60 p-3.5 rounded-2xl border border-white/5 space-y-1.5 max-h-48 overflow-y-auto font-mono">
          <div v-for="(step, idx) in resultModal.steps" :key="idx" class="flex items-start gap-1.5">
            <span class="text-slate-400 select-none">•</span>
            <span :class="step.startsWith('[错误]') ? 'text-rose-400 font-bold' : step.startsWith('✓') ? 'text-emerald-400' : 'text-slate-300'">{{ step }}</span>
          </div>
        </div>

        <div class="text-[11px] text-slate-400 mb-5 leading-normal">
          {{ resultModal.message }}
        </div>

        <div class="flex items-center justify-end gap-3">
          <button
            @click="resultModal = null"
            class="px-5 py-2.5 theme-btn-primary text-xs font-bold rounded-xl transition"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import {
  Wrench,
  Eraser,
  Puzzle,
  ArrowLeftRight,
  Check,
  Play,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  CloudDownload,
  Search
} from 'lucide-vue-next';
import { ToolboxStatusInfo } from '../../types';

const emit = defineEmits<{
  (e: 'notify', message: string, type?: 'success' | 'error' | 'warning' | 'info'): void;
  (e: 'refresh-status'): void;
}>();

const activeAction = ref<string | null>(null);
const loadingStatus = ref(false);

const statusInfo = ref<ToolboxStatusInfo>({
  steamPath: null,
  isRunning: false,
  hasOpenSteamTool: false,
  hasSha256Cache: false,
  autoSwitchEnabled: false,
  currentManifestServer: 'steamrun'
});

const resultModal = ref<{
  title: string;
  success: boolean;
  message: string;
  steps: string[];
} | null>(null);

const fetchStatus = async () => {
  loadingStatus.value = true;
  try {
    const res = await window.electronAPI.toolboxGetStatus();
    if (res) {
      statusInfo.value = res;
    }
  } catch (e: any) {
    console.warn('获取工具箱状态异常:', e);
  } finally {
    loadingStatus.value = false;
  }
};

// 1. 清理 Steam 缓存
const handleClearCache = async () => {
  activeAction.value = 'clear_cache';
  emit('notify', '正在安全退出 Steam 并清理内核残留及缓存...', 'info');

  try {
    const res = await window.electronAPI.toolboxClearCache();
    resultModal.value = {
      title: '清理Steam缓存结果',
      success: res.success,
      message: res.message,
      steps: res.steps || []
    };

    if (res.success) {
      emit('notify', 'Steam 缓存清理完成！已自动重启 Steam', 'success');
    } else {
      emit('notify', `清理失败: ${res.message}`, 'error');
    }
  } catch (err: any) {
    emit('notify', `清理异常: ${err.message}`, 'error');
  } finally {
    activeAction.value = null;
    await fetchStatus();
    emit('refresh-status');
  }
};

// 2. 修复 OpenSteamTool 内核
const handleRepairKernel = async () => {
  activeAction.value = 'repair_kernel';
  emit('notify', '正在重新部署 64位 OpenSteamTool 核心组件与配置...', 'info');

  try {
    const res = await window.electronAPI.toolboxRepairOst();
    resultModal.value = {
      title: '修复OpenSteamTool内核结果',
      success: res.success,
      message: res.message,
      steps: res.steps || []
    };

    if (res.success) {
      emit('notify', 'OpenSteamTool 内核已修复就绪，Steam 已重新拉起！', 'success');
    } else {
      emit('notify', `修复失败: ${res.message}`, 'error');
    }
  } catch (err: any) {
    emit('notify', `修复异常: ${err.message}`, 'error');
  } finally {
    activeAction.value = null;
    await fetchStatus();
    emit('refresh-status');
  }
};

// 2.5 OST 内核在线同步
const ostSyncInfo = ref<any>(null);
const ostCheckFailed = ref(false);

const handleCheckOstSync = async () => {
  activeAction.value = 'ost_check';
  try {
    const res = await window.electronAPI.checkOstSync();
    if (res && res.latestTag) {
      ostSyncInfo.value = res;
      ostCheckFailed.value = false;
      if (res.updateAvailable) {
        emit('notify', `官方最新内核为 ${res.latestTag}，当前为 ${res.currentTag}，可执行同步`, 'info');
      } else {
        emit('notify', `内核已是最新版本（${res.currentTag}）`, 'success');
      }
    } else {
      ostCheckFailed.value = true;
      emit('notify', res?.message || '未能获取官方最新版本信息', 'error');
    }
  } catch (err: any) {
    ostCheckFailed.value = true;
    emit('notify', `检测异常: ${err.message}`, 'error');
  } finally {
    activeAction.value = null;
  }
};

const handleSyncOst = async () => {
  activeAction.value = 'ost_sync';
  emit('notify', '正在从 GitHub 拉取最新 OpenSteamTool 内核（官方直链 ➔ 加速镜像）...', 'info');
  try {
    const res = await window.electronAPI.syncOstLatest();
    resultModal.value = {
      title: '同步最新内核结果',
      success: res.success,
      message: res.message,
      steps: res.success
        ? ['查询 GitHub 最新 release 版本', '经镜像链下载 Release 压缩包', '校验核心三件套完整性（PE 头 + 体积）', '覆盖部署到 Steam 目录并记录版本号']
        : []
    };
    if (res.success) {
      emit('notify', res.message, 'success');
      await handleCheckOstSync();
    } else {
      emit('notify', `同步失败: ${res.message}`, 'error');
    }
  } catch (err: any) {
    emit('notify', `同步异常: ${err.message}`, 'error');
  } finally {
    activeAction.value = null;
    await fetchStatus();
    emit('refresh-status');
  }
};

// 3. 补齐 Open 内核 SHA256
const handleFillSha256 = async () => {
  activeAction.value = 'fill_sha256';
  emit('notify', '正在清理旧目录并写入完整 SHA256 校验包...', 'info');

  try {
    const res = await window.electronAPI.toolboxFillSha256();
    resultModal.value = {
      title: '补齐SHA256校验包结果',
      success: res.success,
      message: res.message,
      steps: res.steps || []
    };

    if (res.success) {
      emit('notify', 'SHA256 校验包已成功补齐并就绪！', 'success');
    } else {
      emit('notify', `补齐失败: ${res.message}`, 'error');
    }
  } catch (err: any) {
    emit('notify', `补齐异常: ${err.message}`, 'error');
  } finally {
    activeAction.value = null;
    await fetchStatus();
    emit('refresh-status');
  }
};

// 4. Open 内核清单服务器自动切换
const handleAutoSwitchManifest = async () => {
  activeAction.value = 'auto_switch';
  emit('notify', '正在开启清单服务器多节点自动轮询与高可用切换...', 'info');

  try {
    const res = await window.electronAPI.toolboxAutoSwitchManifest();
    resultModal.value = {
      title: '清单服务器自动切换结果',
      success: res.success,
      message: res.message,
      steps: res.steps || []
    };

    if (res.success) {
      emit('notify', '清单服务器自动切换功能已成功开启！', 'success');
    } else {
      emit('notify', `配置失败: ${res.message}`, 'error');
    }
  } catch (err: any) {
    emit('notify', `配置异常: ${err.message}`, 'error');
  } finally {
    activeAction.value = null;
    await fetchStatus();
    emit('refresh-status');
  }
};

onMounted(() => {
  fetchStatus();
  // 静默预检内核版本：仅更新卡片上的版本状态，不打扰用户
  handleCheckOstSync();
});
</script>
