<template>
  <div class="h-full flex flex-col p-6 xl:p-8 overflow-y-auto">
    <!-- 标题 -->
    <div class="mb-6">
      <h2 class="text-2xl font-bold text-slate-100 flex items-center gap-3">
        <Settings2 class="w-7 h-7 theme-text-accent" />
        <span>系统设置与运行环境体检</span>
      </h2>
      <p class="text-sm text-slate-400 mt-1">
        自定义软件主题外观、界面字体自适应缩放、深度体检 Steam 客户端环境及云端数据引擎连接状态
      </p>
    </div>

    <div class="space-y-6 w-full max-w-5xl xl:max-w-6xl pb-10">
      <!-- 1. 界面个性化与显示 (缩放 + 主题合并) -->
      <div class="theme-card-static rounded-2xl p-4 xl:p-5 shadow-sm border space-y-4">
        <!-- 头部：标题与综合状态 -->
        <div class="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-white/5">
          <div class="flex items-center gap-2">
            <Palette class="w-4 h-4 theme-text-accent" />
            <h3 class="font-bold text-sm text-slate-100">界面个性化与显示</h3>
            <span class="text-[11px] px-2 py-0.5 rounded-full bg-slate-800/80 text-slate-300 font-mono border border-white/10">
              倍率: {{ Math.round((uiScaleState?.computedZoomValue.value || 1) * 100) }}% · {{ filteredThemes.length }} 款精选配色
            </span>
          </div>
          <div class="text-[11px] text-slate-400 font-mono bg-slate-950/40 px-2.5 py-0.5 rounded-lg border border-white/5">
            窗口分辨率: {{ uiScaleState?.windowResolution.value.width }} × {{ uiScaleState?.windowResolution.value.height }} px
          </div>
        </div>

        <!-- 缩放档位选择 -->
        <div>
          <div class="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
            <ZoomIn class="w-3.5 h-3.5 text-sky-400" />
            <span>界面自适应与文字缩放</span>
          </div>
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
            <button
              v-for="opt in scaleOptions"
              :key="opt.id"
              @click="uiScaleState?.setUiScale(opt.id)"
              class="p-2 rounded-xl border transition-all text-center flex flex-col items-center justify-center gap-0.5 group cursor-pointer"
              :class="uiScaleState?.currentUiScale.value === opt.id
                ? 'theme-btn-primary font-bold shadow-md ring-2 ring-offset-1 ring-offset-transparent'
                : 'theme-card hover:border-sky-400/40 hover:-translate-y-0.5'"
            >
              <span class="text-xs font-bold">{{ opt.label }}</span>
              <span class="text-[10px] opacity-75 font-mono">{{ opt.desc }}</span>
            </button>
          </div>
        </div>

        <!-- 主题配色切换 -->
        <div class="pt-3 border-t border-white/5">
          <div class="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div class="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Sparkles class="w-3.5 h-3.5 text-amber-400" />
              <span>精选质感主题</span>
            </div>
            <!-- 深浅分类过滤切换 -->
            <div class="flex items-center gap-1 bg-slate-950/40 p-0.5 rounded-xl border border-white/10 text-xs">
              <button
                @click="themeFilter = 'all'"
                class="px-2 py-0.5 rounded-lg transition font-medium text-[11px]"
                :class="themeFilter === 'all' ? 'theme-btn-primary font-bold shadow-sm' : 'text-slate-400 hover:text-slate-200'"
              >
                全部 (6)
              </button>
              <button
                @click="themeFilter = 'dark'"
                class="px-2 py-0.5 rounded-lg transition font-medium text-[11px] flex items-center gap-1"
                :class="themeFilter === 'dark' ? 'theme-btn-primary font-bold shadow-sm' : 'text-slate-400 hover:text-slate-200'"
              >
                <Moon class="w-3 h-3" />
                <span>深色 (3)</span>
              </button>
              <button
                @click="themeFilter = 'light'"
                class="px-2 py-0.5 rounded-lg transition font-medium text-[11px] flex items-center gap-1"
                :class="themeFilter === 'light' ? 'theme-btn-primary font-bold shadow-sm' : 'text-slate-400 hover:text-slate-200'"
              >
                <Sun class="w-3 h-3" />
                <span>浅色 (3)</span>
              </button>
            </div>
          </div>

          <!-- 6 款精选主题紧凑网格 -->
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
            <button
              v-for="theme in filteredThemes"
              :key="theme.id"
              @click="handleSelectTheme(theme.id)"
              :title="`${theme.name} (${theme.nameEn}): ${theme.description}`"
              class="p-2 rounded-xl border transition-all text-left flex flex-col justify-between relative group cursor-pointer overflow-hidden"
              :class="currentTheme === theme.id 
                ? 'ring-2 ring-offset-1 ring-offset-transparent shadow-md font-bold' 
                : 'theme-card hover:border-sky-400/40 hover:-translate-y-0.5'"
              :style="currentTheme === theme.id ? { borderColor: theme.accentHex, backgroundColor: theme.cardHex } : {}"
            >
              <div class="flex items-center justify-between gap-1 mb-1.5">
                <div class="flex items-center gap-1">
                  <span class="w-2.5 h-2.5 rounded-full border border-black/20 shrink-0" :style="{ backgroundColor: theme.bgHex }" title="背景色"></span>
                  <span class="w-2.5 h-2.5 rounded-full border border-black/20 shrink-0" :style="{ backgroundColor: theme.cardHex }" title="卡片色"></span>
                  <span class="w-2.5 h-2.5 rounded-full border border-black/20 shrink-0" :style="{ backgroundColor: theme.accentHex }" title="主强调色"></span>
                </div>
                <span 
                  class="text-[9.5px] px-1 py-0.2 rounded font-mono shrink-0"
                  :class="theme.type === 'dark' ? 'bg-slate-800/80 text-slate-400' : 'bg-amber-500/15 text-amber-500 font-bold'"
                >
                  {{ theme.type === 'dark' ? '深' : '浅' }}
                </span>
              </div>
              <div class="flex items-center justify-between gap-1">
                <div class="font-bold text-xs truncate text-slate-100">
                  {{ theme.name }}
                </div>
                <Check v-if="currentTheme === theme.id" class="w-3.5 h-3.5 shrink-0 stroke-[3]" :style="{ color: theme.accentHex }" />
              </div>
              <div 
                class="text-[9.5px] mt-0.5 font-mono truncate"
                :style="{ color: currentTheme === theme.id ? theme.accentHex : '#94a3b8' }"
              >
                {{ currentTheme === theme.id ? '● 已应用' : '#' + theme.id }}
              </div>
            </button>
          </div>
        </div>
      </div>

      <!-- 2. Steam 客户端本地环境与核心引擎 (路径 + 注入运维 + 健康体检闭环) -->
      <div class="theme-card-static rounded-2xl p-4 xl:p-5 shadow-sm border space-y-4">
        <!-- 头部：标题与状态指示 -->
        <div class="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-white/5">
          <div class="flex items-center gap-2">
            <Cpu class="w-4 h-4 theme-text-accent" />
            <h3 class="font-bold text-sm text-slate-100">Steam 客户端环境与核心引擎</h3>
            <span class="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 flex items-center gap-1.5">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>OpenSteam 核心 Hook 就绪</span>
            </span>
          </div>

          <!-- 全面检测按钮 -->
          <div class="flex items-center gap-2">
            <button
              v-if="healthResult && !checkingHealth"
              @click="toggleManualExpand"
              class="px-2.5 py-1 text-slate-400 hover:text-slate-200 text-xs font-medium transition flex items-center gap-1 rounded-lg hover:bg-slate-800/60 cursor-pointer"
            >
              <span>{{ isExpandedView ? '收起诊断 ▴' : '诊断详情 ▾' }}</span>
            </button>
            <button
              @click="handleStartHealthCheck"
              :disabled="checkingHealth"
              class="theme-btn-primary px-3.5 py-1.5 text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow cursor-pointer"
            >
              <RotateCw class="w-3.5 h-3.5" :class="{ 'animate-spin': checkingHealth }" />
              <span>{{ checkingHealth ? '正在全面体检...' : '开始全面检测' }}</span>
            </button>
          </div>
        </div>

        <!-- 1) 路径配置行 -->
        <div>
          <div class="text-xs font-semibold text-slate-300 mb-2 flex items-center gap-1.5">
            <Folder class="w-3.5 h-3.5 text-sky-400" />
            <span>Steam 本地安装根目录</span>
          </div>
          <div class="flex items-center gap-2.5">
            <input
              v-model="steamPathInput"
              type="text"
              placeholder="自动从注册表探测，或点击右侧浏览手动选择..."
              class="flex-1 bg-slate-900/90 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/50"
            />
            <button
              @click="handleBrowseSteamPath"
              class="px-3.5 py-2 bg-slate-800/80 hover:bg-slate-700 border border-white/10 rounded-xl text-xs text-slate-200 font-semibold transition flex items-center gap-1.5 cursor-pointer"
            >
              <FolderOpen class="w-3.5 h-3.5 text-slate-300" />
              <span>浏览路径</span>
            </button>
            <button
              @click="handleSaveSteamPath"
              class="theme-btn-primary px-4 py-2 text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow cursor-pointer"
            >
              <Save class="w-3.5 h-3.5" />
              <span>保存路径</span>
            </button>
          </div>
        </div>

        <!-- 2) 核心注入与运维操作快捷工具栏 -->
        <div class="p-3 rounded-xl bg-slate-900/60 border border-white/5 flex items-center justify-between flex-wrap gap-2">
          <div class="text-xs text-slate-400 flex items-center gap-1.5">
            <Zap class="w-3.5 h-3.5 text-amber-400" />
            <span>内核与 Hook 运维：入库将自动通过多级高可用容灾调度下发清单</span>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <button
              @click="emit('relaunch-wizard')"
              class="px-3 py-1.5 bg-slate-800/90 hover:bg-slate-700 border border-white/10 rounded-xl text-xs text-sky-300 font-semibold transition flex items-center gap-1.5 cursor-pointer"
            >
              <Sparkles class="w-3.5 h-3.5 text-sky-400" />
              <span>重新运行向导</span>
            </button>
            <button
              @click="handleUninstallOST"
              :disabled="deploying"
              class="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 rounded-xl text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
            >
              <Trash2 class="w-3.5 h-3.5" />
              <span>卸载注入</span>
            </button>
            <button
              @click="handleDeployOSTEnv"
              :disabled="deploying"
              class="theme-btn-primary px-3.5 py-1.5 disabled:opacity-50 text-xs font-bold rounded-xl shadow transition flex items-center gap-1.5 cursor-pointer"
            >
              <Zap class="w-3.5 h-3.5" />
              <span>{{ deploying ? '正在写入...' : '一键同步/重建环境' }}</span>
            </button>
          </div>
        </div>

        <!-- 3) 环境健康体检诊断区 (可折叠) -->
        <div class="pt-2 border-t border-white/5 space-y-2.5">
          <!-- 总体健康状态条 -->
          <div class="flex items-center justify-between text-xs flex-wrap gap-2">
            <div class="flex items-center gap-2">
              <Activity class="w-3.5 h-3.5 text-sky-400" />
              <span class="font-semibold text-slate-300">运行环境健康体检状态:</span>
              <span
                v-if="healthResult"
                class="px-2.5 py-0.5 rounded-full text-[11px] font-bold transition"
                :class="getOverallStatusBadgeClass(healthResult.overallStatus)"
              >
                {{ getOverallStatusText(healthResult.overallStatus) }}
              </span>
              <span v-if="abnormalItemsCount > 0 && filterMode === 'issues_only'" class="text-xs text-amber-400 font-semibold flex items-center gap-1">
                <AlertTriangle class="w-3.5 h-3.5" />
                <span>发现 {{ abnormalItemsCount }} 项异常待处理</span>
              </span>
            </div>

            <div v-if="healthResult" class="text-[11px] text-slate-400 font-mono">
              检测时间: {{ healthResult.checkedAt }}
            </div>
          </div>

          <!-- 正常折叠时的清爽简报卡片 -->
          <div
            v-if="healthResult && !isExpandedView && healthResult.overallStatus === 'ready'"
            class="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/30 flex items-center justify-between text-xs"
          >
            <div class="flex items-center gap-2 text-emerald-300">
              <CheckCircle2 class="w-4 h-4 shrink-0 text-emerald-400" />
              <span>各项指标全部正常：Steam 路径、64位架构、Hook DLL、配置文件及规则引擎全部就绪。</span>
            </div>
            <button @click="toggleManualExpand" class="text-xs text-sky-400 hover:text-sky-300 underline font-mono shrink-0 ml-2 cursor-pointer">
              查看诊断详情 ({{ healthResult.items.length }}项)
            </button>
          </div>

          <!-- 存在异常时的精简提醒条 -->
          <div
            v-if="healthResult && isExpandedView && filterMode === 'issues_only' && abnormalItemsCount > 0"
            class="p-3 rounded-xl bg-amber-950/20 border border-amber-500/30 flex items-center justify-between text-xs"
          >
            <span class="text-amber-300 font-semibold flex items-center gap-2">
              <AlertTriangle class="w-4 h-4" />
              <span>以下是检测到需要处理的异常项目（已自动精简展示）：</span>
            </span>
            <button @click="filterMode = 'all'" class="text-xs text-sky-400 hover:text-sky-300 underline shrink-0 ml-2 cursor-pointer">
              查看全部项目 (含正常项)
            </button>
          </div>

          <!-- 展开时的检测项目列表 -->
          <div v-if="isExpandedView && displayedItems.length > 0" class="space-y-2 transition-all">
            <div
              v-for="(item, idx) in displayedItems"
              :key="idx"
              class="p-3 rounded-xl bg-slate-900/70 border flex items-start justify-between gap-3 transition text-xs"
              :class="getItemBorderClass(item.status)"
            >
              <div class="flex items-start gap-2.5 min-w-0">
                <component 
                  :is="getStatusIconComponent(item.status)" 
                  class="w-4 h-4 mt-0.5 shrink-0" 
                  :class="getStatusColorClass(item.status)" 
                />
                <div class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="font-bold text-slate-100">{{ item.name }}</span>
                    <span class="text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold" :class="getStatusBadgeClass(item.status)">
                      {{ item.message }}
                    </span>
                  </div>
                  <p v-if="item.detail" class="text-[11px] text-slate-400 mt-1 font-mono break-all leading-relaxed">
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
                  class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold rounded-lg transition shadow flex items-center gap-1 cursor-pointer"
                >
                  <Zap class="w-3 h-3" />
                  <span>一键修复</span>
                </button>
                <button
                  v-else-if="item.category === 'process'"
                  @click="handleRestartSteamQuick"
                  class="px-2.5 py-1 bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold rounded-lg transition shadow flex items-center gap-1 cursor-pointer"
                >
                  <RotateCw class="w-3 h-3" />
                  <span>重启 Steam</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. 云端数据引擎与设备授权 (精简合并，消除与顶部尊享卡冗余) -->
      <div class="theme-card-static rounded-2xl p-4 xl:p-5 shadow-sm border">
        <div class="flex items-center justify-between mb-3 pb-3 border-b border-white/5 flex-wrap gap-2">
          <div class="flex items-center gap-2">
            <Cloud class="w-4 h-4 theme-text-accent" />
            <h3 class="font-bold text-sm text-slate-100">云端高速数据引擎与授权</h3>
            <span class="px-2 py-0.5 rounded-full text-[11px] font-bold border" :class="dbStats.serverStatus === 'online' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border-amber-500/20'">
              {{ dbStats.serverStatus === 'online' ? '● 云端已连接' : '● 本地离线模式' }}
            </span>
          </div>
          <span class="text-[11px] text-slate-400 font-mono">{{ dbStats.lastUpdated }}</span>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-2 gap-3.5">
          <!-- 左侧：云端引擎指标与实时状态 -->
          <div class="p-3.5 rounded-xl bg-slate-900/60 border border-white/10 flex flex-col justify-between space-y-3">
            <div class="flex items-center justify-between">
              <div class="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Database class="w-3.5 h-3.5 text-sky-400" />
                <span>商业版专属云端数据库</span>
              </div>
              <button
                @click="loadDbStats"
                :disabled="refreshing"
                class="px-2.5 py-1 text-sky-400 hover:text-sky-300 text-xs font-semibold rounded-lg hover:bg-slate-800/80 transition flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <RotateCw class="w-3 h-3" :class="{ 'animate-spin': refreshing }" />
                <span>{{ refreshing ? '检测中...' : '刷新状态' }}</span>
              </button>
            </div>

            <div class="grid grid-cols-2 gap-2 text-center">
              <div class="p-2.5 rounded-xl bg-slate-950/60 border border-white/5">
                <div class="text-[11px] text-slate-400">已收录游戏总量</div>
                <div class="text-lg font-mono font-bold text-sky-400 mt-0.5">
                  {{ dbStats.gamesCount > 0 ? dbStats.gamesCount.toLocaleString() + ' 款' : '180,000+ 款' }}
                </div>
              </div>
              <div class="p-2.5 rounded-xl bg-slate-950/60 border border-white/5">
                <div class="text-[11px] text-slate-400">已收录 DepotKey 密钥</div>
                <div class="text-lg font-mono font-bold text-emerald-400 mt-0.5">
                  {{ dbStats.keysCount > 0 ? dbStats.keysCount.toLocaleString() + ' 条' : '288,000+ 条' }}
                </div>
              </div>
            </div>
          </div>

          <!-- 右侧：设备识别码与会员授权详情 (紧凑精炼，不重复大画幅) -->
          <div class="p-3.5 rounded-xl bg-slate-900/60 border border-white/10 flex flex-col justify-between space-y-3">
            <div class="flex items-center justify-between">
              <div class="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                <Heart class="w-3.5 h-3.5 text-rose-400" />
                <span>本机硬件指纹与授权</span>
              </div>
              <button
                @click="showLicenseModal = true"
                class="theme-btn-primary px-3 py-1 text-xs font-bold rounded-lg transition flex items-center gap-1.5 shadow cursor-pointer"
              >
                <Key class="w-3 h-3" />
                <span>{{ licenseInfo.isActivated ? '更换赞助码' : '输入赞助码绑定' }}</span>
              </button>
            </div>

            <!-- 设备码与卡密紧凑展示 -->
            <div class="space-y-2 text-xs">
              <div class="flex items-center justify-between p-2 rounded-xl bg-slate-950/60 border border-white/5">
                <span class="text-slate-400 flex items-center gap-1.5">
                  <Laptop class="w-3.5 h-3.5 text-sky-400" />
                  <span>设备码:</span>
                  <code class="text-sky-300 font-mono font-bold select-all">{{ deviceId || '正在获取...' }}</code>
                </span>
                <button
                  @click="copyDeviceId"
                  class="text-sky-400 hover:text-sky-300 font-semibold cursor-pointer ml-2"
                >
                  {{ copiedDeviceId ? '已复制 ✓' : '复制' }}
                </button>
              </div>

              <div class="flex items-center justify-between px-2.5 py-1.5 rounded-xl bg-slate-950/60 border border-white/5">
                <span class="text-slate-400">授权状态:</span>
                <span
                  class="font-mono font-bold flex items-center gap-1"
                  :class="licenseInfo.isActivated ? 'text-emerald-400' : 'text-slate-400'"
                >
                  <Sparkles v-if="licenseInfo.isActivated" class="w-3 h-3 text-amber-400" />
                  <span>{{ licenseInfo.isActivated ? (licenseInfo.isLifetime ? '终身永久有效' : `赞助者 (剩 ${licenseInfo.remainingDays || 0} 天)`) : '普通用户' }}</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 4. 安全免责与防杀软提示 (轻量化底栏) -->
      <div class="rounded-2xl p-4 bg-slate-900/40 border border-white/10 text-xs">
        <div class="font-bold text-amber-500 mb-1.5 flex items-center gap-1.5">
          <ShieldAlert class="w-4 h-4 text-amber-500" />
          <span>安全提示与杀毒软件白名单说明</span>
        </div>
        <div class="text-slate-400 leading-relaxed space-y-1">
          <p>• 本工具为商业级辅助软件，代码开源透明，仅用于合法技术评测与游戏联机管理。</p>
          <p>• 由于涉及游戏本地配置优化及 DLL 接口模拟，部分安全软件可能会提示风险，建议将春风渡安装目录加入杀软信任区。</p>
          <p>• 请尊重并支持游戏开发商，合理体验后建议前往 Steam 官方平台购买支持正版。</p>
        </div>
      </div>
    </div>

    <!-- 激活码与设备绑定弹窗 -->
    <LicenseModal
      v-if="showLicenseModal"
      :license-info="licenseInfo"
      @close="showLicenseModal = false"
      @refresh="loadLicenseData(true)"
      @notify="(msg, type) => emit('notify', msg, type)"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, inject, Ref } from 'vue';
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
  Cpu, 
  Sparkles, 
  Trash2, 
  ShieldAlert,
  Moon,
  Sun,
  Heart,
  Laptop,
  ZoomIn
} from 'lucide-vue-next';
import { EnvironmentDiagnosticResult, EnvironmentCheckItem, AppThemeId, ClientLicenseInfo } from '../../types';
import { useTheme } from '../composables/useTheme';
import LicenseModal from '../components/LicenseModal.vue';
import { formatIpcError } from '../api/tauriBridge';

const emit = defineEmits<{
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
  (e: 'refresh-status'): void;
  (e: 'relaunch-wizard'): void;
}>();

const { currentTheme, THEME_LIST, setTheme } = useTheme();

// 注入全局 UI 缩放状态
const uiScaleState = inject<{
  currentUiScale: Ref<string>;
  computedZoomValue: Ref<number>;
  windowResolution: Ref<{ width: number; height: number }>;
  setUiScale: (scale: any) => void;
}>('uiScaleState');

const scaleOptions = [
  { id: 'auto', label: '🌟 智能自适应', desc: '随窗口变大自动调节' },
  { id: '100%', label: '标准 100%', desc: '紧凑原生比例' },
  { id: '105%', label: '✨ 适中 105%', desc: '默认启动比例' },
  { id: '110%', label: '放大 110%', desc: '大字舒适阅读' },
  { id: '115%', label: '大号 115%', desc: '大屏推荐模式' },
  { id: '125%', label: '超大 125%', desc: '高分屏/2K/4K' },
];

const themeFilter = ref<'all' | 'dark' | 'light'>('all');

const filteredThemes = computed(() => {
  if (themeFilter.value === 'all') return THEME_LIST;
  return THEME_LIST.filter(t => t.type === themeFilter.value);
});

const deviceId = ref('');
const copiedDeviceId = ref(false);
const showLicenseModal = ref(false);
const licenseInfo = ref<ClientLicenseInfo>({
  isActivated: false,
  status: 'unactivated',
  deviceId: ''
});

const steamPathInput = ref('');
/**
 * 清单节点取值。
 *
 * 必须与 Rust 侧 ost::DEFAULT_MANIFEST_SERVER 及 STALE_MANIFEST_NODES 对齐：
 * 内核已认定 steamrun / wudrm / guyun / opensteamtool 四个节点全部作废
 * （持续 502/503 或返回滞后码），若前端仍把 'steamrun' 写进 localStorage，
 * 下次注入就会把一个坏节点带进 opensteamtool.toml —— 随后被
 * ensure_toml_optimized 改回 manifestdex，两边来回打架。
 */
const VALID_MANIFEST_APIS = ['manifestdex'] as const;
type ManifestApiValue = (typeof VALID_MANIFEST_APIS)[number];

const readSavedManifestApi = (): ManifestApiValue => {
  const saved = localStorage.getItem('chunfengdu_manifest_api');
  // 老版本存下的坏节点一律丢弃并迁移到权威源，避免坏值被继续沿用
  return (VALID_MANIFEST_APIS as readonly string[]).includes(saved || '')
    ? (saved as ManifestApiValue)
    : 'manifestdex';
};

// 清单节点不再由用户选择（内核已硬编码 manifest.lua 的取码链路，该配置只用于写入
// opensteamtool.toml 的展示性字段）。保留 ref 是为了继续向 ensureOSTEnv /
// activateInjection 传值，并让老版本 localStorage 里的坏节点被就地迁移。
const manifestApi = ref<ManifestApiValue>(readSavedManifestApi());

if (localStorage.getItem('chunfengdu_manifest_api') !== manifestApi.value) {
  localStorage.setItem('chunfengdu_manifest_api', manifestApi.value);
}
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
    emit('notify', `环境体检失败: ${formatIpcError(e)}`, 'error');
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
    if (!silent) emit('notify', `环境体检失败: ${formatIpcError(e)}`, 'error');
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
    emit('notify', `一键修复失败: ${formatIpcError(e)}`, 'error');
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
    emit('notify', `重启 Steam 失败: ${formatIpcError(e)}`, 'error');
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
    emit('notify', `选择失败: ${formatIpcError(e)}`, 'error');
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
    emit('notify', `保存失败: ${formatIpcError(e)}`, 'error');
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
    emit('notify', `配置异常: ${formatIpcError(e)}`, 'error');
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
    } else {
      emit('notify', res.message || '卸载 OpenSteamTool 失败，请查看日志', 'error');
    }
  } catch (e: any) {
    emit('notify', `卸载异常: ${formatIpcError(e)}`, 'error');
  } finally {
    deploying.value = false;
  }
};

const loadLicenseData = async (forceVerify: boolean = false) => {
  try {
    const id = await window.electronAPI.getDeviceId();
    if (id) deviceId.value = id;
    const info = await window.electronAPI.getLicenseInfo(forceVerify);
    if (info) {
      licenseInfo.value = info;
      if (forceVerify && info.isActivated) {
        emit('notify', `授权状态已刷新：${info.isLifetime ? '终身赞助有效' : (info.typeName || '赞助有效')}`, 'success');
      }
    }
  } catch (e: any) {
    console.warn('获取授权信息异常:', formatIpcError(e));
  }
};

const copyDeviceId = () => {
  if (!deviceId.value) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(deviceId.value).then(() => {
      copiedDeviceId.value = true;
      emit('notify', '设备码已成功复制到剪贴板！', 'success');
      setTimeout(() => { copiedDeviceId.value = false; }, 2000);
    }).catch(() => {
      emit('notify', '复制失败：浏览器剪贴板不可用，请手动选择复制', 'error');
    });
  } else {
    // 剪贴板 API 不可用（如非安全上下文）时明确提示，避免点击后无任何反馈
    emit('notify', '剪贴板不可用，请手动选择复制', 'error');
  }
};

onMounted(() => {
  loadEnvInfo();
  loadDbStats();
  runEnvironmentHealthCheck();
  // App.vue 启动时已强制校验授权并每 30s 轮询，此处仅读取缓存，
  // 避免设置页挂载时再发起一次多余的网络校验请求
  loadLicenseData(false);
});
</script>
