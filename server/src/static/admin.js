// SteamMaster Admin Dashboard Script (TypeScript Exported, 100% ESM Safe & Standalone)
export const ADMIN_JS = `
var authToken = localStorage.getItem('steammaster_admin_token') || '';
var noticesCache = [];
var versionsCache = [];
var currentLicPage = 1;
var currentLicTotalPages = 1;
var currentLicList = [];

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
      void loginBox.offsetWidth;
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

function checkAuth() {
  var t = authToken || localStorage.getItem('steammaster_admin_token') || '';
  var loginSec = document.getElementById('loginSection');
  var dashSec = document.getElementById('dashboardSection');
  if (t) {
    authToken = t;
    if (loginSec) { loginSec.classList.add('d-none'); loginSec.style.cssText = 'display: none !important;'; }
    if (dashSec) { dashSec.classList.remove('d-none'); dashSec.style.cssText = 'display: block !important;'; }
    loadAllData();
  } else {
    if (loginSec) { loginSec.classList.remove('d-none'); loginSec.style.cssText = 'display: flex !important;'; }
    if (dashSec) { dashSec.classList.add('d-none'); dashSec.style.cssText = 'display: none !important;'; }
  }
}

async function handleLoginSubmit() {
  var userEl = document.getElementById('loginUser');
  var passEl = document.getElementById('loginPass');
  var user = (userEl ? userEl.value : '').trim();
  var pass = (passEl ? passEl.value : '').trim();
  var btn = document.getElementById('loginBtn');
  if (!user || !pass) { showNotice('error', '请输入管理员账号与密码'); return; }
  showNotice('info', '正在校验凭据并连接云端控制台...');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span>正在验证凭据...</span>'; }
  try {
    var resp = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    });
    var data;
    try { data = await resp.json(); } catch(e) { throw new Error('服务器返回非标准响应 (HTTP ' + resp.status + ')'); }
    if (resp.ok && data && data.success && data.token) {
      showNotice('success', '登录成功！正在进入管控大盘...');
      authToken = data.token;
      localStorage.setItem('steammaster_admin_token', authToken);
      var adminEl = document.getElementById('adminUsername');
      if (adminEl) adminEl.innerText = (data.user && data.user.username) ? data.user.username : user;
      var loginSec = document.getElementById('loginSection');
      var dashSec = document.getElementById('dashboardSection');
      if (loginSec) { loginSec.classList.add('d-none'); loginSec.style.cssText = 'display: none !important;'; }
      if (dashSec) { dashSec.classList.remove('d-none'); dashSec.style.cssText = 'display: block !important;'; }
      loadAllData();
    } else {
      showNotice('error', (data && data.message) ? data.message : '账号或密码错误 (默认密码: admin123)');
    }
  } catch (err) {
    showNotice('error', '连接服务器失败: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span>安全登录控制台</span>'; }
  }
}

function handleLogout() {
  authToken = '';
  localStorage.removeItem('steammaster_admin_token');
  checkAuth();
}

function switchTab(tabId, el) {
  document.querySelectorAll('.tab-btn').forEach(function(btn) { btn.classList.remove('active'); });
  document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.add('d-none'); c.style.cssText = 'display: none !important;'; });
  if (el) { el.classList.add('active'); } else { var f = document.querySelector('.tab-btn[onclick*="' + tabId + '"]'); if (f) f.classList.add('active'); }
  var target = document.getElementById('tab-' + tabId);
  if (target) { target.classList.remove('d-none'); target.style.cssText = 'display: block !important;'; }
  if (tabId === 'licenses') loadLicensesData(1);
  if (tabId === 'notices') loadNotices();
  if (tabId === 'versions') loadVersions();
  if (tabId === 'sources') loadSources();
  if (tabId === 'security') loadAuditLogs();
}

async function loadStats() {
  try {
    var resp = await fetch('/api/admin/stats', { headers: getHeaders() });
    if (resp.status === 401) { handleLogout(); return; }
    var res = await resp.json();
    if (res && res.success) {
      var d = res.data;
      var kKeys = document.getElementById('kpiKeys'); if (kKeys) kKeys.innerText = (d.depotKeysCount || 0).toLocaleString() + ' 条';
      var kTokens = document.getElementById('kpiTokens'); if (kTokens) kTokens.innerText = (d.tokensCount || 0).toLocaleString() + ' 款';
      var kGames = document.getElementById('kpiGames'); if (kGames) kGames.innerText = (d.gamesCount || 0).toLocaleString() + ' 款';
      var kUptime = document.getElementById('kpiUptime'); var kMem = document.getElementById('kpiMem');
      var uptime = d.uptimeSeconds || 0;
      if (kUptime) kUptime.innerText = Math.floor(uptime/3600) + 'h ' + Math.floor((uptime%3600)/60) + 'm';
      if (kMem) kMem.innerText = '内存: ' + (d.memoryUsageMb || 0) + ' MB';
    }
  } catch(e) { console.warn('loadStats error:', e); }
}

// ==================== 激活码管理模块 ====================

var TYPE_MAP = {
  'monthly': { label: '月卡 (30天)', badge: 'badge-blue' },
  'quarterly': { label: '季卡 (90天)', badge: 'badge-green' },
  'yearly': { label: '年卡 (365天)', badge: 'badge-amber' },
  'lifetime': { label: '永久尊享卡', badge: 'badge-rose' }
};

var STATUS_MAP = {
  'unused': { label: '未使用', badge: 'badge-green' },
  'active': { label: '已激活绑定', badge: 'badge-blue' },
  'expired': { label: '已过期', badge: 'badge-rose' },
  'disabled': { label: '已冻结', badge: 'badge-gray' }
};

async function loadLicensesData(page) {
  if (page) currentLicPage = page;
  var searchInput = document.getElementById('licSearchInput');
  var typeFilter = document.getElementById('licTypeFilter');
  var statusFilter = document.getElementById('licStatusFilter');

  var q = searchInput ? encodeURIComponent(searchInput.value.trim()) : '';
  var t = typeFilter ? typeFilter.value : 'all';
  var s = statusFilter ? statusFilter.value : 'all';

  var tbody = document.getElementById('licenseTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#64748b;padding:24px;">正在载入激活码列表...</td></tr>';

  try {
    var url = '/api/admin/license/list?page=' + currentLicPage + '&limit=20&search=' + q + '&type=' + t + '&status=' + s;
    var resp = await fetch(url, { headers: getHeaders() });
    if (resp.status === 401) { handleLogout(); return; }
    var res = await resp.json();
    if (res && res.success && res.data) {
      var d = res.data;
      currentLicList = d.list || [];
      var total = d.total || 0;
      var limit = d.limit || 20;
      currentLicTotalPages = Math.ceil(total / limit) || 1;

      // 更新 KPI
      var st = d.stats || {};
      var elTot = document.getElementById('kpiLicTotal'); if (elTot) elTot.innerText = (st.total || 0).toLocaleString() + ' 张';
      var elUnused = document.getElementById('kpiLicUnused'); if (elUnused) elUnused.innerText = (st.unused || 0).toLocaleString() + ' 张';
      var elActive = document.getElementById('kpiLicActive'); if (elActive) elActive.innerText = (st.active || 0).toLocaleString() + ' 张';
      var elExpired = document.getElementById('kpiLicExpired'); if (elExpired) elExpired.innerText = ((st.expired || 0) + (st.disabled || 0)).toLocaleString() + ' 张';
      var elBreakdown = document.getElementById('kpiLicTypeBreakdown');
      if (elBreakdown) {
        elBreakdown.innerText = '月: ' + (st.monthlyCount || 0) + ' · 季: ' + (st.quarterlyCount || 0) + ' · 年: ' + (st.yearlyCount || 0) + ' · 永久: ' + (st.lifetimeCount || 0);
      }

      // 渲染表格
      if (!currentLicList.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#64748b;padding:24px;">暂无匹配的激活码记录</td></tr>';
      } else {
        tbody.innerHTML = currentLicList.map(function(item) {
          var tInfo = TYPE_MAP[item.type] || { label: item.type, badge: 'badge-blue' };
          var sInfo = STATUS_MAP[item.status] || { label: item.status, badge: 'badge-gray' };
          var deviceStr = item.deviceId ? '<code style="color:#38bdf8;font-size:11px;word-break:break-all;">' + escapeHtml(item.deviceId) + '</code>' : '<span style="color:#64748b;">-</span>';
          var boundStr = item.boundAt ? formatTime(item.boundAt) : '<span style="color:#64748b;">-</span>';
          var expStr = '-';
          if (item.type === 'lifetime') {
            expStr = '<span class="badge badge-rose">永久有效</span>';
          } else if (item.expiresAt) {
            var expMs = new Date(item.expiresAt).getTime();
            var remain = Math.ceil((expMs - Date.now()) / (24 * 3600 * 1000));
            if (remain > 0) {
              expStr = formatTime(item.expiresAt) + ' <span class="badge badge-blue">剩' + remain + '天</span>';
            } else {
              expStr = formatTime(item.expiresAt) + ' <span class="badge badge-rose">已到期</span>';
            }
          }

          var actionBtns = [
            '<button onclick="copyLicenseCode(\\'' + item.code + '\\')" class="btn btn-secondary btn-sm" title="复制卡密">复制</button>'
          ];

          if (item.deviceId) {
            actionBtns.push('<button onclick="handleUnbindLicense(\\'' + item.code + '\\')" class="btn btn-secondary btn-sm" style="color:#fbbf24;" title="解绑设备">解绑</button>');
          }

          if (item.type !== 'lifetime') {
            actionBtns.push('<button onclick="openExtendLicenseModal(\\'' + item.code + '\\')" class="btn btn-secondary btn-sm" style="color:#38bdf8;" title="延长有效期">延期</button>');
          }

          if (item.status === 'disabled') {
            actionBtns.push('<button onclick="handleToggleLicense(\\'' + item.code + '\\',false)" class="btn btn-secondary btn-sm" style="color:#34d399;">启用</button>');
          } else {
            actionBtns.push('<button onclick="handleToggleLicense(\\'' + item.code + '\\',true)" class="btn btn-secondary btn-sm" style="color:#fb7185;">冻结</button>');
          }

          actionBtns.push('<button onclick="handleDeleteLicense(\\'' + item.code + '\\')" class="btn btn-danger btn-sm">删除</button>');

          return '<tr>' +
            '<td><strong style="color:#fff;font-family:monospace;font-size:12px;">' + escapeHtml(item.code) + '</strong></td>' +
            '<td><span class="badge ' + tInfo.badge + '">' + tInfo.label + '</span></td>' +
            '<td><span class="badge ' + sInfo.badge + '">' + sInfo.label + '</span></td>' +
            '<td>' + deviceStr + '</td>' +
            '<td>' + boundStr + '</td>' +
            '<td>' + expStr + '</td>' +
            '<td style="color:#94a3b8;font-size:11px;">' + escapeHtml(item.remark || '-') + '</td>' +
            '<td style="text-align:right;white-space:nowrap;">' + actionBtns.join(' ') + '</td>' +
          '</tr>';
        }).join('');
      }

      // 更新分页
      var elPg = document.getElementById('licensePageInfo');
      if (elPg) elPg.innerText = '第 ' + currentLicPage + ' / ' + currentLicTotalPages + ' 页 · 共 ' + total + ' 条记录';
      var btnPrev = document.getElementById('licBtnPrev');
      var btnNext = document.getElementById('licBtnNext');
      if (btnPrev) btnPrev.disabled = currentLicPage <= 1;
      if (btnNext) btnNext.disabled = currentLicPage >= currentLicTotalPages;
    }
  } catch(e) {
    console.error('loadLicensesData error:', e);
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#fb7185;padding:24px;">载入异常: ' + e.message + '</td></tr>';
  }
}

function changeLicensePage(delta) {
  var target = currentLicPage + delta;
  if (target >= 1 && target <= currentLicTotalPages) {
    loadLicensesData(target);
  }
}

function openGenerateLicenseModal() {
  var notice = document.getElementById('genLicNotice');
  if (notice) notice.classList.add('d-none');
  document.getElementById('generateLicenseModal').style.display = 'flex';
}

async function handleGenerateLicenseSubmit() {
  var type = document.getElementById('genLicType').value;
  var count = parseInt(document.getElementById('genLicCount').value, 10) || 1;
  var prefix = (document.getElementById('genLicPrefix').value || '').trim();
  var remark = (document.getElementById('genLicRemark').value || '').trim();
  var btn = document.getElementById('btnDoGenLicense');

  if (btn) { btn.disabled = true; btn.innerText = '正在批量生成...'; }
  try {
    var resp = await fetch('/api/admin/license/generate', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ type: type, count: count, prefix: prefix, remark: remark })
    });
    var res = await resp.json();
    if (res && res.success) {
      var notice = document.getElementById('genLicNotice');
      var txt = document.getElementById('genLicNoticeText');
      if (notice && txt) {
        txt.innerText = res.message || '生成成功！';
        notice.classList.remove('d-none');
      }
      setTimeout(function() {
        closeModal('generateLicenseModal');
        loadLicensesData(1);
      }, 800);
    } else {
      alert('生成失败: ' + (res.message || '未知错误'));
    }
  } catch(e) {
    alert('请求异常: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '立即批量生成'; }
  }
}

function openExtendLicenseModal(code) {
  document.getElementById('extLicCode').value = code;
  document.getElementById('extendLicenseModal').style.display = 'flex';
}

async function handleExtendLicenseSubmit() {
  var code = document.getElementById('extLicCode').value;
  var days = parseInt(document.getElementById('extLicDays').value, 10) || 30;
  try {
    var resp = await fetch('/api/admin/license/extend', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ code: code, additionalDays: days })
    });
    var res = await resp.json();
    if (res && res.success) {
      closeModal('extendLicenseModal');
      loadLicensesData(currentLicPage);
      alert(res.message);
    } else {
      alert('延期失败: ' + (res.message || '未知错误'));
    }
  } catch(e) { alert('请求异常: ' + e.message); }
}

async function handleUnbindLicense(code) {
  if (!confirm('确定要解除卡密 ' + code + ' 与已绑定电脑的关联吗？\\n解绑后该卡密可在任意新设备重新激活。')) return;
  try {
    var resp = await fetch('/api/admin/license/unbind', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ code: code })
    });
    var res = await resp.json();
    if (res && res.success) {
      loadLicensesData(currentLicPage);
      alert(res.message);
    } else {
      alert('解绑失败: ' + (res.message || '未知错误'));
    }
  } catch(e) { alert('请求异常: ' + e.message); }
}

async function handleToggleLicense(code, disabled) {
  var actionStr = disabled ? '冻结停用' : '恢复启用';
  if (!confirm('确定要' + actionStr + '激活码 ' + code + ' 吗？')) return;
  try {
    var resp = await fetch('/api/admin/license/toggle', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ code: code, disabled: disabled })
    });
    var res = await resp.json();
    if (res && res.success) {
      loadLicensesData(currentLicPage);
    } else {
      alert('操作失败: ' + (res.message || '未知错误'));
    }
  } catch(e) { alert('请求异常: ' + e.message); }
}

async function handleDeleteLicense(code) {
  if (!confirm('确定要永久删除激活码 ' + code + ' 吗？此操作不可恢复！')) return;
  try {
    var resp = await fetch('/api/admin/license/' + encodeURIComponent(code), {
      method: 'DELETE',
      headers: getHeaders()
    });
    var res = await resp.json();
    if (res && res.success) {
      loadLicensesData(currentLicPage);
    } else {
      alert('删除失败: ' + (res.message || '未知错误'));
    }
  } catch(e) { alert('请求异常: ' + e.message); }
}

function copyLicenseCode(code) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(function() {
      alert('激活码已复制到剪贴板: ' + code);
    });
  } else {
    prompt('请复制激活码:', code);
  }
}

function copyCurrentLicenses() {
  if (!currentLicList || !currentLicList.length) {
    alert('当前没有可复制的卡密记录');
    return;
  }
  var lines = currentLicList.map(function(item) {
    var tLabel = (TYPE_MAP[item.type] ? TYPE_MAP[item.type].label : item.type);
    var sLabel = (STATUS_MAP[item.status] ? STATUS_MAP[item.status].label : item.status);
    return item.code + ' | ' + tLabel + ' | ' + sLabel + (item.remark ? ' | ' + item.remark : '');
  }).join('\\n');

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(lines).then(function() {
      alert('已成功复制当前页全部 ' + currentLicList.length + ' 个卡密及状态到剪贴板！');
    });
  } else {
    prompt('当前页卡密列表:', lines);
  }
}

// ==================== 公告与版本管理 ====================

async function loadNotices() {
  try {
    var resp = await fetch('/api/admin/notices', { headers: getHeaders() });
    if (resp.status === 401) { handleLogout(); return; }
    var res = await resp.json();
    var tbody = document.getElementById('noticeTableBody');
    if (res && res.success && tbody) {
      noticesCache = res.data || [];
      if (!noticesCache.length) { tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#64748b;padding:24px;">暂无公告记录</td></tr>'; return; }
      tbody.innerHTML = noticesCache.map(function(n) {
        return '<tr>' +
          '<td><span class="badge ' + (n.enabled ? 'badge-green' : 'badge-gray') + '">' + (n.enabled ? '启用中' : '已停用') + '</span></td>' +
          '<td><strong>' + escapeHtml(n.title) + '</strong></td>' +
          '<td>' + (n.type === 'popup' ? '弹窗' : '横幅') + '</td>' +
          '<td>' + (n.level || 'info') + '</td>' +
          '<td>' + (n.priority || 0) + '</td>' +
          '<td>' + (n.targetVersion || '*') + '</td>' +
          '<td>' + formatTime(n.updatedAt) + '</td>' +
          '<td style="text-align:right;">' +
            '<button onclick="previewNotice(\\'' + n.id + '\\')" class="btn btn-secondary btn-sm" style="color:#38bdf8;">预览</button> ' +
            '<button onclick="toggleNotice(\\'' + n.id + '\\',' + (!n.enabled) + ')" class="btn btn-secondary btn-sm">' + (n.enabled ? '停用' : '启用') + '</button> ' +
            '<button onclick="deleteNotice(\\'' + n.id + '\\')" class="btn btn-danger btn-sm">删除</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }
  } catch(e) { console.warn('loadNotices error:', e); }
}

async function loadVersions() {
  try {
    var resp = await fetch('/api/admin/versions', { headers: getHeaders() });
    if (resp.status === 401) { handleLogout(); return; }
    var res = await resp.json();
    var tbody = document.getElementById('versionTableBody');
    if (res && res.success && tbody) {
      versionsCache = res.data || [];
      if (!versionsCache.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:24px;">暂无版本记录</td></tr>'; return; }
      tbody.innerHTML = versionsCache.map(function(v) {
        return '<tr>' +
          '<td><strong style="color:#38bdf8;font-family:monospace;">v' + escapeHtml(v.version) + '</strong></td>' +
          '<td>' + escapeHtml(v.releaseDate || '-') + '</td>' +
          '<td>' + escapeHtml(v.title || '-') + '</td>' +
          '<td>' + (v.forceUpdate ? '<span class="badge badge-rose">强制全量</span>' : '<span class="badge badge-blue">推荐更新</span>') + '</td>' +
          '<td><span class="badge ' + (v.enabled ? 'badge-green' : 'badge-gray') + '">' + (v.enabled ? '活跃上线' : '已归档') + '</span></td>' +
          '<td style="text-align:right;">' +
            '<button onclick="openPushModal(\\'' + v.version + '\\')" class="btn btn-secondary btn-sm" style="color:#fbbf24;">全网广播</button> ' +
            '<button onclick="deleteVersion(\\'' + v.version + '\\')" class="btn btn-danger btn-sm">删除</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }
  } catch(e) { console.warn('loadVersions error:', e); }
}

async function loadSources() {
  try {
    var resp = await fetch('/api/sources', { headers: getHeaders() });
    var res = await resp.json();
    var grid = document.getElementById('sourcesGrid');
    if (res && res.success && grid) {
      var sources = res.data || [];
      grid.innerHTML = sources.map(function(s) {
        return '<div class="card" style="display:flex;flex-direction:column;justify-content:space-between;">' +
          '<div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
              '<strong style="color:#fff;font-size:13px;">' + escapeHtml(s.name) + '</strong>' +
              '<span class="badge badge-green">● 正常</span>' +
            '</div>' +
            '<p style="color:#94a3b8;font-size:11px;margin-bottom:12px;line-height:1.5;">' + escapeHtml(s.description) + '</p>' +
            '<div style="font-size:11px;color:#64748b;font-family:monospace;margin-bottom:6px;">收录总量: <strong style="color:#38bdf8;">' + (s.totalRecordsCount || 0).toLocaleString() + ' 条</strong></div>' +
            '<div style="font-size:11px;color:#64748b;">同步频率: ' + escapeHtml(s.syncFrequency || '24h') + '</div>' +
          '</div>' +
          '<div style="margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">' +
            '<span style="font-size:10px;color:#64748b;">维护: ' + escapeHtml(s.author || '社区') + '</span>' +
            '<a href="' + escapeHtml(s.sourceUrl || '#') + '" target="_blank" style="font-size:11px;color:#38bdf8;">上游主页 ➔</a>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  } catch(e) { console.warn('loadSources error:', e); }
}

async function loadAuditLogs() {
  try {
    var resp = await fetch('/api/auth/audit-logs', { headers: getHeaders() });
    var res = await resp.json();
    var el = document.getElementById('auditLogsContainer');
    if (res && res.success && el) {
      var logs = res.data || [];
      if (!logs.length) { el.innerHTML = '<div style="color:#64748b;font-size:11px;">暂无审计日志</div>'; return; }
      el.innerHTML = logs.slice(0, 10).map(function(l) {
        return '<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;justify-content:space-between;font-size:11px;">' +
          '<span><strong>' + escapeHtml(l.action) + '</strong> - <span style="color:#94a3b8;">' + escapeHtml(l.detail) + '</span></span>' +
          '<span style="color:#64748b;font-family:monospace;">' + formatTime(l.time) + '</span>' +
        '</div>';
      }).join('');
    }
  } catch(e) {}
}

async function handleChangePassword() {
  var curPass = (document.getElementById('curPass').value || '').trim();
  var newUsername = (document.getElementById('newUsername').value || '').trim();
  var newPass = (document.getElementById('newPass').value || '').trim();
  var msg = document.getElementById('pwdMsg');
  if (!curPass) { alert('请输入当前原密码'); return; }
  try {
    var resp = await fetch('/api/auth/change-password', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ currentPassword: curPass, newUsername: newUsername, newPassword: newPass })
    });
    var res = await resp.json();
    if (res && res.success) {
      if (msg) { msg.style.display = 'block'; msg.className = 'alert-box alert-success'; msg.innerText = res.message; }
      alert('安全配置已更新！');
      if (res.token) {
        authToken = res.token;
        localStorage.setItem('steammaster_admin_token', authToken);
      }
    } else {
      alert('修改失败: ' + (res.message || '原密码错误'));
    }
  } catch(e) { alert('请求异常: ' + e.message); }
}

async function triggerSyncAll() {
  if (!confirm('确定立即触发全量多源同步？（可能需要几秒到十几秒）')) return;
  var btn = document.getElementById('btnSyncAll');
  if (btn) { btn.disabled = true; btn.innerText = '正在执行全量同步...'; }
  try {
    var resp = await fetch('/api/admin/sync/all', { method: 'POST', headers: getHeaders() });
    var res = await resp.json();
    alert(res.message || '全量同步已完成！');
    loadStats();
    loadSources();
  } catch(e) { alert('同步异常: ' + e.message); }
  finally { if (btn) { btn.disabled = false; btn.innerText = '🔄 立即触发全量多源聚合同步'; } }
}

async function searchKey() {
  var input = document.getElementById('keySearchInput');
  var val = (input ? input.value : '').trim();
  if (!val) return;
  var container = document.getElementById('keySearchResult');
  if (container) { container.style.display = 'block'; container.innerHTML = '<div style="color:#64748b;">正在检索云端 28.8万条密钥库...</div>'; }
  try {
    var resp = await fetch('/api/metadata/' + encodeURIComponent(val) + '?name=' + encodeURIComponent(val), { headers: getHeaders() });
    var res = await resp.json();
    if (res && res.success && res.data) {
      var d = res.data;
      var depotsHtml = (d.depots || []).map(function(dp) {
        return '<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;justify-content:space-between;align-items:center;font-size:11px;">' +
          '<span>DepotID: <strong style="color:#38bdf8;">' + dp.depotId + '</strong></span>' +
          '<code style="color:' + (dp.depotKey ? '#34d399' : '#64748b') + ';font-size:11px;">' + (dp.depotKey || '未匹配到 AES 密钥') + '</code>' +
        '</div>';
      }).join('');

      container.innerHTML = '<div style="margin-bottom:12px;">' +
        '<strong style="color:#fff;font-size:15px;">' + escapeHtml(d.name || d.appId) + '</strong> ' +
        '<span class="badge badge-blue">AppID: ' + d.appId + '</span> ' +
        (d.accessToken ? '<span class="badge badge-green">Token: ' + d.accessToken + '</span>' : '') +
      '</div>' +
      '<div>' + (depotsHtml || '<div style="color:#64748b;">无分包数据</div>') + '</div>';
    } else {
      if (container) container.innerHTML = '<div style="color:#fb7185;">未检索到 AppID ' + val + ' 的元数据记录</div>';
    }
  } catch(e) { if (container) container.innerHTML = '<div style="color:#fb7185;">检索异常: ' + e.message + '</div>'; }
}

function openNoticeModal() { document.getElementById('noticeModal').style.display = 'flex'; }
function openVersionModal() { document.getElementById('versionModal').style.display = 'flex'; }
function openPushModal(ver) { document.getElementById('pushVersion').value = ver || ''; document.getElementById('pushModal').style.display = 'flex'; }
function previewNotice(id) {
  var n = noticesCache.find(function(x) { return String(x.id) === String(id); });
  if (!n) return;
  document.getElementById('previewTitle').innerText = n.title;
  document.getElementById('previewContent').innerText = n.content;
  document.getElementById('previewModal').style.display = 'flex';
}

function closeModal(id) { document.getElementById(id).style.display = 'none'; }

async function handleNoticeSubmit() {
  var title = (document.getElementById('noticeTitle').value || '').trim();
  var content = (document.getElementById('noticeContent').value || '').trim();
  if (!title || !content) { alert('请填写公告标题与内容'); return; }
  var payload = { title: title, type: document.getElementById('noticeType').value, level: document.getElementById('noticeLevel').value, priority: parseInt(document.getElementById('noticePriority').value, 10) || 10, targetVersion: document.getElementById('noticeVersion').value || '*', content: content, enabled: true };
  try {
    var resp = await fetch('/api/admin/notices', { method: 'POST', headers: getHeaders(), body: JSON.stringify(payload) });
    var res = await resp.json();
    if (res && res.success) { closeModal('noticeModal'); loadNotices(); alert('公告已发布！'); }
    else { alert('失败: ' + (res.message || '未知错误')); }
  } catch(err) { alert('失败: ' + err.message); }
}

async function handleVersionSubmit() {
  var ver = (document.getElementById('verNumber').value || '').trim();
  var title = (document.getElementById('verTitle').value || '').trim();
  if (!ver || !title) { alert('请填写版本号与标题'); return; }
  var changelog = document.getElementById('verChangelog').value.split('\\n').map(function(s) { return s.trim(); }).filter(Boolean);
  var payload = { version: ver, releaseDate: document.getElementById('verDate').value, title: title, downloadUrl: document.getElementById('verUrl').value, forceUpdate: document.getElementById('verForce').checked, changelog: changelog, enabled: true };
  try {
    var resp = await fetch('/api/admin/versions', { method: 'POST', headers: getHeaders(), body: JSON.stringify(payload) });
    var res = await resp.json();
    if (res && res.success) { closeModal('versionModal'); loadVersions(); alert('新版本已发布！'); }
    else { alert('失败: ' + (res.message || '未知错误')); }
  } catch(err) { alert('失败: ' + err.message); }
}

async function handlePushSubmit() {
  var ver = (document.getElementById('pushVersion').value || '').trim();
  var title = (document.getElementById('pushTitle').value || '').trim();
  var content = (document.getElementById('pushContent').value || '').trim();
  if (!ver || !title) { alert('请填写目标版本与推送标题'); return; }
  var payload = { version: ver, title: title, content: content };
  try {
    var resp = await fetch('/api/admin/versions/push', { method: 'POST', headers: getHeaders(), body: JSON.stringify(payload) });
    var res = await resp.json();
    if (res && res.success) { closeModal('pushModal'); alert('全网版本推送广播发起成功！'); }
    else { alert('推送失败: ' + (res.message || '未知错误')); }
  } catch(err) { alert('推送失败: ' + err.message); }
}

async function toggleNotice(id, enable) {
  await fetch('/api/admin/notices/' + id + '/toggle', { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ enabled: enable }) });
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
  try { var d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
  catch(e) { return iso; }
}

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function loadAllData() {
  loadStats();
  loadLicensesData(1);
  loadNotices();
  loadVersions();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkAuth);
} else {
  checkAuth();
}
window.onload = checkAuth;
`;
