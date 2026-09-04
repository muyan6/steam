<template>
  <div class="h-full flex flex-col p-6 overflow-y-auto">
    <!-- 标题与核心说明 -->
    <div class="mb-6">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-2xl theme-btn-primary flex items-center justify-center text-slate-950 font-black shadow-lg">
          <Gamepad2 class="w-5 h-5 text-slate-950" />
        </div>
        <div>
          <h2 class="text-xl font-bold text-slate-100 flex items-center gap-2.5">
            <span>联机修复与生态中心</span>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-mono font-bold border border-emerald-500/20">
              P2P 联机一键直通
            </span>
          </h2>
          <p class="text-xs text-slate-400 mt-1">
            采用官方底层拦截技术，告别繁琐的文件替换，一键以联机生态启动 Steam 即可畅玩全库 P2P 联机游戏
          </p>
        </div>
      </div>
    </div>

    <div class="space-y-6 max-w-4xl pb-10">
      <!-- 🌟 方案一：全局 Steam -onlinefix 极速模式 (主推推荐方案 - 覆盖 99% 游戏) -->
      <div class="theme-card-static rounded-3xl p-6 shadow-xl border relative overflow-hidden">
        <!-- 顶部主推标识与状态徽章 -->
        <div class="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div>
            <div class="flex items-center gap-2.5">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <h3 class="text-base font-bold text-slate-100 flex items-center gap-2">
                <span>方案一：Steam 全局 -onlinefix 极速联机</span>
              </h3>
              <span class="px-2.5 py-0.5 rounded-full bg-gradient-to-r from-sky-500/20 to-emerald-500/20 text-sky-400 text-[11px] font-bold border border-sky-500/30">
                🌟 推荐方案 · 覆盖 99% 游戏
              </span>
            </div>
            <p class="text-xs text-slate-300 mt-2 leading-relaxed max-w-2xl">
              直接通过 OpenSteamTool 内核的底层动态拦截机制拉起 Steam。<strong>无需寻找并修改任何游戏目录</strong>，所有支持 P2P 联机游戏的大厅与房间将动态伪装为 Spacewar (AppID 480)，可在 Steam 好友列表中直接右键“邀请加入游戏”！
            </p>
          </div>

          <!-- 当前运行状态指示 -->
          <div class="flex items-center gap-2 flex-wrap">
            <div class="px-3.5 py-2 rounded-2xl bg-slate-900/80 border border-white/10 text-xs font-mono shrink-0 flex items-center gap-2">
              <span class="text-slate-400">当前 Steam 状态:</span>
              <span v-if="steamInfo.isRunning" class="font-bold flex items-center gap-1.5" :class="steamInfo.globalOnlineFixEnabled ? 'text-emerald-400' : 'text-sky-400'">
                <span class="w-2 h-2 rounded-full" :class="steamInfo.globalOnlineFixEnabled ? 'bg-emerald-400' : 'bg-sky-400'"></span>
                <span>{{ steamInfo.globalOnlineFixEnabled ? '🟢 -onlinefix 联机模式' : '⚪ 原版纯净模式' }}</span>
              </span>
              <span v-else class="text-slate-500">⚪ 未运行</span>
            </div>

            <!-- Spacewar 核心依赖状态 -->
            <button
              @click="!spacewarStatus.isInstalled ? (showSpacewarModal = true) : fetchSpacewarStatus(true)"
              class="px-3.5 py-2 rounded-2xl bg-slate-900/80 hover:bg-slate-800/90 border border-white/10 text-xs font-mono shrink-0 flex items-center gap-2 transition cursor-pointer"
              :title="spacewarStatus.isInstalled ? 'Spacewar 已安装就绪，点击刷新检测' : '未检测到 Spacewar，点击查看安装向导'"
            >
              <span class="text-slate-400">Spacewar:</span>
              <span v-if="spacewarStatus.isInstalled" class="text-emerald-400 font-bold flex items-center gap-1.5">
                <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span>🟢 已就绪 (480)</span>
              </span>
              <span v-else class="text-amber-400 font-bold flex items-center gap-1.5 animate-pulse">
                <span class="w-2 h-2 rounded-full bg-amber-400"></span>
                <span>🟡 未安装 (点击安装)</span>
              </span>
            </button>
          </div>
        </div>

        <!-- 4 大核心优势网格 -->
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 my-4">
          <div class="p-3.5 rounded-2xl bg-slate-900/60 border border-white/10 flex flex-col justify-between">
            <div class="flex items-center gap-2 text-sky-400 font-bold text-xs mb-1">
              <Zap class="w-3.5 h-3.5" />
              <span>全库通用免配置</span>
            </div>
            <p class="text-[11px] text-slate-400 leading-snug">
              无需找游戏目录与DLL，幻兽帕鲁、后室、双人成行等全部即开即连。
            </p>
          </div>

          <div class="p-3.5 rounded-2xl bg-slate-900/60 border border-white/10 flex flex-col justify-between">
            <div class="flex items-center gap-2 text-emerald-400 font-bold text-xs mb-1">
              <ShieldCheck class="w-3.5 h-3.5" />
              <span>0 损耗零改动</span>
            </div>
            <p class="text-[11px] text-slate-400 leading-snug">
              不修改任何游戏本地文件与存档，彻底杜绝文件损坏或验证报错。
            </p>
          </div>

          <div class="p-3.5 rounded-2xl bg-slate-900/60 border border-white/10 flex flex-col justify-between">
            <div class="flex items-center gap-2 text-purple-400 font-bold text-xs mb-1">
              <Users class="w-3.5 h-3.5" />
              <span>Steam 好友直邀</span>
            </div>
            <p class="text-[11px] text-slate-400 leading-snug">
              进入游戏后直接按 Shift+Tab 或好友列表右键邀请好友秒进房间。
            </p>
          </div>

          <div class="p-3.5 rounded-2xl bg-slate-900/60 border border-white/10 flex flex-col justify-between">
            <div class="flex items-center gap-2 text-amber-400 font-bold text-xs mb-1">
              <RotateCcw class="w-3.5 h-3.5" />
              <span>秒级无损还原</span>
            </div>
            <p class="text-[11px] text-slate-400 leading-snug">
              仅在带参启动时生效，随时点击右侧按钮瞬间恢复官方纯净 Steam。
            </p>
          </div>
        </div>

        <!-- 极速联机简易 3 步指南 -->
        <div class="p-3.5 rounded-2xl bg-slate-950/40 border border-white/10 flex items-center justify-between text-xs text-slate-300 mb-5 flex-wrap gap-2">
          <div class="flex items-center gap-2 font-bold text-slate-200">
            <Sparkles class="w-4 h-4 text-amber-500 shrink-0" />
            <span>极速联机 3 步走:</span>
          </div>
          <div class="flex items-center gap-4 text-[11px] text-slate-400 flex-wrap">
            <span class="flex items-center gap-1.5"><span class="w-4 h-4 rounded-full bg-sky-500/20 text-sky-400 font-mono text-center leading-4 font-bold">1</span> 点击下方按钮启动 Steam</span>
            <span>➔</span>
            <span class="flex items-center gap-1.5"><span class="w-4 h-4 rounded-full bg-sky-500/20 text-sky-400 font-mono text-center leading-4 font-bold">2</span> 正常启动已入库的游戏</span>
            <span>➔</span>
            <span class="flex items-center gap-1.5"><span class="w-4 h-4 rounded-full bg-sky-500/20 text-sky-400 font-mono text-center leading-4 font-bold">3</span> 呼出 Steam 好友列表直接右键邀请开黑</span>
          </div>
        </div>

        <!-- 主操作按钮区域 -->
        <div class="flex items-center justify-between gap-4 pt-4 border-t border-white/10 flex-wrap sm:flex-nowrap">
          <button
            @click="handleLaunchGlobalOnlineFix"
            :disabled="actionLoading"
            class="flex-1 py-3.5 theme-btn-primary text-xs font-bold rounded-2xl shadow-xl transition flex items-center justify-center gap-2 group"
          >
            <Rocket class="w-4 h-4 group-hover:animate-bounce" />
            <span>一键以 -onlinefix 模式启动 Steam (推荐)</span>
          </button>

          <button
            @click="handleRestartNormalSteam"
            :disabled="actionLoading"
            class="px-6 py-3.5 bg-slate-800/80 hover:bg-slate-700 border border-white/10 text-slate-300 hover:text-slate-100 text-xs font-medium rounded-2xl transition flex items-center justify-center gap-2 shrink-0"
          >
            <RotateCcw class="w-3.5 h-3.5" />
            <span>恢复官方原版 Steam</span>
          </button>
        </div>
      </div>

      <!-- 🛠️ 方案二：单游戏离线/局域网高级补丁 (高级备用方案 · 折叠式设计) -->
      <div class="theme-card-static rounded-3xl p-5 shadow-lg border flex flex-col">
        <!-- 折叠面板头部 -->
        <div 
          @click="showAdvancedPanel = !showAdvancedPanel"
          class="flex items-center justify-between cursor-pointer select-none group"
        >
          <div class="flex items-center gap-2.5">
            <FolderCog class="w-4 h-4 text-slate-400 group-hover:theme-text-accent transition" />
            <h3 class="text-sm font-bold text-slate-200 group-hover:text-slate-100 transition">
              方案二：单游戏文件级补丁注入器
            </h3>
            <span class="px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-400 text-[10px] font-mono border border-white/10">
              备用方案 / 离线局域网
            </span>
          </div>

          <div class="flex items-center gap-2 text-xs text-slate-400 group-hover:text-slate-200 transition">
            <span class="text-[11px]">{{ showAdvancedPanel ? '收起高级选项 ▴' : '展开高级选项 (非必需) ▾' }}</span>
          </div>
        </div>

        <!-- 提示说明 -->
        <p class="text-xs text-slate-400 mt-2 leading-relaxed">
          💡 <strong>日常联机无需使用此方案</strong>。仅在<strong>完全离线局域网</strong>（配合 Radmin VPN / 蒲公英）、或极少数老游戏需单独替换 <code class="text-slate-300 font-mono bg-slate-900/60 px-1 py-0.2 rounded">steam_api64.dll</code> 时作为备用。
        </p>

        <!-- 展开内容 -->
        <div v-if="showAdvancedPanel" class="mt-4 pt-4 border-t border-white/10 space-y-4 animate-in fade-in duration-200">
          <!-- 目录选择器 -->
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">
              目标游戏根目录 (包含 steam_api64.dll 所在文件夹):
            </label>
            <div class="flex items-center gap-3">
              <input
                v-model="targetDir"
                @input="checkDirectoryStatus"
                type="text"
                placeholder="例如: D:\SteamLibrary\steamapps\common\Palworld"
                class="flex-1 bg-slate-900/90 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 font-mono focus:outline-none focus:border-sky-400"
              />
              <button
                @click="handleSelectFolder"
                class="px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700 border border-white/10 rounded-xl text-xs text-slate-200 transition font-medium flex items-center gap-1.5 shrink-0"
              >
                <FolderOpen class="w-3.5 h-3.5" />
                <span>浏览文件夹</span>
              </button>
            </div>
          </div>

          <!-- 目标检测状态卡片 -->
          <div v-if="targetDir" class="p-3.5 rounded-xl bg-slate-900/60 border border-white/10 text-xs">
            <div class="flex items-center justify-between">
              <span class="text-slate-400">当前目录状态:</span>
              <span v-if="dirStatus.isPatched" class="text-emerald-400 font-bold flex items-center gap-1.5">
                <CheckCircle2 class="w-3.5 h-3.5 text-emerald-400" />
                <span>已注入 {{ dirStatus.mode === 'spacewar' ? 'Spacewar (480)' : 'Goldberg 局域网' }} 补丁</span>
              </span>
              <span v-else class="text-slate-400">
                原版未注入状态 (安全)
              </span>
            </div>
            <div v-if="dirStatus.hasBackup" class="text-sky-400 text-[11px] mt-1.5 flex items-center gap-1 font-medium">
              <Check class="w-3 h-3 text-sky-400" />
              <span>已存在原版 steam_api64_o.dll 备份，随时支持一键无损还原</span>
            </div>
          </div>

          <!-- 联机模式切换 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- 模式 A: Spacewar 480 模式 -->
            <div
              @click="selectedMode = 'spacewar'"
              class="p-4 rounded-xl border transition-all duration-200 cursor-pointer flex flex-col justify-between"
              :class="selectedMode === 'spacewar' 
                ? 'bg-sky-500/10 border-sky-500/60 ring-1 ring-sky-500/50 shadow-md' 
                : 'theme-card hover:border-sky-500/30'"
            >
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <span class="font-bold text-xs text-slate-100">模式 A: Spacewar (480) 官方大厅模式</span>
                  <span v-if="selectedMode === 'spacewar'" class="text-sky-400 text-[11px] font-bold flex items-center gap-0.5">
                    <Check class="w-3 h-3" /> 已选择
                  </span>
                </div>
                <p class="text-[11px] text-slate-400 leading-relaxed mb-3">
                  替换本地 steam_api64.dll 并写入 OnlineFix.ini。好友在 Steam 中直接相互邀请直连。
                </p>
              </div>

              <div>
                <label class="block text-[11px] text-slate-400 mb-1 font-medium">该游戏真实 AppID (如 1623730):</label>
                <input
                  v-model.number="appIdInput"
                  type="number"
                  placeholder="请输入数字 AppID"
                  class="w-full bg-slate-950/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-sky-400 font-mono"
                  @click.stop
                />
              </div>
            </div>

            <!-- 模式 B: Goldberg 局域网模式 -->
            <div
              @click="selectedMode = 'goldberg'"
              class="p-4 rounded-xl border transition-all duration-200 cursor-pointer flex flex-col justify-between"
              :class="selectedMode === 'goldberg' 
                ? 'bg-emerald-500/10 border-emerald-500/60 ring-1 ring-emerald-500/50 shadow-md' 
                : 'theme-card hover:border-emerald-500/30'"
            >
              <div>
                <div class="flex items-center justify-between mb-1.5">
                  <span class="font-bold text-xs text-slate-100">模式 B: Goldberg 离线/局域网模式</span>
                  <span v-if="selectedMode === 'goldberg'" class="text-emerald-400 text-[11px] font-bold flex items-center gap-0.5">
                    <Check class="w-3 h-3" /> 已选择
                  </span>
                </div>
                <p class="text-[11px] text-slate-400 leading-relaxed mb-3">
                  部署 Goldberg 离线模拟器与广播配置。适合离线局域网或 VPN 虚拟局域网对战。
                </p>
              </div>

              <div>
                <label class="block text-[11px] text-slate-400 mb-1 font-medium">玩家游戏内自定义昵称:</label>
                <input
                  v-model="playerNameInput"
                  type="text"
                  placeholder="如: Player_01"
                  class="w-full bg-slate-950/40 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-400"
                  @click.stop
                />
              </div>
            </div>
          </div>

          <!-- 操作按钮条 -->
          <div class="flex items-center gap-3 pt-3 border-t border-white/10">
            <button
              @click="handleApplyFix"
              :disabled="!targetDir || actionLoading"
              class="flex-1 py-2.5 theme-btn-primary disabled:opacity-50 text-xs font-bold rounded-xl shadow transition flex items-center justify-center gap-2"
            >
              <Zap class="w-4 h-4" />
              <span>一键注入所选联机补丁</span>
            </button>

            <button
              @click="handleRestoreOriginal"
              :disabled="!targetDir || actionLoading"
              class="px-6 py-2.5 bg-slate-800/80 hover:bg-rose-900/60 border border-white/10 hover:border-rose-500/40 disabled:opacity-50 text-slate-300 hover:text-rose-200 text-xs font-medium rounded-xl transition flex items-center gap-1.5"
            >
              <RotateCcw class="w-3.5 h-3.5" />
              <span>一键无损还原原版</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 🌟 Spacewar 未安装提示弹窗 (像素级对齐设计) -->
    <div
      v-if="showSpacewarModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-200"
      @click.self="showSpacewarModal = false"
    >
      <div class="relative w-full max-w-md bg-slate-900 border border-white/10 rounded-3xl p-7 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
        <!-- 警告黄色圆环图标 -->
        <div class="w-16 h-16 rounded-full bg-amber-500/15 border-2 border-amber-500/40 flex items-center justify-center mb-4 shadow-lg shadow-amber-500/10">
          <AlertTriangle class="w-8 h-8 text-amber-400" />
        </div>

        <!-- 标题 -->
        <h3 class="text-xl font-bold text-slate-100 mb-2 tracking-tight">
          Spacewar未安装
        </h3>

        <!-- 提示说明文案 -->
        <p class="text-xs text-slate-300 leading-relaxed max-w-xs mb-6">
          正在帮你安装联机必备Steam应用《Spacewar》<br />
          Steam弹出安装请进行安装，安装后点击刷新列表。
        </p>

        <!-- 按钮组 -->
        <div class="flex items-center gap-3 w-full">
          <button
            @click="handleTriggerSpacewarInstall"
            class="flex-1 py-3 px-4 bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-slate-950 font-bold text-xs rounded-2xl shadow-lg shadow-sky-500/20 transition flex items-center justify-center gap-2 cursor-pointer"
          >
            <Check class="w-4 h-4 text-slate-950" />
            <span>打开Steam安装</span>
          </button>

          <button
            @click="showSpacewarModal = false"
            class="flex-1 py-3 px-4 bg-slate-800/90 hover:bg-slate-700 active:bg-slate-600 text-slate-300 hover:text-slate-100 font-bold text-xs rounded-2xl border border-white/10 transition flex items-center justify-center gap-2 cursor-pointer"
          >
            <X class="w-4 h-4 text-slate-400" />
            <span>取消</span>
          </button>
        </div>

        <!-- 底部快捷状态与刷新 -->
        <div class="mt-5 pt-3.5 border-t border-white/5 w-full flex items-center justify-between text-[11px] text-slate-400">
          <span class="flex items-center gap-1.5 font-mono">
            <span class="w-2 h-2 rounded-full" :class="spacewarStatus.isInstalled ? 'bg-emerald-400' : 'bg-amber-400'"></span>
            <span>{{ spacewarStatus.isInstalled ? '已成功检测到 Spacewar (AppID: 480)' : '等待安装确认中...' }}</span>
          </span>
          <button
            @click="fetchSpacewarStatus(true)"
            :disabled="isCheckingSpacewar"
            class="text-sky-400 hover:text-sky-300 font-medium flex items-center gap-1 cursor-pointer transition disabled:opacity-50"
          >
            <RefreshCw class="w-3 h-3" :class="isCheckingSpacewar ? 'animate-spin' : ''" />
            <span>刷新状态</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { 
  Gamepad2, 
  Zap, 
  Rocket, 
  RotateCcw, 
  FolderCog, 
  FolderOpen, 
  CheckCircle2, 
  Check, 
  Sparkles,
  ShieldCheck,
  Users,
  AlertTriangle,
  X,
  RefreshCw
} from 'lucide-vue-next';
import { OnlineFixStatus, SteamEnvironmentInfo, SpacewarStatus } from '../../types';

const emit = defineEmits<{
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
}>();

const showAdvancedPanel = ref(false);
const targetDir = ref('');
const selectedMode = ref<'spacewar' | 'goldberg'>('spacewar');
const appIdInput = ref<number | ''>('');
const playerNameInput = ref('春风渡玩家');
const actionLoading = ref(false);

const showSpacewarModal = ref(false);
const isCheckingSpacewar = ref(false);
const spacewarStatus = ref<SpacewarStatus>({
  isInstalled: false,
  appName: 'Spacewar',
  appId: 480
});

const steamInfo = ref<SteamEnvironmentInfo>({
  steamPath: null,
  isRunning: false,
  ostInstalled: false,
  scriptsCount: 0,
  globalOnlineFixEnabled: false
});

const dirStatus = ref<OnlineFixStatus>({
  gamePath: '',
  hasBackup: false,
  isPatched: false,
  mode: 'none'
});

const fetchSteamStatus = async () => {
  try {
    const info = await window.electronAPI.getSteamInfo();
    if (info) {
      steamInfo.value = info;
    }
  } catch {
    // ignore
  }
};

const fetchSpacewarStatus = async (notifyUser: boolean = false) => {
  isCheckingSpacewar.value = true;
  try {
    const status = await window.electronAPI.checkSpacewarInstalled();
    if (status) {
      spacewarStatus.value = status;
      if (notifyUser) {
        if (status.isInstalled) {
          emit('notify', '检测到 Spacewar (AppID: 480) 已成功就绪！', 'success');
        } else {
          emit('notify', '尚未检测到 Spacewar 安装文件，请在 Steam 中确认安装。', 'warning');
        }
      }
    }
  } catch {
    // ignore
  } finally {
    isCheckingSpacewar.value = false;
  }
};

const handleTriggerSpacewarInstall = async () => {
  try {
    emit('notify', '正在唤起 Steam 安装向导...', 'info');
    await window.electronAPI.installSpacewar();
    emit('notify', '已打开 Steam 安装界面，请在 Steam 弹窗中点击确认安装，安装后点击【刷新状态】即可。', 'success');
  } catch (e: any) {
    emit('notify', `唤起 Steam 安装失败: ${e.message}`, 'error');
  }
};

const handleSelectFolder = async () => {
  try {
    const selected = await window.electronAPI.selectDirectory();
    if (selected) {
      targetDir.value = selected;
      await checkDirectoryStatus();
    }
  } catch (e: any) {
    emit('notify', `选择目录失败: ${e.message}`, 'error');
  }
};

const checkDirectoryStatus = async () => {
  if (!targetDir.value.trim()) return;
  try {
    const status = await window.electronAPI.checkGameDir(targetDir.value);
    dirStatus.value = status;
    if (status.appId && !appIdInput.value) {
      appIdInput.value = status.appId;
    }
  } catch {
    // ignore
  }
};

const handleLaunchGlobalOnlineFix = async () => {
  // 检测 Spacewar 是否已安装
  if (!spacewarStatus.value.isInstalled) {
    showSpacewarModal.value = true;
    emit('notify', '检测到未安装联机必备组件 Spacewar，请先完成安装！', 'warning');
    return;
  }

  actionLoading.value = true;
  try {
    emit('notify', '正在以 -onlinefix 参数拉起 Steam...', 'info');
    await window.electronAPI.launchOnlineFixSteam();
    emit('notify', 'Steam 已带 -onlinefix 成功启动！所有 P2P 游戏大厅已就绪。', 'success');
    await fetchSteamStatus();
  } catch (e: any) {
    emit('notify', `启动失败: ${e.message}`, 'error');
  } finally {
    actionLoading.value = false;
  }
};

const handleRestartNormalSteam = async () => {
  actionLoading.value = true;
  try {
    emit('notify', '正在以纯净官方原版模式重启 Steam 客户端...', 'info');
    await window.electronAPI.restartSteam();
    emit('notify', '已恢复原版正常模式启动 Steam！', 'success');
    await fetchSteamStatus();
  } catch (e: any) {
    emit('notify', `重启失败: ${e.message}`, 'error');
  } finally {
    actionLoading.value = false;
  }
};

const handleApplyFix = async () => {
  if (!targetDir.value) {
    emit('notify', '请先指定游戏目录', 'warning');
    return;
  }

  if (selectedMode.value === 'spacewar' && !spacewarStatus.value.isInstalled) {
    showSpacewarModal.value = true;
    emit('notify', '检测到未安装联机必备组件 Spacewar，请先完成安装！', 'warning');
    return;
  }

  actionLoading.value = true;
  try {
    if (selectedMode.value === 'spacewar') {
      const appId = Number(appIdInput.value) || 480;
      const res = await window.electronAPI.applySpacewarFix(targetDir.value, appId);
      if (res.success) {
        emit('notify', res.message, 'success');
        await checkDirectoryStatus();
      } else {
        emit('notify', res.message, 'error');
      }
    } else {
      const appId = Number(appIdInput.value) || 480;
      const res = await window.electronAPI.applyGoldbergFix(targetDir.value, appId, playerNameInput.value || 'Player');
      if (res.success) {
        emit('notify', res.message, 'success');
        await checkDirectoryStatus();
      } else {
        emit('notify', res.message, 'error');
      }
    }
  } catch (e: any) {
    emit('notify', `注入失败: ${e.message}`, 'error');
  } finally {
    actionLoading.value = false;
  }
};

const handleRestoreOriginal = async () => {
  if (!targetDir.value) return;
  actionLoading.value = true;
  try {
    const res = await window.electronAPI.restoreGame(targetDir.value);
    if (res.success) {
      emit('notify', res.message, 'success');
      await checkDirectoryStatus();
    } else {
      emit('notify', res.message, 'error');
    }
  } catch (e: any) {
    emit('notify', `还原失败: ${e.message}`, 'error');
  } finally {
    actionLoading.value = false;
  }
};

onMounted(() => {
  fetchSteamStatus();
  fetchSpacewarStatus();
});
</script>
