<template>
  <div class="h-full flex flex-col p-6 xl:p-8 overflow-y-auto">
    <!-- 顶部主导航 Tab 栏 -->
    <div class="flex items-center gap-4 mb-6 border-b border-white/10 pb-4 shrink-0 flex-wrap">
      <div class="flex items-center gap-2 bg-slate-900/90 p-1.5 rounded-2xl border border-white/10 shadow-inner">
        <button
          @click="activeMainTab = 'launch'"
          class="px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 flex items-center gap-2 cursor-pointer"
          :class="activeMainTab === 'launch'
            ? 'theme-btn-primary shadow-md'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'"
        >
          <Rocket class="w-4 h-4" />
          <span>方案一 · Steam 通道联机</span>
        </button>

        <button
          @click="activeMainTab = 'patch'"
          class="px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 flex items-center gap-2 cursor-pointer"
          :class="activeMainTab === 'patch'
            ? 'theme-btn-primary shadow-md'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'"
        >
          <Wrench class="w-4 h-4" />
          <span>方案二 · 联机补丁注入</span>
        </button>
      </div>

      <!-- Spacewar 核心依赖微型指示器 -->
      <div class="ml-auto flex items-center gap-2.5">
        <button
          @click="!spacewarStatus.isInstalled ? (showSpacewarModal = true) : fetchSpacewarStatus(true)"
          class="px-3.5 py-2 rounded-xl bg-slate-900/80 hover:bg-slate-800/90 border border-white/10 text-xs font-mono shrink-0 flex items-center gap-2 transition cursor-pointer"
          :title="spacewarStatus.isInstalled ? 'Spacewar (AppID: 480) 已就绪' : '未检测到 Spacewar，点击查看安装向导'"
        >
          <span class="text-slate-400">Spacewar:</span>
          <span v-if="spacewarStatus.isInstalled" class="text-emerald-400 font-bold flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>已安装 (480)</span>
          </span>
          <span v-else class="text-amber-400 font-bold flex items-center gap-1.5 animate-pulse">
            <span class="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>未安装</span>
          </span>
        </button>
      </div>
    </div>

    <!-- 联机方案提示横幅 + 可折叠功能说明（徽章图例 / 两大方案 / 启动方式） -->
    <div class="mb-4 p-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-xs text-sky-200/90 flex items-start gap-3 shrink-0">
      <div class="w-5 h-5 rounded-lg bg-sky-500/20 flex items-center justify-center text-sky-400 shrink-0 mt-0.5 font-bold">
        💡
      </div>
      <div class="leading-relaxed flex-1">
        <strong class="text-sky-300 font-semibold">联机只有两大方案：</strong>
        <strong class="text-emerald-400 font-bold">方案一 · Steam 通道联机</strong>（免改文件，含 Open 内核 / Spacewar / BAT 三种启动方式，本质相同）；
        <strong class="text-amber-400 font-bold">方案二 · 联机补丁注入</strong>（改游戏文件，方案一无效时的精准修复）。
        先看游戏卡片左上角的<strong class="text-sky-300">联机徽章颜色</strong>选方案：绿色用方案一，橙色直接方案二。
      </div>
      <button
        @click="showGuide = !showGuide"
        class="shrink-0 px-3 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
      >
        <BookOpen class="w-3.5 h-3.5" />
        <span>{{ showGuide ? '收起说明' : '功能说明' }}</span>
        <ChevronDown class="w-3.5 h-3.5 transition-transform" :class="{ 'rotate-180': showGuide }" />
      </button>
    </div>

    <!-- 功能说明面板：徽章图例 + 两大方案原理 + 启动方式说明 -->
    <div v-if="showGuide" class="mb-4 p-4 xl:p-5 rounded-2xl bg-slate-900/70 border border-white/10 text-xs shrink-0 space-y-3">
      <!-- 徽章图例 -->
      <div class="space-y-2">
        <div class="text-[11px] font-bold text-slate-300 uppercase tracking-wider">卡片左上角联机徽章图例（扫描游戏文件自动判断）</div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 leading-relaxed">
          <div class="flex gap-2 items-start">
            <span class="shrink-0 px-2 py-0.5 rounded-lg bg-emerald-500/90 text-slate-950 text-[11px] font-bold">Steamworks 联机</span>
            <span class="text-slate-400">绿色：游戏联机走 Steam 官方接口，<strong class="text-emerald-400">直接用方案一</strong>，Open 内核即可</span>
          </div>
          <div class="flex gap-2 items-start">
            <span class="shrink-0 px-2 py-0.5 rounded-lg bg-emerald-500/85 text-slate-950 text-[11px] font-bold">Steamworks+三方</span>
            <span class="text-slate-400">绿色：核心联机走 Steam，语音等附属功能走第三方（如 Photon），<strong class="text-emerald-400">仍用方案一</strong></span>
          </div>
          <div class="flex gap-2 items-start">
            <span class="shrink-0 px-2 py-0.5 rounded-lg bg-sky-500/85 text-slate-950 text-[11px] font-bold">Steam API</span>
            <span class="text-slate-400">蓝色：接入了 Steam 但联机方式不确定，<strong class="text-sky-400">先试方案一</strong>，无效再换方案二</span>
          </div>
          <div class="flex gap-2 items-start">
            <span class="shrink-0 px-2 py-0.5 rounded-lg bg-amber-500/90 text-slate-950 text-[11px] font-bold">第三方网络</span>
            <span class="text-slate-400">橙色：联机走 Photon/EOS 等第三方服务，Steam 通道进不去，<strong class="text-amber-400">直接用方案二</strong></span>
          </div>
          <div class="flex gap-2 items-start">
            <span class="shrink-0 px-2 py-0.5 rounded-lg bg-slate-950/80 text-slate-400 text-[11px] font-bold border border-white/10">联机未知</span>
            <span class="text-slate-400">灰色：没发现已知联机指纹（可能单机或自研网络），<strong>可尝试方案一</strong>，失败则视作方案二适用</span>
          </div>
          <div class="flex gap-2 items-start">
            <span class="shrink-0 px-2 py-0.5 rounded-lg bg-emerald-500/90 text-slate-950 text-[11px] font-bold">已装联机补丁</span>
            <span class="text-slate-400">绿色：已通过方案二部署过补丁，直接联机启动即可</span>
          </div>
        </div>
      </div>

      <!-- 两大方案 -->
      <div class="space-y-2">
        <div class="text-[11px] font-bold text-slate-300 uppercase tracking-wider pt-1">两大联机方案（先方案一，无效才方案二）</div>
        <div class="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20 space-y-1">
          <div class="font-bold text-emerald-300 flex items-center gap-1.5">
            <Rocket class="w-3.5 h-3.5" />
            <span>方案一 · Steam 通道联机（免改任何游戏文件，优先推荐）</span>
          </div>
          <p class="text-slate-400 leading-relaxed">
            把游戏的联机通道伪装进 Steam 官方测试大厅 <strong class="text-slate-300">Spacewar (480)</strong>，游戏在 Steam 眼里就是"正规军"，好友列表直接右键「邀请加入游戏」。下方的
            <strong class="text-slate-300">Open 内核 / Spacewar / BAT 三种启动方式都是这一方案的不同启动手法，联机本质完全相同</strong>——
            所以 Open 内核联不上的游戏，换成另外两种启动方式也一样联不上，请直接改用方案二。
          </p>
        </div>
        <div class="p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-1">
          <div class="font-bold text-amber-300 flex items-center gap-1.5">
            <Wrench class="w-3.5 h-3.5" />
            <span>方案二 · 联机补丁注入（修改游戏文件，精准修复）</span>
          </div>
          <p class="text-slate-400 leading-relaxed">
            即「联机补丁模式」标签页：对接 <code>online-fix.me</code> 补丁库按游戏精准下载补丁，替换游戏目录内的
            <code>steam_api64.dll</code> 等文件并写入联机配置（也支持 Goldberg 局域网模式）。
            适用于方案一无法连入、大厅不可见的游戏。原文件自动备份，可一键还原。
          </p>
        </div>
      </div>

      <!-- 三种启动方式（方案一内部差异） -->
      <div class="space-y-2">
        <div class="text-[11px] font-bold text-slate-300 uppercase tracking-wider pt-1">方案一的三种启动方式（只是启动手法不同，联机效果一样）</div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
          <div class="p-3 rounded-xl bg-slate-950/60 border border-white/10 space-y-1">
            <div class="font-bold text-sky-400 flex items-center gap-1.5"><ArrowLeftRight class="w-3.5 h-3.5" /><span>Open 内核直启</span></div>
            <p class="text-slate-400 leading-relaxed">带 -onlinefix 参数重启 Steam 后由内核动态拦截，好友看到你玩的是<strong class="text-slate-300">游戏本名</strong>，体验最完整</p>
          </div>
          <div class="p-3 rounded-xl bg-slate-950/60 border border-white/10 space-y-1">
            <div class="font-bold text-purple-400 flex items-center gap-1.5"><Rocket class="w-3.5 h-3.5" /><span>Spacewar 伪装直启</span></div>
            <p class="text-slate-400 leading-relaxed">注入 <code>SteamAppId=480</code> 环境变量直接拉起 exe，好友看到你玩的是 <strong class="text-slate-300">Spacewar</strong>；纯入库游戏联机推荐用此方式</p>
          </div>
          <div class="p-3 rounded-xl bg-slate-950/60 border border-white/10 space-y-1">
            <div class="font-bold text-emerald-400 flex items-center gap-1.5"><Terminal class="w-3.5 h-3.5" /><span>BAT 脚本注入</span></div>
            <p class="text-slate-400 leading-relaxed">游戏目录生成 <code>Launch_Online_Fix.bat</code> 注入环境变量启动，联机效果同上；此后无需本工具也能直接双击该 bat 联机启动游戏</p>
          </div>
        </div>
      </div>
    </div>

    <!-- ============================================== -->
    <!-- TAB 1: 联机启动模式 (主模式) -->
    <!-- ============================================== -->
    <div v-if="activeMainTab === 'launch'" class="space-y-6 flex-1 flex flex-col min-h-0">
      <!-- 快捷操作栏 -->
      <div class="flex items-center justify-between gap-3.5 flex-wrap shrink-0">
        <div class="flex items-center gap-3 flex-wrap">
          <button
            @click="handleRefreshLocalGames(true)"
            :disabled="isScanning"
            class="px-4 py-2.5 bg-slate-900/80 hover:bg-slate-800 border border-white/10 rounded-xl text-xs font-bold text-slate-200 transition flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
          >
            <RotateCw class="w-4 h-4" :class="isScanning ? 'animate-spin' : ''" />
            <span>{{ isScanning ? '扫描中...' : '刷新列表' }}</span>
          </button>

          <!-- 列表扫描时间提示（磁盘缓存秒开，超过 24h 自动后台静默更新） -->
          <span
            v-if="scanAgoText && !isScanning"
            class="text-[11px] text-slate-500 font-mono cursor-help"
            title="本地游戏列表的扫描时间。列表优先使用缓存秒开，超过 24 小时会自动在后台静默更新；安装了新游戏可点「刷新列表」立即重扫。"
          >
            扫描于 {{ scanAgoText }}{{ isBgRefreshing ? ' · 后台更新中' : '' }}
          </span>
        </div>

        <div class="flex items-center gap-3.5 flex-1 max-w-lg justify-end">
          <div class="relative flex-1">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索游戏名称或APPID..."
              class="w-full bg-slate-900/90 border border-white/10 rounded-xl px-4 py-2.5 pl-9 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-400 transition font-mono shadow-inner"
            />
            <Search class="w-4 h-4 absolute left-3 top-3 text-slate-400 pointer-events-none" />
          </div>

          <span class="text-xs font-mono text-slate-400 bg-slate-900/80 px-3 py-2 rounded-xl border border-white/10 shrink-0">
            共 <strong class="text-slate-100 font-bold">{{ filteredGames.length }}</strong> 个已安装游戏
          </span>
        </div>
      </div>

      <!-- 联机启动模式选择器卡片 -->
      <div class="theme-card-static rounded-3xl p-5 xl:p-6 shadow-xl border">
        <div class="flex items-center justify-between mb-1 flex-wrap gap-2">
          <h3 class="text-base font-bold text-slate-100 flex items-center gap-2">
            <Gamepad2 class="w-5 h-5 theme-text-accent" />
            <span>方案一 · 启动方式（三选一）</span>
          </h3>
          <span class="text-xs text-slate-400 font-mono">三种方式同一联机机制，仅启动手法不同</span>
        </div>
        <p class="text-[11px] leading-relaxed text-amber-300/90 bg-amber-500/5 border border-amber-500/15 rounded-xl px-3 py-2 mb-4">
          <strong>注意：</strong>以下三种方式<strong>本质都是把联机伪装进 Steam 官方 Spacewar (480) 通道</strong>，联机效果完全相同。
          若 Open 内核联不上某游戏，切换 Spacewar / BAT <strong>同样联不上</strong>——此时请改用「方案二 · 联机补丁注入」，而不是在这三种里反复尝试。
        </p>

        <!-- 3 个启动方式选项卡片 -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5 mb-4">
          <!-- 方式 1: Open内核联机模式 -->
          <div
            @click="selectedLaunchMode = 'open'"
            class="p-4 rounded-2xl border transition-all duration-200 cursor-pointer flex items-center gap-3.5"
            :class="selectedLaunchMode === 'open'
              ? 'bg-sky-500/10 border-sky-500/60 ring-2 ring-sky-500/40 shadow-lg'
              : 'bg-slate-900/60 border-white/10 hover:border-sky-500/30'"
          >
            <div
              class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              :class="selectedLaunchMode === 'open' ? 'theme-btn-primary text-slate-950 font-bold' : 'bg-slate-800 text-slate-400'"
            >
              <ArrowLeftRight class="w-5 h-5" />
            </div>
            <div class="min-w-0">
              <div class="font-bold text-sm text-slate-100 flex items-center gap-1.5">
                <span>Open内核联机</span>
                <span class="text-[10px] px-1.5 py-[1px] rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold shrink-0">推荐</span>
              </div>
              <p class="text-xs text-slate-400 truncate mt-0.5">
                内核拦截 · 好友看到游戏本名
              </p>
            </div>
          </div>

          <!-- 方式 2: Spacewar模式 -->
          <div
            @click="selectedLaunchMode = 'spacewar'"
            class="p-4 rounded-2xl border transition-all duration-200 cursor-pointer flex items-center gap-3.5"
            :class="selectedLaunchMode === 'spacewar'
              ? 'bg-purple-500/10 border-purple-500/60 ring-2 ring-purple-500/40 shadow-lg'
              : 'bg-slate-900/60 border-white/10 hover:border-purple-500/30'"
          >
            <div
              class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              :class="selectedLaunchMode === 'spacewar' ? 'bg-purple-500 text-white font-bold' : 'bg-slate-800 text-slate-400'"
            >
              <Rocket class="w-5 h-5" />
            </div>
            <div class="min-w-0">
              <div class="font-bold text-sm text-slate-100">
                Spacewar伪装直启
              </div>
              <p class="text-xs text-slate-400 truncate mt-0.5">
                同源变体 · 480 大厅启动
              </p>
            </div>
          </div>

          <!-- 方式 3: BAT注入模式 -->
          <div
            @click="selectedLaunchMode = 'bat'"
            class="p-4 rounded-2xl border transition-all duration-200 cursor-pointer flex items-center gap-3.5"
            :class="selectedLaunchMode === 'bat'
              ? 'bg-emerald-500/10 border-emerald-500/60 ring-2 ring-emerald-500/40 shadow-lg'
              : 'bg-slate-900/60 border-white/10 hover:border-emerald-500/30'"
          >
            <div
              class="w-11 h-11 rounded-xl flex items-center justify-center shrink-0"
              :class="selectedLaunchMode === 'bat' ? 'bg-emerald-500 text-slate-950 font-bold' : 'bg-slate-800 text-slate-400'"
            >
              <Terminal class="w-5 h-5" />
            </div>
            <div class="min-w-0">
              <div class="font-bold text-sm text-slate-100">
                BAT脚本注入
              </div>
              <p class="text-xs text-slate-400 truncate mt-0.5">
                同源变体 · 环境变量脚本启动
              </p>
            </div>
          </div>
        </div>

        <!-- 联机 AppID 配置栏 -->
        <div class="flex items-center gap-3 pt-3 border-t border-white/10 flex-wrap">
          <div class="flex items-center gap-2">
            <span class="text-xs font-semibold text-slate-300">联机AppID:</span>
            <input
              v-model.number="onlineAppId"
              type="number"
              class="w-24 bg-slate-900/90 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-center font-mono font-bold text-sky-400 focus:outline-none focus:border-sky-400"
            />
          </div>
          <span class="text-xs text-slate-400 font-mono">
            仅 Spacewar / BAT 方式使用；默认480(Spacewar)，可改为游戏实际AppID
          </span>
        </div>
      </div>

      <!-- 本地游戏列表展示区 (支持点击标题折叠/收起与缩放) -->
      <div class="space-y-4 flex-1">
        <!-- 列表头部标题栏 (点击标题区域可收起/展开下方游戏卡片) -->
        <div
          @click="isLaunchGamesCollapsed = !isLaunchGamesCollapsed"
          class="flex items-center justify-between gap-4 flex-wrap bg-slate-900/80 hover:bg-slate-900 p-3.5 rounded-2xl border border-white/10 transition cursor-pointer select-none group"
        >
          <div class="flex items-center gap-2.5">
            <Library class="w-5 h-5 text-sky-400 group-hover:scale-110 transition-transform" />
            <h4 class="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>已检测到本地安装游戏</span>
              <span class="text-xs text-slate-400 font-normal group-hover:text-slate-300 transition-colors">
                ({{ isLaunchGamesCollapsed ? '已折叠收起，点击展开' : '点击标题折叠收起' }})
              </span>
            </h4>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 font-mono font-bold border border-sky-500/20">
              {{ filteredGames.length }} 款
            </span>
          </div>

          <!-- 右侧折叠指示器与缩放调节 -->
          <div class="flex items-center gap-3" @click.stop>
            <span class="text-xs text-slate-400 font-medium hidden sm:flex items-center gap-1.5">
              <Sliders class="w-3.5 h-3.5" />
              <span>卡片大小:</span>
            </span>

            <div class="hidden sm:flex items-center gap-2">
              <button
                @click="cardScale = Math.max(80, cardScale - 10)"
                class="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center text-xs font-bold transition cursor-pointer"
                title="缩小卡片"
              >
                -
              </button>

              <input
                v-model.number="cardScale"
                type="range"
                min="80"
                max="130"
                step="5"
                class="w-20 accent-sky-400 cursor-pointer"
              />

              <button
                @click="cardScale = Math.min(130, cardScale + 10)"
                class="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center text-xs font-bold transition cursor-pointer"
                title="放大卡片"
              >
                +
              </button>

              <span class="text-xs font-mono text-slate-300 w-9 text-right font-semibold">
                {{ cardScale }}%
              </span>
            </div>

            <!-- 折叠切换小箭头图标 -->
            <button
              @click="isLaunchGamesCollapsed = !isLaunchGamesCollapsed"
              class="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition cursor-pointer ml-1"
              :title="isLaunchGamesCollapsed ? '展开游戏列表' : '收起游戏列表'"
            >
              <ChevronUp v-if="!isLaunchGamesCollapsed" class="w-4 h-4 text-sky-400" />
              <ChevronDown v-else class="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>

        <!-- 折叠容器内容 -->
        <transition
          enter-active-class="transition-all duration-300 ease-out"
          leave-active-class="transition-all duration-200 ease-in"
          enter-from-class="opacity-0 -translate-y-2 max-h-0"
          enter-to-class="opacity-100 translate-y-0 max-h-[5000px]"
          leave-from-class="opacity-100 translate-y-0 max-h-[5000px]"
          leave-to-class="opacity-0 -translate-y-2 max-h-0"
        >
          <div v-show="!isLaunchGamesCollapsed" class="space-y-4">
            <!-- 空状态提示 -->
            <div v-if="filteredGames.length === 0" class="flex flex-col items-center justify-center py-16 text-slate-400 bg-slate-900/40 rounded-3xl border border-white/5">
              <div class="w-16 h-16 rounded-2xl bg-slate-900 border border-white/10 flex items-center justify-center mb-3 text-slate-500">
                <Library class="w-8 h-8" />
              </div>
              <p class="text-base font-bold text-slate-200 mb-1">未检测到已安装游戏</p>
              <p class="text-xs text-slate-400 max-w-md text-center leading-relaxed">
                请确认 Steam 客户端已安装游戏，或点击上方「刷新列表」重新扫描本地 Steam 库目录。
              </p>
            </div>

            <!-- 游戏卡片网格列表 (一体化现代游戏展台布局) -->
            <div
              v-else
              class="grid gap-4 pb-8 transition-all duration-200"
              :class="{
                'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5': cardScale <= 90,
                'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4': cardScale > 90 && cardScale <= 110,
                'grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3': cardScale > 110
              }"
            >
              <div
                v-for="game in filteredGames"
                :key="game.appId"
                class="game-card-surface flex flex-col justify-between group"
              >
                <!-- 顶部封面无缝区 (16:9 横版大图带暗角过渡) -->
                <div class="relative w-full aspect-[16/9] bg-slate-950 overflow-hidden shrink-0">
                  <img
                    :src="'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/' + game.appId + '/capsule_616x353.jpg'"
                    class="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.08]"
                    loading="lazy"
                    @error="handleCardImgError($event, game.appId)"
                  />
                  <div class="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent pointer-events-none"></div>

                  <!-- 左上角联机架构预测徽章（基于本地文件指纹） -->
                  <div class="absolute top-2.5 left-2.5 max-w-[70%]">
                    <span
                      v-if="netBadgeOf(game)"
                      :class="netBadgeOf(game)!.cls"
                      :title="netBadgeOf(game)!.tip"
                      class="px-2.5 py-0.5 rounded-lg backdrop-blur-md text-[11px] font-bold shadow-sm truncate block cursor-help"
                    >
                      {{ netBadgeOf(game)!.label }}
                    </span>
                  </div>

                  <!-- 右上角 AppID 胶囊 -->
                  <div class="absolute top-2.5 right-2.5 px-2.5 py-0.5 rounded-lg bg-slate-950/80 backdrop-blur-md border border-white/10 text-[11px] font-mono theme-text-accent font-bold shadow-sm">
                    ID: {{ game.appId }}
                  </div>
                </div>

                <!-- 卡片中部游戏元信息 -->
                <div class="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div class="space-y-1">
                    <h4 class="font-bold text-sm text-slate-100 truncate group-hover:theme-text-accent transition-colors" :title="game.name">
                      {{ game.name }}
                    </h4>
                    <div class="flex items-center gap-2 text-xs font-mono text-slate-400">
                      <span>APPID:</span>
                      <span class="text-slate-300 font-bold">{{ game.appId }}</span>
                    </div>
                    <div class="text-xs text-slate-400 truncate flex items-center gap-1.5" :title="game.installDir">
                      <span class="shrink-0">目录:</span>
                      <span class="text-slate-300 font-mono truncate">{{ game.installDir }}</span>
                    </div>
                  </div>

                  <!-- 底部操作按钮条 (▶ 联机启动 + 🔧 修复报错) -->
                  <div class="grid grid-cols-2 gap-2 pt-3 border-t border-white/10">
                    <!-- 联机启动按钮 -->
                    <button
                      @click="handleLaunchGame(game)"
                      :disabled="pendingLaunches.has(game.appId)"
                      class="py-2 px-3 btn-soft-action hover:border-sky-400/40 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      <Play class="w-3.5 h-3.5 fill-current text-sky-400" />
                      <span>{{ pendingLaunches.has(game.appId) ? '启动中...' : '联机启动' }}</span>
                    </button>

                    <!-- 修复报错按钮 (橙色高亮，点击弹出脱壳解密确认) -->
                    <button
                      @click="promptRepairSteamless(game)"
                      class="py-2 px-3 bg-amber-500/10 hover:bg-amber-500/20 active:bg-amber-500/30 border border-amber-500/30 text-amber-300 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <Wrench class="w-3.5 h-3.5 text-amber-400" />
                      <span>修复报错</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </div>

    <!-- ============================================== -->
    <!-- TAB 2: 联机补丁模式 (Online-Fix.me 自动下载解压安装) -->
    <!-- ============================================== -->
    <div v-else class="space-y-6 flex-1 flex flex-col min-h-0 pb-10">
      <!-- 快捷操作与搜索栏 -->
      <div class="flex items-center justify-between gap-3.5 flex-wrap shrink-0">
        <div class="flex items-center gap-3 flex-wrap">
          <button
            @click="handleRefreshLocalGames(true)"
            :disabled="isScanning"
            class="px-4 py-2.5 bg-slate-900/80 hover:bg-slate-800 border border-white/10 rounded-xl text-xs font-bold text-slate-200 transition flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
          >
            <RotateCw class="w-4 h-4" :class="isScanning ? 'animate-spin' : ''" />
            <span>{{ isScanning ? '扫描中...' : '刷新列表' }}</span>
          </button>

          <!-- 列表扫描时间提示（磁盘缓存秒开，超过 24h 自动后台静默更新） -->
          <span
            v-if="scanAgoText && !isScanning"
            class="text-[11px] text-slate-500 font-mono cursor-help"
            title="本地游戏列表的扫描时间。列表优先使用缓存秒开，超过 24 小时会自动在后台静默更新；安装了新游戏可点「刷新列表」立即重扫。"
          >
            扫描于 {{ scanAgoText }}{{ isBgRefreshing ? ' · 后台更新中' : '' }}
          </span>

          <button
            @click="showCustomDirModal = !showCustomDirModal"
            class="px-4 py-2.5 bg-slate-900/80 hover:bg-slate-800 border border-white/10 rounded-xl text-xs font-bold text-slate-300 transition flex items-center gap-2 shadow-sm cursor-pointer"
          >
            <FolderCog class="w-4 h-4 text-sky-400" />
            <span>自定义路径注入</span>
          </button>
        </div>

        <div class="flex items-center gap-3.5 flex-1 max-w-lg justify-end">
          <div class="relative flex-1">
            <input
              v-model="searchQuery"
              type="text"
              placeholder="搜索游戏名称或APPID..."
              class="w-full bg-slate-900/90 border border-white/10 rounded-xl px-4 py-2.5 pl-9 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-400 transition font-mono shadow-inner"
            />
            <Search class="w-4 h-4 absolute left-3 top-3 text-slate-400 pointer-events-none" />
          </div>

          <span class="text-xs font-mono text-slate-400 bg-slate-900/80 px-3 py-2 rounded-xl border border-white/10 shrink-0">
            共 <strong class="text-slate-100 font-bold">{{ filteredGames.length }}</strong> 个已安装游戏
          </span>
        </div>
      </div>

      <!-- 高质感使用须知告示栏 (深浅双模极致清晰高对比度) -->
      <div class="notice-alert-card space-y-2.5">
        <div class="flex items-center gap-2 font-bold text-sm text-amber-400">
          <AlertTriangle class="w-[18px] h-[18px] text-amber-500 shrink-0" />
          <span>使用须知</span>
        </div>
        <ol class="text-xs leading-relaxed text-amber-300 space-y-1.5 list-decimal list-inside pl-1 font-medium">
          <li>本页是<strong>方案二</strong>：当方案一（Steam 通道联机）联不上时的精准修复手段，通过修改游戏文件实现联机；徽章为橙色的游戏建议直接使用本页。</li>
          <li>自动在 <strong>online-fix.me</strong> 补丁网检索并下载该游戏的最新通用联机补丁 (<code>Fix_Repair_Steam_*.rar</code>)。</li>
          <li>下载后系统会自动以密码 <code>online-fix.me</code> 解压并部署到游戏根目录，无需手动去老外网站点广告下载。</li>
          <li>安装前系统会自动备份原始 DLL 文件（<code>steam_api64_o.dll</code> / <code>steam_api_o.dll</code>），随时可点击“还原原版”一键恢复。</li>
          <li>若游戏启动提示缺少 DLL 或防病毒软件报毒拦截，请将游戏目录添加至杀毒软件信任白名单。</li>
        </ol>
      </div>

      <!-- 自定义目录高级注入面板 (默认收起，点击上方按钮展开) -->
      <div v-if="showCustomDirModal" class="theme-card-static rounded-3xl p-5 border shadow-xl animate-in fade-in duration-200">
        <div class="flex items-center justify-between mb-3">
          <h4 class="font-bold text-sm text-slate-100 flex items-center gap-2">
            <FolderCog class="w-4 h-4 text-sky-400" />
            <span>自定义目录联机补丁注入</span>
          </h4>
          <button @click="showCustomDirModal = false" class="text-slate-400 hover:text-slate-200 text-xs">关闭</button>
        </div>

        <div class="flex items-center gap-3 mb-3">
          <input
            v-model="targetDir"
            type="text"
            placeholder="例如: D:\Games\Palworld"
            class="flex-1 bg-slate-900/90 border border-white/10 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 font-mono focus:outline-none focus:border-sky-400"
          />
          <button
            @click="handleSelectFolder"
            class="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-xl text-xs text-slate-200 transition font-semibold flex items-center gap-2 shrink-0 cursor-pointer"
          >
            <FolderOpen class="w-4 h-4" />
            <span>浏览文件夹</span>
          </button>
        </div>

        <div class="flex items-center gap-3">
          <input
            v-model.number="patchAppIdInput"
            type="number"
            placeholder="输入游戏真实 AppID (如 4704690)"
            class="w-56 bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-slate-200 font-mono"
          />
          <button
            @click="handleApplyCustomPatch"
            :disabled="!targetDir || !patchAppIdInput || actionLoading"
            class="px-5 py-2 theme-btn-primary text-xs font-bold rounded-xl cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            <Download class="w-3.5 h-3.5" />
            <span>自动下载并注入补丁</span>
          </button>
          <button
            @click="handleRestoreOriginalPatch"
            :disabled="!targetDir || actionLoading"
            class="px-5 py-2 bg-slate-800 hover:bg-rose-900/60 text-slate-300 text-xs font-semibold rounded-xl cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
          >
            <RotateCcw class="w-3.5 h-3.5" />
            <span>还原原版</span>
          </button>
        </div>
      </div>

      <!-- 本地游戏列表展示区 (支持点击标题折叠/收起) -->
      <div class="space-y-4 flex-1">
        <!-- 列表头部标题栏 (点击标题区域可收起/展开下方游戏卡片) -->
        <div
          @click="isPatchGamesCollapsed = !isPatchGamesCollapsed"
          class="flex items-center justify-between gap-4 flex-wrap bg-slate-900/80 hover:bg-slate-900 p-3.5 rounded-2xl border border-white/10 transition cursor-pointer select-none group"
        >
          <div class="flex items-center gap-2.5">
            <Library class="w-5 h-5 text-sky-400 group-hover:scale-110 transition-transform" />
            <h4 class="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>已检测到本地安装游戏</span>
              <span class="text-xs text-slate-400 font-normal group-hover:text-slate-300 transition-colors">
                ({{ isPatchGamesCollapsed ? '已折叠收起，点击展开' : '点击标题折叠收起' }})
              </span>
            </h4>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 font-mono font-bold border border-sky-500/20">
              {{ filteredGames.length }} 款
            </span>
          </div>

          <!-- 右侧折叠指示器 -->
          <div class="flex items-center gap-3" @click.stop>
            <button
              @click="isPatchGamesCollapsed = !isPatchGamesCollapsed"
              class="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition cursor-pointer"
              :title="isPatchGamesCollapsed ? '展开游戏列表' : '收起游戏列表'"
            >
              <ChevronUp v-if="!isPatchGamesCollapsed" class="w-4 h-4 text-sky-400" />
              <ChevronDown v-else class="w-4 h-4 text-slate-400" />
            </button>
          </div>
        </div>

        <!-- 折叠容器内容 -->
        <transition
          enter-active-class="transition-all duration-300 ease-out"
          leave-active-class="transition-all duration-200 ease-in"
          enter-from-class="opacity-0 -translate-y-2 max-h-0"
          enter-to-class="opacity-100 translate-y-0 max-h-[5000px]"
          leave-from-class="opacity-100 translate-y-0 max-h-[5000px]"
          leave-to-class="opacity-0 -translate-y-2 max-h-0"
        >
          <div v-show="!isPatchGamesCollapsed" class="space-y-4">
            <!-- 空状态提示 -->
            <div v-if="filteredGames.length === 0" class="flex flex-col items-center justify-center py-16 text-slate-400 bg-slate-900/40 rounded-3xl border border-white/5">
              <div class="w-16 h-16 rounded-2xl bg-slate-900 border border-white/10 flex items-center justify-center mb-3 text-slate-500">
                <Library class="w-8 h-8" />
              </div>
              <p class="text-base font-bold text-slate-200 mb-1">未检测到已安装游戏</p>
              <p class="text-xs text-slate-400 max-w-md text-center leading-relaxed">
                请确认 Steam 客户端已安装游戏，或点击上方「刷新列表」重新扫描本地 Steam 库目录。
              </p>
            </div>

            <!-- 补丁卡片网格列表 (一体化流线展台布局) -->
            <div
              v-else
              class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-4 pb-8"
            >
              <div
                v-for="game in filteredGames"
                :key="game.appId"
                class="game-card-surface flex flex-col justify-between group"
              >
                <!-- 游戏封面 (16:9 横版大图) -->
                <div class="relative w-full aspect-[16/9] bg-slate-950 overflow-hidden shrink-0">
                  <img
                    :src="'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/' + game.appId + '/capsule_616x353.jpg'"
                    class="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.08]"
                    loading="lazy"
                    @error="handleCardImgError($event, game.appId)"
                  />
                  <div class="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent pointer-events-none"></div>

                  <!-- 补丁状态标签 -->
                  <div class="absolute top-2.5 left-2.5">
                    <span
                      v-if="game.isPatched"
                      class="px-2.5 py-0.5 rounded-lg bg-emerald-500/90 backdrop-blur-md text-slate-950 text-[11px] font-bold flex items-center gap-1 shadow-sm"
                    >
                      <Check class="w-3 h-3" />
                      <span>已安装补丁</span>
                    </span>
                    <span
                      v-else
                      class="px-2.5 py-0.5 rounded-lg bg-slate-950/80 backdrop-blur-md border border-white/10 text-slate-400 text-[11px] font-medium"
                    >
                      未打补丁
                    </span>
                  </div>

                  <span class="absolute top-2.5 right-2.5 px-2.5 py-0.5 rounded-lg bg-slate-950/80 backdrop-blur-md border border-white/10 text-[11px] font-mono theme-text-accent font-bold shadow-sm">
                    ID: {{ game.appId }}
                  </span>
                </div>

                <!-- 游戏信息与操作栏 -->
                <div class="p-4 flex-1 flex flex-col justify-between gap-3">
                  <div class="space-y-1">
                    <h4 class="font-bold text-sm text-slate-100 truncate group-hover:theme-text-accent transition-colors" :title="game.name">
                      {{ game.name }}
                    </h4>
                    <div class="flex items-center gap-2 text-xs font-mono text-slate-400">
                      <span>APPID:</span>
                      <span class="text-slate-300 font-bold">{{ game.appId }}</span>
                    </div>
                    <div class="text-xs text-slate-400 truncate flex items-center gap-1.5" :title="game.installDir">
                      <span class="shrink-0">目录:</span>
                      <span class="text-slate-300 font-mono truncate">{{ game.installDir }}</span>
                    </div>
                  </div>

                  <!-- 底部操作按钮条 (📥 安装联机补丁 + ↩️ 还原原版 + 📁 打开目录) -->
                  <div class="flex items-center gap-2 pt-3 border-t border-white/10">
                    <!-- 安装联机补丁按钮 (自动从 online-fix.me 下载并解压) -->
                    <button
                      @click="handleInstallOnlineFixWebPatch(game)"
                      :disabled="pendingInstalls.has(game.appId) || actionLoading"
                      class="flex-1 py-2 px-1.5 theme-btn-primary text-[11px] font-bold rounded-xl transition flex items-center justify-center gap-1 whitespace-nowrap shadow-sm cursor-pointer disabled:opacity-50"
                    >
                      <RotateCw v-if="pendingInstalls.has(game.appId)" class="w-3.5 h-3.5 animate-spin" />
                      <Download v-else class="w-3.5 h-3.5" />
                      <span>{{ pendingInstalls.has(game.appId) ? '下载安装中...' : (game.isPatched ? '重新安装' : '安装联机补丁') }}</span>
                    </button>

                    <!-- 还原原版按钮 -->
                    <button
                      @click="handleRestorePatchForGame(game)"
                      :disabled="pendingInstalls.has(game.appId) || actionLoading || (!game.isPatched && !game.hasBackup)"
                      class="py-2 px-2 btn-soft-action hover:bg-rose-900/40 text-[11px] font-semibold rounded-xl flex items-center justify-center gap-1 whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
                      title="还原原始 DLL 文件"
                    >
                      <RotateCcw class="w-3.5 h-3.5" />
                      <span class="hidden sm:inline">还原原版</span>
                    </button>

                    <!-- 打开游戏目录按钮 -->
                    <button
                      @click="handleOpenGameFolder(game)"
                      class="p-2 btn-soft-action rounded-xl flex items-center justify-center cursor-pointer shrink-0"
                      title="打开游戏目录"
                    >
                      <FolderOpen class="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </transition>
      </div>
    </div>

    <!-- ============================================== -->
    <!-- 弹窗 1: Steamless 修复报错确认弹窗 (1:1 像素级对齐) -->
    <!-- ============================================== -->
    <div
      v-if="showRepairModal && targetRepairGame"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-200"
      @click.self="showRepairModal = false"
    >
      <div class="relative w-full max-w-md bg-slate-900 border border-white/10 rounded-3xl p-7 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
        <!-- 黄色感叹号警告圆环图标 -->
        <div class="w-16 h-16 rounded-full bg-amber-500/15 border-2 border-amber-500/40 flex items-center justify-center mb-4 shadow-lg shadow-amber-500/10">
          <AlertTriangle class="w-8 h-8 text-amber-400" />
        </div>

        <!-- 标题 -->
        <h3 class="text-xl font-bold text-slate-100 mb-2 tracking-tight">
          修复报错
        </h3>

        <!-- 说明文案 (与截图文字完全一致) -->
        <p class="text-xs text-slate-300 leading-relaxed max-w-xs mb-6">
          将对《{{ targetRepairGame.name }}》目录下所有exe执行Steamless解密，原exe会被解密后的文件替换。<br />
          确认执行？
        </p>

        <!-- 按钮组 (✔ 确认修复 + ✖ 取消) -->
        <div class="flex items-center gap-3 w-full">
          <button
            @click="confirmExecuteRepair"
            :disabled="repairExecuting"
            class="flex-1 py-3 px-4 bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-slate-950 font-bold text-xs rounded-2xl shadow-lg shadow-sky-500/20 transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <Check class="w-4 h-4 text-slate-950" />
            <span>{{ repairExecuting ? '正在解密脱壳中...' : '确认修复' }}</span>
          </button>

          <button
            @click="showRepairModal = false"
            :disabled="repairExecuting"
            class="flex-1 py-3 px-4 bg-slate-800/90 hover:bg-slate-700 active:bg-slate-600 text-slate-300 hover:text-slate-100 font-bold text-xs rounded-2xl border border-white/10 transition flex items-center justify-center gap-2 cursor-pointer"
          >
            <X class="w-4 h-4 text-slate-400" />
            <span>取消</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ============================================== -->
    <!-- 弹窗 3: Spacewar 未安装提示弹窗 -->
    <!-- ============================================== -->
    <div
      v-if="showSpacewarModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-200"
      @click.self="showSpacewarModal = false"
    >
      <div class="relative w-full max-w-md bg-slate-900 border border-white/10 rounded-3xl p-7 shadow-2xl flex flex-col items-center text-center animate-in zoom-in-95 duration-200">
        <div class="w-16 h-16 rounded-full bg-amber-500/15 border-2 border-amber-500/40 flex items-center justify-center mb-4 shadow-lg shadow-amber-500/10">
          <AlertTriangle class="w-8 h-8 text-amber-400" />
        </div>

        <h3 class="text-xl font-bold text-slate-100 mb-2 tracking-tight">
          Spacewar未安装
        </h3>

        <p class="text-xs text-slate-300 leading-relaxed max-w-xs mb-6">
          正在帮你安装联机必备Steam应用《Spacewar》<br />
          Steam弹出安装请进行安装，安装后点击刷新列表。
        </p>

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
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, type Ref } from 'vue';
import {
  Gamepad2,
  Rocket,
  RotateCcw,
  RotateCw,
  FolderCog,
  FolderOpen,
  Check,
  Library,
  BookOpen,
  Search,
  Sliders,
  Play,
  Wrench,
  ArrowLeftRight,
  Terminal,
  AlertTriangle,
  Download,
  ChevronDown,
  ChevronUp,
  X
} from 'lucide-vue-next';
import {
  LocalInstalledGame,
  LocalGamesScanResult,
  OnlineLaunchMode,
  SpacewarStatus
} from '../../types';
import { formatIpcError } from '../api/tauriBridge';
import { steamCardImageFallback } from '../utils/imageFallback';

const emit = defineEmits<{
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
}>();

// 主 Tab: 'launch' (联机启动模式) | 'patch' (联机补丁模式)
const activeMainTab = ref<'launch' | 'patch'>('launch');

// 选中的联机启动模式: 'open' | 'spacewar' | 'bat'
const selectedLaunchMode = ref<OnlineLaunchMode>('open');
const onlineAppId = ref<number>(480);

// 本地安装游戏列表与搜索过滤
const localGames = ref<LocalInstalledGame[]>([]);
const isScanning = ref(false);
const searchQuery = ref('');
const cardScale = ref<number>(100); // 80% ~ 130%

// 标题折叠收起状态 (用户指定：可以点击标题把下面展示的本地游戏缩回去)
const isLaunchGamesCollapsed = ref(false);
const isPatchGamesCollapsed = ref(false);

// 并发启动/安装守卫：用集合记录进行中的 appId，避免单值 ref 在多游戏并发操作时
// 相互覆盖（A 完成后误清 B 的进行中状态，导致按钮可重复点击）
const pendingLaunches = ref<Set<number>>(new Set());
const pendingInstalls = ref<Set<number>>(new Set());

// 变更集合并触发响应式更新（直接 mutate Set 不会触发 Vue 依赖收集）
const addPending = (set: Ref<Set<number>>, id: number) => {
  const next = new Set(set.value);
  next.add(id);
  set.value = next;
};
const removePending = (set: Ref<Set<number>>, id: number) => {
  const next = new Set(set.value);
  next.delete(id);
  set.value = next;
};

// 修复报错 Steamless Modal
const showRepairModal = ref(false);
const targetRepairGame = ref<LocalInstalledGame | null>(null);
const repairExecuting = ref(false);

// 顶部功能说明折叠面板（徽章图例 + 两大方案说明，替代原使用教程弹窗）
const showGuide = ref(false);

// Spacewar 依赖检测
const showSpacewarModal = ref(false);
const spacewarStatus = ref<SpacewarStatus>({
  isInstalled: false,
  appName: 'Spacewar',
  appId: 480
});

// 联机补丁模式 (Tab 2) 自定义注入状态
const showCustomDirModal = ref(false);
const targetDir = ref('');
const patchAppIdInput = ref<number | ''>('');
const actionLoading = ref(false);

const filteredGames = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return localGames.value;
  return localGames.value.filter(
    (g) => g.appId.toString().includes(q) || g.name.toLowerCase().includes(q) || g.installDir.toLowerCase().includes(q)
  );
});

// 扫描加载本地 Steam 游戏：force=true 强制重扫；silent=true 不弹成功提示。
// 后端三级策略：内存(60s) → 磁盘缓存(跨重启秒开) → 现场全量扫描
const lastScanAt = ref(0);
const isBgRefreshing = ref(false);

const applyScanResult = (res: LocalGamesScanResult) => {
  localGames.value = res.games || [];
  lastScanAt.value = res.scannedAt || 0;
};

const handleRefreshLocalGames = async (force: boolean = false, silent: boolean = false) => {
  isScanning.value = true;
  try {
    applyScanResult(await window.electronAPI.scanLocalGames(force));
    if (!silent) {
      emit('notify', `成功扫描到 ${localGames.value.length} 款本地已安装 Steam 游戏！`, 'success');
    }
  } catch (err: any) {
    emit('notify', `扫描本地游戏失败: ${formatIpcError(err)}`, 'error');
  } finally {
    isScanning.value = false;
  }
};

// 磁盘缓存超过 24h 时后台静默重扫：不阻塞页面、不转圈，完成后静默替换列表
const backgroundRefreshIfStale = async () => {
  if (isBgRefreshing.value) return;
  isBgRefreshing.value = true;
  try {
    applyScanResult(await window.electronAPI.scanLocalGames(true));
  } catch {
    // 静默失败：保留磁盘缓存数据，不打断用户
  } finally {
    isBgRefreshing.value = false;
  }
};

// 「扫描于 x 前」提示文本
const scanAgoText = computed(() => {
  if (!lastScanAt.value) return '';
  const diff = Date.now() - lastScanAt.value;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${Math.floor(diff / 86_400_000)} 天前`;
});

// 联机架构预测徽章：基于扫描时命中的本地文件指纹给出联机方式建议
interface NetBadge {
  label: string;
  cls: string;
  tip: string;
}
const netBadgeOf = (game: LocalInstalledGame): NetBadge | null => {
  const signals = (game.netSignals || []).filter(Boolean).join('、');
  const tipTail = signals ? `\n命中指纹: ${signals}` : '';
  switch (game.netType) {
    case 'patched':
      return {
        label: '已装联机补丁',
        cls: 'bg-emerald-500/90 text-slate-950',
        tip: '已通过联机补丁模式部署 OnlineFix/Goldberg，直接联机启动即可。' + tipTail
      };
    case 'steamworks':
      return {
        label: 'Steamworks 联机',
        cls: 'bg-emerald-500/90 text-slate-950',
        tip: '检测到 Steamworks SDK 封装，联机走 Steam 官方接口，推荐使用 Open 内核联机模式。' + tipTail
      };
    case 'mixed':
      return {
        label: 'Steamworks+三方',
        cls: 'bg-emerald-500/85 text-slate-950',
        tip: '游戏同时使用 Steamworks 与第三方网络组件（如 Photon/EOS 语音），核心联机大概率可用 Open 内核，语音等附属功能可能走第三方。' + tipTail
      };
    case 'api_only':
      return {
        label: 'Steam API',
        cls: 'bg-sky-500/85 text-slate-950',
        tip: '检测到 Steam API 接入但无明确网络 SDK 指纹，联机方式不确定，建议先尝试 Open 内核，无效再换联机补丁模式。' + tipTail
      };
    case 'thirdparty':
      return {
        label: '第三方网络',
        cls: 'bg-amber-500/90 text-slate-950',
        tip: '检测到 Photon/EOS/PlayFab 等第三方网络组件且无 Steamworks 联机封装，Open 内核大概率无效，建议直接使用「联机补丁模式」。' + tipTail
      };
    case 'unknown':
      return {
        label: '联机未知',
        cls: 'bg-slate-950/80 text-slate-400 border border-white/10',
        tip: '未发现已知联机指纹，可能为单机游戏或自研网络，可尝试 Open 内核。' + tipTail
      };
    default:
      return null;
  }
};

// 启动游戏
const handleLaunchGame = async (game: LocalInstalledGame) => {
  addPending(pendingLaunches, game.appId);
  try {
    emit('notify', `正在以【${selectedLaunchMode.value}】模式启动《${game.name}》...`, 'info');
    const res = await window.electronAPI.launchLocalGame({
      appId: game.appId,
      gamePath: game.fullInstallPath,
      primaryExe: game.primaryExe,
      mode: selectedLaunchMode.value,
      onlineAppId: Math.max(1, Math.trunc(Number(onlineAppId.value) || 480))
    });

    if (res.success) {
      emit('notify', res.message, 'success');
    } else {
      emit('notify', res.message, 'error');
    }
  } catch (err: any) {
    emit('notify', `启动失败: ${formatIpcError(err)}`, 'error');
  } finally {
    removePending(pendingLaunches, game.appId);
  }
};

// 弹出 Steamless 修复确认弹窗
const promptRepairSteamless = (game: LocalInstalledGame) => {
  targetRepairGame.value = game;
  showRepairModal.value = true;
};

// 确认执行 Steamless 修复脱壳
const confirmExecuteRepair = async () => {
  if (!targetRepairGame.value) return;
  const game = targetRepairGame.value;
  repairExecuting.value = true;

  try {
    emit('notify', `正在对《${game.name}》进行 Steamless 解密脱壳与报错修复...`, 'info');
    const res = await window.electronAPI.repairGameSteamless(game.fullInstallPath, game.name);

    if (res.success) {
      emit('notify', res.message, 'success');
      showRepairModal.value = false;
      await handleRefreshLocalGames(true);
    } else {
      emit('notify', res.message, 'error');
    }
  } catch (err: any) {
    emit('notify', `修复执行失败: ${formatIpcError(err)}`, 'error');
  } finally {
    repairExecuting.value = false;
  }
};

// 联机补丁模式：从 online-fix.me 自动检索下载并解压安装补丁
const handleInstallOnlineFixWebPatch = async (game: LocalInstalledGame) => {
  addPending(pendingInstalls, game.appId);
  try {
    emit('notify', `正在 online-fix.me 检索《${game.name}》(AppID: ${game.appId}) 联机补丁...`, 'info');
    const res = await window.electronAPI.installOnlineFixFromWeb(
      game.fullInstallPath,
      game.appId,
      game.name
    );

    if (res.success) {
      emit('notify', res.message || `成功为《${game.name}》安装 online-fix.me 联机补丁！`, 'success');
      // 强制重扫本地库同步磁盘真实补丁状态（仅静默更新列表，不重复弹提示），
      // 避免仅靠内存硬编码 isPatched 与磁盘状态不一致
      await handleRefreshLocalGames(true, true);
    } else {
      emit('notify', res.message || '未在 online-fix.me 搜索到该游戏的联机补丁', 'warning');
    }
  } catch (e: any) {
    emit('notify', `下载安装补丁失败: ${formatIpcError(e)}`, 'error');
  } finally {
    // 只移除自己的 appId，不影响其他游戏仍在进行的安装
    removePending(pendingInstalls, game.appId);
  }
};

// 联机补丁模式：还原原版
const handleRestorePatchForGame = async (game: LocalInstalledGame) => {
  actionLoading.value = true;
  try {
    emit('notify', `正在还原《${game.name}》为原版游戏文件...`, 'info');
    const res = await window.electronAPI.restoreGame(game.fullInstallPath);
    if (res.success) {
      emit('notify', res.message, 'success');
      game.isPatched = false;
      game.hasBackup = false;
      game.patchMode = 'none';
    } else {
      emit('notify', res.message, 'error');
    }
  } catch (e: any) {
    emit('notify', `还原失败: ${formatIpcError(e)}`, 'error');
  } finally {
    actionLoading.value = false;
  }
};

// 打开游戏目录
const handleOpenGameFolder = async (game: LocalInstalledGame) => {
  try {
    const targetPath = game.fullInstallPath || game.installDir;
    if (!targetPath) {
      emit('notify', '未获取到该游戏的安装路径', 'warning');
      return;
    }
    const res: any = await window.electronAPI.openFolder(targetPath);
    if (res && res.success) {
      emit('notify', res.message || `已打开《${game.name}》游戏目录`, 'success');
    } else if (res && !res.success) {
      emit('notify', res.message || '打开游戏目录失败', 'error');
    } else {
      emit('notify', `已打开《${game.name}》游戏目录`, 'success');
    }
  } catch (e: any) {
    emit('notify', `打开目录失败: ${formatIpcError(e)}`, 'error');
  }
};

// 自定义目录补丁注入
const handleSelectFolder = async () => {
  try {
    const selected = await window.electronAPI.selectDirectory();
    if (selected) {
      targetDir.value = selected;
    }
  } catch (e: any) {
    emit('notify', `选择目录失败: ${formatIpcError(e)}`, 'error');
  }
};

const handleApplyCustomPatch = async () => {
  if (!targetDir.value || !patchAppIdInput.value) {
    emit('notify', '请先指定游戏目录与 AppID', 'warning');
    return;
  }
  actionLoading.value = true;
  try {
    const appId = Number(patchAppIdInput.value);
    emit('notify', `正在 online-fix.me 检索 AppID: ${appId} 补丁...`, 'info');
    const res = await window.electronAPI.installOnlineFixFromWeb(targetDir.value, appId);
    if (res.success) {
      emit('notify', res.message, 'success');
      await handleRefreshLocalGames(true);
    } else {
      emit('notify', res.message || '未在 online-fix.me 搜索到该游戏的联机补丁', 'warning');
    }
  } catch (e: any) {
    emit('notify', `注入失败: ${formatIpcError(e)}`, 'error');
  } finally {
    actionLoading.value = false;
  }
};

const handleRestoreOriginalPatch = async () => {
  if (!targetDir.value) return;
  actionLoading.value = true;
  try {
    const res = await window.electronAPI.restoreGame(targetDir.value);
    if (res.success) {
      emit('notify', res.message, 'success');
      await handleRefreshLocalGames(true);
    } else {
      emit('notify', res.message, 'error');
    }
  } catch (e: any) {
    emit('notify', `还原失败: ${formatIpcError(e)}`, 'error');
  } finally {
    actionLoading.value = false;
  }
};

// 检测 Spacewar
const fetchSpacewarStatus = async (notifyUser = false) => {
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
  } catch {}
};

const handleTriggerSpacewarInstall = async () => {
  try {
    emit('notify', '正在唤起 Steam 安装向导...', 'info');
    await window.electronAPI.installSpacewar();
    emit('notify', '已打开 Steam 安装界面，请在 Steam 中点击安装。', 'success');
  } catch (e: any) {
    emit('notify', `唤起 Steam 安装失败: ${formatIpcError(e)}`, 'error');
  }
};

const handleCardImgError = (e: Event, appId: number) => {
  // 统一两步兜底并封顶，避免 logo 也 404 时重新设回 header.jpg 无限循环
  steamCardImageFallback(e, appId);
};

onMounted(async () => {
  await fetchSpacewarStatus(false);
  // 秒开磁盘缓存列表；无缓存时现场扫描一次，缓存超过 24h 则后台静默重扫更新
  try {
    const cached = await window.electronAPI.scanLocalGames(false);
    applyScanResult(cached);
    if (cached.stale) {
      // 不 await：后台静默重扫，页面先渲染缓存数据
      backgroundRefreshIfStale();
    }
  } catch {
    await handleRefreshLocalGames(false, true);
  }
});
</script>
