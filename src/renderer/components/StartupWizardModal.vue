<template>
  <div class="fixed inset-0 z-50 bg-black/65 backdrop-blur-md flex items-center justify-center p-4 select-none">
    <div class="theme-card-static rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 border">
      <!-- 顶部 Header -->
      <div class="px-6 py-4 border-b border-white/10 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl theme-btn-primary flex items-center justify-center text-slate-950 font-black text-lg shadow-lg">
            <Zap class="w-5 h-5 text-slate-950 fill-slate-950" />
          </div>
          <div>
            <h2 class="font-bold text-sm text-slate-100 flex items-center gap-2">
              <span>春风渡 启动引导</span>
              <span class="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 font-mono border border-sky-500/20">环境准备</span>
            </h2>
            <p class="text-[11px] text-slate-400">Steam 客户端环境检测与一键注入激活</p>
          </div>
        </div>

        <!-- 步骤指示器 -->
        <div class="flex items-center gap-2">
          <div class="flex items-center gap-1.5 text-[11px] font-mono">
            <span
              v-for="s in 4"
              :key="s"
              class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all"
              :class="step >= s ? 'theme-btn-primary font-bold shadow' : 'bg-slate-500/20 text-slate-400'"
            >
              {{ s }}
            </span>
          </div>

          <!-- 手动打开时提供关闭入口（首次启动不可关闭；激活进行中不允许中断） -->
          <button
            v-if="closable && step !== 3"
            @click="requestClose"
            title="关闭引导"
            class="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition flex items-center justify-center ml-1 cursor-pointer"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- 步骤 1 & 2: 检测 Steam 路径并校验位数 / 询问是否注入 -->
      <div v-if="step === 1 || step === 2" class="p-6 space-y-5">
        <!-- 步骤 1: 路径检测结果展示 -->
        <div class="bg-slate-950/40 border border-white/10 rounded-2xl p-4">
          <div class="flex items-center justify-between mb-2">
            <div class="text-xs font-bold text-slate-200 flex items-center gap-2">
              <Folder class="w-3.5 h-3.5 theme-text-accent" />
              <span>步骤 1：检测 Steam 文件夹</span>
              <RotateCw v-if="checkingPath" class="w-3.5 h-3.5 text-sky-400 animate-spin" />
            </div>
            <div class="flex items-center gap-2">
              <span
                v-if="steamBitness !== 'unknown'"
                class="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono border"
                :class="steamBitness === 'x86' ? 'bg-rose-500/20 text-rose-300 border-rose-500/40' : 'bg-sky-500/10 text-sky-300 border-sky-500/30'"
              >
                {{ steamBitness === 'x86' ? '32 位 (x86) ⚠️' : '64 位 (x64) ✓' }}
              </span>
              <span
                v-if="steamPath"
                class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 flex items-center gap-1"
              >
                <span>●</span> 已定位路径
              </span>
              <span
                v-else-if="!checkingPath"
                class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-300 border border-rose-500/20 flex items-center gap-1"
              >
                <span>●</span> 未找到路径
              </span>
            </div>
          </div>

          <!-- 路径展示 / 选择 -->
          <div class="space-y-2.5 mt-3">
            <div class="flex items-center gap-2">
              <input
                v-model="steamPath"
                @change="onPathInputChange"
                @blur="onPathInputChange"
                type="text"
                placeholder="自动探测中，或点击右侧手动选择 Steam 根目录 (如 E:\Steam)..."
                class="flex-1 bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-400"
              />
              <button
                @click="browseSteamPath"
                class="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs text-slate-300 font-medium transition shrink-0 flex items-center gap-1.5"
              >
                <FolderOpen class="w-3.5 h-3.5" />
                <span>浏览</span>
              </button>
            </div>

            <div class="flex items-center justify-between text-[11px] text-slate-400 pt-1">
              <span>Steam 客户端状态:</span>
              <span :class="isSteamRunning ? 'text-emerald-400 font-bold' : 'text-slate-400'">
                {{ isSteamRunning ? '🟢 正在运行中' : '⚪ 未运行' }}
              </span>
            </div>
          </div>
        </div>

        <!-- 场景 A：检测到 32 位 Steam (x86) -> 阻止激活，提示更新并只提供退出按钮 -->
        <div v-if="steamBitness === 'x86'" class="bg-rose-950/40 border border-rose-500/50 rounded-2xl p-4 animate-in fade-in duration-200">
          <div class="text-xs font-bold text-rose-300 flex items-center gap-2 mb-2">
            <AlertTriangle class="w-4 h-4 text-rose-400" />
            <span>提示：检测到 32 位 (x86) Steam 客户端</span>
          </div>
          <p class="text-xs text-rose-200 leading-relaxed mb-3">
            <strong>OpenSteamTool 内核仅支持 64 位 (x64) 现代 Steam 客户端。</strong>
            检测到您当前的 Steam 客户端为 32 位老旧版本，无法正常加载 64 位注入核心与解锁规则。
          </p>

          <div class="bg-slate-950/70 p-3.5 rounded-xl border border-rose-800/40 space-y-1.5 text-[11px] text-slate-300">
            <div class="font-bold text-slate-200">💡 升级解决方案：</div>
            <div class="flex items-start gap-1.5">
              <span class="theme-text-accent font-mono">1.</span>
              <span>打开 Steam 客户端，点击顶部菜单 <strong>「Steam」➔「检查 Steam 客户端更新...」</strong> 进行在线升级。</span>
            </div>
            <div class="flex items-start gap-1.5">
              <span class="theme-text-accent font-mono">2.</span>
              <span>或前往 Steam 官方网站 (<strong>store.steampowered.com</strong>) 下载最新安装包覆盖安装（不会丢失游戏）。</span>
            </div>
            <div class="flex items-start gap-1.5">
              <span class="theme-text-accent font-mono">3.</span>
              <span>升级至 64 位版本后，点击下方「重新检测」或重新启动本程序。</span>
            </div>
          </div>

          <!-- 32 位专属按钮：仅退出与重新检测，不提供激活按钮 -->
          <div class="flex items-center justify-between pt-4 mt-3 border-t border-rose-900/50">
            <button
              @click="checkSteamPath"
              :disabled="checkingPath"
              class="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium rounded-xl transition flex items-center gap-1.5"
            >
              <RotateCw class="w-3.5 h-3.5" :class="{ 'animate-spin': checkingPath }" />
              <span>重新检测</span>
            </button>

            <button
              @click="closable ? requestClose() : handleExitApp()"
              class="px-6 py-2.5 bg-gradient-to-r from-rose-700 to-rose-600 hover:from-rose-600 hover:to-rose-500 text-white text-xs font-bold rounded-xl shadow-lg transition flex items-center gap-1.5"
            >
              <X class="w-3.5 h-3.5" />
              <span>{{ closable ? '关闭引导' : '退出程序' }}</span>
            </button>
          </div>
        </div>

        <!-- 场景 B：正常 64 位 Steam (x64) 或未知路径 -> 步骤 2 正常询问注入 -->
        <div v-else class="space-y-4">
          <div class="bg-slate-950/40 border border-white/10 rounded-2xl p-4">
            <div class="text-xs font-bold theme-text-accent flex items-center gap-2 mb-2">
              <Zap class="w-3.5 h-3.5" />
              <span>步骤 2：是否注入 Steam 环境？</span>
            </div>
            <p class="text-xs text-slate-300 leading-relaxed mb-2">
              是否立即向当前 Steam 目录激活 OpenSteam 解锁运行环境？
            </p>
            <ul class="text-[11px] text-slate-400 space-y-1 list-disc list-inside bg-slate-900/60 p-3 rounded-xl border border-white/10">
              <li>
                🎯 <strong>64 位架构匹配</strong>：已自动识别为 <span class="theme-text-accent font-bold font-mono">64 位 (x64) Steam</span>，将部署 64 位 OpenSteamTool 核心组件
              </li>
              <li>自动部署并配置 <code class="theme-text-accent font-mono">config/lua/</code> 自动化解锁规则引擎</li>
              <li>配置公共清单端点与分包解密</li>
              <li v-if="closable">可随时点击右上角 <strong>×</strong> 关闭引导，稍后再配置</li>
              <li v-else>若选择 <strong>“否”</strong>，程序将直接退出关闭</li>
            </ul>
          </div>

          <!-- 64 位操作按钮 -->
          <div class="flex items-center justify-between pt-2 border-t border-white/10">
            <button
              @click="closable ? requestClose() : handleExitApp()"
              class="px-5 py-2.5 bg-slate-800/80 hover:bg-rose-900/60 border border-white/10 hover:border-rose-500/40 text-slate-300 hover:text-rose-200 text-xs font-medium rounded-xl transition flex items-center gap-1.5"
            >
              <X class="w-3.5 h-3.5" />
              <span>{{ closable ? '关闭引导' : '否，退出程序' }}</span>
            </button>

            <button
              @click="startActivation"
              :disabled="!steamPath || checkingPath"
              class="theme-btn-primary px-6 py-2.5 disabled:opacity-50 text-xs font-bold rounded-xl shadow-lg transition flex items-center gap-2"
            >
              <span>是，进入下一步激活</span>
              <span>➔</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 步骤 3: 激活注入中与进度动画 -->
      <div v-else-if="step === 3" class="p-8 space-y-6">
        <div class="text-center">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-sky-500/10 theme-text-accent text-2xl mb-3 animate-pulse border border-sky-500/20">
            <RotateCw class="w-8 h-8 animate-spin" />
          </div>
          <h3 class="font-bold text-base text-slate-100">正在激活 Steam 注入环境</h3>
          <p class="text-xs text-slate-400 mt-1">请稍候，系统正在为 Steam 部署自动化规则引擎...</p>
        </div>

        <!-- 激活步骤清单 -->
        <div class="space-y-3 bg-slate-950/40 border border-white/10 rounded-2xl p-4 text-xs">
          <div class="flex items-center justify-between">
            <span class="text-slate-300 flex items-center gap-2">
              <span :class="activationPhase >= 1 ? 'text-emerald-400' : 'text-slate-600'">●</span>
              <span>1. 校验 Steam 安装路径及 64 位架构 (x64)</span>
            </span>
            <span v-if="activationPhase > 1" class="text-emerald-400 font-bold flex items-center gap-1"><CheckCircle2 class="w-3.5 h-3.5" /> 完成</span>
            <span v-else-if="activationPhase === 1" class="theme-text-accent animate-spin"><RotateCw class="w-3.5 h-3.5" /></span>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-slate-300 flex items-center gap-2">
              <span :class="activationPhase >= 2 ? 'text-emerald-400' : 'text-slate-600'">●</span>
              <span>2. 部署 64 位 OpenSteamTool 核心组件与规则引擎</span>
            </span>
            <span v-if="activationPhase > 2" class="text-emerald-400 font-bold flex items-center gap-1"><CheckCircle2 class="w-3.5 h-3.5" /> 完成</span>
            <span v-else-if="activationPhase === 2" class="theme-text-accent animate-spin"><RotateCw class="w-3.5 h-3.5" /></span>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-slate-300 flex items-center gap-2">
              <span :class="activationPhase >= 3 ? 'text-emerald-400' : 'text-slate-600'">●</span>
              <span>3. 自动安全重启 Steam 客户端加载注入内核</span>
            </span>
            <span v-if="activationPhase >= 3 && activationDone" class="text-emerald-400 font-bold flex items-center gap-1"><CheckCircle2 class="w-3.5 h-3.5" /> 完成</span>
            <span v-else-if="activationPhase === 3" class="theme-text-accent animate-spin"><RotateCw class="w-3.5 h-3.5" /></span>
          </div>
        </div>

        <!-- 进度条 -->
        <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
          <div
            class="theme-btn-primary h-2 transition-all duration-500 ease-out"
            :style="{ width: `${progressPercent}%` }"
          ></div>
        </div>
      </div>

      <!-- 步骤 4: 激活成功，准备进入正常界面 -->
      <div v-else-if="step === 4" class="p-8 text-center space-y-6 animate-in fade-in duration-300">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 text-emerald-400 text-3xl border border-emerald-500/20">
          <CheckCircle2 class="w-8 h-8" />
        </div>

        <div>
          <h3 class="font-bold text-lg text-slate-100">Steam 注入环境激活完成！</h3>
          <p class="text-xs text-slate-300 mt-2 max-w-md mx-auto leading-relaxed">
            已成功为您的 64 位 Steam 挂载 OpenSteamTool 核心。您可以开始搜索收录的 18 万+ 游戏，一键生成解锁规则与分包密钥。
          </p>
        </div>

        <div class="bg-slate-950/40 border border-white/10 rounded-xl p-3 text-xs text-slate-400 font-mono inline-block">
          Steam 目录：{{ steamPath }} (64位 x64)
        </div>

        <div>
          <button
            @click="enterMainInterface"
            class="theme-btn-primary px-8 py-3 text-xs font-bold rounded-xl shadow-xl transition flex items-center gap-2 mx-auto"
          >
            <span>进入软件主界面 ({{ countdown }}s)</span>
            <span>➔</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { 
  Zap, 
  Folder, 
  FolderOpen, 
  RotateCw, 
  CheckCircle2, 
  AlertTriangle, 
  X 
} from 'lucide-vue-next';

const props = defineProps<{
  // 手动从设置页打开时为 true：允许关闭引导而不退出程序；首次启动为 false 保持原有强引导流程
  closable?: boolean;
}>();

const emit = defineEmits<{
  (e: 'completed'): void;
  (e: 'close'): void;
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
}>();

const requestClose = () => {
  if (!props.closable || step.value === 3) return; // 激活进行中不允许中断
  emit('close');
};

const step = ref<1 | 2 | 3 | 4>(1);
const steamPath = ref<string>('');
const steamBitness = ref<'x86' | 'x64' | 'unknown'>('unknown');
const isSteamRunning = ref<boolean>(false);
const checkingPath = ref<boolean>(true);

// 激活进度状态
const activationPhase = ref<number>(1);
const progressPercent = ref<number>(15);
const activationDone = ref<boolean>(false);
const countdown = ref<number>(3);
let countdownTimer: any = null;

const checkSteamPath = async () => {
  checkingPath.value = true;
  try {
    const info = await window.electronAPI.getSteamInfo();
    if (info && info.steamPath) {
      steamPath.value = info.steamPath;
      isSteamRunning.value = info.isRunning;
      steamBitness.value = info.steamBitness || 'unknown';
      step.value = 2;
    } else {
      step.value = 1;
    }
  } catch (e: any) {
    console.error('检测 Steam 路径异常:', e);
    step.value = 1;
  } finally {
    checkingPath.value = false;
  }
};

const browseSteamPath = async () => {
  try {
    const selected = await window.electronAPI.selectDirectory();
    if (selected) {
      steamPath.value = selected;
      await window.electronAPI.setSteamPath(selected);
      const info = await window.electronAPI.getSteamInfo();
      isSteamRunning.value = info.isRunning;
      steamBitness.value = info.steamBitness || 'unknown';
      step.value = 2;
    }
  } catch (e: any) {
    emit('notify', `选择目录失败: ${e.message}`, 'error');
  }
};

const onPathInputChange = async () => {
  if (!steamPath.value || !steamPath.value.trim()) return;
  try {
    const cleanPath = steamPath.value.trim();
    await window.electronAPI.setSteamPath(cleanPath);
    const info = await window.electronAPI.getSteamInfo();
    if (info && info.steamPath) {
      steamPath.value = info.steamPath;
      isSteamRunning.value = info.isRunning;
      steamBitness.value = info.steamBitness || 'unknown';
      step.value = 2;
    }
  } catch (e: any) {
    console.warn('路径更新校验:', e);
  }
};

const handleExitApp = async () => {
  try {
    await window.electronAPI.quitApp();
  } catch (e) {
    window.close();
  }
};

const startActivation = async () => {
  if (steamBitness.value === 'x86') {
    emit('notify', 'OpenSteamTool 仅支持 64 位 Steam，请先更新 Steam！', 'error');
    return;
  }

  step.value = 3;
  activationPhase.value = 1;
  progressPercent.value = 25;

  try {
    if (steamPath.value) {
      await window.electronAPI.setSteamPath(steamPath.value);
    }
    await new Promise((r) => setTimeout(r, 600));

    activationPhase.value = 2;
    progressPercent.value = 60;
    const activateRes = await window.electronAPI.activateInjection({
      manifestApi: 'steamrun',
      restartSteam: true
    });

    if (!activateRes.success) {
      emit('notify', activateRes.message, 'error');
      step.value = 2;
      return;
    }

    await new Promise((r) => setTimeout(r, 600));

    activationPhase.value = 3;
    progressPercent.value = 100;
    activationDone.value = true;
    if (activateRes.steamRestarted) {
      emit('notify', 'Steam 客户端已自动重新启动并成功挂载注入内核！', 'success');
    }

    await new Promise((r) => setTimeout(r, 500));

    step.value = 4;
    startCountdown();
  } catch (e: any) {
    emit('notify', `激活注入失败: ${e.message}`, 'error');
    step.value = 2;
  }
};

const startCountdown = () => {
  countdown.value = 3;
  countdownTimer = setInterval(() => {
    countdown.value -= 1;
    if (countdown.value <= 0) {
      clearInterval(countdownTimer);
      enterMainInterface();
    }
  }, 1000);
};

const enterMainInterface = () => {
  if (countdownTimer) {
    clearInterval(countdownTimer);
  }
  emit('completed');
};

onMounted(() => {
  checkSteamPath();
});

onUnmounted(() => {
  if (countdownTimer) {
    clearInterval(countdownTimer);
  }
});
</script>
