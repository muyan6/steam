<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0 scale-95"
    enter-to-class="opacity-100 scale-100"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100 scale-100"
    leave-to-class="opacity-0 scale-95"
  >
    <div
      v-if="modelValue"
      class="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 select-none app-no-drag"
      @click.self="emit('update:modelValue', false)"
    >
      <div
        class="theme-card-static rounded-3xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl border border-white/15 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
      >
        <!-- 弹窗头部 -->
        <div class="px-6 py-4.5 border-b border-white/10 flex items-center justify-between shrink-0 bg-white/5">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center text-sky-500 dark:text-sky-400 shadow-inner">
              <BookOpen class="w-5 h-5" />
            </div>
            <div>
              <h3 class="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <span>规则管理与核心模式详解</span>
                <span class="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20 font-mono font-normal">
                  v2.8.0 指南
                </span>
              </h3>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">直观搞懂「跟随最新」与「锁定版本」机制、规则生命周期及便捷操作</p>
            </div>
          </div>

          <button
            @click="emit('update:modelValue', false)"
            class="w-8 h-8 rounded-xl bg-white/5 hover:bg-white/15 border border-white/10 flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-white transition cursor-pointer"
            title="关闭说明 (ESC)"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <!-- 弹窗可滚动主体区 (解决不能向下滑动的核心问题) -->
        <div class="flex-1 overflow-y-auto p-6 space-y-6 text-xs leading-relaxed text-slate-300">
          <!-- 模块 1：双模式直观图解对比（彻底搞懂跟随最新与锁定版本） -->
          <div>
            <div class="flex items-center gap-2 mb-3">
              <span class="w-2 h-2 rounded-full bg-sky-400"></span>
              <h4 class="font-bold text-sm text-slate-800 dark:text-slate-100 tracking-wide">核心机制：两种清单模式怎么选？</h4>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- 卡片 A: 跟随最新 -->
              <div class="p-4 rounded-2xl guide-card-accent-a flex flex-col justify-between relative overflow-hidden shadow-sm">
                <div class="absolute -right-6 -bottom-6 w-20 h-20 rounded-full bg-cyan-500/10 blur-xl"></div>
                <div>
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-xs px-2.5 py-1 rounded-lg bg-cyan-500/20 text-cyan-700 dark:text-cyan-300 font-bold border border-cyan-500/30 flex items-center gap-1.5">
                      <Zap class="w-3.5 h-3.5" />
                      <span>跟随最新 (动态清单)</span>
                    </span>
                    <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-semibold border border-emerald-500/30">
                      推荐模式
                    </span>
                  </div>
                  <p class="text-slate-800 dark:text-slate-200 font-semibold text-xs mt-1">无需任何本地实体清单文件，永远保持最新版</p>
                  <ul class="mt-3 space-y-2 text-slate-600 dark:text-slate-300 text-[11px]">
                    <li class="flex items-start gap-1.5">
                      <Check class="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5 font-bold" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">直连 CDN 动态拉取</strong>：点击下载时由内核实时获取官方最新清单代码。</span>
                    </li>
                    <li class="flex items-start gap-1.5">
                      <Check class="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5 font-bold" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">天然跟进游戏更新</strong>：官方游戏更新后可直接在 Steam 内平滑更新。</span>
                    </li>
                    <li class="flex items-start gap-1.5">
                      <Check class="w-3.5 h-3.5 text-cyan-600 dark:text-cyan-400 shrink-0 mt-0.5 font-bold" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">适用场景</strong>：95% 单人剧情游戏、普通联机游戏、常玩游戏。</span>
                    </li>
                  </ul>
                </div>
                <div class="mt-4 pt-2.5 border-t border-cyan-500/20 text-[11px] text-cyan-700 dark:text-cyan-300 font-mono">
                  状态标识：<span class="font-bold">⚡ 跟随最新</span>
                </div>
              </div>

              <!-- 卡片 B: 锁定版本 -->
              <div class="p-4 rounded-2xl guide-card-accent-b flex flex-col justify-between relative overflow-hidden shadow-sm">
                <div class="absolute -right-6 -bottom-6 w-20 h-20 rounded-full bg-purple-500/10 blur-xl"></div>
                <div>
                  <div class="flex items-center justify-between mb-2">
                    <span class="text-xs px-2.5 py-1 rounded-lg bg-purple-500/20 text-purple-700 dark:text-purple-300 font-bold border border-purple-500/30 flex items-center gap-1.5">
                      <Lock class="w-3.5 h-3.5" />
                      <span>版本锁定 (本地清单)</span>
                    </span>
                    <span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-600 dark:text-slate-300 font-semibold border border-slate-400/20">
                      联机对版本用
                    </span>
                  </div>
                  <p class="text-slate-800 dark:text-slate-200 font-semibold text-xs mt-1">钉死特定版本，官方出新版也绝不更新</p>
                  <ul class="mt-3 space-y-2 text-slate-600 dark:text-slate-300 text-[11px]">
                    <li class="flex items-start gap-1.5">
                      <Check class="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5 font-bold" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">依赖实体清单文件</strong>：必须将对应版本清单存放在 depotcache 目录。</span>
                    </li>
                    <li class="flex items-start gap-1.5">
                      <Check class="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5 font-bold" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">锁定不随官方升级</strong>：避免游戏自动更新导致第三方联机补丁失效。</span>
                    </li>
                    <li class="flex items-start gap-1.5">
                      <Check class="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5 font-bold" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">适用场景</strong>：OnlineFix、Spacewar、局域网对战需与朋友版本严格一致。</span>
                    </li>
                  </ul>
                </div>
                <div class="mt-4 pt-2.5 border-t border-purple-500/20 text-[11px] text-purple-700 dark:text-purple-300 font-mono">
                  状态标识：<span class="font-bold">🔒 已锁定</span> / <span class="font-bold text-amber-500 dark:text-amber-400">⚠️ 待缓存</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 模块 2：常用核心操作图文解说 -->
          <div>
            <div class="flex items-center gap-2 mb-3">
              <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
              <h4 class="font-bold text-sm text-slate-800 dark:text-slate-100 tracking-wide">卡片操作与常用功能</h4>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              <!-- 操作 1: 停用 / 启用 -->
              <div class="p-3.5 rounded-2xl guide-sub-card">
                <div class="flex items-center gap-2.5 mb-1.5">
                  <div class="w-7 h-7 rounded-xl bg-sky-500/20 text-sky-600 dark:text-sky-400 flex items-center justify-center font-bold">
                    <Power class="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span class="font-bold text-slate-800 dark:text-slate-100 text-xs">停用 / 启用 (软下架归档)</span>
                    <span class="ml-2 text-[10px] text-sky-600 dark:text-sky-400 font-mono font-semibold">新特性</span>
                  </div>
                </div>
                <p class="text-slate-600 dark:text-slate-300 text-[11px] pl-9.5">
                  无需物理删除文件！点击「停用」自动将 Lua 规则移动到 <code class="text-sky-600 dark:text-sky-300 font-bold">Disable/</code> 目录，Steam 中立即隐身且不下载；想玩时点击「启用」瞬间满血复原。
                </p>
              </div>

              <!-- 操作 2: 状态三态筛选 -->
              <div class="p-3.5 rounded-2xl guide-sub-card">
                <div class="flex items-center gap-2.5 mb-1.5">
                  <div class="w-7 h-7 rounded-xl bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
                    <Filter class="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span class="font-bold text-slate-800 dark:text-slate-100 text-xs">三态状态筛选标签</span>
                    <span class="ml-2 text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-semibold">新特性</span>
                  </div>
                </div>
                <p class="text-slate-600 dark:text-slate-300 text-[11px] pl-9.5">
                  搜索栏旁支持一键在「全部」、「生效中」、「已停用」间快速过滤，卡片角标实时显示各状态数量，海量入库井井有条。
                </p>
              </div>

              <!-- 操作 3: 账号一键免密秒切 -->
              <div class="p-3.5 rounded-2xl guide-sub-card">
                <div class="flex items-center gap-2.5 mb-1.5">
                  <div class="w-7 h-7 rounded-xl bg-purple-500/20 text-purple-600 dark:text-purple-400 flex items-center justify-center font-bold">
                    <Users class="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span class="font-bold text-slate-800 dark:text-slate-100 text-xs">Steam 账号免密秒切</span>
                    <span class="ml-2 text-[10px] text-purple-600 dark:text-purple-400 font-mono font-semibold">左侧边栏底部</span>
                  </div>
                </div>
                <p class="text-slate-600 dark:text-slate-300 text-[11px] pl-9.5">
                  主界面左下角常驻展示当前登录账号。点击即可在下拉窗中免密极速切换到其他已记住密码的 Steam 本地账号，平滑重启生效。
                </p>
              </div>

              <!-- 操作 4: 锁定与跟随切换 -->
              <div class="p-3.5 rounded-2xl guide-sub-card">
                <div class="flex items-center gap-2.5 mb-1.5">
                  <div class="w-7 h-7 rounded-xl bg-amber-500/20 text-amber-600 dark:text-amber-400 flex items-center justify-center font-bold">
                    <RefreshCw class="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <span class="font-bold text-slate-800 dark:text-slate-100 text-xs">锁定 / 跟随 一键切换</span>
                    <span class="ml-2 text-[10px] text-amber-600 dark:text-amber-400 font-mono font-semibold">版本控制</span>
                  </div>
                </div>
                <p class="text-slate-600 dark:text-slate-300 text-[11px] pl-9.5">
                  点击「锁定」即可将当前官方版本锁定在规则中；点击「跟随」即可随时解除锁定，恢复自动跟随官方最新版。
                </p>
              </div>
            </div>
          </div>

          <!-- 模块 3：卡片徽标速查字典 -->
          <div>
            <div class="flex items-center gap-2 mb-3">
              <span class="w-2 h-2 rounded-full bg-purple-400"></span>
              <h4 class="font-bold text-sm text-slate-800 dark:text-slate-100 tracking-wide">卡片徽标快速释义</h4>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-[11px]">
              <div class="p-2.5 rounded-xl guide-sub-card flex flex-col gap-1">
                <span class="w-fit px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-bold font-mono">已生效</span>
                <span class="text-slate-500 dark:text-slate-400 text-[10px]">规则已激活挂载</span>
              </div>
              <div class="p-2.5 rounded-xl guide-sub-card flex flex-col gap-1">
                <span class="w-fit px-2 py-0.5 rounded-md bg-slate-500/20 text-slate-600 dark:text-slate-300 font-bold font-mono">已停用</span>
                <span class="text-slate-500 dark:text-slate-400 text-[10px]">规则已在 Disable 归档</span>
              </div>
              <div class="p-2.5 rounded-xl guide-sub-card flex flex-col gap-1">
                <span class="w-fit px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 font-bold font-mono">密钥</span>
                <span class="text-slate-500 dark:text-slate-400 text-[10px]">Depot解密密钥就绪</span>
              </div>
              <div class="p-2.5 rounded-xl guide-sub-card flex flex-col gap-1">
                <span class="w-fit px-2 py-0.5 rounded-md bg-purple-500/15 text-purple-700 dark:text-purple-400 font-bold font-mono">Token</span>
                <span class="text-slate-500 dark:text-slate-400 text-[10px]">PICS 访问令牌已配</span>
              </div>
              <div class="p-2.5 rounded-xl guide-sub-card flex flex-col gap-1">
                <span class="w-fit px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 font-bold font-mono">跟随最新</span>
                <span class="text-slate-500 dark:text-slate-400 text-[10px]">CDN动态清单，自动更新</span>
              </div>
              <div class="p-2.5 rounded-xl guide-sub-card flex flex-col gap-1">
                <span class="w-fit px-2 py-0.5 rounded-md bg-slate-500/20 text-slate-600 dark:text-slate-300 font-bold font-mono">已锁定</span>
                <span class="text-slate-500 dark:text-slate-400 text-[10px]">本地实体清单已就绪</span>
              </div>
              <div class="p-2.5 rounded-xl guide-sub-card flex flex-col gap-1">
                <span class="w-fit px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-400 font-bold font-mono">待缓存</span>
                <span class="text-slate-500 dark:text-slate-400 text-[10px]">锁定模式但缺本地清单</span>
              </div>
              <div class="p-2.5 rounded-xl guide-sub-card flex flex-col gap-1">
                <span class="w-fit px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-400 font-bold font-mono">有更新</span>
                <span class="text-slate-500 dark:text-slate-400 text-[10px]">官方已出更新，可点跟随</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 弹窗底部操作栏 -->
        <div class="px-6 py-3.5 bg-slate-50/90 dark:bg-slate-950/80 border-t border-slate-200/80 dark:border-white/10 flex items-center justify-between shrink-0">
          <span class="text-[11px] text-slate-500 dark:text-slate-400">💡 提示：添加游戏后无须重启 Steam，直接在库中下载即可</span>
          <button
            @click="emit('update:modelValue', false)"
            class="theme-btn-primary px-5 py-2 rounded-xl text-xs font-bold transition cursor-pointer active:scale-95"
          >
            我知道了
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import {
  BookOpen,
  X,
  Zap,
  Lock,
  Check,
  Power,
  Filter,
  Users,
  RefreshCw
} from 'lucide-vue-next';

defineProps<{
  modelValue: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void;
}>();

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    emit('update:modelValue', false);
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown);
});
</script>
