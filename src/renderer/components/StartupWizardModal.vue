<template>
  <div class="fixed inset-0 z-50 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4 select-none">
    <div class="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
      <!-- 顶部品牌 Header -->
      <div class="px-6 py-4 bg-gradient-to-r from-sky-900/50 via-slate-800/60 to-slate-900 border-b border-slate-800 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-teal-400 flex items-center justify-center text-slate-950 font-black text-lg shadow-lg">
            ⚡
          </div>
          <div>
            <h2 class="font-bold text-sm text-slate-100 flex items-center gap-2">
              <span>SteamMaster 启动引导</span>
              <span class="text-[10px] px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 font-mono">环境准备</span>
            </h2>
            <p class="text-[11px] text-slate-400">Steam 客户端环境检测与一键注入激活</p>
          </div>
        </div>

        <!-- 步骤指示器 -->
        <div class="flex items-center gap-1.5 text-[11px] font-mono">
          <span
            v-for="s in 4"
            :key="s"
            class="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold transition-all"
            :class="step >= s ? 'bg-sky-500 text-slate-950 ring-2 ring-sky-500/30' : 'bg-slate-800 text-slate-500'"
          >
            {{ s }}
          </span>
        </div>
      </div>

      <!-- 步骤 1 & 2: 检测 Steam 路径并询问是否注入 -->
      <div v-if="step === 1 || step === 2" class="p-6 space-y-5">
        <!-- 步骤 1: 路径检测结果展示 -->
        <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-4">
          <div class="flex items-center justify-between mb-2">
            <div class="text-xs font-bold text-slate-300 flex items-center gap-2">
              <span>📁 步骤 1：检测 Steam 文件夹</span>
              <span v-if="checkingPath" class="text-sky-400 animate-spin text-xs">🔄</span>
            </div>
            <div class="flex items-center gap-2">
              <span
                v-if="steamBitness !== 'unknown'"
                class="px-2 py-0.5 rounded text-[10px] font-bold font-mono bg-sky-500/20 text-sky-300 border border-sky-500/30"
              >
                {{ steamBitness === 'x86' ? '32 位 (x86)' : '64 位 (x64)' }}
              </span>
              <span
                v-if="steamPath"
                class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 flex items-center gap-1"
              >
                <span>●</span> 已定位路径
              </span>
              <span
                v-else-if="!checkingPath"
                class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 flex items-center gap-1"
              >
                <span>●</span> 未找到路径
              </span>
            </div>
          </div>

          <!-- 路径展示 / 选择 -->
          <div class="space-y-2 mt-3">
            <div class="flex items-center gap-2">
              <input
                v-model="steamPath"
                @change="onPathInputChange"
                @blur="onPathInputChange"
                type="text"
                placeholder="自动探测中，或点击右侧手动选择 Steam 根目录 (如 E:\Steam)..."
                class="flex-1 bg-slate-900 border border-slate-700/80 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500"
              />
              <button
                @click="browseSteamPath"
                class="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg text-xs text-slate-300 font-medium transition shrink-0 flex items-center gap-1"
              >
                <span>📂 浏览</span>
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

        <!-- 步骤 2: 询问是否注入 Steam -->
        <div class="bg-gradient-to-br from-sky-950/40 via-slate-950/60 to-slate-950/80 border border-sky-500/30 rounded-xl p-4">
          <div class="text-xs font-bold text-sky-300 flex items-center gap-2 mb-2">
            <span>💉 步骤 2：是否注入 Steam 环境？</span>
          </div>
          <p class="text-xs text-slate-300 leading-relaxed mb-2">
            是否立即向当前 Steam 目录激活 OpenSteam 解锁运行环境？
          </p>
          <ul class="text-[11px] text-slate-400 space-y-1 list-disc list-inside bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/80">
            <li v-if="steamBitness === 'x86'">
              🎯 <strong>智能架构匹配</strong>：已自动识别为 <span class="text-sky-300 font-bold font-mono">32 位 (x86) Steam</span>，将部署 32 位专用 Hook 核心 (<code class="text-sky-300 font-mono">version.dll</code>)
            </li>
            <li v-else-if="steamBitness === 'x64'">
              🎯 <strong>智能架构匹配</strong>：已自动识别为 <span class="text-sky-300 font-bold font-mono">64 位 (x64) Steam</span>，将部署 64 位 OpenSteamTool 核心组件
            </li>
            <li v-else>
              🎯 <strong>智能架构匹配</strong>：自动检测 Steam 位数并智能部署匹配的 Hook 注入核心
            </li>
            <li>自动部署并配置 <code class="text-sky-300 font-mono">st_scripts/</code> 自动化解锁规则引擎</li>
            <li>配置 <code class="text-sky-300 font-mono">opensteamtool.toml</code> 公共清单端点与分包解密</li>
            <li>若选择 <strong>“否”</strong>，程序将直接退出关闭</li>
          </ul>
        </div>

        <!-- 操作按钮 -->
        <div class="flex items-center justify-between pt-2 border-t border-slate-800">
          <button
            @click="handleExitApp"
            class="px-5 py-2.5 bg-slate-800/80 hover:bg-rose-900/60 border border-slate-700/80 hover:border-rose-500/40 text-slate-300 hover:text-rose-200 text-xs font-medium rounded-xl transition flex items-center gap-1.5"
          >
            <span>✕ 否，退出程序</span>
          </button>

          <button
            @click="startActivation"
            :disabled="!steamPath || checkingPath"
            class="px-6 py-2.5 bg-gradient-to-r from-sky-600 to-teal-600 hover:from-sky-500 hover:to-teal-500 disabled:opacity-50 text-white text-xs font-bold rounded-xl shadow-lg transition flex items-center gap-2"
          >
            <span>⚡ 是，进入下一步激活</span>
            <span>➔</span>
          </button>
        </div>
      </div>

      <!-- 步骤 3: 激活注入中与进度动画 -->
      <div v-else-if="step === 3" class="p-8 space-y-6">
        <div class="text-center">
          <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-sky-500/20 text-sky-400 text-2xl mb-3 animate-pulse border border-sky-500/30">
            ⚙️
          </div>
          <h3 class="font-bold text-base text-slate-100">正在激活 Steam 注入环境</h3>
          <p class="text-xs text-slate-400 mt-1">请稍候，系统正在为 Steam 部署自动化规则引擎...</p>
        </div>

        <!-- 激活步骤清单 -->
        <div class="space-y-3 bg-slate-950/70 border border-slate-800 rounded-xl p-4 text-xs">
          <div class="flex items-center justify-between">
            <span class="text-slate-300 flex items-center gap-2">
              <span :class="activationPhase >= 1 ? 'text-emerald-400' : 'text-slate-600'">●</span>
              <span>1. 校验 Steam 安装路径及位数架构 ({{ steamBitness === 'x86' ? '32位 x86' : '64位 x64' }})</span>
            </span>
            <span v-if="activationPhase > 1" class="text-emerald-400 font-bold">✓ 完成</span>
            <span v-else-if="activationPhase === 1" class="text-sky-400 animate-spin">🔄</span>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-slate-300 flex items-center gap-2">
              <span :class="activationPhase >= 2 ? 'text-emerald-400' : 'text-slate-600'">●</span>
              <span>2. 自适应部署 {{ steamBitness === 'x86' ? '32位专用 Hook 内核' : '64位 Hook 内核' }} 与规则引擎</span>
            </span>
            <span v-if="activationPhase > 2" class="text-emerald-400 font-bold">✓ 完成</span>
            <span v-else-if="activationPhase === 2" class="text-sky-400 animate-spin">🔄</span>
          </div>

          <div class="flex items-center justify-between">
            <span class="text-slate-300 flex items-center gap-2">
              <span :class="activationPhase >= 3 ? 'text-emerald-400' : 'text-slate-600'">●</span>
              <span>3. 自动安全重启 Steam 客户端加载注入内核</span>
            </span>
            <span v-if="activationPhase >= 3 && activationDone" class="text-emerald-400 font-bold">✓ 完成</span>
            <span v-else-if="activationPhase === 3" class="text-sky-400 animate-spin">🔄</span>
          </div>
        </div>

        <!-- 进度条 -->
        <div class="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
          <div
            class="bg-gradient-to-r from-sky-500 to-teal-400 h-2 transition-all duration-500 ease-out"
            :style="{ width: `${progressPercent}%` }"
          ></div>
        </div>
      </div>

      <!-- 步骤 4: 激活成功，准备进入正常界面 -->
      <div v-else-if="step === 4" class="p-8 text-center space-y-6 animate-in fade-in duration-300">
        <div class="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/20 text-emerald-400 text-3xl border border-emerald-500/30">
          ✓
        </div>

        <div>
          <h3 class="font-bold text-lg text-slate-100">Steam 注入环境激活完成！</h3>
          <p class="text-xs text-slate-300 mt-2 max-w-md mx-auto leading-relaxed">
            已成功为您的 {{ steamBitness === 'x86' ? '32 位' : '64 位' }} Steam 挂载专用注入核心。您可以开始搜索收录的 18 万+ 游戏，一键生成解锁规则与分包密钥。
          </p>
        </div>

        <div class="bg-slate-950/60 border border-slate-800 rounded-xl p-3 text-xs text-slate-400 font-mono inline-block">
          Steam 目录：{{ steamPath }} ({{ steamBitness === 'x86' ? '32位 x86' : '64位 x64' }})
        </div>

        <div>
          <button
            @click="enterMainInterface"
            class="px-8 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow-xl transition flex items-center gap-2 mx-auto"
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

const emit = defineEmits<{
  (e: 'completed'): void;
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
}>();

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

// 1. 初始化检测 Steam 文件夹
const checkSteamPath = async () => {
  checkingPath.value = true;
  try {
    const info = await window.electronAPI.getSteamInfo();
    if (info && info.steamPath) {
      steamPath.value = info.steamPath;
      isSteamRunning.value = info.isRunning;
      steamBitness.value = info.steamBitness || 'unknown';
      step.value = 2; // 进入第2步：确认注入
    } else {
      step.value = 1; // 未检测到，停留在第1步提示选择
    }
  } catch (e: any) {
    console.error('检测 Steam 路径异常:', e);
    step.value = 1;
  } finally {
    checkingPath.value = false;
  }
};

// 浏览选择 Steam 路径
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

// 手动输入或修改路径时的校验
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

// 步骤 2 选项：点击“否”，直接退出程序
const handleExitApp = async () => {
  try {
    await window.electronAPI.quitApp();
  } catch (e) {
    window.close();
  }
};

// 步骤 2 选项：点击“是”，启动步骤 3 激活注入流程
const startActivation = async () => {
  step.value = 3;
  activationPhase.value = 1;
  progressPercent.value = 25;

  try {
    // 阶段 1: 保存并确认路径
    if (steamPath.value) {
      await window.electronAPI.setSteamPath(steamPath.value);
    }
    await new Promise((r) => setTimeout(r, 600));

    // 阶段 2: 写入 opensteamtool.toml 与 st_scripts 注入配置
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

    // 阶段 3: 自动重启 Steam 客户端并加载注入内核
    activationPhase.value = 3;
    progressPercent.value = 100;
    activationDone.value = true;
    if (activateRes.steamRestarted) {
      emit('notify', 'Steam 客户端已自动重新启动并成功挂载注入内核！', 'success');
    }

    await new Promise((r) => setTimeout(r, 500));

    // 进入第 4 步：激活成功
    step.value = 4;
    startCountdown();
  } catch (e: any) {
    emit('notify', `激活注入失败: ${e.message}`, 'error');
    step.value = 2;
  }
};

// 步骤 4 倒计时自动进入
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

// 步骤 4: 进入正常主界面
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
