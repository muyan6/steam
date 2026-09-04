export const LANDING_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>春风渡 · Steam 极速入库与联机生态工具</title>
    <style>
        :root {
            --bg: #0c0f14;
            --surface: #151a23;
            --surface-elevated: #1c2230;
            --border: rgba(255,255,255,0.08);
            --accent: #00d4f5;
            --accent-glow: rgba(0,212,245,0.15);
            --accent-secondary: #8b6cff;
            --warning: #ff8c00;
            --danger: #ff4057;
            --success: #3ddc84;
            --text-primary: #f0f2f6;
            --text-secondary: #b4bcd0;
            --text-muted: #6b7590;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Noto Sans SC', sans-serif;
            background: var(--bg);
            color: var(--text-primary);
            line-height: 1.7;
            min-height: 100vh;
            overflow-x: hidden;
            -webkit-font-smoothing: antialiased;
        }

        body::before {
            content: '';
            position: fixed;
            inset: 0;
            background:
                radial-gradient(ellipse 80% 60% at 10% 20%, rgba(0,212,245,0.06) 0%, transparent 60%),
                radial-gradient(ellipse 60% 50% at 90% 80%, rgba(139,108,255,0.06) 0%, transparent 60%);
            pointer-events: none;
            z-index: 0;
        }

        .container {
            position: relative;
            z-index: 1;
            max-width: 880px;
            margin: 0 auto;
            padding: 32px 20px 80px;
        }

        /* ── Header ── */
        .header-bar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 36px;
            flex-wrap: wrap;
            gap: 14px;
        }

        .logo-group {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .logo-icon {
            width: 44px;
            height: 44px;
            background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 900;
            font-size: 20px;
            color: #0c0f14;
            flex-shrink: 0;
            box-shadow: 0 4px 16px rgba(0,212,245,0.3);
        }

        .logo-text {
            font-size: 16px;
            font-weight: 800;
            color: var(--text-primary);
            letter-spacing: 0.02em;
        }

        .logo-text span {
            color: var(--accent);
        }

        .header-actions {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .header-tag {
            font-family: monospace;
            font-size: 11px;
            color: var(--text-muted);
            background: var(--surface);
            padding: 6px 14px;
            border-radius: 20px;
            border: 1px solid var(--border);
        }

        .admin-nav-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 6px 16px;
            background: linear-gradient(135deg, rgba(0,212,245,0.15), rgba(139,108,255,0.15));
            border: 1px solid rgba(0,212,245,0.4);
            border-radius: 20px;
            color: #38bdf8;
            font-size: 12.5px;
            font-weight: 700;
            text-decoration: none;
            transition: all 0.2s ease;
        }

        .admin-nav-btn:hover {
            background: linear-gradient(135deg, var(--accent), var(--accent-secondary));
            color: #0c0f14;
            box-shadow: 0 0 16px rgba(0,212,245,0.4);
            transform: translateY(-1px);
        }

        /* ── Main Card ── */
        .main-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 24px;
            overflow: hidden;
            box-shadow: 0 20px 50px rgba(0,0,0,0.5);
        }

        /* Hero */
        .hero {
            position: relative;
            padding: 44px 32px 36px;
            text-align: center;
            background: linear-gradient(180deg, rgba(0,212,245,0.05) 0%, transparent 70%);
            border-bottom: 1px solid var(--border);
        }

        .hero::after {
            content: '';
            position: absolute;
            bottom: -1px; left: 50%;
            transform: translateX(-50%);
            width: 140px; height: 1px;
            background: linear-gradient(90deg, transparent, var(--accent), transparent);
        }

        .hero-title {
            font-size: 32px;
            font-weight: 900;
            letter-spacing: -0.01em;
            margin-bottom: 8px;
            background: linear-gradient(135deg, #ffffff 30%, var(--accent));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .hero-sub {
            font-size: 13px;
            color: var(--text-muted);
            font-family: monospace;
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }

        .hero-stats {
            display: flex;
            justify-content: center;
            gap: 20px;
            margin-top: 24px;
            flex-wrap: wrap;
        }

        .stat-badge {
            background: var(--surface-elevated);
            border: 1px solid var(--border);
            padding: 8px 18px;
            border-radius: 12px;
            font-size: 12px;
            color: var(--text-secondary);
        }

        .stat-badge strong {
            color: var(--accent);
            font-size: 14px;
            font-weight: 800;
            margin-right: 4px;
        }

        /* ── Sections ── */
        .card-body { padding: 0 32px 40px; }

        .section {
            margin-top: 36px;
        }

        .section-label {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: var(--accent);
            margin-bottom: 12px;
            font-family: monospace;
        }

        .section-label::before {
            content: '';
            width: 16px; height: 2px;
            background: var(--accent);
            border-radius: 2px;
        }

        .section-title {
            font-size: 20px;
            font-weight: 800;
            color: #fff;
            margin-bottom: 16px;
        }

        /* Tutorial Link */
        .link-btn {
            display: inline-flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            padding: 16px 22px;
            background: var(--surface-elevated);
            border: 1px solid var(--border);
            border-radius: 14px;
            color: var(--text-primary);
            text-decoration: none;
            font-size: 14px;
            font-weight: 600;
            transition: all 0.25s ease;
        }

        .link-btn:hover {
            border-color: rgba(0,212,245,0.4);
            background: rgba(0,212,245,0.06);
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(0,212,245,0.12);
        }

        .link-url {
            font-family: monospace;
            font-size: 12px;
            color: var(--text-muted);
            margin-top: 2px;
        }

        /* Feature Grid */
        .feature-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }

        .feature-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 13px 16px;
            background: var(--surface-elevated);
            border-radius: 12px;
            border: 1px solid var(--border);
            font-size: 13.5px;
            color: var(--text-primary);
            font-weight: 500;
            transition: all 0.2s ease;
        }

        .feature-item:hover {
            border-color: rgba(0,212,245,0.25);
            background: rgba(0,212,245,0.04);
        }

        .feature-item .check {
            width: 22px; height: 22px;
            background: rgba(61,220,132,0.18);
            border-radius: 7px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
            flex-shrink: 0;
            color: var(--success);
            font-weight: 900;
        }

        .feature-item.warn {
            grid-column: 1 / -1;
            background: rgba(255,64,87,0.08);
            border-color: rgba(255,64,87,0.25);
            color: #fecdd3;
            font-size: 13px;
            line-height: 1.6;
        }

        .feature-item.warn .check {
            background: rgba(255,64,87,0.2);
            color: var(--danger);
        }

        /* Download Box */
        .download-box {
            background: var(--surface-elevated);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 20px;
        }

        .download-item {
            display: flex;
            align-items: flex-start;
            gap: 14px;
            padding: 14px 0;
            border-bottom: 1px solid var(--border);
        }

        .download-item:last-child { border-bottom: none; padding-bottom: 0; }
        .download-item:first-child { padding-top: 0; }

        .dl-badge {
            flex-shrink: 0;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 700;
            font-family: monospace;
            margin-top: 2px;
        }

        .dl-badge.lanzou { background: rgba(0,212,245,0.12); color: var(--accent); }
        .dl-badge.pan123 { background: rgba(139,108,255,0.15); color: var(--accent-secondary); }
        .dl-badge.github { background: rgba(61,220,132,0.15); color: var(--success); }

        .dl-info { flex: 1; min-width: 0; }

        .dl-info a {
            color: #fff;
            text-decoration: none;
            font-size: 14px;
            font-weight: 600;
            transition: color 0.2s ease;
            display: block;
        }

        .dl-info a:hover { color: var(--accent); }

        .dl-info .dl-url {
            font-family: monospace;
            font-size: 11.5px;
            color: var(--text-muted);
            margin-top: 3px;
        }

        .dl-info .dl-pass {
            font-family: monospace;
            font-size: 12px;
            color: var(--text-secondary);
            margin-top: 4px;
            display: inline-flex;
            align-items: center;
            gap: 5px;
        }

        .dl-pass code {
            background: rgba(0,212,245,0.12);
            padding: 2px 8px;
            border-radius: 4px;
            color: var(--accent);
            font-weight: 700;
        }

        /* Version Cards */
        .version-card {
            margin-top: 20px;
            border-radius: 16px;
            padding: 24px;
        }

        .version-card.free {
            background: var(--surface-elevated);
            border: 1px solid var(--border);
        }

        .version-card.vip {
            background: linear-gradient(135deg, rgba(139,108,255,0.1), rgba(0,212,245,0.05));
            border: 1px solid rgba(139,108,255,0.3);
            margin-top: 18px;
        }

        .version-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            padding: 5px 14px;
            border-radius: 8px;
            font-size: 12px;
            font-weight: 800;
            margin-bottom: 12px;
        }

        .version-badge.free-badge { background: rgba(61,220,132,0.15); color: var(--success); }
        .version-badge.vip-badge { background: linear-gradient(135deg, rgba(139,108,255,0.25), rgba(0,212,245,0.15)); color: var(--accent-secondary); }

        .vip-features { list-style: none; margin: 14px 0; }
        .vip-features li {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 6px 0;
            font-size: 13.5px;
            color: var(--text-primary);
        }

        .vip-features li .vf-icon {
            width: 20px; height: 20px;
            background: rgba(139,108,255,0.2);
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 11px;
            color: var(--accent-secondary);
            flex-shrink: 0;
        }

        .admin-footer-btn {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            margin-top: 16px;
            padding: 12px 28px;
            background: linear-gradient(135deg, #0284c7, #0369a1);
            color: #fff;
            text-decoration: none;
            font-size: 14px;
            font-weight: 700;
            border-radius: 12px;
            transition: all 0.25s ease;
            box-shadow: 0 4px 16px rgba(2,132,199,0.35);
        }

        .admin-footer-btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(2,132,199,0.5);
        }

        /* Footer */
        .footer {
            margin-top: 48px;
            text-align: center;
            padding: 24px 0;
            border-top: 1px solid var(--border);
        }

        .footer p {
            font-size: 12px;
            color: var(--text-muted);
            font-family: monospace;
        }

        .footer a {
            color: var(--text-secondary);
            text-decoration: none;
        }

        .footer a:hover { color: var(--accent); }

        /* Responsive Mobile Styles */
        @media (max-width: 600px) {
            .container { padding: 20px 14px 60px; }
            .hero { padding: 32px 18px 24px; }
            .card-body { padding: 0 18px 28px; }
            .hero-title { font-size: 22px; }
            .feature-grid { grid-template-columns: 1fr; }
            .header-tag { display: none; }
            .version-card { padding: 18px; }
            .header-bar { justify-content: space-between; }
        }
    </style>
</head>
<body>
    <div class="container">

        <!-- Header -->
        <div class="header-bar">
            <div class="logo-group">
                <div class="logo-icon">CFD</div>
                <div class="logo-text"><span>春风渡</span> Tools</div>
            </div>
            <div class="header-actions">
                <div class="header-tag">春风渡 Steam 入库工具 v1.0.0</div>
                <a href="/admin" class="admin-nav-btn">⚡ 进入管理后台</a>
            </div>
        </div>

        <!-- Main Card -->
        <div class="main-card">
            <div class="hero">
                <div class="hero-title">春风渡 · Steam 极速入库</div>
                <div class="hero-sub">One-Click Steam Library & OnlineFix Engine</div>

                <div class="hero-stats">
                    <div class="stat-badge"><strong>183,751</strong> 全量游戏收录</div>
                    <div class="stat-badge"><strong>28.8万+</strong> 真实 DepotKey</div>
                    <div class="stat-badge"><strong>0ms</strong> 本地极速响应</div>
                </div>
            </div>

            <div class="card-body">

                <!-- Tutorial -->
                <div class="section">
                    <div class="section-label">Tutorial</div>
                    <div class="section-title">使用教程</div>
                    <a href="https://doc.guyunsq.com/1.html" target="_blank" class="link-btn">
                        <span>
                            查看完整图文使用教程
                            <div class="link-url">doc.guyunsq.com/1.html</div>
                        </span>
                        <span>➔</span>
                    </a>
                </div>

                <!-- Features -->
                <div class="section">
                    <div class="section-label">Features</div>
                    <div class="section-title">功能详解</div>
                    <div class="feature-grid">
                        <div class="feature-item">
                            <div class="check">✓</div>
                            创意工坊支持
                        </div>
                        <div class="feature-item">
                            <div class="check">✓</div>
                            游戏实时更新
                        </div>
                        <div class="feature-item">
                            <div class="check">✓</div>
                            可视化游戏列表
                        </div>
                        <div class="feature-item">
                            <div class="check">✓</div>
                            每天更新新游戏
                        </div>
                        <div class="feature-item">
                            <div class="check">✓</div>
                            完整入库 + 全部 DLC
                        </div>
                        <div class="feature-item">
                            <div class="check">✓</div>
                            提前游玩 / 锁区游戏
                        </div>
                        <div class="feature-item">
                            <div class="check">✓</div>
                            联机补丁一键启动
                        </div>
                        <div class="feature-item">
                            <div class="check">✓</div>
                            双入库内核自由切换
                        </div>
                        <div class="feature-item">
                            <div class="check">✓</div>
                            真实免费无隐瞒
                        </div>
                        <div class="feature-item">
                            <div class="check">✓</div>
                            轻量好用教程齐全
                        </div>
                        <div class="feature-item warn">
                            <div class="check">✕</div>
                            不支持 D 加密、第三方启动器（育碧 / 橘子 / 战网）、需联网验证的游戏（如使命召唤）
                        </div>
                    </div>
                </div>

                <!-- Troubleshoot -->
                <div class="section">
                    <div class="section-label">Support</div>
                    <div class="section-title">入库没有效果？</div>
                    <a href="https://doc.guyunsq.com/" target="_blank" class="link-btn">
                        <div>
                            <div>查看常见问题大全中心</div>
                            <div class="link-url">doc.guyunsq.com</div>
                        </div>
                        <span>?</span>
                    </a>
                </div>

                <!-- Download -->
                <div class="section">
                    <div class="section-label">Download</div>
                    <div class="section-title">入库工具下载</div>
                    <div class="version-card free">
                        <div class="version-badge free-badge">FREE · 公益版</div>
                        <p style="color: #cbd5e1; font-size: 13.5px; margin-bottom: 14px;">核心功能完全免费开放，纯净绿色体验。</p>

                        <div class="download-box">
                            <div class="download-item">
                                <div class="dl-badge lanzou">蓝奏云</div>
                                <div class="dl-info">
                                    <a href="https://hackv.lanzouu.com/b01to9g4sd" target="_blank">点击前往蓝奏云高速下载</a>
                                    <div class="dl-url">hackv.lanzouu.com/b01to9g4sd</div>
                                    <div class="dl-pass">提取码 <code>6666</code></div>
                                </div>
                            </div>
                            <div class="download-item">
                                <div class="dl-badge pan123">123盘</div>
                                <div class="dl-info">
                                    <a href="https://www.123pan.com/s/dYNRVv-E8Uf.html" target="_blank">点击前往 123 盘备用下载</a>
                                    <div class="dl-url">123pan.com/s/dYNRVv-E8Uf</div>
                                </div>
                            </div>
                            <div class="download-item">
                                <div class="dl-badge github">GitHub</div>
                                <div class="dl-info">
                                    <a href="https://github.com/muyan6/steam/releases" target="_blank">点击前往 GitHub Releases 官方发布页</a>
                                    <div class="dl-url">github.com/muyan6/steam/releases</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="version-card vip">
                        <div class="version-badge vip-badge">PRO · 赞助版</div>
                        <ul class="vip-features">
                            <li><span class="vf-icon">⚡</span> 极速通道优先响应</li>
                            <li><span class="vf-icon">⚡</span> 优先反馈与更新冷门游戏及 DLC</li>
                            <li><span class="vf-icon">⚡</span> 专属一对一支持解决任何疑难问题</li>
                        </ul>
                        <a href="/admin" class="admin-footer-btn">
                            <span>进入春风渡管理控制台</span>
                            <span>➔</span>
                        </a>
                    </div>
                </div>

            </div>
        </div>

        <!-- Footer -->
        <div class="footer">
            <p>春风渡 (ChunFengDu Tools) &mdash; Built for Steam Players</p>
            <p style="margin-top: 8px;">
                <a href="/admin">管理控制台登录</a> · <a href="https://github.com/muyan6/steam" target="_blank">GitHub 开源</a>
            </p>
        </div>

    </div>
</body>
</html>`;
