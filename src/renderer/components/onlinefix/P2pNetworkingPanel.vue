<template>
  <div class="space-y-4 flex-1 flex flex-col min-h-0 text-slate-200">
    <!-- 顶部状态与 UID 栏 -->
    <div class="bg-slate-900/80 p-4 rounded-2xl border border-white/10 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
      <div class="flex items-center gap-3.5 flex-wrap">
        <div class="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-400 shrink-0">
          <Network class="w-5 h-5" />
        </div>
        <div>
          <div class="flex items-center gap-2">
            <span class="text-xs text-slate-400 font-medium">本机 UID：</span>
            <span class="text-sm font-mono font-bold text-emerald-400 bg-emerald-950/40 border border-emerald-500/20 px-2.5 py-0.5 rounded-lg select-all">
              {{ nodeId || '加载中...' }}
            </span>
            <button
              @click="copyText(nodeId, '本机 UID 已复制')"
              class="px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-slate-300 text-xs transition cursor-pointer flex items-center gap-1 active:scale-95"
              title="复制本机 UID"
            >
              <Copy class="w-3.5 h-3.5" />
              <span>复制</span>
            </button>
            <button
              @click="handleRefreshStatus"
              class="p-1 rounded-md bg-white/5 hover:bg-white/10 text-slate-400 hover:text-slate-200 transition cursor-pointer"
              title="刷新网络状态"
            >
              <RotateCw class="w-3.5 h-3.5" :class="isRefreshing ? 'animate-spin' : ''" />
            </button>
          </div>
          <div class="flex items-center gap-3 mt-1.5 text-xs text-slate-400">
            <span class="flex items-center gap-1.5">
              <span class="w-2 h-2 rounded-full" :class="status.running ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-slate-500'"></span>
              <span>{{ status.running ? 'P2P 隧道服务运行中' : '服务待命中' }}</span>
            </span>
            <span>·</span>
            <span>活跃隧道: <strong class="text-sky-400 font-mono">{{ status.activeTunnels?.length || 0 }}</strong> 条</span>
            <span v-if="firewallChecked">·</span>
            <span v-if="firewallChecked" class="flex items-center gap-1">
              <ShieldCheck v-if="firewallAllowed" class="w-3.5 h-3.5 text-emerald-400" />
              <ShieldAlert v-else class="w-3.5 h-3.5 text-amber-400" />
              <span :class="firewallAllowed ? 'text-emerald-400' : 'text-amber-400'">
                {{ firewallAllowed ? '防火墙已放行' : '防火墙未放行' }}
              </span>
            </span>
          </div>
        </div>
      </div>

      <div class="flex items-center gap-2.5 self-stretch md:self-auto justify-end flex-wrap">
        <button
          v-if="!firewallAllowed"
          @click="handleAllowFirewall"
          :disabled="isSettingFirewall"
          class="px-3 py-1.5 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-300 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          title="点击一键向 Windows 防火墙添加入站放行规则"
        >
          <ShieldAlert class="w-3.5 h-3.5" />
          <span>{{ isSettingFirewall ? '配置中...' : '一键放行防火墙' }}</span>
        </button>

        <button
          v-if="!status.running"
          @click="handleStartDaemon"
          :disabled="isOperating"
          class="px-3.5 py-1.5 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-xs"
        >
          <Play class="w-3.5 h-3.5" />
          <span>启动监听服务</span>
        </button>

        <button
          v-else
          @click="handleStopAll"
          :disabled="isOperating"
          class="px-3.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-xs font-bold transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
        >
          <Power class="w-3.5 h-3.5" />
          <span>关闭所有隧道</span>
        </button>

        <button
          @click="showHelpModal = true"
          class="px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 border border-white/10 text-slate-300 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer"
        >
          <HelpCircle class="w-3.5 h-3.5 text-sky-400" />
          <span>组网教程</span>
        </button>
      </div>
    </div>

    <!-- 剪贴板快速导入悬浮提示（当发现剪贴板包含 CFD:// 时自动触发） -->
    <div
      v-if="detectedClipboardCode"
      class="p-3 rounded-xl bg-sky-500/15 border border-sky-500/30 text-xs flex items-center justify-between gap-3 text-sky-200 animate-in fade-in slide-in-from-top-2"
    >
      <div class="flex items-center gap-2 min-w-0">
        <Sparkles class="w-4 h-4 text-sky-400 shrink-0" />
        <span class="truncate">
          检测到剪贴板中的联机码：<strong class="text-sky-300 font-mono">{{ detectedClipboardCode.slice(0, 32) }}...</strong>
        </span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          @click="applyDetectedCode"
          class="px-3 py-1 rounded-lg bg-sky-500 text-slate-950 font-bold hover:bg-sky-400 transition cursor-pointer text-xs"
        >
          一键填入
        </button>
        <button
          @click="detectedClipboardCode = ''"
          class="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-slate-200 transition cursor-pointer"
        >
          <X class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <!-- 核心操作双卡片（网格布局） -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <!-- 卡片 1：我是房主（创建房间并生成联机码） -->
      <div class="bg-slate-900/80 p-5 rounded-2xl border border-white/10 shadow-sm flex flex-col justify-between space-y-4">
        <div>
          <div class="flex items-center justify-between mb-3 border-b border-white/5 pb-2.5">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
              <h2 class="text-sm font-bold text-slate-100">我是房主 · 创建房间与联机码</h2>
            </div>
            <span class="text-[11px] text-slate-400">被连方（主机）</span>
          </div>

          <p class="text-xs text-slate-400 mb-4 leading-relaxed">
            选择正在运行的游戏，或输入你的本地游戏服务端口，一键生成联机码发给基友，好友输入即可一键直连。
          </p>

          <!-- 游戏预设选择器 -->
          <div class="space-y-3">
            <div>
              <label class="block text-xs font-medium text-slate-300 mb-1.5">选择游戏预设</label>
              <select
                v-model="selectedPresetId"
                @change="handlePresetChange"
                class="w-full bg-slate-950/70 border border-white/10 rounded-xl px-3.5 py-2.5 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50 transition cursor-pointer"
              >
                <option v-for="item in presetsList" :key="item.id" :value="item.id">
                  {{ item.name }} ({{ item.protocol.toUpperCase() }}: {{ item.remotePort }})
                </option>
              </select>
            </div>

            <!-- 端口与协议 -->
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-xs font-medium text-slate-300 mb-1.5">房主服务端口</label>
                <input
                  v-model.number="hostPort"
                  type="number"
                  min="1"
                  max="65535"
                  class="w-full bg-slate-950/70 border border-white/10 rounded-xl px-3.5 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-emerald-500/50 transition"
                  placeholder="如 8211"
                />
              </div>

              <div>
                <label class="block text-xs font-medium text-slate-300 mb-1.5">通信协议</label>
                <select
                  v-model="hostProtocol"
                  class="w-full bg-slate-950/70 border border-white/10 rounded-xl px-3.5 py-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50 transition cursor-pointer"
                >
                  <option value="udp">UDP 协议 (推荐多数游戏)</option>
                  <option value="tcp">TCP 协议 (MC/部分RPG)</option>
                </select>
              </div>
            </div>

            <!-- 游戏专属指南贴士 -->
            <div v-if="currentPreset?.note" class="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[11px] text-emerald-300 leading-relaxed flex items-start gap-2">
              <span class="mt-0.5 shrink-0">📌</span>
              <span>{{ currentPreset.note }}</span>
            </div>
          </div>
        </div>

        <!-- 房主动作区 -->
        <div class="pt-2 border-t border-white/5 space-y-2.5">
          <button
            @click="handleGenerateShareCode"
            class="w-full py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-98"
          >
            <Share2 class="w-4 h-4" />
            <span>生成并复制联机码</span>
          </button>

          <!-- 最新生成的联机码卡片 -->
          <div v-if="latestGeneratedCode" class="p-2.5 rounded-xl bg-slate-950/80 border border-emerald-500/30 text-xs font-mono text-emerald-300 break-all flex items-center justify-between gap-2">
            <span class="truncate">{{ latestGeneratedCode }}</span>
            <button
              @click="copyText(latestGeneratedCode, '联机码已复制到剪贴板')"
              class="px-2.5 py-1 rounded-md bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-xs shrink-0 cursor-pointer font-sans font-semibold transition"
            >
              重新复制
            </button>
          </div>
        </div>
      </div>

      <!-- 卡片 2：我是客机（从联机码一键加入） -->
      <div class="bg-slate-900/80 p-5 rounded-2xl border border-white/10 shadow-sm flex flex-col justify-between space-y-4">
        <div>
          <div class="flex items-center justify-between mb-3 border-b border-white/5 pb-2.5">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-sky-400"></span>
              <h2 class="text-sm font-bold text-slate-100">我是客机 · 粘贴联机码一键加入</h2>
            </div>
            <span class="text-[11px] text-slate-400">连接方（玩家）</span>
          </div>

          <p class="text-xs text-slate-400 mb-4 leading-relaxed">
            粘贴房主发给你的联机码（格式如 CFD://...），一键打洞建立直连，在游戏内输入本地映射地址即可畅玩。
          </p>

          <!-- 联机码输入与识别 -->
          <div class="space-y-3">
            <div>
              <div class="flex items-center justify-between mb-1.5">
                <label class="text-xs font-medium text-slate-300">粘贴好友发来的联机码</label>
                <button
                  @click="handlePasteFromClipboard"
                  class="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1 cursor-pointer"
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
                class="w-full bg-slate-950/70 border border-white/10 rounded-xl p-2.5 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500/50 transition resize-none"
              ></textarea>
            </div>

            <!-- 解析预览信息 -->
            <div v-if="parsedJoinCode" class="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-xs space-y-2">
              <div class="flex items-center justify-between text-sky-300 font-semibold">
                <span class="flex items-center gap-1.5">
                  <Gamepad2 class="w-3.5 h-3.5" />
                  <span>目标游戏: {{ parsedJoinCode.gameName }}</span>
                </span>
                <span class="font-mono uppercase text-[11px] bg-sky-500/20 px-2 py-0.5 rounded">
                  {{ parsedJoinCode.protocol }}
                </span>
              </div>
              <div class="text-[11px] text-slate-300 font-mono flex items-center justify-between">
                <span>房主 UID: {{ parsedJoinCode.uid }}</span>
                <span>目标端口: {{ parsedJoinCode.remotePort }}</span>
              </div>

              <!-- 本地映射端口调节 -->
              <div class="pt-2 border-t border-sky-500/20 flex items-center justify-between gap-3">
                <span class="text-[11px] text-slate-400">本地映射端口：</span>
                <input
                  v-model.number="parsedJoinCode.localPort"
                  type="number"
                  min="1"
                  max="65535"
                  class="w-24 bg-slate-950/90 border border-white/10 rounded-lg px-2.5 py-1 text-xs font-mono text-sky-300 focus:outline-none focus:border-sky-400"
                />
              </div>
            </div>

            <div v-else-if="joinInputCode.trim()" class="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
              ⚠️ 未能识别联机码格式，请确保复制了完整的 CFD:// 或 OPL:// 开头代码。
            </div>
          </div>
        </div>

        <!-- 客机动作区 -->
        <div class="pt-2 border-t border-white/5 space-y-2.5">
          <button
            @click="handleConnectTunnel"
            :disabled="!parsedJoinCode || isOperating"
            class="w-full py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer shadow-sm active:scale-98 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Link class="w-4 h-4" />
            <span>{{ isOperating ? '正在打洞建立隧道...' : '一键建立 P2P 隧道直连' }}</span>
          </button>

          <!-- 连接成功高亮卡片 -->
          <div v-if="lastConnectedAddress" class="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 space-y-2 animate-in fade-in">
            <div class="text-xs text-emerald-300 font-bold flex items-center gap-1.5">
              <CheckCircle2 class="w-4 h-4 text-emerald-400" />
              <span>P2P 隧道建立成功！游戏内连接地址：</span>
            </div>
            <div class="flex items-center justify-between gap-2 bg-slate-950/80 p-2 rounded-lg border border-emerald-500/20">
              <span class="text-sm font-mono font-bold text-emerald-400 select-all">{{ lastConnectedAddress }}</span>
              <button
                @click="copyText(lastConnectedAddress, '游戏连接地址已复制')"
                class="px-2.5 py-1 rounded bg-emerald-500 text-slate-950 font-bold text-xs hover:bg-emerald-400 transition cursor-pointer"
              >
                复制地址
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 活跃隧道列表看板 -->
    <div class="bg-slate-900/80 p-5 rounded-2xl border border-white/10 shadow-sm space-y-3">
      <div class="flex items-center justify-between border-b border-white/5 pb-2.5">
        <div class="flex items-center gap-2">
          <Radio class="w-4 h-4 text-emerald-400" />
          <h3 class="text-xs font-bold text-slate-100">当前活跃隧道通道 (Active Tunnels)</h3>
          <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 font-mono">
            {{ status.activeTunnels?.length || 0 }}
          </span>
        </div>
        <button
          v-if="status.activeTunnels && status.activeTunnels.length > 0"
          @click="handleStopAll"
          class="text-xs text-rose-400 hover:text-rose-300 transition cursor-pointer"
        >
          全部关闭
        </button>
      </div>

      <div v-if="!status.activeTunnels || status.activeTunnels.length === 0" class="py-6 text-center text-xs text-slate-500">
        暂无运行中的活跃隧道。房主生成联机码或客机建立直连后将在此显示。
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          v-for="app in status.activeTunnels"
          :key="app.srcPort"
          class="p-3 rounded-xl bg-slate-950/60 border border-white/5 flex items-center justify-between gap-3 text-xs"
        >
          <div class="space-y-1 min-w-0">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span class="font-bold text-slate-200">{{ app.appName }}</span>
              <span class="font-mono uppercase text-[10px] px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300">
                {{ app.protocol }}
              </span>
            </div>
            <div class="text-[11px] text-slate-400 font-mono truncate">
              本地: 127.0.0.1:{{ app.srcPort }} ➔ 远程: {{ app.dstPort }} ({{ app.peerNode.slice(0, 8) }}...)
            </div>
          </div>

          <div class="flex items-center gap-2 shrink-0">
            <button
              @click="copyText(`127.0.0.1:${app.srcPort}`, '连接地址已复制')"
              class="px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-slate-300 text-xs transition cursor-pointer"
              title="复制本地连接地址"
            >
              复制
            </button>
            <button
              @click="handleRemoveTunnel(app.srcPort)"
              class="p-1 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition cursor-pointer"
              title="断开此隧道"
            >
              <Unlink class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 组网教程与指南弹窗 -->
    <div
      v-if="showHelpModal"
      class="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in"
      @click.self="showHelpModal = false"
    >
      <div class="bg-slate-900 border border-white/10 rounded-2xl w-full max-w-xl p-6 shadow-2xl space-y-4 max-h-[85vh] overflow-y-auto">
        <div class="flex items-center justify-between border-b border-white/10 pb-3">
          <div class="flex items-center gap-2.5">
            <Network class="w-5 h-5 text-emerald-400" />
            <h3 class="text-sm font-bold text-slate-100">异地联机组网 · 使用指南与原理</h3>
          </div>
          <button @click="showHelpModal = false" class="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-slate-200">
            <X class="w-4 h-4" />
          </button>
        </div>

        <div class="space-y-3.5 text-xs text-slate-300 leading-relaxed">
          <div class="p-3 rounded-xl bg-slate-950/60 border border-white/5 space-y-1">
            <h4 class="font-bold text-sky-300 flex items-center gap-1.5">
              <span>1. 什么是 P2P 打洞联机？</span>
            </h4>
            <p class="text-slate-400">
              基于 OpenP2P 协议，利用 NAT 穿透算法（支持 NAT1 到 NAT4、UPnP 与 IPv6），在两台异地电脑之间建立加密的点对点虚拟直连隧道。无需公网 IP，即可享受宛如局域网一般的低延迟游戏对战。
            </p>
          </div>

          <div class="p-3 rounded-xl bg-slate-950/60 border border-white/5 space-y-1">
            <h4 class="font-bold text-emerald-300 flex items-center gap-1.5">
              <span>2. 房主如何操作？</span>
            </h4>
            <p class="text-slate-400">
              ① 启动游戏并建立房间/自建专用服。<br>
              ② 在左侧选择对应游戏预设（如《幻兽帕鲁 8211》）。<br>
              ③ 点击【生成并复制联机码】，将代码发给你的好友即可。
            </p>
          </div>

          <div class="p-3 rounded-xl bg-slate-950/60 border border-white/5 space-y-1">
            <h4 class="font-bold text-amber-300 flex items-center gap-1.5">
              <span>3. 客机如何加入？</span>
            </h4>
            <p class="text-slate-400">
              ① 复制房主发来的联机码（CFD://...）。<br>
              ② 打开本页面，点击【读取剪贴板】识别代码。<br>
              ③ 点击【一键建立 P2P 隧道直连】。<br>
              ④ 在游戏内输入直连地址（如 127.0.0.1:8212）连接即可！
            </p>
          </div>

          <div class="p-3 rounded-xl bg-slate-950/60 border border-white/5 space-y-1">
            <h4 class="font-bold text-purple-300 flex items-center gap-1.5">
              <span>4. 为什么显示连不上？</span>
            </h4>
            <p class="text-slate-400">
              ① 检查 Windows 防火墙：点击顶部【一键放行防火墙】。<br>
              ② 确保房主端游戏已经开启并在监听端口。<br>
              ③ 双方路由器开启 UPnP 或具备 IPv6 环境打洞成功率更高。
            </p>
          </div>
        </div>

        <div class="pt-3 border-t border-white/10 flex justify-end">
          <button
            @click="showHelpModal = false"
            class="px-5 py-2 rounded-xl bg-emerald-500 text-slate-950 text-xs font-bold hover:bg-emerald-400 transition cursor-pointer"
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
  ShieldCheck,
  ShieldAlert,
  HelpCircle,
  Sparkles,
  X
} from 'lucide-vue-next';
import {
  p2pGetNodeId,
  p2pGetStatus,
  p2pStartDaemon,
  p2pStopAll,
  p2pConnectTunnel,
  p2pRemoveTunnel,
  p2pGenerateCode,
  p2pParseCode,
  p2pCheckFirewall,
  p2pAllowFirewall,
  formatIpcError
} from '../../api/tauriBridge';
import type {
  P2pStatusInfo,
  P2pGamePreset,
  ParsedShareCode
} from '../../../types';

const emit = defineEmits<{
  (e: 'toast', msg: string): void;
}>();

// 内置常用游戏预设（离线可靠 fallback）
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

// 全局状态
const nodeId = ref<string>('');
const status = ref<P2pStatusInfo>({
  running: false,
  nodeId: '',
  exeFound: false,
  activeTunnels: [],
  binaryPath: '',
  message: '',
});

const isRefreshing = ref<boolean>(false);
const isOperating = ref<boolean>(false);
const isSettingFirewall = ref<boolean>(false);
const firewallChecked = ref<boolean>(false);
const firewallAllowed = ref<boolean>(false);
const showHelpModal = ref<boolean>(false);
const detectedClipboardCode = ref<string>('');

const currentPreset = computed(() => {
  return presetsList.value.find((p) => p.id === selectedPresetId.value);
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
  } catch (err) {
    console.error('获取 P2P 状态失败:', err);
  }
};

const handleRefreshStatus = async () => {
  isRefreshing.value = true;
  await fetchStatus();
  await checkFirewallStatus();
  setTimeout(() => {
    isRefreshing.value = false;
  }, 400);
};

const checkFirewallStatus = async () => {
  try {
    firewallAllowed.value = await p2pCheckFirewall();
    firewallChecked.value = true;
  } catch {
    firewallChecked.value = false;
  }
};

const handleAllowFirewall = async () => {
  isSettingFirewall.value = true;
  try {
    const ok = await p2pAllowFirewall();
    if (ok) {
      firewallAllowed.value = true;
      emit('toast', 'Windows 防火墙放行规则配置成功！');
    }
  } catch (err: any) {
    emit('toast', `放行防火墙失败: ${formatIpcError(err)}`);
  } finally {
    isSettingFirewall.value = false;
  }
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
    // 房主生成联机码时自动启动后台监听
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
    emit('toast', `已连通！在游戏内直连 ${lastConnectedAddress.value} 即可`);
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

// 剪贴板嗅探（用户切回应用时自动检测是否有联机码）
const checkClipboardForCode = async () => {
  try {
    const text = await navigator.clipboard.readText();
    const trimmed = text.trim();
    if (
      (trimmed.startsWith('CFD://') || trimmed.startsWith('OPL://') || trimmed.startsWith('cfd://')) &&
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
  await checkFirewallStatus();
  await checkClipboardForCode();
  handlePresetChange();

  // 定时轮询隧道运行状态 (每 5 秒)
  statusTimer = setInterval(fetchStatus, 5000);
});

onUnmounted(() => {
  if (statusTimer) {
    clearInterval(statusTimer);
  }
});
</script>
