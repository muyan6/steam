import express from 'express';
import cors from 'cors';
import { CONFIG } from './config/index.js';
import apiRouter from './routes/index.js';
import { tokenService } from './services/tokenService.js';
import { syncService } from './services/syncService.js';
import { depotService } from './services/depotService.js';
import { gameService } from './services/gameService.js';
import { sourceRegistryService } from './services/sourceRegistryService.js';
import { noticeService } from './services/noticeService.js';
import { versionService } from './services/versionService.js';
import { authService } from './services/authService.js';

const app = express();

// 基础中间件
app.use(cors({ origin: CONFIG.CORS_ORIGIN }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 简易请求日志
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.includes('/health')) {
      console.log(`[HTTP] ${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// 挂载 API 路由
app.use('/api', apiRouter);

// 后端现代化 SPA Web 管理控制台 (Single Page Application Admin Portal)
app.get(['/', '/dashboard'], (req, res) => {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SteamMaster 商业版 · 云端管控引擎与控制台</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/vue@3/dist/vue.global.prod.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <style>
    body { background-color: #0b0f19; color: #cbd5e1; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
    .glass { background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); }
    .glass-card { background: rgba(15, 23, 42, 0.85); border: 1px solid rgba(255, 255, 255, 0.08); backdrop-filter: blur(12px); }
    .glass-input { background: rgba(2, 6, 23, 0.6); border: 1px solid rgba(255, 255, 255, 0.12); color: #f8fafc; }
    .glass-input:focus { border-color: #38bdf8; outline: none; box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2); }
    .custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
    .custom-scrollbar::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); }
    .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 4px; }
    .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.3); }
    [v-cloak] { display: none; }
  </style>
</head>
<body class="min-h-screen antialiased selection:bg-sky-500 selection:text-white">
  <div id="app" v-cloak class="min-h-screen flex flex-col">

    <!-- ==================== 1. 未登录：管理员安全登录窗口 ==================== -->
    <div v-if="!isAuthenticated" class="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
      <!-- 炫酷背景光晕 -->
      <div class="absolute -top-40 -left-40 w-96 h-96 bg-sky-600/20 rounded-full blur-3xl pointer-events-none"></div>
      <div class="absolute -bottom-40 -right-40 w-96 h-96 bg-emerald-600/20 rounded-full blur-3xl pointer-events-none"></div>

      <div class="w-full max-w-md glass-card rounded-3xl p-8 shadow-2xl relative z-10 border border-slate-800 animate-in fade-in zoom-in-95 duration-300">
        <div class="text-center mb-8">
          <div class="w-16 h-16 rounded-2xl bg-gradient-to-tr from-sky-600 via-teal-500 to-emerald-400 mx-auto flex items-center justify-center text-white text-2xl font-black shadow-lg shadow-sky-500/20 mb-4">
            <i class="fa-solid fa-bolt"></i>
          </div>
          <h1 class="text-2xl font-black text-white tracking-wide">SteamMaster 商业版</h1>
          <p class="text-xs text-slate-400 mt-1.5 font-medium">云端后端数据中枢 · 管理员安全登录</p>
        </div>

        <form @submit.prevent="handleLogin" class="space-y-4">
          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1.5">管理员账号 (Username)</label>
            <div class="relative">
              <span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-sm">
                <i class="fa-regular fa-user"></i>
              </span>
              <input
                v-model="loginForm.username"
                type="text"
                required
                placeholder="请输入管理员账号 (默认: admin)"
                class="glass-input w-full pl-10 pr-4 py-2.5 rounded-xl text-sm transition"
              />
            </div>
          </div>

          <div>
            <label class="block text-xs font-semibold text-slate-300 mb-1.5">安全密码 (Password)</label>
            <div class="relative">
              <span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-sm">
                <i class="fa-solid fa-lock"></i>
              </span>
              <input
                v-model="loginForm.password"
                type="password"
                required
                placeholder="请输入管理员密码 (默认: admin123)"
                class="glass-input w-full pl-10 pr-4 py-2.5 rounded-xl text-sm transition"
              />
            </div>
          </div>

          <div v-if="loginError" class="p-3 rounded-xl bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs flex items-center gap-2">
            <i class="fa-solid fa-triangle-exclamation shrink-0"></i>
            <span>{{ loginError }}</span>
          </div>

          <button
            type="submit"
            :disabled="loginLoading"
            class="w-full py-3 bg-gradient-to-r from-sky-600 via-teal-600 to-emerald-600 hover:from-sky-500 hover:to-emerald-500 text-white text-sm font-bold rounded-xl shadow-lg shadow-sky-600/25 transition duration-200 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <i v-if="loginLoading" class="fa-solid fa-spinner fa-spin"></i>
            <span>{{ loginLoading ? '正在验证凭证...' : '安全登录控制台' }}</span>
            <i v-if="!loginLoading" class="fa-solid fa-arrow-right text-xs"></i>
          </button>
        </form>

        <div class="mt-6 pt-5 border-t border-slate-800/80 text-center">
          <div class="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/90 border border-slate-800 text-[11px] text-slate-400 font-mono">
            <i class="fa-solid fa-shield-halved text-emerald-400"></i>
            <span>PBKDF2 10000轮加盐加密 & 防暴力破解保护</span>
          </div>
          <p class="text-[11px] text-slate-400 mt-2">提示：初始账号 <code class="text-sky-300 font-mono">admin</code> / 初始密码 <code class="text-sky-300 font-mono">admin123</code></p>
        </div>
      </div>
    </div>

    <!-- ==================== 2. 已登录：全功能控制台界面 ==================== -->
    <div v-else class="min-h-screen flex flex-col">
      <!-- 顶部全局导航栏 -->
      <header class="glass border-b border-slate-800/80 sticky top-0 z-40 px-6 py-3.5 flex items-center justify-between flex-wrap gap-4">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 to-emerald-400 flex items-center justify-center text-slate-950 font-black shadow-md">
            <i class="fa-solid fa-bolt"></i>
          </div>
          <div>
            <div class="flex items-center gap-2">
              <h1 class="text-base font-bold text-white tracking-wide">SteamMaster 商业版</h1>
              <span class="px-2 py-0.5 text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-full font-mono flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>云端引擎在线</span>
              </span>
            </div>
            <p class="text-[11px] text-slate-400">28.8万+ DepotKey 调度中心 · 公告与版本推送管控平台</p>
          </div>
        </div>

        <!-- 导航选项卡 -->
        <nav class="flex items-center gap-1 bg-slate-900/90 p-1 rounded-2xl border border-slate-800">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            @click="currentTab = tab.id"
            class="px-3.5 py-1.5 rounded-xl text-xs font-semibold transition flex items-center gap-2"
            :class="currentTab === tab.id ? 'bg-sky-600 text-white shadow' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'"
          >
            <i :class="tab.icon"></i>
            <span>{{ tab.label }}</span>
          </button>
        </nav>

        <!-- 管理员身份与操作 -->
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-xs font-mono">
            <i class="fa-solid fa-user-shield text-sky-400"></i>
            <span class="text-slate-200 font-bold">{{ currentAdminUser.username }}</span>
            <span class="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">超级管理员</span>
          </div>

          <button
            @click="handleLogout"
            title="退出登录"
            class="px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 text-xs font-semibold transition flex items-center gap-1.5"
          >
            <i class="fa-solid fa-right-from-bracket"></i>
            <span>退出</span>
          </button>
        </div>
      </header>

      <!-- 主体内容区域 -->
      <main class="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8 space-y-6">

        <!-- ==================== Tab 1: 📊 系统监控大盘 ==================== -->
        <section v-if="currentTab === 'overview'" class="space-y-6 animate-in fade-in duration-200">
          <!-- 核心指标卡片 -->
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div class="glass-card p-5 rounded-2xl shadow">
              <div class="flex items-center justify-between text-slate-400 text-xs">
                <span>持久化 DepotKey 总量</span>
                <i class="fa-solid fa-key text-emerald-400"></i>
              </div>
              <div class="text-2xl font-bold font-mono text-emerald-400 mt-2">{{ stats.depotKeysCount?.toLocaleString() || 0 }} <span class="text-xs text-slate-400 font-normal">条</span></div>
              <div class="text-[11px] text-slate-400 mt-1 flex items-center gap-1">
                <i class="fa-solid fa-shield-check text-emerald-500"></i>
                <span>含苏大猫与全球全量历史库</span>
              </div>
            </div>

            <div class="glass-card p-5 rounded-2xl shadow">
              <div class="flex items-center justify-between text-slate-400 text-xs">
                <span>PICS AccessToken 令牌</span>
                <i class="fa-solid fa-ticket text-sky-400"></i>
              </div>
              <div class="text-2xl font-bold font-mono text-sky-400 mt-2">{{ stats.tokensCount?.toLocaleString() || 0 }} <span class="text-xs text-slate-400 font-normal">款应用</span></div>
              <div class="text-[11px] text-slate-400 mt-1">苏大猫 993499094 实时同步</div>
            </div>

            <div class="glass-card p-5 rounded-2xl shadow">
              <div class="flex items-center justify-between text-slate-400 text-xs">
                <span>全量游戏索引数据库</span>
                <i class="fa-solid fa-gamepad text-purple-400"></i>
              </div>
              <div class="text-2xl font-bold font-mono text-purple-400 mt-2">{{ stats.gamesCount?.toLocaleString() || 0 }} <span class="text-xs text-slate-400 font-normal">款</span></div>
              <div class="text-[11px] text-slate-400 mt-1">支持毫秒级拼音/中文检索</div>
            </div>

            <div class="glass-card p-5 rounded-2xl shadow">
              <div class="flex items-center justify-between text-slate-400 text-xs">
                <span>系统运行与资源</span>
                <i class="fa-solid fa-server text-amber-400"></i>
              </div>
              <div class="text-2xl font-bold font-mono text-amber-400 mt-2">{{ formatUptime(stats.uptimeSeconds) }}</div>
              <div class="text-[11px] text-slate-400 mt-1 font-mono">内存: {{ stats.memoryUsageMb || 0 }} MB · {{ stats.nodeVersion }}</div>
            </div>
          </div>

          <!-- 快捷操作与状态汇总 -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div class="glass-card p-5 rounded-2xl md:col-span-2">
              <div class="flex items-center justify-between mb-4">
                <h2 class="text-sm font-bold text-white flex items-center gap-2">
                  <i class="fa-solid fa-bolt text-sky-400"></i>
                  <span>快捷运营与控制调度</span>
                </h2>
                <span class="text-xs text-slate-400 font-mono">24h 自动轮询引擎</span>
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  @click="triggerAllSync"
                  :disabled="syncLoading"
                  class="p-4 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 hover:border-sky-500/50 text-left transition group"
                >
                  <div class="flex items-center justify-between mb-2">
                    <span class="w-8 h-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center group-hover:scale-110 transition">
                      <i class="fa-solid fa-rotate" :class="{ 'fa-spin': syncLoading }"></i>
                    </span>
                    <span class="text-[10px] text-sky-400 font-mono font-bold">立即执行</span>
                  </div>
                  <div class="text-xs font-bold text-white">触发多源聚合同步</div>
                  <div class="text-[11px] text-slate-400 mt-1">拉取苏大猫/ManifestHub/Token</div>
                </button>

                <button
                  @click="openCreateNoticeModal"
                  class="p-4 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 hover:border-emerald-500/50 text-left transition group"
                >
                  <div class="flex items-center justify-between mb-2">
                    <span class="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center group-hover:scale-110 transition">
                      <i class="fa-solid fa-bullhorn"></i>
                    </span>
                    <span class="text-[10px] text-emerald-400 font-mono font-bold">新建</span>
                  </div>
                  <div class="text-xs font-bold text-white">发布系统全网公告</div>
                  <div class="text-[11px] text-slate-400 mt-1">支持弹窗、横幅与版本定向</div>
                </button>

                <button
                  @click="openPublishVersionModal"
                  class="p-4 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 border border-slate-700 hover:border-purple-500/50 text-left transition group"
                >
                  <div class="flex items-center justify-between mb-2">
                    <span class="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center group-hover:scale-110 transition">
                      <i class="fa-solid fa-rocket"></i>
                    </span>
                    <span class="text-[10px] text-purple-400 font-mono font-bold">发版</span>
                  </div>
                  <div class="text-xs font-bold text-white">发布新版本 & 强更</div>
                  <div class="text-[11px] text-slate-400 mt-1">下发更新日志与一键推送</div>
                </button>
              </div>
            </div>

            <!-- 运营指标 -->
            <div class="glass-card p-5 rounded-2xl flex flex-col justify-between">
              <div>
                <h3 class="text-sm font-bold text-white mb-3 flex items-center gap-2">
                  <i class="fa-solid fa-chart-pie text-emerald-400"></i>
                  <span>公告与版本概况</span>
                </h3>
                <div class="space-y-3 text-xs">
                  <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
                    <span class="text-slate-400">当前启用中公告</span>
                    <span class="text-emerald-400 font-bold font-mono">{{ stats.activeNoticesCount || 0 }} 条</span>
                  </div>
                  <div class="flex items-center justify-between p-2.5 rounded-xl bg-slate-950/60 border border-slate-800">
                    <span class="text-slate-400">已发布历史版本</span>
                    <span class="text-sky-400 font-bold font-mono">{{ stats.versionsCount || 0 }} 个</span>
                  </div>
                </div>
              </div>
              <div class="text-[11px] text-slate-400 pt-3 border-t border-slate-800/80 mt-3 font-mono">
                服务端监听: {{ serverConfig.host }}:{{ serverConfig.port }}
              </div>
            </div>
          </div>
        </section>

        <!-- ==================== Tab 2: 📢 公告广播管理中心 ==================== -->
        <section v-if="currentTab === 'notices'" class="space-y-4 animate-in fade-in duration-200">
          <div class="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 class="text-base font-bold text-white flex items-center gap-2">
                <i class="fa-solid fa-bullhorn text-emerald-400"></i>
                <span>公告发布与调度管理</span>
              </h2>
              <p class="text-xs text-slate-400 mt-0.5">支持配置弹窗公告、顶部横幅、按客户端版本定向投放与弹窗频次策略</p>
            </div>

            <div class="flex items-center gap-2">
              <button
                @click="fetchNotices"
                class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl border border-slate-700 transition"
              >
                <i class="fa-solid fa-rotate-right mr-1"></i> 刷新
              </button>
              <button
                @click="openCreateNoticeModal"
                class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-600/20 transition flex items-center gap-1.5"
              >
                <i class="fa-solid fa-plus"></i>
                <span>发布新公告</span>
              </button>
            </div>
          </div>

          <!-- 公告列表表格 -->
          <div class="glass-card rounded-2xl overflow-hidden border border-slate-800">
            <div class="overflow-x-auto custom-scrollbar">
              <table class="w-full text-left text-xs">
                <thead class="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold">
                  <tr>
                    <th class="p-3.5">状态</th>
                    <th class="p-3.5">标题</th>
                    <th class="p-3.5">展示类型</th>
                    <th class="p-3.5">级别</th>
                    <th class="p-3.5">优先级</th>
                    <th class="p-3.5">目标版本</th>
                    <th class="p-3.5">更新时间</th>
                    <th class="p-3.5 text-right">操作</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-800/60">
                  <tr v-for="notice in notices" :key="notice.id" class="hover:bg-slate-800/30 transition">
                    <td class="p-3.5">
                      <button
                        @click="toggleNotice(notice)"
                        class="px-2 py-0.5 rounded-full text-[10px] font-bold font-mono transition"
                        :class="notice.enabled ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400 border border-slate-700'"
                      >
                        {{ notice.enabled ? '● 启用中' : '○ 已停用' }}
                      </button>
                    </td>
                    <td class="p-3.5 font-bold text-white max-w-xs truncate">
                      {{ notice.title }}
                    </td>
                    <td class="p-3.5 font-mono">
                      <span v-if="notice.type === 'popup'" class="px-2 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[10px]">弹窗 Modal</span>
                      <span v-else-if="notice.type === 'banner'" class="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px]">横幅 Banner</span>
                      <span v-else class="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px]">通知 Toast</span>
                    </td>
                    <td class="p-3.5">
                      <span class="px-2 py-0.5 rounded text-[10px] uppercase font-bold"
                        :class="{
                          'bg-emerald-500/10 text-emerald-400': notice.level === 'success',
                          'bg-amber-500/10 text-amber-400': notice.level === 'warning',
                          'bg-rose-500/10 text-rose-400': notice.level === 'danger',
                          'bg-sky-500/10 text-sky-400': !notice.level || notice.level === 'info'
                        }"
                      >
                        {{ notice.level || 'info' }}
                      </span>
                    </td>
                    <td class="p-3.5 font-mono font-bold text-slate-300">{{ notice.priority || 0 }}</td>
                    <td class="p-3.5 font-mono text-slate-400">{{ notice.targetVersion || '*' }}</td>
                    <td class="p-3.5 text-slate-400 font-mono text-[11px]">{{ formatDateTime(notice.updatedAt) }}</td>
                    <td class="p-3.5 text-right space-x-2">
                      <button @click="previewNotice(notice)" class="p-1.5 hover:bg-slate-700 text-sky-400 rounded transition" title="客户端效果预览">
                        <i class="fa-regular fa-eye"></i>
                      </button>
                      <button @click="editNotice(notice)" class="p-1.5 hover:bg-slate-700 text-amber-400 rounded transition" title="编辑">
                        <i class="fa-regular fa-pen-to-square"></i>
                      </button>
                      <button @click="deleteNotice(notice.id)" class="p-1.5 hover:bg-slate-700 text-rose-400 rounded transition" title="删除">
                        <i class="fa-regular fa-trash-can"></i>
                      </button>
                    </td>
                  </tr>
                  <tr v-if="notices.length === 0">
                    <td colspan="8" class="p-8 text-center text-slate-400">暂无公告，点击右上角发布新公告</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- ==================== Tab 3: 🚀 版本发布与推送更新 ==================== -->
        <section v-if="currentTab === 'versions'" class="space-y-6 animate-in fade-in duration-200">
          <div class="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 class="text-base font-bold text-white flex items-center gap-2">
                <i class="fa-solid fa-rocket text-purple-400"></i>
                <span>版本发布与更新推送中心</span>
              </h2>
              <p class="text-xs text-slate-400 mt-0.5">管控客户端升级规则、多行更新日志、强制更新标记与全网推送通知广播</p>
            </div>

            <div class="flex items-center gap-2">
              <button
                @click="openPushBroadcastModal"
                class="px-4 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white text-xs font-bold rounded-xl shadow transition flex items-center gap-1.5"
              >
                <i class="fa-solid fa-satellite-dish"></i>
                <span>发起全网更新推送</span>
              </button>
              <button
                @click="openPublishVersionModal"
                class="px-4 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-sky-600/20 transition flex items-center gap-1.5"
              >
                <i class="fa-solid fa-plus"></i>
                <span>发布新版本</span>
              </button>
            </div>
          </div>

          <!-- 当前生效版本卡片 -->
          <div v-if="latestVersion" class="glass-card p-6 rounded-2xl border-l-4 border-l-sky-500">
            <div class="flex items-start justify-between flex-wrap gap-3">
              <div>
                <div class="flex items-center gap-2.5">
                  <span class="text-lg font-black text-white">当前分发最新版本: v{{ latestVersion.version }}</span>
                  <span class="px-2 py-0.5 text-xs font-bold rounded bg-sky-500/20 text-sky-300 font-mono">{{ latestVersion.channel || 'stable' }}</span>
                  <span v-if="latestVersion.forceUpdate" class="px-2 py-0.5 text-xs font-bold rounded bg-rose-500/20 text-rose-300">强制更新已开启</span>
                </div>
                <div class="text-xs text-slate-300 mt-1 font-semibold">{{ latestVersion.title }} · 发布日期: {{ latestVersion.releaseDate }}</div>
              </div>
              <div class="text-xs text-slate-400 font-mono">最低兼容版本: v{{ latestVersion.minSupportedVersion || '1.0.0' }}</div>
            </div>

            <div class="mt-4 pt-4 border-t border-slate-800 text-xs">
              <div class="text-slate-400 font-bold mb-2">更新日志 (Changelog):</div>
              <ul class="space-y-1 bg-slate-950/60 p-3 rounded-xl border border-slate-800">
                <li v-for="(log, idx) in latestVersion.changelog" :key="idx" class="text-slate-300 flex items-start gap-2">
                  <span class="text-sky-400 font-bold">•</span>
                  <span>{{ log }}</span>
                </li>
              </ul>
            </div>
          </div>

          <!-- 版本历史列表 -->
          <div class="glass-card rounded-2xl overflow-hidden border border-slate-800">
            <div class="p-4 border-b border-slate-800 text-xs font-bold text-white flex items-center justify-between">
              <span>全量版本发布历史记录</span>
              <span class="text-slate-400 font-mono">共 {{ versions.length }} 个版本</span>
            </div>
            <div class="overflow-x-auto custom-scrollbar">
              <table class="w-full text-left text-xs">
                <thead class="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold">
                  <tr>
                    <th class="p-3.5">版本号</th>
                    <th class="p-3.5">通道</th>
                    <th class="p-3.5">发布日期</th>
                    <th class="p-3.5">更新标题</th>
                    <th class="p-3.5">强更</th>
                    <th class="p-3.5">文件大小</th>
                    <th class="p-3.5">状态</th>
                    <th class="p-3.5 text-right">操作</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-800/60">
                  <tr v-for="ver in versions" :key="ver.version" class="hover:bg-slate-800/30 transition">
                    <td class="p-3.5 font-bold font-mono text-white">v{{ ver.version }}</td>
                    <td class="p-3.5 font-mono text-slate-300">{{ ver.channel || 'stable' }}</td>
                    <td class="p-3.5 font-mono text-slate-400">{{ ver.releaseDate }}</td>
                    <td class="p-3.5 text-slate-200 max-w-xs truncate">{{ ver.title }}</td>
                    <td class="p-3.5">
                      <span v-if="ver.forceUpdate" class="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 font-bold text-[10px]">强更</span>
                      <span v-else class="text-slate-500 text-[10px]">普通</span>
                    </td>
                    <td class="p-3.5 font-mono text-slate-400">{{ ver.fileSize || '-' }}</td>
                    <td class="p-3.5">
                      <button
                        @click="toggleVersion(ver)"
                        class="px-2 py-0.5 rounded text-[10px] font-bold font-mono"
                        :class="ver.enabled !== false ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'"
                      >
                        {{ ver.enabled !== false ? '上架' : '下架' }}
                      </button>
                    </td>
                    <td class="p-3.5 text-right space-x-2">
                      <button @click="editVersion(ver)" class="p-1.5 hover:bg-slate-700 text-amber-400 rounded transition" title="编辑">
                        <i class="fa-regular fa-pen-to-square"></i>
                      </button>
                      <button @click="deleteVersion(ver.version)" class="p-1.5 hover:bg-slate-700 text-rose-400 rounded transition" title="删除">
                        <i class="fa-regular fa-trash-can"></i>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- ==================== Tab 4: 🔑 密钥与令牌检索库 ==================== -->
        <section v-if="currentTab === 'keys'" class="space-y-6 animate-in fade-in duration-200">
          <div>
            <h2 class="text-base font-bold text-white flex items-center gap-2">
              <i class="fa-solid fa-key text-emerald-400"></i>
              <span>DepotKey 密钥与 AccessToken 调试检索器</span>
            </h2>
            <p class="text-xs text-slate-400 mt-0.5">在 28.8万+ DepotKey 密钥库与 8000+ PICS Token 库中秒级检索指定游戏或分包解密密钥</p>
          </div>

          <!-- 搜索栏 -->
          <div class="glass-card p-5 rounded-2xl">
            <form @submit.prevent="handleSearchKey" class="flex items-center gap-3">
              <div class="relative flex-1">
                <span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 text-sm">
                  <i class="fa-solid fa-magnifying-glass"></i>
                </span>
                <input
                  v-model="keySearchQuery"
                  type="text"
                  placeholder="输入 AppID 或 DepotID (例如: 1091500 赛博朋克2077, 271590 GTA5, 1245620 艾尔登法环)"
                  class="glass-input w-full pl-10 pr-4 py-3 rounded-xl text-sm"
                />
              </div>
              <button
                type="submit"
                :disabled="keySearchLoading"
                class="px-6 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-sm rounded-xl transition shadow flex items-center gap-2 shrink-0"
              >
                <i v-if="keySearchLoading" class="fa-solid fa-spinner fa-spin"></i>
                <span>{{ keySearchLoading ? '正在匹配...' : '立即查询' }}</span>
              </button>
            </form>

            <!-- 检索结果展现 -->
            <div v-if="keySearchResult" class="mt-5 pt-5 border-t border-slate-800 space-y-4">
              <!-- 游戏信息 -->
              <div v-if="keySearchResult.game" class="p-4 rounded-xl bg-slate-950/80 border border-slate-800 flex items-start gap-4">
                <img v-if="keySearchResult.game.headerUrl" :src="keySearchResult.game.headerUrl" class="w-36 rounded-lg object-cover shadow border border-slate-800" />
                <div class="flex-1 min-w-0 text-xs">
                  <div class="flex items-center gap-2">
                    <span class="font-bold text-white text-sm">{{ keySearchResult.game.nameZh || keySearchResult.game.name }}</span>
                    <span class="font-mono text-slate-400">AppID: {{ keySearchResult.game.appId }}</span>
                  </div>
                  <p class="text-slate-400 mt-1 truncate">{{ keySearchResult.game.name }}</p>
                  <div class="mt-2 text-slate-400">包含分包 Depot 数量: <span class="text-emerald-400 font-mono font-bold">{{ Object.keys(keySearchResult.game.depots || {}).length }}</span> 个</div>
                </div>
              </div>

              <!-- 密钥与 Token 卡片 -->
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div class="p-4 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div class="text-slate-400 font-medium mb-1.5 flex items-center justify-between">
                    <span>AES-256 DepotKey 密钥</span>
                    <i class="fa-solid fa-key text-emerald-400"></i>
                  </div>
                  <div v-if="keySearchResult.depotKey" class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-emerald-400 break-all select-all">
                    {{ keySearchResult.depotKey }}
                  </div>
                  <div v-else class="text-slate-500 py-2">未命中专属分包 DepotKey</div>
                </div>

                <div class="p-4 rounded-xl bg-slate-950/80 border border-slate-800">
                  <div class="text-slate-400 font-medium mb-1.5 flex items-center justify-between">
                    <span>PICS AccessToken 令牌</span>
                    <i class="fa-solid fa-ticket text-sky-400"></i>
                  </div>
                  <div v-if="keySearchResult.token" class="p-2.5 rounded-lg bg-slate-900 border border-slate-800 font-mono text-sky-400 break-all select-all">
                    {{ keySearchResult.token }}
                  </div>
                  <div v-else class="text-slate-500 py-2">无保护令牌需求 (公开清单)</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- ==================== Tab 5: 🌐 多源调度与爬虫中心 ==================== -->
        <section v-if="currentTab === 'sources'" class="space-y-6 animate-in fade-in duration-200">
          <div class="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 class="text-base font-bold text-white flex items-center gap-2">
                <i class="fa-solid fa-globe text-sky-400"></i>
                <span>多源数据管道与爬虫调度中心</span>
              </h2>
              <p class="text-xs text-slate-400 mt-0.5">汇聚全网优质上游仓库与社区分发源，支持全自动定时汇聚与单源按需调度</p>
            </div>

            <button
              @click="triggerAllSync"
              :disabled="syncLoading"
              class="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-xl shadow-lg transition flex items-center gap-2"
            >
              <i class="fa-solid fa-rotate" :class="{ 'fa-spin': syncLoading }"></i>
              <span>{{ syncLoading ? '正在同步数据源...' : '立即触发全量多源聚合同步' }}</span>
            </button>
          </div>

          <!-- 数据源列表 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div v-for="s in sources" :key="s.id" class="glass-card p-5 rounded-2xl space-y-3">
              <div class="flex items-start justify-between gap-2">
                <div>
                  <h3 class="text-sm font-bold text-white">{{ s.name }}</h3>
                  <div class="text-[11px] text-slate-400 mt-0.5">来源: {{ s.author }}</div>
                </div>
                <span class="px-2 py-0.5 text-[10px] font-bold rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  {{ s.status }}
                </span>
              </div>

              <p class="text-xs text-slate-300 leading-relaxed">{{ s.description }}</p>

              <div class="text-[11px] font-mono text-slate-400 pt-2 border-t border-slate-800 space-y-1">
                <div>主页: <a :href="s.sourceUrl" target="_blank" class="text-sky-400 hover:underline truncate">{{ s.sourceUrl }}</a></div>
                <div>频率: <span class="text-slate-200">{{ s.syncFrequency }}</span></div>
              </div>
            </div>
          </div>
        </section>

        <!-- ==================== Tab 6: ⚙️ 安全配置与审计日志 ==================== -->
        <section v-if="currentTab === 'security'" class="space-y-6 animate-in fade-in duration-200">
          <div>
            <h2 class="text-base font-bold text-white flex items-center gap-2">
              <i class="fa-solid fa-shield-halved text-emerald-400"></i>
              <span>安全配置与管理员凭证管理</span>
            </h2>
            <p class="text-xs text-slate-400 mt-0.5">修改管理员登录账号、重置密码及查看系统敏感操作审计日志</p>
          </div>

          <!-- 修改密码表单 -->
          <div class="glass-card p-6 rounded-2xl max-w-2xl">
            <h3 class="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <i class="fa-solid fa-key text-amber-400"></i>
              <span>修改管理员账号与密码</span>
            </h3>

            <form @submit.prevent="handleChangePassword" class="space-y-4 text-xs">
              <div>
                <label class="block text-slate-300 font-semibold mb-1">当前原密码 (Current Password)</label>
                <input
                  v-model="pwdForm.currentPassword"
                  type="password"
                  required
                  placeholder="请输入当前生效的管理员原密码"
                  class="glass-input w-full p-2.5 rounded-xl"
                />
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-slate-300 font-semibold mb-1">新管理员用户名 (Username)</label>
                  <input
                    v-model="pwdForm.newUsername"
                    type="text"
                    placeholder="留空则保持当前用户名"
                    class="glass-input w-full p-2.5 rounded-xl"
                  />
                </div>
                <div>
                  <label class="block text-slate-300 font-semibold mb-1">新安全密码 (New Password)</label>
                  <input
                    v-model="pwdForm.newPassword"
                    type="password"
                    required
                    minlength="6"
                    placeholder="至少 6 位安全字符"
                    class="glass-input w-full p-2.5 rounded-xl"
                  />
                </div>
              </div>

              <div v-if="pwdMsg" :class="pwdMsg.success ? 'text-emerald-400 bg-emerald-950/40 border-emerald-800' : 'text-rose-400 bg-rose-950/40 border-rose-800'" class="p-3 rounded-xl border text-xs">
                {{ pwdMsg.text }}
              </div>

              <button
                type="submit"
                :disabled="pwdLoading"
                class="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-xl transition shadow flex items-center gap-2"
              >
                <i v-if="pwdLoading" class="fa-solid fa-spinner fa-spin"></i>
                <span>{{ pwdLoading ? '正在加密保存...' : '确认更新管理员凭证' }}</span>
              </button>
            </form>
          </div>

          <!-- 安全审计日志 -->
          <div class="glass-card rounded-2xl overflow-hidden border border-slate-800">
            <div class="p-4 border-b border-slate-800 flex items-center justify-between text-xs font-bold text-white">
              <span>敏感操作与登录审计日志 (最近 50 条)</span>
              <button @click="fetchAuditLogs" class="text-sky-400 hover:underline">
                <i class="fa-solid fa-rotate-right mr-1"></i> 刷新日志
              </button>
            </div>
            <div class="overflow-x-auto custom-scrollbar max-h-96">
              <table class="w-full text-left text-xs">
                <thead class="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold sticky top-0">
                  <tr>
                    <th class="p-3">时间</th>
                    <th class="p-3">操作类型</th>
                    <th class="p-3">操作者</th>
                    <th class="p-3">IP 地址</th>
                    <th class="p-3">详情说明</th>
                    <th class="p-3">结果</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-slate-800/60 font-mono">
                  <tr v-for="log in auditLogs" :key="log.id" class="hover:bg-slate-800/30 transition text-[11px]">
                    <td class="p-3 text-slate-400">{{ formatDateTime(log.timestamp) }}</td>
                    <td class="p-3 font-bold text-slate-200">{{ log.action }}</td>
                    <td class="p-3 text-sky-400">{{ log.operator }}</td>
                    <td class="p-3 text-slate-400">{{ log.ip }}</td>
                    <td class="p-3 text-slate-300 font-sans">{{ log.details }}</td>
                    <td class="p-3">
                      <span :class="log.success ? 'text-emerald-400' : 'text-rose-400'">
                        {{ log.success ? '成功' : '失败' }}
                      </span>
                    </td>
                  </tr>
                  <tr v-if="auditLogs.length === 0">
                    <td colspan="6" class="p-6 text-center text-slate-500 font-sans">暂无审计日志</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </section>

      </main>

      <!-- ==================== 模态框 1: 发布/编辑公告 ==================== -->
      <div v-if="noticeModal.show" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
        <div class="glass-card rounded-3xl w-full max-w-2xl p-6 shadow-2xl border border-slate-700 max-h-[90vh] overflow-y-auto custom-scrollbar">
          <div class="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
            <h3 class="text-base font-bold text-white flex items-center gap-2">
              <i class="fa-solid fa-bullhorn text-emerald-400"></i>
              <span>{{ noticeModal.isEdit ? '编辑公告' : '发布新系统公告' }}</span>
            </h3>
            <button @click="noticeModal.show = false" class="text-slate-400 hover:text-white p-1">
              <i class="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form @submit.prevent="saveNotice" class="space-y-4 text-xs">
            <div>
              <label class="block text-slate-300 font-semibold mb-1">公告标题 (Title)</label>
              <input v-model="noticeModal.form.title" type="text" required placeholder="例如: 🎉 SteamMaster v1.0.1 正式更新上线！" class="glass-input w-full p-2.5 rounded-xl" />
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label class="block text-slate-300 font-semibold mb-1">展示形式 (Type)</label>
                <select v-model="noticeModal.form.type" class="glass-input w-full p-2.5 rounded-xl">
                  <option value="popup">弹窗公告 (Popup Modal)</option>
                  <option value="banner">顶部横幅 (Top Banner)</option>
                  <option value="notification">右下角通知 (Toast)</option>
                </select>
              </div>
              <div>
                <label class="block text-slate-300 font-semibold mb-1">提示级别 (Level)</label>
                <select v-model="noticeModal.form.level" class="glass-input w-full p-2.5 rounded-xl">
                  <option value="info">信息 (Info)</option>
                  <option value="success">成功 (Success)</option>
                  <option value="warning">提醒 (Warning)</option>
                  <option value="danger">紧急 (Danger)</option>
                </select>
              </div>
              <div>
                <label class="block text-slate-300 font-semibold mb-1">显示优先级 (越大越置顶)</label>
                <input v-model.number="noticeModal.form.priority" type="number" class="glass-input w-full p-2.5 rounded-xl font-mono" />
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-slate-300 font-semibold mb-1">目标版本限制 (Target Version, * 为全量)</label>
                <input v-model="noticeModal.form.targetVersion" type="text" placeholder="* 或 >=1.0.0" class="glass-input w-full p-2.5 rounded-xl font-mono" />
              </div>
              <div class="flex items-center gap-4 pt-5">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" v-model="noticeModal.form.popupOnce" class="rounded border-slate-700 bg-slate-900 text-sky-500" />
                  <span class="text-slate-300">仅弹窗提醒一次</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" v-model="noticeModal.form.enabled" class="rounded border-slate-700 bg-slate-900 text-emerald-500" />
                  <span class="text-slate-300">立即启用生效</span>
                </label>
              </div>
            </div>

            <div>
              <label class="block text-slate-300 font-semibold mb-1">跳转链接 (可选)</label>
              <input v-model="noticeModal.form.link" type="text" placeholder="https://..." class="glass-input w-full p-2.5 rounded-xl font-mono" />
            </div>

            <div>
              <label class="block text-slate-300 font-semibold mb-1">公告正文内容 (Content, 支持换行排版)</label>
              <textarea v-model="noticeModal.form.content" rows="5" required placeholder="请输入公告详细内容..." class="glass-input w-full p-2.5 rounded-xl"></textarea>
            </div>

            <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button type="button" @click="noticeModal.show = false" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition">
                取消
              </button>
              <button type="submit" class="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl transition shadow">
                保存并即时下发
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- ==================== 模态框 2: 发布新版本 ==================== -->
      <div v-if="versionModal.show" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
        <div class="glass-card rounded-3xl w-full max-w-2xl p-6 shadow-2xl border border-slate-700 max-h-[90vh] overflow-y-auto custom-scrollbar">
          <div class="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
            <h3 class="text-base font-bold text-white flex items-center gap-2">
              <i class="fa-solid fa-rocket text-purple-400"></i>
              <span>{{ versionModal.isEdit ? '编辑版本信息' : '发布新版本与升级规则' }}</span>
            </h3>
            <button @click="versionModal.show = false" class="text-slate-400 hover:text-white p-1">
              <i class="fa-solid fa-xmark text-lg"></i>
            </button>
          </div>

          <form @submit.prevent="saveVersion" class="space-y-4 text-xs">
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label class="block text-slate-300 font-semibold mb-1">版本号 (如 1.0.1)</label>
                <input v-model="versionModal.form.version" type="text" required placeholder="1.0.1" class="glass-input w-full p-2.5 rounded-xl font-mono" />
              </div>
              <div>
                <label class="block text-slate-300 font-semibold mb-1">发布通道</label>
                <select v-model="versionModal.form.channel" class="glass-input w-full p-2.5 rounded-xl">
                  <option value="stable">正式版 (Stable)</option>
                  <option value="beta">测试版 (Beta)</option>
                </select>
              </div>
              <div>
                <label class="block text-slate-300 font-semibold mb-1">发布日期</label>
                <input v-model="versionModal.form.releaseDate" type="date" required class="glass-input w-full p-2.5 rounded-xl font-mono" />
              </div>
            </div>

            <div>
              <label class="block text-slate-300 font-semibold mb-1">版本标题 (Release Title)</label>
              <input v-model="versionModal.form.title" type="text" required placeholder="SteamMaster 商业版 v1.0.1 体验升级" class="glass-input w-full p-2.5 rounded-xl" />
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label class="block text-slate-300 font-semibold mb-1">官方下载地址 (Gitee/GitHub/CDN)</label>
                <input v-model="versionModal.form.downloadUrl" type="text" required placeholder="https://gitee.com/muyan6/steam/releases" class="glass-input w-full p-2.5 rounded-xl font-mono" />
              </div>
              <div>
                <label class="block text-slate-300 font-semibold mb-1">备用镜像下载地址</label>
                <input v-model="versionModal.form.downloadUrlBackup" type="text" placeholder="https://..." class="glass-input w-full p-2.5 rounded-xl font-mono" />
              </div>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label class="block text-slate-300 font-semibold mb-1">最低兼容支持版本</label>
                <input v-model="versionModal.form.minSupportedVersion" type="text" placeholder="1.0.0" class="glass-input w-full p-2.5 rounded-xl font-mono" />
              </div>
              <div>
                <label class="block text-slate-300 font-semibold mb-1">安装包大小 (如 48.5 MB)</label>
                <input v-model="versionModal.form.fileSize" type="text" placeholder="48.5 MB" class="glass-input w-full p-2.5 rounded-xl font-mono" />
              </div>
              <div class="flex items-center pt-5">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" v-model="versionModal.form.forceUpdate" class="rounded border-slate-700 bg-slate-900 text-rose-500" />
                  <span class="text-rose-400 font-bold">强制全量更新</span>
                </label>
              </div>
            </div>

            <div>
              <label class="block text-slate-300 font-semibold mb-1">更新日志 (Changelog, 每行一条)</label>
              <textarea v-model="versionModal.rawChangelog" rows="4" required placeholder="🚀 优化游戏秒搜与入库引擎&#10;☁️ 新增多源数据自动轮询&#10;💉 修复 Goldberg 联机配置问题" class="glass-input w-full p-2.5 rounded-xl"></textarea>
            </div>

            <div class="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
              <button type="button" @click="versionModal.show = false" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition">
                取消
              </button>
              <button type="submit" class="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition shadow">
                发布此版本
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- ==================== 模态框 3: 全网更新推送广播 ==================== -->
      <div v-if="pushModal.show" class="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
        <div class="glass-card rounded-3xl w-full max-w-md p-6 shadow-2xl border border-slate-700">
          <div class="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
            <h3 class="text-base font-bold text-white flex items-center gap-2">
              <i class="fa-solid fa-satellite-dish text-indigo-400"></i>
              <span>发起全网版本更新推送</span>
            </h3>
            <button @click="pushModal.show = false" class="text-slate-400 hover:text-white p-1">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>

          <form @submit.prevent="executePushBroadcast" class="space-y-4 text-xs">
            <div>
              <label class="block text-slate-300 font-semibold mb-1">目标推送版本</label>
              <select v-model="pushModal.version" class="glass-input w-full p-2.5 rounded-xl font-mono">
                <option v-for="v in versions" :key="v.version" :value="v.version">v{{ v.version }} - {{ v.title }}</option>
              </select>
            </div>

            <div>
              <label class="block text-slate-300 font-semibold mb-1">广播标题</label>
              <input v-model="pushModal.title" type="text" placeholder="🚀 SteamMaster 发现重要新版本！" class="glass-input w-full p-2.5 rounded-xl" />
            </div>

            <div>
              <label class="block text-slate-300 font-semibold mb-1">广播内容摘要</label>
              <textarea v-model="pushModal.content" rows="3" placeholder="全新版本现已发布，建议立即升级体验最新功能！" class="glass-input w-full p-2.5 rounded-xl"></textarea>
            </div>

            <div class="p-3 rounded-xl bg-indigo-950/40 border border-indigo-800 text-indigo-300 text-[11px] leading-relaxed">
              💡 发起后，所有在线客户端将在下一次轮询或启动时自动接收到弹窗/横幅升级提示。
            </div>

            <div class="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
              <button type="button" @click="pushModal.show = false" class="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition">
                取消
              </button>
              <button type="submit" class="px-5 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold rounded-xl transition shadow">
                立即广播推送
              </button>
            </div>
          </form>
        </div>
      </div>

      <!-- ==================== 模态框 4: 客户端公告弹窗预览 ==================== -->
      <div v-if="previewModal.show" class="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center p-4">
        <div class="glass-card rounded-3xl w-full max-w-md p-6 shadow-2xl border border-sky-500/30 animate-in zoom-in-95 duration-200">
          <div class="flex items-center gap-3.5 mb-4">
            <div class="w-10 h-10 rounded-2xl bg-sky-500/10 text-sky-400 flex items-center justify-center border border-sky-500/20 text-lg">
              <i class="fa-solid fa-bell"></i>
            </div>
            <div>
              <h3 class="font-bold text-sm text-slate-100">{{ previewModal.data?.title }}</h3>
              <p class="text-[11px] text-slate-400">客户端实际弹窗效果预览</p>
            </div>
          </div>

          <div class="text-xs text-slate-300 leading-relaxed whitespace-pre-line mb-6 bg-slate-950/80 p-4 rounded-2xl border border-white/5">
            {{ previewModal.data?.content }}
          </div>

          <div class="flex items-center justify-end gap-3">
            <button @click="previewModal.show = false" class="px-5 py-2 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-xl shadow">
              关闭预览
            </button>
          </div>
        </div>
      </div>

    </div>
  </div>

  <script>
    const { createApp, ref, reactive, onMounted } = Vue;

    createApp({
      setup() {
        const token = ref(localStorage.getItem('steammaster_admin_token') || '');
        const isAuthenticated = ref(Boolean(token.value));
        const currentAdminUser = reactive({ username: 'admin', role: 'superadmin' });

        const currentTab = ref('overview');
        const tabs = [
          { id: 'overview', label: '系统监控大盘', icon: 'fa-solid fa-chart-line' },
          { id: 'notices', label: '公告中心', icon: 'fa-solid fa-bullhorn' },
          { id: 'versions', label: '版本与推送', icon: 'fa-solid fa-rocket' },
          { id: 'keys', label: '密钥与令牌检索', icon: 'fa-solid fa-key' },
          { id: 'sources', label: '数据源与爬虫', icon: 'fa-solid fa-globe' },
          { id: 'security', label: '安全配置与审计', icon: 'fa-solid fa-shield-halved' }
        ];

        // 登录表单
        const loginForm = reactive({ username: 'admin', password: '' });
        const loginLoading = ref(false);
        const loginError = ref('');

        // 统计与配置
        const stats = ref({});
        const serverConfig = reactive({ port: ${CONFIG.PORT}, host: '${CONFIG.HOST}' });
        const syncLoading = ref(false);

        // 公告
        const notices = ref([]);
        const noticeModal = reactive({
          show: false,
          isEdit: false,
          form: { id: '', title: '', content: '', type: 'popup', level: 'info', priority: 10, targetVersion: '*', popupOnce: false, enabled: true, link: '' }
        });
        const previewModal = reactive({ show: false, data: null });

        // 版本
        const versions = ref([]);
        const latestVersion = ref(null);
        const versionModal = reactive({
          show: false,
          isEdit: false,
          rawChangelog: '',
          form: { version: '', channel: 'stable', releaseDate: '', title: '', downloadUrl: '', downloadUrlBackup: '', minSupportedVersion: '1.0.0', fileSize: '', forceUpdate: false }
        });
        const pushModal = reactive({ show: false, version: '', title: '', content: '' });

        // 密钥查询
        const keySearchQuery = ref('');
        const keySearchLoading = ref(false);
        const keySearchResult = ref(null);

        // 数据源
        const sources = ref([]);

        // 改密与审计
        const pwdForm = reactive({ currentPassword: '', newUsername: '', newPassword: '' });
        const pwdLoading = ref(false);
        const pwdMsg = ref(null);
        const auditLogs = ref([]);

        const getAuthHeaders = () => ({
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token.value
        });

        // 登录
        const handleLogin = async () => {
          loginLoading.value = true;
          loginError.value = '';
          try {
            const resp = await fetch('/api/auth/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(loginForm)
            });
            const data = await resp.json();
            if (data && data.success && data.token) {
              token.value = data.token;
              localStorage.setItem('steammaster_admin_token', data.token);
              isAuthenticated.value = true;
              currentAdminUser.username = data.user?.username || loginForm.username;
              initDashboard();
            } else {
              loginError.value = data.message || '登录失败，请检查账号密码';
            }
          } catch (e) {
            loginError.value = '请求服务器异常: ' + e.message;
          } finally {
            loginLoading.value = false;
          }
        };

        // 退出登录
        const handleLogout = async () => {
          try {
            await fetch('/api/auth/logout', { method: 'POST', headers: getAuthHeaders() });
          } catch {}
          token.value = '';
          localStorage.removeItem('steammaster_admin_token');
          isAuthenticated.value = false;
        };

        // 获取概况与大盘
        const fetchStats = async () => {
          try {
            const resp = await fetch('/api/admin/stats', { headers: getAuthHeaders() });
            const data = await resp.json();
            if (data && data.success) {
              stats.value = data.data;
            } else if (resp.status === 401) {
              handleLogout();
            }
          } catch {}
        };

        // 获取公告列表
        const fetchNotices = async () => {
          try {
            const resp = await fetch('/api/admin/notices', { headers: getAuthHeaders() });
            const data = await resp.json();
            if (data && data.success) notices.value = data.data;
          } catch {}
        };

        // 开启创建公告弹窗
        const openCreateNoticeModal = () => {
          noticeModal.isEdit = false;
          noticeModal.form = { id: '', title: '', content: '', type: 'popup', level: 'info', priority: 50, targetVersion: '*', popupOnce: false, enabled: true, link: '' };
          noticeModal.show = true;
        };

        // 编辑公告
        const editNotice = (notice) => {
          noticeModal.isEdit = true;
          noticeModal.form = { ...notice };
          noticeModal.show = true;
        };

        // 保存公告
        const saveNotice = async () => {
          try {
            const isEdit = noticeModal.isEdit;
            const url = isEdit ? '/api/admin/notices/' + noticeModal.form.id : '/api/admin/notices';
            const method = isEdit ? 'PUT' : 'POST';

            const resp = await fetch(url, {
              method,
              headers: getAuthHeaders(),
              body: JSON.stringify(noticeModal.form)
            });
            const data = await resp.json();
            if (data && data.success) {
              noticeModal.show = false;
              fetchNotices();
              fetchStats();
            } else {
              alert('操作失败: ' + (data.message || '未知错误'));
            }
          } catch (e) {
            alert('请求异常: ' + e.message);
          }
        };

        // 启停公告
        const toggleNotice = async (notice) => {
          try {
            const resp = await fetch('/api/admin/notices/' + notice.id + '/toggle', {
              method: 'PATCH',
              headers: getAuthHeaders(),
              body: JSON.stringify({ enabled: !notice.enabled })
            });
            const data = await resp.json();
            if (data && data.success) {
              notice.enabled = data.data.enabled;
              fetchStats();
            }
          } catch {}
        };

        // 删除公告
        const deleteNotice = async (id) => {
          if (!confirm('确认删除此条公告吗？')) return;
          try {
            const resp = await fetch('/api/admin/notices/' + id, { method: 'DELETE', headers: getAuthHeaders() });
            const data = await resp.json();
            if (data && data.success) {
              fetchNotices();
              fetchStats();
            }
          } catch {}
        };

        // 预览公告
        const previewNotice = (notice) => {
          previewModal.data = notice;
          previewModal.show = true;
        };

        // 获取版本列表
        const fetchVersions = async () => {
          try {
            const resp = await fetch('/api/admin/versions', { headers: getAuthHeaders() });
            const data = await resp.json();
            if (data && data.success) {
              versions.value = data.data;
              latestVersion.value = data.data.length > 0 ? data.data[0] : null;
            }
          } catch {}
        };

        // 打开新建版本弹窗
        const openPublishVersionModal = () => {
          versionModal.isEdit = false;
          versionModal.rawChangelog = '';
          versionModal.form = {
            version: '',
            channel: 'stable',
            releaseDate: new Date().toISOString().split('T')[0],
            title: '',
            downloadUrl: 'https://gitee.com/muyan6/steam/releases',
            downloadUrlBackup: '',
            minSupportedVersion: '1.0.0',
            fileSize: '48.5 MB',
            forceUpdate: false
          };
          versionModal.show = true;
        };

        // 编辑版本
        const editVersion = (ver) => {
          versionModal.isEdit = true;
          versionModal.rawChangelog = (ver.changelog || []).join('\n');
          versionModal.form = { ...ver };
          versionModal.show = true;
        };

        // 保存版本
        const saveVersion = async () => {
          try {
            const changelog = versionModal.rawChangelog.split('\n').map(s => s.trim()).filter(Boolean);
            const payload = { ...versionModal.form, changelog };
            const isEdit = versionModal.isEdit;
            const url = isEdit ? '/api/admin/versions/' + versionModal.form.version : '/api/admin/versions';
            const method = isEdit ? 'PUT' : 'POST';

            const resp = await fetch(url, {
              method,
              headers: getAuthHeaders(),
              body: JSON.stringify(payload)
            });
            const data = await resp.json();
            if (data && data.success) {
              versionModal.show = false;
              fetchVersions();
              fetchStats();
            } else {
              alert('发布失败: ' + (data.message || '未知错误'));
            }
          } catch (e) {
            alert('请求异常: ' + e.message);
          }
        };

        // 启停版本
        const toggleVersion = async (ver) => {
          try {
            const resp = await fetch('/api/admin/versions/' + ver.version + '/toggle', {
              method: 'PATCH',
              headers: getAuthHeaders(),
              body: JSON.stringify({ enabled: ver.enabled === false })
            });
            const data = await resp.json();
            if (data && data.success) {
              ver.enabled = data.data.enabled;
              fetchVersions();
            }
          } catch {}
        };

        // 删除版本
        const deleteVersion = async (version) => {
          if (!confirm('确认删除版本 v' + version + ' 的记录吗？')) return;
          try {
            const resp = await fetch('/api/admin/versions/' + version, { method: 'DELETE', headers: getAuthHeaders() });
            const data = await resp.json();
            if (data && data.success) fetchVersions();
          } catch {}
        };

        // 打开全网推送弹窗
        const openPushBroadcastModal = () => {
          pushModal.version = latestVersion.value?.version || (versions.value[0]?.version || '1.0.0');
          pushModal.title = '🚀 SteamMaster 发现全新版本 v' + pushModal.version;
          pushModal.content = 'SteamMaster v' + pushModal.version + ' 现已正式发布！全面优化入库性能，建议立即更新。';
          pushModal.show = true;
        };

        // 执行全网推送广播
        const executePushBroadcast = async () => {
          try {
            const resp = await fetch('/api/admin/versions/push', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify(pushModal)
            });
            const data = await resp.json();
            if (data && data.success) {
              pushModal.show = false;
              alert('🎉 全网版本推送广播发起成功！所有客户端已同步。');
              fetchAuditLogs();
            } else {
              alert('推送失败: ' + (data.message || '未知错误'));
            }
          } catch (e) {
            alert('推送异常: ' + e.message);
          }
        };

        // 密钥检索
        const handleSearchKey = async () => {
          if (!keySearchQuery.value) return;
          keySearchLoading.value = true;
          try {
            const resp = await fetch('/api/admin/search/debug?q=' + encodeURIComponent(keySearchQuery.value), {
              headers: getAuthHeaders()
            });
            const data = await resp.json();
            if (data && data.success) {
              keySearchResult.value = data.data;
            }
          } catch {} finally {
            keySearchLoading.value = false;
          }
        };

        // 获取数据源
        const fetchSources = async () => {
          try {
            const resp = await fetch('/api/sources');
            const data = await resp.json();
            if (data && data.success && data.data?.sources) {
              sources.value = data.data.sources;
            }
          } catch {}
        };

        // 触发全量同步
        const triggerAllSync = async () => {
          syncLoading.value = true;
          try {
            const resp = await fetch('/api/admin/sync/all', {
              method: 'POST',
              headers: getAuthHeaders()
            });
            const data = await resp.json();
            if (data && data.success) {
              alert('✅ 多源全量聚合调度同步完成！');
              fetchStats();
              fetchAuditLogs();
            } else {
              alert('❌ 同步失败: ' + (data.message || '未知错误'));
            }
          } catch (e) {
            alert('❌ 请求异常: ' + e.message);
          } finally {
            syncLoading.value = false;
          }
        };

        // 修改密码
        const handleChangePassword = async () => {
          pwdLoading.value = true;
          pwdMsg.value = null;
          try {
            const resp = await fetch('/api/auth/change-password', {
              method: 'POST',
              headers: getAuthHeaders(),
              body: JSON.stringify(pwdForm)
            });
            const data = await resp.json();
            if (data && data.success) {
              pwdMsg.value = { success: true, text: '✅ ' + data.message };
              if (data.token) {
                token.value = data.token;
                localStorage.setItem('steammaster_admin_token', data.token);
              }
              if (pwdForm.newUsername) currentAdminUser.username = pwdForm.newUsername;
              pwdForm.currentPassword = '';
              pwdForm.newPassword = '';
              fetchAuditLogs();
            } else {
              pwdMsg.value = { success: false, text: '❌ ' + (data.message || '修改失败') };
            }
          } catch (e) {
            pwdMsg.value = { success: false, text: '❌ 请求异常: ' + e.message };
          } finally {
            pwdLoading.value = false;
          }
        };

        // 审计日志
        const fetchAuditLogs = async () => {
          try {
            const resp = await fetch('/api/auth/audit-logs?limit=50', { headers: getAuthHeaders() });
            const data = await resp.json();
            if (data && data.success) auditLogs.value = data.data;
          } catch {}
        };

        const formatUptime = (seconds) => {
          if (!seconds) return '0h 0m';
          const h = Math.floor(seconds / 3600);
          const m = Math.floor((seconds % 3600) / 60);
          return h + 'h ' + m + 'm';
        };

        const formatDateTime = (isoStr) => {
          if (!isoStr) return '-';
          try {
            const d = new Date(isoStr);
            return d.getFullYear() + '-' +
              String(d.getMonth() + 1).padStart(2, '0') + '-' +
              String(d.getDate()).padStart(2, '0') + ' ' +
              String(d.getHours()).padStart(2, '0') + ':' +
              String(d.getMinutes()).padStart(2, '0');
          } catch {
            return isoStr;
          }
        };

        const initDashboard = async () => {
          fetchStats();
          fetchNotices();
          fetchVersions();
          fetchSources();
          fetchAuditLogs();
        };

        onMounted(() => {
          if (isAuthenticated.value) {
            initDashboard();
          }
        });

        return {
          isAuthenticated,
          currentAdminUser,
          currentTab,
          tabs,
          loginForm,
          loginLoading,
          loginError,
          handleLogin,
          handleLogout,
          stats,
          serverConfig,
          syncLoading,
          triggerAllSync,
          notices,
          noticeModal,
          openCreateNoticeModal,
          editNotice,
          saveNotice,
          toggleNotice,
          deleteNotice,
          previewModal,
          previewNotice,
          fetchNotices,
          versions,
          latestVersion,
          versionModal,
          openPublishVersionModal,
          editVersion,
          saveVersion,
          toggleVersion,
          deleteVersion,
          pushModal,
          openPushBroadcastModal,
          executePushBroadcast,
          keySearchQuery,
          keySearchLoading,
          keySearchResult,
          handleSearchKey,
          sources,
          pwdForm,
          pwdLoading,
          pwdMsg,
          handleChangePassword,
          auditLogs,
          fetchAuditLogs,
          formatUptime,
          formatDateTime
        };
      }
    }).mount('#app');
  </script>
</body>
</html>`;

  res.send(html);
});

// 404 处理
app.use((req, res) => {
  res.status(404).json({ success: false, message: `接口不存在: ${req.method} ${req.path}` });
});

// 全局异常捕获
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('[Unhandled Error]', err);
  res.status(500).json({ success: false, message: '服务器内部错误' });
});

app.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(`
======================================================
🚀 SteamMaster 商业版云端后端已成功启动！
🌐 Web 管控控制台: http://${CONFIG.HOST}:${CONFIG.PORT}
📊 健康检查: http://localhost:${CONFIG.PORT}/api/health
🔑 默认管理账号: ${CONFIG.DEFAULT_ADMIN_USER}
🔑 默认管理密码: ${CONFIG.DEFAULT_ADMIN_PASS}
======================================================
  `);

  // 初始化 Token 数据库与定时自动抓取引擎
  tokenService.loadTokensDb();
  syncService.startScheduledDailySync();
});
