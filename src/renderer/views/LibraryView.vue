<template>
  <div class="h-full flex flex-col p-6 xl:p-8 overflow-hidden">
    <!-- 头部统计与操作 -->
    <div class="flex items-center justify-between mb-5 flex-wrap gap-3.5 shrink-0">
      <div>
        <h2 class="text-2xl font-bold text-slate-100 flex items-center gap-3">
          <Library class="w-7 h-7 theme-text-accent" />
          <span>已入库规则管理</span>
          <span class="text-xs px-3 py-1 rounded-full bg-sky-500/10 theme-text-accent font-mono font-bold border border-sky-500/20">
            {{ unlockedGames.length }} 款应用
          </span>
        </h2>
        <p class="text-xs text-slate-400 mt-1">
          OpenSteamTool 标准规则目录：<code class="text-slate-300 font-mono bg-slate-900 px-2.5 py-0.5 rounded-md border border-slate-800">config/lua/*.lua</code>
        </p>
      </div>

      <div class="flex items-center gap-2.5">
        <button
          v-if="unlockedGames.length > 0"
          @click="handleCheckUpdates(false)"
          :disabled="checkingUpdates"
          class="px-4 py-2.5 bg-amber-500/10 hover:bg-amber-500/25 hover:border-amber-400/50 border border-amber-500/30 text-amber-300 hover:text-amber-200 rounded-xl text-xs font-semibold transition flex items-center gap-2 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed hover-lift"
          title="逐个对比已入库规则的清单版本与云端最新版本（实时查询，游戏越多耗时越长）"
        >
          <ArrowUpCircle v-if="checkingUpdates" class="w-4 h-4 animate-pulse" />
          <CloudDownload v-else class="w-4 h-4" />
          <span>{{ checkingUpdates ? '检查中...' : '检查更新' }}</span>
          <span
            v-if="updatableCount > 0"
            class="px-1.5 py-0.5 rounded-full bg-amber-500/30 text-amber-200 font-mono font-bold text-[10px]"
          >
            {{ updatableCount }}
          </span>
        </button>

        <button
          v-if="unlockedGames.length > 0"
          @click="handleClearAll"
          class="px-4 py-2.5 bg-rose-950/40 hover:bg-rose-900/70 hover:border-rose-500/60 hover:text-rose-200 border border-rose-800/60 text-rose-300 rounded-xl text-xs font-semibold transition flex items-center gap-2 shadow-sm hover-lift"
        >
          <Trash2 class="w-4 h-4" />
          <span>清空所有</span>
        </button>

        <button
          @click="loadLibrary"
          class="px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700 hover:border-white/25 border border-white/10 rounded-xl text-xs font-semibold text-slate-200 transition flex items-center gap-2 shadow-sm hover-lift"
        >
          <RotateCw class="w-4 h-4" />
          <span>刷新列表</span>
        </button>

        <button
          @click="handleRestartSteam"
          class="px-4 py-2.5 bg-slate-800/80 hover:bg-slate-700 border border-white/10 rounded-xl text-xs font-semibold text-slate-300 hover:text-white transition flex items-center gap-2 shadow-sm cursor-pointer"
          title="入库即时生效无须重启；仅在 Steam 偶发未识别或卡死时作为备用手段重启"
        >
          <RotateCw class="w-4 h-4 text-slate-400" />
          <span>重启 Steam (备用)</span>
        </button>
      </div>
    </div>

    <!-- 入库即时生效温馨提示横幅 -->
    <div class="mb-4 p-3.5 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-xs text-sky-200/90 flex items-start gap-3 shrink-0">
      <div class="w-5 h-5 rounded-lg bg-sky-500/20 flex items-center justify-center text-sky-400 shrink-0 mt-0.5 font-bold">
        💡
      </div>
      <div class="leading-relaxed flex-1">
        <strong class="text-sky-300 font-semibold">入库即时生效提示：</strong>
        本项目添加游戏后<strong class="text-emerald-400 font-bold">无须重启 Steam</strong>，会自动出现在库中，搜索进行下载即可。如果没有，则可能是注入环境出现问题，请在「系统与环境设置」中检测环境。
        <span class="block mt-1 text-sky-300/70">若首次点击下载提示「无网络连接 / 0 字节下载」，属清单请求码尚在获取中，等 5~10 秒<strong class="text-sky-200">再点一次下载</strong>即可正常开始。</span>
      </div>
      <button
        @click="showGuide = true"
        class="shrink-0 px-3 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
      >
        <BookOpen class="w-3.5 h-3.5" />
        <span>模式与功能指南</span>
      </button>
    </div>

    <!-- 规则管理与核心模式详解弹窗 (支持自由滑动，图文对照直观好懂) -->
    <LibraryGuideModal v-model="showGuide" />

    <!-- 搜索过滤与分级状态栏 (如果有入库游戏) -->
    <div v-if="unlockedGames.length > 0" class="mb-4 flex items-center justify-between gap-3 flex-wrap shrink-0">
      <div class="flex items-center gap-3 flex-1 min-w-[280px]">
        <div class="relative flex-1 max-w-md">
          <input
            v-model="filterKeyword"
            type="text"
            placeholder="在已入库游戏中快速过滤 (AppID / 游戏名)..."
            class="w-full bg-slate-900/80 border border-white/10 rounded-xl px-4 py-2.5 pl-10 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400/30 transition shadow-inner"
          />
          <Search class="w-4 h-4 absolute left-3.5 top-3 text-slate-400 pointer-events-none" />
        </div>

        <!-- 状态分级切换标签组 -->
        <div class="flex items-center bg-slate-900/80 p-1 rounded-xl border border-white/10 text-xs shrink-0">
          <button
            @click="statusFilter = 'all'"
            class="px-2.5 py-1 rounded-lg font-medium transition cursor-pointer"
            :class="statusFilter === 'all' ? 'bg-sky-500/20 text-sky-300 font-bold border border-sky-500/30' : 'text-slate-400 hover:text-slate-200 border border-transparent'"
          >
            全部 ({{ unlockedGames.length }})
          </button>
          <button
            @click="statusFilter = 'active'"
            class="px-2.5 py-1 rounded-lg font-medium transition flex items-center gap-1 cursor-pointer"
            :class="statusFilter === 'active' ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30' : 'text-slate-400 hover:text-slate-200 border border-transparent'"
          >
            <span>生效中</span>
            <span class="font-mono text-[10px] opacity-80">({{ activeGamesCount }})</span>
          </button>
          <button
            @click="statusFilter = 'disabled'"
            class="px-2.5 py-1 rounded-lg font-medium transition flex items-center gap-1 cursor-pointer"
            :class="statusFilter === 'disabled' ? 'bg-slate-700/50 text-slate-200 font-bold border border-slate-600/30' : 'text-slate-400 hover:text-slate-200 border border-transparent'"
          >
            <span>已停用</span>
            <span class="font-mono text-[10px] opacity-80">({{ disabledGamesCount }})</span>
          </button>
        </div>
      </div>

      <span class="text-xs text-slate-400 font-mono">显示 {{ filteredGames.length }} / {{ unlockedGames.length }} 款</span>
    </div>

    <!-- 游戏列表展示 -->
    <div class="flex-1 overflow-y-auto pr-1">
      <div v-if="unlockedGames.length === 0" class="flex flex-col items-center justify-center h-72 text-slate-400">
        <div class="w-16 h-16 rounded-2xl bg-slate-900/80 border border-white/10 flex items-center justify-center text-2xl mb-3 shadow-inner">
          <Library class="w-7 h-7 text-slate-400" />
        </div>
        <p class="text-base font-bold text-slate-200 mb-1">当前游戏库为空</p>
        <p class="text-xs text-slate-400">前往「游戏检索与入库」页面，点击任意游戏的「一键入库」即可瞬间点亮</p>
        <p class="text-[11px] text-sky-400/80 mt-2 bg-sky-500/5 px-3 py-1 rounded-full border border-sky-500/15">
          💡 提示：添加游戏后无须重启 Steam，直接在 Steam 客户端搜索下载即可
        </p>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 gap-4 pb-8">
        <div
          v-for="game in filteredGames"
          :key="game.appId"
          class="game-card-surface p-4 xl:p-4 flex flex-col justify-between gap-3.5 group transition-all"
          :class="game.isDisabled ? 'opacity-75 border-dashed border-slate-700/80 bg-slate-950/40 hover:opacity-100' : ''"
        >
          <!-- 封面小图与信息行 -->
          <div>
            <div class="flex items-center gap-3 min-w-0">
              <img
                :src="`https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/${game.appId}/capsule_184x69.jpg`"
                class="w-16 h-8 object-cover rounded-lg bg-slate-900 shadow-sm shrink-0 border border-white/10 group-hover:scale-105 transition-transform duration-300"
                loading="lazy"
                @error="handleImgError($event, game.appId)"
              />
              <div class="min-w-0 flex-1">
                <div class="font-bold text-sm text-slate-100 truncate group-hover:theme-text-accent transition-colors" :title="game.name">
                  {{ game.name }}
                </div>
                <div class="text-[11px] font-mono text-slate-400 mt-0.5">
                  AppID: <span class="text-slate-300 font-semibold">{{ game.appId }}</span>
                </div>
              </div>
            </div>

            <!-- 状态徽章栏 (独占卡片全宽横向排布，不挤压，简洁明了) -->
            <div class="flex items-center gap-1.5 mt-2.5 flex-wrap">
              <!-- 1. 运行状态 -->
              <span
                class="text-[11px] px-2 py-0.5 rounded-lg font-mono flex items-center gap-1 font-semibold border select-none"
                :class="game.isDisabled
                  ? 'bg-slate-700/40 text-slate-300 border-slate-600/30'
                  : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'"
                :title="game.isDisabled ? '已停用入库：文件在 Disable 目录' : '入库生效中：OpenSteamTool 正常识别'"
              >
                <CheckCircle2 v-if="!game.isDisabled" class="w-3 h-3 text-emerald-400" />
                <PauseCircle v-else class="w-3 h-3 text-slate-400" />
                <span>{{ game.isDisabled ? '已停用' : '已生效' }}</span>
              </span>

              <!-- 2. 密钥注入状态 (简明两字) -->
              <span
                v-if="game.hasDepotKeys"
                class="text-[11px] px-2 py-0.5 rounded-lg bg-emerald-500/15 text-emerald-400 font-mono flex items-center gap-1 border border-emerald-500/25 font-semibold select-none"
                title="已注入 Depot 解密密钥"
              >
                <Key class="w-3 h-3" />
                <span>密钥</span>
              </span>

              <!-- 3. Token 状态 -->
              <span
                v-if="game.hasToken"
                class="text-[11px] px-2 py-0.5 rounded-lg bg-purple-500/15 text-purple-400 font-mono flex items-center gap-1 border border-purple-500/25 font-semibold select-none"
                title="已配置 PICS Token"
              >
                <Zap class="w-3 h-3" />
                <span>Token</span>
              </span>

              <!-- 3.5. DLC 状态只读徽章（严格遵循顶部只放只读元数据规范，杜绝功能按钮置于卡片顶部） -->
              <span
                class="text-[11px] px-2 py-0.5 rounded-lg font-mono flex items-center gap-1 font-semibold border select-none"
                :class="dlcDiffs[game.appId]?.missingDlcs?.length
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/35 shadow-sm'
                  : 'bg-slate-700/30 text-slate-300 border-slate-600/30'"
                :title="dlcDiffs[game.appId]?.missingDlcs?.length
                  ? `发现 ${dlcDiffs[game.appId].missingDlcs.length} 个新 DLC 未入库，卡片下方可一键补全`
                  : `当前包含 ${game.dlcCount || 0} 个 DLC 分包`"
              >
                <Layers class="w-3 h-3 text-sky-400" />
                <span v-if="dlcDiffs[game.appId]?.missingDlcs?.length" class="text-amber-300 font-bold">
                  +{{ dlcDiffs[game.appId].missingDlcs.length }} 新DLC
                </span>
                <span v-else>{{ game.dlcCount || 0 }} DLC</span>
              </span>

              <!-- 4. 模式判定（权威唯一定位，彻底消除模式冲突）：跟随最新 / 已锁定 / 待缓存 / 有更新 -->
              <!-- 模式 A: 跟随最新（动态清单模式，永不跟本地旧清单混淆） -->
              <span
                v-if="!isPinned(game)"
                class="text-[11px] px-2 py-0.5 rounded-lg bg-cyan-500/15 text-cyan-400 font-mono flex items-center gap-1 border border-cyan-500/25 font-semibold select-none"
                title="跟随官方最新模式：直连 CDN 动态获取最新清单，永远自动跟进官方更新，免维护本地实体清单"
              >
                <Zap class="w-3 h-3" />
                <span>跟随最新</span>
              </span>

              <!-- 模式 B: 锁定版本（且有官方新版本待更新） -->
              <span
                v-else-if="updateStatuses[game.appId]?.hasUpdate"
                class="text-[11px] px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-400 font-mono flex items-center gap-1 border border-amber-500/30 font-semibold select-none"
                title="版本已锁定，但官方已发布新版本，点击下方「跟随」可跟进最新"
              >
                <ArrowUpCircle class="w-3 h-3" />
                <span>有更新</span>
              </span>

              <!-- 模式 C: 锁定版本（本地实体清单已就绪） -->
              <span
                v-else-if="manifestStatuses[game.appId]?.hasManifest || game.hasManifest"
                class="text-[11px] px-2 py-0.5 rounded-lg bg-slate-600/30 text-slate-300 font-mono flex items-center gap-1 border border-slate-500/30 font-semibold select-none"
                title="版本已锁定：本地 depotcache 实体清单已就绪"
              >
                <Lock class="w-3 h-3 text-slate-400" />
                <span>已锁定</span>
              </span>

              <!-- 模式 D: 锁定版本（但缺少本地实体清单，需预缓存） -->
              <span
                v-else
                class="text-[11px] px-2 py-0.5 rounded-lg bg-amber-500/15 text-amber-400 font-mono flex items-center gap-1 border border-amber-500/25 font-semibold select-none"
                title="版本已锁定，但本地 depotcache 尚未缓存实体清单，建议点击下方预缓存"
              >
                <AlertCircle class="w-3 h-3 text-amber-400" />
                <span>待缓存</span>
              </span>
            </div>
          </div>

          <!-- 操作按钮条 (统一规范化对齐排布，2字简练杜绝截断) -->
          <div class="pt-3 border-t border-white/10 space-y-2">
            <!-- 第 1 行：主要运行动作 (下载与运行，等宽对半分) -->
            <div class="grid grid-cols-2 gap-2">
              <a
                :href="`steam://install/${game.appId}`"
                title="在 Steam 客户端直接触发下载"
                class="h-8 px-3 bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 text-white text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 shadow-sm active:scale-98"
              >
                <Download class="w-3.5 h-3.5" />
                <span>下载</span>
              </a>

              <a
                :href="`steam://rungameid/${game.appId}`"
                title="在 Steam 客户端启动游戏"
                class="h-8 px-3 bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-400 text-xs font-bold rounded-xl transition flex items-center justify-center gap-1.5 active:scale-98"
              >
                <Play class="w-3.5 h-3.5 fill-current" />
                <span>运行</span>
              </a>
            </div>

            <!-- 第 2 行：规则管理动作 (版本控制、DLC检测、规则启停、移出库，均分 1/4) -->
            <div class="grid grid-cols-4 gap-1.5">
              <!-- 按钮 1: 版本策略 (锁定 / 跟随) -->
              <button
                v-if="!isPinned(game)"
                @click="handleSetVersionStrategy(game.appId, game.name, true)"
                :disabled="updatingAppId === game.appId"
                title="钉死当前官方最新版本（联机对版本用）；官方出新版后不会自动跟进"
                class="h-8 px-1 btn-soft-action text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1 active:scale-98 disabled:opacity-60 cursor-pointer"
              >
                <RotateCw v-if="updatingAppId === game.appId" class="w-3.5 h-3.5 animate-spin" />
                <Lock v-else class="w-3.5 h-3.5" />
                <span>{{ updatingAppId === game.appId ? '处理中' : '锁定' }}</span>
              </button>

              <button
                v-else
                @click="handleSetVersionStrategy(game.appId, game.name, false)"
                :disabled="updatingAppId === game.appId"
                title="解除锁定，此后每次下载自动获取官方最新清单，无须再手动更新"
                :class="updateStatuses[game.appId]?.hasUpdate
                  ? 'bg-amber-500/15 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300'
                  : 'btn-soft-action text-slate-300'"
                class="h-8 px-1 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1 active:scale-98 disabled:opacity-60 cursor-pointer"
              >
                <RotateCw v-if="updatingAppId === game.appId" class="w-3.5 h-3.5 animate-spin" />
                <ArrowUpCircle v-else class="w-3.5 h-3.5" />
                <span>{{ updatingAppId === game.appId ? '处理中' : '跟随' }}</span>
              </button>

              <!-- 按钮 2: 检测 DLC 增量更新 -->
              <button
                @click="handleCheckDlc(game.appId)"
                :disabled="dlcDiffs[game.appId]?.checking || dlcDiffs[game.appId]?.appending"
                title="检测云端最新 DLC 分包，对比当前入库规则是否有缺失"
                :class="dlcDiffs[game.appId]?.missingDlcs?.length
                  ? 'bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/35 text-amber-300 shadow-sm'
                  : 'btn-soft-action text-slate-300 hover:text-slate-100'"
                class="h-8 px-1 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1 active:scale-98 disabled:opacity-60 cursor-pointer"
              >
                <RotateCw v-if="dlcDiffs[game.appId]?.checking" class="w-3.5 h-3.5 animate-spin text-amber-400" />
                <Layers v-else class="w-3.5 h-3.5 text-sky-400" />
                <span>{{ dlcDiffs[game.appId]?.checking ? '检测中' : (dlcDiffs[game.appId]?.missingDlcs?.length ? '有新DLC' : '检测DLC') }}</span>
              </button>

              <!-- 按钮 3: Lua 规则启停开关 (停用 / 启用) -->
              <button
                @click="onToggleGameStatus(game.appId, !game.isDisabled)"
                :disabled="togglingAppId === game.appId"
                :title="game.isDisabled ? '已停用入库；点击即可一键重新激活' : '入库生效中；点击可将其临时停用归档（无需物理删除）'"
                :class="game.isDisabled
                  ? 'bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300'
                  : 'btn-soft-action text-slate-300 hover:text-slate-100'"
                class="h-8 px-1 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1 active:scale-98 disabled:opacity-60 cursor-pointer"
              >
                <RotateCw v-if="togglingAppId === game.appId" class="w-3.5 h-3.5 animate-spin" />
                <template v-else>
                  <PlayCircle v-if="game.isDisabled" class="w-3.5 h-3.5 text-emerald-400" />
                  <PauseCircle v-else class="w-3.5 h-3.5 text-slate-400" />
                  <span>{{ game.isDisabled ? '启用' : '停用' }}</span>
                </template>
              </button>

              <!-- 按钮 4: 移出库 (物理删除规则) -->
              <button
                @click="removeGame(game.appId, game.name)"
                title="将该游戏移出库（彻底删除 Lua 规则）"
                class="h-8 px-1 bg-rose-600/15 hover:bg-rose-600/30 border border-rose-500/30 text-rose-300 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1 active:scale-98 cursor-pointer"
              >
                <Trash2 class="w-3.5 h-3.5" />
                <span>出库</span>
              </button>
            </div>

            <!-- 第 3 行 (仅需时展示)：增量补全新 DLC -->
            <button
              v-if="dlcDiffs[game.appId]?.missingDlcs?.length"
              @click="handleAppendDlc(game.appId)"
              :disabled="dlcDiffs[game.appId]?.appending"
              title="将新发现的 DLC 增量追加到当前 Lua 规则中，并自动同步 GreenLuma"
              class="w-full h-8 px-3 bg-gradient-to-r from-amber-500/20 to-orange-500/20 hover:from-amber-500/30 hover:to-orange-500/30 border border-amber-500/35 text-amber-200 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1.5 active:scale-98 disabled:opacity-60 cursor-pointer shadow-sm"
            >
              <RotateCw v-if="dlcDiffs[game.appId]?.appending" class="w-3.5 h-3.5 animate-spin" />
              <Layers v-else class="w-3.5 h-3.5 text-amber-400" />
              <span>{{ dlcDiffs[game.appId]?.appending ? '正在补全新 DLC...' : `一键补全 ${dlcDiffs[game.appId].missingDlcs.length} 个新 DLC` }}</span>
            </button>

            <!-- 第 4 行 (仅需时展示)：预缓存实体清单 -->
            <button
              v-if="isPinned(game) && !manifestStatuses[game.appId]?.hasManifest && !game.hasManifest"
              @click="handleRepairManifest(game.appId)"
              :disabled="repairingAppId === game.appId"
              title="仅「锁定版本」模式需要：手动将实体清单预缓存到本地 Steam/depotcache 目录"
              class="w-full h-8 px-3 bg-amber-500/15 hover:bg-amber-500/30 border border-amber-500/30 text-amber-300 text-xs font-semibold rounded-xl transition flex items-center justify-center gap-1.5 active:scale-98 disabled:opacity-60 cursor-pointer"
            >
              <RotateCw v-if="repairingAppId === game.appId" class="w-3.5 h-3.5 animate-spin" />
              <FolderSync v-else class="w-3.5 h-3.5" />
              <span>{{ repairingAppId === game.appId ? '正在拉取清单...' : '缺少本地清单，点击预缓存' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted } from 'vue';
import {
  Library,
  Trash2,
  RotateCw,
  Search,
  Key,
  Zap,
  Download,
  Play,
  FolderSync,
  ArrowUpCircle,
  CloudDownload,
  Lock,
  BookOpen,
  CheckCircle2,
  PauseCircle,
  PlayCircle,
  AlertCircle,
  Layers
} from 'lucide-vue-next';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { AppManifestStatus, GameUpdateStatus, LuaGameInfo } from '../../types';
import { formatIpcError } from '../api/tauriBridge';
import { applyImageFallback, smartMultiCdnImageFallback } from '../utils/imageFallback';
import { useLuaManager } from '../composables/useLuaManager';
import { checkGameDlcDiff, appendGameDlcs } from '../api/luaManagerApi';
import type { GameFilterMode } from '../types/luaManager';
import LibraryGuideModal from '../components/library/LibraryGuideModal.vue';

const emit = defineEmits<{
  (e: 'notify', msg: string, type: 'success' | 'error' | 'warning' | 'info'): void;
  (e: 'refresh-status'): void;
}>();

const { togglingAppId, handleToggleStatus } = useLuaManager();
const statusFilter = ref<GameFilterMode>('all');

const unlockedGames = ref<LuaGameInfo[]>([]);
const manifestStatuses = reactive<Record<number, AppManifestStatus>>({});
const updateStatuses = reactive<Record<number, GameUpdateStatus>>({});
const checkingUpdates = ref(false);
const updatingAppId = ref<number | null>(null);
const repairingAppId = ref<number | null>(null);
const dlcDiffs = reactive<Record<number, { missingDlcs: number[]; checking: boolean; appending: boolean }>>({});
const filterKeyword = ref('');
const showGuide = ref(false);

const activeGamesCount = computed(() => unlockedGames.value.filter((g) => !g.isDisabled).length);
const disabledGamesCount = computed(() => unlockedGames.value.filter((g) => !!g.isDisabled).length);

const updatableCount = computed(
  () => Object.values(updateStatuses).filter((s) => s?.pinned && s.hasUpdate).length
);

/** 优先以最新入库详情为准（检测结果是检查时的快照） */
const isPinned = (game: LuaGameInfo) => game.pinned ?? updateStatuses[game.appId]?.pinned ?? false;

const filteredGames = computed(() => {
  let list = unlockedGames.value;
  if (statusFilter.value === 'active') {
    list = list.filter((g) => !g.isDisabled);
  } else if (statusFilter.value === 'disabled') {
    list = list.filter((g) => !!g.isDisabled);
  }
  const kw = filterKeyword.value.trim().toLowerCase();
  if (!kw) return list;
  return list.filter(
    (g) => g.appId.toString().includes(kw) || g.name.toLowerCase().includes(kw)
  );
});

const onToggleGameStatus = async (appId: number, targetDisabled: boolean) => {
  await handleToggleStatus(
    appId,
    targetDisabled,
    async () => {
      await loadLibrary();
    },
    (msg, type) => emit('notify', msg, type || 'info')
  );
};

const loadLibrary = async () => {
  try {
    const details = await window.electronAPI.getUnlockedDetails();
    unlockedGames.value = details || [];
    // 重建清单状态表，清掉已出库游戏的残留条目
    Object.keys(manifestStatuses).forEach((k) => delete manifestStatuses[Number(k)]);
    Object.keys(updateStatuses).forEach((k) => {
      const id = Number(k);
      if (!unlockedGames.value.some((g) => g.appId === id)) delete updateStatuses[id];
    });
    emit('refresh-status');

    // 清单状态查询只对「锁定版本」的游戏有意义：官方优先模式下 Steam 动态拉取清单，
    // 本地 depotcache 本来就没有（也不需要）实体文件，查了只会得到无用的"无清单"结论。
    // 一次批量调用补齐，替代逐游戏请求（depotcache 仅扫描一次）。
    const pendingIds = unlockedGames.value
      .filter((g) => isPinned(g) && !g.hasManifest)
      .map((g) => g.appId);
    if (pendingIds.length > 0) {
      try {
        const statuses = await window.electronAPI.checkManifestStatusBatch(pendingIds);
        for (const status of statuses || []) {
          if (status && status.appId != null) manifestStatuses[status.appId] = status;
        }
      } catch (e) {
        // 批量状态查询失败不应影响已加载的库列表，但需留下可诊断的提示
        console.warn('批量清单状态查询失败:', formatIpcError(e));
      }
    }
  } catch (e: any) {
    emit('notify', `加载游戏库失败: ${formatIpcError(e)}`, 'error');
  }
};

const handleRepairManifest = async (appId: number) => {
  repairingAppId.value = appId;
  try {
    emit('notify', '正在从 SteamPipe CDN 下载实体清单并解压到 depotcache...', 'info');
    const res = await window.electronAPI.downloadManifest(appId);
    if (res && res.success) {
      emit('notify', res.message || '分包清单已就绪！', 'success');
      const status = await window.electronAPI.checkManifestStatus(appId);
      if (status) {
        manifestStatuses[appId] = status;
      }
      await loadLibrary();
    } else {
      emit('notify', res?.message || '清单获取完成，DLL 运行时将自动调度。', 'info');
    }
  } catch (e: any) {
    emit('notify', `下载清单失败: ${formatIpcError(e)}`, 'error');
  } finally {
    repairingAppId.value = null;
  }
};

/**
 * 核验全部在库游戏的 DLC 差异（供用户显式点击「检查更新」时联动）。
 *
 * 为什么必须联动：卡片上的 DLC 徽章是个小按钮，普通用户基本不会主动去点，
 * 导致「智能增量补全 DLC」这个核心能力实际处于不可发现状态。
 * 用户点「检查更新」的预期本就是「看看我库里有没有落后的东西」，
 * 版本与 DLC 是同一件事的两个维度，一次性给出才符合直觉。
 *
 * 底层走 `parse_metadata_inspect` → `/api/metadata/:appId/inspect`，
 * 该端点不挂 requireKeyAccess，**不消耗任何免费入库额度**（详见
 * manifests.rs 的 parse_metadata_inspect 注释）。所以「核验 DLC 会烧掉
 * 入库额度」这个隐患已经消除，用户显式点击时联动它是安全的。
 *
 * 但仍**不在启动静默预检里跑**：那是纯上游成本问题，与配额无关。
 * 服务端 inspect 端点限流 90/分钟，而核验是逐款游戏打一次元数据，
 * 上百款游戏的开机预检会贴着限流上限打上游，也拖慢首屏。
 * 用户点「检查更新」是明确的批量查询意图，放这里最合适。
 *
 * 并发度压到 4 且分批串行：几十上百款游戏一起派发会瞬时打满服务端与
 * 本机线程池。已在 dlcDiffs 里有记录的直接跳过，避免重复请求。
 */
const autoCheckDlcForAll = async () => {
  const pending = unlockedGames.value
    .filter((g) => !g.isDisabled && !dlcDiffs[g.appId])
    .map((g) => g.appId);
  if (pending.length === 0) return;

  let found = 0;
  let failed = 0;
  for (let i = 0; i < pending.length; i += 4) {
    const batch = pending.slice(i, i + 4);
    const results = await Promise.allSettled(
      batch.map((appId) => checkGameDlcDiff(appId))
    );
    results.forEach((r, idx) => {
      const appId = batch[idx];
      if (r.status === 'fulfilled' && r.value?.success) {
        dlcDiffs[appId] = {
          missingDlcs: r.value.missingDlcIds || [],
          checking: false,
          appending: false
        };
        if (dlcDiffs[appId].missingDlcs.length > 0) found++;
      } else {
        // 失败（含未激活设备额度耗尽导致的 403）绝不写入条目：
        // 否则该 AppID 会被当成「已核验」而被后续联动永久跳过，
        // 用户即便额度恢复后重试也拿不到 DLC 结果。
        failed++;
      }
    });
  }

  if (found > 0) {
    emit('notify', `同时核验出 ${found} 款游戏存在尚未入库的新 DLC，卡片上已标出「+N 新DLC」，可一键补全！`, 'info');
  } else if (failed > 0) {
    emit('notify', `DLC 核验完成：未发现新 DLC（${failed} 款未能完成，多为云端额度或网络受限，可稍后重试）`, 'info');
  } else {
    emit('notify', 'DLC 核验完成：所有游戏的 DLC 均已是云端最新完整状态。', 'success');
  }
};

const handleCheckUpdates = async (silent: boolean) => {
  if (unlockedGames.value.length === 0 || checkingUpdates.value) return;
  checkingUpdates.value = true;
  try {
    const ids = unlockedGames.value.map((g) => g.appId);
    const list = await window.electronAPI.checkGameUpdates(ids);
    Object.keys(updateStatuses).forEach((k) => delete updateStatuses[Number(k)]);
    let failed = 0;
    for (const s of list || []) {
      if (!s || s.appId == null) continue;
      updateStatuses[s.appId] = s;
      if (!s.checked) failed++;
    }
    const n = updatableCount.value;
    if (!silent || n > 0) {
      if (failed > 0) {
        emit('notify', `版本检查完成：${n} 款有更新，${failed} 款检查失败（云端元数据不可达）`, n > 0 ? 'warning' : 'info');
      } else if (n > 0) {
        emit('notify', `检查完成：${n} 款锁定版本的游戏有新版本，点击卡片上的「跟随最新」即可解除锁定自动跟进！`, 'warning');
      } else {
        emit('notify', '检查完成：所有游戏均为最新版本或已跟随官方最新。', 'success');
      }
    }
  } catch (e: any) {
    if (!silent) emit('notify', `检查更新失败: ${formatIpcError(e)}`, 'error');
  } finally {
    checkingUpdates.value = false;
  }

  // 版本比对结束后联动核验 DLC（失败不影响版本检查结果，故置于 try 之外）。
  //
  // 只在**用户显式点击**（silent=false）时联动：DLC 核验对未激活设备会消耗
  // 每日免费入库额度（默认 2 款），启动静默预检绝不能在用户无感知的情况下
  // 把它烧光 —— 那会直接挡住用户真正要做的入库操作。
  if (!silent) {
    try {
      await autoCheckDlcForAll();
    } catch (e: any) {
      console.warn('[LibraryView] 联动 DLC 核验异常:', e);
    }
  }
};

const handleSetVersionStrategy = async (appId: number, name: string, lock: boolean) => {
  if (updatingAppId.value) {
    // 并发点击不再静默吞掉，明确提示用户等待当前操作完成
    emit('notify', '另有版本策略操作进行中，请稍候', 'info');
    return;
  }
  updatingAppId.value = appId;
  try {
    emit('notify', lock ? `正在将「${name}」锁定到当前官方最新版本...` : `正在将「${name}」切换为跟随官方最新版...`, 'info');
    const res = await window.electronAPI.updateGame(appId, name, undefined, lock);
    if (res && res.success) {
      emit('notify', res.message || '操作成功！', 'success');
      delete updateStatuses[appId];
      await loadLibrary();
    } else {
      emit('notify', res?.message || '操作失败', 'error');
    }
  } catch (e: any) {
    emit('notify', `操作失败: ${formatIpcError(e)}`, 'error');
  } finally {
    updatingAppId.value = null;
  }
};

const removeGame = async (appId: number, name: string) => {
  try {
    const res = await window.electronAPI.removeUnlockedGame(appId);
    if (res.success) {
      emit('notify', `已成功将「${name || appId}」移出库！`, 'success');
      await loadLibrary();
    } else {
      emit('notify', res.message, 'error');
    }
  } catch (e: any) {
    emit('notify', `出库失败: ${formatIpcError(e)}`, 'error');
  }
};

const handleClearAll = async () => {
  if (!confirm('确定要清空所有已入库的游戏规则吗？此操作将删除所有 config/lua 配置文件。')) {
    return;
  }
  try {
    const res = await window.electronAPI.clearAllGames();
    if (res.success) {
      emit('notify', res.message, 'success');
      await loadLibrary();
    } else {
      emit('notify', res.message || '清空失败，请查看日志', 'error');
    }
  } catch (e: any) {
    emit('notify', `清空失败: ${formatIpcError(e)}`, 'error');
  }
};

const handleRestartSteam = async () => {
  try {
    emit('notify', '正在安全重启 Steam 客户端以加载规则与清单...', 'info');
    await window.electronAPI.restartSteam();
    emit('notify', 'Steam 已重新启动！', 'success');
  } catch (e: any) {
    emit('notify', `重启 Steam 异常: ${formatIpcError(e)}`, 'error');
  }
};

const handleImgError = (e: Event, appId: number) => {
  smartMultiCdnImageFallback(e, appId, 'capsule_184x69.jpg');
};

const handleCheckDlc = async (appId: number) => {
  // 并发守卫：徽章按钮在 loading 期间已 disabled，但联动核验与手动点击
  // 可能同时命中同一 AppID，重复请求会白白多消耗一次云端配额
  if (dlcDiffs[appId]?.checking) return;
  dlcDiffs[appId] = { missingDlcs: dlcDiffs[appId]?.missingDlcs || [], checking: true, appending: false };
  try {
    const res = await checkGameDlcDiff(appId);
    if (res.success) {
      dlcDiffs[appId].missingDlcs = res.missingDlcIds || [];
      if (res.missingDlcIds && res.missingDlcIds.length > 0) {
        emit('notify', `AppID ${appId}: 发现 ${res.missingDlcIds.length} 个新 DLC 未入库，可一键补全！`, 'info');
      } else {
        emit('notify', `AppID ${appId}: 本地 DLC 规则已是最新完整状态，无需补全。`, 'success');
      }
    } else {
      // 失败绝不留下 dlcDiffs 条目：留下就等于给这个 AppID 打上「已核验」标记，
      // 后续联动会永久跳过它，用户重试也拿不到结果。
      delete dlcDiffs[appId];
      emit('notify', res.message || 'DLC 核验未完成', 'warning');
    }
  } catch (e: any) {
    delete dlcDiffs[appId];
    emit('notify', `DLC 核验异常: ${formatIpcError(e)}`, 'error');
  }
};

const handleAppendDlc = async (appId: number) => {
  const item = dlcDiffs[appId];
  if (!item || !item.missingDlcs || item.missingDlcs.length === 0) return;
  item.appending = true;
  try {
    const res = await appendGameDlcs(appId, item.missingDlcs);
    if (res.success) {
      emit('notify', res.message || `成功为 AppID ${appId} 追加 ${item.missingDlcs.length} 个新 DLC！`, 'success');
      item.missingDlcs = [];
      await loadLibrary();
    } else {
      emit('notify', res.message || 'DLC 补全写入失败', 'error');
    }
  } catch (e: any) {
    emit('notify', `DLC 追加写入异常: ${formatIpcError(e)}`, 'error');
  } finally {
    item.appending = false;
  }
};

let unlistenWatcher: UnlistenFn | null = null;

onMounted(async () => {
  await loadLibrary();
  // 静默预检版本更新：仅在确有更新时提示，不打扰日常使用
  if (unlockedGames.value.length > 0) {
    handleCheckUpdates(true);
  }

  // 监听 Rust 后台防抖目录变动事件（优化 2：规则变动秒级自动静默同步）
  try {
    unlistenWatcher = await listen('lua-files-changed', () => {
      console.log('[LibraryView] 接收到规则目录变动通知，正在静默同步已入库列表...');
      loadLibrary();
    });
  } catch (e) {
    console.warn('[LibraryView] 注册 lua-files-changed 监听器失败:', e);
  }
});

onUnmounted(() => {
  if (unlistenWatcher) {
    unlistenWatcher();
    unlistenWatcher = null;
  }
});
</script>
