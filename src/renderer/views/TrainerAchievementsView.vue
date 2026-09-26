<template>
  <div class="h-full flex flex-col p-5 xl:p-6 overflow-y-auto theme-bg-subtle">
    <!-- 顶部统一标准 Header -->
    <div class="flex items-center justify-between gap-4 pb-4 mb-5 border-b border-white/10 shrink-0 flex-wrap">
      <div class="flex items-center gap-3.5">
        <div class="w-11 h-11 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shadow-sm shrink-0">
          <Trophy class="w-5 h-5 theme-text-accent" />
        </div>
        <div>
          <div class="flex items-center gap-2.5">
            <h1 class="text-lg font-black tracking-wide text-slate-100 leading-none">修改器与成就解锁</h1>
            <span class="text-xs px-2.5 py-0.5 rounded-full font-mono bg-sky-500/10 text-sky-400 font-bold border border-sky-500/20">
              一键全成就点亮 · 官方修改器直连
            </span>
          </div>
          <p class="text-xs text-slate-400 mt-1.5 leading-none">自动匹配本地已安装游戏：一键解锁/点亮 Steam 100% 全成就徽章，秒级直连官方下载最新风灵月影修改器</p>
        </div>
      </div>

      <!-- 右侧 SAM 成就解锁引擎微型指示器 & 手动匹配 -->
      <div class="flex items-center gap-2.5">
        <button
          @click="showCustomGameModal = true"
          class="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-white/10 text-xs font-semibold shrink-0 flex items-center gap-2 transition cursor-pointer text-slate-700 dark:text-slate-300 shadow-xs"
          title="手动输入 AppID 或游戏名称，匹配未在本地检测到的游戏"
        >
          <Search class="w-3.5 h-3.5 text-sky-500" />
          <span>手动查游戏</span>
        </button>

        <button
          @click="showSamModal = true"
          class="px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-white/10 text-xs font-mono shrink-0 flex items-center gap-2 transition cursor-pointer shadow-xs"
          :title="samStatus.isInstalled ? 'Steam 成就解锁引擎 (SAM) 已就绪，可针对任意游戏一键点亮全成就' : '未检测到 Steam 成就解锁引擎，点击一键部署安装'"
        >
          <Trophy class="w-3.5 h-3.5 text-emerald-500" />
          <span class="text-slate-600 dark:text-slate-400">成就解锁引擎 (SAM):</span>
          <span v-if="samStatus.isInstalled" class="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
            <span>解锁核心就绪 ({{ samStatus.version || '内置就绪' }})</span>
          </span>
          <span v-else class="text-amber-500 font-bold flex items-center gap-1.5 animate-pulse">
            <span class="w-2 h-2 rounded-full bg-amber-500"></span>
            <span>未部署 · 点击一键安装</span>
          </span>
        </button>
      </div>
    </div>

    <!-- 顶部功能横幅指引：清晰明确的成就解锁与修改器指南 (完全对齐指南弹窗的清爽通透风格) -->
    <div class="mb-5 p-4 rounded-2xl bg-white dark:bg-slate-900/80 border border-slate-200 dark:border-white/10 text-xs text-slate-600 dark:text-slate-300 flex items-start shrink-0 shadow-sm backdrop-blur-md">
      <div class="leading-relaxed flex-1 space-y-2.5">
        <div class="flex items-center gap-2 flex-wrap">
          <span class="px-2.5 py-0.5 rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-300 font-bold text-[11px] border border-sky-500/25">核心能力速览</span>
          <span class="text-slate-800 dark:text-slate-100 font-semibold text-xs">本地已安装游戏自动化匹配，双轨功能即点即用</span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3 pt-0.5 text-[11px]">
          <div class="p-3 rounded-xl bg-sky-50/70 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-500/25 text-slate-700 dark:text-slate-300 leading-relaxed shadow-xs">
            <div class="font-bold text-sky-700 dark:text-sky-300 flex items-center gap-1.5 mb-1 text-xs">
              <Trophy class="w-3.5 h-3.5 text-sky-500" />
              <span>Steam 成就一键解锁</span>
            </div>
            <span>点击任意游戏的<strong class="text-sky-700 dark:text-sky-200">「一键解锁成就」</strong>，即可<strong class="text-sky-600 dark:text-sky-300">一键点亮 100% 全成就徽章</strong>或自由勾选指定成就解锁，Steam 客户端<strong>实时同步跳杯</strong>，亦可随时撤销重置！</span>
          </div>
          <div class="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-500/25 text-slate-700 dark:text-slate-300 leading-relaxed shadow-xs">
            <div class="font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5 mb-1 text-xs">
              <Gamepad2 class="w-3.5 h-3.5 text-emerald-500" />
              <span>风灵月影官方修改器</span>
            </div>
            <span>自动识别本地游戏并直连官方接口，<strong class="text-emerald-700 dark:text-emerald-300">一键高速下载并脱机拉起</strong>，锁血/无敌/无限金钱随心开启，独立进程安全运行，绝不破坏游戏核心文件。</span>
          </div>
        </div>
      </div>
    </div>

    <!-- 快捷操作栏：刷新、搜索、卡片缩放与筛选 -->
    <div class="flex items-center justify-between gap-3.5 mb-6 flex-wrap shrink-0">
      <div class="flex items-center gap-3 flex-wrap">
        <button
          @click="handleRefreshLocalGames(true)"
          :disabled="isScanning"
          class="px-4 py-2 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200 dark:border-white/10 rounded-xl text-xs font-bold text-slate-700 dark:text-slate-200 transition flex items-center gap-2 shadow-xs cursor-pointer disabled:opacity-50"
        >
          <RotateCw class="w-3.5 h-3.5" :class="isScanning ? 'animate-spin' : ''" />
          <span>{{ isScanning ? '扫描中...' : '刷新本地游戏' }}</span>
        </button>

        <!-- 筛选胶囊 -->
        <div class="flex items-center gap-1 bg-slate-200/70 dark:bg-slate-900/90 p-1 rounded-xl border border-slate-200 dark:border-white/10">
          <button
            @click="filterMode = 'all'"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer"
            :class="filterMode === 'all' ? 'theme-btn-primary text-white font-bold shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'"
          >
            全部已安装 ({{ localGames.length }})
          </button>
          <button
            @click="filterMode = 'downloaded'"
            class="px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer"
            :class="filterMode === 'downloaded' ? 'theme-btn-primary text-white font-bold shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'"
          >
            已下修改器 ({{ downloadedCount }})
          </button>
        </div>

        <span v-if="lastScanAt" class="text-[11px] text-slate-500 font-mono">
          扫描于 {{ formatTimeAgo(lastScanAt) }}
        </span>
      </div>

      <div class="flex items-center gap-3.5 flex-1 max-w-lg justify-end">
        <div class="relative flex-1">
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索本地游戏名称或 AppID..."
            class="w-full bg-white dark:bg-slate-900/90 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 pl-9 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 focus:outline-none focus:border-sky-500 transition font-mono shadow-xs"
          />
          <Search class="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400 pointer-events-none" />
        </div>

        <span class="text-xs font-mono text-slate-600 dark:text-slate-400 bg-white dark:bg-slate-900/80 px-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 shrink-0 shadow-xs">
          共 <strong class="text-slate-900 dark:text-slate-100 font-bold">{{ filteredGames.length }}</strong> 款
        </span>
      </div>
    </div>

    <!-- 本地游戏卡片展示区 -->
    <div class="space-y-4 flex-1">
      <!-- 列表折叠控制与缩放滑块 -->
      <div
        @click="isCollapsed = !isCollapsed"
        class="flex items-center justify-between gap-4 flex-wrap bg-white dark:bg-slate-900/80 hover:bg-slate-50/80 dark:hover:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-white/10 transition cursor-pointer select-none group shadow-xs"
      >
        <div class="flex items-center gap-2.5">
          <Library class="w-5 h-5 text-sky-500 group-hover:scale-110 transition-transform" />
          <h4 class="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <span>本地已安装游戏展台</span>
            <span class="text-xs text-slate-500 dark:text-slate-400 font-normal group-hover:text-slate-700 dark:group-hover:text-slate-300 transition-colors">
              ({{ isCollapsed ? '已折叠收起，点击展开' : '点击标题折叠收起' }})
            </span>
          </h4>
          <span class="text-xs px-2.5 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 font-mono font-bold border border-sky-500/20">
            {{ filteredGames.length }} 款
          </span>
        </div>

        <div class="flex items-center gap-3" @click.stop>
          <!-- 视图模式切换：网格展台 / 紧凑列表 -->
          <div class="flex items-center bg-slate-200/70 dark:bg-slate-900/90 p-1 rounded-xl border border-slate-200 dark:border-white/10 gap-1">
            <button
              @click="viewMode = 'grid'"
              class="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              :class="viewMode === 'grid' ? 'theme-btn-primary text-white font-bold shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'"
              title="卡片网格展台"
            >
              <LayoutGrid class="w-3.5 h-3.5" />
              <span>网格</span>
            </button>
            <button
              @click="viewMode = 'list'"
              class="px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
              :class="viewMode === 'list' ? 'theme-btn-primary text-white font-bold shadow-xs' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'"
              title="紧凑列表模式"
            >
              <List class="w-3.5 h-3.5" />
              <span>列表</span>
            </button>
          </div>

          <span class="text-xs text-slate-500 dark:text-slate-400 font-medium hidden sm:flex items-center gap-1.5">
            <Sliders class="w-3.5 h-3.5" />
            <span>卡片大小:</span>
          </span>

          <div class="hidden sm:flex items-center gap-2">
            <button
              @click="cardScale = Math.max(70, cardScale - 10)"
              class="w-6 h-6 rounded-lg bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center text-xs font-bold transition cursor-pointer"
              title="缩小卡片"
            >
              -
            </button>
            <input
              v-model.number="cardScale"
              type="range"
              min="70"
              max="130"
              step="5"
              class="w-20 accent-sky-500 cursor-pointer"
            />
            <button
              @click="cardScale = Math.min(130, cardScale + 10)"
              class="w-6 h-6 rounded-lg bg-slate-200/80 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center justify-center text-xs font-bold transition cursor-pointer"
              title="放大卡片"
            >
              +
            </button>
            <span class="text-xs font-mono text-slate-700 dark:text-slate-300 w-9 text-right font-semibold">
              {{ cardScale }}%
            </span>
          </div>

          <button
            @click="isCollapsed = !isCollapsed"
            class="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center transition cursor-pointer ml-1"
            :title="isCollapsed ? '展开游戏列表' : '收起游戏列表'"
          >
            <ChevronUp v-if="!isCollapsed" class="w-4 h-4 text-sky-500" />
            <ChevronDown v-else class="w-4 h-4 text-slate-400" />
          </button>
        </div>
      </div>

      <!-- 游戏展示内容区 -->
      <transition
        enter-active-class="transition-all duration-300 ease-out"
        leave-active-class="transition-all duration-200 ease-in"
        enter-from-class="opacity-0 -translate-y-2 max-h-0"
        enter-to-class="opacity-100 translate-y-0 max-h-[5000px]"
        leave-from-class="opacity-100 translate-y-0 max-h-[5000px]"
        leave-to-class="opacity-0 -translate-y-2 max-h-0"
      >
        <div v-show="!isCollapsed" class="space-y-4">
          <!-- 空状态 -->
          <div v-if="filteredGames.length === 0" class="flex flex-col items-center justify-center py-16 text-slate-400 bg-white dark:bg-slate-900/40 rounded-3xl border border-slate-200 dark:border-white/5">
            <div class="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 flex items-center justify-center mb-3 text-slate-500 dark:text-slate-400">
              <Library class="w-8 h-8" />
            </div>
            <p class="text-base font-bold text-slate-800 dark:text-slate-200 mb-1">未检测到符合条件的本地游戏</p>
            <p class="text-xs text-slate-500 dark:text-slate-400 max-w-md text-center leading-relaxed">
              请确认 Steam 客户端已安装游戏，或点击右上角「手动查游戏」输入任意 AppID 检索。
            </p>
          </div>

          <!-- 模式 1: 紧凑卡片网格展台 (3~4 列，高质感 112px 封面) -->
          <div
            v-else-if="viewMode === 'grid'"
            class="grid gap-3.5 pb-8 transition-all duration-200"
            :class="{
              'grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6': cardScale <= 85,
              'grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5': cardScale > 85 && cardScale <= 105,
              'grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4': cardScale > 105
            }"
          >
            <div
              v-for="game in filteredGames"
              :key="game.appId"
              class="game-card-surface flex flex-col justify-between group overflow-hidden border border-slate-200 dark:border-white/10 rounded-2xl bg-white dark:bg-slate-900 shadow-sm hover:shadow-md hover:border-amber-500/40 transition-all duration-200"
            >
              <!-- 顶部横版封面 (高度固定 112px，比例匀称，绝不过大) -->
              <div class="relative w-full h-28 bg-slate-950 overflow-hidden shrink-0">
                <img
                  :src="'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/' + game.appId + '/capsule_616x353.jpg'"
                  class="w-full h-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.06]"
                  loading="lazy"
                  @error="handleCardImgError($event, game.appId)"
                />
                <div class="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-slate-950/20 to-transparent pointer-events-none"></div>

                <!-- 左上角修改器状态徽章 -->
                <div class="absolute top-2 left-2">
                  <span
                    v-if="trainerStatuses[game.appId]?.isRunning"
                    class="px-2 py-0.5 rounded-lg bg-emerald-500/90 text-white dark:text-slate-950 text-[10px] font-bold shadow-sm flex items-center gap-1 animate-pulse"
                  >
                    <span class="w-1.5 h-1.5 rounded-full bg-white dark:bg-slate-950"></span>
                    <span>运行中</span>
                  </span>
                  <span
                    v-else-if="trainerStatuses[game.appId]?.isDownloaded"
                    class="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 backdrop-blur-md text-[10px] font-bold shadow-sm"
                  >
                    已就绪
                  </span>
                  <span
                    v-else-if="trainerInfos[game.appId]?.matched"
                    class="px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 backdrop-blur-md text-[10px] font-bold shadow-sm"
                  >
                    官方支持
                  </span>
                </div>

                <!-- 右上角 AppID 胶囊 -->
                <div class="absolute top-2 right-2 px-2 py-0.5 rounded-lg bg-slate-950/80 backdrop-blur-md border border-white/10 text-[10px] font-mono text-amber-400 font-bold shadow-sm">
                  ID: {{ game.appId }}
                </div>
              </div>

              <!-- 卡片信息主体 (紧凑设计) -->
              <div class="p-3 flex-1 flex flex-col justify-between gap-2.5">
                <div class="space-y-0.5">
                  <h4 class="font-bold text-xs text-slate-800 dark:text-slate-100 truncate group-hover:text-amber-500 dark:group-hover:text-amber-400 transition-colors" :title="game.name">
                    {{ game.name }}
                  </h4>
                  <p class="text-[11px] text-slate-500 dark:text-slate-400 truncate flex items-center gap-1" :title="game.installDir">
                    <span class="shrink-0 text-slate-400 dark:text-slate-500">目录:</span>
                    <span class="text-slate-600 dark:text-slate-300 font-mono truncate">{{ game.installDir }}</span>
                  </p>
                </div>

                <!-- 模块一：风灵月影修改器专区 (紧凑设计) -->
                <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-white/5 space-y-1.5">
                  <div class="flex items-center justify-between text-[11px]">
                    <div class="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-200">
                      <Gamepad2 class="w-3 h-3 text-amber-500 dark:text-amber-400" />
                      <span>风灵月影修改器</span>
                    </div>

                    <span v-if="loadingTrainers[game.appId]" class="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                      <RotateCw class="w-2.5 h-2.5 animate-spin text-amber-500" />
                      <span>匹配中</span>
                    </span>
                    <span v-else-if="trainerInfos[game.appId]?.matched" class="text-[10px] text-amber-600 dark:text-amber-300 font-mono truncate max-w-[120px]" :title="trainerInfos[game.appId]?.version">
                      {{ trainerInfos[game.appId]?.cheatsCount ? `${trainerInfos[game.appId]?.cheatsCount}项修改` : '已收录' }}
                    </span>
                    <span v-else-if="trainerInfos[game.appId] && !trainerInfos[game.appId]?.matched" class="text-[10px] text-slate-400 dark:text-slate-500 font-mono">
                      暂未收录
                    </span>
                  </div>

                  <!-- 修改器操作按钮组 -->
                  <div class="flex items-center gap-1.5">
                    <button
                      v-if="trainerStatuses[game.appId]?.isDownloaded"
                      @click="handleLaunchTrainer(game.appId)"
                      :disabled="actionLoadings[`trainer_launch_${game.appId}`]"
                      class="flex-1 py-1.5 px-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 active:bg-emerald-600 text-white font-bold text-[11px] transition cursor-pointer flex items-center justify-center gap-1 shadow-sm disabled:opacity-50"
                    >
                      <Play class="w-3 h-3 fill-current" />
                      <span>启动修改器</span>
                    </button>

                    <button
                      v-else-if="trainerInfos[game.appId]?.matched"
                      @click="handleDownloadTrainer(game)"
                      :disabled="actionLoadings[`trainer_download_${game.appId}`]"
                      class="flex-1 py-1.5 px-2 rounded-lg bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-white font-bold text-[11px] transition cursor-pointer flex items-center justify-center gap-1 shadow-sm disabled:opacity-50"
                    >
                      <Download class="w-3 h-3" :class="actionLoadings[`trainer_download_${game.appId}`] ? 'animate-bounce' : ''" />
                      <span>{{ actionLoadings[`trainer_download_${game.appId}`] ? '下载中' : '一键下载' }}</span>
                    </button>

                    <button
                      v-else
                      @click="fetchTrainerInfoForGame(game, true)"
                      :disabled="loadingTrainers[game.appId]"
                      class="flex-1 py-1.5 px-2 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-medium text-[11px] transition cursor-pointer flex items-center justify-center gap-1 border border-slate-200 dark:border-white/5 disabled:opacity-50"
                    >
                      <Search class="w-3 h-3 text-slate-400" />
                      <span>检索</span>
                    </button>

                    <button
                      v-if="trainerInfos[game.appId]?.cheats?.length"
                      @click="openCheatsModal(game)"
                      class="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition cursor-pointer border border-slate-200 dark:border-white/10"
                      title="查看修改项快捷键图鉴"
                    >
                      <ListChecks class="w-3.5 h-3.5 text-amber-500 dark:text-amber-400" />
                    </button>

                    <button
                      v-if="trainerStatuses[game.appId]?.isDownloaded"
                      @click="handleOpenTrainerDir(game.appId)"
                      class="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/80 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition cursor-pointer border border-slate-200 dark:border-white/10"
                      title="打开修改器存放目录"
                    >
                      <FolderOpen class="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  </div>
                </div>

                <!-- 模块二：Steam 全成就解锁专区 (紧凑设计) -->
                <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-white/5 space-y-1.5">
                  <div class="flex items-center justify-between text-[11px]">
                    <div class="flex items-center gap-1 font-bold text-slate-700 dark:text-slate-200">
                      <Trophy class="w-3 h-3 text-sky-500 dark:text-sky-400" />
                      <span>Steam 全成就解锁</span>
                    </div>

                    <span v-if="loadingAchievements[game.appId]" class="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                      <RotateCw class="w-2.5 h-2.5 animate-spin text-sky-500" />
                      <span>解析中</span>
                    </span>
                    <span v-else-if="achievementData[game.appId]" class="text-[10px] text-sky-600 dark:text-sky-300 font-mono">
                      共 {{ achievementData[game.appId]?.count || 0 }} 项成就
                    </span>
                    <span v-else class="text-[10px] text-sky-600 dark:text-sky-400/80 font-mono">
                      支持一键全点亮
                    </span>
                  </div>

                  <!-- 成就操作按钮组：突出「一键解锁成就」 -->
                  <div class="flex items-center gap-1.5">
                    <button
                      @click="handleLaunchSam(game.appId)"
                      class="flex-1 py-1.5 px-2 rounded-lg bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-white font-bold text-[11px] transition cursor-pointer flex items-center justify-center gap-1 shadow-sm"
                      title="一键打开成就解锁器：可一键批量点亮 100% 全成就徽章或挑选指定成就解锁，Steam 客户端实时同步跳杯"
                    >
                      <Rocket class="w-3 h-3" />
                      <span>一键解锁成就</span>
                    </button>

                    <button
                      @click="openAchievementsModal(game)"
                      class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-semibold transition cursor-pointer border border-slate-200 dark:border-white/10 flex items-center gap-1"
                      title="浏览该游戏官方全量成就图鉴与全球达成率"
                    >
                      <Eye class="w-3 h-3 text-sky-500 dark:text-sky-400" />
                      <span>图鉴</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 模式 2: 紧凑列表模式 (极简高效，浏览多款游戏极速无感) -->
          <div v-else class="space-y-2 pb-8">
            <div
              v-for="game in filteredGames"
              :key="game.appId"
              class="p-2.5 px-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 hover:border-amber-500/40 transition flex items-center justify-between gap-4 group flex-wrap sm:flex-nowrap shadow-sm"
            >
              <!-- 封面 + 游戏名 + 路径 -->
              <div class="flex items-center gap-3 min-w-0 flex-1">
                <div class="relative w-16 h-8 rounded-lg overflow-hidden bg-slate-950 shrink-0 border border-slate-200 dark:border-white/10 shadow-sm">
                  <img
                    :src="'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/' + game.appId + '/capsule_184x69.jpg'"
                    class="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    loading="lazy"
                    @error="handleCardImgError($event, game.appId)"
                  />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <h4 class="font-bold text-xs text-slate-800 dark:text-slate-100 truncate group-hover:text-amber-500 dark:group-hover:text-amber-400 transition-colors" :title="game.name">
                      {{ game.name }}
                    </h4>
                    <span class="text-[10px] px-1.5 py-0.5 rounded font-mono bg-slate-100 dark:bg-white/5 text-amber-600 dark:text-amber-400 border border-slate-200 dark:border-white/10 shrink-0">ID: {{ game.appId }}</span>
                    <span v-if="trainerStatuses[game.appId]?.isRunning" class="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-emerald-500 text-white animate-pulse shrink-0">运行中</span>
                    <span v-else-if="trainerStatuses[game.appId]?.isDownloaded" class="text-[10px] px-1.5 py-0.5 rounded-full font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30 shrink-0">修改器就绪</span>
                  </div>
                  <p class="text-[10px] text-slate-500 dark:text-slate-400 font-mono truncate mt-0.5" :title="game.installDir">{{ game.installDir }}</p>
                </div>
              </div>

              <!-- 右侧快捷按钮栏 -->
              <div class="flex items-center gap-2.5 shrink-0">
                <!-- 修改器 -->
                <div class="flex items-center gap-1 bg-slate-50 dark:bg-slate-950/60 p-1 rounded-xl border border-slate-200/80 dark:border-white/5">
                  <button
                    v-if="trainerStatuses[game.appId]?.isDownloaded"
                    @click="handleLaunchTrainer(game.appId)"
                    class="px-2 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer shadow-sm"
                  >
                    <Play class="w-3 h-3 fill-current" />
                    <span>启动修改器</span>
                  </button>
                  <button
                    v-else-if="trainerInfos[game.appId]?.matched"
                    @click="handleDownloadTrainer(game)"
                    class="px-2 py-1 rounded-lg bg-amber-500 hover:bg-amber-400 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer shadow-sm"
                  >
                    <Download class="w-3 h-3" />
                    <span>下修改器</span>
                  </button>
                  <button
                    v-else
                    @click="fetchTrainerInfoForGame(game, true)"
                    class="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-[11px] font-medium cursor-pointer"
                  >
                    <span>查修改器</span>
                  </button>
                  <button
                    v-if="trainerInfos[game.appId]?.cheats?.length"
                    @click="openCheatsModal(game)"
                    class="p-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-amber-600 dark:text-amber-400 cursor-pointer"
                    title="查看修改项快捷键"
                  >
                    <ListChecks class="w-3.5 h-3.5" />
                  </button>
                </div>

                <!-- 成就解锁 -->
                <div class="flex items-center gap-1.5 bg-slate-50 dark:bg-slate-950/60 p-1 rounded-xl border border-slate-200/80 dark:border-white/5">
                  <button
                    @click="handleLaunchSam(game.appId)"
                    class="px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-white font-bold text-[11px] flex items-center gap-1 cursor-pointer shadow-sm"
                    title="一键打开成就解锁器：可一键批量点亮 100% 全成就徽章或挑选指定成就解锁"
                  >
                    <Rocket class="w-3 h-3" />
                    <span>一键解锁成就</span>
                  </button>
                  <button
                    @click="openAchievementsModal(game)"
                    class="px-2 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                    title="查看官方全量成就图鉴与全球达成率"
                  >
                    <Eye class="w-3 h-3 text-sky-500 dark:text-sky-400" />
                    <span>图鉴</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </transition>
    </div>

    <!-- ============================================== -->
    <!-- 弹窗 1: 修改器修改项功能图鉴弹窗 -->
    <!-- ============================================== -->
    <div
      v-if="showCheatsModal && activeModalGame"
      class="fixed inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
    >
      <div class="guide-modal-card rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <!-- 弹窗头部 -->
        <div class="p-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between shrink-0 bg-slate-50/70 dark:bg-slate-950/40">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 dark:text-amber-400 font-bold">
              <Gamepad2 class="w-5 h-5" />
            </div>
            <div>
              <h3 class="font-bold text-slate-800 dark:text-slate-100 text-base flex items-center gap-2">
                <span>{{ activeModalGame.name }}</span>
                <span class="text-xs text-amber-600 dark:text-amber-400 font-mono font-normal">修改器图鉴</span>
              </h3>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                版本: {{ trainerInfos[activeModalGame.appId]?.version || '官方最新版' }} · 共 {{ trainerInfos[activeModalGame.appId]?.cheats?.length || 0 }} 项功能
              </p>
            </div>
          </div>
          <button
            @click="showCheatsModal = false"
            class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 flex items-center justify-center transition cursor-pointer"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <!-- 搜索过滤条 -->
        <div class="p-4 border-b border-slate-200 dark:border-white/5 bg-slate-50/40 dark:bg-slate-950/20 shrink-0">
          <div class="relative">
            <input
              v-model="cheatSearchQuery"
              type="text"
              placeholder="搜索快捷键或修改功能（如 无限生命、金钱、速度）..."
              class="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2 pl-9 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-amber-400 transition"
            />
            <Search class="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
          </div>
        </div>

        <!-- 快捷键列表内容区 -->
        <div class="p-5 flex-1 overflow-y-auto space-y-2.5">
          <div
            v-for="(cheat, idx) in filteredCheats"
            :key="idx"
            class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/40 border border-slate-200/80 dark:border-white/5 flex items-center justify-between gap-3 hover:border-amber-500/30 transition"
          >
            <div class="flex items-center gap-2.5 min-w-0">
              <span class="px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-300 border border-amber-500/25 font-mono text-xs font-bold shrink-0">
                {{ cheat.hotkey }}
              </span>
              <div class="min-w-0">
                <p class="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{{ cheat.descriptionZh }}</p>
                <p class="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">{{ cheat.descriptionEn }}</p>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部快捷启动栏 -->
        <div class="p-4 border-t border-slate-200 dark:border-white/10 flex items-center justify-between gap-3 bg-slate-50/70 dark:bg-slate-950/40 shrink-0">
          <span class="text-xs text-slate-500 dark:text-slate-400 font-mono">
            提示：游戏中直接按下对应按键即可生效/关闭
          </span>
          <div class="flex items-center gap-2">
            <button
              v-if="trainerStatuses[activeModalGame.appId]?.isDownloaded"
              @click="handleLaunchTrainer(activeModalGame.appId)"
              class="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <Play class="w-3.5 h-3.5 fill-current" />
              <span>立即拉起修改器</span>
            </button>
            <button
              v-else-if="trainerInfos[activeModalGame.appId]?.matched"
              @click="handleDownloadTrainer(activeModalGame)"
              class="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-bold text-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <Download class="w-3.5 h-3.5" />
              <span>下载修改器</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ============================================== -->
    <!-- 弹窗 2: Steam 成就图鉴详情弹窗 -->
    <!-- ============================================== -->
    <div
      v-if="showAchievementsModal && activeModalGame"
      class="fixed inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
    >
      <div class="guide-modal-card rounded-3xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        <!-- 头部 -->
        <div class="p-5 border-b border-slate-200 dark:border-white/10 flex items-center justify-between shrink-0 bg-slate-50/70 dark:bg-slate-950/40">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-500 dark:text-sky-400 font-bold">
              <Trophy class="w-5 h-5" />
            </div>
            <div>
              <h3 class="font-bold text-slate-800 dark:text-slate-100 text-base flex items-center gap-2">
                <span>{{ activeModalGame.name }}</span>
                <span class="text-xs px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-300 font-bold border border-sky-500/20">官方成就图鉴与一键解锁</span>
              </h3>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                共收录 {{ achievementData[activeModalGame.appId]?.count || 0 }} 项成就 · 支持自选解锁或一键点亮 100% 全成就徽章
              </p>
            </div>
          </div>
          <button
            @click="showAchievementsModal = false"
            class="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 flex items-center justify-center transition cursor-pointer"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <!-- 搜索过滤条 -->
        <div class="p-4 border-b border-slate-200 dark:border-white/5 bg-slate-50/40 dark:bg-slate-950/20 shrink-0">
          <div class="relative">
            <input
              v-model="achievementSearchQuery"
              type="text"
              placeholder="搜索成就名称或达成条件..."
              class="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2 pl-9 text-xs text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-sky-400 transition"
            />
            <Search class="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
          </div>
        </div>

        <!-- 成就列表区 -->
        <div class="p-5 flex-1 overflow-y-auto space-y-3">
          <div
            v-if="loadingAchievements[activeModalGame.appId]"
            class="py-12 flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 gap-2"
          >
            <RotateCw class="w-6 h-6 animate-spin text-sky-500" />
            <p class="text-xs font-mono">正在连接 Steam 社区解析官方成就数据...</p>
          </div>

          <div
            v-else-if="filteredAchievements.length === 0"
            class="py-12 px-6 text-center text-slate-500 dark:text-slate-400 text-xs flex flex-col items-center justify-center gap-2.5"
          >
            <div class="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400">
              <Trophy class="w-6 h-6" />
            </div>
            <p class="font-bold text-slate-800 dark:text-slate-200 text-sm">暂未检索到成就项或受 Steam 社区网络限制</p>
            <p class="max-w-md text-slate-500 dark:text-slate-400 leading-relaxed text-[11px]">
              Steam 官方成就<strong>无需下载安装游戏</strong>即可直接解锁！若图鉴数据因国内网络限制未即刻载入，可直接点击右下角「🚀 打开解锁器」，解锁器直接通过 Steam 本地客户端原生通讯一键点亮全量成就！
            </p>
          </div>

          <div
            v-else
            v-for="(ach, idx) in filteredAchievements"
            :key="idx"
            class="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/50 border border-slate-200/80 dark:border-white/5 flex items-center gap-3.5 hover:border-sky-500/30 transition group"
          >
            <!-- 成就高清图标 -->
            <div class="w-14 h-14 rounded-xl bg-slate-200/80 dark:bg-slate-900 overflow-hidden shrink-0 border border-slate-200 dark:border-white/10 shadow-md">
              <img
                :src="ach.icon"
                class="w-full h-full object-cover group-hover:scale-105 transition-transform"
                loading="lazy"
                @error="($event.target as HTMLElement).style.display = 'none'"
              />
            </div>

            <!-- 成就文字信息 -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center justify-between gap-2 mb-1">
                <h4 class="font-bold text-sm text-slate-800 dark:text-slate-100 truncate group-hover:text-sky-500 dark:group-hover:text-sky-300 transition-colors">
                  {{ ach.title }}
                </h4>
                <span class="text-xs font-mono text-sky-600 dark:text-sky-400 font-bold shrink-0">
                  {{ ach.percent }} 玩家达成
                </span>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                {{ ach.description || '隐藏成就，达成前不展示解锁描述' }}
              </p>

              <!-- 全球达成百分比进度条 -->
              <div class="w-full h-1 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden mt-2">
                <div
                  class="h-full bg-sky-500 rounded-full"
                  :style="{ width: ach.percent }"
                ></div>
              </div>
            </div>
          </div>
        </div>

        <!-- 底部快捷栏：明确全成就点亮指引与唤起按钮 -->
        <div class="p-4 border-t border-slate-200 dark:border-white/10 flex items-center justify-between gap-4 bg-slate-50/70 dark:bg-slate-950/40 shrink-0 flex-wrap sm:flex-nowrap">
          <div class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <span class="w-2 h-2 rounded-full bg-sky-500 shrink-0"></span>
            <span><strong>一键解锁提示：</strong>点击右侧拉起解锁器，在弹出窗口中勾选全部并点击锁图标保存，Steam 客户端<strong>即刻同步跳杯</strong>！</span>
          </div>
          <button
            @click="handleLaunchSam(activeModalGame.appId)"
            class="px-4 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 active:bg-sky-600 text-white font-bold text-xs transition cursor-pointer flex items-center gap-1.5 shadow-sm shrink-0"
          >
            <Rocket class="w-3.5 h-3.5" />
            <span>🚀 打开解锁器 (一键点亮全成就)</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ============================================== -->
    <!-- 弹窗 3: SAM 成就解锁引擎安装与状态弹窗 -->
    <!-- ============================================== -->
    <div
      v-if="showSamModal"
      class="fixed inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
    >
      <div class="guide-modal-card rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <div class="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-3">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 dark:text-amber-400 font-bold">
              <Trophy class="w-4 h-4" />
            </div>
            <div>
              <h3 class="font-bold text-sm text-slate-800 dark:text-slate-100">Steam 全成就一键解锁引擎 (SAM)</h3>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">Steam Achievement Manager 官方沙盒内核</p>
            </div>
          </div>
          <button
            @click="showSamModal = false"
            class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 flex items-center justify-center cursor-pointer"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </div>

        <div class="space-y-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          <p>
            这是全球公认且最受信赖的 <strong class="text-sky-600 dark:text-sky-300">Steam 成就解锁与重置引擎</strong>：
          </p>
          <div class="p-3.5 rounded-2xl bg-sky-50/80 dark:bg-sky-950/30 border border-sky-200/80 dark:border-sky-500/20 space-y-2">
            <div class="flex items-start gap-2">
              <span class="text-sky-500 font-bold shrink-0 text-sm leading-none">✨</span>
              <span><strong class="text-slate-800 dark:text-sky-200">一键点亮 100% 全成就：</strong>只需在弹出的窗口中全选成就并保存，Steam 客户端立即实时弹出跳杯动画与全量成就勋章！</span>
            </div>
            <div class="flex items-start gap-2">
              <span class="text-amber-500 font-bold shrink-0 text-sm leading-none">🎯</span>
              <span><strong class="text-slate-800 dark:text-amber-200">自由挑选与随时重置：</strong>支持单独解锁卡关或心仪的指定成就，也可以随时撤销重置已达成的成就重新体验。</span>
            </div>
            <div class="flex items-start gap-2">
              <span class="text-emerald-500 font-bold shrink-0 text-sm leading-none">🛡️</span>
              <span><strong class="text-slate-800 dark:text-emerald-200">已默认内置嵌入 (仅 56KB)：</strong>官方原版 SAM 7.0.41 已直接预装嵌入软件，免下载、免额外安装、离线即开即用！</span>
            </div>
          </div>
        </div>

        <div class="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-white/5 space-y-2 text-xs">
          <div class="flex items-center justify-between">
            <span class="text-slate-500 dark:text-slate-400">运行状态:</span>
            <span v-if="samStatus.isInstalled" class="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
              <CheckCircle2 class="w-3.5 h-3.5" />
              <span>已内置就绪 (v{{ samStatus.version || '7.0.41' }})</span>
            </span>
            <span v-else class="text-amber-600 dark:text-amber-400 font-bold flex items-center gap-1">
              <AlertTriangle class="w-3.5 h-3.5" />
              <span>未检测到部署</span>
            </span>
          </div>
          <div v-if="samStatus.exePath" class="text-[11px] text-slate-500 font-mono truncate" :title="samStatus.exePath">
            {{ samStatus.exePath }}
          </div>
        </div>

        <div class="flex items-center gap-3 pt-2">
          <button
            @click="handleInstallSam"
            :disabled="actionLoadings['install_sam']"
            class="flex-1 py-2.5 rounded-xl font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
            :class="samStatus.isInstalled ? 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-white/10' : 'bg-amber-500 hover:bg-amber-400 text-white'"
          >
            <Download class="w-3.5 h-3.5" :class="actionLoadings['install_sam'] ? 'animate-bounce' : ''" />
            <span>{{ actionLoadings['install_sam'] ? '正在校验/更新引擎...' : (samStatus.isInstalled ? '重新校验/更新解锁核心' : '一键极速安装解锁引擎') }}</span>
          </button>

          <button
            v-if="samStatus.isInstalled"
            @click="handleOpenSamDir"
            class="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs transition cursor-pointer border border-slate-200 dark:border-white/10"
            title="打开所在目录"
          >
            <FolderOpen class="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- ============================================== -->
    <!-- 弹窗 4: 手动查询未安装游戏修改器与成就 -->
    <!-- ============================================== -->
    <div
      v-if="showCustomGameModal"
      class="fixed inset-0 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
    >
      <div class="guide-modal-card rounded-3xl w-full max-w-md shadow-2xl overflow-hidden p-6 space-y-4 animate-in fade-in zoom-in-95 duration-200">
        <div class="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-3">
          <div class="flex items-center gap-2.5">
            <div class="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-500 dark:text-sky-400 font-bold">
              <Search class="w-4 h-4" />
            </div>
            <div>
              <h3 class="font-bold text-sm text-slate-800 dark:text-slate-100">手动查游戏修改器与成就</h3>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">支持检索未在 Steam 安装的任意游戏</p>
            </div>
          </div>
          <button
            @click="showCustomGameModal = false"
            class="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 flex items-center justify-center cursor-pointer"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </div>

        <div class="space-y-3 text-xs">
          <div>
            <label class="block text-slate-700 dark:text-slate-300 font-semibold mb-1">游戏英文原名 (如 Cyberpunk 2077 / Elden Ring):</label>
            <input
              v-model="customGameInputName"
              type="text"
              placeholder="请输入游戏官方英文名..."
              class="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2 text-slate-800 dark:text-slate-200 font-mono focus:outline-none focus:border-amber-400"
            />
          </div>

          <div>
            <label class="block text-slate-700 dark:text-slate-300 font-semibold mb-1">Steam AppID (选填):</label>
            <input
              v-model.number="customGameInputAppId"
              type="number"
              placeholder="例如 1091500"
              class="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2 text-slate-800 dark:text-slate-200 font-mono focus:outline-none focus:border-amber-400"
            />
          </div>
        </div>

        <div class="pt-2">
          <button
            @click="handleCustomQuery"
            :disabled="!customGameInputName && !customGameInputAppId"
            class="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-white font-bold text-xs transition cursor-pointer flex items-center justify-center gap-1.5 disabled:opacity-50"
          >
            <Search class="w-3.5 h-3.5" />
            <span>立即检索并查看</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue';
import {
  Trophy,
  Gamepad2,
  Award,
  Play,
  Download,
  Search,
  RotateCw,
  FolderOpen,
  Library,
  Sliders,
  ChevronDown,
  ChevronUp,
  X,
  ListChecks,
  Eye,
  Rocket,
  CheckCircle2,
  AlertTriangle,
  LayoutGrid,
  List
} from 'lucide-vue-next';
import type {
  LocalInstalledGame,
  LocalGamesScanResult,
  TrainerInfo,
  TrainerStatus,
  GameAchievementsData,
  SamStatus,
  CheatItem,
  AchievementItem
} from '../../types';
import { formatIpcError } from '../api/tauriBridge';
import { steamCardImageFallback } from '../utils/imageFallback';

const emit = defineEmits<{
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
}>();

// 本地游戏列表与扫描状态
const localGames = ref<LocalInstalledGame[]>([]);
const isScanning = ref(false);
const lastScanAt = ref(0);
const searchQuery = ref('');
const cardScale = ref<number>(100);
const isCollapsed = ref(false);
const filterMode = ref<'all' | 'downloaded'>('all');
const viewMode = ref<'grid' | 'list'>('grid');

// 修改器与成就数据字典
const trainerInfos = reactive<Record<number, TrainerInfo | null>>({});
const trainerStatuses = reactive<Record<number, TrainerStatus | null>>({});
const achievementData = reactive<Record<number, GameAchievementsData | null>>({});

const loadingTrainers = reactive<Record<number, boolean>>({});
const loadingAchievements = reactive<Record<number, boolean>>({});
const actionLoadings = reactive<Record<string, boolean>>({});

// SAM 状态
const samStatus = ref<SamStatus>({
  isInstalled: false,
  exePath: null,
  version: null
});
const showSamModal = ref(false);

// 弹窗状态
const showCheatsModal = ref(false);
const showAchievementsModal = ref(false);
const showCustomGameModal = ref(false);
const activeModalGame = ref<LocalInstalledGame | null>(null);

const cheatSearchQuery = ref('');
const achievementSearchQuery = ref('');

const customGameInputName = ref('');
const customGameInputAppId = ref<number | ''>('');

const handleCardImgError = (e: Event, appId: number) => {
  steamCardImageFallback(e, appId);
};

const downloadedCount = computed(() => {
  return localGames.value.filter((g) => trainerStatuses[g.appId]?.isDownloaded).length;
});

const filteredGames = computed(() => {
  let list = localGames.value;
  if (filterMode.value === 'downloaded') {
    list = list.filter((g) => trainerStatuses[g.appId]?.isDownloaded);
  }
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (g) => g.appId.toString().includes(q) || g.name.toLowerCase().includes(q) || g.installDir.toLowerCase().includes(q)
  );
});

const filteredCheats = computed<CheatItem[]>(() => {
  if (!activeModalGame.value) return [];
  const list = trainerInfos[activeModalGame.value.appId]?.cheats || [];
  const q = cheatSearchQuery.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (c) => c.hotkey.toLowerCase().includes(q) || c.descriptionZh.toLowerCase().includes(q) || c.descriptionEn.toLowerCase().includes(q)
  );
});

const filteredAchievements = computed<AchievementItem[]>(() => {
  if (!activeModalGame.value) return [];
  const list = achievementData[activeModalGame.value.appId]?.achievements || [];
  const q = achievementSearchQuery.value.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (a) => a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
  );
});

function formatTimeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  return `${Math.floor(diff / 3600)} 小时前`;
}

// 扫描加载本地游戏
const handleRefreshLocalGames = async (force = false) => {
  isScanning.value = true;
  try {
    const res: LocalGamesScanResult = await window.electronAPI.scanLocalGames(force);
    localGames.value = res.games || [];
    lastScanAt.value = res.scannedAt || Date.now();

    // 加载本地所有已下载的修改器状态
    for (const g of localGames.value) {
      void checkTrainerStatus(g.appId);
    }
  } catch (err: any) {
    emit('notify', `扫描本地游戏失败: ${formatIpcError(err)}`, 'error');
  } finally {
    isScanning.value = false;
  }
};

// 检查本地修改器下载/运行状态
const checkTrainerStatus = async (appId: number) => {
  try {
    const st = await window.electronAPI.getTrainerStatus(appId);
    trainerStatuses[appId] = st;
  } catch {}
};

// 检索修改器
const fetchTrainerInfoForGame = async (game: LocalInstalledGame, notifyUser = false) => {
  if (loadingTrainers[game.appId]) return;
  loadingTrainers[game.appId] = true;
  try {
    const info = await window.electronAPI.matchTrainer(game.name, game.appId);
    trainerInfos[game.appId] = info;
    if (notifyUser) {
      if (info && info.matched) {
        emit('notify', `已成功匹配 ${game.name} 官方修改器 (收录 ${info.cheatsCount || 0} 项修改)`, 'success');
      } else {
        emit('notify', `暂未收录 ${game.name} 的 FLiNG 官方修改器`, 'info');
      }
    }
  } catch (e: any) {
    if (notifyUser) {
      emit('notify', `检索修改器失败: ${formatIpcError(e)}`, 'error');
    }
  } finally {
    loadingTrainers[game.appId] = false;
  }
};

// 下载修改器
const handleDownloadTrainer = async (game: LocalInstalledGame) => {
  const loadingKey = `trainer_download_${game.appId}`;
  if (actionLoadings[loadingKey]) return;
  actionLoadings[loadingKey] = true;
  emit('notify', `正在下载 ${game.name} 官方修改器...`, 'info');

  try {
    let info = trainerInfos[game.appId];
    if (!info || !info.downloadUrl) {
      info = await window.electronAPI.matchTrainer(game.name, game.appId);
      trainerInfos[game.appId] = info;
    }

    if (!info || !info.downloadUrl) {
      throw new Error('未找到有效的修改器下载地址');
    }

    const downloadUrl = info.directDownloadUrl || info.downloadUrl;
    const st = await window.electronAPI.downloadTrainer(
      game.appId,
      downloadUrl,
      `${game.name} Trainer.exe`,
      info.postUrl
    );
    trainerStatuses[game.appId] = st;
    emit('notify', `成功下载 ${game.name} 修改器，已就绪！`, 'success');
  } catch (err: any) {
    emit('notify', `下载修改器失败: ${formatIpcError(err)}`, 'error');
  } finally {
    actionLoadings[loadingKey] = false;
  }
};

// 启动修改器
const handleLaunchTrainer = async (appId: number) => {
  const loadingKey = `trainer_launch_${appId}`;
  if (actionLoadings[loadingKey]) return;
  actionLoadings[loadingKey] = true;
  try {
    await window.electronAPI.launchTrainer(appId);
    emit('notify', '已成功在独立进程中拉起风灵月影修改器！', 'success');
    await checkTrainerStatus(appId);
  } catch (err: any) {
    emit('notify', `启动修改器失败: ${formatIpcError(err)}`, 'error');
  } finally {
    actionLoadings[loadingKey] = false;
  }
};

// 打开修改器目录
const handleOpenTrainerDir = async (appId: number) => {
  try {
    await window.electronAPI.openTrainerDir(appId);
  } catch (e: any) {
    emit('notify', `打开目录失败: ${formatIpcError(e)}`, 'error');
  }
};

// 拉取成就列表
const fetchAchievementsForGame = async (game: LocalInstalledGame) => {
  if (loadingAchievements[game.appId]) return;
  loadingAchievements[game.appId] = true;
  try {
    const data = await window.electronAPI.getGameAchievements(game.appId);
    achievementData[game.appId] = data;
  } catch (e: any) {
    console.warn('拉取成就失败:', e);
  } finally {
    loadingAchievements[game.appId] = false;
  }
};

// 打开修改项图鉴弹窗
const openCheatsModal = async (game: LocalInstalledGame) => {
  activeModalGame.value = game;
  cheatSearchQuery.value = '';
  showCheatsModal.value = true;
  if (!trainerInfos[game.appId]) {
    await fetchTrainerInfoForGame(game);
  }
};

// 打开成就图鉴弹窗
const openAchievementsModal = async (game: LocalInstalledGame) => {
  activeModalGame.value = game;
  achievementSearchQuery.value = '';
  showAchievementsModal.value = true;
  if (!achievementData[game.appId]) {
    await fetchAchievementsForGame(game);
  }
};

// 检查 SAM 状态
const checkSamStatus = async () => {
  try {
    samStatus.value = await window.electronAPI.getSamStatus();
  } catch {}
};

// 启动 SAM
const handleLaunchSam = async (appId: number) => {
  if (!samStatus.value.isInstalled) {
    showSamModal.value = true;
    emit('notify', '请先点击一键部署 Steam 全成就解锁引擎 (SAM)', 'warning');
    return;
  }
  try {
    await window.electronAPI.launchSamForGame(appId);
    emit('notify', `已成功唤起成就解锁器！在弹出窗口中勾选全部并点击锁图标保存，即可一键点亮全成就！`, 'success');
  } catch (err: any) {
    emit('notify', `唤起成就解锁器失败: ${formatIpcError(err)}`, 'error');
  }
};

// 安装 SAM
const handleInstallSam = async () => {
  actionLoadings['install_sam'] = true;
  emit('notify', '正在高速下载并部署 Steam 全成就解锁引擎...', 'info');
  try {
    const res = await window.electronAPI.downloadSam();
    samStatus.value = res;
    emit('notify', '成就解锁引擎部署完毕！现在可针对任意游戏一键点亮全成就。', 'success');
  } catch (err: any) {
    emit('notify', `部署成就解锁引擎失败: ${formatIpcError(err)}`, 'error');
  } finally {
    actionLoadings['install_sam'] = false;
  }
};

// 打开 SAM 目录
const handleOpenSamDir = async () => {
  try {
    await window.electronAPI.openSamDir();
  } catch (e: any) {
    emit('notify', `打开 SAM 目录失败: ${formatIpcError(e)}`, 'error');
  }
};

// 手动查询自定义游戏
const handleCustomQuery = async () => {
  const name = customGameInputName.value.trim();
  const rawAppId = customGameInputAppId.value;
  // 守卫必须先于默认值填充：原实现先把 appId 赋成 9999999，
  // 导致下一行 `if (!name && !appId)` 恒为 false，守卫完全失效。
  if (!name && !rawAppId) return;
  const appId = rawAppId ? Number(rawAppId) : 9999999;

  const mockGame: LocalInstalledGame = {
    appId,
    name: name || `AppID_${appId}`,
    installDir: '手动检索',
    fullInstallPath: '',
    libraryPath: '',
    executableFiles: []
  };

  showCustomGameModal.value = false;
  activeModalGame.value = mockGame;
  showCheatsModal.value = true;
  await fetchTrainerInfoForGame(mockGame, true);
};

onMounted(async () => {
  await checkSamStatus();
  await handleRefreshLocalGames(false);

  // 默认对前 5 款本地游戏后台静默预先匹配修改器与成就信息
  for (const g of localGames.value.slice(0, 5)) {
    void fetchTrainerInfoForGame(g);
    void fetchAchievementsForGame(g);
  }
});
</script>

<style scoped>
.game-card-surface {
  backdrop-filter: blur(12px);
}
</style>
