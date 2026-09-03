<template>
  <div class="h-full flex flex-col p-6 overflow-y-auto">
    <!-- 标题 -->
    <div class="mb-6">
      <h2 class="text-xl font-bold text-slate-100 flex items-center gap-2">
        <span>⚙️ 系统设置与运行环境体检</span>
      </h2>
      <p class="text-xs text-slate-400 mt-1">
        深度体检 Steam 客户端环境、OpenSteamTool 注入内核、配置文件及云端数据引擎连接状态
      </p>
    </div>

    <div class="space-y-6 max-w-4xl pb-8">
      <!-- 0. 运行环境完整度与注入健康体检面板 -->
      <div class="bg-steam-card/90 border border-slate-700/50 rounded-xl p-5 shadow-lg">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-bold text-sm text-slate-200 flex items-center gap-2">
            <span>🩺 运行环境健康度体检</span>
            <span
              v-if="healthResult"
              class="px-2.5 py-0.5 rounded text-[11px] font-bold"
              :class="getOverallStatusBadgeClass(healthResult.overallStatus)"
            >
              {{ getOverallStatusText(healthResult.overallStatus) }}
            </span>
          </h3>
          <button
            @click="runEnvironmentHealthCheck"
            :disabled="checkingHealth"
            class="px-3.5 py-1.5 bg-sky-600/30 hover:bg-sky-600/50 border border-sky-500/40 text-sky-200 text-xs font-bold rounded-lg transition flex items-center gap-1.5 shadow"
          >
            <span :class="{ 'animate-spin': checkingHealth }">🔄</span>
            <span>{{ checkingHealth ? '正在体检中...' : '开始全面检测' }}</span>
          </button>
        </div>

        <p class="text-xs text-slate-400 mb-4 leading-relaxed">
          全面检测 Steam 根路径有效性、OpenSteam 核心 Hook 模块 (DLL)、toml 注入配置文件以及运行时内存挂载状态，确保一键入库 100% 成功。
        </p>

        <!-- 检测结果列表 -->
        <div v-if="healthResult" class="space-y-2.5 mb-3">
          <div
            v-for="(item, idx) in healthResult.items"
            :key="idx"
            class="p-3.5 rounded-xl bg-slate-900/70 border flex items-start justify-between gap-3 transition"
            :class="getItemBorderClass(item.status)"
          >
            <div class="flex items-start gap-3 min-w-0">
              <span class="text-lg leading-none mt-0.5">{{ getStatusIcon(item.status) }}</span>
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-bold text-xs text-slate-200">{{ item.name }}</span>
                  <span class="text-[10px] px-2 py-0.5 rounded font-mono" :class="getStatusBadgeClass(item.status)">
                    {{ item.message }}
                  </span>
                </div>
                <p v-if="item.detail" class="text-[11px] text-slate-400 mt-1 font-mono break-all leading-normal">
                  {{ item.detail }}
                </p>
              </div>
            </div>

            <!-- 针对性修复快捷动作 -->
            <div v-if="item.status !== 'success'" class="shrink-0 flex items-center gap-2">
              <button
                v-if="item.category === 'hook' || item.category === 'config' || item.category === 'scripts'"
                @click="handleQuickFix"
                :disabled="deploying"
                class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold rounded-lg transition shadow flex items-center gap-1"
              >
                <span>⚡ 一键修复</span>
              </button>
              <button
                v-else-if="item.category === 'process'"
                @click="handleRestartSteamQuick"
                class="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold rounded-lg transition shadow flex items-center gap-1"
              >
                <span>⚡ 重启 Steam</span>
              </button>
            </div>
          </div>
        </div>

        <div v-if="healthResult" class="text-[11px] text-slate-400 flex items-center justify-between pt-2.5 border-t border-slate-800">
          <span>体检结论：<strong class="text-slate-300">{{ healthResult.summary }}</strong></span>
          <span class="font-mono text-slate-400">检测时间：{{ healthResult.checkedAt }}</span>
        </div>
      </div>

      <!-- 1. 云端数据库连接面板 -->
      <div class="bg-steam-card/90 border border-slate-700/50 rounded-xl p-5 shadow-lg">
        <div class="flex items-center justify-between mb-3">
          <h3 class="font-bold text-sm text-slate-200 flex items-center gap-2">
            <span>☁️ 云端高速数据引擎</span>
            <span class="px-2 py-0.5 rounded text-[10px] font-bold" :class="dbStats.serverStatus === 'online' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'">
              {{ dbStats.serverStatus === 'online' ? '● 云端已连接' : '● 本地基础模式' }}
            </span>
          </h3>
          <span class="text-xs text-slate-400">{{ dbStats.lastUpdated }}</span>
        </div>

        <p class="text-xs text-slate-400 mb-4 leading-relaxed">
          商业版专属云端后端承载全量 18 万+ 游戏数据库与 28.8 万+ DepotKey 密钥库，毫秒级响应中文拼音检索与一键入库，无需消耗本地电脑存储。
        </p>

        <!-- 统计指标卡片 -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
            <div>
              <div class="text-xs text-slate-400">云端已收录游戏总量</div>
              <div class="text-xl font-mono font-bold text-sky-400 mt-1">
                {{ dbStats.gamesCount > 0 ? dbStats.gamesCount.toLocaleString() + ' 款' : '180,000+ 款' }}
              </div>
            </div>
            <button
              @click="loadDbStats"
              :disabled="refreshing"
              class="px-3.5 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition flex items-center gap-1.5 shadow"
            >
              <span v-if="refreshing" class="animate-spin">🔄</span>
              <span>{{ refreshing ? '正在检测...' : '刷新云端状态' }}</span>
            </button>
          </div>

          <div class="p-4 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between">
            <div>
              <div class="text-xs text-slate-400">云端收录 DepotKey 密钥</div>
              <div class="text-xl font-mono font-bold text-emerald-400 mt-1">
                {{ dbStats.keysCount > 0 ? dbStats.keysCount.toLocaleString() + ' 条' : '288,000+ 条' }}
              </div>
            </div>
            <div class="text-xs text-emerald-400 flex items-center gap-1">
              <span>⚡ 云端实时分发</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Steam 安装路径设置 -->
      <div class="bg-steam-card/90 border border-slate-700/50 rounded-xl p-5 shadow-lg">
        <h3 class="font-bold text-sm text-slate-200 mb-3 flex items-center gap-2">
          <span>📁 Steam 本地客户端路径</span>
        </h3>
        <div class="flex items-center gap-3">
          <input
            v-model="steamPathInput"
            type="text"
            placeholder="自动从注册表探测，或点击右侧浏览手动选择..."
            class="flex-1 bg-slate-900/80 border border-slate-700/80 rounded-xl px-4 py-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-steam-accent"
          />
          <button
            @click="handleBrowseSteamPath"
            class="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs text-slate-200 font-medium transition"
          >
            📂 浏览路径
          </button>
          <button
            @click="handleSaveSteamPath"
            class="px-4 py-2.5 bg-steam-blue hover:bg-sky-500 text-white rounded-xl text-xs font-bold transition"
          >
            保存并检测
          </button>
        </div>
      </div>

      <!-- 3. OpenSteamTool 内核与公共清单源设置 -->
      <div class="bg-steam-card/90 border border-slate-700/50 rounded-xl p-5 shadow-lg">
        <h3 class="font-bold text-sm text-slate-200 mb-3 flex items-center gap-2">
          <span>🌐 公共清单 (Manifest) 上游 API 端点配置</span>
        </h3>
        <p class="text-xs text-slate-400 mb-4 leading-relaxed">
          OpenSteamTool 会在入库未拥有游戏时，自动向以下公用端点获取加密清单请求码 (GMRC)，解决个人服务器带宽限制。
        </p>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div
            @click="manifestApi = 'opensteamtool'"
            class="p-3.5 rounded-xl border transition cursor-pointer"
            :class="manifestApi === 'opensteamtool' ? 'bg-sky-950/40 border-sky-500/60 ring-1 ring-sky-500/50' : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'"
          >
            <div class="font-bold text-xs text-slate-200 mb-1">OpenSteamTool 官方源 (推荐)</div>
            <div class="text-[11px] text-slate-400 font-mono break-all">manifest.opensteamtool.com</div>
          </div>

          <div
            @click="manifestApi = 'steamrun'"
            class="p-3.5 rounded-xl border transition cursor-pointer"
            :class="manifestApi === 'steamrun' ? 'bg-sky-950/40 border-sky-500/60 ring-1 ring-sky-500/50' : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'"
          >
            <div class="font-bold text-xs text-slate-200 mb-1">SteamRun 镜像源</div>
            <div class="text-[11px] text-slate-400 font-mono break-all">manifest.steam.run</div>
          </div>

          <div
            @click="manifestApi = 'wudrm'"
            class="p-3.5 rounded-xl border transition cursor-pointer"
            :class="manifestApi === 'wudrm' ? 'bg-sky-950/40 border-sky-500/60 ring-1 ring-sky-500/50' : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'"
          >
            <div class="font-bold text-xs text-slate-200 mb-1">WUDRM 校验源</div>
            <div class="text-[11px] text-slate-400 font-mono break-all">gmrc.wudrm.com</div>
          </div>
        </div>

        <div class="flex items-center justify-between pt-2 border-t border-slate-800">
          <div class="flex items-center gap-2">
            <button
              @click="emit('relaunch-wizard')"
              class="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-xs text-sky-300 font-medium transition flex items-center gap-1.5"
            >
              <span>🚀 重新运行启动注入向导</span>
            </button>
          </div>
          <button
            @click="handleDeployOSTEnv"
            :disabled="deploying"
            class="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow transition flex items-center gap-1.5"
          >
            <span>{{ deploying ? '正在写入...' : '⚡ 一键同步环境配置' }}</span>
          </button>
        </div>
      </div>

      <!-- 4. 安全免责与防杀软提示 -->
      <div class="bg-slate-900/50 border border-slate-800 rounded-xl p-5">
        <h3 class="font-bold text-xs text-amber-400 mb-2 flex items-center gap-1.5">
          <span>🛡️ 安全提示与杀毒软件白名单说明</span>
        </h3>
        <ul class="text-xs text-slate-400 space-y-1.5 list-disc list-inside leading-relaxed">
          <li>本工具为商业级辅助软件，代码逻辑严谨，仅用于合法评测与游戏联机管理。</li>
          <li>由于涉及修改游戏本地配置及 DLL 接口模拟，部分杀毒软件可能会产生误报，建议将软件目录加入信任区。</li>
          <li>请尊重游戏开发商劳动成果，合理体验后请前往 Steam 官方支持正版。</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { EnvironmentDiagnosticResult } from '../../types';

const emit = defineEmits<{
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
  (e: 'refresh-status'): void;
  (e: 'relaunch-wizard'): void;
}>();

const steamPathInput = ref('');
const manifestApi = ref<'opensteamtool' | 'steamrun' | 'wudrm'>('opensteamtool');
const deploying = ref(false);
const refreshing = ref(false);
const checkingHealth = ref(false);
const healthResult = ref<EnvironmentDiagnosticResult | null>(null);

const dbStats = ref({
  gamesCount: 0,
  keysCount: 0,
  lastUpdated: '连接中...',
  serverStatus: 'offline'
});

const getOverallStatusBadgeClass = (status: 'ready' | 'partial' | 'error') => {
  if (status === 'ready') return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40';
  if (status === 'partial') return 'bg-amber-500/20 text-amber-300 border border-amber-500/40';
  return 'bg-rose-500/20 text-rose-300 border border-rose-500/40';
};

const getOverallStatusText = (status: 'ready' | 'partial' | 'error') => {
  if (status === 'ready') return '● 环境配置完美就绪';
  if (status === 'partial') return '● 部分项目待优化';
  return '● 存在配置异常';
};

const getItemBorderClass = (status: 'success' | 'warning' | 'error') => {
  if (status === 'success') return 'border-emerald-500/30 hover:border-emerald-500/50';
  if (status === 'warning') return 'border-amber-500/30 hover:border-amber-500/50';
  return 'border-rose-500/40 hover:border-rose-500/60';
};

const getStatusIcon = (status: 'success' | 'warning' | 'error') => {
  if (status === 'success') return '✅';
  if (status === 'warning') return '⚠️';
  return '❌';
};

const getStatusBadgeClass = (status: 'success' | 'warning' | 'error') => {
  if (status === 'success') return 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20';
  if (status === 'warning') return 'bg-amber-500/10 text-amber-300 border border-amber-500/20';
  return 'bg-rose-500/10 text-rose-300 border border-rose-500/20';
};

const runEnvironmentHealthCheck = async () => {
  checkingHealth.value = true;
  try {
    const res = await window.electronAPI.checkEnvironmentHealth();
    if (res) {
      healthResult.value = res;
    }
  } catch (e: any) {
    emit('notify', `环境体检失败: ${e.message}`, 'error');
  } finally {
    checkingHealth.value = false;
  }
};

const handleQuickFix = async () => {
  deploying.value = true;
  try {
    const res = await window.electronAPI.ensureOSTEnv({
      manifestApi: manifestApi.value
    });
    if (res.success) {
      emit('notify', res.message, 'success');
      await runEnvironmentHealthCheck();
      emit('refresh-status');
    } else {
      emit('notify', res.message, 'error');
    }
  } catch (e: any) {
    emit('notify', `一键修复失败: ${e.message}`, 'error');
  } finally {
    deploying.value = false;
  }
};

const handleRestartSteamQuick = async () => {
  try {
    emit('notify', '正在安全重启 Steam 客户端...', 'info');
    await window.electronAPI.restartSteam();
    emit('notify', 'Steam 客户端已重新启动！', 'success');
    await runEnvironmentHealthCheck();
    emit('refresh-status');
  } catch (e: any) {
    emit('notify', `重启 Steam 失败: ${e.message}`, 'error');
  }
};

const loadDbStats = async () => {
  refreshing.value = true;
  try {
    const stats = await window.electronAPI.getDatabaseStats();
    if (stats) {
      dbStats.value = stats;
      if (stats.serverStatus === 'online') {
        emit('notify', '已成功连接 SteamMaster 商业版云端数据引擎！', 'success');
      }
    }
  } catch {
    // ignore
  } finally {
    refreshing.value = false;
  }
};

const loadEnvInfo = async () => {
  try {
    const info = await window.electronAPI.getSteamInfo();
    if (info.steamPath) {
      steamPathInput.value = info.steamPath;
    }
  } catch {
    // ignore
  }
};

const handleBrowseSteamPath = async () => {
  try {
    const selected = await window.electronAPI.selectDirectory();
    if (selected) {
      steamPathInput.value = selected;
    }
  } catch (e: any) {
    emit('notify', `选择失败: ${e.message}`, 'error');
  }
};

const handleSaveSteamPath = async () => {
  if (!steamPathInput.value) return;
  try {
    await window.electronAPI.setSteamPath(steamPathInput.value);
    emit('notify', 'Steam 路径已更新并保存！', 'success');
    await runEnvironmentHealthCheck();
    emit('refresh-status');
  } catch (e: any) {
    emit('notify', `保存失败: ${e.message}`, 'error');
  }
};

const handleDeployOSTEnv = async () => {
  deploying.value = true;
  try {
    const res = await window.electronAPI.ensureOSTEnv({
      manifestApi: manifestApi.value
    });
    if (res.success) {
      emit('notify', res.message, 'success');
      await runEnvironmentHealthCheck();
      emit('refresh-status');
    } else {
      emit('notify', res.message, 'error');
    }
  } catch (e: any) {
    emit('notify', `配置异常: ${e.message}`, 'error');
  } finally {
    deploying.value = false;
  }
};

onMounted(() => {
  loadEnvInfo();
  loadDbStats();
  runEnvironmentHealthCheck();
});
</script>
