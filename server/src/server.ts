import express from 'express';
import cors from 'cors';
import { CONFIG } from './config/index.js';
import apiRouter from './routes/index.js';
import { tokenService } from './services/tokenService.js';
import { syncService } from './services/syncService.js';
import { depotService } from './services/depotService.js';
import { gameService } from './services/gameService.js';
import { sourceRegistryService } from './services/sourceRegistryService.js';

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

// 后端专属可视化控制台与数据源溯源看板 (Web Dashboard)
app.get(['/', '/dashboard'], (req, res) => {
  const sources = sourceRegistryService.getAllSources();
  const keysCount = depotService.getTotalKeysCount();
  const tokensCount = tokenService.getTotalTokensCount();
  const gamesCount = gameService.getTotalGamesCount();
  const uptime = Math.floor(process.uptime());
  const hours = Math.floor(uptime / 3600);
  const minutes = Math.floor((uptime % 3600) / 60);

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SteamMaster 云端后端管理控制台与数据源看板</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { background-color: #0d1117; color: #c9d1d9; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  </style>
</head>
<body class="p-6 md:p-10 max-w-6xl mx-auto">
  <!-- 头部导航 -->
  <div class="flex items-center justify-between border-b border-slate-800 pb-5 mb-8 flex-wrap gap-4">
    <div>
      <div class="flex items-center gap-3">
        <span class="text-2xl">⚡</span>
        <h1 class="text-xl md:text-2xl font-bold text-white tracking-wide">SteamMaster 商业版 · 云端数据引擎控制台</h1>
        <span class="px-2.5 py-0.5 text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded-full">● 服务运行中</span>
      </div>
      <p class="text-xs text-slate-400 mt-1.5">后端专享独立数据仓库、24h 自动爬虫引擎、多源聚合与 AccessToken 分发调度中心</p>
    </div>

    <div class="flex items-center gap-3">
      <button onclick="triggerSync()" id="syncBtn" class="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold rounded-lg shadow-lg transition flex items-center gap-2">
        <span>🔄 立即触发全量多源同步</span>
      </button>
      <a href="/api/sources" target="_blank" class="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-sky-400 text-xs font-mono rounded-lg border border-slate-700 transition">
        查看 JSON 端点 &rarr;
      </a>
    </div>
  </div>

  <!-- 核心数据指标 -->
  <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
    <div class="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow">
      <div class="text-xs text-slate-400 font-medium">后端持久化 DepotKey</div>
      <div class="text-2xl font-bold font-mono text-emerald-400 mt-1.5">${keysCount.toLocaleString()} <span class="text-xs font-normal text-slate-400">条</span></div>
      <div class="text-[11px] text-slate-400 mt-1">含苏大猫实时库与全球历史库</div>
    </div>

    <div class="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow">
      <div class="text-xs text-slate-400 font-medium">PICS AccessToken 令牌</div>
      <div class="text-2xl font-bold font-mono text-sky-400 mt-1.5">${tokensCount.toLocaleString()} <span class="text-xs font-normal text-slate-400">款应用</span></div>
      <div class="text-[11px] text-slate-400 mt-1">苏大猫 993499094 实时同步</div>
    </div>

    <div class="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow">
      <div class="text-xs text-slate-400 font-medium">全量游戏数据库索引</div>
      <div class="text-2xl font-bold font-mono text-purple-400 mt-1.5">${gamesCount.toLocaleString()} <span class="text-xs font-normal text-slate-400">款</span></div>
      <div class="text-[11px] text-slate-400 mt-1">支持毫秒级拼音/中文检索</div>
    </div>

    <div class="p-5 rounded-2xl bg-slate-900/90 border border-slate-800 shadow">
      <div class="text-xs text-slate-400 font-medium">后端服务运行时间</div>
      <div class="text-2xl font-bold font-mono text-amber-400 mt-1.5">${hours}h ${minutes}m</div>
      <div class="text-[11px] text-slate-400 mt-1">24小时自动轮询引擎就绪</div>
    </div>
  </div>

  <!-- 引用数据源溯源与说明看板 -->
  <div class="mb-6">
    <div class="flex items-center justify-between mb-3">
      <h2 class="text-base font-bold text-white flex items-center gap-2">
        <span>🌐 后端全量引用数据源、API 端点与上游致谢记录</span>
      </h2>
      <span class="text-xs text-slate-400 font-mono">共收录 ${sources.length} 个上游数据管道</span>
    </div>
    <p class="text-xs text-slate-400 mb-4">
      后端系统记录所有引用的上游项目、社区接口、更新频率与授权说明。数据每日在后端自动汇聚与持久化，前端客户端按需调用。
    </p>

    <div class="space-y-4">
      ${sources.map((s, idx) => `
        <div class="p-4 rounded-xl bg-slate-900/80 border border-slate-800 hover:border-slate-700 transition">
          <div class="flex items-start justify-between gap-3 flex-wrap mb-2">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-xs font-mono font-bold px-2 py-0.5 bg-slate-800 text-slate-300 rounded border border-slate-700">#${idx + 1}</span>
              <span class="font-bold text-sm text-white">${s.name}</span>
              <span class="text-[11px] px-2 py-0.5 rounded font-mono bg-sky-950/60 text-sky-300 border border-sky-800/50">${s.syncFrequency}</span>
              <span class="text-[11px] px-2 py-0.5 rounded font-bold bg-emerald-950/60 text-emerald-300 border border-emerald-800/50">● 状态: ${s.status}</span>
            </div>

            ${s.totalRecordsCount > 0 ? `
              <span class="text-xs font-mono font-bold text-emerald-400">已收录: ${s.totalRecordsCount.toLocaleString()} 条记录</span>
            ` : ''}
          </div>

          <p class="text-xs text-slate-300 leading-relaxed mb-3">${s.description}</p>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono text-slate-400 pt-2.5 border-t border-slate-800/80">
            <div><span class="text-slate-400">来源 / 作者：</span><span class="text-slate-200">${s.author}</span></div>
            <div><span class="text-slate-400">官方主页：</span><a href="${s.sourceUrl}" target="_blank" class="text-sky-400 hover:underline truncate">${s.sourceUrl}</a></div>
            ${s.endpointUrl ? `<div class="md:col-span-2 truncate"><span class="text-slate-400">后端请求端点：</span><span class="text-slate-300">${s.endpointUrl}</span></div>` : ''}
          </div>

          ${s.licenseOrNote ? `
            <div class="mt-2.5 p-2.5 rounded-lg bg-slate-950/80 border border-slate-800 text-xs text-slate-400 leading-relaxed">
              💡 <span class="text-slate-300 font-medium">致谢与说明：</span>${s.licenseOrNote}
            </div>
          ` : ''}
        </div>
      `).join('')}
    </div>
  </div>

  <div class="text-center text-xs text-slate-400 pt-8 border-t border-slate-800 font-mono">
    SteamMaster Cloud Server · 监听端口: ${CONFIG.PORT} · 数据存储路径: ${CONFIG.DATA_DIR}
  </div>

  <script>
    async function triggerSync() {
      const btn = document.getElementById('syncBtn');
      btn.disabled = true;
      btn.innerHTML = '<span>⏳ 正在请求后端拉取并同步各上游...</span>';
      try {
        const resp = await fetch('/api/sources/sync', { method: 'POST' });
        const res = await resp.json();
        if (res && res.success) {
          alert('✅ ' + (res.message || '多源数据同步完成！'));
          window.location.reload();
        } else {
          alert('❌ 同步失败: ' + (res.message || '未知错误'));
        }
      } catch (e) {
        alert('❌ 请求异常: ' + e.message);
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<span>🔄 立即触发全量多源同步</span>';
      }
    }
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
🌐 控制台看板: http://${CONFIG.HOST}:${CONFIG.PORT}
📊 健康检查: http://localhost:${CONFIG.PORT}/api/health
🔑 管理密钥: ${CONFIG.ADMIN_SECRET}
======================================================
  `);

  // 初始化 Token 数据库与定时自动抓取引擎
  tokenService.loadTokensDb();
  syncService.startScheduledDailySync();
});
