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

// 后端管理控制台 (100% 独立内联、零外部 CDN 依赖、秒开原生 SPA)
app.get(['/', '/dashboard'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SteamMaster 商业版 · 云端管控控制台</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background-color: #0b0f19; color: #cbd5e1; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; font-size: 13px; line-height: 1.5; min-height: 100vh; }
    a { color: #38bdf8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    button { cursor: pointer; font-family: inherit; }
    input, select, textarea { font-family: inherit; font-size: 13px; }

    /* 布局与组件样式 */
    .app-header { background: rgba(15, 23, 42, 0.9); backdrop-filter: blur(12px); border-bottom: 1px solid rgba(255, 255, 255, 0.08); padding: 12px 24px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 30; flex-wrap: wrap; gap: 12px; }
    .nav-tabs { display: flex; background: rgba(2, 6, 23, 0.7); padding: 4px; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.06); gap: 4px; }
    .tab-btn { background: transparent; border: none; color: #94a3b8; padding: 6px 14px; border-radius: 8px; font-weight: 600; font-size: 12px; transition: all 0.2s; display: flex; align-items: center; gap: 6px; }
    .tab-btn:hover { color: #f8fafc; background: rgba(255, 255, 255, 0.05); }
    .tab-btn.active { background: #0284c7; color: #ffffff; box-shadow: 0 2px 8px rgba(2, 132, 199, 0.3); }

    .main-container { max-width: 1200px; margin: 0 auto; padding: 24px 16px; }
    .card { background: rgba(15, 23, 42, 0.75); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; padding: 20px; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25); }
    .grid-4 { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
    .grid-2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
    
    .kpi-title { font-size: 11px; color: #94a3b8; font-weight: 500; display: flex; justify-content: space-between; align-items: center; }
    .kpi-val { font-size: 24px; font-weight: 800; font-family: monospace; margin: 8px 0 4px 0; }
    .kpi-sub { font-size: 11px; color: #64748b; }

    /* 表格 */
    .table-container { overflow-x: auto; border-radius: 12px; border: 1px solid rgba(255, 255, 255, 0.08); background: rgba(2, 6, 23, 0.4); }
    table { width: 100%; border-collapse: collapse; text-align: left; }
    th { background: rgba(15, 23, 42, 0.9); padding: 12px 14px; font-size: 11px; font-weight: 600; color: #94a3b8; border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
    td { padding: 12px 14px; border-bottom: 1px solid rgba(255, 255, 255, 0.04); }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }

    /* 按钮与输入 */
    .btn { padding: 8px 16px; border-radius: 10px; font-weight: 600; border: none; transition: all 0.2s; display: inline-flex; align-items: center; gap: 6px; }
    .btn-primary { background: linear-gradient(135deg, #0284c7, #0d9488); color: #fff; box-shadow: 0 2px 10px rgba(2, 132, 199, 0.3); }
    .btn-primary:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn-secondary { background: #1e293b; color: #cbd5e1; border: 1px solid #334155; }
    .btn-secondary:hover { background: #334155; color: #fff; }
    .btn-danger { background: rgba(225, 29, 72, 0.15); color: #fb7185; border: 1px solid rgba(225, 29, 72, 0.3); }
    .btn-danger:hover { background: rgba(225, 29, 72, 0.25); }
    .btn-sm { padding: 4px 10px; font-size: 11px; border-radius: 6px; }

    .input-ctrl { width: 100%; background: rgba(2, 6, 23, 0.6); border: 1px solid rgba(255, 255, 255, 0.15); padding: 8px 12px; border-radius: 10px; color: #fff; outline: none; transition: border-color 0.2s; }
    .input-ctrl:focus { border-color: #38bdf8; box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.2); }

    /* 徽章与提示条 */
    .badge { display: inline-block; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 700; font-family: monospace; }
    .badge-green { background: rgba(16, 185, 129, 0.15); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.3); }
    .badge-blue { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }
    .badge-amber { background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); }
    .badge-rose { background: rgba(244, 63, 94, 0.15); color: #fb7185; border: 1px solid rgba(244, 63, 94, 0.3); }
    .badge-gray { background: rgba(100, 116, 139, 0.2); color: #94a3b8; border: 1px solid rgba(100, 116, 139, 0.3); }

    .alert-box { padding: 10px 14px; border-radius: 10px; font-size: 12px; line-height: 1.5; margin-bottom: 14px; text-align: left; display: flex; align-items: start; gap: 8px; }
    .alert-error { background: rgba(225, 29, 72, 0.2); border: 1px solid rgba(225, 29, 72, 0.5); color: #fda4af; }
    .alert-success { background: rgba(16, 185, 129, 0.2); border: 1px solid rgba(16, 185, 129, 0.5); color: #6ee7b7; }
    .alert-info { background: rgba(56, 189, 248, 0.2); border: 1px solid rgba(56, 189, 248, 0.5); color: #7dd3fc; }

    /* 模态框 */
    .modal-overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 16px; }
    .modal-box { background: #0f172a; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 20px; width: 100%; max-width: 600px; padding: 24px; max-height: 90vh; overflow-y: auto; box-shadow: 0 10px 40px rgba(0,0,0,0.6); }

    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; font-size: 11px; font-weight: 600; color: #94a3b8; margin-bottom: 6px; }
    .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

    /* 隐藏类 */
    .d-none { display: none !important; }

    /* 抖动动画 */
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-6px); }
      40%, 80% { transform: translateX(6px); }
    }
    .shake { animation: shake 0.4s ease-in-out; }
  </style>
</head>
<body>

  <!-- ==================== 1. 管理员登录界面 ==================== -->
  <div id="loginSection" class="modal-overlay" style="display: flex;">
    <div class="modal-box" id="loginBox" style="max-width: 420px; text-align: center;">
      <div style="width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, #0284c7, #10b981); margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 24px; color: #fff;">
        ⚡
      </div>
      <h1 style="font-size: 18px; font-weight: 800; color: #fff; margin-bottom: 4px;">SteamMaster 商业版</h1>
      <p style="font-size: 12px; color: #94a3b8; margin-bottom: 20px;">云端数据引擎与安全管控中枢</p>

      <!-- 登录状态/错误提示框 -->
      <div id="loginNotice" class="alert-box alert-error d-none">
        <span id="loginNoticeIcon">⚠️</span>
        <span id="loginNoticeText">账号或密码错误</span>
      </div>

      <div id="loginFormContainer">
        <div class="form-group" style="text-align: left;">
          <label>管理员账号 (Username)</label>
          <input type="text" id="loginUser" class="input-ctrl" value="admin" placeholder="请输入管理员账号 (默认: admin)" autocomplete="username" onkeydown="if(event.key==='Enter') handleLoginSubmit();" />
        </div>

        <div class="form-group" style="text-align: left;">
          <label>管理员密码 (Password)</label>
          <input type="password" id="loginPass" class="input-ctrl" placeholder="请输入管理员密码 (默认: admin123)" autocomplete="current-password" onkeydown="if(event.key==='Enter') handleLoginSubmit();" />
        </div>

        <button type="button" id="loginBtn" onclick="handleLoginSubmit()" class="btn btn-primary" style="width: 100%; justify-content: center; padding: 11px; margin-top: 8px; font-size: 14px;">
          <span>安全登录控制台</span>
        </button>
      </div>

      <div style="margin-top: 20px; padding-top: 14px; border-top: 1px solid rgba(255,255,255,0.06); font-size: 11px; color: #64748b; line-height: 1.6;">
        <div>默认账号: <code style="color: #38bdf8; font-weight: bold;">admin</code> · 默认密码: <code style="color: #38bdf8; font-weight: bold;">admin123</code></div>
        <div style="color: #475569; margin-top: 2px;">或使用超级主密钥: <code style="color: #94a3b8;">steammaster_admin_8888</code></div>
      </div>
    </div>
  </div>

  <!-- ==================== 2. 控制台主界面 ==================== -->
  <div id="dashboardSection" class="d-none" style="display: none;">
    <header class="app-header">
      <div style="display: flex; align-items: center; gap: 12px;">
        <div style="width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #0284c7, #10b981); display: flex; align-items: center; justify-content: center; font-size: 18px; color: #fff;">
          ⚡
        </div>
        <div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <strong style="color: #fff; font-size: 14px;">SteamMaster 商业版</strong>
            <span class="badge badge-green">● 云端运行中</span>
          </div>
          <div style="font-size: 11px; color: #64748b;">28.8万+ DepotKey 调度中枢 · 公告与版本推送管控平台</div>
        </div>
      </div>

      <!-- 选项卡切换导航 -->
      <div class="nav-tabs">
        <button class="tab-btn active" onclick="switchTab('overview', this)">📊 系统大盘</button>
        <button class="tab-btn" onclick="switchTab('notices', this)">📢 公告中心</button>
        <button class="tab-btn" onclick="switchTab('versions', this)">🚀 版本与推送</button>
        <button class="tab-btn" onclick="switchTab('keys', this)">🔑 密钥检索</button>
        <button class="tab-btn" onclick="switchTab('sources', this)">🌐 多源调度</button>
        <button class="tab-btn" onclick="switchTab('security', this)">⚙️ 安全配置</button>
      </div>

      <!-- 用户信息与退出 -->
      <div style="display: flex; align-items: center; gap: 10px;">
        <div style="background: rgba(2,6,23,0.6); padding: 4px 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.08); font-size: 11px;">
          👤 <strong id="adminUsername" style="color: #38bdf8;">admin</strong> <span class="badge badge-blue">超级管理员</span>
        </div>
        <button onclick="handleLogout()" class="btn btn-secondary btn-sm" style="color: #fb7185;">退出</button>
      </div>
    </header>

    <div class="main-container">

      <!-- ==================== Tab 1: 系统大盘 ==================== -->
      <div id="tab-overview" class="tab-content">
        <div class="grid-4" style="margin-bottom: 20px;">
          <div class="card">
            <div class="kpi-title"><span>持久化 DepotKey 总量</span> <span>🔑</span></div>
            <div class="kpi-val" id="kpiKeys" style="color: #34d399;">...</div>
            <div class="kpi-sub">含苏大猫与全球历史密钥库</div>
          </div>
          <div class="card">
            <div class="kpi-title"><span>PICS AccessToken 令牌</span> <span>🎫</span></div>
            <div class="kpi-val" id="kpiTokens" style="color: #38bdf8;">...</div>
            <div class="kpi-sub">苏大猫 993499094 实时同步</div>
          </div>
          <div class="card">
            <div class="kpi-title"><span>全量游戏索引数据库</span> <span>🎮</span></div>
            <div class="kpi-val" id="kpiGames" style="color: #c084fc;">...</div>
            <div class="kpi-sub">支持毫秒级中文拼音秒搜</div>
          </div>
          <div class="card">
            <div class="kpi-title"><span>服务运行时间与内存</span> <span>⚡</span></div>
            <div class="kpi-val" id="kpiUptime" style="color: #fbbf24;">...</div>
            <div class="kpi-sub" id="kpiMem">Node: ...</div>
          </div>
        </div>

        <div class="card" style="margin-bottom: 20px;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <strong style="color: #fff; font-size: 14px;">⚡ 快捷调度与控制中枢</strong>
            <span style="color: #64748b; font-size: 11px;">24小时自动轮询引擎</span>
          </div>
          <div style="display: flex; gap: 12px; flex-wrap: wrap;">
            <button onclick="triggerSyncAll()" id="btnSyncAll" class="btn btn-primary">
              <span>🔄 立即触发全量多源聚合同步</span>
            </button>
            <button onclick="openNoticeModal()" class="btn btn-secondary">
              <span>📢 发布新系统公告</span>
            </button>
            <button onclick="openVersionModal()" class="btn btn-secondary">
              <span>🚀 发布新版本 & 强更</span>
            </button>
          </div>
        </div>
      </div>

      <!-- ==================== Tab 2: 公告中心 ==================== -->
      <div id="tab-notices" class="tab-content d-none" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div>
            <strong style="color: #fff; font-size: 15px;">📢 公告发布与调度管理</strong>
            <div style="color: #64748b; font-size: 11px;">支持弹窗公告、顶部横幅、按版本定向下发与一键启停</div>
          </div>
          <button onclick="openNoticeModal()" class="btn btn-primary btn-sm">+ 发布新公告</button>
        </div>

        <div class="table-container">
          <table>
            <thead>
              <tr>
                <th>状态</th>
                <th>标题</th>
                <th>展示类型</th>
                <th>级别</th>
                <th>优先级</th>
                <th>生效版本</th>
                <th>更新时间</th>
                <th style="text-align: right;">操作</th>
              </tr>
            </thead>
            <tbody id="noticeTableBody">
              <tr><td colspan="8" style="text-align: center; color: #64748b; padding: 24px;">加载中...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ==================== Tab 3: 版本与推送 ==================== -->
      <div id="tab-versions" class="tab-content d-none" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div>
            <strong style="color: #fff; font-size: 15px;">🚀 版本发布与更新推送中心</strong>
            <div style="color: #64748b; font-size: 11px;">管理客户端升级规则、更新日志、强制升级及全网推送通知广播</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button onclick="openPushModal()" class="btn btn-secondary btn-sm" style="color: #a855f7;">📢 发起全网更新推送</button>
            <button onclick="openVersionModal()" class="btn btn-primary btn-sm">+ 发布新版本</button>
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
                <th>强更</th>
                <th>状态</th>
                <th style="text-align: right;">操作</th>
              </tr>
            </thead>
            <tbody id="versionTableBody">
              <tr><td colspan="7" style="text-align: center; color: #64748b; padding: 24px;">加载中...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- ==================== Tab 4: 密钥检索 ==================== -->
      <div id="tab-keys" class="tab-content d-none" style="display: none;">
        <div class="card" style="margin-bottom: 16px;">
          <strong style="color: #fff; font-size: 14px; margin-bottom: 8px; display: block;">🔑 28.8万+ DepotKey 密钥与 Token 检索器</strong>
          <div style="display: flex; gap: 10px;">
            <input type="text" id="keySearchInput" class="input-ctrl" placeholder="输入 AppID 或 DepotID (例如: 1091500 赛博朋克2077, 271590 GTA5, 1245620 艾尔登法环)" onkeydown="if(event.key==='Enter') searchKey()" />
            <button onclick="searchKey()" id="btnSearchKey" class="btn btn-primary" style="white-space: nowrap;">查询</button>
          </div>
        </div>

        <div id="keySearchResult" style="display: none;" class="card"></div>
      </div>

      <!-- ==================== Tab 5: 多源调度 ==================== -->
      <div id="tab-sources" class="tab-content d-none" style="display: none;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
          <div>
            <strong style="color: #fff; font-size: 15px;">🌐 多源数据管道与爬虫调度中心</strong>
            <div style="color: #64748b; font-size: 11px;">汇聚苏大猫实时分发源、ManifestHub 历史库与官方 SteamPipe CDN</div>
          </div>
          <button onclick="triggerSyncAll()" class="btn btn-primary btn-sm">🔄 一键全量多源同步</button>
        </div>

        <div id="sourcesGrid" class="grid-2"></div>
      </div>

      <!-- ==================== Tab 6: 安全配置 ==================== -->
      <div id="tab-security" class="tab-content d-none" style="display: none;">
        <div class="card" style="max-width: 500px; margin-bottom: 20px;">
          <strong style="color: #fff; font-size: 14px; margin-bottom: 12px; display: block;">⚙️ 修改管理员账号与密码</strong>
          <div id="pwdMsg" style="display: none; padding: 8px 12px; border-radius: 8px; font-size: 11px; margin-bottom: 12px;"></div>
          <div>
            <div class="form-group">
              <label>原密码 (Current Password)</label>
              <input type="password" id="curPass" class="input-ctrl" placeholder="请输入当前管理员密码" />
            </div>
            <div class="form-group">
              <label>新管理员用户名 (Username)</label>
              <input type="text" id="newUsername" class="input-ctrl" placeholder="留空则保持当前用户名" />
            </div>
            <div class="form-group">
              <label>新安全密码 (New Password)</label>
              <input type="password" id="newPass" class="input-ctrl" minlength="6" placeholder="至少 6 位安全字符" />
            </div>
            <button type="button" id="btnChangePass" onclick="handleChangePassword()" class="btn btn-primary" style="width: 100%; justify-content: center;">保存修改</button>
          </div>
        </div>

        <div class="card">
          <strong style="color: #fff; font-size: 14px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
            <span>🛡️ 安全审计操作日志 (最近 50 条)</span>
            <button onclick="loadAuditLogs()" class="btn btn-secondary btn-sm">刷新日志</button>
          </strong>
          <div class="table-container" style="max-height: 350px;">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作类型</th>
                  <th>操作人</th>
                  <th>IP</th>
                  <th>详情说明</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody id="auditTableBody">
                <tr><td colspan="6" style="text-align: center; color: #64748b;">暂无审计日志</td></tr>
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
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 10px;">
        <strong id="noticeModalTitle" style="color: #fff; font-size: 14px;">发布系统公告</strong>
        <button type="button" onclick="closeModal('noticeModal')" class="btn btn-secondary btn-sm">✕</button>
      </div>
      <div>
        <input type="hidden" id="noticeId" />
        <div class="form-group">
          <label>公告标题 (Title)</label>
          <input type="text" id="noticeTitle" class="input-ctrl" placeholder="例如: 🎉 欢迎使用 SteamMaster！" />
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
              <option value="info">信息 (Info)</option>
              <option value="success">成功 (Success)</option>
              <option value="warning">警告 (Warning)</option>
              <option value="danger">紧急 (Danger)</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>显示优先级 (数字越大越置顶)</label>
            <input type="number" id="noticePriority" class="input-ctrl" value="50" />
          </div>
          <div class="form-group">
            <label>生效版本 (* 为全量)</label>
            <input type="text" id="noticeVersion" class="input-ctrl" value="*" />
          </div>
        </div>
        <div class="form-group">
          <label>公告详细内容 (Content)</label>
          <textarea id="noticeContent" class="input-ctrl" rows="4" placeholder="请输入公告正文..."></textarea>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;">
          <button type="button" onclick="closeModal('noticeModal')" class="btn btn-secondary">取消</button>
          <button type="button" onclick="handleNoticeSubmit()" class="btn btn-primary">保存下发</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== 模态框 2: 发布新版本 ==================== -->
  <div id="versionModal" class="modal-overlay" style="display: none;">
    <div class="modal-box">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 10px;">
        <strong id="versionModalTitle" style="color: #fff; font-size: 14px;">发布新版本</strong>
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
          <input type="text" id="verTitle" class="input-ctrl" placeholder="SteamMaster 商业版 v1.0.1 正式发布" />
        </div>
        <div class="form-group">
          <label>官方下载地址</label>
          <input type="text" id="verUrl" class="input-ctrl" value="https://gitee.com/muyan6/steam/releases" />
        </div>
        <div class="form-group">
          <label>更新日志 (Changelog, 每行一条)</label>
          <textarea id="verChangelog" class="input-ctrl" rows="4" placeholder="🚀 优化游戏秒搜与入库引擎&#10;☁️ 新增云端管理控制台与公告推送"></textarea>
        </div>
        <div class="form-group" style="display: flex; align-items: center; gap: 8px;">
          <input type="checkbox" id="verForce" />
          <label for="verForce" style="margin: 0; color: #fb7185;">标记为强制全量更新</label>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;">
          <button type="button" onclick="closeModal('versionModal')" class="btn btn-secondary">取消</button>
          <button type="button" onclick="handleVersionSubmit()" class="btn btn-primary">立即发布上线</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== 模态框 3: 全网更新推送广播 ==================== -->
  <div id="pushModal" class="modal-overlay" style="display: none;">
    <div class="modal-box" style="max-width: 450px;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; border-bottom: 1px solid rgba(255,255,255,0.08); padding-bottom: 10px;">
        <strong style="color: #fff; font-size: 14px;">📢 全网版本更新推送广播</strong>
        <button type="button" onclick="closeModal('pushModal')" class="btn btn-secondary btn-sm">✕</button>
      </div>
      <div>
        <div class="form-group">
          <label>目标推送版本</label>
          <input type="text" id="pushVersion" class="input-ctrl" placeholder="1.0.0" />
        </div>
        <div class="form-group">
          <label>推送标题</label>
          <input type="text" id="pushTitle" class="input-ctrl" placeholder="🚀 发现新版本更新！" />
        </div>
        <div class="form-group">
          <label>推送广播内容</label>
          <textarea id="pushContent" class="input-ctrl" rows="3" placeholder="全新版本现已发布，建议立即升级体验！"></textarea>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px;">
          <button type="button" onclick="closeModal('pushModal')" class="btn btn-secondary">取消</button>
          <button type="button" onclick="handlePushSubmit()" class="btn btn-primary">立即广播推送</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ==================== 模态框 4: 客户端公告弹窗预览 ==================== -->
  <div id="previewModal" class="modal-overlay" style="display: none;">
    <div class="modal-box" style="max-width: 440px; border-color: rgba(56, 189, 248, 0.4);">
      <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 14px;">
        <div style="width: 38px; height: 38px; border-radius: 12px; background: rgba(56, 189, 248, 0.15); color: #38bdf8; display: flex; align-items: center; justify-content: center; font-size: 18px;">
          🔔
        </div>
        <div>
          <strong id="previewTitle" style="color: #fff; font-size: 14px; display: block;"></strong>
          <span style="color: #64748b; font-size: 11px;">客户端弹窗实际展示效果</span>
        </div>
      </div>
      <div id="previewContent" style="background: rgba(2, 6, 23, 0.8); border: 1px solid rgba(255,255,255,0.06); padding: 14px; border-radius: 12px; color: #cbd5e1; font-size: 12px; white-space: pre-line; line-height: 1.6; margin-bottom: 16px;"></div>
      <div style="text-align: right;">
        <button type="button" onclick="closeModal('previewModal')" class="btn btn-primary btn-sm">我知道了 (关闭预览)</button>
      </div>
    </div>
  </div>

  <!-- ==================== 纯原生 JavaScript 逻辑 (0 外部依赖) ==================== -->
  <script>
    var authToken = localStorage.getItem('steammaster_admin_token') || '';
    var noticesCache = [];
    var versionsCache = [];

    function getHeaders() {
      var t = authToken || localStorage.getItem('steammaster_admin_token') || '';
      return {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + t,
        'x-admin-token': t,
        'x-admin-key': 'steammaster_admin_8888'
      };
    }

    function showNotice(type, text) {
      var box = document.getElementById('loginNotice');
      var icon = document.getElementById('loginNoticeIcon');
      var txt = document.getElementById('loginNoticeText');
      if (!box || !icon || !txt) return;
      box.className = 'alert-box ' + (type === 'error' ? 'alert-error' : type === 'success' ? 'alert-success' : 'alert-info');
      icon.innerText = type === 'error' ? '⚠️' : type === 'success' ? '✅' : 'ℹ️';
      txt.innerText = text;
      box.classList.remove('d-none');
      box.style.cssText = 'display: flex !important;';
      if (type === 'error') {
        var loginBox = document.getElementById('loginBox');
        if (loginBox) {
          loginBox.classList.remove('shake');
          void loginBox.offsetWidth; // 触发重绘
          loginBox.classList.add('shake');
        }
      }
    }

    function hideNotice() {
      var box = document.getElementById('loginNotice');
      if (box) {
        box.classList.add('d-none');
        box.style.cssText = 'display: none !important;';
      }
    }

    // 检查登录状态
    function checkAuth() {
      var t = authToken || localStorage.getItem('steammaster_admin_token') || '';
      var loginSec = document.getElementById('loginSection');
      var dashSec = document.getElementById('dashboardSection');

      if (t) {
        authToken = t;
        if (loginSec) {
          loginSec.classList.add('d-none');
          loginSec.style.cssText = 'display: none !important;';
        }
        if (dashSec) {
          dashSec.classList.remove('d-none');
          dashSec.style.cssText = 'display: block !important;';
        }
        loadAllData();
      } else {
        if (loginSec) {
          loginSec.classList.remove('d-none');
          loginSec.style.cssText = 'display: flex !important;';
        }
        if (dashSec) {
          dashSec.classList.add('d-none');
          dashSec.style.cssText = 'display: none !important;';
        }
      }
    }

    async function handleLoginSubmit() {
      var userEl = document.getElementById('loginUser');
      var passEl = document.getElementById('loginPass');
      var user = (userEl ? userEl.value : '').trim();
      var pass = (passEl ? passEl.value : '').trim();
      var btn = document.getElementById('loginBtn');

      if (!user || !pass) {
        showNotice('error', '请输入管理员账号与密码');
        return;
      }

      showNotice('info', '正在校验凭据并连接云端控制台...');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ 正在验证凭据...</span>';
      }

      try {
        var resp = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: user, password: pass })
        });
        
        var data;
        try {
          data = await resp.json();
        } catch (jsonErr) {
          throw new Error('服务器返回非标准响应 (HTTP ' + resp.status + ')');
        }

        if (resp.ok && data && data.success && data.token) {
          showNotice('success', '登录成功！正在进入管控大盘...');
          authToken = data.token;
          localStorage.setItem('steammaster_admin_token', authToken);
          var adminEl = document.getElementById('adminUsername');
          if (adminEl) adminEl.innerText = (data.user && data.user.username) ? data.user.username : user;
          
          var loginSec = document.getElementById('loginSection');
          var dashSec = document.getElementById('dashboardSection');
          if (loginSec) {
            loginSec.classList.add('d-none');
            loginSec.style.cssText = 'display: none !important;';
          }
          if (dashSec) {
            dashSec.classList.remove('d-none');
            dashSec.style.cssText = 'display: block !important;';
          }
          
          loadAllData();
        } else {
          showNotice('error', (data && data.message) ? data.message : '账号或密码错误 (默认密码: admin123 或主密钥 steammaster_admin_8888)');
        }
      } catch (err) {
        showNotice('error', '连接服务器失败: ' + err.message + ' (请确认后端服务已启动并在 1257 端口运行)');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<span>安全登录控制台</span>';
        }
      }
    }

    function handleLogout() {
      authToken = '';
      localStorage.removeItem('steammaster_admin_token');
      checkAuth();
    }

    function switchTab(tabId, el) {
      document.querySelectorAll('.tab-btn').forEach(function(btn) { btn.classList.remove('active'); });
      document.querySelectorAll('.tab-content').forEach(function(c) {
        c.classList.add('d-none');
        c.style.cssText = 'display: none !important;';
      });

      if (el) {
        el.classList.add('active');
      } else {
        var found = document.querySelector('.tab-btn[onclick*="' + tabId + '"]');
        if (found) found.classList.add('active');
      }

      var target = document.getElementById('tab-' + tabId);
      if (target) {
        target.classList.remove('d-none');
        target.style.cssText = 'display: block !important;';
      }

      if (tabId === 'notices') loadNotices();
      if (tabId === 'versions') loadVersions();
      if (tabId === 'sources') loadSources();
      if (tabId === 'security') loadAuditLogs();
    }

    async function loadStats() {
      try {
        var resp = await fetch('/api/admin/stats', { headers: getHeaders() });
        var res = await resp.json();
        if (res && res.success) {
          var d = res.data;
          var kKeys = document.getElementById('kpiKeys');
          var kTokens = document.getElementById('kpiTokens');
          var kGames = document.getElementById('kpiGames');
          var kUptime = document.getElementById('kpiUptime');
          var kMem = document.getElementById('kpiMem');

          if (kKeys) kKeys.innerText = (d.depotKeysCount || 0).toLocaleString() + ' 条';
          if (kTokens) kTokens.innerText = (d.tokensCount || 0).toLocaleString() + ' 款';
          if (kGames) kGames.innerText = (d.gamesCount || 0).toLocaleString() + ' 款';
          
          var uptime = d.uptimeSeconds || 0;
          var h = Math.floor(uptime / 3600);
          var m = Math.floor((uptime % 3600) / 60);
          if (kUptime) kUptime.innerText = h + 'h ' + m + 'm';
          if (kMem) kMem.innerText = '内存: ' + (d.memoryUsageMb || 0) + ' MB · ' + (d.nodeVersion || '');
        }
      } catch (e) {
        console.warn('加载统计失败:', e);
      }
    }

    async function loadNotices() {
      try {
        var resp = await fetch('/api/admin/notices', { headers: getHeaders() });
        var res = await resp.json();
        var tbody = document.getElementById('noticeTableBody');
        if (res && res.success && tbody) {
          noticesCache = res.data || [];
          if (noticesCache.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align: center; color: #64748b; padding: 24px;">暂无公告记录</td></tr>';
            return;
          }
          tbody.innerHTML = noticesCache.map(function(n) {
            return '<tr>' +
              '<td><span class="badge ' + (n.enabled ? 'badge-green' : 'badge-gray') + '">' + (n.enabled ? '● 启用中' : '○ 已停用') + '</span></td>' +
              '<td><strong style="color: #fff;">' + escapeHtml(n.title) + '</strong></td>' +
              '<td><span class="badge badge-blue">' + (n.type === 'popup' ? '弹窗 Modal' : '横幅 Banner') + '</span></td>' +
              '<td><span class="badge badge-amber">' + (n.level || 'info') + '</span></td>' +
              '<td><strong>' + (n.priority || 0) + '</strong></td>' +
              '<td style="font-family: monospace;">' + (n.targetVersion || '*') + '</td>' +
              '<td style="color: #64748b; font-size: 11px;">' + formatTime(n.updatedAt) + '</td>' +
              '<td style="text-align: right;">' +
                '<button onclick="previewNotice(\'' + n.id + '\')" class="btn btn-secondary btn-sm" style="color: #38bdf8;">预览</button> ' +
                '<button onclick="toggleNotice(\'' + n.id + '\', ' + (!n.enabled) + ')" class="btn btn-secondary btn-sm">' + (n.enabled ? '停用' : '启用') + '</button> ' +
                '<button onclick="deleteNotice(\'' + n.id + '\')" class="btn btn-danger btn-sm">删除</button>' +
              '</td>' +
            '</tr>';
          }).join('');
        }
      } catch (e) {
        console.warn('加载公告失败:', e);
      }
    }

    async function loadVersions() {
      try {
        var resp = await fetch('/api/admin/versions', { headers: getHeaders() });
        var res = await resp.json();
        var tbody = document.getElementById('versionTableBody');
        if (res && res.success && tbody) {
          versionsCache = res.data || [];
          if (versionsCache.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #64748b; padding: 24px;">暂无版本发布记录</td></tr>';
            return;
          }
          tbody.innerHTML = versionsCache.map(function(v) {
            return '<tr>' +
              '<td style="font-family: monospace; font-weight: 800; color: #fff;">v' + v.version + '</td>' +
              '<td><span class="badge badge-blue">' + (v.channel || 'stable') + '</span></td>' +
              '<td style="color: #94a3b8;">' + v.releaseDate + '</td>' +
              '<td><strong style="color: #cbd5e1;">' + escapeHtml(v.title) + '</strong></td>' +
              '<td>' + (v.forceUpdate ? '<span class="badge badge-rose">强更</span>' : '<span class="badge badge-gray">普通</span>') + '</td>' +
              '<td><span class="badge ' + (v.enabled !== false ? 'badge-green' : 'badge-gray') + '">' + (v.enabled !== false ? '上架' : '下架') + '</span></td>' +
              '<td style="text-align: right;">' +
                '<button onclick="quickPushVersion(\'' + v.version + '\')" class="btn btn-secondary btn-sm" style="color: #a855f7;">广播</button> ' +
                '<button onclick="deleteVersion(\'' + v.version + '\')" class="btn btn-danger btn-sm">删除</button>' +
              '</td>' +
            '</tr>';
          }).join('');
        }
      } catch (e) {
        console.warn('加载版本失败:', e);
      }
    }

    async function searchKey() {
      var q = (document.getElementById('keySearchInput').value || '').trim();
      if (!q) return;
      var resBox = document.getElementById('keySearchResult');
      var btn = document.getElementById('btnSearchKey');
      if (btn) btn.innerText = '检索中...';
      try {
        var resp = await fetch('/api/admin/search/debug?q=' + encodeURIComponent(q), { headers: getHeaders() });
        var res = await resp.json();
        if (res && res.success) {
          var d = res.data;
          resBox.style.display = 'block';
          var html = '<div style="margin-bottom: 12px; font-weight: bold; color: #fff;">🎯 检索结果: ' + escapeHtml(q) + '</div>';
          if (d.game) {
            html += '<div style="background: rgba(2,6,23,0.6); padding: 12px; border-radius: 10px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.06);">' +
              '<strong style="color: #38bdf8;">' + escapeHtml(d.game.nameZh || d.game.name) + '</strong> (' + escapeHtml(d.game.name) + ') · AppID: ' + d.game.appId +
            '</div>';
          }
          html += '<div class="grid-2">' +
            '<div style="background: rgba(2,6,23,0.6); padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.06);">' +
              '<div style="color: #94a3b8; font-size: 11px; margin-bottom: 6px;">AES-256 DepotKey 密钥</div>' +
              '<div style="font-family: monospace; color: #34d399; word-break: break-all;">' + escapeHtml(d.depotKey || '未命中分包密钥') + '</div>' +
            '</div>' +
            '<div style="background: rgba(2,6,23,0.6); padding: 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.06);">' +
              '<div style="color: #94a3b8; font-size: 11px; margin-bottom: 6px;">PICS AccessToken 令牌</div>' +
              '<div style="font-family: monospace; color: #38bdf8; word-break: break-all;">' + escapeHtml(d.token || '公开分包 (无保护令牌需求)') + '</div>' +
            '</div>' +
          '</div>';
          resBox.innerHTML = html;
        }
      } catch (e) {
        alert('查询失败: ' + e.message);
      } finally {
        if (btn) btn.innerText = '查询';
      }
    }

    async function loadSources() {
      try {
        var resp = await fetch('/api/sources');
        var res = await resp.json();
        var grid = document.getElementById('sourcesGrid');
        if (res && res.success && res.data && res.data.sources && grid) {
          grid.innerHTML = res.data.sources.map(function(s) {
            return '<div class="card">' +
              '<div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">' +
                '<strong style="color: #fff;">' + escapeHtml(s.name) + '</strong>' +
                '<span class="badge badge-green">' + escapeHtml(s.status) + '</span>' +
              '</div>' +
              '<p style="color: #94a3b8; font-size: 12px; margin-bottom: 10px;">' + escapeHtml(s.description) + '</p>' +
              '<div style="font-size: 11px; color: #64748b; border-top: 1px solid rgba(255,255,255,0.06); padding-top: 8px;">' +
                '来源: ' + escapeHtml(s.author) + ' · 周期: ' + escapeHtml(s.syncFrequency) +
              '</div>' +
            '</div>';
          }).join('');
        }
      } catch (e) {
        console.warn('加载数据源失败:', e);
      }
    }

    async function triggerSyncAll() {
      var btn = document.getElementById('btnSyncAll');
      if (btn) btn.innerHTML = '<span>⏳ 正在同步中...</span>';
      try {
        var resp = await fetch('/api/admin/sync/all', { method: 'POST', headers: getHeaders() });
        var res = await resp.json();
        alert(res.message || '多源全量聚合同步完成！');
        loadStats();
      } catch (e) {
        alert('同步失败: ' + e.message);
      } finally {
        if (btn) btn.innerHTML = '<span>🔄 立即触发全量多源聚合同步</span>';
      }
    }

    async function loadAuditLogs() {
      try {
        var resp = await fetch('/api/auth/audit-logs?limit=50', { headers: getHeaders() });
        var res = await resp.json();
        var tbody = document.getElementById('auditTableBody');
        if (res && res.success && res.data && tbody) {
          tbody.innerHTML = res.data.map(function(l) {
            return '<tr style="font-size: 11px; font-family: monospace;">' +
              '<td style="color: #64748b;">' + formatTime(l.timestamp) + '</td>' +
              '<td style="color: #38bdf8; font-weight: bold;">' + escapeHtml(l.action) + '</td>' +
              '<td>' + escapeHtml(l.operator) + '</td>' +
              '<td style="color: #64748b;">' + escapeHtml(l.ip) + '</td>' +
              '<td style="font-family: inherit; color: #cbd5e1;">' + escapeHtml(l.details || '') + '</td>' +
              '<td><span class="badge ' + (l.success ? 'badge-green' : 'badge-rose') + '">' + (l.success ? '成功' : '失败') + '</span></td>' +
            '</tr>';
          }).join('');
        }
      } catch (e) {
        console.warn('加载审计日志失败:', e);
      }
    }

    async function handleChangePassword() {
      var cur = (document.getElementById('curPass').value || '').trim();
      var user = (document.getElementById('newUsername').value || '').trim();
      var pass = (document.getElementById('newPass').value || '').trim();
      var msg = document.getElementById('pwdMsg');

      if (!cur || !pass) {
        msg.style.display = 'block';
        msg.className = 'badge-rose';
        msg.innerText = '❌ 请输入当前密码与新密码';
        return;
      }

      try {
        var resp = await fetch('/api/auth/change-password', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ currentPassword: cur, newUsername: user, newPassword: pass })
        });
        var res = await resp.json();
        msg.style.display = 'block';
        if (res && res.success) {
          msg.className = 'badge-green';
          msg.innerText = '✅ ' + res.message;
          if (res.token) {
            authToken = res.token;
            localStorage.setItem('steammaster_admin_token', res.token);
          }
        } else {
          msg.className = 'badge-rose';
          msg.innerText = '❌ ' + (res.message || '修改失败');
        }
      } catch (err) {
        msg.style.display = 'block';
        msg.className = 'badge-rose';
        msg.innerText = '❌ 请求异常: ' + err.message;
      }
    }

    function openNoticeModal() {
      document.getElementById('noticeId').value = '';
      document.getElementById('noticeTitle').value = '';
      document.getElementById('noticeContent').value = '';
      document.getElementById('noticeModal').style.display = 'flex';
    }

    function openVersionModal() {
      document.getElementById('verNumber').value = '';
      document.getElementById('verDate').value = new Date().toISOString().split('T')[0];
      document.getElementById('verTitle').value = '';
      document.getElementById('verChangelog').value = '';
      document.getElementById('versionModal').style.display = 'flex';
    }

    function openPushModal() {
      var latest = (versionsCache[0] && versionsCache[0].version) || '1.0.0';
      document.getElementById('pushVersion').value = latest;
      document.getElementById('pushTitle').value = '🚀 SteamMaster 发现全新版本 v' + latest;
      document.getElementById('pushContent').value = '全新版本已上线，建议立即升级体验最新功能！';
      document.getElementById('pushModal').style.display = 'flex';
    }

    function quickPushVersion(ver) {
      document.getElementById('pushVersion').value = ver;
      document.getElementById('pushTitle').value = '🚀 SteamMaster 发现重要新版本 v' + ver;
      document.getElementById('pushContent').value = 'SteamMaster v' + ver + ' 现已发布，建议立即更新。';
      document.getElementById('pushModal').style.display = 'flex';
    }

    function previewNotice(id) {
      var n = noticesCache.find(function(x) { return x.id === id; });
      if (!n) return;
      document.getElementById('previewTitle').innerText = n.title;
      document.getElementById('previewContent').innerText = n.content;
      document.getElementById('previewModal').style.display = 'flex';
    }

    function closeModal(id) {
      document.getElementById(id).style.display = 'none';
    }

    async function handleNoticeSubmit() {
      var title = (document.getElementById('noticeTitle').value || '').trim();
      var content = (document.getElementById('noticeContent').value || '').trim();
      if (!title || !content) {
        alert('请填写公告标题与内容');
        return;
      }
      var payload = {
        title: title,
        type: document.getElementById('noticeType').value,
        level: document.getElementById('noticeLevel').value,
        priority: parseInt(document.getElementById('noticePriority').value, 10) || 10,
        targetVersion: document.getElementById('noticeVersion').value || '*',
        content: content,
        enabled: true
      };
      try {
        var resp = await fetch('/api/admin/notices', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(payload)
        });
        var res = await resp.json();
        if (res && res.success) {
          closeModal('noticeModal');
          loadNotices();
          alert('公告已发布下发！');
        } else {
          alert('发布失败: ' + (res.message || '未知错误'));
        }
      } catch (err) { alert('发布失败: ' + err.message); }
    }

    async function handleVersionSubmit() {
      var ver = (document.getElementById('verNumber').value || '').trim();
      var title = (document.getElementById('verTitle').value || '').trim();
      if (!ver || !title) {
        alert('请填写版本号与更新标题');
        return;
      }
      var changelog = document.getElementById('verChangelog').value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
      var payload = {
        version: ver,
        releaseDate: document.getElementById('verDate').value,
        title: title,
        downloadUrl: document.getElementById('verUrl').value,
        forceUpdate: document.getElementById('verForce').checked,
        changelog: changelog,
        enabled: true
      };
      try {
        var resp = await fetch('/api/admin/versions', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(payload)
        });
        var res = await resp.json();
        if (res && res.success) {
          closeModal('versionModal');
          loadVersions();
          alert('新版本已发布上线！');
        } else {
          alert('发布失败: ' + (res.message || '未知错误'));
        }
      } catch (err) { alert('发布失败: ' + err.message); }
    }

    async function handlePushSubmit() {
      var ver = (document.getElementById('pushVersion').value || '').trim();
      var title = (document.getElementById('pushTitle').value || '').trim();
      var content = (document.getElementById('pushContent').value || '').trim();
      if (!ver || !title) {
        alert('请填写目标版本与推送标题');
        return;
      }
      var payload = {
        version: ver,
        title: title,
        content: content
      };
      try {
        var resp = await fetch('/api/admin/versions/push', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(payload)
        });
        var res = await resp.json();
        if (res && res.success) {
          closeModal('pushModal');
          alert('🎉 全网版本推送广播发起成功！所有在线客户端已接收。');
        } else {
          alert('推送失败: ' + (res.message || '未知错误'));
        }
      } catch (err) { alert('推送失败: ' + err.message); }
    }

    async function toggleNotice(id, enable) {
      await fetch('/api/admin/notices/' + id + '/toggle', {
        method: 'PATCH',
        headers: getHeaders(),
        body: JSON.stringify({ enabled: enable })
      });
      loadNotices();
    }

    async function deleteNotice(id) {
      if (!confirm('确定删除此公告？')) return;
      await fetch('/api/admin/notices/' + id, { method: 'DELETE', headers: getHeaders() });
      loadNotices();
    }

    async function deleteVersion(ver) {
      if (!confirm('确定删除版本 v' + ver + ' 记录？')) return;
      await fetch('/api/admin/versions/' + ver, { method: 'DELETE', headers: getHeaders() });
      loadVersions();
    }

    function formatTime(iso) {
      if (!iso) return '-';
      try {
        const d = new Date(iso);
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
      } catch { return iso; }
    }

    function escapeHtml(str) {
      return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function loadAllData() {
      loadStats();
      loadNotices();
      loadVersions();
    }

    window.onload = checkAuth;
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
