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
        <!-- 弹窗头部：通透大气、舒展大方、同步软件主题 -->
        <div class="px-7 py-5 md:px-8 md:py-6 border-b border-white/10 flex items-center justify-between shrink-0 bg-white/5">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-2xl theme-btn-primary flex items-center justify-center text-white shadow-lg shrink-0">
              <Gamepad2 class="w-6 h-6" />
            </div>
            <div>
              <div class="flex items-center gap-2.5 flex-wrap">
                <h3 class="text-lg md:text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                  联机方案与启动模式全指南
                </h3>
                <span class="text-xs px-2.5 py-0.5 rounded-full font-mono bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                  全场景联机生态
                </span>
              </div>
              <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                搞懂游戏联机两大方案选型、三大启动手法差异与【异地联机组网 P2P】穿透直连
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

        <!-- 弹窗主体区：全软件主题同步联动 -->
        <div class="flex-1 overflow-y-auto px-7 py-6 md:px-8 md:py-7 space-y-7 text-xs leading-relaxed text-slate-300">
          <!-- 模块 1：两大方案图解对比 -->
          <div>
            <div class="flex items-center gap-2.5 mb-3.5">
              <span class="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
              <h4 class="font-bold text-sm md:text-base text-slate-900 dark:text-slate-100 tracking-wide">
                核心机制：两大联机方案怎么选？
              </h4>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <!-- 卡片 A: 方案一 · Steam 通道联机 -->
              <div class="rounded-2xl guide-hero-card p-5 flex flex-col justify-between relative overflow-hidden">
                <div>
                  <div class="flex items-center justify-between mb-3">
                    <span class="text-xs px-3 py-1 rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-bold border border-emerald-500/30 flex items-center gap-1.5">
                      <Rocket class="w-4 h-4" />
                      <span>方案一 · Steam 通道联机</span>
                    </span>
                    <span class="text-[11px] px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 font-semibold border border-emerald-500/25">
                      免改文件 · 优先推荐
                    </span>
                  </div>
                  <h5 class="text-slate-900 dark:text-slate-100 font-bold text-sm mb-2">
                    零门槛直启，通道伪装入官方测试大厅 (Spacewar 480)
                  </h5>
                  <ul class="space-y-2.5 text-slate-600 dark:text-slate-300 text-xs mt-3">
                    <li class="flex items-start gap-2">
                      <ShieldCheck class="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">免改任何游戏文件</strong>：100% 保持原版完整，不替换任何 DLL，不污染游戏目录。</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <Users class="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">Steam 原生好友邀请</strong>：在好友列表中右键直接「邀请加入游戏」，秒入原生 P2P 大厅。</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <ArrowLeftRight class="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">三种手法本质相同</strong>：Open 内核、Spacewar 伪装与 BAT 脚本底层通道一致；若连不上请直接改用方案二。</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <Gamepad2 class="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">适用场景</strong>：绿色徽章游戏、原生 Steamworks P2P 联机游戏（占 80% 常见联机库）。</span>
                    </li>
                  </ul>
                </div>
                <div class="mt-4 pt-3 border-t border-white/10 text-xs text-emerald-600 dark:text-emerald-400 font-mono font-medium flex items-center gap-1.5">
                  <Rocket class="w-3.5 h-3.5" />
                  <span>推荐度：★★★★★ · 纯入库联机首选</span>
                </div>
              </div>

              <!-- 卡片 B: 方案二 · 联机补丁注入 -->
              <div class="rounded-2xl guide-hero-card p-5 flex flex-col justify-between relative overflow-hidden">
                <div>
                  <div class="flex items-center justify-between mb-3">
                    <span class="text-xs px-3 py-1 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300 font-bold border border-amber-500/30 flex items-center gap-1.5">
                      <Wrench class="w-4 h-4" />
                      <span>方案二 · 联机补丁注入</span>
                    </span>
                    <span class="text-[11px] px-2.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-300 font-semibold border border-amber-500/25">
                      深度修复 · 云端大厅
                    </span>
                  </div>
                  <h5 class="text-slate-900 dark:text-slate-100 font-bold text-sm mb-2">
                    修改游戏文件精准修复，攻克强鉴权与三方网络
                  </h5>
                  <ul class="space-y-2.5 text-slate-600 dark:text-slate-300 text-xs mt-3">
                    <li class="flex items-start gap-2">
                      <FileCode class="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">精准替换专用 DLL</strong>：对接 online-fix.me 补丁库或 Goldberg，替换 <code>steam_api64.dll</code> 等接口。</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <ShieldAlert class="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">攻克强鉴权大厅</strong>：针对《致命公司》《恐鬼症》等官方云端强校验服务器，免改直启会被拒，必须装补丁。</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <Network class="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">支持局域网对战</strong>：Goldberg 模拟器支持无公网、校园网或离线环境下的好友直连。</span>
                    </li>
                    <li class="flex items-start gap-2">
                      <RotateCcw class="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <span><strong class="text-slate-900 dark:text-slate-100 font-bold">原文件自动备份</strong>：补丁部署前自动备份原始文件，随时在管理面板一键无损还原。</span>
                    </li>
                  </ul>
                </div>
                <div class="mt-4 pt-3 border-t border-white/10 text-xs text-amber-600 dark:text-amber-400 font-mono font-medium flex items-center gap-1.5">
                  <Wrench class="w-3.5 h-3.5" />
                  <span>适用范围：琥珀/橙色徽章、方案一进不去大厅的游戏</span>
                </div>
              </div>
            </div>
          </div>

          <!-- 模块 1.5：网络底座：异地联机组网 (P2P 穿透/局域网互通) -->
          <div>
            <div class="flex items-center gap-2.5 mb-3.5">
              <span class="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
              <h4 class="font-bold text-sm md:text-base text-slate-900 dark:text-slate-100 tracking-wide">
                网络底座：异地联机组网 (P2P 穿透/局域网互通)
              </h4>
            </div>

            <div class="rounded-2xl guide-hero-card p-5 relative overflow-hidden border border-sky-500/30 bg-sky-500/5">
              <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                <span class="text-xs px-3 py-1 rounded-xl bg-sky-500/15 text-sky-600 dark:text-sky-300 font-bold border border-sky-500/30 flex items-center gap-1.5">
                  <Network class="w-4 h-4" />
                  <span>异地联机组网 · P2P 穿透直连</span>
                </span>
                <span class="text-[11px] px-2.5 py-0.5 rounded-full bg-sky-500/15 text-sky-600 dark:text-sky-300 font-semibold border border-sky-500/25">
                  自包含联机码 · 免公网 IP
                </span>
              </div>
              <h5 class="text-slate-900 dark:text-slate-100 font-bold text-sm mb-2">
                攻克非 Steam 专网、纯局域网广播与自建专用服异地跨网直连难题
              </h5>
              <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5 mt-3.5 text-xs text-slate-600 dark:text-slate-300">
                <div class="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                  <strong class="text-slate-900 dark:text-slate-100 font-bold flex items-center gap-1.5">
                    <span>📌 适用场景</span>
                  </strong>
                  <p class="leading-relaxed text-[11px]">
                    《幻兽帕鲁》自建专用服、《Minecraft 我的世界》、《泰拉瑞亚》、《饥荒》、《星露谷物语》、《七日杀》等 IP 直连或局域网对战游戏。
                  </p>
                </div>
                <div class="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                  <strong class="text-slate-900 dark:text-slate-100 font-bold flex items-center gap-1.5">
                    <span>⚡ 核心原理</span>
                  </strong>
                  <p class="leading-relaxed text-[11px]">
                    基于 OpenP2P 协议进行 NAT1~4 穿透打洞，利用自带的公共信令网络实现点对点直连，免除自建中转服务器与账号注册门槛。
                  </p>
                </div>
                <div class="p-3 rounded-xl bg-white/5 border border-white/5 space-y-1">
                  <strong class="text-slate-900 dark:text-slate-100 font-bold flex items-center gap-1.5">
                    <span>🚀 极简用法</span>
                  </strong>
                  <p class="leading-relaxed text-[11px]">
                    房主选好游戏一键生成 <code>CFD://</code> 联机码发给基友；客机复制后软件自动嗅探，一键建立直连隧道，游戏内填 <code>127.0.0.1:本地端口</code> 秒连。
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- 模块 2：三种启动方式（方案一内部手法图解） -->
          <div>
            <div class="flex items-center gap-2.5 mb-3.5">
              <span class="w-2.5 h-2.5 rounded-full bg-sky-500"></span>
              <h4 class="font-bold text-sm md:text-base text-slate-900 dark:text-slate-100 tracking-wide">
                方案一的三种启动方式（拉起手法不同，联机效果一致）
              </h4>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              <!-- 方式 1: Open 内核直启 -->
              <div class="p-4 rounded-2xl guide-item-card flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-2.5 mb-2">
                    <div class="w-8 h-8 rounded-xl bg-sky-500/15 text-sky-500 flex items-center justify-center shrink-0">
                      <ArrowLeftRight class="w-4 h-4" />
                    </div>
                    <div>
                      <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">Open 内核直启</span>
                      <span class="ml-2 text-[10px] text-sky-600 dark:text-sky-400 font-mono font-semibold">首选推荐</span>
                    </div>
                  </div>
                  <p class="text-slate-600 dark:text-slate-300 text-xs leading-relaxed">
                    自动让 Steam 以 <code>-onlinefix</code> 参数运行（内核联机拦截生效），并通过 <code>steam -applaunch</code> 以原生会话拉起游戏；内核把会话伪装为 Spacewar (480) 通道并映射真实游戏名，同时弹出 Steam 原生邀请对话框。
                  </p>
                </div>
              </div>

              <!-- 方式 2: Spacewar 伪装直启 -->
              <div class="p-4 rounded-2xl guide-item-card flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-2.5 mb-2">
                    <div class="w-8 h-8 rounded-xl bg-purple-500/15 text-purple-500 flex items-center justify-center shrink-0">
                      <Rocket class="w-4 h-4" />
                    </div>
                    <div>
                      <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">Spacewar 伪装直启</span>
                      <span class="ml-2 text-[10px] text-purple-600 dark:text-purple-400 font-mono font-semibold">环境注入</span>
                    </div>
                  </div>
                  <p class="text-slate-600 dark:text-slate-300 text-xs leading-relaxed">
                    写入 <code>steam_appid.txt=480</code> 压制游戏自检重启，并注入环境变量直接拉起游戏主程序。好友在列表中看到你正在玩 <strong class="text-slate-900 dark:text-slate-100 font-bold">Spacewar</strong>，适合纯入库游戏联机的稳健启动。
                  </p>
                </div>
              </div>

              <!-- 方式 3: BAT 脚本注入 -->
              <div class="p-4 rounded-2xl guide-item-card flex flex-col justify-between">
                <div>
                  <div class="flex items-center gap-2.5 mb-2">
                    <div class="w-8 h-8 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0">
                      <Terminal class="w-4 h-4" />
                    </div>
                    <div>
                      <span class="font-bold text-slate-900 dark:text-slate-100 text-xs">BAT 脚本注入</span>
                      <span class="ml-2 text-[10px] text-emerald-600 dark:text-emerald-400 font-mono font-semibold">脱机可用</span>
                    </div>
                  </div>
                  <p class="text-slate-600 dark:text-slate-300 text-xs leading-relaxed">
                    在游戏目录生成 <code>Launch_Online_Fix.bat</code> 与 <code>steam_appid.txt</code> 启动环境。联机通道效果同上；生成后即使关闭本客户端，直接在本地双击该 BAT 脚本也能随时联机启动游戏。
                  </p>
                </div>
              </div>
            </div>
          </div>

          <!-- 模块 3：联机徽章速查字典 (带图标的 8 种徽章) -->
          <div>
            <div class="flex items-center gap-2.5 mb-3.5">
              <span class="w-2.5 h-2.5 rounded-full bg-purple-500"></span>
              <h4 class="font-bold text-sm md:text-base text-slate-900 dark:text-slate-100 tracking-wide">
                卡片左上角联机徽章速查字典
              </h4>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div class="p-3.5 rounded-2xl guide-item-card flex items-start gap-3">
                <div class="w-7 h-7 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
                  <Gamepad2 class="w-4 h-4" />
                </div>
                <div>
                  <span class="inline-block px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-bold font-mono text-[11px] mb-1">
                    Steamworks 联机
                  </span>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    原生 Steam P2P 大厅接口，<strong class="text-emerald-600 dark:text-emerald-400 font-bold">直接用方案一</strong>，免改文件即可。
                  </p>
                </div>
              </div>

              <div class="p-3.5 rounded-2xl guide-item-card flex items-start gap-3">
                <div class="w-7 h-7 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
                  <Network class="w-4 h-4" />
                </div>
                <div>
                  <span class="inline-block px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-bold font-mono text-[11px] mb-1">
                    Steamworks+三方
                  </span>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    核心联机走 Steam，语音等附属走三方，<strong class="text-emerald-600 dark:text-emerald-400 font-bold">仍用方案一</strong>。
                  </p>
                </div>
              </div>

              <div class="p-3.5 rounded-2xl guide-item-card flex items-start gap-3">
                <div class="w-7 h-7 rounded-xl bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0 mt-0.5">
                  <CheckCircle2 class="w-4 h-4" />
                </div>
                <div>
                  <span class="inline-block px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 font-bold font-mono text-[11px] mb-1">
                    已装联机补丁
                  </span>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    已通过方案二部署过补丁，直接点联机启动即可，无需重复操作。
                  </p>
                </div>
              </div>

              <div class="p-3.5 rounded-2xl guide-item-card flex items-start gap-3">
                <div class="w-7 h-7 rounded-xl bg-sky-500/15 text-sky-500 flex items-center justify-center shrink-0 mt-0.5">
                  <Code class="w-4 h-4" />
                </div>
                <div>
                  <span class="inline-block px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-700 dark:text-sky-400 font-bold font-mono text-[11px] mb-1">
                    Steam API
                  </span>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    接入了 Steam 但大厅类型需实测，<strong class="text-sky-600 dark:text-sky-400 font-bold">先试方案一</strong>，无效再换方案二。
                  </p>
                </div>
              </div>

              <div class="p-3.5 rounded-2xl guide-item-card flex items-start gap-3">
                <div class="w-7 h-7 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0 mt-0.5">
                  <AlertTriangle class="w-4 h-4" />
                </div>
                <div>
                  <span class="inline-block px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-400 font-bold font-mono text-[11px] mb-1">
                    云端大厅·需补丁
                  </span>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    官方云端强鉴权（如《致命公司》《恐鬼症》），免改会被拒，<strong class="text-amber-600 dark:text-amber-400 font-bold">必须用方案二</strong>。
                  </p>
                </div>
              </div>

              <div class="p-3.5 rounded-2xl guide-item-card flex items-start gap-3">
                <div class="w-7 h-7 rounded-xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0 mt-0.5">
                  <Globe class="w-4 h-4" />
                </div>
                <div>
                  <span class="inline-block px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-700 dark:text-amber-400 font-bold font-mono text-[11px] mb-1">
                    第三方网络
                  </span>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    联机走 Photon/EOS 等独立服务，Steam 通道进不去，<strong class="text-amber-600 dark:text-amber-400 font-bold">直接用方案二</strong>。
                  </p>
                </div>
              </div>

              <div class="p-3.5 rounded-2xl guide-item-card flex items-start gap-3">
                <div class="w-7 h-7 rounded-xl bg-slate-500/15 text-slate-500 flex items-center justify-center shrink-0 mt-0.5">
                  <User class="w-4 h-4" />
                </div>
                <div>
                  <span class="inline-block px-2 py-0.5 rounded-md bg-slate-500/20 text-slate-600 dark:text-slate-300 font-bold font-mono text-[11px] mb-1">
                    单机/MOD
                  </span>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    官方无联机服务或单机，如需局域网联机或自制 MOD 可尝试方案一直启。
                  </p>
                </div>
              </div>

              <div class="p-3.5 rounded-2xl guide-item-card flex items-start gap-3">
                <div class="w-7 h-7 rounded-xl bg-rose-500/15 text-rose-500 flex items-center justify-center shrink-0 mt-0.5">
                  <ShieldAlert class="w-4 h-4" />
                </div>
                <div>
                  <span class="inline-block px-2 py-0.5 rounded-md bg-slate-800/80 text-slate-400 font-bold font-mono text-[11px] mb-1">
                    官方竞技服
                  </span>
                  <p class="text-slate-600 dark:text-slate-300 text-[11px] leading-relaxed">
                    专属服务器与反作弊（CS2、Apex、PUBG），<strong class="text-rose-600 dark:text-rose-400 font-bold">不支持破解联机</strong>，须正版。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 弹窗底部操作栏：舒适留白与主题主按钮 -->
        <div class="px-7 py-4 md:px-8 border-t border-white/10 flex items-center justify-between shrink-0 bg-white/5">
          <span class="text-xs text-slate-500 dark:text-slate-400">
            💡 提示：联机前请确认已安装 Spacewar (AppID: 480)，联机好友间游戏版本需保持一致
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
  Gamepad2,
  X,
  Rocket,
  Wrench,
  Check,
  ArrowLeftRight,
  Terminal,
  ShieldCheck,
  Users,
  FileCode,
  ShieldAlert,
  Network,
  RotateCcw,
  CheckCircle2,
  Code,
  AlertTriangle,
  Globe,
  User
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
