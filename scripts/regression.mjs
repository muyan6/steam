#!/usr/bin/env node
// 隔离回归：真实服务/路由与实际桥接源码；所有上游和原生操作均用测试替身。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'steammaster-regression-'));
process.env.DATA_DIR = data;
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.ADMIN_PASS = 'regression-initial-password';
process.env.LICENSE_PRIVATE_KEY = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
delete process.env.LICENSE_PUBLIC_KEY_HEX;
process.env.FREE_DAILY_LIMIT = '2';
const write = (file, value) => fs.writeFileSync(path.join(data, file), JSON.stringify(value));
for (const file of ['license_keys.json', 'steam_all_games.json', 'chinese_games_cache.json', 'devices.json', 'notices.json', 'versions.json', 'sponsors.json']) write(file, []);
write('steam_tokens.json', { '990003': 'fixture-token' });
write('steam_depot_keys.json', {});
const require = createRequire(path.join(root, 'package.json'));
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const axios = serverRequire('axios').default;
axios.get = async () => { throw new Error('Unexpected upstream access blocked by regression fixture'); };
const load = file => import(pathToFileURL(path.join(root, 'server/dist', file)).href);
const { default: router } = await load('routes/index.js');
const { authService } = await load('services/authService.js');
const { licenseService, LicenseService } = await load('services/licenseService.js');
const { licenseSignService } = await load('services/licenseSignService.js');
const { freeQuotaService } = await load('services/freeQuotaService.js');
const { deviceService } = await load('services/deviceService.js');
const { depotService } = await load('services/depotService.js');
const { manifestService, ManifestService } = await load('services/manifestService.js');
const { inviteService, InviteService, deriveInviteCode } = await load('services/inviteService.js');
const { CONFIG } = await load('config/index.js');
assert.equal(path.resolve(CONFIG.DATA_DIR), data);
const app = serverRequire('express')();
app.use(serverRequire('express').json());
const middleware = router.stack.find(layer => layer.route?.path === '/metadata/:appId').route.stack[0].handle;
app.get('/probe/metadata/:appId', middleware, async (req, res) => {
  await new Promise(resolve => setTimeout(resolve, 70));
  res.json(req.query.empty ? { success: false } : { success: true, data: { depots: [{ depotKey: 'fixture' }] } });
});
app.use('/api', router);
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = `http://127.0.0.1:${server.address().port}`;
const request = async (url, id, body) => {
  const response = await fetch(base + url, { method: body ? 'POST' : 'GET', headers: { 'x-device-id': id, 'Content-Type': 'application/json', Accept: 'application/json' }, body: body && JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
let count = 0;
async function check(name, action) { await action(); count++; console.log(`PASS ${name}`); }
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

// 执行桥接源代码，仅替换 require 的平台适配和 HTTP 请求。
const ipc = [];
let http = async () => { throw new Error('Unexpected HTTP fixture'); };
const context = { exports: {}, console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, URL, ArrayBuffer, Uint8Array, TextDecoder, TextEncoder, Set, Map, Date,
  window: { __TAURI_INTERNALS__: {} }, localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary'),
  require: name => {
    if (name === '@tauri-apps/api/core') return { invoke: async (command, args) => { ipc.push({ command, args }); return command === 'get_device_id' ? 'fixture' : 'fixture-result'; } };
    if (name === '@tauri-apps/plugin-http') return { fetch: (...args) => http(...args) };
    if (name.endsWith('/data/gamesData')) return { POPULAR_GAMES_DATABASE: [] };
    if (name.endsWith('/config/appConfig')) return { APP_CONFIG: { API_BASE_URL: 'https://fixture.invalid', VERSION: '2.8.2' } };
    if (name === 'node-unrar-js') return {};
    throw new Error('Unexpected import ' + name);
  }
};
vm.createContext(context);
const ts = require('typescript');
vm.runInContext(ts.transpileModule(read('src/renderer/api/tauriBridge.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const bridge = context.exports.createTauriBridge();

try {
  await check('R01: exposed PEM removed, revoked trust root replaced, current signer verifies', () => {
    assert(!/-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/.test(read('docs/CODE_REVIEW_2026-09-15.md')));
    const old = '34c2a8ab59b1d134bd32091c62525aa392c6bada97d4480f9d21abf0b9eae5a4';
    assert(!read('src-tauri/src/license_verify.rs').includes(`= "${old}"`));
    assert(read('server/src/config/licenseTrust.ts').includes(old));
    const payload = { deviceId: 'fixture', isActivated: false, status: 'unactivated', issuedAt: 1 };
    assert(licenseSignService.verify(payload, licenseSignService.sign(payload).signature));
  });
  await check('R02: configured initial password works, bundled password rejected, runtime data untracked', async () => {
    assert((await authService.login('admin', process.env.ADMIN_PASS, 'fixture-a')).success);
    assert(!(await authService.login('admin', 'admin123', 'fixture-b')).success);
    assert.equal(spawnSync('git', ['ls-files', 'server/data/admin_credentials.json'], { cwd: root, encoding: 'utf8' }).stdout.trim(), '');
  });
  await check('R03: successful depot map and token responses charge once', async () => {
    depotService.getDepotsForGame = async () => ({ '990002': 'fixture-key' });
    assert.equal((await request('/api/depots/990001', 'map-fixture')).status, 200);
    assert.equal(freeQuotaService.status('map-fixture').used, 1);
    assert.equal((await request('/api/tokens/990003', 'token-fixture')).status, 200);
    assert.equal(freeQuotaService.status('token-fixture').used, 1);
    await request('/api/tokens/990003', 'token-fixture');
    assert.equal(freeQuotaService.status('token-fixture').used, 1);
  });
  await check('R04: distinct parallel requests honor limit; same app shares a reservation; failures release', async () => {
    const result = await Promise.all([990011, 990012, 990013].map(id => request('/probe/metadata/' + id, 'parallel-fixture')));
    assert.deepEqual(result.map(r => r.status).sort(), [200, 200, 403]);
    assert.equal(freeQuotaService.status('parallel-fixture').used, 2);
    const same = await Promise.all([1, 2, 3].map(() => request('/probe/metadata/990021', 'same-fixture')));
    assert(same.every(r => r.status === 200)); assert.equal(freeQuotaService.status('same-fixture').used, 1);
    await request('/probe/metadata/990031?empty=1', 'failure-fixture');
    assert.equal(freeQuotaService.status('failure-fixture').used, 0);
    const ctrl = new AbortController();
    const aborted = fetch(base + '/probe/metadata/990041', { headers: { 'x-device-id': 'abort-fixture' }, signal: ctrl.signal }).catch(() => null);
    setTimeout(() => ctrl.abort(), 10); await aborted; await new Promise(resolve => setTimeout(resolve, 90));
    assert.equal(freeQuotaService.status('abort-fixture').used, 0);
    assert(freeQuotaService.reserve('abort-fixture', 990042).allowed);
  });
  await check('R05: unknown devices rejected; registered reports quarantined; legacy poisoned store ignored', async () => {
    const body = { codes: [{ depotId: '990050', gid: '990050000000000001', code: '12345' }] };
    assert.equal((await request('/api/manifests/code/report', 'unknown', body)).status, 401);
    deviceService.recordHeartbeat({ deviceId: 'registered-fixture', ip: 'fixture' });
    const result = await request('/api/manifests/code/report', 'registered-fixture', body);
    assert.equal(result.body.queued, 1); assert.equal(result.body.accepted, 0);
    assert(!manifestService.hasFreshCode(body.codes[0].gid));
    write(path.basename(manifestService.manifestCodeStorePath), { codes: { '990050000000000001': { code: '12345', fetchedAt: Date.now() } } });
    assert(!new ManifestService().hasFreshCode(body.codes[0].gid));
  });
  await check('R06: update digest reaches IPC; caller forwards version digest', async () => {
    await bridge.downloadUpdate('https://fixture.invalid/setup.exe', 'a'.repeat(64));
    assert.equal(ipc.find(call => call.command === 'download_update').args.sha256, 'a'.repeat(64));
    assert(read('src/renderer/App.vue').includes('downloadUpdate(versionModal.value.latest.downloadUrl, versionModal.value.latest.sha256)'));
  });
  await check('R07: fresh deployment generates persistent secrets, migrates default credentials, reload is idempotent', () => {
    assert(read('server/docker-compose.yml').includes('env_file:'));
    for (const file of ['install.sh', 'server/install.sh']) assert(read(file).includes('node scripts/prepareDeployment.mjs'));
    for (const file of ['update.sh', 'server/update.sh']) assert(!read(file).includes('node scripts/prepareDeployment.mjs'));
    assert(read('server/update.sh').includes('verifyDeployment.mjs'));
    assert(read('server/ecosystem.config.cjs').includes('cwd: __dirname'));
    const sandbox = path.join(data, 'deployment', 'server');
    fs.mkdirSync(path.join(sandbox, 'scripts'), { recursive: true });
    fs.mkdirSync(path.join(sandbox, 'data'));
    fs.writeFileSync(path.join(sandbox, 'package.json'), '{"type":"module"}');
    fs.copyFileSync(path.join(root, 'server/scripts/prepareDeployment.mjs'), path.join(sandbox, 'scripts/prepareDeployment.mjs'));
    fs.symlinkSync(path.join(root, 'server/node_modules'), path.join(sandbox, 'node_modules'), 'junction');
    const salt = 'fixture-salt';
    fs.writeFileSync(path.join(sandbox, 'data/admin_credentials.json'), JSON.stringify({ username: 'admin', salt, passwordHash: crypto.pbkdf2Sync('admin123', salt, 10000, 64, 'sha512').toString('hex') }));
    const env = { ...process.env, DATA_DIR: path.join(sandbox, 'data'), JWT_SECRET: '', LICENSE_PRIVATE_KEY: '' };
    for (let i = 0; i < 2; i++) {
      const child = spawnSync(process.execPath, ['scripts/prepareDeployment.mjs'], { cwd: sandbox, env, encoding: 'utf8' });
      assert.equal(child.status, 0, child.stderr);
      const parsed = serverRequire('dotenv').parse(fs.readFileSync(path.join(sandbox, '.env')));
      assert.equal(parsed.JWT_SECRET.length, 96);
      assert.equal(parsed.LICENSE_PUBLIC_KEY_HEX, fs.readFileSync(path.join(sandbox, 'data/license_ed25519_public.hex'), 'utf8'));
    }
    const creds = JSON.parse(fs.readFileSync(path.join(sandbox, 'data/admin_credentials.json')));
    assert.notEqual(creds.passwordHash, crypto.pbkdf2Sync('admin123', creds.salt, creds.pbkdf2Iterations, 64, 'sha512').toString('hex'));
  });
  await check('R08: failed extend, disable, unbind and delete all restore memory state', () => {
    const initial = { id: 'fixture', code: 'FIXTURE-M-01', type: 'monthly', durationDays: 30, status: 'active', deviceId: 'disk-fixture', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() };
    write('license_keys.json', [initial]); const service = new LicenseService();
    const blocker = path.join(data, 'write-blocker'); fs.mkdirSync(blocker); service.dataFilePath = blocker;
    for (const action of [() => service.extendDays(initial.code, 30), () => service.toggleStatus(initial.code, true), () => service.unbind(initial.code), () => service.deleteKey(initial.code)]) {
      assert.equal(action().success, false);
      const info = service.verify(initial.deviceId, initial.code); assert(info.isActivated); assert.equal(info.expiresAt, initial.expiresAt);
    }
  });
  await check('R09: stable merged pages preserve overflow and page revisits, total includes official extras', async () => {
    const cloudItems = Array.from({ length: 4 }, (_, i) => ({ appId: 101 + i, name: 'Cloud' }));
    let cloudCalls = 0;
    http = async url => ({ ok: true, json: async () => {
      const u = new URL(url);
      if (u.hostname === 'store.steampowered.com') return { items: [{ id: 1, name: 'Official' }] };
      cloudCalls++; const page = Number(u.searchParams.get('page')), size = Number(u.searchParams.get('pageSize'));
      return { success: true, data: { items: cloudItems.slice((page - 1) * size, page * size), total: 4, page, pageSize: size, totalPages: Math.ceil(4 / size) } };
    } });
    const pages = [];
    for (const page of [1, 2, 3]) pages.push(await bridge.searchGames({ query: 'regression', source: 'hybrid', page, pageSize: 2, seenIds: new Set() }));
    assert.deepEqual(pages.flatMap(p => Array.from(p.items, i => i.appId)), [1, 101, 102, 103, 104]);
    assert.equal(pages[0].total, 5); assert.equal(cloudCalls, 1);
    assert.deepEqual(Array.from((await bridge.searchGames({ query: 'regression', source: 'hybrid', page: 1, pageSize: 2 })).items, i => i.appId), [1, 101]);
  });
  await check('R10: updater uses parsed URL filename; invalid digests explicitly error; Rust tests exist', () => {
    assert(read('src-tauri/src/lib.rs').includes('update_validation::installer_filename(&clean_url)?'));
    assert(read('src-tauri/src/update_validation.rs').includes('signed_and_fragment_urls_use_path_filename'));
    assert(read('src-tauri/src/update_validation.rs').includes('Some(_) => Err'));
  });
  await check('R11: path setter migrates watcher; watcher tracks path and stops previous instance', () => {
    const source = read('src-tauri/src/lib.rs');
    const setter = source.slice(source.indexOf('async fn set_steam_path'), source.indexOf('async fn restart_steam'));
    assert(setter.includes('lua_watcher::start_lua_watcher(app, &p)'));
    assert(read('src-tauri/src/lua_watcher.rs').includes('existing.store(true'));
    assert(read('src-tauri/src/lua_watcher.rs').includes('*watched_dir == lua_dir'));
  });
  await check('R12: failed inviter reward persists and recovers after service reload, retries are idempotent', () => {
    const inviter = 'CFD-AAAA-BBBB-CCCC-DDDD', invitee = 'CFD-1111-2222-3333-4444';
    deviceService.recordHeartbeat({ deviceId: inviter, ip: 'fixture' });
    const original = licenseService.grantInviteDays.bind(licenseService);
    licenseService.grantInviteDays = (deviceId, ...args) => deviceId === inviter ? { success: false, grantedDays: 0, message: 'fixture temporary failure' } : original(deviceId, ...args);
    try { assert(inviteService.bindInviteCode(deriveInviteCode(inviter), invitee).success); }
    finally { licenseService.grantInviteDays = original; }
    const diskRecords = JSON.parse(fs.readFileSync(path.join(data, 'invite_records.json')));
    assert.equal(diskRecords[0].inviterRewardStatus, 'pending');
    const reloaded = new InviteService(); assert.equal(reloaded.retryPendingRewards(), 1);
    const expiry = licenseService.verify(inviter).expiresAt;
    assert.equal(reloaded.retryPendingRewards(), 0); assert.equal(licenseService.verify(inviter).expiresAt, expiry);
    const record = JSON.parse(fs.readFileSync(path.join(data, 'invite_records.json')))[0];
    assert.equal(record.inviterDays, 3); assert.equal(record.inviterRewardStatus, 'delivered');
    const first = original('ledger-fixture', 3, 'fixture', 'unique-reward');
    const second = original('ledger-fixture', 3, 'fixture', 'unique-reward');
    assert.equal(first.license.expiresAt, licenseService.verify('ledger-fixture').expiresAt); assert.equal(second.grantedDays, 3);
  });
  await check('CONTROL: anonymous management request rejected', async () => assert.equal((await request('/api/admin/stats', 'fixture')).status, 401));
  console.log(`REGRESSION_RESULT passed=${count} failed=0 fixture=${data}`);
} finally {
  await new Promise(resolve => server.close(resolve));
  freeQuotaService.flushNow(); manifestService.flushCodeStore(); deviceService.flushNow();
}
