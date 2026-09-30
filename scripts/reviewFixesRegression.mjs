#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.env.REVIEW_PROJECT_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'review-fixes-'));
process.env.DATA_DIR = data;
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.ADMIN_PASS = 'fixture-only-password';
process.env.LICENSE_PRIVATE_KEY = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
delete process.env.LICENSE_PUBLIC_KEY_HEX;
const write = (f, v) => fs.writeFileSync(path.join(data, f), JSON.stringify(v));
for (const f of ['license_keys.json', 'devices.json', 'steam_all_games.json', 'chinese_games_cache.json', 'sponsors.json', 'notices.json', 'versions.json']) write(f, []);
for (const f of ['steam_tokens.json', 'steam_depot_keys.json']) write(f, {});
const load = f => import(pathToFileURL(path.join(root, 'server/dist', f)).href);
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const require = createRequire(path.join(root, 'package.json'));
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const ts = require('typescript');
let passed = 0, failed = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
}
function failWrites(pattern, action) {
  const original = fs.writeFileSync;
  fs.writeFileSync = function(file, ...args) {
    if (String(file).includes(pattern)) throw Object.assign(new Error('fixture disk full'), { code: 'ENOSPC' });
    return original.call(this, file, ...args);
  };
  try { return action(); } finally { fs.writeFileSync = original; }
}

const axios = (await import(pathToFileURL(path.join(root, 'server/node_modules/axios/index.js')).href)).default;
const key = 'a'.repeat(64);
const fixtureDepots = {
  '990101': { config: { oslist: 'windows' }, manifests: { public: { gid: '100001' } } },
  '990102': { config: { oslist: 'macos' }, manifests: { public: { gid: '100002' } } },
  // Actual failure shape: zero-byte Windows manifest needs a key, macOS sibling has one.
  '990200': { dlcappid: '990200', config: { oslist: 'windows' }, manifests: { public: { gid: '200001', download: '0', size: '0' } } },
  '990201': { dlcappid: '990200', config: { oslist: 'macos' }, manifests: { public: { gid: '200002' } } },
  '990300': { dlcappid: '990300' }, // Explicit no-content entitlement.
  '990400': { dlcappid: '990400', config: { oslist: 'windows' }, manifests: { public: { gid: '400001' } } },
  '990401': { dlcappid: '990400', config: { oslist: 'macos' }, manifests: { public: { gid: '400002' } } }
};
axios.get = async url => {
  const id = String(url).match(/steamcmd\.net\/v1\/info\/(\d+)/)?.[1];
  if (!id) throw Error('Upstream blocked by fixture');
  return { data: { data: { [id]: { common: { name: 'fixture game' }, extended: { listofdlc: '990200,990300,990400,990500' },
    depots: id === '990100' ? fixtureDepots : id === '990900' ? { '990901': fixtureDepots['990101'], '990400': fixtureDepots['990400'] } : {} } } } };
};
const { default: router } = await load('routes/index.js');
const { authService } = await load('services/authService.js');
const { versionService } = await load('services/versionService.js');
const { noticeService } = await load('services/noticeService.js');
const { depotService } = await load('services/depotService.js');
const { gameService } = await load('services/gameService.js');
const { freeQuotaService } = await load('services/freeQuotaService.js');
const versions = await load('utils/version.js');
depotService.getDepotsForGame = async () => ({ '990101': key, '990201': key, '990400': key });
gameService.getGameByAppId = async id => ({ appId: id, name: 'fixture game' });
const express = serverRequire('express');
const app = express(); app.use(express.json()); app.use('/api', router);
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = 'http://127.0.0.1:' + server.address().port;
const request = async (p, options) => { const r = await fetch(base + p, options); return { status: r.status, body: await r.json() }; };

try {
  await check('R04 version create/update/toggle/delete failures leave public and disk state unchanged', () => {
    versionService.publishVersion({ version: '2.8.3', enabled: true, title: 'original' });
    for (const action of [() => versionService.publishVersion({ version: '9.0.0' }),
      () => versionService.updateVersion('2.8.3', { title: 'bad' }), () => versionService.toggleVersion('2.8.3', false),
      () => versionService.deleteVersion('2.8.3')]) {
      const before = JSON.stringify(versionService.getAllVersions());
      assert.throws(() => failWrites('.versions.json.', action));
      assert.equal(JSON.stringify(versionService.getAllVersions()), before);
      assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(data, 'versions.json')))), before);
    }
    const returned = versionService.getAllVersions(); returned[0].title = 'external mutation';
    assert.equal(versionService.getLatestVersion().title, 'original');
  });
  await check('R04 notices do not publish failed mutations', () => {
    const notice = noticeService.createNotice({ title: 'original', content: 'fixture', enabled: true });
    for (const action of [() => noticeService.createNotice({ title: 'bad' }), () => noticeService.updateNotice(notice.id, { title: 'bad' }),
      () => noticeService.toggleNotice(notice.id, false), () => noticeService.deleteNotice(notice.id)]) {
      const before = JSON.stringify(noticeService.getAllNotices());
      assert.throws(() => failWrites('.notices.json.', action));
      assert.equal(JSON.stringify(noticeService.getAllNotices()), before);
      assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(path.join(data, 'notices.json')))), before);
    }
  });
  await check('R05 logout write failure returns 503 and invalidates the in-process token', async () => {
    const token = authService.generateToken('admin');
    const oldPath = authService.credFilePath;
    const blocker = path.join(data, 'blocked-credentials'); fs.mkdirSync(blocker); authService.credFilePath = blocker;
    let result;
    try { result = await request('/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } }); }
    finally { authService.credFilePath = oldPath; authService.saveCredentials(authService.getCredentials()); }
    assert.equal(result.status, 503); assert.equal(result.body.success, false); assert.equal(authService.verifyToken(token), null);
    assert(read('server/src/static/adminScript.ts').includes("fetch('/api/auth/logout'"));
  });

  let httpResponse;
  const context = { exports: {}, console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
    URL, ArrayBuffer, Uint8Array, TextDecoder, TextEncoder, window: { __TAURI_INTERNALS__: {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, require: name => {
      if (name === '@tauri-apps/api/core') return { invoke: async () => null };
      if (name === '@tauri-apps/plugin-http') return { fetch: async () => ({ ok: true, json: async () => structuredClone(httpResponse) }) };
      if (name.endsWith('/data/gamesData')) return { POPULAR_GAMES_DATABASE: [] };
      if (name.endsWith('/config/appConfig')) return { APP_CONFIG: { API_BASE_URL: 'https://fixture.invalid', VERSION: '2.8.3' } };
      if (name.endsWith('/utils/version')) return versions;
      if (name === 'node-unrar-js') return {};
      throw Error('Unexpected import ' + name);
    } };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(read('src/renderer/api/tauriBridge.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const bridge = context.exports.createTauriBridge();
  await check('R06 mandatory update stays mandatory below minSupportedVersion', async () => {
    httpResponse = { data: { hasUpdate: true, forceUpdate: true, latest: { version: '2.8.3', minSupportedVersion: '2.8.0', forceUpdate: false } } };
    assert.equal((await bridge.checkVersion('2.7.0')).forceUpdate, true);
    assert.equal((await bridge.checkVersion('3.0.0')).hasUpdate, false);
  });
  await check('R07 one version comparator handles prerelease, numeric segments, build metadata and retirement', async () => {
    for (const [a, b, expected] of [['2.8.3', '2.8.3-beta', 1], ['2.8.3-beta.10', '2.8.3-beta.2', 1],
      ['2.8.3-beta', '2.8.3-beta.1', -1], ['2.8.3+build2', '2.8.3+build1', 0], ['5.6.0', '2.8.3', -1]]) {
      assert.equal(versions.compareVersions(a, b), expected); assert.equal(context.exports.compareSemver(a, b), expected);
    }
    httpResponse = { data: { hasUpdate: true, latest: { version: '2.8.3' } } };
    assert.equal((await bridge.checkVersion('2.8.3-beta')).hasUpdate, true);
  });
  await check('R08 unmounted P2P panel never starts a late interval', async () => {
    const panel = read('src/renderer/components/onlinefix/P2pNetworkingPanel.vue');
    const source = panel.slice(panel.indexOf('let statusTimer:'), panel.indexOf('</script>'));
    let mounted, unmounted, release; const gate = new Promise(r => { release = r; }); const timers = new Set();
    const ctx = { onMounted: f => mounted = f, onUnmounted: f => unmounted = f, loadSavedTunnels() {}, fetchStatus: () => gate,
      loadServerPresets: async () => {}, refreshFirewallState() {}, checkClipboardForCode: async () => {}, handlePresetChange() {},
      setInterval: f => { timers.add(f); return f; }, clearInterval: f => timers.delete(f), clearTimeout() {}, parseCodeTimer: null };
    vm.createContext(ctx); vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
    const pending = mounted(); unmounted(); release(); await pending; assert.equal(timers.size, 0);
  });
  await check('R08 library cleans both delayed load and delayed listen registration', async () => {
    const panel = read('src/renderer/views/LibraryView.vue'); const source = panel.slice(panel.indexOf('let unlistenWatcher:'), panel.indexOf('</script>'));
    for (const stage of ['load', 'listen']) {
      let mounted, unmounted, release, listened = 0; const gate = new Promise(r => { release = r; });
      const ctx = { onMounted: f => mounted = f, onUnmounted: f => unmounted = f, loadLibrary: () => stage === 'load' ? gate : Promise.resolve(),
        unlockedGames: { value: [] }, handleCheckUpdates() {}, loadRequestId: 0, console,
        listen: async () => { await (stage === 'listen' ? gate : Promise.resolve()); listened++; return () => listened--; } };
      vm.createContext(ctx); vm.runInContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, ctx);
      const pending = mounted(); await Promise.resolve(); unmounted(); release(); await pending; assert.equal(listened, 0, stage);
    }
  });
  await check('R10/R16 explicit new DATA_DIR and zero quota are respected', () => {
    const configured = path.join(data, 'new-data-dir');
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const {CONFIG}=await import(${JSON.stringify(pathToFileURL(path.join(root, 'server/dist/config/index.js')).href)});console.log(JSON.stringify({dir:CONFIG.DATA_DIR,limit:CONFIG.FREE_DAILY_LIMIT}));`],
      { env: { ...process.env, DATA_DIR: configured, FREE_DAILY_LIMIT: '0' }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); const value = JSON.parse(r.stdout.trim());
    assert.equal(path.resolve(value.dir), path.resolve(configured)); assert.equal(value.limit, 0); assert(fs.statSync(configured).isDirectory());
  });
  await check('R11 both memory and disk caches match the selected Steam root', () => {
    const source = read('src-tauri/src/localgames.rs');
    assert(source.includes('entry.steam_path == path_key')); assert(source.includes('c.steam_path == path_key'));
    assert(source.includes('steam_path: path_key'));
  });
  await check('R13 runtime files are ignored and secret-bearing files are untracked', () => {
    for (const f of ['devices.json', 'free_quota.json', 'invite_records.json', 'license_trial_used.json', 'afdian_config.json', 'toolbox_repair_logs.json']) {
      assert.equal(spawnSync('git', ['check-ignore', 'server/data/' + f], { cwd: root }).status, 0, f);
    }
    assert.equal(spawnSync('git', ['ls-files', 'server/data/afdian_config.json', 'server/data/toolbox_repair_logs.json'], { cwd: root, encoding: 'utf8' }).stdout.trim(), '');
  });
  await check('R15 QQ configuration and desktop protocol allowlist agree', async () => {
    const { appLinksService } = await load('services/appLinksService.js');
    const links = appLinksService.updateLinks({ qqGroupUrl: 'tencent://fixture' }); assert(links.qqGroupUrl);
    assert(read('src-tauri/src/lib.rs').match(/const ALLOWED_PREFIXES:[^\n]+"tencent:\/\/"/));
  });
  await check('content Windows zero-byte manifest is retained, macOS key never authorizes its DLC', async () => {
    const response = await request('/api/metadata/990100?withGids=1', { headers: { 'x-device-id': 'content-fixture' } });
    assert.equal(response.status, 200); const d = response.body.data;
    assert(d.contentSelection?.baseReady);
    assert.deepEqual(d.contentSelection, JSON.parse(read('tests/content-selection/windows-partial.json')));
    assert(d.contentSelection.skippedDlcIds.includes('990200'), JSON.stringify(d.contentSelection)); assert(d.contentSelection.skippedDlcIds.includes('990500'));
    assert.deepEqual(d.dlcIds, ['990300', '990400']);
    assert.deepEqual(d.depots.map(x => x.depotId).sort(), ['990101', '990400']);
    assert(!d.dlcDepots.some(x => x.dlcAppId === '990200'));
    const index = (await load('services/dlcIndexService.js')).dlcIndexService.get(990100);
    assert(index.depots.some(x => x.depotId === '990200' && x.requiresKey === true));
    assert.equal(index.depots.find(x => x.depotId === '990201').osList, 'macos');
    const cached = await request('/api/metadata/990100/inspect?withGids=1');
    assert.deepEqual(cached.body.data.contentSelection, d.contentSelection);
    assert(!JSON.stringify(cached.body).includes(key));
  });
  await check('content missing base data stays blocked and does not consume quota', async () => {
    const response = await request('/api/metadata/990900?withGids=1', { headers: { 'x-device-id': 'base-missing' } });
    assert.equal(response.status, 200); assert.equal(response.body.data.contentSelection.baseReady, false);
    assert.deepEqual(response.body.data.contentSelection.missingBaseDepotIds, ['990901']);
    assert.equal(freeQuotaService.status('base-missing').used, 0);
  });
  await check('content native write/append paths fail closed and do not reuse stale client DLCs', () => {
    const ost = read('src-tauri/src/ost.rs'), manifests = read('src-tauri/src/manifests.rs'), lua = read('src-tauri/src/lua_manager.rs');
    const merge = ost.slice(ost.indexOf('fn merge_with_server_metadata'), ost.indexOf('pub fn save_lua_rule'));
    assert(!merge.includes('payload.dlcs.clone()')); assert(!merge.includes('payload.depots.iter()'));
    assert(ost.includes('plan.require_base()?')); assert(manifests.includes('dlc_ids = plan.dlcs()'));
    const append = lua.slice(lua.indexOf('pub fn append_game_dlcs'));
    assert(!append.includes('HashSet::new()')); assert(append.includes('plan.require_base()?')); assert(append.includes('setDepotKey'));
    assert(read('src/renderer/views/SearchView.vue').includes('res.contentReady === true'));
  });
} finally {
  await new Promise(resolve => server.close(resolve));
}
console.log(`REVIEW_FIXES_RESULT passed=${passed} failed=${failed}`);
if (failed) process.exitCode = 1;
