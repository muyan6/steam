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
          <span>联机启动模式</span>
        </button>

        <button
          @click="activeMainTab = 'patch'"
          class="px-5 py-2.5 rounded-xl text-xs font-bold transition-all duration-200 flex items-center gap-2 cursor-pointer"
          :class="activeMainTab === 'patch'
            ? 'theme-btn-primary shadow-md'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'"
        >
          <Wrench class="w-4 h-4" />
          <span>联机补丁模式</span>
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

    <!-- ============================================== -->
    <!-- TAB 1: 联机启动模式 (主模式) -->
    <!-- ============================================== -->
    <div v-if="activeMainTab === 'launch'" class="space-y-6 flex-1 flex flex-col min-h-0">
      <!-- 快捷操作栏 -->
      <div class="flex items-center justify-between gap-3.5 flex-wrap shrink-0">
        <div class="flex items-center gap-3 flex-wrap">
          <button
            @click="handleRefreshLocalGames"
            :disabled="isScanning"
            class="px-4 py-2.5 bg-slate-900/80 hover:bg-slate-800 border border-white/10 rounded-xl text-xs font-bold text-slate-200 transition flex items-center gap-2 shadow-sm cursor-pointer disabled:opacity-50"
          >
            <RotateCw class="w-4 h-4" :class="isScanning ? 'animate-spin' : ''" />
            <span>{{ isScanning ? '扫描中...' : '刷新列表' }}</span>
          </button>

          <button
            @click="showTutorialModal = true"
            class="px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-bold transition flex items-center gap-2 shadow-sm cursor-pointer"
          >
            <BookOpen class="w-4 h-4" />
            <span>使用教程</span>
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

      <!-- 联机启动模式选择器卡片 -->
      <div class="theme-card-static rounded-3xl p-5 xl:p-6 shadow-xl border">
        <div class="flex items-center justify-between mb-4">
          <h3 class="text-base font-bold text-slate-100 flex items-center gap-2">
            <Gamepad2 class="w-5 h-5 theme-text-accent" />
            <span>联机启动模式</span>
          </h3>
          <span class="text-xs text-slate-400 font-mono">选择启动时使用的底层拦截机制</span>
        </div>

        <!-- 3 个模式选项卡片 -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5 mb-4">
          <!-- 模式 1: Open内核联机模式 -->
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
                <span>Open内核联机模式</span>
              </div>
              <p class="text-xs text-slate-400 truncate mt-0.5">
                推荐·使用Open内核联机
              </p>
            </div>
          </div>

          <!-- 模式 2: Spacewar模式 -->
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
                Spacewar模式
              </div>
              <p class="text-xs text-slate-400 truncate mt-0.5">
                通过Spacewar联机
              </p>
            </div>
          </div>

          <!-- 模式 3: BAT注入模式 -->
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
                BAT注入模式
              </div>
              <p class="text-xs text-slate-400 truncate mt-0.5">
                环境变量注入启动
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
            默认480(Spacewar), 可改为游戏实际AppID
          </span>
        </div>
      </div>

      <!-- 本地游戏列表展示区 (带标题卡片缩放调节器) -->
      <div class="space-y-4 flex-1">
        <!-- 列表头部与缩放调节器 -->
        <div class="flex items-center justify-between gap-4 flex-wrap bg-slate-900/60 p-3.5 rounded-2xl border border-white/10">
          <div class="flex items-center gap-2.5">
            <Library class="w-5 h-5 text-slate-300" />
            <h4 class="text-sm font-bold text-slate-100">
              已检测到本地安装游戏
            </h4>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-400 font-mono font-bold border border-sky-500/20">
              {{ filteredGames.length }} 款
            </span>
          </div>

          <!-- 卡片缩放控制器 (用户指定：本地游戏有标题可以缩放) -->
          <div class="flex items-center gap-3">
            <span class="text-xs text-slate-400 font-medium flex items-center gap-1.5">
              <Sliders class="w-3.5 h-3.5" />
              <span>卡片缩放:</span>
            </span>

            <div class="flex items-center gap-2">
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
                class="w-24 accent-sky-400 cursor-pointer"
              />

              <button
                @click="cardScale = Math.min(130, cardScale + 10)"
                class="w-6 h-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center text-xs font-bold transition cursor-pointer"
                title="放大卡片"
              >
                +
              </button>

              <span class="text-xs font-mono text-slate-300 w-10 text-right font-semibold">
                {{ cardScale }}%
              </span>
            </div>

            <!-- 视图模式预设快捷按钮 -->
            <div class="flex items-center gap-1 bg-slate-950/40 p-1 rounded-xl border border-white/10 ml-2">
              <button
                @click="cardScale = 85"
                class="px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer"
                :class="cardScale <= 90 ? 'theme-btn-primary' : 'text-slate-400 hover:text-slate-200'"
              >
                紧凑
              </button>
              <button
                @click="cardScale = 100"
                class="px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer"
                :class="cardScale > 90 && cardScale <= 110 ? 'theme-btn-primary' : 'text-slate-400 hover:text-slate-200'"
              >
                标准
              </button>
              <button
                @click="cardScale = 120"
                class="px-2 py-0.5 rounded text-[11px] font-semibold transition cursor-pointer"
                :class="cardScale > 110 ? 'theme-btn-primary' : 'text-slate-400 hover:text-slate-200'"
              >
                大图
              </button>
            </div>
          </div>
        </div>

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

        <!-- 游戏卡片网格列表 (自适应缩放列) -->
        <div
          v-else
          class="grid gap-4.5 pb-8 transition-all duration-200"
          :class="{
            'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5': cardScale <= 90,
            'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4': cardScale > 90 && cardScale <= 110,
            'grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-3': cardScale > 110
          }"
        >
          <div
            v-for="game in filteredGames"
            :key="game.appId"
            class="theme-card rounded-2xl p-4 flex flex-col justify-between gap-3 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl group"
          >
            <!-- 游戏封面 (16:9 横版大图) -->
            <div class="relative w-full aspect-[16/9] rounded-xl overflow-hidden bg-slate-950 border border-white/10 shadow-inner">
              <img
                :src="'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/' + game.appId + '/capsule_616x353.jpg'"
                class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                loading="lazy"
                @error="handleCardImgError($event, game.appId)"
              />
              <div class="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent pointer-events-none"></div>
              <span class="absolute top-2.5 right-2.5 px-2 py-0.5 rounded-md bg-slate-950/80 backdrop-blur-md border border-white/10 text-[11px] font-mono text-sky-400 font-bold">
                ID: {{ game.appId }}
              </span>
            </div>

            <!-- 游戏信息 -->
            <div class="space-y-1">
              <h4 class="font-bold text-sm text-slate-100 truncate" :title="game.name">
                {{ game.name }}
              </h4>
              <div class="text-xs font-mono text-slate-400 truncate">
                <span>APPID: </span>
                <span class="text-slate-300">{{ game.appId }}</span>
              </div>
              <div class="text-xs text-slate-400 truncate" :title="game.installDir">
                <span>安装目录: </span>
                <span class="text-slate-300 font-mono">{{ game.installDir }}</span>
              </div>
            </div>

            <!-- 底部操作按钮条 (▶ 联机启动 + 🔧 修复报错) -->
            <div class="grid grid-cols-2 gap-2 pt-3 border-t border-white/10">
              <!-- 联机启动按钮 -->
              <button
                @click="handleLaunchGame(game)"
                :disabled="launchingAppId === game.appId"
                class="py-2.5 px-3 bg-slate-800 hover:bg-slate-700 active:bg-slate-600 border border-white/10 text-slate-200 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 shadow cursor-pointer disabled:opacity-50"
              >
                <Play class="w-3.5 h-3.5 fill-current text-sky-400" />
                <span>{{ launchingAppId === game.appId ? '启动中...' : '联机启动' }}</span>
              </button>

              <!-- 修复报错按钮 (橙色高亮，点击弹出脱壳解密确认) -->
              <button
                @click="promptRepairSteamless(game)"
                class="py-2.5 px-3 bg-amber-500/15 hover:bg-amber-500/25 active:bg-amber-500/35 border border-amber-500/40 text-amber-300 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
              >
                <Wrench class="w-3.5 h-3.5 text-amber-400" />
                <span>修复报错</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ============================================== -->
    <!-- TAB 2: 联机补丁模式 (单游戏文件级补丁注入) -->
    <!-- ============================================== -->
    <div v-else class="space-y-6 max-w-5xl pb-10">
      <div class="theme-card-static rounded-3xl p-6 xl:p-7 shadow-xl border">
        <div class="flex items-center gap-3 mb-4">
          <FolderCog class="w-6 h-6 theme-text-accent" />
          <div>
            <h3 class="text-lg font-bold text-slate-100">单游戏文件级联机补丁注入器</h3>
            <p class="text-xs text-slate-400 mt-0.5">适合离线局域网联机对战（配合 Radmin VPN）或替换本地 steam_api64.dll 模式</p>
          </div>
        </div>

        <!-- 目录选择 -->
        <div class="space-y-4">
          <div>
            <label class="block text-xs font-medium text-slate-300 mb-1.5">
              目标游戏根目录 (包含 steam_api64.dll / exe 所在文件夹):
            </label>
            <div class="flex items-center gap-3">
              <input
                v-model="targetDir"
                @input="checkDirectoryStatus"
                type="text"
                placeholder="例如: D:\SteamLibrary\steamapps\common\Palworld"
                class="flex-1 bg-slate-900/90 border border-white/10 rounded-xl px-4 py-3 text-xs text-slate-100 placeholder-slate-500 font-mono focus:outline-none focus:border-sky-400"
              />
              <button
                @click="handleSelectFolder"
                class="px-4 py-3 bg-slate-800 hover:bg-slate-700 border border-white/10 rounded-xl text-xs text-slate-200 transition font-semibold flex items-center gap-2 shrink-0 cursor-pointer"
              >
                <FolderOpen class="w-4 h-4" />
                <span>浏览文件夹</span>
              </button>
            </div>
          </div>

          <!-- 补丁模式选择 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
            <div
              @click="selectedPatchMode = 'spacewar'"
              class="p-4 rounded-2xl border transition-all duration-200 cursor-pointer"
              :class="selectedPatchMode === 'spacewar'
                ? 'bg-sky-500/10 border-sky-500/60 ring-2 ring-sky-500/50'
                : 'bg-slate-900/60 border-white/10 hover:border-sky-500/30'"
            >
              <div class="font-bold text-sm text-slate-100 mb-1">模式 A: Spacewar (480) 大厅模式</div>
              <p class="text-xs text-slate-400 leading-relaxed mb-3">替换本地 steam_api64.dll 并配置 OnlineFix.ini，Steam 客户端相互邀请直连。</p>
              <input
                v-model.number="patchAppIdInput"
                type="number"
                placeholder="游戏真实 AppID"
                class="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-slate-200 font-mono"
                @click.stop
              />
            </div>

            <div
              @click="selectedPatchMode = 'goldberg'"
              class="p-4 rounded-2xl border transition-all duration-200 cursor-pointer"
              :class="selectedPatchMode === 'goldberg'
                ? 'bg-emerald-500/10 border-emerald-500/60 ring-2 ring-emerald-500/50'
                : 'bg-slate-900/60 border-white/10 hover:border-emerald-500/30'"
            >
              <div class="font-bold text-sm text-slate-100 mb-1">模式 B: Goldberg 局域网模式</div>
              <p class="text-xs text-slate-400 leading-relaxed mb-3">部署 Goldberg 离线模拟器与广播配置，适合离线虚拟局域网对战。</p>
              <input
                v-model="playerNameInput"
                type="text"
                placeholder="自定义玩家昵称"
                class="w-full bg-slate-950/60 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-slate-200"
                @click.stop
              />
            </div>
          </div>

          <!-- 操作按钮条 -->
          <div class="flex items-center gap-3 pt-3 border-t border-white/10">
            <button
              @click="handleApplyPatchFix"
              :disabled="!targetDir || actionLoading"
              class="flex-1 py-3.5 theme-btn-primary text-xs font-bold rounded-xl shadow transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Zap class="w-4 h-4" />
              <span>一键注入所选联机补丁</span>
            </button>

            <button
              @click="handleRestoreOriginalPatch"
              :disabled="!targetDir || actionLoading"
              class="px-6 py-3.5 bg-slate-800/80 hover:bg-rose-900/60 border border-white/10 hover:border-rose-500/40 text-slate-300 hover:text-rose-200 text-xs font-semibold rounded-xl transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <RotateCcw class="w-4 h-4" />
              <span>一键无损还原原版</span>
            </button>
          </div>
        </div>
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
    <!-- 弹窗 2: 使用教程 Modal -->
    <!-- ============================================== -->
    <div
      v-if="showTutorialModal"
      class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-200"
      @click.self="showTutorialModal = false"
    >
      <div class="relative w-full max-w-2xl bg-slate-900 border border-white/10 rounded-3xl p-6 xl:p-7 shadow-2xl flex flex-col max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200">
        <div class="flex items-center justify-between pb-4 border-b border-white/10 mb-4 shrink-0">
          <div class="flex items-center gap-2.5">
            <BookOpen class="w-5 h-5 theme-text-accent" />
            <h3 class="text-lg font-bold text-slate-100">联机工具使用指南与原理</h3>
          </div>
          <button @click="showTutorialModal = false" class="text-slate-400 hover:text-slate-200 cursor-pointer">
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto space-y-4 pr-1 text-xs text-slate-300 leading-relaxed">
          <div class="p-4 rounded-2xl bg-slate-950/60 border border-white/10 space-y-2">
            <h4 class="text-sm font-bold text-sky-400 flex items-center gap-2">
              <ArrowLeftRight class="w-4 h-4" />
              <span>1. Open内核联机模式 (推荐)</span>
            </h4>
            <p>通过 OpenSteamTool 内核的底层 API 动态拦截拉起游戏。无需修改任何游戏本地文件，Steam 会自动建立 P2P 虚拟大厅，好友在 Steam 好友列表中直接右键「邀请加入游戏」即可开黑。</p>
          </div>

          <div class="p-4 rounded-2xl bg-slate-950/60 border border-white/10 space-y-2">
            <h4 class="text-sm font-bold text-purple-400 flex items-center gap-2">
              <Rocket class="w-4 h-4" />
              <span>2. Spacewar 模式</span>
            </h4>
            <p>通过环境变量将游戏运行时伪装为 Steam 官方测试大厅《Spacewar (AppID: 480)》。适合大多数自带房间邀请机制的联机游戏。</p>
          </div>

          <div class="p-4 rounded-2xl bg-slate-950/60 border border-white/10 space-y-2">
            <h4 class="text-sm font-bold text-emerald-400 flex items-center gap-2">
              <Terminal class="w-4 h-4" />
              <span>3. BAT 注入模式</span>
            </h4>
            <p>在游戏根目录下自动生成独立的批处理启动文件，注入所需的 SteamAppId 与环境变量并执行，适用于免客户端快速自启。</p>
          </div>

          <div class="p-4 rounded-2xl bg-slate-950/60 border border-white/10 space-y-2">
            <h4 class="text-sm font-bold text-amber-400 flex items-center gap-2">
              <Wrench class="w-4 h-4" />
              <span>4. 修复报错 (Steamless 解密脱壳)</span>
            </h4>
            <p>很多 Steam 游戏的主程序存在 SteamStub DRM 加密壳，启动时若提示 <code>Application load error 3:0000065432</code> 或闪退，点击「修复报错」即可自动脱壳解密并替换，完美解决启动报错！</p>
          </div>
        </div>

        <div class="pt-4 border-t border-white/10 mt-4 flex justify-end shrink-0">
          <button
            @click="showTutorialModal = false"
            class="px-5 py-2.5 theme-btn-primary text-xs font-bold rounded-xl shadow cursor-pointer"
          >
            我明白了
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
import { ref, computed, onMounted } from 'vue';
import {
  Gamepad2,
  Zap,
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
  X
} from 'lucide-vue-next';
import {
  LocalInstalledGame,
  OnlineLaunchMode,
  SpacewarStatus
} from '../../types';

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

const launchingAppId = ref<number | null>(null);

// 修复报错 Steamless Modal
const showRepairModal = ref(false);
const targetRepairGame = ref<LocalInstalledGame | null>(null);
const repairExecuting = ref(false);

// 使用教程 Modal
const showTutorialModal = ref(false);

// Spacewar 依赖检测
const showSpacewarModal = ref(false);
const spacewarStatus = ref<SpacewarStatus>({
  isInstalled: false,
  appName: 'Spacewar',
  appId: 480
});

// 联机补丁模式 (Tab 2) 相关状态
const targetDir = ref('');
const selectedPatchMode = ref<'spacewar' | 'goldberg'>('spacewar');
const patchAppIdInput = ref<number | ''>('');
const playerNameInput = ref('春风渡玩家');
const actionLoading = ref(false);

const filteredGames = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return localGames.value;
  return localGames.value.filter(
    (g) => g.appId.toString().includes(q) || g.name.toLowerCase().includes(q) || g.installDir.toLowerCase().includes(q)
  );
});

// 扫描加载本地 Steam 游戏
const handleRefreshLocalGames = async () => {
  isScanning.value = true;
  try {
    const list = await window.electronAPI.scanLocalGames();
    localGames.value = list || [];
    emit('notify', `成功扫描到 ${localGames.value.length} 款本地已安装 Steam 游戏！`, 'success');
  } catch (err: any) {
    emit('notify', `扫描本地游戏失败: ${err.message}`, 'error');
  } finally {
    isScanning.value = false;
  }
};

// 启动游戏
const handleLaunchGame = async (game: LocalInstalledGame) => {
  launchingAppId.value = game.appId;
  try {
    emit('notify', `正在以【${selectedLaunchMode.value}】模式启动《${game.name}》...`, 'info');
    const res = await window.electronAPI.launchLocalGame({
      appId: game.appId,
      gamePath: game.fullInstallPath,
      primaryExe: game.primaryExe,
      mode: selectedLaunchMode.value,
      onlineAppId: onlineAppId.value || 480
    });

    if (res.success) {
      emit('notify', res.message, 'success');
    } else {
      emit('notify', res.message, 'error');
    }
  } catch (err: any) {
    emit('notify', `启动失败: ${err.message}`, 'error');
  } finally {
    launchingAppId.value = null;
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
      await handleRefreshLocalGames();
    } else {
      emit('notify', res.message, 'error');
    }
  } catch (err: any) {
    emit('notify', `修复执行失败: ${err.message}`, 'error');
  } finally {
    repairExecuting.value = false;
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
    emit('notify', `唤起 Steam 安装失败: ${e.message}`, 'error');
  }
};

// 补丁模式 (Tab 2) 逻辑
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
    if (status.appId && !patchAppIdInput.value) {
      patchAppIdInput.value = status.appId;
    }
  } catch {}
};

const handleApplyPatchFix = async () => {
  if (!targetDir.value) {
    emit('notify', '请先指定游戏目录', 'warning');
    return;
  }

  actionLoading.value = true;
  try {
    if (selectedPatchMode.value === 'spacewar') {
      const appId = Number(patchAppIdInput.value) || 480;
      const res = await window.electronAPI.applySpacewarFix(targetDir.value, appId);
      if (res.success) {
        emit('notify', res.message, 'success');
      } else {
        emit('notify', res.message, 'error');
      }
    } else {
      const appId = Number(patchAppIdInput.value) || 480;
      const res = await window.electronAPI.applyGoldbergFix(targetDir.value, appId, playerNameInput.value || 'Player');
      if (res.success) {
        emit('notify', res.message, 'success');
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

const handleRestoreOriginalPatch = async () => {
  if (!targetDir.value) return;
  actionLoading.value = true;
  try {
    const res = await window.electronAPI.restoreGame(targetDir.value);
    if (res.success) {
      emit('notify', res.message, 'success');
    } else {
      emit('notify', res.message, 'error');
    }
  } catch (e: any) {
    emit('notify', `还原失败: ${e.message}`, 'error');
  } finally {
    actionLoading.value = false;
  }
};

const handleCardImgError = (e: Event, appId: number) => {
  const target = e.target as HTMLImageElement;
  if (!target.src.includes('header.jpg')) {
    target.src = `https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`;
  } else {
    target.src = 'https://store.cloudflare.steamstatic.com/public/shared/images/header/globalheader_logo.png';
  }
};

onMounted(async () => {
  await fetchSpacewarStatus(false);
  await handleRefreshLocalGames();
});
</script>