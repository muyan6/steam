import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { CONFIG } from './config/index.js';
import apiRouter from './routes/index.js';
import { syncService } from './services/syncService.js';
import { onlineRulesSyncService } from './services/onlineRulesSyncService.js';
import { depotService } from './services/depotService.js';
import { gameService } from './services/gameService.js';
import { sourceRegistryService } from './services/sourceRegistryService.js';
import { noticeService } from './services/noticeService.js';
import { versionService } from './services/versionService.js';
import { authService } from './services/authService.js';
import { ADMIN_JS } from './static/adminScript.js';
import { LANDING_HTML } from './static/landingPage.js';
import { CFD_LOGO_DATA_URI } from './static/logoAsset.js';

const app = express();

// 反向代理支持：TRUST_PROXY 未配置时不信任任何代理头（直连部署）；
// 配置后 express-rate-limit 与审计日志才能拿到真实客户端 IP
if (CONFIG.TRUST_PROXY !== false) {
  app.set('trust proxy', CONFIG.TRUST_PROXY as any);
}

// 基础中间件
app.disable('x-powered-by');
const corsOrigin = CONFIG.CORS_ORIGIN === '' ? false : CONFIG.CORS_ORIGIN;
if (corsOrigin) {
  app.use(cors({ origin: corsOrigin as any }));
}
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// 全局限流：保护公开接口不被滥用（登录与心跳另有专门限流）
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: '请求过于频繁，请稍后再试' }
});
app.use('/api', globalLimiter);

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

// 1. 前台宣传展示与下载页 (移动端/桌面端高质感响应式前页，对齐 ruku.html)
app.get(['/', '/ruku.html', '/index.html'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(LANDING_HTML);
});

// 2. 后端管理控制台 (100% 独立内联、零外部 CDN 依赖、秒开原生 SPA)
// HTML 模板为纯静态内容（Logo 与内联脚本在模块加载期注入），提升为模块级常量，避免每次请求重建巨型字符串
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>春风渡 · 云端管控控制台</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: #0a0e17;
      background-image:
        radial-gradient(at 10% 10%, rgba(14, 165, 233, 0.12) 0px, transparent 50%),
        radial-gradient(at 90% 80%, rgba(16, 185, 129, 0.10) 0px, transparent 50%),
        radial-gradient(at 50% 40%, rgba(99, 102, 241, 0.07) 0px, transparent 60%);
      background-attachment: fixed;
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "WenQuanYi Micro Hei", sans-serif;
      font-size: 14.5px;
      line-height: 1.6;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    a { color: var(--c-blue); text-decoration: none; transition: color 0.15s; }
    a:hover { color: #7dd3fc; text-decoration: underline; }
    button { cursor: pointer; font-family: inherit; }
    input, select, textarea { font-family: inherit; font-size: 14px; }

    /* 自定义滚动条 */
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: rgba(2, 6, 23, 0.4); }
    ::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.14); border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.25); }

    /* 顶部导航栏 */
    .app-header {
      background: rgba(11, 15, 25, 0.88);
      backdrop-filter: blur(20px);
      -webkit-backdrop-filter: blur(20px);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding: 14px 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: sticky;
      top: 0;
      z-index: 30;
      flex-wrap: wrap;
      gap: 14px;
    }
    .nav-tabs {
      display: flex;
      background: rgba(2, 6, 23, 0.85);
      padding: 5px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      gap: 5px;
    }
    .tab-btn {
      background: transparent;
      border: none;
      color: var(--text-mid);
      padding: 8px 18px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 13.5px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .tab-btn:hover { color: #f8fafc; background: rgba(255, 255, 255, 0.06); }
    .tab-btn.active {
      background: linear-gradient(135deg, #0284c7, #0369a1);
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4);
    }

    /* 主内容容器 */
    .main-container { max-width: 1320px; margin: 0 auto; padding: 28px 20px; }

    /* 响应式移动端适配 */
    @media (max-width: 768px) {
      .app-header { padding: 12px 16px; flex-direction: column; align-items: flex-start; }
      .nav-tabs { width: 100%; overflow-x: auto; flex-wrap: nowrap; padding: 4px; }
      .tab-btn { padding: 6px 12px; font-size: 12.5px; white-space: nowrap; }
      .main-container { padding: 16px 12px; }
      .grid-4 { grid-template-columns: 1fr 1fr; gap: 10px; }
      .grid-2 { grid-template-columns: 1fr; gap: 12px; }
      .modal-box { padding: 20px 16px; }
      .form-row { grid-template-columns: 1fr; gap: 10px; }
      .kpi-val { font-size: 22px; }
    }
    @media (max-width: 480px) {
      .grid-4 { grid-template-columns: 1fr; }
    }

    /* 现代玻璃拟态卡片 */
    .card {
      background: rgba(15, 23, 42, 0.8);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.09);
      border-radius: 18px;
      padding: 24px;
      box-shadow: 0 10px 30px -5px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
      transition: transform 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
    }
    .card:hover {
      border-color: rgba(255, 255, 255, 0.14);
    }

    /* 网格布局 */
    .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 18px; }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 18px; }
    
    /* KPI 统计指标卡片 */
    .kpi-title {
      font-size: 12.5px;
      color: var(--text-mid);
      font-weight: 600;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }
    .kpi-val {
      font-size: 30px;
      font-weight: 800;
      font-family: "JetBrains Mono", Consolas, monospace;
      margin: 8px 0 6px 0;
      letter-spacing: -0.02em;
    }
    .kpi-sub { font-size: 12px; color: var(--text-dim); }

    /* 表格组件优化 */
    .table-container {
      overflow-x: auto;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.08);
      background: rgba(2, 6, 23, 0.5);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th {
      background: rgba(15, 23, 42, 0.95);
      padding: 14px 18px;
      font-size: 12.5px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: var(--text-mid);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    }
    td {
      padding: 14px 18px;
      font-size: 13.5px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.04);
      vertical-align: middle;
    }
    tr:hover td { background: rgba(56, 189, 248, 0.03); }

    /* 按钮样式 */
    .btn {
      padding: 9px 18px;
      border-radius: 10px;
      font-weight: 600;
      font-size: 13.5px;
      border: none;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      line-height: 1.3;
    }
    .btn-primary {
      background: linear-gradient(135deg, #0284c7, #0d9488);
      color: var(--text-strong);
      box-shadow: 0 4px 14px rgba(2, 132, 199, 0.35);
    }
    .btn-primary:hover {
      opacity: 0.94;
      transform: translateY(-1px);
      box-shadow: 0 6px 20px rgba(2, 132, 199, 0.45);
    }
    .btn-secondary {
      background: #1e293b;
      color: var(--text);
      border: 1px solid #334155;
    }
    .btn-secondary:hover {
      background: #334155;
      color: var(--text-strong);
      border-color: #475569;
    }
    .btn-danger {
      background: rgba(225, 29, 72, 0.15);
      color: #fda4af;
      border: 1px solid rgba(225, 29, 72, 0.35);
    }
    .btn-danger:hover {
      background: rgba(225, 29, 72, 0.3);
      color: var(--text-strong);
    }
    .btn-sm { padding: 6px 13px; font-size: 12.5px; border-radius: 8px; }

    /* 输入框与选择器 */
    .input-ctrl {
      width: 100%;
      height: 40px;
      background: rgba(2, 6, 23, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.14);
      padding: 8px 14px;
      border-radius: 10px;
      color: var(--text-strong);
      font-size: 13.5px;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .input-ctrl:focus {
      border-color: var(--c-blue);
      box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.25);
    }
    textarea.input-ctrl { height: auto; padding: 10px 14px; }

    /* 状态徽章 */
    .badge {
      display: inline-flex;
      align-items: center;
      padding: 3px 10px;
      border-radius: 9999px;
      font-size: 11.5px;
      font-weight: 700;
      font-family: inherit;
      line-height: 1.3;
    }
    .badge-green { background: rgba(16, 185, 129, 0.15); color: var(--c-green); border: 1px solid rgba(16, 185, 129, 0.35); }
    .badge-blue { background: rgba(56, 189, 248, 0.15); color: var(--c-blue); border: 1px solid rgba(56, 189, 248, 0.35); }
    .badge-amber { background: rgba(245, 158, 11, 0.15); color: var(--c-amber); border: 1px solid rgba(245, 158, 11, 0.35); }
    .badge-rose { background: rgba(244, 63, 94, 0.15); color: var(--c-rose); border: 1px solid rgba(244, 63, 94, 0.35); }
    .badge-gray { background: rgba(100, 116, 139, 0.2); color: var(--text-mid); border: 1px solid rgba(100, 116, 139, 0.35); }

    /* 提示消息条 */
    .alert-box {
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 13.5px;
      line-height: 1.5;
      margin-bottom: 16px;
      text-align: left;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .alert-error { background: rgba(225, 29, 72, 0.18); border: 1px solid rgba(225, 29, 72, 0.45); color: #fda4af; }
    .alert-success { background: rgba(16, 185, 129, 0.18); border: 1px solid rgba(16, 185, 129, 0.45); color: #6ee7b7; }
    .alert-info { background: rgba(56, 189, 248, 0.18); border: 1px solid rgba(56, 189, 248, 0.45); color: #7dd3fc; }

    /* 模态框大盘弹窗 */
    .modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(4, 7, 15, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 50;
      padding: 20px;
    }
    .modal-box {
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.14);
      border-radius: 22px;
      width: 100%;
      max-width: 620px;
      padding: 28px 32px;
      max-height: 90vh;
      overflow-y: auto;
      box-shadow: 0 25px 60px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
    }

    .form-group { margin-bottom: 16px; }
    .form-group label { display: block; font-size: 12.5px; font-weight: 600; color: var(--text); margin-bottom: 7px; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }

    /* 隐藏类 */
    .d-none { display: none !important; }

    /* 抖动动画 */
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-6px); }
      40%, 80% { transform: translateX(6px); }
    }
    .shake { animation: shake 0.4s ease-in-out; }

    /* ==================== 主题变量（黑夜默认 / 白天可切换）与紧凑化尺寸 ==================== */
    :root {
      --bg: #0a0e17;
      --text: #e2e8f0;
      --text-strong: #ffffff;
      --text-mid: #94a3b8;
      --text-dim: #64748b;
      --border: rgba(255, 255, 255, 0.09);
      --border-soft: rgba(255, 255, 255, 0.05);
      --header-bg: rgba(11, 15, 25, 0.88);
      --card-bg: rgba(15, 23, 42, 0.8);
      --pill-bg: rgba(2, 6, 23, 0.75);
      --table-bg: rgba(2, 6, 23, 0.5);
      --th-bg: rgba(15, 23, 42, 0.95);
      --input-bg: rgba(2, 6, 23, 0.7);
      --input-border: rgba(255, 255, 255, 0.14);
      --modal-bg: #0f172a;
      --overlay-bg: rgba(4, 7, 15, 0.85);
      --btn2-bg: #1e293b;
      --btn2-bg-hover: #334155;
      --btn2-border: #334155;
      --btn2-text: #e2e8f0;
      --shadow-card: 0 8px 24px -6px rgba(0, 0, 0, 0.4);
      --c-blue: #38bdf8; --c-green: #34d399; --c-amber: #fbbf24; --c-rose: #fb7185; --c-purple: #c084fc;
      --scroll-track: rgba(2, 6, 23, 0.4);
      --scroll-thumb: rgba(255, 255, 255, 0.14);
    }
    html.light {
      --bg: #eef1f6;
      --text: #334155;
      --text-strong: #0f172a;
      --text-mid: #64748b;
      --text-dim: #94a3b8;
      --border: rgba(15, 23, 42, 0.10);
      --border-soft: rgba(15, 23, 42, 0.07);
      --header-bg: rgba(255, 255, 255, 0.92);
      --card-bg: #ffffff;
      --pill-bg: #f1f5f9;
      --table-bg: #ffffff;
      --th-bg: #f1f5f9;
      --input-bg: #ffffff;
      --input-border: rgba(15, 23, 42, 0.18);
      --modal-bg: #ffffff;
      --overlay-bg: rgba(15, 23, 42, 0.45);
      --btn2-bg: #ffffff;
      --btn2-bg-hover: #f1f5f9;
      --btn2-border: rgba(15, 23, 42, 0.15);
      --btn2-text: #0f172a;
      --shadow-card: 0 6px 18px -6px rgba(15, 23, 42, 0.12);
      --c-blue: #0284c7; --c-green: #059669; --c-amber: #d97706; --c-rose: #e11d48; --c-purple: #9333ea;
      --scroll-track: rgba(15, 23, 42, 0.06);
      --scroll-thumb: rgba(15, 23, 42, 0.22);
    }
    html.light body {
      background-image:
        radial-gradient(at 10% 10%, rgba(14, 165, 233, 0.07) 0px, transparent 50%),
        radial-gradient(at 90% 80%, rgba(16, 185, 129, 0.06) 0px, transparent 50%),
        radial-gradient(at 50% 40%, rgba(99, 102, 241, 0.04) 0px, transparent 60%);
    }
    html.light tr:hover td { background: rgba(2, 132, 199, 0.05); }
    html.light code { color: inherit; }
    html.light a:hover { color: var(--c-blue); }
    html.light .btn-danger { color: var(--c-rose); }
    html.light .alert-error { color: #b91c1c; }
    html.light .alert-success { color: #047857; }
    html.light .alert-info { color: #0369a1; }
    html.light .badge-green { color: #059669; }
    html.light .badge-blue { color: #0369a1; }
    html.light .badge-amber { color: #b45309; }
    html.light .badge-rose { color: #be123c; }
    html.light .badge-gray { color: #64748b; }

    body { font-size: 14px; background-color: var(--bg); color: var(--text); }
    ::-webkit-scrollbar-track { background: var(--scroll-track); }
    ::-webkit-scrollbar-thumb { background: var(--scroll-thumb); }

    .app-header {
      background: var(--header-bg);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
    }
    .nav-tabs { background: var(--pill-bg); border: 1px solid var(--border-soft); padding: 4px; border-radius: 12px; gap: 4px; }
    .tab-btn { color: var(--text-mid); padding: 7px 14px; border-radius: 9px; font-size: 13px; }
    .tab-btn:hover { color: var(--text-strong); background: var(--btn2-bg-hover); }
    .tab-btn.active { background: linear-gradient(135deg, #0284c7, #0369a1); color: #ffffff; box-shadow: 0 4px 14px rgba(2, 132, 199, 0.4); }

    .main-container { max-width: 1400px; padding: 22px 18px; }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 20px;
      box-shadow: var(--shadow-card);
    }
    /* KPI 卡片左侧彩色描边（对齐参考控制台） */
    .kpi-card { border-left-width: 4px; }

    .grid-4 { gap: 16px; }
    .grid-2 { gap: 16px; }

    .kpi-title { font-size: 12px; color: var(--text-mid); }
    .kpi-val { font-size: 26px; margin: 6px 0 4px 0; }
    .kpi-sub { font-size: 11.5px; color: var(--text-dim); }

    .table-container { border: 1px solid var(--border); background: var(--table-bg); border-radius: 12px; }
    th { background: var(--th-bg); padding: 11px 14px; font-size: 12px; color: var(--text-mid); border-bottom: 1px solid var(--border); }
    td { padding: 11px 14px; font-size: 13px; border-bottom: 1px solid var(--border-soft); }

    .btn { padding: 8px 15px; border-radius: 9px; font-size: 13px; }
    .btn-primary, .btn-primary:hover, .tab-btn.active, .btn-danger:hover { color: #ffffff; }
    .btn-secondary { background: var(--btn2-bg); color: var(--btn2-text); border: 1px solid var(--btn2-border); }
    .btn-secondary:hover { background: var(--btn2-bg-hover); color: var(--text-strong); border-color: var(--text-dim); }
    .btn-sm { padding: 5px 11px; font-size: 12px; }

    .input-ctrl {
      height: 38px;
      background: var(--input-bg);
      border: 1px solid var(--input-border);
      color: var(--text-strong);
      font-size: 13px;
      border-radius: 9px;
      padding: 8px 12px;
    }
    input.input-ctrl::placeholder, textarea.input-ctrl::placeholder { color: var(--text-dim); }
    select.input-ctrl option { background: var(--modal-bg); color: var(--text-strong); }

    .alert-box { font-size: 13px; }

    .modal-overlay { background: var(--overlay-bg); }
    .modal-box { background: var(--modal-bg); border: 1px solid var(--border); border-radius: 18px; padding: 24px 28px; }

    .form-group label { font-size: 12px; color: var(--text-mid); }
    .theme-toggle-btn { white-space: nowrap; }
  </style>
  <script>
    // 主题预加载：登录页渲染前应用已保存的白天/黑夜模式，避免闪烁
    try {
      if (localStorage.getItem('steammaster_admin_theme') === 'light') {
        document.documentElement.classList.add('light');
      }
    } catch (e) {}
  </script>
</head>
<body>

  <!-- ==================== 1. 管理员登录界面 ==================== -->
  <div id="loginSection" class="modal-overlay" style="display: flex;">
    <div class="modal-box" id="loginBox" style="max-width: 440px; text-align: center; padding: 36px 32px;">
      <div style="width: 62px; height: 62px; border-radius: 18px; background: #0b1220; border: 1px solid rgba(255,255,255,0.12); margin: 0 auto 18px; display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: 0 8px 20px rgba(2, 132, 199, 0.35);">
        <img src="${CFD_LOGO_DATA_URI}" alt="春风渡" draggable="false" style="width: 72%; height: 72%; object-fit: contain;" />
      </div>
      <h1 style="font-size: 20px; font-weight: 800; color: var(--text-strong); margin-bottom: 6px;">春风渡</h1>
      <p style="font-size: 13.5px; color: var(--text-mid); margin-bottom: 24px;">云端数据调度引擎 · 激活码与设备安全管控中枢</p>

      <!-- 登录状态/错误提示框 -->
      <div id="loginNotice" class="alert-box alert-error d-none">
        <span id="loginNoticeIcon">⚠️</span>
        <span id="loginNoticeText">账号或密码错误</span>
      </div>

      <div id="loginFormContainer">
        <div class="form-group" style="text-align: left;">
          <label>管理员账号 (Username)</label>
          <input type="text" id="loginUser" class="input-ctrl" placeholder="请输入管理员账号" autocomplete="username" onkeydown="if(event.key==='Enter') handleLoginSubmit();" />
        </div>

        <div class="form-group" style="text-align: left;">
          <label>管理员密码 (Password)</label>
          <input type="password" id="loginPass" class="input-ctrl" placeholder="请输入管理员密码" autocomplete="current-password" onkeydown="if(event.key==='Enter') handleLoginSubmit();" />
        </div>

        <button type="button" id="loginBtn" onclick="handleLoginSubmit()" class="btn btn-primary" style="width: 100%; justify-content: center; padding: 12px; margin-top: 10px; font-size: 15px; border-radius: 12px;">
          <span>安全登录控制台 ➔</span>
        </button>
      </div>

      <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid rgba(255,255,255,0.08); font-size: 12px; color: var(--text-dim); line-height: 1.6;">
        <div>请使用管理员账号登录。首次部署后请立即在「安全配置」中修改默认密码。</div>
      </div>
    </div>
  </div>

  <!-- ==================== 2. 控制台主界面 ==================== -->
  <div id="dashboardSection" class="d-none" style="display: none;">
    <header class="app-header">
      <div style="display: flex; align-items: center; gap: 14px;">
        <div style="width: 42px; height: 42px; border-radius: 12px; background: #0b1220; border: 1px solid rgba(255,255,255,0.12); display: flex; align-items: center; justify-content: center; overflow: hidden; box-shadow: 0 4px 14px rgba(2,132,199,0.35);">
          <img src="${CFD_LOGO_DATA_URI}" alt="春风渡" draggable="false" style="width: 72%; height: 72%; object-fit: contain;" />
        </div>
        <div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <strong style="color: var(--text-strong); font-size: 16px; font-weight: 800; letter-spacing: -0.01em;">春风渡</strong>
            <span class="badge badge-green">● 云端运行中</span>
          </div>
          <div style="font-size: 12.5px; color: var(--text-mid); margin-top: 1px;">28.8万+ 本地/云端全量库调度中枢 · 客户端设备与激活码管控中心</div>
        </div>
      </div>

      <!-- 选项卡切换导航 -->
      <div class="nav-tabs">
        <button class="tab-btn active" onclick="switchTab('overview', this)">📊 系统大盘</button>
        <button class="tab-btn" onclick="switchTab('licenses', this)">🔑 激活码管理</button>
        <button class="tab-btn" onclick="switchTab('devices', this)">💻 客户端设备</button>
        <button class="tab-btn" onclick="switchTab('notices', this)">📢 公告中心</button>
        <button class="tab-btn" onclick="switchTab('versions', this)">🚀 版本与推送</button>
        <button class="tab-btn" onclick="switchTab('keys', this)">🔍 密钥检索</button>
        <button class="tab-btn" onclick="switchTab('sources', this)">🌐 多源调度</button>
        <button class="tab-btn" onclick="switchTab('security', this)">⚙️ 链接与系统设置</button>
      </div>

      <!-- 用户信息与退出 -->
      <div style="display: flex; align-items: center; gap: 12px;">
        <button id="themeToggleBtn" onclick="toggleTheme()" class="btn btn-secondary btn-sm theme-toggle-btn" title="切换白天 / 黑夜模式">☀️ 白天模式</button>
        <div style="background: var(--pill-bg); padding: 6px 14px; border-radius: 10px; border: 1px solid var(--border-soft); font-size: 13px; display: flex; align-items: center; gap: 6px;">
          <span>👤</span> <strong id="adminUsername" style="color: var(--c-blue);">admin</strong> <span class="badge badge-blue" style="font-size: 11px;">超级管理员</span>
        </div>
        <button onclick="handleLogout()" class="btn btn-secondary btn-sm" style="color: var(--c-rose); font-weight: 700;">退出登录</button>
      </div>
    </header>

    <div class="main-container">

      <!-- ==================== Tab 1: 系统大盘 ==================== -->
      <div id="tab-overview" class="tab-content">
        <div class="grid-4" style="margin-bottom: 24px;">
          <div class="card kpi-card" style="border-left-color: var(--c-green);">
            <div class="kpi-title"><span>持久化 DepotKey 总量</span> <span>🔑</span></div>
            <div class="kpi-val" id="kpiKeys" style="color: var(--c-green);">...</div>
            <div class="kpi-sub">后端清单源与权威密钥库</div>
          </div>
          <div class="card kpi-card" style="border-left-color: var(--c-blue);">
            <div class="kpi-title"><span>PICS AccessToken 令牌</span> <span>🎫</span></div>
            <div class="kpi-val" id="kpiTokens" style="color: var(--c-blue);">...</div>
            <div class="kpi-sub">后端清单源每日实时同步</div>
          </div>
          <div class="card kpi-card" style="border-left-color: var(--c-purple);">
            <div class="kpi-title"><span>累计客户端设备数</span> <span>💻</span></div>
            <div class="kpi-val" id="kpiDevTotal" style="color: var(--c-purple);">...</div>
            <div class="kpi-sub">已连接本系统的独立机器码总量</div>
          </div>
          <div class="card kpi-card" style="border-left-color: var(--c-amber);">
            <div class="kpi-title"><span>今日活跃客户端</span> <span>🔥</span></div>
            <div class="kpi-val" id="kpiDevToday" style="color: var(--c-amber);">...</div>
            <div class="kpi-sub" id="kpiMem">今日在线与心跳上报</div>
          </div>
        </div>

        <div class="card" style="margin-bottom: 24px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 18px;">
            <div>
              <strong style="color: var(--text-strong); font-size: 16px; font-weight: 700;">⚡ 快捷调度与控制中枢</strong>
              <div style="color: var(--text-mid); font-size: 12.5px; margin-top: 2px;">一键下发指令、触发全网爬虫同步与卡密生命周期管控</div>
            </div>
            <span class="badge badge-green">24小时自动引擎运行中</span>
          </div>
          <div style="display: flex; gap: 14px; flex-wrap: wrap;">
            <button onclick="triggerSyncAll()" id="btnSyncAll" class="btn btn-primary" style="padding: 11px 22px; font-size: 14px;">
              <span>🔄 立即触发全量多源聚合同步</span>
            </button>
            <button onclick="switchTab('security', document.querySelectorAll('.tab-btn')[7])" class="btn btn-secondary" style="padding: 11px 20px; font-size: 14px; color: var(--c-amber);">
              <span>💖 配置赞助与反馈群链接 ➔</span>
            </button>
            <button onclick="switchTab('devices', document.querySelectorAll('.tab-btn')[2])" class="btn btn-secondary" style="padding: 11px 20px; font-size: 14px; color: var(--c-purple);">
              <span>💻 查看客户端设备监控 ➔</span>
            </button>
            <button onclick="openNoticeModal()" class="btn btn-secondary" style="padding: 11px 20px; font-size: 14px;">
              <span>📢 发布新系统公告</span>
            </button>
            <button onclick="openVersionModal()" class="btn btn-secondary" style="padding: 11px 20px; font-size: 14px;">
              <span>🚀 发布新版本 & 强更</span>
            </button>
            <button onclick="switchTab('licenses', document.querySelectorAll('.tab-btn')[1])" class="btn btn-secondary" style="padding: 11px 20px; font-size: 14px; color: var(--c-blue);">
              <span>🔑 批量生成/管理激活码 ➔</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ==================== Tab 2: 激活码与设备绑定管理 ==================== -->
      <div id="tab-licenses" class="tab-content d-none" style="display: none;">
        <!-- KPI 统计卡片 -->
        <div class="grid-4" style="margin-bottom: 24px;">
          <div class="card kpi-card" style="border-left-color: var(--c-blue);">
            <div class="kpi-title"><span>总激活码数量</span> <span>🔑</span></div>
            <div class="kpi-val" id="kpiLicTotal" style="color: var(--c-blue);">0</div>
            <div class="kpi-sub" id="kpiLicTypeBreakdown" style="font-weight: 500; color: var(--text);">月: 0 · 季: 0 · 年: 0 · 永久: 0</div>
          </div>
          <div class="card kpi-card" style="border-left-color: var(--c-green);">
            <div class="kpi-title"><span>未使用 (待分配)</span> <span>📦</span></div>
            <div class="kpi-val" id="kpiLicUnused" style="color: var(--c-green);">0</div>
            <div class="kpi-sub">随时可发放给新用户</div>
          </div>
          <div class="card kpi-card" style="border-left-color: var(--c-amber);">
            <div class="kpi-title"><span>已激活 (绑定设备)</span> <span>💻</span></div>
            <div class="kpi-val" id="kpiLicActive" style="color: var(--c-amber);">0</div>
            <div class="kpi-sub">正常在期设备授权数</div>
          </div>
          <div class="card kpi-card" style="border-left-color: var(--c-rose);">
            <div class="kpi-title"><span>已过期 / 冻结</span> <span>⏱️</span></div>
            <div class="kpi-val" id="kpiLicExpired" style="color: var(--c-rose);">0</div>
            <div class="kpi-sub">已到期或管理员冻结</div>
          </div>
        </div>

        <!-- 检索与操作工具栏 -->
        <div class="card" style="margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
            <div style="display: flex; gap: 12px; flex: 1; min-width: 340px; flex-wrap: wrap;">
              <input type="text" id="licSearchInput" class="input-ctrl" style="max-width: 300px;" placeholder="🔍 搜索卡密 / 设备识别码 / 备注..." onkeydown="if(event.key==='Enter') loadLicensesData(1);" />
              <select id="licTypeFilter" class="input-ctrl" style="max-width: 150px;" onchange="loadLicensesData(1);">
                <option value="all">全部卡种类型</option>
                <option value="monthly">月卡会员 (30天)</option>
                <option value="quarterly">季卡会员 (90天)</option>
                <option value="yearly">年卡会员 (365天)</option>
                <option value="lifetime">永久尊享卡 (终身)</option>
              </select>
              <select id="licStatusFilter" class="input-ctrl" style="max-width: 140px;" onchange="loadLicensesData(1);">
                <option value="all">全部授权状态</option>
                <option value="unused">未使用</option>
                <option value="active">已激活绑定</option>
                <option value="expired">已过期</option>
                <option value="disabled">已冻结</option>
              </select>
              <button onclick="loadLicensesData(1)" class="btn btn-secondary">🔍 筛选</button>
            </div>

            <div style="display: flex; gap: 12px;">
              <button onclick="copyCurrentLicenses()" class="btn btn-secondary" style="font-size: 13.5px;">📋 复制当前页卡密</button>
              <button onclick="openGenerateLicenseModal()" class="btn btn-primary" style="font-size: 14px; padding: 10px 20px;">⚡ + 批量生成激活码</button>
            </div>
          </div>
        </div>

        <!-- 卡密列表表格 -->
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>激活码 (Code)</th>
                <th>卡种</th>
                <th>状态</th>
                <th>绑定设备码 (Device ID)</th>
                <th>绑定时间</th>
                <th>到期时间 / 剩余天数</th>
                <th>批次备注</th>
                <th style="text-align: right;">管理操作</th>
              </tr>
            </thead>
            <tbody id="licenseTableBody">
              <tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 32px; font-size: 14px;">正在载入激活码数据...</td></tr>
            </tbody>
          </table>
        </div>

        <!-- 分页控制器 -->
        <div id="licensePagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 18px; font-size: 13px; color: var(--text-mid);">
          <span id="licensePageInfo">共 0 条记录</span>
          <div style="display: flex; gap: 10px;">
            <button id="licBtnPrev" onclick="changeLicensePage(-1)" class="btn btn-secondary btn-sm" disabled>← 上一页</button>
            <button id="licBtnNext" onclick="changeLicensePage(1)" class="btn btn-secondary btn-sm" disabled>下一页 →</button>
          </div>
        </div>
      </div>

      <!-- ==================== Tab 3: 客户端设备管理 ==================== -->
      <div id="tab-devices" class="tab-content d-none" style="display: none;">
        <!-- KPI 统计卡片 -->
        <div class="grid-4" style="margin-bottom: 24px;">
          <div class="card kpi-card" style="border-left-color: var(--c-blue);">
            <div class="kpi-title"><span>累计客户端设备数</span> <span>💻</span></div>
            <div class="kpi-val" id="kpiDevTabTotal" style="color: var(--c-blue);">0</div>
            <div class="kpi-sub">已连接本系统的独立机器码总量</div>
          </div>
          <div class="card kpi-card" style="border-left-color: var(--c-green);">
            <div class="kpi-title"><span>今日活跃设备数</span> <span>🔥</span></div>
            <div class="kpi-val" id="kpiDevTabToday" style="color: var(--c-green);">0</div>
            <div class="kpi-sub">今日有心跳/入库活跃记录的设备</div>
          </div>
          <div class="card kpi-card" style="border-left-color: var(--c-amber);">
            <div class="kpi-title"><span>7天活跃设备数</span> <span>⚡</span></div>
            <div class="kpi-val" id="kpiDevTabWeek" style="color: var(--c-amber);">0</div>
            <div class="kpi-sub">近7天内启动并连接云端的设备</div>
          </div>
          <div class="card kpi-card" style="border-left-color: var(--c-purple);">
            <div class="kpi-title"><span>已激活会员设备</span> <span>👑</span></div>
            <div class="kpi-val" id="kpiDevTabAct" style="color: var(--c-purple);">0</div>
            <div class="kpi-sub">已绑定有效激活码的设备数</div>
          </div>
        </div>

        <!-- 检索与操作工具栏 -->
        <div class="card" style="margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 14px;">
            <div style="display: flex; gap: 12px; flex: 1; min-width: 320px; flex-wrap: wrap;">
              <input type="text" id="devSearchInput" class="input-ctrl" style="max-width: 340px;" placeholder="🔍 搜索设备码 / 客户端版本 / 操作系统 / IP..." onkeydown="if(event.key==='Enter') loadDevicesData(1);" />
              <select id="devStatusFilter" class="input-ctrl" style="max-width: 160px;" onchange="loadDevicesData(1);">
                <option value="all">全部设备状态</option>
                <option value="activated">仅看会员已激活</option>
                <option value="unactivated">仅看普通未激活</option>
              </select>
              <button onclick="loadDevicesData(1)" class="btn btn-secondary">🔍 筛选检索</button>
            </div>
            <div style="display: flex; gap: 12px;">
              <button onclick="cleanupDevices()" class="btn btn-secondary" style="font-size: 13.5px; color: var(--c-amber);">🧹 清理长期未活跃设备</button>
              <button onclick="loadDevicesData(currentDevPage)" class="btn btn-secondary" style="font-size: 13.5px;">🔄 刷新列表</button>
            </div>
          </div>
        </div>

        <!-- 设备列表表格 -->
        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>设备识别码 (Device ID)</th>
                <th>授权状态</th>
                <th>客户端版本</th>
                <th>操作系统 / 平台</th>
                <th>来源 IP</th>
                <th>首次使用时间</th>
                <th>最近心跳 / 活跃时间</th>
                <th style="text-align: right;">管理操作</th>
              </tr>
            </thead>
            <tbody id="deviceTableBody">
              <tr><td colspan="8" style="text-align: center; color: var(--text-dim); padding: 32px; font-size: 14px;">正在载入设备档案...</td></tr>
            </tbody>
          </table>
        </div>

        <!-- 分页控制器 -->
        <div id="devicePagination" style="display: flex; justify-content: space-between; align-items: center; margin-top: 18px; font-size: 13px; color: var(--text-mid);">
          <span id="devicePageInfo">共 0 台设备</span>
          <div style="display: flex; gap: 10px;">
            <button id="devBtnPrev" onclick="changeDevicePage(-1)" class="btn btn-secondary btn-sm" disabled>← 上一页</button>
            <button id="devBtnNext" onclick="changeDevicePage(1)" class="btn btn-secondary btn-sm" disabled>下一页 →</button>
          </div>
        </div>
      </div>

      <!-- ==================== Tab 3: 公告中心 ==================== -->
      <div id="tab-notices" class="tab-content d-none" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <div>
            <strong style="color: var(--text-strong); font-size: 17px; font-weight: 700;">📢 系统公告发布与调度中心</strong>
            <div style="color: var(--text-mid); font-size: 13px; margin-top: 2px;">支持弹窗公告、顶部横幅、按客户端版本定向下发与一键启停</div>
          </div>
          <button onclick="openNoticeModal()" class="btn btn-primary">+ 发布新公告</button>
        </div>

        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>状态</th>
                <th>公告标题</th>
                <th>展示类型</th>
                <th>提示级别</th>
                <th>优先级</th>
                <th>弹窗频率</th>
                <th>生效版本</th>
                <th>更新时间</th>
                <th style="text-align: right;">管理操作</th>
              </tr>
            </thead>
            <tbody id="noticeTableBody">
              <tr><td colspan="9" style="text-align: center; color: var(--text-dim); padding: 32px; font-size: 14px;">加载中...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ==================== Tab 4: 版本与推送 ==================== -->
      <div id="tab-versions" class="tab-content d-none" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <div>
            <strong style="color: var(--text-strong); font-size: 17px; font-weight: 700;">🚀 版本发布与全网更新广播中心</strong>
            <div style="color: var(--text-mid); font-size: 13px; margin-top: 2px;">管理客户端升级规则、更新日志、强制升级及全网推送广播通知</div>
          </div>
          <div style="display: flex; gap: 12px;">
            <button onclick="openPushModal()" class="btn btn-secondary" style="color: #a855f7; border-color: rgba(168,85,247,0.3);">📢 发起全网广播推送</button>
            <button onclick="openVersionModal()" class="btn btn-primary">+ 发布新版本</button>
          </div>
        </div>

        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>版本号</th>
                <th>发布通道</th>
                <th>发布日期</th>
                <th>更新标题</th>
                <th>强更策略</th>
                <th>发布状态</th>
                <th style="text-align: right;">管理操作</th>
              </tr>
            </thead>
            <tbody id="versionTableBody">
              <tr><td colspan="7" style="text-align: center; color: var(--text-dim); padding: 32px; font-size: 14px;">加载中...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ==================== Tab 5: 密钥检索 ==================== -->
      <div id="tab-keys" class="tab-content d-none" style="display: none;">
        <div class="card" style="margin-bottom: 20px;">
          <strong style="color: var(--text-strong); font-size: 16px; margin-bottom: 10px; display: block;">🔑 28.8万+ DepotKey 密钥与 AccessToken 令牌检索器</strong>
          <div style="display: flex; gap: 12px;">
            <input type="text" id="keySearchInput" class="input-ctrl" style="height: 44px; font-size: 14.5px;" placeholder="输入 AppID 或 DepotID (例如: 1091500 赛博朋克2077, 271590 GTA5, 1245620 艾尔登法环)..." onkeydown="if(event.key==='Enter') searchKey()" />
            <button onclick="searchKey()" id="btnSearchKey" class="btn btn-primary" style="white-space: nowrap; padding: 10px 24px; font-size: 14.5px;">立即查询</button>
          </div>
        </div>

        <div id="keySearchResult" style="display: none;" class="card"></div>
      </div>

      <!-- ==================== Tab 6: 多源调度 ==================== -->
      <div id="tab-sources" class="tab-content d-none" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <div>
            <strong style="color: var(--text-strong); font-size: 17px; font-weight: 700;">🌐 多源数据管道与爬虫调度中心</strong>
            <div style="color: var(--text-mid); font-size: 13px; margin-top: 2px;">汇聚云端权威分发矩阵与高可用多节点备份链路</div>
          </div>
          <button onclick="triggerSyncAll()" class="btn btn-primary">🔄 一键全量多源同步</button>
        </div>

        <div id="sourcesGrid" class="grid-2"></div>
      </div>

      <!-- ==================== Tab 7: 安全配置 ==================== -->
      <div id="tab-security" class="tab-content d-none" style="display: none;">
        <div class="grid-2" style="margin-bottom: 24px;">
          <div class="card">
            <strong style="color: var(--text-strong); font-size: 15px; margin-bottom: 4px; display: block;">🔗 应用内跳转链接配置</strong>
            <div style="color: var(--text-dim); font-size: 12px; margin-bottom: 14px;">配置客户端「赞助支持」页面跳转地址（如爱发电/赞助主页）以及「功能详解与关于」界面的 QQ 交流反馈群、图文教程与常见问题跳转链接，保存后客户端即时生效</div>
            <div class="form-group">
              <label>💖 赞助支持页面链接 (Sponsor URL - 留空则不开启外部跳转，可填任意自定义主页/赞助平台)</label>
              <input type="text" id="cfgSponsorUrl" class="input-ctrl" placeholder="https://... (留空则不跳转任何第三方页面)" />
            </div>
            <div class="form-group">
              <label>💬 QQ 交流/反馈群链接 (QQ Group URL)</label>
              <input type="text" id="cfgQqGroupUrl" class="input-ctrl" placeholder="https://qm.qq.com/q/xxxxxx" />
            </div>
            <div class="form-group">
              <label>图文教程链接 (Tutorial URL)</label>
              <input type="text" id="cfgTutorialUrl" class="input-ctrl" placeholder="https://example.com/tutorial" />
            </div>
            <div class="form-group">
              <label>常见问题链接 (FAQ URL)</label>
              <input type="text" id="cfgFaqUrl" class="input-ctrl" placeholder="https://example.com/faq" />
            </div>
            <button type="button" id="btnSaveLinks" onclick="handleLinksSubmit()" class="btn btn-primary" style="width: 100%; justify-content: center;">保存跳转链接</button>
          </div>

          <div class="card">
            <strong style="color: var(--text-strong); font-size: 15px; margin-bottom: 4px; display: block;">🧮 未激活用户每日免费额度</strong>
            <div style="color: var(--text-dim); font-size: 12px; margin-bottom: 14px;">未激活设备每日可免费入库的不同游戏数（同一游戏当天重复获取不重复计数），保存后立即生效无需重启</div>
            <div class="form-group">
              <label>每日免费入库次数 (0 ~ 999)</label>
              <input type="number" id="cfgFreeDailyLimit" class="input-ctrl" min="0" max="999" value="2" />
            </div>
            <div id="quotaMsg" class="alert-box alert-success d-none" style="margin-bottom: 12px;"><span id="quotaMsgText"></span></div>
            <button type="button" id="btnSaveQuota" onclick="handleFreeQuotaSubmit()" class="btn btn-primary" style="width: 100%; justify-content: center;">保存并立即生效</button>
          </div>

          <div class="card">
            <strong style="color: var(--text-strong); font-size: 15px; margin-bottom: 4px; display: block;">⚡ 爱发电 (Afdian) 开发者 API 与赞助榜单同步</strong>
            <div style="color: var(--text-dim); font-size: 12px; margin-bottom: 14px;">配置爱发电开发者 User ID 与 API Token 后，支持自动从爱发电拉取最新赞助者名单并展示在客户端关于界面的赞助榜中</div>
            <div class="form-group">
              <label>爱发电开发者 User ID</label>
              <input type="text" id="cfgAfdianUserId" class="input-ctrl" placeholder="爱发电开发者后台 user_id" />
            </div>
            <div class="form-group">
              <label>爱发电开发者 API Token</label>
              <input type="password" id="cfgAfdianToken" class="input-ctrl" placeholder="爱发电开发者后台 token" />
            </div>
            <div class="form-group" style="display: flex; align-items: center; gap: 10px;">
              <input type="checkbox" id="cfgAfdianAutoSync" style="width: 16px; height: 16px;" checked />
              <label for="cfgAfdianAutoSync" style="margin: 0; color: var(--text-strong); cursor: pointer;">启用定时自动同步 (默认每 60 分钟)</label>
            </div>
            <div id="afdianMsg" class="alert-box alert-success d-none" style="margin-bottom: 12px;"><span id="afdianMsgText"></span></div>
            <div style="display: flex; gap: 12px;">
              <button type="button" id="btnSaveAfdian" onclick="handleAfdianConfigSubmit()" class="btn btn-primary" style="flex: 1; justify-content: center;">保存爱发电配置</button>
              <button type="button" id="btnSyncAfdian" onclick="handleAfdianSyncNow()" class="btn btn-secondary" style="justify-content: center;">🔄 立即从爱发电同步</button>
            </div>
          </div>
        </div>

        <div class="card" style="max-width: 540px; margin-bottom: 24px;">
          <strong style="color: var(--text-strong); font-size: 16px; margin-bottom: 14px; display: block;">⚙️ 修改管理员账号与安全密码</strong>
          <div id="pwdMsg" style="display: none; padding: 10px 14px; border-radius: 10px; font-size: 13px; margin-bottom: 14px;"></div>
          <div>
            <div class="form-group">
              <label>当前原密码 (Current Password)</label>
              <input type="password" id="curPass" class="input-ctrl" placeholder="请输入当前管理员密码" />
            </div>
            <div class="form-group">
              <label>新管理员用户名 (Username, 选填)</label>
              <input type="text" id="newUsername" class="input-ctrl" placeholder="留空则保持当前用户名" />
            </div>
            <div class="form-group">
              <label>新安全密码 (New Password)</label>
              <input type="password" id="newPass" class="input-ctrl" minlength="6" placeholder="请输入至少 6 位的新安全字符" />
            </div>
            <button type="button" id="btnChangePass" onclick="handleChangePassword()" class="btn btn-primary" style="width: 100%; justify-content: center; padding: 11px; font-size: 14.5px;">保存安全配置修改</button>
          </div>
        </div>

        <div class="card">
          <strong style="color: var(--text-strong); font-size: 16px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;">
            <span>🛡️ 安全审计操作日志 (最近 50 条)</span>
            <button onclick="loadAuditLogs()" class="btn btn-secondary btn-sm">🔄 刷新日志</button>
          </strong>
          <div class="table-container" style="max-height: 400px;">
            <table>
              <thead>
                <tr>
                  <th>操作时间</th>
                  <th>操作类型</th>
                  <th>操作账号</th>
                  <th>来源 IP</th>
                  <th>详情说明</th>
                  <th>执行状态</th>
                </tr>
              </thead>
              <tbody id="auditTableBody">
                <tr><td colspan="6" style="text-align: center; color: var(--text-dim); padding: 24px;">暂无审计日志</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

    </div>
  </div>

  <!-- ==================== 模态框 1: 发布/编辑公告 ==================== -->
  <div id="noticeModal" class="modal-overlay" style="display: none;">
    <div class="modal-box">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px;">
        <strong id="noticeModalTitle" style="color: var(--text-strong); font-size: 17px; font-weight: 700;">📢 发布系统公告</strong>
        <button type="button" onclick="closeModal('noticeModal')" class="btn btn-secondary btn-sm">✕</button>
      </div>
      <div>
        <input type="hidden" id="noticeId" />
        <div class="form-group">
          <label>公告标题 (Title)</label>
          <input type="text" id="noticeTitle" class="input-ctrl" placeholder="例如: 🎉 欢迎使用 SteamMaster 商业版！" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>展示形式 (Type)</label>
            <select id="noticeType" class="input-ctrl">
              <option value="popup">弹窗公告 (Popup Modal)</option>
              <option value="banner">顶部横幅 (Top Banner)</option>
            </select>
          </div>
          <div class="form-group">
            <label>提示级别 (Level)</label>
            <select id="noticeLevel" class="input-ctrl">
              <option value="info">信息 (Info - 蓝色)</option>
              <option value="success">成功 (Success - 绿色)</option>
              <option value="warning">警告 (Warning - 橙色)</option>
              <option value="danger">紧急 (Danger - 红色)</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>显示优先级 (数字越大越先弹出)</label>
            <input type="number" id="noticePriority" class="input-ctrl" value="50" />
          </div>
          <div class="form-group">
            <label>弹窗频率 (Popup Frequency)</label>
            <select id="noticePopupOnce" class="input-ctrl">
              <option value="false">每次启动都弹出</option>
              <option value="true">每个客户端仅弹一次</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>交互方式 (Interaction)</label>
            <select id="noticeInteraction" class="input-ctrl">
              <option value="confirm">普通通知 (仅"我知道了"按钮)</option>
              <option value="consent">强制确认 (同意/拒绝，拒绝退出程序)</option>
            </select>
          </div>
          <div class="form-group">
            <label>生效版本 (* 为全量所有版本)</label>
            <input type="text" id="noticeVersion" class="input-ctrl" value="*" />
          </div>
        </div>
        <div class="form-group">
          <label>公告详细内容 (Content)</label>
          <textarea id="noticeContent" class="input-ctrl" rows="5" placeholder="请输入公告详细正文内容..."></textarea>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
          <button type="button" onclick="closeModal('noticeModal')" class="btn btn-secondary">取消</button>
          <button type="button" onclick="handleNoticeSubmit()" class="btn btn-primary" style="padding: 10px 22px;">立即保存下发</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== 模态框 2: 发布新版本 ==================== -->
  <div id="versionModal" class="modal-overlay" style="display: none;">
    <div class="modal-box">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px;">
        <strong id="versionModalTitle" style="color: var(--text-strong); font-size: 17px; font-weight: 700;">🚀 发布新版本</strong>
        <button type="button" onclick="closeModal('versionModal')" class="btn btn-secondary btn-sm">✕</button>
      </div>
      <div>
        <div class="form-row">
          <div class="form-group">
            <label>版本号 (如 1.0.1)</label>
            <input type="text" id="verNumber" class="input-ctrl" placeholder="1.0.1" />
          </div>
          <div class="form-group">
            <label>发布日期</label>
            <input type="date" id="verDate" class="input-ctrl" />
          </div>
        </div>
        <div class="form-group">
          <label>版本标题</label>
          <input type="text" id="verTitle" class="input-ctrl" placeholder="春风渡 v1.0.1 正式发布" />
        </div>
        <div class="form-group">
          <label>官方下载地址</label>
          <input type="text" id="verUrl" class="input-ctrl" value="https://github.com/muyan6/steam/releases" />
        </div>
        <div class="form-group">
          <label>更新日志 (Changelog, 每行一条)</label>
          <textarea id="verChangelog" class="input-ctrl" rows="4" placeholder="🚀 优化游戏秒搜与入库引擎&#10;☁️ 新增云端管理控制台与公告推送"></textarea>
        </div>
        <div class="form-group" style="display: flex; align-items: center; gap: 10px;">
          <input type="checkbox" id="verForce" style="width: 16px; height: 16px;" />
          <label for="verForce" style="margin: 0; color: var(--c-rose); cursor: pointer;">标记为强制全量更新</label>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
          <button type="button" onclick="closeModal('versionModal')" class="btn btn-secondary">取消</button>
          <button type="button" onclick="handleVersionSubmit()" class="btn btn-primary" style="padding: 10px 22px;">立即发布上线</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== 模态框 3: 全网更新推送广播 ==================== -->
  <div id="pushModal" class="modal-overlay" style="display: none;">
    <div class="modal-box" style="max-width: 480px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px;">
        <strong style="color: var(--text-strong); font-size: 17px; font-weight: 700;">📢 全网版本更新推送广播</strong>
        <button type="button" onclick="closeModal('pushModal')" class="btn btn-secondary btn-sm">✕</button>
      </div>
      <div>
        <div class="form-group">
          <label>目标推送版本号</label>
          <input type="text" id="pushVersion" class="input-ctrl" placeholder="1.0.0" />
        </div>
        <div class="form-group">
          <label>推送消息标题</label>
          <input type="text" id="pushTitle" class="input-ctrl" placeholder="🚀 发现新版本更新！" />
        </div>
        <div class="form-group">
          <label>推送广播通知正文</label>
          <textarea id="pushContent" class="input-ctrl" rows="3" placeholder="全新版本现已发布，建议立即升级体验！"></textarea>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
          <button type="button" onclick="closeModal('pushModal')" class="btn btn-secondary">取消</button>
          <button type="button" onclick="handlePushSubmit()" class="btn btn-primary" style="padding: 10px 22px;">立即广播推送</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== 模态框 4: 客户端公告弹窗预览 ==================== -->
  <div id="previewModal" class="modal-overlay" style="display: none;">
    <div class="modal-box" style="max-width: 480px; border-color: rgba(56, 189, 248, 0.4);">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
        <div style="display: flex; align-items: center; gap: 12px;">
          <div style="width: 42px; height: 42px; border-radius: 12px; background: rgba(56, 189, 248, 0.15); color: var(--c-blue); display: flex; align-items: center; justify-content: center; font-size: 20px;">
            🔔
          </div>
          <div>
            <strong id="previewTitle" style="color: var(--text-strong); font-size: 16px; display: block;"></strong>
            <span style="color: var(--text-mid); font-size: 12px;">客户端弹窗实际展示效果预览</span>
          </div>
        </div>
        <button type="button" onclick="closeModal('previewModal')" class="btn btn-secondary btn-sm">✕</button>
      </div>
      <div id="previewContent" style="background: rgba(2, 6, 23, 0.85); border: 1px solid rgba(255,255,255,0.08); padding: 18px; border-radius: 14px; color: var(--text); font-size: 13.5px; white-space: pre-line; line-height: 1.7; margin-bottom: 20px;"></div>
      <div style="display: flex; justify-content: flex-end;">
        <button type="button" onclick="closeModal('previewModal')" class="btn btn-secondary" style="padding: 8px 18px;">关闭预览</button>
      </div>
    </div>
  </div>

  <!-- ==================== 模态框 5: 批量生成激活码 ==================== -->
  <div id="generateLicenseModal" class="modal-overlay" style="display: none;">
    <div class="modal-box" style="max-width: 520px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px;">
        <strong style="color: var(--text-strong); font-size: 17px; font-weight: 700;">⚡ 批量生成激活码 (设备绑定卡密)</strong>
        <button type="button" onclick="closeModal('generateLicenseModal')" class="btn btn-secondary btn-sm">✕</button>
      </div>
      <div>
        <div class="form-row">
          <div class="form-group">
            <label>卡密类型 (Card Type)</label>
            <select id="genLicType" class="input-ctrl">
              <option value="monthly">月卡会员 (30天)</option>
              <option value="quarterly">季卡会员 (90天)</option>
              <option value="yearly">年卡会员 (365天)</option>
              <option value="lifetime" selected>永久尊享卡 (终身有效)</option>
            </select>
          </div>
          <div class="form-group">
            <label>生成数量 (Count, 1~500)</label>
            <input type="number" id="genLicCount" class="input-ctrl" value="10" min="1" max="500" />
          </div>
        </div>

        <div class="form-group">
          <label>自定义卡密前缀 (Prefix, 选填)</label>
          <input type="text" id="genLicPrefix" class="input-ctrl" placeholder="默认如 CFD-L / CFD-M / CFD-Y" />
        </div>

        <div class="form-group">
          <label>生成批次备注 / 渠道用途 (Remark, 选填)</label>
          <input type="text" id="genLicRemark" class="input-ctrl" placeholder="例如: 9月促销活动 / 渠道批量发放#20260904" />
        </div>

        <div id="genLicNotice" class="alert-box alert-success d-none" style="margin-top: 12px;">
          <span id="genLicNoticeText">生成成功</span>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
          <button type="button" onclick="closeModal('generateLicenseModal')" class="btn btn-secondary">取消</button>
          <button type="button" id="btnDoGenLicense" onclick="handleGenerateLicenseSubmit()" class="btn btn-primary" style="padding: 10px 22px;">立即批量生成</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== 模态框 6: 卡密有效期延期 ==================== -->
  <div id="extendLicenseModal" class="modal-overlay" style="display: none;">
    <div class="modal-box" style="max-width: 440px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 12px;">
        <strong style="color: var(--text-strong); font-size: 17px; font-weight: 700;">⏱️ 延长卡密有效期</strong>
        <button type="button" onclick="closeModal('extendLicenseModal')" class="btn btn-secondary btn-sm">✕</button>
      </div>
      <div>
        <div class="form-group">
          <label>目标激活码</label>
          <input type="text" id="extLicCode" class="input-ctrl" readonly style="opacity: 0.85; font-family: 'JetBrains Mono', Consolas, monospace; font-size: 13.5px;" />
        </div>
        <div class="form-group">
          <label>延长有效天数 (Days)</label>
          <input type="number" id="extLicDays" class="input-ctrl" value="30" min="1" max="3650" />
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px;">
          <button type="button" onclick="closeModal('extendLicenseModal')" class="btn btn-secondary">取消</button>
          <button type="button" onclick="handleExtendLicenseSubmit()" class="btn btn-primary" style="padding: 10px 22px;">确认延期</button>
        </div>
      </div>
    </div>
  </div>

  <!-- 管理控制台 JS (原生内联嵌入 + 独立路由双重保障, 零外部依赖) -->
  <script>
${ADMIN_JS}
  </script>
</body>
</html>`;

app.get(['/admin', '/dashboard'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(ADMIN_HTML);
});

// 404 处理：不回显请求路径，避免反射请求内容
app.use((req, res) => {
  res.status(404).json({ success: false, message: '接口不存在' });
});

// 全局异常捕获：区分客户端请求错误（JSON 解析失败 400 / 载荷过大 413）与真实服务端错误
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const status = typeof err?.status === 'number' ? err.status : 500;
  if (status >= 400 && status < 500) {
    console.warn('[Request Error]', status, err?.type || err?.message);
    return res.status(status).json({ success: false, message: status === 413 ? '请求内容过大' : '请求格式错误' });
  }
  console.error('[Unhandled Error]', err);
  res.status(500).json({ success: false, message: '服务器内部错误' });
});

// 进程级异常保护：异常后进程状态不可信（大量同步写 JSON 可能已半途而废），
// 记录后立即退出交由 PM2 重启，避免以脏内存状态覆盖磁盘数据文件
process.on('uncaughtException', (err) => {
  console.error('[UncaughtException] 进程即将退出:', err);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[UnhandledRejection] 进程即将退出:', reason);
  process.exit(1);
});

const server = app.listen(CONFIG.PORT, CONFIG.HOST, () => {
  console.log(`
======================================================
🚀 春风渡 云端后端已成功启动！
🌐 前台宣传下载页: http://${CONFIG.HOST}:${CONFIG.PORT}
💻 Web 管控控制台: http://${CONFIG.HOST}:${CONFIG.PORT}/admin
📊 健康检查: http://localhost:${CONFIG.PORT}/api/health
======================================================
  `);

  // 启动定时自动同步引擎（Token 数据库已由 tokenService 构造函数加载，无需重复加载）
  syncService.startScheduledDailySync();
  // 启动 SteamDB / Steam 双榜热门游戏联机规则同步引擎
  onlineRulesSyncService.startScheduledSync();
});

// 端口占用等启动错误给出友好提示
server.on('error', (err: any) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[启动失败] 端口 ${CONFIG.PORT} 已被占用，请更换 PORT 环境变量或释放端口后重试`);
  } else {
    console.error('[启动失败]', err);
  }
  process.exit(1);
});
