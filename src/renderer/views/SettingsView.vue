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
      <!-- 0. 界面与文字缩放大小 (UI Scale & Window Responsiveness) -->
      <div class="theme-card-static rounded-3xl p-5 xl:p-6 shadow-lg border">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div class="flex items-center gap-2.5">
            <ZoomIn class="w-5 h-5 theme-text-accent" />
            <h3 class="font-bold text-base text-slate-100">界面与文字缩放大小</h3>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-slate-800/80 text-slate-300 font-mono border border-white/10 font-bold">
              当前倍率: {{ Math.round((uiScaleState?.computedZoomValue.value || 1) * 100) }}%
            </span>
          </div>

          <div class="text-xs text-slate-400 font-mono bg-slate-950/40 px-2.5 py-1 rounded-lg border border-white/5">
            窗口分辨率: {{ uiScaleState?.windowResolution.value.width }} × {{ uiScaleState?.windowResolution.value.height }} px
          </div>
        </div>

        <p class="text-xs text-slate-400 mb-4 leading-relaxed">
          支持根据窗口尺寸（标准小窗 / 1080p / 2K / 4K 高分屏）自动智能放大，亦可根据个人视力偏好自由选择固定放大比例：
        </p>

        <!-- 6 个缩放档位快捷选择 -->
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
          <button
            v-for="opt in scaleOptions"
            :key="opt.id"
            @click="uiScaleState?.setUiScale(opt.id)"
            class="p-3 rounded-2xl border transition-all text-center flex flex-col items-center justify-center gap-1 group cursor-pointer"
            :class="uiScaleState?.currentUiScale.value === opt.id
              ? 'theme-btn-primary font-bold shadow-lg ring-2 ring-offset-2 ring-offset-transparent'
              : 'theme-card hover:border-sky-400/40 hover:-translate-y-0.5'"
          >
            <span class="text-xs font-bold">{{ opt.label }}</span>
            <span class="text-[11px] opacity-75 font-mono">{{ opt.desc }}</span>
          </button>
        </div>
      </div>

      <!-- 0.5 界面外观与主题配色 (包含 3 款深色 + 3 款浅色共 6 种精选配色) -->
      <div class="theme-card-static rounded-3xl p-5 xl:p-6 shadow-lg border">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div class="flex items-center gap-2.5">
            <Palette class="w-5 h-5 theme-text-accent" />
            <h3 class="font-bold text-base text-slate-100">界面外观与主题配色</h3>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-slate-800/80 text-slate-300 font-mono border border-white/10 font-bold">
              6 种精选配色 (3深 + 3浅)
            </span>
          </div>

          <!-- 深浅分类过滤切换 -->
          <div class="flex items-center gap-1 bg-slate-950/40 p-1 rounded-xl border border-white/10 text-xs">
            <button
              @click="themeFilter = 'all'"
              class="px-3 py-1 rounded-lg transition font-medium text-xs"
              :class="themeFilter === 'all' ? 'theme-btn-primary font-bold shadow-sm' : 'text-slate-400 hover:text-slate-200'"
            >
              全部 (6)
            </button>
            <button
              @click="themeFilter = 'dark'"
              class="px-3 py-1 rounded-lg transition font-medium text-xs flex items-center gap-1.5"
              :class="themeFilter === 'dark' ? 'theme-btn-primary font-bold shadow-sm' : 'text-slate-400 hover:text-slate-200'"
            >
              <Moon class="w-3.5 h-3.5" />
              <span>深色 (3)</span>
            </button>
            <button
              @click="themeFilter = 'light'"
              class="px-3 py-1 rounded-lg transition font-medium text-xs flex items-center gap-1.5"
              :class="themeFilter === 'light' ? 'theme-btn-primary font-bold shadow-sm' : 'text-slate-400 hover:text-slate-200'"
            >
              <Sun class="w-3.5 h-3.5" />
              <span>浅色 (3)</span>
            </button>
          </div>
        </div>

        <p class="text-xs text-slate-400 mb-4 leading-relaxed">
          提供针对现代游戏桌面端设计的专属高质感主题，涵盖深空钛金、赛博紫晶、铂金翡翠以及全新皓月霜白、香槟晨曦与森林薄荷：
        </p>

        <!-- 6 款主题选择卡片网格 -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div
            v-for="theme in filteredThemes"
            :key="theme.id"
            @click="handleSelectTheme(theme.id)"
            class="p-4 xl:p-5 rounded-2xl border transition-all duration-200 cursor-pointer relative overflow-hidden group flex flex-col justify-between"
            :class="currentTheme === theme.id 
              ? 'ring-2 ring-offset-2 ring-offset-transparent shadow-xl' 
              : 'theme-card hover:-translate-y-0.5 hover:shadow-md'"
            :style="currentTheme === theme.id ? { borderColor: theme.accentHex, backgroundColor: theme.cardHex } : {}"
          >
            <div>
              <!-- 色彩调色板预览圆点 & 深浅模式标签 + 当前使用徽章 (流式排版，完全并列不重叠) -->
              <div class="flex items-center justify-between mb-3 gap-2">
                <div class="flex items-center gap-2 shrink-0">
                  <span class="w-4.5 h-4.5 rounded-full border border-black/10 shadow-sm" :style="{ backgroundColor: theme.bgHex }" title="背景色"></span>
                  <span class="w-4.5 h-4.5 rounded-full border border-black/10 shadow-sm" :style="{ backgroundColor: theme.cardHex }" title="卡片色"></span>
                  <span class="w-4.5 h-4.5 rounded-full border border-black/10 shadow-sm" :style="{ backgroundColor: theme.accentHex }" title="高亮主色"></span>
                  <span class="w-4.5 h-4.5 rounded-full border border-black/10 shadow-sm" :style="{ backgroundColor: theme.secondaryHex }" title="辅助渐变色"></span>
                </div>

                <div class="flex items-center gap-2 flex-wrap justify-end">
                  <span 
                    class="text-xs px-2.5 py-0.5 rounded-full font-mono flex items-center gap-1 border shrink-0"
                    :class="theme.type === 'dark' ? 'bg-slate-800/80 text-slate-300 border-white/10' : 'bg-amber-500/10 text-amber-600 border-amber-500/20 font-bold'"
                  >
                    <Moon v-if="theme.type === 'dark'" class="w-3 h-3" />
                    <Sun v-else class="w-3 h-3 text-amber-500" />
                    <span>{{ theme.type === 'dark' ? '深色' : '浅色' }}</span>
                  </span>

                  <!-- 当前使用徽章 -->
                  <span 
                    v-if="currentTheme === theme.id"
                    class="text-xs font-bold px-2.5 py-0.5 rounded-full shadow flex items-center gap-1 shrink-0"
                    :style="{ backgroundColor: theme.accentHex, color: '#ffffff' }"
                  >
                    <Check class="w-3 h-3 stroke-[3]" />
                    <span>当前使用</span>
                  </span>
                </div>
              </div>

              <!-- 主题名称 -->
              <div class="font-bold text-base text-slate-100 flex items-center gap-2 mb-1.5">
                <span>{{ theme.name }}</span>
                <span class="text-xs font-mono text-slate-400 font-normal">({{ theme.nameEn }})</span>
              </div>

              <!-- 主题描述 -->
              <p class="text-xs text-slate-400 leading-relaxed">
                {{ theme.description }}
              </p>
            </div>

            <div class="mt-4 pt-3 border-t border-white/10 flex items-center justify-between text-xs">
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
      <div class="theme-card-static rounded-3xl p-5 xl:p-6 shadow-lg border transition-all duration-300">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2.5 flex-wrap">
            <Activity class="w-5 h-5 theme-text-accent" />
            <h3 class="font-bold text-base text-slate-100">运行环境健康度体检</h3>
            <span
              v-if="healthResult"
              class="px-3 py-0.5 rounded-full text-xs font-bold transition"
              :class="getOverallStatusBadgeClass(healthResult.overallStatus)"
            >
              {{ getOverallStatusText(healthResult.overallStatus) }}
            </span>
            <span v-if="abnormalItemsCount > 0 && filterMode === 'issues_only'" class="text-xs text-amber-400 font-semibold flex items-center gap-1.5">
              <AlertTriangle class="w-4 h-4" />
              <span>发现 {{ abnormalItemsCount }} 项异常待处理</span>
            </span>
          </div>

          <div class="flex items-center gap-2.5">
            <!-- 手动展开/折叠全部项切换按钮 -->
            <button
              v-if="healthResult && !checkingHealth"
              @click="toggleManualExpand"
              class="px-3 py-1.5 text-slate-400 hover:text-slate-200 text-xs font-medium transition flex items-center gap-1.5 rounded-xl hover:bg-slate-800/60"
            >
              <span>{{ isExpandedView ? '收起详情 ▴' : '展开详情 ▾' }}</span>
            </button>

            <!-- 开始检测主按钮 -->
            <button
              @click="handleStartHealthCheck"
              :disabled="checkingHealth"
              class="theme-btn-primary px-4 py-2 text-xs font-bold rounded-xl transition flex items-center gap-2 shadow"
            >
              <RotateCw class="w-4 h-4" :class="{ 'animate-spin': checkingHealth }" />
              <span>{{ checkingHealth ? '正在全面体检...' : '开始全面检测' }}</span>
            </button>
          </div>
        </div>

        <p class="text-xs text-slate-400 mt-2 mb-4 leading-relaxed">
          全面检测 Steam 根路径有效性、OpenSteam 核心 Hook 模块 (DLL)、toml 注入配置文件以及运行时内存挂载状态。
        </p>

        <!-- 正常折叠时的清爽简报卡片 -->
        <div
          v-if="healthResult && !isExpandedView && healthResult.overallStatus === 'ready'"
          class="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-500/30 flex items-center justify-between mb-3 text-sm"
        >
          <div class="flex items-center gap-2.5 text-emerald-300">
            <CheckCircle2 class="w-5 h-5 shrink-0 text-emerald-400" />
            <span class="font-medium text-xs leading-relaxed">各项指标检测完毕：Steam 路径、64位架构、Hook DLL、配置文件及规则引擎全部正常就绪。</span>
          </div>
          <button @click="toggleManualExpand" class="text-xs text-sky-400 hover:text-sky-300 underline font-mono shrink-0 ml-2">
            查看详情 ({{ healthResult.items.length }}项)
          </button>
        </div>

        <!-- 存在异常时的精简提醒条 -->
        <div
          v-if="healthResult && isExpandedView && filterMode === 'issues_only' && abnormalItemsCount > 0"
          class="p-3.5 rounded-2xl bg-amber-950/20 border border-amber-500/30 flex items-center justify-between mb-3 text-xs"
        >
          <span class="text-amber-300 font-semibold flex items-center gap-2">
            <AlertTriangle class="w-4 h-4" />
            <span>以下是检测到需要处理的异常项目（已自动精简展示）：</span>
          </span>
          <button @click="filterMode = 'all'" class="text-xs text-sky-400 hover:text-sky-300 underline shrink-0 ml-2">
            查看全部项目 (含正常项)
          </button>
        </div>

        <!-- 展开时的检测项目列表 -->
        <div v-if="isExpandedView && displayedItems.length > 0" class="space-y-3 mb-4 transition-all">
          <div
            v-for="(item, idx) in displayedItems"
            :key="idx"
            class="p-4 rounded-2xl bg-slate-900/70 border flex items-start justify-between gap-3.5 transition"
            :class="getItemBorderClass(item.status)"
          >
            <div class="flex items-start gap-3.5 min-w-0">
              <component 
                :is="getStatusIconComponent(item.status)" 
                class="w-5 h-5 mt-0.5 shrink-0" 
                :class="getStatusColorClass(item.status)" 
              />
              <div class="min-w-0">
                <div class="flex items-center gap-2.5 flex-wrap">
                  <span class="font-bold text-sm text-slate-100">{{ item.name }}</span>
                  <span class="text-xs px-2.5 py-0.5 rounded-full font-mono font-semibold" :class="getStatusBadgeClass(item.status)">
                    {{ item.message }}
                  </span>
                </div>
                <p v-if="item.detail" class="text-xs text-slate-400 mt-1.5 font-mono break-all leading-relaxed">
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
                class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition shadow flex items-center gap-1.5"
              >
                <Zap class="w-3.5 h-3.5" />
                <span>一键修复</span>
              </button>
              <button
                v-else-if="item.category === 'process'"
                @click="handleRestartSteamQuick"
                class="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-xl transition shadow flex items-center gap-1.5"
              >
                <RotateCw class="w-3.5 h-3.5" />
                <span>重启 Steam</span>
              </button>
            </div>
          </div>
        </div>

        <div v-if="healthResult" class="text-xs text-slate-400 flex items-center justify-between pt-3 border-t border-slate-800/80">
          <span>体检结论：<strong class="text-slate-200">{{ healthResult.summary }}</strong></span>
          <span class="font-mono text-slate-400">检测时间：{{ healthResult.checkedAt }}</span>
        </div>
      </div>

      <!-- 1.5 软件会员授权与设备识别码 -->
      <div class="theme-card-static rounded-3xl p-5 xl:p-6 shadow-lg border">
        <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div class="flex items-center gap-2.5">
            <Crown class="w-5 h-5 text-amber-400" />
            <h3 class="font-bold text-base text-slate-100">软件会员授权与设备绑定</h3>
            <span
              class="px-3 py-0.5 rounded-full text-xs font-mono font-bold border"
              :class="licenseInfo.isActivated ? 'bg-amber-500/10 text-amber-300 border-amber-500/30' : 'bg-slate-800 text-slate-400 border-white/10'"
            >
              {{ licenseInfo.isActivated ? (licenseInfo.isLifetime ? '👑 永久尊享会员' : `👑 ${licenseInfo.typeName || 'VIP会员'} (剩 ${licenseInfo.remainingDays || 0} 天)`) : '⚠️ 未激活' }}
            </span>
          </div>
          <button
            @click="showLicenseModal = true"
            class="theme-btn-primary px-4 py-2 text-xs font-bold rounded-xl transition flex items-center gap-2 shadow"
          >
            <Key class="w-4 h-4" />
            <span>{{ licenseInfo.isActivated ? '续费 / 更换卡密' : '输入卡密激活' }}</span>
          </button>
        </div>

        <p class="text-xs text-slate-400 mb-4 leading-relaxed">
          绑定本机唯一硬件设备指纹，享受 28.8万+ DepotKey 云端高速秒查、实时游戏清单下发与一键入库服务。
        </p>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <!-- 设备码展示 -->
          <div class="p-4 rounded-2xl bg-slate-900/60 border border-white/10 space-y-2">
            <div class="text-slate-400 text-xs flex items-center justify-between font-medium">
              <span class="flex items-center gap-2">
                <Laptop class="w-4 h-4 text-sky-400" />
                <span>本机设备码 (Device ID)</span>
              </span>
              <button
                @click="copyDeviceId"
                class="text-xs text-sky-400 hover:text-sky-300 transition font-semibold"
              >
                {{ copiedDeviceId ? '已复制 ✓' : '复制' }}
              </button>
            </div>
            <div class="font-mono text-xs text-sky-300 font-bold break-all bg-slate-950/60 px-3.5 py-2.5 rounded-xl border border-white/5 select-all">
              {{ deviceId || '正在获取...' }}
            </div>
          </div>

          <!-- 授权详情展示 -->
          <div class="p-4 rounded-2xl bg-slate-900/60 border border-white/10 space-y-2">
            <div class="text-slate-400 text-xs flex items-center justify-between font-medium">
              <span class="flex items-center gap-2">
                <Sparkles class="w-4 h-4 text-amber-400" />
                <span>授权有效性</span>
              </span>
              <button
                @click="loadLicenseData(true)"
                class="text-xs text-slate-400 hover:text-slate-200 transition font-semibold"
              >
                刷新状态
              </button>
            </div>
            <div class="text-xs text-slate-200 space-y-1.5 bg-slate-950/60 px-3.5 py-2.5 rounded-xl border border-white/5">
              <div class="flex justify-between">
                <span class="text-slate-400">已绑卡密:</span>
                <span class="font-mono font-bold text-slate-100">{{ licenseInfo.code || '无' }}</span>
              </div>
              <div class="flex justify-between">
                <span class="text-slate-400">有效期:</span>
                <span :class="licenseInfo.isActivated ? 'text-emerald-400 font-bold' : 'text-slate-400'">
                  {{ licenseInfo.isLifetime ? '终身永久有效' : (licenseInfo.expiresAt ? `剩余 ${licenseInfo.remainingDays} 天` : '未激活') }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. 云端数据库连接面板 -->
      <div class="theme-card-static rounded-3xl p-5 xl:p-6 shadow-lg border">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2.5">
            <Cloud class="w-5 h-5 theme-text-accent" />
            <h3 class="font-bold text-base text-slate-100">云端高速数据引擎</h3>
            <span class="px-3 py-0.5 rounded-full text-xs font-bold border" :class="dbStats.serverStatus === 'online' ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-amber-500/10 text-amber-300 border-amber-500/20'">
              {{ dbStats.serverStatus === 'online' ? '● 云端已连接' : '● 本地离线模式' }}
            </span>
          </div>
          <span class="text-xs text-slate-400 font-mono">{{ dbStats.lastUpdated }}</span>
        </div>

        <p class="text-xs text-slate-400 mb-4 leading-relaxed">
          商业版专属云端后端承载全量 18 万+ 游戏数据库与 28.8 万+ DepotKey 密钥库，毫秒级响应中文拼音检索与一键入库，无需消耗本地电脑存储。
        </p>

        <!-- 统计指标卡片 -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-2">
          <div class="p-4 xl:p-5 rounded-2xl bg-slate-900/60 border border-white/10 flex items-center justify-between">
            <div>
              <div class="text-xs text-slate-400 flex items-center gap-2">
                <Database class="w-4 h-4 text-sky-400" />
                <span>云端已收录游戏总量</span>
              </div>
              <div class="text-2xl font-mono font-bold text-sky-400 mt-1.5">
                {{ dbStats.gamesCount > 0 ? dbStats.gamesCount.toLocaleString() + ' 款' : '180,000+ 款' }}
              </div>
            </div>
            <button
              @click="loadDbStats"
              :disabled="refreshing"
              class="theme-btn-primary px-4 py-2.5 disabled:opacity-50 text-xs font-bold rounded-xl transition flex items-center gap-2 shadow"
            >
              <RotateCw class="w-4 h-4" :class="{ 'animate-spin': refreshing }" />
              <span>{{ refreshing ? '检测中...' : '刷新云端状态' }}</span>
            </button>
          </div>

          <div class="p-4 xl:p-5 rounded-2xl bg-slate-900/60 border border-white/10 flex items-center justify-between">
            <div>
              <div class="text-xs text-slate-400 flex items-center gap-2">
                <Key class="w-4 h-4 text-emerald-400" />
                <span>云端收录 DepotKey 密钥</span>
              </div>
              <div class="text-2xl font-mono font-bold text-emerald-400 mt-1.5">
                {{ dbStats.keysCount > 0 ? dbStats.keysCount.toLocaleString() + ' 条' : '288,000+ 条' }}
              </div>
            </div>
            <div class="text-xs text-emerald-400 flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 font-bold">
              <Zap class="w-4 h-4" />
              <span>实时云端下发</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Steam 安装路径设置 -->
      <div class="theme-card-static rounded-3xl p-5 xl:p-6 shadow-lg border">
        <div class="flex items-center gap-2.5 mb-3">
          <Folder class="w-5 h-5 theme-text-accent" />
          <h3 class="font-bold text-base text-slate-100">Steam 本地客户端路径</h3>
        </div>
        <div class="flex items-center gap-3">
          <input
            v-model="steamPathInput"
            type="text"
            placeholder="自动从注册表探测，或点击右侧浏览手动选择..."
            class="flex-1 bg-slate-900/90 border border-white/10 rounded-2xl px-4 py-3 text-xs text-slate-100 font-mono focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/50"
          />
          <button
            @click="handleBrowseSteamPath"
            class="px-4 py-3 bg-slate-800/80 hover:bg-slate-700 border border-white/10 rounded-2xl text-xs text-slate-200 font-semibold transition flex items-center gap-2"
          >
            <FolderOpen class="w-4 h-4 text-slate-300" />
            <span>浏览路径</span>
          </button>
          <button
            @click="handleSaveSteamPath"
            class="theme-btn-primary px-5 py-3 text-xs font-bold rounded-2xl transition flex items-center gap-2 shadow"
          >
            <Save class="w-4 h-4" />
            <span>保存并检测</span>
          </button>
        </div>
      </div>

      <!-- 4. OpenSteamTool 内核与公共清单源设置 -->
      <div class="theme-card-static rounded-3xl p-5 xl:p-6 shadow-lg border">
        <div class="flex items-center gap-2.5 mb-3">
          <Globe class="w-5 h-5 theme-text-accent" />
          <h3 class="font-bold text-base text-slate-100">公共清单 (Manifest) 上游 API 端点配置</h3>
        </div>
        <p class="text-xs text-slate-400 mb-4 leading-relaxed">
          OpenSteamTool 会在入库未拥有游戏时，自动向以下公用端点获取加密清单请求码 (GMRC)，解决个人服务器带宽限制。
        </p>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5 mb-4">
          <div
            @click="manifestApi = 'steamrun'"
            class="p-4 rounded-2xl border transition cursor-pointer"
            :class="manifestApi === 'steamrun' ? 'bg-sky-500/10 border-sky-500/60 ring-2 ring-sky-500/50 shadow-md' : 'theme-card hover:border-sky-500/30'"
          >
            <div class="font-bold text-sm text-slate-100 mb-1 flex items-center gap-2">
              <span>SteamRun 镜像源</span>
              <span class="text-xs px-2 py-0.5 rounded bg-sky-500/20 text-sky-400 font-bold border border-sky-500/30">推荐</span>
            </div>
            <div class="text-xs text-slate-400 font-mono break-all">manifest.steam.run</div>
          </div>

          <div
            @click="manifestApi = 'wudrm'"
            class="p-4 rounded-2xl border transition cursor-pointer"
            :class="manifestApi === 'wudrm' ? 'bg-sky-500/10 border-sky-500/60 ring-2 ring-sky-500/50 shadow-md' : 'theme-card hover:border-sky-500/30'"
          >
            <div class="font-bold text-sm text-slate-100 mb-1">WUDRM 国内高速源</div>
            <div class="text-xs text-slate-400 font-mono break-all">gmrc.wudrm.com</div>
          </div>

          <div
            @click="manifestApi = 'opensteamtool'"
            class="p-4 rounded-2xl border transition cursor-pointer"
            :class="manifestApi === 'opensteamtool' ? 'bg-sky-500/10 border-sky-500/60 ring-2 ring-sky-500/50 shadow-md' : 'theme-card hover:border-sky-500/30'"
          >
            <div class="font-bold text-sm text-slate-100 mb-1">OpenSteamTool 备用源</div>
            <div class="text-xs text-slate-400 font-mono break-all">opensteamtool.com</div>
          </div>
        </div>

        <div class="flex items-center justify-between pt-4 border-t border-white/10 flex-wrap gap-3">
          <div class="flex items-center gap-2.5">
            <button
              @click="emit('relaunch-wizard')"
              class="px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700 border border-white/10 rounded-2xl text-xs text-sky-400 font-semibold transition flex items-center gap-2"
            >
              <Sparkles class="w-4 h-4" />
              <span>重新运行注入向导</span>
            </button>
            <button
              @click="handleUninstallOST"
              :disabled="deploying"
              class="px-4 py-2.5 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 rounded-2xl text-xs font-semibold transition flex items-center gap-2"
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
  Globe, 
  Sparkles, 
  Trash2, 
  ShieldAlert,
  Moon,
  Sun,
  Crown,
  Laptop,
  ZoomIn
} from 'lucide-vue-next';
import { EnvironmentDiagnosticResult, EnvironmentCheckItem, AppThemeId, ClientLicenseInfo } from '../../types';
import { useTheme } from '../composables/useTheme';
import LicenseModal from '../components/LicenseModal.vue';

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
  { id: '105%', label: '舒适 105%', desc: '轻度适中比例' },
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

const loadLicenseData = async (forceVerify: boolean = false) => {
  try {
    const id = await window.electronAPI.getDeviceId();
    if (id) deviceId.value = id;
    const info = await window.electronAPI.getLicenseInfo(forceVerify);
    if (info) {
      licenseInfo.value = info;
      if (forceVerify && info.isActivated) {
        emit('notify', `授权状态已刷新：${info.typeName || '会员有效'}`, 'success');
      }
    }
  } catch (e: any) {
    console.warn('获取授权信息异常:', e.message);
  }
};

const copyDeviceId = () => {
  if (!deviceId.value) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(deviceId.value).then(() => {
      copiedDeviceId.value = true;
      emit('notify', '设备码已成功复制到剪贴板！', 'success');
      setTimeout(() => { copiedDeviceId.value = false; }, 2000);
    });
  }
};

onMounted(() => {
  loadEnvInfo();
  loadDbStats();
  runEnvironmentHealthCheck();
  loadLicenseData(true);
});
</script>
