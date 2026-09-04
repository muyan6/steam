<template>
  <div class="h-full flex flex-col p-6 overflow-y-auto">
    <!-- 标题与模式介绍 -->
    <div class="mb-6">
      <h2 class="text-xl font-bold text-slate-100 flex items-center gap-2.5">
        <Gamepad2 class="w-6 h-6 theme-text-accent" />
        <span>联机修复与注入中心</span>
        <span class="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-mono font-bold border border-emerald-500/20">
          Online Fix Center
        </span>
      </h2>
      <p class="text-xs text-slate-400 mt-1">
        支持利用 Valve 官方 <code class="text-slate-300 font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-800">Spacewar (AppID 480)</code> 测试通道与开源 Goldberg 局域网虚拟组网
      </p>
    </div>

    <div class="space-y-6 max-w-4xl pb-10">
      <!-- 方案一：全局 Steam -onlinefix 极速模式 -->
      <div class="theme-card-static rounded-2xl p-5 shadow-lg border">
        <div class="flex items-start justify-between gap-4 flex-wrap md:flex-nowrap">
          <div>
            <div class="flex items-center gap-2.5">
              <Zap class="w-4 h-4 theme-text-accent" />
              <span class="text-base font-bold text-slate-100">方案一：Steam 全局 -onlinefix 模式</span>
              <span class="px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-300 text-[10px] font-bold border border-sky-500/20">免改游戏文件 (推荐)</span>
            </div>
            <p class="text-xs text-slate-400 mt-2 leading-relaxed">
              借助 OpenSteamTool 内核的底层拦截机制，直接以 <code class="text-sky-400 font-mono bg-slate-900/60 px-1.5 py-0.5 rounded border border-sky-500/20">-onlinefix</code> 参数拉起 Steam。所有支持 P2P 联机游戏的大厅与房间将动态伪装为 Spacewar (480)，可在 Steam 好友列表直接右键“邀请加入游戏”。
            </p>
            <div class="mt-3 text-[11px] text-slate-400 flex items-center gap-2 bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/80">
              <Sparkles class="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span><strong>如何回退：</strong>该模式只在带参数启动时临时生效，不修改任何本地游戏文件。点击右侧「恢复正常启动 Steam」即可瞬间秒级还原！</span>
            </div>
          </div>

          <div class="flex flex-col gap-2.5 shrink-0 w-full md:w-auto">
            <button
              @click="handleLaunchGlobalOnlineFix"
              class="theme-btn-primary px-5 py-2.5 text-xs font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2"
            >
              <Rocket class="w-4 h-4" />
              <span>开启 -onlinefix 启动 Steam</span>
            </button>
            <button
              @click="handleRestartNormalSteam"
              class="px-5 py-2.5 bg-slate-800/80 hover:bg-slate-700 border border-white/10 text-slate-300 hover:text-slate-100 text-xs font-medium rounded-xl transition flex items-center justify-center gap-1.5"
            >
              <RotateCcw class="w-3.5 h-3.5" />
              <span>恢复正常启动 Steam</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 方案二：单游戏目录深度注入与还原 -->
      <div class="theme-card-static rounded-2xl p-5 shadow-lg border flex flex-col">
        <div class="flex items-center gap-2.5 mb-4">
          <FolderCog class="w-4 h-4 theme-text-accent" />
          <span class="text-base font-bold text-slate-100">方案二：单游戏联机补丁注入器</span>
          <span class="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 text-[10px] font-bold border border-amber-500/20">独立文件注入</span>
        </div>

        <!-- 目录选择器 -->
        <div class="mb-4">
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
        <div v-if="targetDir" class="mb-5 p-3.5 rounded-xl bg-slate-900/60 border border-white/10 text-xs">
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
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
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
                替换 steam_api64.dll 并写入 OnlineFix.ini。好友在 Steam 中相互邀请即可直连，无需虚拟局域网。
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
                部署 Goldberg 模拟器与 steam_settings 广播配置。适合离线联机或配合 Radmin VPN / 蒲公英虚拟局域网组网。
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
        <div class="flex items-center gap-3 pt-3 mt-auto border-t border-white/10">
          <button
            @click="handleApplyFix"
            :disabled="!targetDir || actionLoading"
            class="flex-1 py-3 theme-btn-primary disabled:opacity-50 text-xs font-bold rounded-xl shadow transition flex items-center justify-center gap-2"
          >
            <Zap class="w-4 h-4" />
            <span>一键注入所选联机补丁</span>
          </button>

          <button
            @click="handleRestoreOriginal"
            :disabled="!targetDir || actionLoading"
            class="px-6 py-3 bg-slate-800/80 hover:bg-rose-900/60 border border-white/10 hover:border-rose-500/40 disabled:opacity-50 text-slate-300 hover:text-rose-200 text-xs font-medium rounded-xl transition flex items-center gap-1.5"
          >
            <RotateCcw class="w-3.5 h-3.5" />
            <span>一键无损还原原版</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { 
  Gamepad2, 
  Zap, 
  Rocket, 
  RotateCcw, 
  FolderCog, 
  FolderOpen, 
  CheckCircle2, 
  Check, 
  Sparkles 
} from 'lucide-vue-next';
import { OnlineFixStatus } from '../../types';

const emit = defineEmits<{
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
}>();

const targetDir = ref('');
const selectedMode = ref<'spacewar' | 'goldberg'>('spacewar');
const appIdInput = ref<number | ''>('');
const playerNameInput = ref('SteamMasterPlayer');
const actionLoading = ref(false);

const dirStatus = ref<OnlineFixStatus>({
  gamePath: '',
  hasBackup: false,
  isPatched: false,
  mode: 'none'
});

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
  try {
    emit('notify', '正在以 -onlinefix 参数拉起 Steam...', 'info');
    await window.electronAPI.launchOnlineFixSteam();
    emit('notify', 'Steam 已带 -onlinefix 成功启动！', 'success');
  } catch (e: any) {
    emit('notify', `启动失败: ${e.message}`, 'error');
  }
};

const handleRestartNormalSteam = async () => {
  try {
    emit('notify', '正在以纯净原版模式重启 Steam 客户端...', 'info');
    await window.electronAPI.restartSteam();
    emit('notify', '已恢复原版正常模式启动 Steam！', 'success');
  } catch (e: any) {
    emit('notify', `重启失败: ${e.message}`, 'error');
  }
};

const handleApplyFix = async () => {
  if (!targetDir.value) {
    emit('notify', '请先指定游戏目录', 'warning');
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
</script>
