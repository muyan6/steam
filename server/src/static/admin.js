// SteamMaster Admin Dashboard - Pure vanilla JS, zero dependencies
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
  icon.innerText = type === 'error' ? 'ERROR' : type === 'success' ? 'OK' : 'INFO';
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

async function loadNotices() {
  try {
    var resp = await fetch('/api/admin/notices', { headers: getHeaders() });
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
            '<button onclick="previewNotice(\'' + n.id + '\')" class="btn btn-secondary btn-sm" style="color:#38bdf8;">预览</button> ' +
            '<button onclick="toggleNotice(\'' + n.id + '\',' + (!n.enabled) + ')" class="btn btn-secondary btn-sm">' + (n.enabled ? '停用' : '启用') + '</button> ' +
            '<button onclick="deleteNotice(\'' + n.id + '\')" class="btn btn-danger btn-sm">删除</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }
  } catch(e) { console.warn('loadNotices error:', e); }
}

async function loadVersions() {
  try {
    var resp = await fetch('/api/admin/versions', { headers: getHeaders() });
    var res = await resp.json();
    var tbody = document.getElementById('versionTableBody');
    if (res && res.success && tbody) {
      versionsCache = res.data || [];
      if (!versionsCache.length) { tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#64748b;padding:24px;">暂无版本发布记录</td></tr>'; return; }
      tbody.innerHTML = versionsCache.map(function(v) {
        return '<tr>' +
          '<td style="font-family:monospace;font-weight:800;color:#fff;">v' + v.version + '</td>' +
          '<td><span class="badge badge-blue">' + (v.channel || 'stable') + '</span></td>' +
          '<td>' + v.releaseDate + '</td>' +
          '<td><strong>' + escapeHtml(v.title) + '</strong></td>' +
          '<td>' + (v.forceUpdate ? '<span class="badge badge-rose">强更</span>' : '<span class="badge badge-gray">普通</span>') + '</td>' +
          '<td><span class="badge ' + (v.enabled !== false ? 'badge-green' : 'badge-gray') + '">' + (v.enabled !== false ? '上架' : '下架') + '</span></td>' +
          '<td style="text-align:right;">' +
            '<button onclick="quickPushVersion(\'' + v.version + '\')" class="btn btn-secondary btn-sm" style="color:#a855f7;">广播</button> ' +
            '<button onclick="deleteVersion(\'' + v.version + '\')" class="btn btn-danger btn-sm">删除</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }
  } catch(e) { console.warn('loadVersions error:', e); }
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
      var html = '<div style="font-weight:bold;color:#fff;margin-bottom:12px;">检索: ' + escapeHtml(q) + '</div>';
      if (d.game) html += '<div style="background:rgba(2,6,23,0.6);padding:12px;border-radius:10px;margin-bottom:12px;border:1px solid rgba(255,255,255,0.06);"><strong style="color:#38bdf8;">' + escapeHtml(d.game.nameZh || d.game.name) + '</strong> AppID: ' + d.game.appId + '</div>';
      html += '<div class="grid-2"><div style="background:rgba(2,6,23,0.6);padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.06);"><div style="color:#94a3b8;font-size:11px;margin-bottom:6px;">DepotKey</div><div style="font-family:monospace;color:#34d399;word-break:break-all;">' + escapeHtml(d.depotKey || '无') + '</div></div><div style="background:rgba(2,6,23,0.6);padding:12px;border-radius:10px;border:1px solid rgba(255,255,255,0.06);"><div style="color:#94a3b8;font-size:11px;margin-bottom:6px;">AccessToken</div><div style="font-family:monospace;color:#38bdf8;word-break:break-all;">' + escapeHtml(d.token || '公开分包') + '</div></div></div>';
      resBox.innerHTML = html;
    }
  } catch(e) { alert('查询失败: ' + e.message); }
  finally { if (btn) btn.innerText = '查询'; }
}

async function loadSources() {
  try {
    var resp = await fetch('/api/sources');
    var res = await resp.json();
    var grid = document.getElementById('sourcesGrid');
    if (res && res.success && res.data && res.data.sources && grid) {
      grid.innerHTML = res.data.sources.map(function(s) {
        return '<div class="card"><div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;"><strong style="color:#fff;">' + escapeHtml(s.name) + '</strong><span class="badge badge-green">' + escapeHtml(s.status) + '</span></div><p style="color:#94a3b8;font-size:12px;margin-bottom:10px;">' + escapeHtml(s.description) + '</p><div style="font-size:11px;color:#64748b;border-top:1px solid rgba(255,255,255,0.06);padding-top:8px;">来源: ' + escapeHtml(s.author) + ' · 周期: ' + escapeHtml(s.syncFrequency) + '</div></div>';
      }).join('');
    }
  } catch(e) { console.warn('loadSources error:', e); }
}

async function triggerSyncAll() {
  var btn = document.getElementById('btnSyncAll');
  if (btn) btn.innerHTML = '<span>正在同步...</span>';
  try {
    var resp = await fetch('/api/admin/sync/all', { method: 'POST', headers: getHeaders() });
    var res = await resp.json();
    alert(res.message || '同步完成！');
    loadStats();
  } catch(e) { alert('同步失败: ' + e.message); }
  finally { if (btn) btn.innerHTML = '<span>立即触发全量同步</span>'; }
}

async function loadAuditLogs() {
  try {
    var resp = await fetch('/api/auth/audit-logs?limit=50', { headers: getHeaders() });
    var res = await resp.json();
    var tbody = document.getElementById('auditTableBody');
    if (res && res.success && res.data && tbody) {
      tbody.innerHTML = res.data.map(function(l) {
        return '<tr style="font-size:11px;font-family:monospace;"><td style="color:#64748b;">' + formatTime(l.timestamp) + '</td><td style="color:#38bdf8;font-weight:bold;">' + escapeHtml(l.action) + '</td><td>' + escapeHtml(l.operator) + '</td><td style="color:#64748b;">' + escapeHtml(l.ip) + '</td><td style="font-family:inherit;color:#cbd5e1;">' + escapeHtml(l.details || '') + '</td><td><span class="badge ' + (l.success ? 'badge-green' : 'badge-rose') + '">' + (l.success ? '成功' : '失败') + '</span></td></tr>';
      }).join('');
    }
  } catch(e) { console.warn('loadAuditLogs error:', e); }
}

async function handleChangePassword() {
  var cur = (document.getElementById('curPass').value || '').trim();
  var user = (document.getElementById('newUsername').value || '').trim();
  var pass = (document.getElementById('newPass').value || '').trim();
  var msg = document.getElementById('pwdMsg');
  if (!cur || !pass) { msg.style.display='block'; msg.className='badge-rose'; msg.innerText='请输入当前密码与新密码'; return; }
  try {
    var resp = await fetch('/api/auth/change-password', { method: 'POST', headers: getHeaders(), body: JSON.stringify({ currentPassword: cur, newUsername: user, newPassword: pass }) });
    var res = await resp.json();
    msg.style.display = 'block';
    if (res && res.success) { msg.className='badge-green'; msg.innerText='修改成功: ' + res.message; if (res.token) { authToken=res.token; localStorage.setItem('steammaster_admin_token', res.token); } }
    else { msg.className='badge-rose'; msg.innerText='失败: ' + (res.message || '未知错误'); }
  } catch(err) { msg.style.display='block'; msg.className='badge-rose'; msg.innerText='请求异常: ' + err.message; }
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
  document.getElementById('pushTitle').value = 'SteamMaster 发现全新版本 v' + latest;
  document.getElementById('pushContent').value = '全新版本已上线，建议立即升级体验最新功能！';
  document.getElementById('pushModal').style.display = 'flex';
}

function quickPushVersion(ver) {
  document.getElementById('pushVersion').value = ver;
  document.getElementById('pushTitle').value = 'SteamMaster 发现重要新版本 v' + ver;
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
  var changelog = document.getElementById('verChangelog').value.split('\n').map(function(s) { return s.trim(); }).filter(Boolean);
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

function loadAllData() { loadStats(); loadNotices(); loadVersions(); }

window.onload = checkAuth;
