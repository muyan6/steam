<template>
  <div class="h-full flex flex-col p-6 overflow-y-auto">
    <!-- 标题 -->
    <div class="mb-6">
      <h2 class="text-xl font-bold text-slate-100 flex items-center gap-2.5">
        <Settings2 class="w-6 h-6 theme-text-accent" />
        <span>系统设置与运行环境体检</span>
      </h2>
      <p class="text-xs text-slate-400 mt-1">
        自定义软件主题外观、深度体检 Steam 客户端环境、OpenSteamTool 注入内核及云端数据引擎连接状态
      </p>
    </div>

    <div class="space-y-6 max-w-4xl pb-10">
      <!-- 0. 界面外观与主题配色 (包含 3 款深色 + 3 款浅色共 6 种精选配色) -->
      <div class="theme-card-static rounded-3xl p-5 shadow-lg border">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div class="flex items-center gap-2">
            <Palette class="w-4 h-4 theme-text-accent" />
            <h3 class="font-bold text-sm text-slate-200">界面外观与主题配色</h3>
            <span class="text-[10px] px-2.5 py-0.5 rounded-full bg-slate-800/80 text-slate-300 font-mono border border-white/10 font-bold">
              6 种精选配色 (3深 + 3浅)
            </span>
          </div>

          <!-- 深浅分类过滤切换 -->
          <div class="flex items-center gap-1 bg-slate-950/40 p-1 rounded-xl border border-white/10 text-xs">
            <button
              @click="themeFilter = 'all'"
              class="px-2.5 py-1 rounded-lg transition font-medium text-[11px]"
              :class="themeFilter === 'all' ? 'theme-btn-primary font-bold shadow-sm' : 'text-slate-400 hover:text-slate-200'"
            >
              全部 (6)
            </button>
            <button
              @click="themeFilter = 'dark'"
              class="px-2.5 py-1 rounded-lg transition font-medium text-[11px] flex items-center gap-1"
              :class="themeFilter === 'dark' ? 'theme-btn-primary font-bold shadow-sm' : 'text-slate-400 hover:text-slate-200'"
            >
              <Moon class="w-3 h-3" />
              <span>深色 (3)</span>
            </button>
            <button
              @click="themeFilter = 'light'"
              class="px-2.5 py-1 rounded-lg transition font-medium text-[11px] flex items-center gap-1"
              :class="themeFilter === 'light' ? 'theme-btn-primary font-bold shadow-sm' : 'text-slate-400 hover:text-slate-200'"
            >
              <Sun class="w-3 h-3" />
              <span>浅色 (3)</span>
            </button>
          </div>
        </div>

        <p class="text-xs text-slate-400 mb-4 leading-relaxed">
          提供针对现代游戏桌面端设计的专属高质感主题，涵盖深空钛金、赛博紫晶、铂金翡翠以及全新皓月霜白、香槟晨曦与森林薄荷：
        </p>

        <!-- 6 款主题选择卡片网格 -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          <div
            v-for="theme in filteredThemes"
            :key="theme.id"
            @click="handleSelectTheme(theme.id)"
            class="p-4 rounded-2xl border transition-all duration-200 cursor-pointer relative overflow-hidden group flex flex-col justify-between"
            :class="currentTheme === theme.id 
              ? 'ring-2 ring-offset-2 ring-offset-transparent shadow-xl' 
              : 'theme-card hover:-translate-y-0.5 hover:shadow-md'"
            :style="currentTheme === theme.id ? { borderColor: theme.accentHex, backgroundColor: theme.cardHex } : {}"
          >
            <div>
              <!-- 色彩调色板预览圆点 & 深浅模式标签 + 当前使用徽章 (流式排版，完全并列不重叠) -->
              <div class="flex items-center justify-between mb-3 gap-2">
                <div class="flex items-center gap-1.5 shrink-0">
                  <span class="w-4 h-4 rounded-full border border-black/10 shadow-sm" :style="{ backgroundColor: theme.bgHex }" title="背景色"></span>
                  <span class="w-4 h-4 rounded-full border border-black/10 shadow-sm" :style="{ backgroundColor: theme.cardHex }" title="卡片色"></span>
                  <span class="w-4 h-4 rounded-full border border-black/10 shadow-sm" :style="{ backgroundColor: theme.accentHex }" title="高亮主色"></span>
                  <span class="w-4 h-4 rounded-full border border-black/10 shadow-sm" :style="{ backgroundColor: theme.secondaryHex }" title="辅助渐变色"></span>
                </div>

                <div class="flex items-center gap-1.5 flex-wrap justify-end">
                  <span 
                    class="text-[10px] px-2 py-0.5 rounded-full font-mono flex items-center gap-1 border shrink-0"
                    :class="theme.type === 'dark' ? 'bg-slate-800/80 text-slate-300 border-white/10' : 'bg-amber-500/10 text-amber-600 border-amber-500/20 font-bold'"
                  >
                    <Moon v-if="theme.type === 'dark'" class="w-2.5 h-2.5" />
                    <Sun v-else class="w-2.5 h-2.5 text-amber-500" />
                    <span>{{ theme.type === 'dark' ? '深色' : '浅色' }}</span>
                  </span>

                  <!-- 当前使用徽章 -->
                  <span 
                    v-if="currentTheme === theme.id"
                    class="text-[10px] font-bold px-2 py-0.5 rounded-full shadow flex items-center gap-1 shrink-0"
                    :style="{ backgroundColor: theme.accentHex, color: '#ffffff' }"
                  >
                    <Check class="w-3 h-3 stroke-[3]" />
                    <span>当前使用</span>
                  </span>
                </div>
              </div>

              <!-- 主题名称 -->
              <div class="font-bold text-sm text-slate-100 flex items-center gap-1.5 mb-1">
                <span>{{ theme.name }}</span>
                <span class="text-[10px] font-mono text-slate-400 font-normal">({{ theme.nameEn }})</span>
              </div>

              <!-- 主题描述 -->
              <p class="text-[11px] text-slate-400 leading-relaxed">
                {{ theme.description }}
              </p>
            </div>

            <div class="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-[11px]">
              <span class="font-mono text-slate-400">#{{ theme.id }}</span>
              <span 
                class="font-medium group-hover:underline flex items-center gap-1"
                :style="{ color: theme.accentHex }"
              >
                {{ currentTheme === theme.id ? '已应用' : '点击切换 ➔' }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 1. 运行环境完整度与注入健康体检面板 -->
      <div class="theme-card-static rounded-3xl p-5 shadow-lg border transition-all duration-300">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2.5 flex-wrap">
            <Activity class="w-4 h-4 theme-text-accent" />
            <h3 class="font-bold text-sm text-slate-200">运行环境健康度体检</h3>
            <span
              v-if="healthResult"
              class="px-2.5 py-0.5 rounded-full text-[11px] font-bold transition"
              :class="getOverallStatusBadgeClass(healthResult.overallStatus)"
            >
              {{ getOverallStatusText(healthResult.overallStatus) }}
            </span>
            <span v-if="abnormalItemsCount > 0 && filterMode === 'issues_only'" class="text-[11px] text-amber-400 font-medium flex items-center gap-1">
              <AlertTriangle class="w-3.5 h-3.5" />
              <span>发现 {{ abnormalItemsCount }} 项异常待处理</span>
            </span>
          </div>

          <div class="flex items-center gap-2">
            <!-- 手动展开/折叠全部项切换按钮 -->
            <button
              v-if="healthResult && !checkingHealth"
              @click="toggleManualExpand"
              class="px-2.5 py-1 text-slate-400 hover:text-slate-200 text-xs transition flex items-center gap-1 rounded-lg hover:bg-slate-800/60"
            >
              <span>{{ isExpandedView ? '收起详情 ▴' : '展开详情 ▾' }}</span>
            </button>

            <!-- 开始检测主按钮 -->
            <button
              @click="handleStartHealthCheck"
              :disabled="checkingHealth"
              class="theme-btn-primary px-3.5 py-1.5 text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow"
            >
              <RotateCw class="w-3.5 h-3.5" :class="{ 'animate-spin': checkingHealth }" />
              <span>{{ checkingHealth ? '正在全面体检...' : '开始全面检测' }}</span>
            </button>
          </div>
        </div>

        <p class="text-xs text-slate-400 mt-2 mb-3 leading-relaxed">
          全面检测 Steam 根路径有效性、OpenSteam 核心 Hook 模块 (DLL)、toml 注入配置文件以及运行时内存挂载状态。
        </p>

        <!-- 正常折叠时的清爽简报卡片 -->
        <div
          v-if="healthResult && !isExpandedView && healthResult.overallStatus === 'ready'"
          class="p-3.5 rounded-2xl bg-emerald-950/20 border border-emerald-500/30 flex items-center justify-between mb-3 text-xs"
        >
          <div class="flex items-center gap-2 text-emerald-300">
            <CheckCircle2 class="w-4 h-4 shrink-0 text-emerald-400" />
            <span class="font-medium">各项指标检测完毕：Steam 路径、64位架构、Hook DLL、配置文件及规则引擎全部正常就绪。</span>
          </div>
          <button @click="toggleManualExpand" class="text-[11px] text-sky-400 hover:text-sky-300 underline font-mono shrink-0 ml-2">
            查看详情 ({{ healthResult.items.length }}项)
          </button>
        </div>

        <!-- 存在异常时的精简提醒条 -->
        <div
          v-if="healthResult && isExpandedView && filterMode === 'issues_only' && abnormalItemsCount > 0"
          class="p-2.5 rounded-2xl bg-amber-950/20 border border-amber-500/30 flex items-center justify-between mb-3 text-xs"
        >
          <span class="text-amber-300 font-medium flex items-center gap-1.5">
            <AlertTriangle class="w-3.5 h-3.5" />
            <span>以下是检测到需要处理的异常项目（已自动精简展示）：</span>
          </span>
          <button @click="filterMode = 'all'" class="text-[11px] text-sky-400 hover:text-sky-300 underline shrink-0 ml-2">
            查看全部项目 (含正常项)
          </button>
        </div>

        <!-- 展开时的检测项目列表 -->
        <div v-if="isExpandedView && displayedItems.length > 0" class="space-y-2.5 mb-3 transition-all">
          <div
            v-for="(item, idx) in displayedItems"
            :key="idx"
            class="p-3.5 rounded-2xl bg-slate-900/70 border flex items-start justify-between gap-3 transition"
            :class="getItemBorderClass(item.status)"
          >
            <div class="flex items-start gap-3 min-w-0">
              <component 
                :is="getStatusIconComponent(item.status)" 
                class="w-4 h-4 mt-0.5 shrink-0" 
                :class="getStatusColorClass(item.status)" 
              />
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-bold text-xs text-slate-200">{{ item.name }}</span>
                  <span class="text-[10px] px-2 py-0.5 rounded-full font-mono" :class="getStatusBadgeClass(item.status)">
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
                <Zap class="w-3 h-3" />
                <span>一键修复</span>
              </button>
              <button
                v-else-if="item.category === 'process'"
                @click="handleRestartSteamQuick"
                class="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold rounded-lg transition shadow flex items-center gap-1"
              >
                <RotateCw class="w-3 h-3" />
                <span>重启 Steam</span>
              </button>
            </div>
          </div>
        </div>

        <div v-if="healthResult" class="text-[11px] text-slate-400 flex items-center justify-between pt-2.5 border-t border-slate-800/80">
          <span>体检结论：<strong class="text-slate-300">{{ healthResult.summary }}</strong></span>
          <span class="font-mono text-slate-400">检测时间：{{ healthResult.checkedAt }}</span>
        </div>
      </div>

      <!-- 2. 云端数据库连接面板 -->
      <div class="theme-card-static rounded-3xl p-5 shadow-lg border">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <Cloud class="w-4 h-4 theme-text-accent" />
            <h3 class="font-bold text-sm text-slate-200">云端高速数据引擎</h3>
            <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border" :class="dbStats.serverStatus === 'online' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border-amber-500/20'">
              {{ dbStats.serverStatus === 'online' ? '● 云端已连接' : '● 本地离线模式' }}
            </span>
          </div>
          <span class="text-xs text-slate-400">{{ dbStats.lastUpdated }}</span>
        </div>

        <p class="text-xs text-slate-400 mb-4 leading-relaxed">
          商业版专属云端后端承载全量 18 万+ 游戏数据库与 28.8 万+ DepotKey 密钥库，毫秒级响应中文拼音检索与一键入库，无需消耗本地电脑存储。
        </p>

        <!-- 统计指标卡片 -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
          <div class="p-4 rounded-2xl bg-slate-900/60 border border-white/10 flex items-center justify-between">
            <div>
              <div class="text-xs text-slate-400 flex items-center gap-1.5">
                <Database class="w-3.5 h-3.5 text-sky-400" />
                <span>云端已收录游戏总量</span>
              </div>
              <div class="text-xl font-mono font-bold text-sky-400 mt-1">
                {{ dbStats.gamesCount > 0 ? dbStats.gamesCount.toLocaleString() + ' 款' : '180,000+ 款' }}
              </div>
            </div>
            <button
              @click="loadDbStats"
              :disabled="refreshing"
              class="theme-btn-primary px-3.5 py-2 disabled:opacity-50 text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow"
            >
              <RotateCw class="w-3.5 h-3.5" :class="{ 'animate-spin': refreshing }" />
              <span>{{ refreshing ? '检测中...' : '刷新云端状态' }}</span>
            </button>
          </div>

          <div class="p-4 rounded-2xl bg-slate-900/60 border border-white/10 flex items-center justify-between">
            <div>
              <div class="text-xs text-slate-400 flex items-center gap-1.5">
                <Key class="w-3.5 h-3.5 text-emerald-400" />
                <span>云端收录 DepotKey 密钥</span>
              </div>
              <div class="text-xl font-mono font-bold text-emerald-400 mt-1">
                {{ dbStats.keysCount > 0 ? dbStats.keysCount.toLocaleString() + ' 条' : '288,000+ 条' }}
              </div>
            </div>
            <div class="text-xs text-emerald-400 flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/10 border border-emerald-500/20 font-bold">
              <Zap class="w-3.5 h-3.5" />
              <span>实时云端下发</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Steam 安装路径设置 -->
      <div class="theme-card-static rounded-3xl p-5 shadow-lg border">
        <div class="flex items-center gap-2 mb-3">
          <Folder class="w-4 h-4 theme-text-accent" />
          <h3 class="font-bold text-sm text-slate-200">Steam 本地客户端路径</h3>
        </div>
        <div class="flex items-center gap-3">
          <input
            v-model="steamPathInput"
            type="text"
            placeholder="自动从注册表探测，或点击右侧浏览手动选择..."
            class="flex-1 bg-slate-900/90 border border-white/10 rounded-2xl px-4 py-2.5 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/50"
          />
          <button
            @click="handleBrowseSteamPath"
            class="px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700 border border-white/10 rounded-2xl text-xs text-slate-200 font-medium transition flex items-center gap-1.5"
          >
            <FolderOpen class="w-3.5 h-3.5 text-slate-300" />
            <span>浏览路径</span>
          </button>
          <button
            @click="handleSaveSteamPath"
            class="theme-btn-primary px-4 py-2.5 text-xs font-bold rounded-2xl transition flex items-center gap-1.5"
          >
            <Save class="w-3.5 h-3.5" />
            <span>保存并检测</span>
          </button>
        </div>
      </div>

      <!-- 4. OpenSteamTool 内核与公共清单源设置 -->
      <div class="theme-card-static rounded-3xl p-5 shadow-lg border">
        <div class="flex items-center gap-2 mb-3">
          <Globe class="w-4 h-4 theme-text-accent" />
          <h3 class="font-bold text-sm text-slate-200">公共清单 (Manifest) 上游 API 端点配置</h3>
        </div>
        <p class="text-xs text-slate-400 mb-4 leading-relaxed">
          OpenSteamTool 会在入库未拥有游戏时，自动向以下公用端点获取加密清单请求码 (GMRC)，解决个人服务器带宽限制。
        </p>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div
            @click="manifestApi = 'steamrun'"
            class="p-3.5 rounded-2xl border transition cursor-pointer"
            :class="manifestApi === 'steamrun' ? 'bg-sky-500/10 border-sky-500/60 ring-1 ring-sky-500/50' : 'theme-card hover:border-sky-500/30'"
          >
            <div class="font-bold text-xs text-slate-200 mb-1 flex items-center gap-1.5">
              <span>SteamRun 镜像源</span>
              <span class="text-[9px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-400 font-bold border border-sky-500/30">推荐</span>
            </div>
            <div class="text-[11px] text-slate-400 font-mono break-all">manifest.steam.run</div>
          </div>

          <div
            @click="manifestApi = 'wudrm'"
            class="p-3.5 rounded-2xl border transition cursor-pointer"
            :class="manifestApi === 'wudrm' ? 'bg-sky-500/10 border-sky-500/60 ring-1 ring-sky-500/50' : 'theme-card hover:border-sky-500/30'"
          >
            <div class="font-bold text-xs text-slate-200 mb-1">WUDRM 国内高速源</div>
            <div class="text-[11px] text-slate-400 font-mono break-all">gmrc.wudrm.com</div>
          </div>

          <div
            @click="manifestApi = 'opensteamtool'"
            class="p-3.5 rounded-2xl border transition cursor-pointer"
            :class="manifestApi === 'opensteamtool' ? 'bg-sky-500/10 border-sky-500/60 ring-1 ring-sky-500/50' : 'theme-card hover:border-sky-500/30'"
          >
            <div class="font-bold text-xs text-slate-200 mb-1">OpenSteamTool 备用源</div>
            <div class="text-[11px] text-slate-400 font-mono break-all">opensteamtool.com</div>
          </div>
        </div>

        <div class="flex items-center justify-between pt-3 border-t border-white/10">
          <div class="flex items-center gap-2">
            <button
              @click="emit('relaunch-wizard')"
              class="px-3.5 py-2 bg-slate-800/80 hover:bg-slate-700 border border-white/10 rounded-2xl text-xs text-sky-400 font-medium transition flex items-center gap-1.5"
            >
              <Sparkles class="w-3.5 h-3.5" />
              <span>重新运行注入向导</span>
            </button>
            <button
              @click="handleUninstallOST"
              :disabled="deploying"
              class="px-3 py-2 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 rounded-2xl text-xs font-medium transition flex items-center gap-1.5"
            >
              <Trash2 class="w-3.5 h-3.5" />
              <span>卸载注入</span>
            </button>
          </div>
          <button
            @click="handleDeployOSTEnv"
            :disabled="deploying"
            class="theme-btn-primary px-4 py-2 disabled:opacity-50 text-xs font-bold rounded-2xl shadow transition flex items-center gap-1.5"
          >
            <Zap class="w-3.5 h-3.5" />
            <span>{{ deploying ? '正在写入...' : '一键同步/重建环境' }}</span>
          </button>
        </div>
      </div>

      <!-- 5. 安全免责与防杀软提示 -->
      <div class="rounded-3xl p-5 bg-slate-900/40 border border-white/10">
        <h3 class="font-bold text-xs text-amber-500 mb-2 flex items-center gap-1.5">
          <ShieldAlert class="w-4 h-4 text-amber-500" />
          <span>安全提示与杀毒软件白名单说明</span>
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
import { ref, computed, onMounted } from 'vue';
import { 
  Settings2, 
  Palette, 
  Check, 
  Activity, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  RotateCw, 
  Cloud, 
  Database, 
  Key, 
  Zap, 
  Folder, 
  FolderOpen, 
  Save, 
  Globe, 
  Sparkles, 
  Trash2, 
  ShieldAlert,
  Moon,
  Sun
} from 'lucide-vue-next';
import { EnvironmentDiagnosticResult, EnvironmentCheckItem, AppThemeId } from '../../types';
import { useTheme } from '../composables/useTheme';

const emit = defineEmits<{
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
  (e: 'refresh-status'): void;
  (e: 'relaunch-wizard'): void;
}>();

const { currentTheme, THEME_LIST, setTheme } = useTheme();

const themeFilter = ref<'all' | 'dark' | 'light'>('all');

const filteredThemes = computed(() => {
  if (themeFilter.value === 'all') return THEME_LIST;
  return THEME_LIST.filter(t => t.type === themeFilter.value);
});

const steamPathInput = ref('');
const manifestApi = ref<'opensteamtool' | 'steamrun' | 'wudrm'>('steamrun');
const deploying = ref(false);
const refreshing = ref(false);
const checkingHealth = ref(false);
const healthResult = ref<EnvironmentDiagnosticResult | null>(null);

// 缩放与精简展示状态控制
const isExpandedView = ref(false);
const filterMode = ref<'all' | 'issues_only' | 'collapsed'>('collapsed');

const dbStats = ref({
  gamesCount: 0,
  keysCount: 0,
  lastUpdated: '连接中...',
  serverStatus: 'offline'
});

const handleSelectTheme = (themeId: AppThemeId) => {
  setTheme(themeId);
  const matched = THEME_LIST.find(t => t.id === themeId);
  emit('notify', `已切换至「${matched?.name || themeId}」${matched?.type === 'light' ? '浅色' : '深色'}主题！`, 'success');
};

const abnormalItemsCount = computed(() => {
  if (!healthResult.value) return 0;
  return healthResult.value.items.filter((i: EnvironmentCheckItem) => i.status !== 'success').length;
});

const displayedItems = computed(() => {
  if (!healthResult.value) return [];
  if (filterMode.value === 'issues_only') {
    return healthResult.value.items.filter((i: EnvironmentCheckItem) => i.status !== 'success');
  }
  return healthResult.value.items;
});

const toggleManualExpand = () => {
  if (isExpandedView.value) {
    isExpandedView.value = false;
    filterMode.value = 'collapsed';
  } else {
    isExpandedView.value = true;
    filterMode.value = 'all';
  }
};

const getOverallStatusBadgeClass = (status: 'ready' | 'partial' | 'error') => {
  if (status === 'ready') return 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30';
  if (status === 'partial') return 'bg-amber-500/10 text-amber-300 border border-amber-500/30';
  return 'bg-rose-500/10 text-rose-300 border border-rose-500/30';
};

const getOverallStatusText = (status: 'ready' | 'partial' | 'error') => {
  if (status === 'ready') return '● 环境配置就绪';
  if (status === 'partial') return '● 部分待优化';
  return '● 存在配置异常';
};

const getItemBorderClass = (status: 'success' | 'warning' | 'error') => {
  if (status === 'success') return 'border-emerald-500/20 hover:border-emerald-500/40';
  if (status === 'warning') return 'border-amber-500/30 hover:border-amber-500/50';
  return 'border-rose-500/30 hover:border-rose-500/50';
};

const getStatusIconComponent = (status: 'success' | 'warning' | 'error') => {
  if (status === 'success') return CheckCircle2;
  if (status === 'warning') return AlertTriangle;
  return XCircle;
};

const getStatusColorClass = (status: 'success' | 'warning' | 'error') => {
  if (status === 'success') return 'text-emerald-400';
  if (status === 'warning') return 'text-amber-400';
  return 'text-rose-400';
};

const getStatusBadgeClass = (status: 'success' | 'warning' | 'error') => {
  if (status === 'success') return 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20';
  if (status === 'warning') return 'bg-amber-500/10 text-amber-300 border border-amber-500/20';
  return 'bg-rose-500/10 text-rose-300 border border-rose-500/20';
};

const handleStartHealthCheck = async () => {
  checkingHealth.value = true;
  isExpandedView.value = true;
  filterMode.value = 'all';

  try {
    const startTime = Date.now();
    const res = await window.electronAPI.checkEnvironmentHealth();
    
    const elapsed = Date.now() - startTime;
    if (elapsed < 500) {
      await new Promise(r => setTimeout(r, 500 - elapsed));
    }

    if (res) {
      healthResult.value = res;
      const hasIssues = res.overallStatus !== 'ready' || res.items.some((i: EnvironmentCheckItem) => i.status !== 'success');

      if (hasIssues) {
        filterMode.value = 'issues_only';
        isExpandedView.value = true;
        emit('notify', `体检完成：检测到 ${abnormalItemsCount.value} 项待优化配置`, 'warning');
      } else {
        await new Promise(r => setTimeout(r, 800));
        isExpandedView.value = false;
        filterMode.value = 'collapsed';
        emit('notify', '体检完成：运行环境各项指标完美就绪！', 'success');
      }
    }
  } catch (e: any) {
    emit('notify', `环境体检失败: ${e.message}`, 'error');
  } finally {
    checkingHealth.value = false;
  }
};

const runEnvironmentHealthCheck = async (silent: boolean = false) => {
  try {
    const res = await window.electronAPI.checkEnvironmentHealth();
    if (res) {
      healthResult.value = res;
      const hasIssues = res.overallStatus !== 'ready' || res.items.some((i: EnvironmentCheckItem) => i.status !== 'success');
      if (hasIssues) {
        filterMode.value = 'issues_only';
        isExpandedView.value = true;
      } else {
        filterMode.value = 'collapsed';
        isExpandedView.value = false;
      }
    }
  } catch (e: any) {
    if (!silent) emit('notify', `环境体检失败: ${e.message}`, 'error');
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
      await handleStartHealthCheck();
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
        emit('notify', '已成功连接 春风渡 商业版云端数据引擎！', 'success');
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

const handleUninstallOST = async () => {
  if (!confirm('确定要卸载 OpenSteamTool 核心注入组件吗？')) {
    return;
  }
  deploying.value = true;
  try {
    const res = await window.electronAPI.uninstallInjection();
    if (res.success) {
      emit('notify', res.message, 'success');
      await runEnvironmentHealthCheck();
      emit('refresh-status');
    }
  } catch (e: any) {
    emit('notify', `卸载异常: ${e.message}`, 'error');
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
