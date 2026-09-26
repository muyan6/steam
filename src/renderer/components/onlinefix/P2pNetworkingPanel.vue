<template>
  <div class="space-y-4 flex-1 flex flex-col min-h-0 text-slate-800 dark:text-slate-200">
    <!-- 顶部状态与 UID 栏：纯正白色卡片质感 (bg-white dark:bg-slate-900) -->
    <div class="bg-white dark:bg-slate-900 p-4.5 rounded-2xl border border-slate-200/90 dark:border-white/10 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div class="flex items-center gap-3.5 flex-wrap">
        <div class="w-11 h-11 rounded-2xl bg-emerald-500/10 border border-emerald-500/25 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0 shadow-xs">
          <Network class="w-5 h-5" />
        </div>
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs text-slate-500 dark:text-slate-400 font-medium">本机 UID：</span>
            <!-- 修复 UID 渲染问题：使用主题自适应的清新翡翠绿徽章，亮色模式与暗色模式均通透高对比度 -->
            <span class="text-xs md:text-sm font-mono font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-500/30 px-3 py-1 rounded-xl select-all shadow-2xs tracking-wider">
              {{ nodeId || '生成中...' }}
            </span>
            <button
              @click="copyText(nodeId, '本机 UID 已复制')"
              class="px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 text-xs font-medium transition cursor-pointer flex items-center gap-1 active:scale-95 border border-slate-200/60 dark:border-transparent"
              title="复制本机 UID"
            >
              <Copy class="w-3.5 h-3.5" />
              <span>复制</span>
            </button>
            <button
              @click="handleRefreshStatus"
              class="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-white/5 dark:hover:bg-white/10 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 transition cursor-pointer border border-slate-200/60 dark:border-transparent"
              title="刷新网络状态"
            >
              <RotateCw class="w-3.5 h-3.5" :class="isRefreshing ? 'animate-spin' : ''" />
            </button>
          </div>
          <div class="flex items-center gap-3 mt-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
            <span class="flex items-center gap-1.5 font-medium">
              <span class="w-2 h-2 rounded-full" :class="status.running ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)] animate-pulse' : 'bg-slate-400'"></span>
              <span>{{ status.running ? 'P2P 隧道服务正在运行中' : '服务待命中' }}</span>
            </span>
            <span>·</span>
            <span>活跃隧道: <strong class="text-sky-600 dark:text-sky-400 font-mono font-bold">{{ status.activeTunnels?.length || 0 }}</strong> 条</span>
            <span v-if="realtimeState.natType && realtimeState.natType !== '未检测'">·</span>
            <span v-if="realtimeState.natType && realtimeState.natType !== '未检测'" class="text-slate-500 dark:text-slate-400">
              网络环境: <strong class="text-emerald-700 dark:text-emerald-400 font-medium">{{ realtimeState.natType }}</strong>
            </span>
          </div>
        </div>
      </div>

      <!-- 顶部操作按钮区：按用户反馈移除常见问题按钮，仅保留服务启闭与快速上手 -->
      <div class="flex items-center gap-2.5 self-stretch md:self-auto justify-end flex-wrap">
        <button
          v-if="!status.running"
          @click="handleStartDaemon"
          :disabled="isOperating"
          class="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
        >
          <Play class="w-3.5 h-3.5" />
          <span>启动监听服务</span>
        </button>

        <button
          v-else
          @click="handleStopAll"
          :disabled="isOperating"
          class="px-4 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 active:bg-rose-500/30 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
        >
          <Power class="w-3.5 h-3.5" />
          <span>关闭所有隧道</span>
        </button>

        <button
          @click="showHelpModal = true"
          class="px-3.5 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-2xs"
        >
          <HelpCircle class="w-3.5 h-3.5 text-sky-500" />
          <span>快速上手</span>
        </button>
      </div>
    </div>

    <!-- 使用须知与致敬卡片 -->
    <div class="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-900/90 dark:text-amber-200/90 flex flex-col md:flex-row items-start md:items-center justify-between gap-3 shrink-0 shadow-2xs">
      <div class="space-y-1">
        <div class="flex items-center gap-1.5 font-bold text-amber-800 dark:text-amber-300">
          <AlertTriangle class="w-4 h-4 text-amber-500 shrink-0" />
          <span>使用须知与致敬鸣谢</span>
        </div>
        <div class="text-[11px] leading-relaxed text-amber-800/80 dark:text-amber-300/80">
          1. 本功能底层基于开源轻量级网络项目
          <a @click="openExternalUrl('https://github.com/openp2p-cn/openp2p')" class="underline cursor-pointer hover:text-amber-600 dark:hover:text-amber-400 font-semibold">OpenP2P</a>
          实现，并深度参考借鉴了
          <a @click="openExternalUrl('https://github.com/Guailoudou/OPL-WpfApp')" class="underline cursor-pointer hover:text-amber-600 dark:hover:text-amber-400 font-bold">Guailoudou/OPL-WpfApp</a>
          开源仓库的优秀联机实践与预设经验。<br>
          2. 全程采用 P2P 穿透直连（自包含联机码模式），无需经过春风度自建中转服务器，安全、轻量且免除账号注册与管理负担。<br>
          3. 双方处于 NAT1~NAT3、开启路由器 UPnP 或在 IPv6 网络下联机打洞效果最佳；若遇到任何联机故障，可随时查阅官方答疑。
        </div>
      </div>

      <div class="flex items-center gap-2 shrink-0 self-end md:self-center">
        <button
          @click="openExternalUrl('https://blog.gldhn.top/2024/07/12/oplwin_help/')"
          class="px-3.5 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-800 dark:text-amber-200 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer shadow-xs active:scale-95"
        >
          <ExternalLink class="w-3.5 h-3.5" />
          <span>联机工具常见问题答疑 ↗</span>
        </button>
      </div>
    </div>

    <!-- 剪贴板快速导入悬浮提示 -->
    <div
      v-if="detectedClipboardCode"
      class="p-3 rounded-xl bg-sky-50 dark:bg-sky-500/15 border border-sky-300/80 dark:border-sky-500/30 text-xs flex items-center justify-between gap-3 text-sky-900 dark:text-sky-200 animate-in fade-in slide-in-from-top-2 shadow-xs"
    >
      <div class="flex items-center gap-2 min-w-0">
        <Sparkles class="w-4 h-4 text-sky-500 shrink-0" />
        <span class="truncate">
          检测到剪贴板中的联机码：<strong class="text-sky-700 dark:text-sky-300 font-mono">{{ detectedClipboardCode.slice(0, 32) }}...</strong>
        </span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          @click="applyDetectedCode"
          class="px-3 py-1 rounded-lg bg-sky-500 text-white font-bold hover:bg-sky-400 transition cursor-pointer text-xs shadow-2xs"
        >
          一键填入
        </button>
        <button
          @click="detectedClipboardCode = ''"
          class="p-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition cursor-pointer"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <!-- 核心操作双卡片（洁白纯净背景，标准卡片边框与阴影） -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- 卡片 1：我是房主（强化三步式清晰工作流） -->
      <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 shadow-sm flex flex-col justify-between space-y-4">
        <div class="space-y-3.5">
          <div class="flex items-center justify-between border-b border-slate-200/70 dark:border-white/10 pb-3">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <h2 class="text-sm font-bold text-slate-900 dark:text-slate-100">我是房主 · 创建房间与联机码</h2>
            </div>
            <span class="text-[11px] text-slate-500 dark:text-slate-400 font-medium">被连方（主机开服）</span>
          </div>

          <!-- 房主步骤 1：服务就绪检查 -->
          <div class="p-3 rounded-xl border flex items-center justify-between gap-3 text-xs"
               :class="status.running
                 ? 'bg-emerald-50/80 dark:bg-emerald-500/10 border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300'
                 : 'bg-amber-50/80 dark:bg-amber-500/10 border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-300'">
            <div class="flex items-center gap-2">
              <span class="font-bold font-mono px-1.5 py-0.5 rounded text-[11px]"
                    :class="status.running ? 'bg-emerald-200 dark:bg-emerald-500/20' : 'bg-amber-200 dark:bg-amber-500/20'">
                第 1 步
              </span>
              <span class="font-medium">
                {{ status.running ? '监听服务已就绪（节点已上线，随时可被连接）' : '监听服务未启动（客机将无法连接你的电脑）' }}
              </span>
            </div>
            <button
              v-if="!status.running"
              @click="handleStartDaemon"
              :disabled="isOperating"
              class="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-[11px] shrink-0 transition cursor-pointer shadow-2xs"
            >
              一键启动
            </button>
            <span v-else class="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1 text-[11px] shrink-0">
              <CheckCircle2 class="w-3.5 h-3.5" />
              <span>就绪</span>
            </span>
          </div>

          <!-- 房主步骤 2：游戏预设选择器 -->
          <div class="space-y-3">
            <div class="flex items-center gap-2">
              <span class="font-bold font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                第 2 步
              </span>
              <label class="text-xs font-bold text-slate-800 dark:text-slate-200">选择要联机的游戏</label>
            </div>

            <select
              v-model="selectedPresetId"
              @change="handlePresetChange"
              class="w-full bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 transition cursor-pointer shadow-2xs"
            >
              <option v-for="item in presetsList" :key="item.id" :value="item.id">
                {{ item.name }} ({{ item.protocol.toUpperCase() }}: {{ item.remotePort }})
              </option>
            </select>

            <!-- 端口与协议 -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">房主服务端口</label>
                <input
                  v-model.number="hostPort"
                  type="number"
                  min="1"
                  max="65535"
                  class="w-full bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 transition shadow-2xs"
                  placeholder="如 8211"
                />
              </div>

              <div>
                <label class="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1.5">通信协议</label>
                <select
                  v-model="hostProtocol"
                  class="w-full bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-emerald-500 transition cursor-pointer shadow-2xs"
                >
                  <option value="udp">UDP 协议 (推荐绝大多数游戏)</option>
                  <option value="tcp">TCP 协议 (Minecraft / 部分自建)</option>
                </select>
              </div>
            </div>

            <!-- 游戏专属指南贴士 -->
            <div v-if="currentPreset?.note" class="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-800 dark:text-emerald-300 leading-relaxed flex items-start gap-2">
              <span class="mt-0.5 shrink-0">📌</span>
              <span>{{ currentPreset.note }}</span>
            </div>
          </div>
        </div>

        <!-- 房主动作区 -->
        <div class="pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-2.5">
          <button
            @click="handleGenerateShareCode"
            class="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 active:bg-emerald-700 text-white font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-98"
          >
            <Share2 class="w-4 h-4" />
            <span>生成并复制联机码（发给好友）</span>
          </button>

          <!-- 房主步骤 3：启动游戏提示 -->
          <div class="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-white/10 text-[11px] text-slate-600 dark:text-slate-400 flex items-center justify-between">
            <span class="flex items-center gap-1.5">
              <span class="font-bold font-mono px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px]">第 3 步</span>
              <span>启动你的本地游戏创建房间，等待好友直连即可</span>
            </span>
          </div>

          <!-- 最新生成的联机码卡片 -->
          <div v-if="latestGeneratedCode" class="p-2.5 rounded-xl bg-emerald-50 dark:bg-slate-950/80 border border-emerald-500/30 text-xs font-mono text-emerald-800 dark:text-emerald-300 break-all flex items-center justify-between gap-2 shadow-2xs">
            <span class="truncate">{{ latestGeneratedCode }}</span>
            <button
              @click="copyText(latestGeneratedCode, '联机码已复制到剪贴板')"
              class="px-2.5 py-1 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-700 dark:text-emerald-300 text-xs shrink-0 cursor-pointer font-sans font-semibold transition"
            >
              重新复制
            </button>
          </div>
        </div>
      </div>

      <!-- 卡片 2：我是客机（从联机码一键加入并展示实时打洞状态） -->
      <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 shadow-sm flex flex-col justify-between space-y-4">
        <div class="space-y-3.5">
          <div class="flex items-center justify-between border-b border-slate-200/70 dark:border-white/10 pb-3">
            <div class="flex items-center gap-2">
              <span class="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
              <h2 class="text-sm font-bold text-slate-900 dark:text-slate-100">我是客机 · 粘贴联机码一键加入</h2>
            </div>
            <span class="text-[11px] text-slate-500 dark:text-slate-400 font-medium">连接方（加入游戏）</span>
          </div>

          <p class="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            粘贴房主发给你的联机码（支持 CFD:// 或 OPL:// 格式），一键打洞建立直连，在游戏内输入本地映射地址即可畅玩。
          </p>

          <!-- 联机码输入与识别 -->
          <div class="space-y-3">
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label class="text-xs font-bold text-slate-800 dark:text-slate-200">粘贴好友发来的联机码</label>
                <button
                  @click="handlePasteFromClipboard"
                  class="text-[11px] text-sky-600 dark:text-sky-400 hover:underline flex items-center gap-1 cursor-pointer font-medium"
                >
                  <ClipboardPaste class="w-3 h-3" />
                  <span>读取剪贴板</span>
                </button>
              </div>
              <textarea
                v-model="joinInputCode"
                @input="handleCodeInput"
                rows="2"
                placeholder="在此粘贴 CFD://... 或 OPL://... 联机码"
                class="w-full bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-white/10 rounded-xl p-2.5 text-xs font-mono text-slate-800 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-600 focus:outline-none focus:border-sky-500 transition resize-none shadow-2xs"
              ></textarea>
            </div>

            <!-- 解析预览信息 -->
            <div v-if="parsedJoinCode" class="p-3.5 rounded-xl bg-sky-500/10 border border-sky-500/25 text-xs space-y-2.5 shadow-2xs">
              <div class="flex items-center justify-between text-sky-800 dark:text-sky-300 font-semibold">
                <span class="flex items-center gap-1.5">
                  <Gamepad2 class="w-4 h-4" />
                  <span>目标游戏: {{ parsedJoinCode.gameName }}</span>
                </span>
                <span class="font-mono uppercase text-[11px] bg-sky-500/20 px-2 py-0.5 rounded text-sky-700 dark:text-sky-300 font-bold">
                  {{ parsedJoinCode.protocol }}
                </span>
              </div>
              <div class="text-[11px] text-slate-600 dark:text-slate-300 font-mono flex items-center justify-between">
                <span>房主 UID: {{ parsedJoinCode.uid }}</span>
                <span>目标端口: {{ parsedJoinCode.remotePort }}</span>
              </div>

              <!-- 本地映射端口调节 -->
              <div class="pt-2 border-t border-sky-500/20 flex items-center justify-between gap-3">
                <span class="text-[11px] text-slate-600 dark:text-slate-400">本地映射端口：</span>
                <input
                  v-model.number="parsedJoinCode.localPort"
                  type="number"
                  min="1"
                  max="65535"
                  class="w-24 bg-white dark:bg-slate-950/90 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1 text-xs font-mono text-sky-700 dark:text-sky-300 focus:outline-none focus:border-sky-500 shadow-2xs"
                />
              </div>
            </div>

            <div v-else-if="joinInputCode.trim()" class="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300">
              ⚠️ 未能识别联机码格式，请确保复制了完整的 CFD:// 或 OPL:// 开头代码。
            </div>
          </div>
        </div>

        <!-- 客机动作区与实时打洞状态看板 -->
        <div class="pt-2 border-t border-slate-200/70 dark:border-white/10 space-y-2.5">
          <button
            @click="handleConnectTunnel"
            :disabled="!parsedJoinCode || isOperating"
            class="w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-xs active:scale-98 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Link class="w-4 h-4" />
            <span>{{ isOperating ? '正在打洞建立隧道...' : '一键建立 P2P 隧道直连' }}</span>
          </button>

          <!-- 实时连接打洞状态看板 (直连/打洞中/中继/错误精准展示) -->
          <div v-if="status.running && (status.activeTunnels?.length || lastConnectedAddress)"
               class="p-3 rounded-xl border space-y-1.5 transition-all text-xs"
               :class="getRealtimeStageCardClass">
            <div class="flex items-center justify-between">
              <span class="font-bold flex items-center gap-1.5">
                <Activity class="w-3.5 h-3.5" :class="realtimeState.stage === 'punching' ? 'animate-spin' : ''" />
                <span>连接状态：{{ getRealtimeStageTitle }}</span>
              </span>
              <span class="text-[10px] px-2 py-0.5 rounded font-mono font-bold" :class="getRealtimeStageBadgeClass">
                {{ realtimeState.stage.toUpperCase() }}
              </span>
            </div>
            <div class="text-[11px] opacity-90 leading-relaxed font-mono">
              {{ realtimeState.detail }}
            </div>
          </div>

          <!-- 连接成功高亮卡片 -->
          <div v-if="lastConnectedAddress" class="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/15 border border-emerald-300 dark:border-emerald-500/30 space-y-2 animate-in fade-in shadow-2xs">
            <div class="text-xs text-emerald-800 dark:text-emerald-300 font-bold flex items-center gap-1.5">
              <CheckCircle2 class="w-4 h-4 text-emerald-500" />
              <span>游戏内连接地址已就绪：</span>
            </div>
            <div class="flex items-center justify-between gap-2 bg-white dark:bg-slate-950/80 p-2.5 rounded-lg border border-emerald-300/60 dark:border-emerald-500/20 shadow-2xs">
              <span class="text-sm font-mono font-bold text-emerald-700 dark:text-emerald-400 select-all">{{ lastConnectedAddress }}</span>
              <button
                @click="copyText(lastConnectedAddress, '游戏连接地址已复制')"
                class="px-3 py-1 rounded-lg bg-emerald-500 text-white font-bold text-xs hover:bg-emerald-600 transition cursor-pointer shadow-2xs active:scale-95"
              >
                复制地址
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 活跃隧道列表看板 (纯净白底高质感卡片) -->
    <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200/90 dark:border-white/10 shadow-sm space-y-3">
      <div class="flex items-center justify-between border-b border-slate-200/70 dark:border-white/10 pb-2.5">
        <div class="flex items-center gap-2">
          <Radio class="w-4 h-4 text-emerald-500" />
          <h3 class="text-xs font-bold text-slate-900 dark:text-slate-100">当前活跃隧道通道 (Active Tunnels)</h3>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono font-bold">
            {{ status.activeTunnels?.length || 0 }}
          </span>
        </div>
        <button
          v-if="status.activeTunnels && status.activeTunnels.length > 0"
          @click="handleStopAll"
          class="text-xs text-rose-500 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-300 transition cursor-pointer font-medium"
        >
          全部关闭
        </button>
      </div>

      <div v-if="!status.activeTunnels || status.activeTunnels.length === 0" class="py-6 text-center text-xs text-slate-400 dark:text-slate-500">
        暂无运行中的活跃隧道。房主生成联机码或客机建立直连后将在此实时显示。
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          v-for="app in status.activeTunnels"
          :key="app.srcPort"
          class="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/80 dark:border-white/5 flex items-center justify-between gap-3 text-xs shadow-2xs"
        >
          <div class="space-y-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span class="font-bold text-slate-800 dark:text-slate-200">{{ app.appName }}</span>
              <span class="font-mono uppercase text-[10px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-700 dark:text-sky-300 font-bold">
                {{ app.protocol }}
              </span>
            </div>
            <div class="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
              本地: 127.0.0.1:{{ app.srcPort }} ➔ 远程: {{ app.dstPort }} ({{ app.peerNode.slice(0, 8) }}...)
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <button
              @click="copyText(`127.0.0.1:${app.srcPort}`, '连接地址已复制')"
              class="px-2.5 py-1 rounded-lg bg-white dark:bg-white/10 text-slate-700 dark:text-slate-300 text-xs border border-slate-200 dark:border-transparent transition cursor-pointer hover:bg-slate-100 shadow-2xs"
              title="复制本地连接地址"
            >
              复制
            </button>
            <button
              @click="handleRemoveTunnel(app.srcPort)"
              class="p-1.5 rounded-lg hover:bg-rose-500/20 text-slate-400 hover:text-rose-500 transition cursor-pointer"
              title="断开此隧道"
            >
              <Unlink class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 组网教程与指南弹窗 (纯净通透背景) -->
    <div
      v-if="showHelpModal"
      class="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
      @click.self="showHelpModal = false"
    >
      <div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-3xl w-full max-w-xl p-6 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
        <div class="flex items-center justify-between border-b border-slate-200 dark:border-white/10 pb-3">
          <div class="flex items-center gap-2.5">
            <Network class="w-5 h-5 text-emerald-500" />
            <h3 class="text-sm font-bold text-slate-900 dark:text-slate-100">异地联机组网 · 快速上手指南</h3>
          </div>
          <button @click="showHelpModal = false" class="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/10 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer">
            <X class="w-4 h-4" />
          </button>
        </div>

        <div class="space-y-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
          <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-white/5 space-y-1">
            <h4 class="font-bold text-sky-700 dark:text-sky-300 flex items-center gap-1.5">
              <span>1. 什么是 P2P 打洞联机？</span>
            </h4>
            <p class="text-slate-500 dark:text-slate-400">
              利用 OpenP2P 协议进行智能 NAT 穿透（支持 NAT1 到 NAT4、UPnP 与 IPv6），在两台异地电脑间建立加密的点对点直连通道。无需公网 IP，即可享受宛如局域网一般的低延迟游戏对战。
            </p>
          </div>

          <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-white/5 space-y-1">
            <h4 class="font-bold text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
              <span>2. 房主如何操作？（三步走）</span>
            </h4>
            <p class="text-slate-500 dark:text-slate-400">
              ① 启动监听服务（确保节点就绪）。<br>
              ② 在左侧选择对应游戏预设（如《幻兽帕鲁 8211》），点击【生成并复制联机码】发给好友。<br>
              ③ 启动本地游戏创建房间，等待好友直连即可。
            </p>
          </div>

          <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-white/5 space-y-1">
            <h4 class="font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
              <span>3. 客机如何加入？</span>
            </h4>
            <p class="text-slate-500 dark:text-slate-400">
              ① 复制房主发来的联机码（CFD:// 或 OPL://）。<br>
              ② 打开本页面，点击【读取剪贴板】自动识别。<br>
              ③ 点击【一键建立 P2P 隧道直连】。<br>
              ④ 连通后在游戏内输入直连地址（如 127.0.0.1:8212）连接即可！
            </p>
          </div>

          <div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200/60 dark:border-white/5 space-y-1">
            <h4 class="font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
              <span>4. 更多进阶与问题排查</span>
            </h4>
            <p class="text-slate-500 dark:text-slate-400">
              遇到连不上、延迟高等网络疑难杂症，推荐点击下方按钮查阅 Guailoudou 编写的联机工具排查博客。
            </p>
          </div>
        </div>

        <div class="pt-3 border-t border-slate-200 dark:border-white/10 flex items-center justify-between gap-3">
          <button
            @click="openExternalUrl('https://blog.gldhn.top/2024/07/12/oplwin_help/')"
            class="px-4 py-2 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-700 dark:text-sky-300 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
          >
            <ExternalLink class="w-3.5 h-3.5" />
            <span>查阅联机问题排查博客 ↗</span>
          </button>

          <button
            @click="showHelpModal = false"
            class="px-5 py-2 rounded-xl bg-emerald-500 text-white text-xs font-bold hover:bg-emerald-600 transition cursor-pointer shadow-xs"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import {
  Network,
  Copy,
  RotateCw,
  Play,
  Power,
  Share2,
  ClipboardPaste,
  Link,
  Unlink,
  Radio,
  Gamepad2,
  CheckCircle2,
  HelpCircle,
  Sparkles,
  X,
  AlertTriangle,
  ExternalLink,
  Activity
} from 'lucide-vue-next';
import {
  p2pGetNodeId,
  p2pGetStatus,
  p2pGetRealtimeState,
  p2pStartDaemon,
  p2pStopAll,
  p2pConnectTunnel,
  p2pRemoveTunnel,
  p2pGenerateCode,
  p2pParseCode,
  openExternalUrl,
  formatIpcError
} from '../../api/tauriBridge';
import type {
  P2pStatusInfo,
  P2pGamePreset,
  ParsedShareCode,
  P2pRealtimeState
} from '../../../types';

const emit = defineEmits<{
  (e: 'toast', msg: string): void;
}>();

// 内置常用游戏预设
const DEFAULT_PRESETS: P2pGamePreset[] = [
  {
    id: 'palworld',
    name: '幻兽帕鲁 (专用服务器)',
    remotePort: 8211,
    localPort: 8212,
    protocol: 'udp',
    category: '热门自建服',
    note: '连接成功后，在游戏内输入 127.0.0.1:8212 加入多人游戏',
  },
  {
    id: 'minecraft_java',
    name: '我的世界 Minecraft (Java 版)',
    remotePort: 25565,
    localPort: 25565,
    protocol: 'tcp',
    category: '经典联机',
    note: '连接成功后，多人游戏服务器地址输入 127.0.0.1:25565',
  },
  {
    id: 'terraria',
    name: '泰拉瑞亚 Terraria',
    remotePort: 7777,
    localPort: 7776,
    protocol: 'tcp',
    category: '经典联机',
    note: '房主开主机，客机通过 IP 加入输入 127.0.0.1 端口 7776',
  },
  {
    id: 'dont_starve',
    name: '饥荒联机版 (局域网直连)',
    remotePort: 10999,
    localPort: 10999,
    protocol: 'udp',
    category: '生存冒险',
    note: '按 ~ 打开控制台输入 c_connect("127.0.0.1", 10999) 即可直连',
  },
  {
    id: 'stardew_valley',
    name: '星露谷物语 (IP 直连)',
    remotePort: 24642,
    localPort: 24641,
    protocol: 'udp',
    category: '休闲农场',
    note: '房主开启IP连接，客机输入 127.0.0.1:24641 进入',
  },
  {
    id: 'seven_days_to_die',
    name: '七日杀 7 Days to Die',
    remotePort: 26900,
    localPort: 26900,
    protocol: 'udp',
    category: '生存冒险',
    note: '加入游戏底部输入 IP 127.0.0.1 端口 26900',
  },
  {
    id: 'unturned',
    name: '未转变者 Unturned',
    remotePort: 25444,
    localPort: 25444,
    protocol: 'udp',
    category: '末日生存',
    note: '通过 IP 127.0.0.1 端口 25444 进入游戏',
  },
  {
    id: 'custom',
    name: '自定义游戏端口',
    remotePort: 8080,
    localPort: 8080,
    protocol: 'tcp',
    category: '通用自定义',
    note: '支持任意 TCP 或 UDP 自定义端口映射',
  },
];

const presetsList = ref<P2pGamePreset[]>(DEFAULT_PRESETS);
const selectedPresetId = ref<string>('palworld');

// 房主表单数据
const hostPort = ref<number>(8211);
const hostProtocol = ref<'udp' | 'tcp'>('udp');
const latestGeneratedCode = ref<string>('');

// 客机表单数据
const joinInputCode = ref<string>('');
const parsedJoinCode = ref<ParsedShareCode | null>(null);
const lastConnectedAddress = ref<string>('');

// 全局状态与实时打洞监控
const nodeId = ref<string>('');
const status = ref<P2pStatusInfo>({
  running: false,
  nodeId: '',
  exeFound: false,
  activeTunnels: [],
  binaryPath: '',
  message: '',
});

const realtimeState = ref<P2pRealtimeState>({
  stage: 'idle',
  natType: '未检测',
  detail: '服务待命中',
});

const isRefreshing = ref<boolean>(false);
const isOperating = ref<boolean>(false);
const showHelpModal = ref<boolean>(false);
const detectedClipboardCode = ref<string>('');

const currentPreset = computed(() => {
  return presetsList.value.find((p) => p.id === selectedPresetId.value);
});

// 动态打洞状态标题
const getRealtimeStageTitle = computed(() => {
  switch (realtimeState.value.stage) {
    case 'direct':
      return 'P2P 隧道直连成功！';
    case 'punching':
      return '正在打洞握手中...';
    case 'relay':
      return '公网共享节点中继转发中';
    case 'error':
      return '握手暂时重试中';
    case 'starting':
      return '节点在线监听中';
    default:
      return '待命中';
  }
});

// 动态打洞状态卡片颜色
const getRealtimeStageCardClass = computed(() => {
  switch (realtimeState.value.stage) {
    case 'direct':
      return 'bg-emerald-50 dark:bg-emerald-500/15 border-emerald-300 dark:border-emerald-500/30 text-emerald-800 dark:text-emerald-300';
    case 'punching':
      return 'bg-sky-50 dark:bg-sky-500/15 border-sky-300 dark:border-sky-500/30 text-sky-800 dark:text-sky-300';
    case 'relay':
      return 'bg-amber-50 dark:bg-amber-500/15 border-amber-300 dark:border-amber-500/30 text-amber-800 dark:text-amber-300';
    case 'error':
      return 'bg-rose-50 dark:bg-rose-500/15 border-rose-300 dark:border-rose-500/30 text-rose-800 dark:text-rose-300';
    default:
      return 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300';
  }
});

// 动态打洞徽章颜色
const getRealtimeStageBadgeClass = computed(() => {
  switch (realtimeState.value.stage) {
    case 'direct':
      return 'bg-emerald-200 dark:bg-emerald-500/30 text-emerald-800 dark:text-emerald-300';
    case 'punching':
      return 'bg-sky-200 dark:bg-sky-500/30 text-sky-800 dark:text-sky-300 animate-pulse';
    case 'relay':
      return 'bg-amber-200 dark:bg-amber-500/30 text-amber-800 dark:text-amber-300';
    case 'error':
      return 'bg-rose-200 dark:bg-rose-500/30 text-rose-800 dark:text-rose-300';
    default:
      return 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400';
  }
});

const handlePresetChange = () => {
  const p = currentPreset.value;
  if (p) {
    hostPort.value = p.remotePort;
    hostProtocol.value = p.protocol;
  }
};

const copyText = async (text: string, successMsg = '已复制到剪贴板') => {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    emit('toast', successMsg);
  } catch {
    emit('toast', '复制失败，请手动选择复制');
  }
};

const fetchStatus = async () => {
  try {
    nodeId.value = await p2pGetNodeId();
    status.value = await p2pGetStatus();
    realtimeState.value = await p2pGetRealtimeState();
  } catch (err) {
    console.error('获取 P2P 状态失败:', err);
  }
};

const handleRefreshStatus = async () => {
  isRefreshing.value = true;
  await fetchStatus();
  setTimeout(() => {
    isRefreshing.value = false;
  }, 400);
};

const handleStartDaemon = async () => {
  isOperating.value = true;
  try {
    await p2pStartDaemon();
    await fetchStatus();
    emit('toast', 'P2P 监听服务已成功启动！');
  } catch (err: any) {
    emit('toast', `启动服务失败: ${formatIpcError(err)}`);
  } finally {
    isOperating.value = false;
  }
};

const handleStopAll = async () => {
  isOperating.value = true;
  try {
    await p2pStopAll();
    await fetchStatus();
    lastConnectedAddress.value = '';
    emit('toast', '已断开并关闭所有 P2P 隧道');
  } catch (err: any) {
    emit('toast', `关闭失败: ${formatIpcError(err)}`);
  } finally {
    isOperating.value = false;
  }
};

const handleGenerateShareCode = async () => {
  if (!nodeId.value) {
    nodeId.value = await p2pGetNodeId();
  }
  const gameName = currentPreset.value?.name || '联机游戏';
  try {
    const code = await p2pGenerateCode({
      uid: nodeId.value,
      remotePort: hostPort.value,
      localPort: hostPort.value,
      protocol: hostProtocol.value,
      gameName,
    });
    latestGeneratedCode.value = code;
    // 房主生成联机码时自动确保后台监听已启动
    if (!status.value.running) {
      void p2pStartDaemon().then(fetchStatus);
    }
    await copyText(code, '联机码已生成并复制！快发给基友吧');
  } catch (err: any) {
    emit('toast', `生成失败: ${formatIpcError(err)}`);
  }
};

const parseCode = async (str: string) => {
  if (!str.trim()) {
    parsedJoinCode.value = null;
    return;
  }
  try {
    const res = await p2pParseCode(str.trim());
    parsedJoinCode.value = res;
  } catch {
    parsedJoinCode.value = null;
  }
};

const handleCodeInput = () => {
  void parseCode(joinInputCode.value);
};

const handlePasteFromClipboard = async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      joinInputCode.value = text.trim();
      await parseCode(joinInputCode.value);
      if (parsedJoinCode.value) {
        emit('toast', `成功识别：${parsedJoinCode.value.gameName}`);
      } else {
        emit('toast', '未能解析出有效联机码');
      }
    }
  } catch {
    emit('toast', '无法访问剪贴板，请手动粘贴');
  }
};

const applyDetectedCode = () => {
  if (detectedClipboardCode.value) {
    joinInputCode.value = detectedClipboardCode.value;
    void parseCode(joinInputCode.value);
    detectedClipboardCode.value = '';
    emit('toast', '联机码已填入');
  }
};

const handleConnectTunnel = async () => {
  if (!parsedJoinCode.value) return;
  isOperating.value = true;
  try {
    await p2pConnectTunnel({
      peerUid: parsedJoinCode.value.uid,
      remotePort: parsedJoinCode.value.remotePort,
      localPort: parsedJoinCode.value.localPort,
      protocol: parsedJoinCode.value.protocol,
      gameName: parsedJoinCode.value.gameName,
    });
    await fetchStatus();
    lastConnectedAddress.value = `127.0.0.1:${parsedJoinCode.value.localPort}`;
    emit('toast', `隧道建立成功！请在游戏内连接 ${lastConnectedAddress.value}`);
  } catch (err: any) {
    emit('toast', `建立直连失败: ${formatIpcError(err)}`);
  } finally {
    isOperating.value = false;
  }
};

const handleRemoveTunnel = async (localPort: number) => {
  try {
    await p2pRemoveTunnel(localPort);
    await fetchStatus();
    emit('toast', `端口 ${localPort} 隧道已断开`);
  } catch (err: any) {
    emit('toast', `断开失败: ${formatIpcError(err)}`);
  }
};

// 剪贴板嗅探
const checkClipboardForCode = async () => {
  try {
    const text = await navigator.clipboard.readText();
    const trimmed = text.trim();
    if (
      (trimmed.startsWith('CFD://') || trimmed.startsWith('OPL://') || trimmed.startsWith('cfd://') || trimmed.startsWith('opl://')) &&
      trimmed !== joinInputCode.value &&
      trimmed !== latestGeneratedCode.value
    ) {
      detectedClipboardCode.value = trimmed;
    }
  } catch {}
};

let statusTimer: any = null;

onMounted(async () => {
  await fetchStatus();
  await checkClipboardForCode();
  handlePresetChange();

  // 定时轮询隧道运行状态与打洞实时日志 (每 3 秒刷新一次实时打洞状态)
  statusTimer = setInterval(fetchStatus, 3000);
});

onUnmounted(() => {
  if (statusTimer) {
    clearInterval(statusTimer);
  }
});
</script>
