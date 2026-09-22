// SteamMaster Admin Dashboard Script (TypeScript Exported, 100% ESM Safe & Standalone)
export const ADMIN_JS = `
var authToken = localStorage.getItem('steammaster_admin_token') || '';
var noticesCache = [];
var versionsCache = [];
var currentLicPage = 1;
var currentLicTotalPages = 1;
var currentLicList = [];
var currentDevPage = 1;
var currentDevTotalPages = 1;
var currentDevList = [];
var currentInvitePage = 1;
var currentInviteTotalPages = 1;

function getHeaders() {
  var t = authToken || localStorage.getItem('steammaster_admin_token') || '';
  return {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + t
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

var authInitialized = false;

function checkAuth() {
  var t = authToken || localStorage.getItem('steammaster_admin_token') || '';
  var loginSec = document.getElementById('loginSection');
  var dashSec = document.getElementById('dashboardSection');
  if (t) {
    authToken = t;
    if (loginSec) { loginSec.classList.add('d-none'); loginSec.style.cssText = 'display: none !important;'; }
    if (dashSec) { dashSec.classList.remove('d-none'); dashSec.style.cssText = 'display: block !important;'; }
    // 防止 DOMContentLoaded 与 window.onload 双重触发导致 loadAllData 重复执行
    if (!authInitialized) {
      authInitialized = true;
      loadAllData();
    }
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
      showNotice('error', (data && data.message) ? data.message : '账号或密码错误');
    }
  } catch (err) {
    showNotice('error', '连接服务器失败: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<span>安全登录控制台</span>'; }
  }
}

function handleLogout() {
  authToken = '';
  authInitialized = false;
  localStorage.removeItem('steammaster_admin_token');
  checkAuth();
}

// ==================== 白天 / 黑夜模式切换 ====================

function applyTheme(theme) {
  var btn = document.getElementById('themeToggleBtn');
  if (theme === 'light') {
    document.documentElement.classList.add('light');
  } else {
    document.documentElement.classList.remove('light');
  }
  if (btn) btn.innerText = theme === 'light' ? '🌙 黑夜模式' : '☀️ 白天模式';
}

function toggleTheme() {
  var next = document.documentElement.classList.contains('light') ? 'dark' : 'light';
  localStorage.setItem('steammaster_admin_theme', next);
  applyTheme(next);
}

applyTheme(localStorage.getItem('steammaster_admin_theme') === 'light' ? 'light' : 'dark');

function switchTab(tabId, el) {
  document.querySelectorAll('.tab-btn').forEach(function(btn) { btn.classList.remove('active'); });
  document.querySelectorAll('.tab-content').forEach(function(c) { c.classList.add('d-none'); c.style.cssText = 'display: none !important;'; });
  if (el) { el.classList.add('active'); } else { var f = document.querySelector('.tab-btn[onclick*="' + tabId + '"]'); if (f) f.classList.add('active'); }
  var target = document.getElementById('tab-' + tabId);
  if (target) { target.classList.remove('d-none'); target.style.cssText = 'display: block !important;'; }
  if (tabId === 'licenses') loadLicensesData(1);
  if (tabId === 'devices') loadDevicesData(1);
  if (tabId === 'notices') loadNotices();
  if (tabId === 'versions') loadVersions();
  if (tabId === 'sources') loadSources();
  if (tabId === 'invite') loadInviteData(1);
  if (tabId === 'security') { loadAuditLogs(); loadAdminSettings(); }
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

    var devResp = await fetch('/api/admin/devices/stats', { headers: getHeaders() });
    if (devResp.status === 401) { handleLogout(); return; }
    var devRes = await devResp.json();
    if (devRes && devRes.success && devRes.data) {
      var ds = devRes.data;
      var kDevTot = document.getElementById('kpiDevTotal'); if (kDevTot) kDevTot.innerText = (ds.totalDevices || 0).toLocaleString() + ' 台';
      var kDevToday = document.getElementById('kpiDevToday'); if (kDevToday) kDevToday.innerText = (ds.todayActiveDevices || 0).toLocaleString() + ' 台';
    }
  } catch(e) { console.warn('loadStats error:', e); }
}

// ==================== 激活码管理模块 ====================

var TYPE_MAP = {
  'trial': { label: '体验卡 (30天/设备限1次)', badge: 'badge-purple' },
  'monthly': { label: '月卡 (30天)', badge: 'badge-blue' },
  'quarterly': { label: '季卡 (90天)', badge: 'badge-green' },
  'yearly': { label: '年卡 (365天)', badge: 'badge-amber' },
  'lifetime': { label: '永久尊享卡', badge: 'badge-rose' },
  'invite': { label: '邀请奖励卡', badge: 'badge-amber' }
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
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:24px;">正在载入激活码列表...</td></tr>';

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
        elBreakdown.innerText = '体验: ' + (st.trialCount || 0) + ' · 月: ' + (st.monthlyCount || 0) + ' · 季: ' + (st.quarterlyCount || 0) + ' · 年: ' + (st.yearlyCount || 0) + ' · 永久: ' + (st.lifetimeCount || 0) + ' · 邀请: ' + (st.inviteCount || 0);
      }

      // 渲染表格
      if (!currentLicList.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:24px;">暂无匹配的激活码记录</td></tr>';
      } else {
        tbody.innerHTML = currentLicList.map(function(item) {
          var tInfo = TYPE_MAP[item.type] || { label: item.type, badge: 'badge-blue' };
          var sInfo = STATUS_MAP[item.status] || { label: item.status, badge: 'badge-gray' };
          var deviceStr = item.deviceId ? '<code style="color:var(--c-blue);font-size:11px;word-break:break-all;">' + escapeHtml(item.deviceId) + '</code>' : '<span style="color:var(--text-dim);">-</span>';
          var boundStr = item.boundAt ? formatTime(item.boundAt) : '<span style="color:var(--text-dim);">-</span>';
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
            '<button onclick="copyLicenseCode(\\'' + attrSafe(item.code) + '\\')" class="btn btn-secondary btn-sm" title="复制卡密">复制</button>'
          ];

          if (item.deviceId) {
            actionBtns.push('<button onclick="handleUnbindLicense(\\'' + attrSafe(item.code) + '\\')" class="btn btn-secondary btn-sm" style="color:var(--c-amber);" title="解绑设备">解绑</button>');
          }

          if (item.type !== 'lifetime') {
            actionBtns.push('<button onclick="openExtendLicenseModal(\\'' + attrSafe(item.code) + '\\')" class="btn btn-secondary btn-sm" style="color:var(--c-blue);" title="延长有效期">延期</button>');
          }

          if (item.status === 'disabled') {
            actionBtns.push('<button onclick="handleToggleLicense(\\'' + attrSafe(item.code) + '\\',false)" class="btn btn-secondary btn-sm" style="color:var(--c-green);">启用</button>');
          } else {
            actionBtns.push('<button onclick="handleToggleLicense(\\'' + attrSafe(item.code) + '\\',true)" class="btn btn-secondary btn-sm" style="color:var(--c-rose);">冻结</button>');
          }

          actionBtns.push('<button onclick="handleDeleteLicense(\\'' + attrSafe(item.code) + '\\')" class="btn btn-danger btn-sm">删除</button>');

          return '<tr>' +
            '<td><strong style="color:var(--text-strong);font-family:monospace;font-size:12px;">' + escapeHtml(item.code) + '</strong></td>' +
            '<td><span class="badge ' + tInfo.badge + '">' + tInfo.label + '</span></td>' +
            '<td><span class="badge ' + sInfo.badge + '">' + sInfo.label + '</span></td>' +
            '<td>' + deviceStr + '</td>' +
            '<td>' + boundStr + '</td>' +
            '<td>' + expStr + '</td>' +
            '<td style="color:var(--text-mid);font-size:11px;">' + escapeHtml(item.remark || '-') + '</td>' +
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
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--c-rose);padding:24px;">载入异常: ' + escapeHtml(e && e.message ? e.message : String(e)) + '</td></tr>';
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
  if (notice) {
    notice.classList.add('d-none');
    notice.style.display = 'none';
  }
  var btn = document.getElementById('btnDoGenLicense');
  if (btn) {
    btn.disabled = false;
    btn.innerText = '立即批量生成';
  }
  var m = document.getElementById('generateLicenseModal');
  if (m) m.style.display = 'flex';
}

async function handleGenerateLicenseSubmit() {
  var type = document.getElementById('genLicType').value;
  var count = parseInt(document.getElementById('genLicCount').value, 10) || 1;
  var prefix = (document.getElementById('genLicPrefix').value || '').trim();
  var remark = (document.getElementById('genLicRemark').value || '').trim();
  var btn = document.getElementById('btnDoGenLicense');
  var notice = document.getElementById('genLicNotice');
  var txt = document.getElementById('genLicNoticeText');

  if (count < 1 || count > 500) {
    alert('生成数量需在 1 ~ 500 之间');
    return;
  }

  if (btn) { btn.disabled = true; btn.innerText = '正在批量生成...'; }
  try {
    var resp = await fetch('/api/admin/license/generate', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ type: type, count: count, prefix: prefix, remark: remark })
    });
    var res = await resp.json();
    if (res && res.success) {
      if (notice && txt) {
        notice.className = 'alert-box alert-success';
        txt.innerText = res.message || ('成功生成 ' + count + ' 张激活码！');
        notice.classList.remove('d-none');
        notice.style.display = 'flex';
      }
      loadLicensesData(1);
      setTimeout(function() {
        closeModal('generateLicenseModal');
      }, 1000);
    } else {
      if (notice && txt) {
        notice.className = 'alert-box alert-error';
        txt.innerText = res.message || '生成失败';
        notice.classList.remove('d-none');
        notice.style.display = 'flex';
      } else {
        alert('生成失败: ' + (res.message || '未知错误'));
      }
    }
  } catch(e) {
    alert('请求异常: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '立即批量生成'; }
  }
}

function openExtendLicenseModal(code) {
  document.getElementById('extLicCode').value = code;
  var m = document.getElementById('extendLicenseModal');
  if (m) m.style.display = 'flex';
}

async function handleExtendLicenseSubmit() {
  var code = document.getElementById('extLicCode').value;
  var daysRaw = (document.getElementById('extLicDays').value || '').trim();
  var days = parseInt(daysRaw, 10);
  if (!daysRaw || !isFinite(days) || days < 1 || String(days) !== daysRaw) {
    alert('请输入大于等于 1 的整数延期天数');
    return;
  }
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

// ==================== 客户端设备管理模块 ====================

async function loadDevicesData(page) {
  if (page) currentDevPage = page;
  var searchInput = document.getElementById('devSearchInput');
  var statusFilter = document.getElementById('devStatusFilter');

  var q = searchInput ? encodeURIComponent(searchInput.value.trim()) : '';
  var s = statusFilter ? statusFilter.value : 'all';

  var tbody = document.getElementById('deviceTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:24px;">正在载入客户端设备档案...</td></tr>';

  try {
    var url = '/api/admin/devices/list?page=' + currentDevPage + '&limit=20&search=' + q + '&status=' + s;
    var resp = await fetch(url, { headers: getHeaders() });
    if (resp.status === 401) { handleLogout(); return; }
    var res = await resp.json();
    if (res && res.success && res.data) {
      var d = res.data;
      currentDevList = d.list || [];
      var total = d.total || 0;
      var limit = d.limit || 20;
      currentDevTotalPages = Math.ceil(total / limit) || 1;

      // 更新 KPI
      var st = d.stats || {};
      var elTot = document.getElementById('kpiDevTabTotal'); if (elTot) elTot.innerText = (st.totalDevices || 0).toLocaleString() + ' 台';
      var elToday = document.getElementById('kpiDevTabToday'); if (elToday) elToday.innerText = (st.todayActiveDevices || 0).toLocaleString() + ' 台';
      var elWeek = document.getElementById('kpiDevTabWeek'); if (elWeek) elWeek.innerText = (st.weeklyActiveDevices || 0).toLocaleString() + ' 台';
      var elAct = document.getElementById('kpiDevTabAct'); if (elAct) elAct.innerText = (st.activatedDevices || 0).toLocaleString() + ' 台';

      // 渲染表格
      if (!currentDevList.length) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:24px;">暂无匹配的客户端设备记录</td></tr>';
      } else {
        tbody.innerHTML = currentDevList.map(function(item) {
          // 激活的设备显示具体卡种（月卡/季卡/年卡/永久/体验卡），未激活显示基础版
          var licBadge;
          if (item.isActivated) {
            var tInfo = TYPE_MAP[item.licenseType];
            var tLabel = tInfo ? tInfo.label : '已激活会员';
            var tCls = tInfo ? ('badge ' + tInfo.badge) : 'badge badge-green';
            licBadge = '<span class="' + tCls + '" title="激活卡种">👑 ' + escapeHtml(tLabel) + '</span>';
          } else {
            licBadge = '<span class="badge badge-gray">未激活 (基础版)</span>';
          }
          var devStr = '<strong style="color:var(--text-strong);font-family:monospace;font-size:12px;">' + escapeHtml(item.deviceId) + '</strong>';
          var ipStr = '<code style="color:var(--text-mid);font-size:11px;">' + escapeHtml(item.ip || '-') + '</code>';
          var verStr = '<span class="badge badge-blue">v' + escapeHtml(item.clientVersion || '1.0.0') + '</span>';
          var firstStr = formatTime(item.firstSeenAt);
          var lastStr = formatTime(item.lastSeenAt);

          return '<tr>' +
            '<td>' + devStr + '</td>' +
            '<td>' + licBadge + '</td>' +
            '<td>' + verStr + '</td>' +
            '<td>' + ipStr + '</td>' +
            '<td>' + escapeHtml(item.osVersion || 'Windows') + '</td>' +
            '<td>' + firstStr + '</td>' +
            '<td><strong style="color:var(--c-green);">' + lastStr + '</strong></td>' +
            '<td style="text-align:right;white-space:nowrap;">' +
              '<button onclick="deleteDevice(\\'' + attrSafe(item.deviceId) + '\\')" class="btn btn-danger btn-sm">删除</button>' +
            '</td>' +
          '</tr>';
        }).join('');
      }

      // 更新分页
      var elPg = document.getElementById('devicePageInfo');
      if (elPg) elPg.innerText = '第 ' + currentDevPage + ' / ' + currentDevTotalPages + ' 页 · 共 ' + total + ' 台设备';
      var btnPrev = document.getElementById('devBtnPrev');
      var btnNext = document.getElementById('devBtnNext');
      if (btnPrev) btnPrev.disabled = currentDevPage <= 1;
      if (btnNext) btnNext.disabled = currentDevPage >= currentDevTotalPages;
    }
  } catch(e) {
    console.error('loadDevicesData error:', e);
    if (tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--c-rose);padding:24px;">载入异常: ' + escapeHtml(e && e.message ? e.message : String(e)) + '</td></tr>';
  }
}

async function deleteDevice(deviceId) {
  if (!confirm('确定删除设备 ' + deviceId + ' 的监控档案吗？\\n\\n· 仅删除该设备的活跃度监控记录，不影响其激活码授权绑定\\n· 若该设备再次上线，档案会自动重建')) return;
  try {
    var resp = await fetch('/api/admin/devices/' + encodeURIComponent(deviceId), { method: 'DELETE', headers: getHeaders() });
    var res = await resp.json();
    if (res && res.success) {
      loadDevicesData(currentDevPage);
      loadStats();
    } else {
      alert('删除失败: ' + (res.message || '未知错误'));
    }
  } catch(e) { alert('请求异常: ' + e.message); }
}

async function cleanupDevices() {
  var input = prompt('清理多少天以上未活跃的设备档案？', '30');
  if (input === null) return;
  var days = parseInt(input, 10);
  if (isNaN(days) || days < 1 || days > 365) { alert('请输入 1 ~ 365 之间的天数'); return; }
  if (!confirm('确定清理 ' + days + ' 天以上未活跃的设备档案吗？\\n（仅删除监控记录，不影响授权绑定；在线设备会自动重建档案）')) return;
  try {
    var resp = await fetch('/api/admin/devices/cleanup', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ days: days })
    });
    var res = await resp.json();
    alert(res.message || '清理完成');
    loadDevicesData(1);
    loadStats();
  } catch(e) { alert('请求异常: ' + e.message); }
}

function changeDevicePage(delta) {
  var target = currentDevPage + delta;
  if (target >= 1 && target <= currentDevTotalPages) {
    loadDevicesData(target);
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
      if (!noticesCache.length) { tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;color:var(--text-dim);padding:24px;">暂无公告记录</td></tr>'; return; }
      tbody.innerHTML = noticesCache.map(function(n) {
        return '<tr>' +
          '<td><span class="badge ' + (n.enabled ? 'badge-green' : 'badge-gray') + '">' + (n.enabled ? '启用中' : '已停用') + '</span></td>' +
          '<td><strong>' + escapeHtml(n.title) + '</strong></td>' +
          '<td>' + (n.type === 'popup' ? '弹窗' : '横幅') + (n.interaction === 'consent' ? ' <span class="badge badge-rose">同意制</span>' : '') + '</td>' +
          '<td>' + escapeHtml(n.level || 'info') + '</td>' +
          '<td>' + escapeHtml(String(n.priority || 0)) + '</td>' +
          '<td>' + (n.popupOnce ? '<span class="badge badge-amber">仅弹一次</span>' : '<span class="badge badge-blue">每次启动</span>') + '</td>' +
          '<td>' + escapeHtml(n.targetVersion || '*') + '</td>' +
          '<td>' + formatTime(n.updatedAt) + '</td>' +
          '<td style="text-align:right;white-space:nowrap;">' +
            '<button onclick="previewNotice(\\'' + safeId(n.id) + '\\')" class="btn btn-secondary btn-sm" style="color:var(--c-blue);">预览</button> ' +
            '<button onclick="editNotice(\\'' + safeId(n.id) + '\\')" class="btn btn-secondary btn-sm" style="color:var(--c-green);">编辑</button> ' +
            '<button onclick="toggleNotice(\\'' + safeId(n.id) + '\\',' + (!n.enabled) + ')" class="btn btn-secondary btn-sm">' + (n.enabled ? '停用' : '启用') + '</button> ' +
            '<button onclick="deleteNotice(\\'' + safeId(n.id) + '\\')" class="btn btn-danger btn-sm">删除</button>' +
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
      if (!versionsCache.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:24px;">暂无版本记录</td></tr>'; return; }
      tbody.innerHTML = versionsCache.map(function(v) {
        return '<tr>' +
          '<td><strong style="color:var(--c-blue);font-family:monospace;">v' + escapeHtml(v.version) + '</strong></td>' +
          '<td>' + escapeHtml(v.releaseDate || '-') + '</td>' +
          '<td>' + escapeHtml(v.title || '-') + '</td>' +
          '<td>' + (v.forceUpdate ? '<span class="badge badge-rose">强制全量</span>' : '<span class="badge badge-blue">推荐更新</span>') + '</td>' +
          '<td><span class="badge ' + (v.enabled ? 'badge-green' : 'badge-gray') + '">' + (v.enabled ? '活跃上线' : '已归档') + '</span></td>' +
          '<td style="text-align:right;">' +
            '<button onclick="openPushModal(\\'' + attrSafe(v.version) + '\\')" class="btn btn-secondary btn-sm" style="color:var(--c-amber);">全网广播</button> ' +
            '<button onclick="deleteVersion(\\'' + attrSafe(v.version) + '\\')" class="btn btn-danger btn-sm">删除</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }
  } catch(e) { console.warn('loadVersions error:', e); }
}

async function loadSources() {
  try {
    var resp = await fetch('/api/sources', { headers: getHeaders() });
    if (resp.status === 401) { handleLogout(); return; }
    var res = await resp.json();
    var grid = document.getElementById('sourcesGrid');
    if (res && res.success && grid) {
      var sources = res.data || [];
      grid.innerHTML = sources.map(function(s) {
        return '<div class="card" style="display:flex;flex-direction:column;justify-content:space-between;">' +
          '<div>' +
            '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
              '<strong style="color:var(--text-strong);font-size:13px;">' + escapeHtml(s.name) + '</strong>' +
              '<span class="badge badge-green">● 正常</span>' +
            '</div>' +
            '<p style="color:var(--text-mid);font-size:11px;margin-bottom:12px;line-height:1.5;">' + escapeHtml(s.description) + '</p>' +
            '<div style="font-size:11px;color:var(--text-dim);font-family:monospace;margin-bottom:6px;">收录总量: <strong style="color:var(--c-blue);">' + (s.totalRecordsCount || 0).toLocaleString() + ' 条</strong></div>' +
            '<div style="font-size:11px;color:var(--text-dim);">同步频率: ' + escapeHtml(s.syncFrequency || '24h') + '</div>' +
          '</div>' +
          '<div style="margin-top:14px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);display:flex;justify-content:space-between;align-items:center;">' +
            '<span style="font-size:10px;color:var(--text-dim);">维护: ' + escapeHtml(s.author || '社区') + '</span>' +
            '<a href="' + (/^https?:\\/\\//i.test(s.sourceUrl || '') ? escapeHtml(s.sourceUrl) : '#') + '" target="_blank" rel="noopener noreferrer" style="font-size:11px;color:var(--c-blue);">上游主页 ➔</a>' +
          '</div>' +
        '</div>';
      }).join('');
    }
  } catch(e) { console.warn('loadSources error:', e); }
}

/**
 * 取码源体检：并发探测每一个上游取码源，渲染状态码 / 延迟 / 判定说明。
 *
 * 为什么需要它：上游挂掉时，过去只能从用户反馈或 diag 日志里间接推断是哪一跳坏了。
 * 这个按钮把「逐源快照」直接摆到管理台，尤其能一眼看出 Cloudflare 52x 这类
 * 源站级故障（它会被判为 transient，既不熔断也不写负缓存，只看日志很难定位）。
 */
/**
 * 一键极速测 Ping（对标 Fluent Steam Lua 连通测试）：
 * 毫秒级探测各源服务器域名解析、TCP握手与网络延迟，判定源站是否存活在线。
 * 完全无需输入任何参数，点击即测！
 */
async function pingManifestSources() {
  var btn = document.getElementById('pingSourcesBtn');
  var out = document.getElementById('probeResult');
  if (!out) return;

  if (btn) { btn.disabled = true; btn.innerText = '测速中...'; }
  out.innerHTML = '<div style="color:var(--text-mid);font-size:12px;">正在并发测试各上游清单源网络连通性与 Ping 延迟（最长约 5 秒）...</div>';

  try {
    var resp = await fetch('/api/admin/manifests/sources?type=ping', { headers: getHeaders() });
    if (resp.status === 401) { handleLogout(); return; }
    var json = await resp.json();
    if (!json || !json.success) {
      out.innerHTML = '<div style="color:var(--c-rose);font-size:12px;">连通测试失败：' + escapeHtml((json && json.message) || '未知错误') + '</div>';
      return;
    }
    var d = json.data || {};
    var rows = (d.probes || []).map(function(p) {
      var badge = p.ok
        ? '<span class="badge badge-green">✅ 连通正常</span>'
        : (p.httpStatus ? '<span class="badge badge-rose">✖ 响应异常</span>' : '<span class="badge badge-rose">✖ 无法连接</span>');
      var latency = p.latencyMs >= 0 ? (p.latencyMs + ' ms') : '—';
      // 失败（-1）必须是灰色「—」，而不是落进琥珀档 —— 否则红色「✖ 无法连接」
      // 徽章旁边却显示琥珀色延迟，视觉上自相矛盾
      var latencyColor = p.latencyMs < 0
        ? 'var(--text-dim)'
        : (p.latencyMs < 500 ? 'var(--c-green)' : (p.latencyMs < 1500 ? 'var(--c-amber)' : 'var(--c-rose)'));
      return '<tr>' +
        '<td style="white-space:nowrap;"><strong>' + escapeHtml(p.label) + '</strong></td>' +
        '<td style="font-family:monospace;font-size:11px;color:var(--text-dim);">' + escapeHtml(p.host) + '</td>' +
        '<td style="font-family:monospace;color:' + latencyColor + ';font-weight:700;">' + latency + '</td>' +
        '<td style="font-family:monospace;color:var(--text-dim);">' + (p.httpStatus === null ? '—' : ('HTTP ' + p.httpStatus)) + '</td>' +
        '<td>' + badge + '</td>' +
        '<td style="color:var(--text-mid);font-size:12px;">' + escapeHtml(p.detail) + '</td>' +
      '</tr>';
    }).join('');

    out.innerHTML =
      '<div style="font-size:12px;color:var(--c-green);font-weight:700;margin-bottom:10px;">' +
        '⚡ 上游清单源连通性测试快照（检测时间：' + new Date().toLocaleTimeString() + '）' +
      '</div>' +
      '<div class="table-container"><table><thead><tr>' +
        '<th>源名称</th><th>探测地址</th><th>Ping 延迟</th><th>响应码</th><th>连通状态</th><th>判定说明</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  } catch (e) {
    out.innerHTML = '<div style="color:var(--c-rose);font-size:12px;">连通测试请求异常：' + escapeHtml(e && e.message ? e.message : String(e)) + '</div>';
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '⚡ 一键测Ping (连通测试)'; }
  }
}

async function checkManifestSources() {
  var btn = document.getElementById('probeSourcesBtn');
  var out = document.getElementById('probeResult');
  if (!out) return;

  var depotId = ((document.getElementById('probeDepotId') || {}).value || '').trim();
  var gid = ((document.getElementById('probeGid') || {}).value || '').trim();

  // 输入校验：要么两项全空（走自动探测），要么两项同时填写有效数字。
  // 上游码库以 (depot, gid) 为联合键，服务端校验到任一项非法就会把两者一起清空并
  // 退回「码库最新记录」——必须在前端显式提示，防止用户误以为探测的是自己输入的值。
  if (depotId || gid) {
    if (!depotId || !gid) {
      out.innerHTML =
        '<div style="color:var(--c-amber);font-size:12px;line-height:1.7;padding:10px 12px;border-radius:8px;background:rgba(245,158,11,.10);">' +
          '⚠️ 自定义探针需要 depotId 与 gid <strong>同时填写</strong>（上游码库以 (depot, gid) 为联合键，缺一不可）。<br>' +
          '当前只填了 <code>' + (depotId ? 'depotId' : 'gid') + '</code>，会被退回「码库最新记录」，你填的值将被忽略。<br>' +
          '请补齐另一项后重试，或<strong>清空两项</strong>直接使用自动探测。' +
        '</div>';
      return;
    }
    if (!/^\d+$/.test(depotId) || !/^\d+$/.test(gid) || gid === '0') {
      out.innerHTML =
        '<div style="color:var(--c-amber);font-size:12px;line-height:1.7;padding:10px 12px;border-radius:8px;background:rgba(245,158,11,.10);">' +
          '⚠️ depotId 与 gid 必须为<strong>大于 0 的纯数字</strong>。<br>' +
          '输入包含非法字符或 gid 为 0 时将被服务端忽略并退回自动探测。请修正后重试，或<strong>清空两项</strong>直接使用自动探测。' +
        '</div>';
      return;
    }
  }

  var qs = [];
  if (depotId) qs.push('depotId=' + encodeURIComponent(depotId));
  if (gid) qs.push('gid=' + encodeURIComponent(gid));
  var url = '/api/admin/manifests/sources' + (qs.length ? ('?' + qs.join('&')) : '');

  if (btn) { btn.disabled = true; btn.innerText = '探测中...'; }
  out.innerHTML = '<div style="color:var(--text-mid);font-size:12px;">正在并发探测各上游源（最长约 20 秒）...</div>';

  try {
    var resp = await fetch(url, { headers: getHeaders() });
    if (resp.status === 401) { handleLogout(); return; }
    var json = await resp.json();
    if (!json || !json.success) {
      out.innerHTML = '<div style="color:var(--c-rose);font-size:12px;">体检失败：' + escapeHtml((json && json.message) || '未知错误') + '</div>';
      return;
    }
    var d = json.data || {};
    if (!d.probe) {
      out.innerHTML = '<div style="color:var(--c-amber);font-size:12px;">' + escapeHtml(d.note || '无法选定探针目标') + '</div>';
      return;
    }

    var rows = (d.probes || []).map(function(p) {
      // 状态徽章：出码=绿；404/401=蓝（该源在线但没有该特定清单）；429/403/5xx=琥珀或红
      var badge = p.ok
        ? '<span class="badge badge-green">✅ 出码成功</span>'
        : (p.httpStatus === 404 || p.httpStatus === 401)
          ? '<span class="badge" style="background:rgba(56,189,248,.15);color:var(--c-blue);">○ 连通在线 (库无此清单)</span>'
          : '<span class="badge badge-rose">✖ 异常</span>';
      var latency = p.latencyMs >= 0 ? (p.latencyMs + ' ms') : '—';
      // 各源码值是否一致：不一致时给"出码成功"的源加警标记号，
      // 因为滞后码同样是 HTTP 200 + 纯数字，只看徽章区分不出来
      var fpCell = p.codeFingerprint
        ? '<code style="font-family:monospace;font-size:11px;color:var(--c-blue);">' + escapeHtml(p.codeFingerprint) + '</code>'
        : '<span style="color:var(--text-dim);">—</span>';
      var mismatchMark = (d.codeConsistent === false && p.ok)
        ? ' <span class="badge badge-amber" title="该源返回的码与其它源不一致，可能是滞后值">码值不一致</span>'
        : '';
      return '<tr>' +
        '<td style="white-space:nowrap;"><strong>' + escapeHtml(p.label) + '</strong></td>' +
        '<td style="font-family:monospace;color:var(--text-dim);">' + (p.httpStatus === null ? '—' : p.httpStatus) + '</td>' +
        '<td style="font-family:monospace;color:var(--text-mid);">' + latency + '</td>' +
        '<td>' + fpCell + '</td>' +
        '<td>' + badge + mismatchMark + '</td>' +
        '<td style="color:var(--text-mid);font-size:12px;">' + escapeHtml(p.detail) + '</td>' +
      '</tr>';
    }).join('');

    var sourceLabel = d.probe.from === 'override'
      ? '手动指定'
      : (d.probe.from === 'preset' ? '预设测试 ID（码库暂无带 depotId 的记录）' : '码库中最新鲜的一条');
    var noteBg = d.codeConsistent === false ? 'rgba(245,158,11,.10)' : 'rgba(56,189,248,.06)';
    var noteColor = d.codeConsistent === false ? 'var(--c-amber)' : 'var(--text-mid)';

    out.innerHTML =
      '<div style="font-size:12px;color:var(--text-mid);margin-bottom:10px;line-height:1.6;">' +
        '探针 <code style="color:var(--c-blue);">depotId=' + escapeHtml(d.probe.depotId) + '</code> / ' +
        '<code style="color:var(--c-blue);">gid=' + escapeHtml(d.probe.gid) + '</code>' +
        '（来源：' + escapeHtml(sourceLabel) + '）' +
      '</div>' +
      '<div class="table-container"><table><thead><tr>' +
        '<th>源</th><th>状态码</th><th>延迟</th><th>码值指纹</th><th>结果</th><th>说明</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div style="font-size:12px;color:' + noteColor + ';margin-top:12px;padding:10px 12px;border-radius:8px;background:' + noteBg + ';line-height:1.6;">' +
        escapeHtml(d.note || '') +
      '</div>';
  } catch (e) {
    out.innerHTML = '<div style="color:var(--c-rose);font-size:12px;">体检请求异常：' + escapeHtml(e && e.message ? e.message : String(e)) + '</div>';
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '🩺 出码体检'; }
  }
}

async function loadAuditLogs() {
  try {
    var resp = await fetch('/api/auth/audit-logs', { headers: getHeaders() });
    if (resp.status === 401) { handleLogout(); return; }
    var res = await resp.json();
    var tbody = document.getElementById('auditTableBody');
    if (res && res.success && tbody) {
      var logs = res.data || [];
      if (!logs.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:24px;">暂无审计日志</td></tr>';
        return;
      }
      tbody.innerHTML = logs.map(function(l) {
        var statusBadge = l.success ? '<span class="badge badge-green">成功</span>' : '<span class="badge badge-rose">失败</span>';
        return '<tr>' +
          '<td style="color:var(--text-dim);font-family:monospace;white-space:nowrap;">' + formatTime(l.timestamp || l.time) + '</td>' +
          '<td><strong>' + escapeHtml(l.action) + '</strong></td>' +
          '<td><span class="badge badge-blue">' + escapeHtml(l.operator || 'admin') + '</span></td>' +
          '<td style="color:var(--text-mid);font-family:monospace;">' + escapeHtml(l.ip || '-') + '</td>' +
          '<td style="color:var(--text);">' + escapeHtml(l.details || l.detail || '-') + '</td>' +
          '<td>' + statusBadge + '</td>' +
        '</tr>';
      }).join('');
    }
  } catch(e) { console.warn('loadAuditLogs error:', e); }
}

// ==================== 应用设置：跳转链接 / 未激活免费额度 ====================

async function loadAdminSettings() {
  try {
    var resp = await fetch('/api/admin/settings', { headers: getHeaders() });
    if (resp.status === 401) { handleLogout(); return; }
    var res = await resp.json();
    if (res && res.success && res.data) {
      var links = res.data.links || {};
      var qq = document.getElementById('cfgQqGroupUrl'); if (qq) qq.value = links.qqGroupUrl || '';
      var sp = document.getElementById('cfgSponsorUrl'); if (sp) sp.value = links.sponsorUrl || '';
      var tut = document.getElementById('cfgTutorialUrl'); if (tut) tut.value = links.tutorialUrl || '';
      var faq = document.getElementById('cfgFaqUrl'); if (faq) faq.value = links.faqUrl || '';
      var quota = document.getElementById('cfgFreeDailyLimit');
      if (quota && document.activeElement !== quota) quota.value = String(res.data.freeDailyLimit != null ? res.data.freeDailyLimit : 2);
      var invDays = document.getElementById('cfgInviteRewardDays');
      if (invDays && document.activeElement !== invDays && res.data.inviteRewardDays != null) invDays.value = String(res.data.inviteRewardDays);
    }
  } catch(e) { console.warn('loadAdminSettings error:', e); }

  try {
    var afdianResp = await fetch('/api/admin/sponsors/config', { headers: getHeaders() });
    if (afdianResp.ok) {
      var afRes = await afdianResp.json();
      if (afRes && afRes.success && afRes.data) {
        var uEl = document.getElementById('cfgAfdianUserId'); if (uEl) uEl.value = afRes.data.userId || '';
        var tEl = document.getElementById('cfgAfdianToken'); if (tEl) tEl.value = afRes.data.token || '';
        var sEl = document.getElementById('cfgAfdianAutoSync'); if (sEl) sEl.checked = afRes.data.autoSync !== false;
      }
    }
  } catch(e) { console.warn('loadAfdianConfig error:', e); }
}

async function handleAfdianConfigSubmit() {
  var userId = (document.getElementById('cfgAfdianUserId').value || '').trim();
  var token = (document.getElementById('cfgAfdianToken').value || '').trim();
  var autoSync = !!(document.getElementById('cfgAfdianAutoSync') && document.getElementById('cfgAfdianAutoSync').checked);
  var btn = document.getElementById('btnSaveAfdian');
  var msg = document.getElementById('afdianMsg');
  var msgText = document.getElementById('afdianMsgText');
  if (btn) { btn.disabled = true; btn.innerText = '正在保存...'; }
  try {
    var resp = await fetch('/api/admin/sponsors/config', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ userId: userId, token: token, autoSync: autoSync })
    });
    var res = await resp.json();
    if (res && res.success) {
      if (msg && msgText) { msg.className = 'alert-box alert-success'; msgText.innerText = res.message || '爱发电配置已保存'; msg.classList.remove('d-none'); }
    } else {
      if (msg && msgText) { msg.className = 'alert-box alert-error'; msgText.innerText = res.message || '保存失败'; msg.classList.remove('d-none'); }
    }
  } catch(e) {
    if (msg && msgText) { msg.className = 'alert-box alert-error'; msgText.innerText = '请求异常: ' + e.message; msg.classList.remove('d-none'); }
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '保存爱发电配置'; }
  }
}

async function handleAfdianSyncNow() {
  var btn = document.getElementById('btnSyncAfdian');
  var msg = document.getElementById('afdianMsg');
  var msgText = document.getElementById('afdianMsgText');
  if (btn) { btn.disabled = true; btn.innerText = '🔄 同步中...'; }
  try {
    var resp = await fetch('/api/admin/sponsors/sync', {
      method: 'POST',
      headers: getHeaders()
    });
    var res = await resp.json();
    if (msg && msgText) {
      msg.className = res.success ? 'alert-box alert-success' : 'alert-box alert-amber';
      msgText.innerText = res.message || (res.success ? '同步成功' : '同步未完成');
      msg.classList.remove('d-none');
    }
  } catch(e) {
    if (msg && msgText) { msg.className = 'alert-box alert-error'; msgText.innerText = '同步异常: ' + e.message; msg.classList.remove('d-none'); }
  } finally {
    if (btn) { btn.disabled = false; btn.innerText = '🔄 立即从爱发电同步'; }
  }
}

async function handleLinksSubmit() {
  var qqGroupUrl = (document.getElementById('cfgQqGroupUrl').value || '').trim();
  var sponsorUrl = (document.getElementById('cfgSponsorUrl').value || '').trim();
  var tutorialUrl = (document.getElementById('cfgTutorialUrl').value || '').trim();
  var faqUrl = (document.getElementById('cfgFaqUrl').value || '').trim();
  var btn = document.getElementById('btnSaveLinks');
  if (btn) { btn.disabled = true; btn.innerText = '正在保存...'; }
  try {
    var resp = await fetch('/api/admin/links', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        qqGroupUrl: qqGroupUrl,
        sponsorUrl: sponsorUrl,
        tutorialUrl: tutorialUrl,
        faqUrl: faqUrl
      })
    });
    var res = await resp.json();
    if (res && res.success) {
      alert('跳转链接已保存！客户端即时生效（空 = 暂未开放）');
    } else {
      alert('保存失败: ' + (res.message || '未知错误'));
    }
  } catch(e) { alert('请求异常: ' + e.message); }
  finally { if (btn) { btn.disabled = false; btn.innerText = '保存跳转链接'; } }
}

async function handleFreeQuotaSubmit() {
  var limit = parseInt(document.getElementById('cfgFreeDailyLimit').value, 10);
  if (isNaN(limit) || limit < 0 || limit > 999) { alert('每日免费款数需在 0 ~ 999 之间'); return; }
  var btn = document.getElementById('btnSaveQuota');
  if (btn) { btn.disabled = true; btn.innerText = '正在保存...'; }
  try {
    var resp = await fetch('/api/admin/settings/free-quota', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ limit: limit })
    });
    var res = await resp.json();
    var msg = document.getElementById('quotaMsg');
    var msgText = document.getElementById('quotaMsgText');
    if (res && res.success) {
      if (msg && msgText) { msg.className = 'alert-box alert-success'; msgText.innerText = res.message || '已保存'; msg.classList.remove('d-none'); }
    } else {
      if (msg && msgText) { msg.className = 'alert-box alert-error'; msgText.innerText = res.message || '保存失败'; msg.classList.remove('d-none'); }
      else { alert('保存失败: ' + (res.message || '未知错误')); }
    }
  } catch(e) { alert('请求异常: ' + e.message); }
  finally { if (btn) { btn.disabled = false; btn.innerText = '保存并立即生效'; } }
}

// ==================== 邀请有礼模块 ====================

async function loadInviteData(page) {
  if (page) currentInvitePage = page;
  var searchInput = document.getElementById('inviteSearchInput');
  var q = searchInput ? encodeURIComponent(searchInput.value.trim()) : '';
  var tbody = document.getElementById('inviteTableBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:24px;">正在载入邀请记录...</td></tr>';
  try {
    var resp = await fetch('/api/admin/invite/overview?page=' + currentInvitePage + '&limit=20&search=' + q, { headers: getHeaders() });
    if (resp.status === 401) { handleLogout(); return; }
    var res = await resp.json();
    if (!res || !res.success || !res.data) return;
    var d = res.data;
    var st = d.stats || {};
    var list = d.list || [];
    var total = d.total || 0;
    var limit = d.limit || 20;
    currentInviteTotalPages = Math.ceil(total / limit) || 1;

    var elTotal = document.getElementById('kpiInviteTotal'); if (elTotal) elTotal.innerText = (st.totalBindings || 0).toLocaleString() + ' 次';
    var elPeople = document.getElementById('kpiInvitePeople'); if (elPeople) elPeople.innerText = (st.totalInviters || 0) + ' / ' + (st.totalInvitees || 0);
    var elDays = document.getElementById('kpiInviteDays'); if (elDays) elDays.innerText = (st.totalDaysGranted || 0).toLocaleString() + ' 天';
    var elToday = document.getElementById('kpiInviteToday'); if (elToday) elToday.innerText = (st.todayBindings || 0) + ' 次';
    var invDays = document.getElementById('cfgInviteRewardDays');
    if (invDays && document.activeElement !== invDays && st.rewardDays != null) invDays.value = String(st.rewardDays);

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-dim);padding:24px;">暂无匹配的邀请记录</td></tr>';
    } else {
      tbody.innerHTML = list.map(function(item) {
        return '<tr>' +
          '<td><strong style="color:var(--text-strong);font-family:monospace;font-size:12px;">' + escapeHtml(item.inviteCodeDisplay || item.inviteCode || '-') + '</strong></td>' +
          '<td><code style="color:var(--c-blue);font-size:11px;word-break:break-all;">' + escapeHtml(item.inviterDeviceId || '-') + '</code></td>' +
          '<td><code style="color:var(--c-green);font-size:11px;word-break:break-all;">' + escapeHtml(item.inviteeDeviceId || '-') + '</code></td>' +
          '<td><span class="badge badge-blue">+' + (item.inviterDays || 0) + ' 天</span></td>' +
          '<td><span class="badge badge-green">+' + (item.inviteeDays || 0) + ' 天</span></td>' +
          '<td style="color:var(--text-dim);white-space:nowrap;">' + formatTime(item.createdAt) + '</td>' +
        '</tr>';
      }).join('');
    }

    var elPg = document.getElementById('invitePageInfo');
    if (elPg) elPg.innerText = '第 ' + currentInvitePage + ' / ' + currentInviteTotalPages + ' 页 · 共 ' + total + ' 条记录';
    var btnPrev = document.getElementById('inviteBtnPrev');
    var btnNext = document.getElementById('inviteBtnNext');
    if (btnPrev) btnPrev.disabled = currentInvitePage <= 1;
    if (btnNext) btnNext.disabled = currentInvitePage >= currentInviteTotalPages;

    var rankBody = document.getElementById('inviteRankBody');
    var top = st.topInviters || [];
    if (rankBody) {
      if (!top.length) {
        rankBody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-dim);padding:24px;">暂无邀请排行数据</td></tr>';
      } else {
        rankBody.innerHTML = top.map(function(r, idx) {
          var rank = idx + 1;
          var badge = rank === 1 ? 'badge-rose' : rank === 2 ? 'badge-amber' : rank === 3 ? 'badge-blue' : 'badge-gray';
          return '<tr>' +
            '<td><span class="badge ' + badge + '">No.' + rank + '</span></td>' +
            '<td><code style="color:var(--c-blue);font-size:11px;word-break:break-all;">' + escapeHtml(r.deviceId) + '</code></td>' +
            '<td style="font-family:monospace;font-size:12px;">' + escapeHtml(r.inviteCode || '-') + '</td>' +
            '<td><strong style="color:var(--c-green);">' + (r.count || 0) + '</strong> 人</td>' +
            '<td><span class="badge badge-blue">' + (r.days || 0) + ' 天</span></td>' +
          '</tr>';
        }).join('');
      }
    }
  } catch(e) {
    console.error('loadInviteData error:', e);
    if (tbody) tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--c-rose);padding:24px;">载入异常: ' + escapeHtml(e && e.message ? e.message : String(e)) + '</td></tr>';
  }
}

function changeInvitePage(delta) {
  var target = currentInvitePage + delta;
  if (target >= 1 && target <= currentInviteTotalPages) loadInviteData(target);
}

async function handleInviteRewardSubmit() {
  var days = parseInt(document.getElementById('cfgInviteRewardDays').value, 10);
  if (isNaN(days) || days < 1 || days > 3650) { alert('邀请奖励天数需在 1 ~ 3650 之间'); return; }
  var btn = document.getElementById('btnSaveInviteDays');
  var msg = document.getElementById('inviteCfgMsg');
  var msgText = document.getElementById('inviteCfgMsgText');
  if (btn) { btn.disabled = true; btn.innerText = '正在保存...'; }
  try {
    var resp = await fetch('/api/admin/invite/reward-days', {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ days: days })
    });
    var res = await resp.json();
    if (res && res.success) {
      if (msg && msgText) { msg.className = 'alert-box alert-success'; msgText.innerText = res.message || '已保存'; msg.classList.remove('d-none'); }
      loadInviteData(1);
    } else {
      if (msg && msgText) { msg.className = 'alert-box alert-error'; msgText.innerText = res.message || '保存失败'; msg.classList.remove('d-none'); }
      else { alert('保存失败: ' + (res.message || '未知错误')); }
    }
  } catch(e) { alert('请求异常: ' + e.message); }
  finally { if (btn) { btn.disabled = false; btn.innerText = '保存并立即生效'; } }
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
  if (container) { container.style.display = 'block'; container.innerHTML = '<div style="color:var(--text-dim);">正在检索云端密钥库...</div>'; }
  try {
    // 走管理员专用检索接口（requireAdmin 保护）。/api/metadata/:appId 要求
    // 客户端设备授权头，控制台请求永远不带 x-device-id，必然 401
    var resp = await fetch('/api/admin/search/debug?q=' + encodeURIComponent(val), { headers: getHeaders() });
    var res = await resp.json();
    if (res && res.success && res.data) {
      var d = res.data;
      var game = d.game || {};
      var rows = '';
      if (d.depotKey) {
        rows += '<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;justify-content:space-between;align-items:center;font-size:11px;">' +
          '<span>DepotKey (' + escapeHtml(d.numericId || val) + ')</span>' +
          '<code style="color:var(--c-green);font-size:11px;">' + escapeHtml(d.depotKey) + '</code>' +
        '</div>';
      }
      if (d.token) {
        rows += '<div style="padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;justify-content:space-between;align-items:center;font-size:11px;">' +
          '<span>AccessToken</span>' +
          '<code style="color:var(--c-blue);font-size:11px;">' + escapeHtml(d.token) + '</code>' +
        '</div>';
      }
      container.innerHTML = '<div style="margin-bottom:12px;">' +
        '<strong style="color:var(--text-strong);font-size:15px;">' + escapeHtml(game.name || d.query) + '</strong> ' +
        '<span class="badge badge-blue">AppID: ' + escapeHtml(d.numericId || d.query) + '</span> ' +
        (d.token ? '<span class="badge badge-green">Token 已收录</span>' : '<span class="badge badge-gray">Token 未收录</span>') +
      '</div>' +
      '<div>' + (rows || '<div style="color:var(--text-dim);">未匹配到该 AppID 的密钥 / Token 记录</div>') + '</div>';
    } else {
      if (container) container.innerHTML = '<div style="color:var(--c-rose);">未检索到 ' + escapeHtml(val) + ' 的密钥记录</div>';
    }
  } catch(e) { if (container) container.innerHTML = '<div style="color:var(--c-rose);">检索异常: ' + escapeHtml(e && e.message ? e.message : String(e)) + '</div>'; }
}

function openNoticeModal() {
  // 新建模式：清空表单
  var idEl = document.getElementById('noticeId');
  if (idEl) idEl.value = '';
  var titleEl = document.getElementById('noticeModalTitle');
  if (titleEl) titleEl.innerText = '📢 发布系统公告';
  ['noticeTitle', 'noticeContent'].forEach(function(id) { var el = document.getElementById(id); if (el) el.value = ''; });
  var prio = document.getElementById('noticePriority'); if (prio) prio.value = '50';
  var ver = document.getElementById('noticeVersion'); if (ver) ver.value = '*';
  var type = document.getElementById('noticeType'); if (type) type.value = 'popup';
  var level = document.getElementById('noticeLevel'); if (level) level.value = 'info';
  var once = document.getElementById('noticePopupOnce'); if (once) once.value = 'false';
  var inter = document.getElementById('noticeInteraction'); if (inter) inter.value = 'confirm';
  document.getElementById('noticeModal').style.display = 'flex';
}

function editNotice(id) {
  var n = noticesCache.find(function(x) { return String(x.id) === String(id); });
  if (!n) { alert('公告数据未加载，请刷新页面后重试'); return; }
  var idEl = document.getElementById('noticeId');
  if (idEl) idEl.value = n.id;
  var titleEl = document.getElementById('noticeModalTitle');
  if (titleEl) titleEl.innerText = '✏️ 编辑公告';
  var t = document.getElementById('noticeTitle'); if (t) t.value = n.title || '';
  var c = document.getElementById('noticeContent'); if (c) c.value = n.content || '';
  var prio = document.getElementById('noticePriority'); if (prio) prio.value = String(n.priority != null ? n.priority : 10);
  var ver = document.getElementById('noticeVersion'); if (ver) ver.value = n.targetVersion || '*';
  var type = document.getElementById('noticeType'); if (type) type.value = n.type || 'popup';
  var level = document.getElementById('noticeLevel'); if (level) level.value = n.level || 'info';
  var once = document.getElementById('noticePopupOnce'); if (once) once.value = n.popupOnce ? 'true' : 'false';
  var inter = document.getElementById('noticeInteraction'); if (inter) inter.value = n.interaction === 'consent' ? 'consent' : 'confirm';
  var m = document.getElementById('noticeModal');
  if (m) m.style.display = 'flex';
}
function openVersionModal() { document.getElementById('versionModal').style.display = 'flex'; }
function openPushModal(ver) { document.getElementById('pushVersion').value = ver || ''; document.getElementById('pushModal').style.display = 'flex'; }
function previewNotice(id) {
  var n = noticesCache.find(function(x) { return String(x.id) === String(id); });
  if (!n) return;
  document.getElementById('previewTitle').innerText = n.title;
  document.getElementById('previewContent').innerText = n.content;
  var m = document.getElementById('previewModal');
  if (m) m.style.display = 'flex';
}

function closeModal(id) {
  var m = document.getElementById(id);
  if (m) m.style.display = 'none';
}

async function handleNoticeSubmit() {
  var title = (document.getElementById('noticeTitle').value || '').trim();
  var content = (document.getElementById('noticeContent').value || '').trim();
  if (!title || !content) { alert('请填写公告标题与内容'); return; }
  var payload = { title: title, type: document.getElementById('noticeType').value, level: document.getElementById('noticeLevel').value, priority: parseInt(document.getElementById('noticePriority').value, 10) || 10, popupOnce: document.getElementById('noticePopupOnce').value === 'true', interaction: document.getElementById('noticeInteraction').value || 'confirm', targetVersion: document.getElementById('noticeVersion').value || '*', content: content, enabled: true };
  var editId = (document.getElementById('noticeId').value || '').trim();
  try {
    var resp = editId
      ? await fetch('/api/admin/notices/' + encodeURIComponent(editId), { method: 'PUT', headers: getHeaders(), body: JSON.stringify(payload) })
      : await fetch('/api/admin/notices', { method: 'POST', headers: getHeaders(), body: JSON.stringify(payload) });
    var res = await resp.json();
    if (res && res.success) { closeModal('noticeModal'); loadNotices(); alert(editId ? '公告已更新并即时生效！' : '公告已发布！'); }
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
  try {
    var resp = await fetch('/api/admin/notices/' + encodeURIComponent(id) + '/toggle', { method: 'PATCH', headers: getHeaders(), body: JSON.stringify({ enabled: enable }) });
    if (resp.status === 401) { handleLogout(); return; }
    var res = await resp.json();
    if (res && res.success) {
      loadNotices();
    } else {
      alert((res && res.message) || '操作失败');
    }
  } catch(e) { alert('操作失败: ' + (e && e.message ? e.message : String(e))); }
}

async function deleteNotice(id) {
  if (!confirm('确定删除此公告？')) return;
  try {
    var resp = await fetch('/api/admin/notices/' + encodeURIComponent(id), { method: 'DELETE', headers: getHeaders() });
    if (resp.status === 401) { handleLogout(); return; }
    var res = await resp.json();
    if (res && res.success) {
      loadNotices();
    } else {
      alert((res && res.message) || '操作失败');
    }
  } catch(e) { alert('操作失败: ' + (e && e.message ? e.message : String(e))); }
}

async function deleteVersion(ver) {
  if (!confirm('确定删除版本 v' + ver + ' 记录？')) return;
  try {
    var resp = await fetch('/api/admin/versions/' + encodeURIComponent(ver), { method: 'DELETE', headers: getHeaders() });
    if (resp.status === 401) { handleLogout(); return; }
    var res = await resp.json();
    if (res && res.success) {
      loadVersions();
    } else {
      alert((res && res.message) || '操作失败');
    }
  } catch(e) { alert('操作失败: ' + (e && e.message ? e.message : String(e))); }
}

function formatTime(iso) {
  if (!iso) return '-';
  // 注意：非法日期字符串得到 Invalid Date（字段为 NaN），必须显式判定并返回 '-'，
  // 否则会渲染出 NaN-NaN-NaN；catch 分支也绝不回显原始输入（防注入）
  try {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '-';
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0') + ' ' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
  }
  catch(e) { return '-'; }
}

function escapeHtml(str) {
  // 含引号转义：本页大量拼接进 HTML 属性上下文（title/value/onclick 参数），
  // 不转义引号时上游数据（如第三方源返回的 key 名）可注入属性形成 XSS
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 用于拼进 onclick="fn(\'...\')" 的 ID：只允许安全字符，杜绝属性逃逸
// 白名单含点号，避免版本号 1.0.0 被清洗成 100
function safeId(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_.:-]/g, '');
}

// 用于把任意用户可控文本（卡密、版本号、设备 ID 等）安全拼进
// onclick="fn(\'...\')" 这类「HTML 属性 + JS 字符串」双重上下文：
// 先按 JS 字符串规则把危险字符转成 xHH 形式的转义序列，输出中不再含有
// 原始的引号 / 尖括号 / &，因此天然满足 HTML 属性上下文，不会再被
// 浏览器做属性解码后还原出逃逸字符。
function attrSafe(v) {
  var s = String(v == null ? '' : v);
  var bs = String.fromCharCode(92); // 反斜杠
  s = s.split(bs).join(bs + bs); // \ -> \\
  s = s.split(String.fromCharCode(39)).join(bs + 'x27'); // ' -> \x27
  s = s.split(String.fromCharCode(34)).join(bs + 'x22'); // " -> \x22
  s = s.split('<').join(bs + 'x3c'); // < -> \x3c
  s = s.split('>').join(bs + 'x3e'); // > -> \x3e
  s = s.split('&').join(bs + 'x26'); // & -> \x26
  s = s.split(String.fromCharCode(10)).join(bs + 'n'); // 换行
  s = s.split(String.fromCharCode(13)).join(bs + 'r'); // 回车
  return s;
}

function loadAllData() {
  loadStats();
  loadLicensesData(1);
  loadNotices();
  loadVersions();
}

// 全局模态框交互：点击背景蒙层或按下 ESC 键自动关闭所有可关闭模态框
document.addEventListener('click', function(e) {
  if (e.target && e.target.classList && e.target.classList.contains('modal-overlay')) {
    if (e.target.id !== 'loginSection') {
      e.target.style.display = 'none';
    }
  }
});

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(function(m) {
      if (m.id !== 'loginSection') {
        m.style.display = 'none';
      }
    });
  }
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', checkAuth);
} else {
  checkAuth();
}
window.onload = checkAuth;
`;
