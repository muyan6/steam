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
      class="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 md:p-6 select-none app-no-drag"
      @click.self="emit('update:modelValue', false)"
    >
      <div
        class="guide-modal-card rounded-3xl w-full max-w-4xl max-h-[88vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200 shadow-2xl"
      >
        <!-- 弹窗头部：通透大气、间距舒展、跟随软件整体审美 -->
        <div class="px-7 py-5 md:px-8 md:py-6 border-b border-white/10 flex items-center justify-between shrink-0 bg-white/5">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-2xl theme-btn-primary flex items-center justify-center text-white shadow-lg shrink-0">
              <Library class="w-6 h-6" />
            </div>
            <div>
              <div class="flex items-center gap-2.5 flex-wrap">
                <h3 class="text-lg md:text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                  已入库规则管理与核心模式详解
                </h3>
                <span class="text-xs px-2.5 py-0.5 rounded-full font-mono bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20">
                  v2.8.0 指南
                </span>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                掌握「跟随最新」与「版本锁定」运行逻辑、完整交互操作与全卡片状态徽标速查
              </p>
            </div>
          </div>

          <button
            @click="emit('update:modelValue', false)"
            class="w-9 h-9 rounded-2xl bg-white/5 hover:bg-white/15 border border-white/10 flex items-center justify-center text-slate-400 hover:text-slate-800 dark:hover:text-white transition cursor-pointer shrink-0 active:scale-95"
            title="关闭说明 (ESC)"
          >
            <X class="w-4 h-4" />
          </button>
        </div>

        <!-- 弹窗可滚动主体区：分层清晰、图标齐全、高度舒适 -->
        <div class="flex-1 overflow-y-auto px-7 py-6 md:px-8 md:py-7 space-y-7 text-xs leading-relaxed text-slate-300">
          <!-- 模块 1：双模式权威图解对比 (类似实用工具箱卡片，联动主题渐变) -->
          <div>
            <div class="flex items-center gap-2.5 mb-3.5">
              <span class="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
              <h4 class="font-bold text-sm md:text-base text-slate-900 dark:text-slate-100 tracking-wide">
                核心机制：两种清单模式怎么选？
              </h4>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- 卡片 A: 跟随最新 -->
              <div class="rounded-2xl guide-hero-card p-5 flex flex-col justify-between relative overflow-hidden">
                <div>
                  <div class="flex items-center justify-between mb-3">
                    <span class="text-xs px-3 py-1 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-300 font-bold border border-sky-500/30 flex items-center gap-1.5">
                      <Zap class="w-4 h-4" />
                      <span>跟随最新 (动态清单)</span>
                    </span>
                    <span class="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-semibold border border-emerald-500/25">
                      推荐模式
                    </span>
                  </div>
                  <h5 class="text-slate-900 dark:text-slate-100 font-bold text-sm mb-2">
                    无需任何本地实体清单文件，永远保持官方最新版
                  </h5>
                  <ul class="space-y-2.5 text-slate-600 dark:text-slate-300 text-xs mt-3">
                    <li class="flex items-start gap-2">
                      <CloudDownload class="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">直连 CDN 动态拉取</strong>：点击下载时由内核实时向官方获取最新清单代码，免维护。</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <Sparkles class="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">天然跟进游戏更新</strong>：官方游戏更新后可直接在 Steam 内平滑更新，绝不落后。</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <Gamepad2 class="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">适用场景</strong>：95% 单人剧情游戏、普通联机作品、经常游玩的主力游戏。</span>
                    </li>
                  </ul>
                </div>
                <div class="mt-4 pt-3 border-t border-white/10 text-xs text-sky-600 dark:text-sky-400 font-mono font-medium flex items-center gap-1.5">
                  <Zap class="w-3.5 h-3.5" />
                  <span>卡片状态标识：跟随最新</span>
                </div>
              </div>

              <!-- 卡片 B: 锁定版本 -->
              <div class="rounded-2xl guide-hero-card p-5 flex flex-col justify-between relative overflow-hidden">
                <div>
                  <div class="flex items-center justify-between mb-3">
                    <span class="text-xs px-3 py-1 rounded-xl bg-purple-500/15 text-purple-600 dark:text-purple-300 font-bold border border-purple-500/30 flex items-center gap-1.5">
                      <Lock class="w-4 h-4" />
                      <span>版本锁定 (本地清单)</span>
                    </span>
                    <span class="text-[11px] px-2.5 py-0.5 rounded-full bg-slate-500/15 text-slate-600 dark:text-slate-300 font-semibold border border-slate-400/20">
                      联机对版本用
                    </span>
                  </div>
                  <h5 class="text-slate-900 dark:text-slate-100 font-bold text-sm mb-2">
                    钉死特定版本，官方出新版也绝不自动更新
                  </h5>
                  <ul class="space-y-2.5 text-slate-600 dark:text-slate-300 text-xs mt-3">
                    <li class="flex items-start gap-2">
                      <FileCheck class="w-4 h-4 text-purple-500 shrink-0 mt-0.5" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">依赖本地实体清单</strong>：必须将对应版本的清单文件提前存放在 <code>depotcache/</code> 目录。</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <ShieldAlert class="w-4 h-4 text-purple-500 shrink-0 mt-0.5" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">锁定不随官方升级</strong>：避免游戏自动更新导致第三方联机补丁失效或版本不互通。</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <Users class="w-4 h-4 text-purple-500 shrink-0 mt-0.5" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">适用场景</strong>：OnlineFix、Spacewar、局域网对战等需与好友版本严格一致的联机游戏。</span>
                    </li>
                  </ul>
                </div>
                <div class="mt-4 pt-3 border-t border-white/10 text-xs text-purple-600 dark:text-purple-400 font-mono font-medium flex items-center gap-1.5">
                  <Lock class="w-3.5 h-3.5" />
                  <span>卡片状态标识：已锁定 / 待缓存</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 模块 2：顶部与全局操作栏功能详解 (补齐全部图标与功能!) -->
          <div>
            <div class="flex items-center gap-2.5 mb-3.5">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <h4 class="font-bold text-sm md:text-base text-slate-900 dark:text-slate-100 tracking-wide">
                顶部与全局操作栏
              </h4>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              <!-- 检查更新 -->
              <div class="p-3.5 rounded-2xl guide-item-card flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-2 mb-1.5">
                    <div class="w-7 h-7 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
                      <Sparkles class="w-4 h-4" />
                    </div>
                    <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">检查更新</span>
                  </div>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    逐个对比已入库规则的清单版本与云端最新版；仅检查「已锁定」游戏，跟随最新会自动跳过。
                  </p>
                </div>
              </div>

              <!-- 刷新列表 -->
              <div class="p-3.5 rounded-2xl guide-item-card flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-2 mb-1.5">
                    <div class="w-7 h-7 rounded-xl bg-sky-500/15 text-sky-500 flex items-center justify-center shrink-0">
                      <RotateCw class="w-4 h-4" />
                    </div>
                    <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">刷新列表</span>
                  </div>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    重新扫描规则目录与本地磁盘，刷新所有游戏卡片的密钥状态、清单缓存与版本信息。
                  </p>
                </div>
              </div>

              <!-- 三态状态筛选 -->
              <div class="p-3.5 rounded-2xl guide-item-card flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-2 mb-1.5">
                    <div class="w-7 h-7 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0">
                      <Filter class="w-4 h-4" />
                    </div>
                    <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">三态状态筛选</span>
                  </div>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    在「全部」、「生效中」、「已停用」标签间一键快速过滤，角标实时显示各状态数量。
                  </p>
                </div>
              </div>

              <!-- 账号秒切 -->
              <div class="p-3.5 rounded-2xl guide-item-card flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-2 mb-1.5">
                    <div class="w-7 h-7 rounded-xl bg-purple-500/15 text-purple-500 flex items-center justify-center shrink-0">
                      <Users class="w-4 h-4" />
                    </div>
                    <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">Steam 账号秒切</span>
                  </div>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    主界面左下角常驻展示当前账号。点击即可在下拉窗中免密极速切换本地其他账号。
                  </p>
                </div>
              </div>

              <!-- 重启 Steam -->
              <div class="p-3.5 rounded-2xl guide-item-card flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-2 mb-1.5">
                    <div class="w-7 h-7 rounded-xl bg-blue-500/15 text-blue-500 flex items-center justify-center shrink-0">
                      <RotateCcw class="w-4 h-4" />
                    </div>
                    <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">重启 Steam (备用)</span>
                  </div>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    入库即时生效一般无须重启；仅在 Steam 偶发未识别规则或卡死时作为备用手段平滑重启。
                  </p>
                </div>
              </div>

              <!-- 清空所有 -->
              <div class="p-3.5 rounded-2xl guide-item-card flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-2 mb-1.5">
                    <div class="w-7 h-7 rounded-xl bg-rose-500/15 text-rose-500 flex items-center justify-center shrink-0">
                      <Trash2 class="w-4 h-4" />
                    </div>
                    <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">清空所有</span>
                  </div>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    一键清空全部游戏的入库规则（高危操作，提供二次弹窗确认保护，谨慎使用）。
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- 模块 3：游戏卡片操作栏与功能按钮 (补齐卡片上的全部操作图标!) -->
          <div>
            <div class="flex items-center gap-2.5 mb-3.5">
              <span class="w-2.5 h-2.5 rounded-full bg-purple-500"></span>
              <h4 class="font-bold text-sm md:text-base text-slate-900 dark:text-slate-100 tracking-wide">
                游戏卡片操作与功能按钮
              </h4>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              <!-- 下载 -->
              <div class="p-3.5 rounded-2xl guide-item-card flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-2 mb-1.5">
                    <div class="w-7 h-7 rounded-xl bg-sky-500/15 text-sky-500 flex items-center justify-center shrink-0">
                      <Download class="w-4 h-4" />
                    </div>
                    <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">下载</span>
                  </div>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    调起 Steam 客户端原生下载队列，触发 CDN 高速分包下载与自动安装。
                  </p>
                </div>
              </div>

              <!-- 运行 -->
              <div class="p-3.5 rounded-2xl guide-item-card flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-2 mb-1.5">
                    <div class="w-7 h-7 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0">
                      <Play class="w-4 h-4" />
                    </div>
                    <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">运行</span>
                  </div>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    游戏下载完成后，直接以 Steam 原生授权会话拉起游戏可执行程序启动游戏。
                  </p>
                </div>
              </div>

              <!-- 锁定 / 跟随 -->
              <div class="p-3.5 rounded-2xl guide-item-card flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-2 mb-1.5">
                    <div class="w-7 h-7 rounded-xl bg-purple-500/15 text-purple-500 flex items-center justify-center shrink-0">
                      <Lock class="w-4 h-4" />
                    </div>
                    <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">锁定 / 跟随</span>
                  </div>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    点击「锁定」将当前版本钉死；点击「跟随」随时解除锁定，恢复跟随最新。
                  </p>
                </div>
              </div>

              <!-- 停用 / 启用 -->
              <div class="p-3.5 rounded-2xl guide-item-card flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-2 mb-1.5">
                    <div class="w-7 h-7 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
                      <Power class="w-4 h-4" />
                    </div>
                    <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">停用 / 启用</span>
                  </div>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    点击「停用」软下架归档到 <code>Disable/</code> 目录，Steam 中立即隐身；点「启用」瞬间复原。
                  </p>
                </div>
              </div>

              <!-- 预缓存清单 -->
              <div class="p-3.5 rounded-2xl guide-item-card flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-2 mb-1.5">
                    <div class="w-7 h-7 rounded-xl bg-orange-500/15 text-orange-500 flex items-center justify-center shrink-0">
                      <HardDriveDownload class="w-4 h-4" />
                    </div>
                    <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">预缓存</span>
                  </div>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    锁定模式专属：一键从 CDN 下载实体清单解压到 <code>depotcache</code>，确保下载无误。
                  </p>
                </div>
              </div>

              <!-- 出库 -->
              <div class="p-3.5 rounded-2xl guide-item-card flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-2 mb-1.5">
                    <div class="w-7 h-7 rounded-xl bg-rose-500/15 text-rose-500 flex items-center justify-center shrink-0">
                      <Trash2 class="w-4 h-4" />
                    </div>
                    <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">出库</span>
                  </div>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    彻底删除该游戏的 Lua 规则文件，从库中完全移除该游戏（出库操作）。
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- 模块 4：卡片徽标速查字典 (带图标的完整释义) -->
          <div>
            <div class="flex items-center gap-2.5 mb-3.5">
              <span class="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
              <h4 class="font-bold text-sm md:text-base text-slate-900 dark:text-slate-100 tracking-wide">
                卡片徽标状态速查字典
              </h4>
            </div>

            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-xs">
              <div class="p-3 rounded-xl guide-item-card flex flex-col gap-1.5">
                <div class="flex items-center gap-1.5">
                  <CheckCircle2 class="w-3.5 h-3.5 text-emerald-500" />
                  <span class="font-bold text-emerald-600 dark:text-emerald-400 font-mono">已生效</span>
                </div>
                <span class="text-slate-500 dark:text-slate-400 text-[11px]">规则已激活挂载</span>
              </div>

              <div class="p-3 rounded-xl guide-item-card flex flex-col gap-1.5">
                <div class="flex items-center gap-1.5">
                  <MinusCircle class="w-3.5 h-3.5 text-slate-400" />
                  <span class="font-bold text-slate-600 dark:text-slate-300 font-mono">已停用</span>
                </div>
                <span class="text-slate-500 dark:text-slate-400 text-[11px]">规则已在 Disable 归档</span>
              </div>

              <div class="p-3 rounded-xl guide-item-card flex flex-col gap-1.5">
                <div class="flex items-center gap-1.5">
                  <Key class="w-3.5 h-3.5 text-emerald-500" />
                  <span class="font-bold text-emerald-600 dark:text-emerald-400 font-mono">密钥已注入</span>
                </div>
                <span class="text-slate-500 dark:text-slate-400 text-[11px]">Depot解密密钥就绪</span>
              </div>

              <div class="p-3 rounded-xl guide-item-card flex flex-col gap-1.5">
                <div class="flex items-center gap-1.5">
                  <ShieldCheck class="w-3.5 h-3.5 text-purple-500" />
                  <span class="font-bold text-purple-600 dark:text-purple-400 font-mono">Token</span>
                </div>
                <span class="text-slate-500 dark:text-slate-400 text-[11px]">PICS 访问令牌已配</span>
              </div>

              <div class="p-3 rounded-xl guide-item-card flex flex-col gap-1.5">
                <div class="flex items-center gap-1.5">
                  <Zap class="w-3.5 h-3.5 text-sky-500" />
                  <span class="font-bold text-sky-600 dark:text-sky-400 font-mono">跟随最新</span>
                </div>
                <span class="text-slate-500 dark:text-slate-400 text-[11px]">CDN动态清单，自动升级</span>
              </div>

              <div class="p-3 rounded-xl guide-item-card flex flex-col gap-1.5">
                <div class="flex items-center gap-1.5">
                  <Lock class="w-3.5 h-3.5 text-slate-400" />
                  <span class="font-bold text-slate-600 dark:text-slate-300 font-mono">已锁定</span>
                </div>
                <span class="text-slate-500 dark:text-slate-400 text-[11px]">本地实体清单已就绪</span>
              </div>

              <div class="p-3 rounded-xl guide-item-card flex flex-col gap-1.5">
                <div class="flex items-center gap-1.5">
                  <AlertTriangle class="w-3.5 h-3.5 text-amber-500" />
                  <span class="font-bold text-amber-600 dark:text-amber-400 font-mono">待缓存</span>
                </div>
                <span class="text-slate-500 dark:text-slate-400 text-[11px]">锁定模式但缺本地清单</span>
              </div>

              <div class="p-3 rounded-xl guide-item-card flex flex-col gap-1.5">
                <div class="flex items-center gap-1.5">
                  <ArrowUpCircle class="w-3.5 h-3.5 text-amber-500" />
                  <span class="font-bold text-amber-600 dark:text-amber-400 font-mono">有更新</span>
                </div>
                <span class="text-slate-500 dark:text-slate-400 text-[11px]">官方出新版，可点跟随</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 弹窗底部操作栏：舒适留白与主题主按钮 -->
        <div class="px-7 py-4 md:px-8 border-t border-white/10 flex items-center justify-between shrink-0 bg-white/5">
          <span class="text-xs text-slate-500 dark:text-slate-400">
            💡 提示：添加游戏后无须重启 Steam，直接在客户端中搜索下载即可
          </span>
          <button
            @click="emit('update:modelValue', false)"
            class="theme-btn-primary px-6 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer active:scale-95 flex items-center gap-2 shadow-md"
          >
            <Check class="w-4 h-4" />
            <span>我知道了</span>
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import {
  Library,
  X,
  Zap,
  Lock,
  Check,
  Power,
  Filter,
  Users,
  Sparkles,
  RotateCw,
  RotateCcw,
  Trash2,
  Download,
  Play,
  HardDriveDownload,
  CloudDownload,
  Gamepad2,
  FileCheck,
  ShieldAlert,
  CheckCircle2,
  MinusCircle,
  Key,
  ShieldCheck,
  AlertTriangle,
  ArrowUpCircle
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
