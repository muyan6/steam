#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const serverRequire = createRequire(path.join(root, 'server/package.json'));
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'p2p-regression-'));
process.env.DATA_DIR = data;
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.ADMIN_PASS = 'fixture-password';
process.env.LICENSE_PRIVATE_KEY = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
delete process.env.LICENSE_PUBLIC_KEY_HEX;
for (const file of ['license_keys.json', 'devices.json', 'steam_all_games.json', 'chinese_games_cache.json', 'sponsors.json']) fs.writeFileSync(path.join(data, file), '[]');
for (const file of ['steam_tokens.json', 'steam_depot_keys.json']) fs.writeFileSync(path.join(data, file), '{}');
const load = file => import(pathToFileURL(path.join(root, 'server/dist', file)).href);
const { parseP2pPeers, logTimeMs } = await load('utils/p2pLogParser.js');
const { default: router } = await load('routes/index.js');
const { authService } = await load('services/authService.js');
const { freeQuotaService } = await load('services/freeQuotaService.js');
const { deviceService } = await load('services/deviceService.js');
const express = serverRequire('express');
const app = express(); app.use(express.json()); app.use('/api', router);
const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const base = 'http://127.0.0.1:' + server.address().port;
const ts = require('typescript');
const helpers = { exports: {} };
vm.createContext(helpers);
vm.runInContext(ts.transpileModule(fs.readFileSync(path.join(root, 'src/renderer/utils/p2p.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, helpers);
const { matchesTunnelConfig, peerLatencyLabel, peerLatencyClass } = helpers.exports;
let count = 0;
async function check(name, action) { await action(); count++; console.log('PASS ' + name); }
try {
  const cases = JSON.parse(fs.readFileSync(path.join(root, 'tests/p2p/log-cases.json')));
  await check(`${cases.length} shared backend/native peer-latency fixtures`, () => {
    for (const fixture of cases) {
      const peers = parseP2pPeers(fixture.log, logTimeMs(fixture.now));
      assert.equal(peers.length, fixture.expected.length, fixture.name);
      for (const expected of fixture.expected) {
        const actual = peers.find(p => p.nodeId === expected.nodeId);
        assert(actual, fixture.name);
        for (const [field, value] of Object.entries(expected)) assert.deepEqual(actual[field], value, fixture.name + '/' + field);
      }
    }
  });
  await check('N01 exact tunnel identity and protocol prevents false-active room', () => {
    const app = { peerNode: 'ROOM-B', srcPort: 27015, dstPort: 27015, protocol: 'udp' };
    const room = { peerUid: 'room-a', localPort: 27015, remotePort: 27015, protocol: 'udp' };
    assert(!matchesTunnelConfig(app, room)); assert(matchesTunnelConfig(app, { ...room, peerUid: 'room-b' }));
    assert(!matchesTunnelConfig(app, { ...room, peerUid: 'room-b', protocol: 'tcp' }));
    assert(!matchesTunnelConfig(app, { ...room, peerUid: 'room-b', remotePort: 27016 }));
  });
  await check('N02 failed daemon launch gives failure toast and does not copy success code', async () => {
    const panel = fs.readFileSync(path.join(root, 'src/renderer/components/onlinefix/P2pNetworkingPanel.vue'), 'utf8');
    const source = panel.slice(panel.indexOf('const handleGenerateShareCode ='), panel.indexOf('const parseCode ='));
    const messages = [], copies = [];
    const context = { currentPreset: { value: null }, hostPort: { value: 27015 }, hostProtocol: { value: 'udp' }, nodeId: { value: 'fixture' }, latestGeneratedCode: { value: '' }, status: { value: { running: false } }, isOperating: { value: false },
      p2pGetNodeId: async () => 'fixture', p2pGenerateCode: async () => 'fixture-code', p2pStartDaemon: async () => { throw Error('fixture launch failure'); },
      fetchStatus: async () => {}, copyText: async text => copies.push(text), emit: (_, message) => messages.push(message), formatIpcError: String };
    vm.createContext(context);
    vm.runInContext(ts.transpileModule(source + '\nglobalThis.run = handleGenerateShareCode;', { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
    await context.run(); assert.equal(copies.length, 0); assert.equal(messages.length, 1); assert(messages[0].includes('fixture launch failure')); assert.equal(context.isOperating.value, false);
    context.p2pStartDaemon = async () => true;
    await context.run(); assert.equal(copies.length, 1); assert.equal(context.latestGeneratedCode.value, 'fixture-code');
  });
  await check('latency UI displays measured, stale, unknown and zero distinctly', () => {
    assert.equal(peerLatencyLabel({ latencyMs: 37, latencyStale: false }), '37 ms');
    assert.equal(peerLatencyLabel({ latencyMs: 37, latencyStale: true }), '已过期');
    assert.equal(peerLatencyLabel({ latencyMs: null }), '未采样');
    assert.notEqual(peerLatencyLabel({ latencyMs: 0 }), '未采样');
    assert.equal(peerLatencyClass({ latencyMs: NaN }), 'text-slate-400');
  });
  await check('actual Vue peer panel renders latency and placeholder labels', async () => {
    const Vue = require('vue');
    const panel = fs.readFileSync(path.join(root, 'src/renderer/components/onlinefix/P2pNetworkingPanel.vue'), 'utf8');
    const template = panel.slice(panel.indexOf('    <!-- 已连接对端看板'), panel.indexOf('    <!-- 常用联机房间'));
    const compiled = require('@vue/compiler-dom').compile(template, { mode: 'function', prefixIdentifiers: true });
    const render = new Function('Vue', compiled.code)(Vue);
    const peer = { nodeId: '测试连接人', appId: '9001', direction: 'in', transport: 'direct', ports: [], lastSeen: '2026/09/29 12:00:10', latencyMs: 37, latencyStale: false, latencyUpdatedAt: '2026/09/29 12:00:10', latencySource: 'tunnel-heartbeat' };
    const app = Vue.createSSRApp({ render, setup: () => ({ peers: [peer, { ...peer, nodeId: '未采样连接人', latencyMs: null, latencySource: null }], peerLatencyLabel, peerLatencyClass }) });
    app.component('Users', require('lucide-vue-next').Users);
    const html = await require('@vue/server-renderer').renderToString(app);
    assert(html.includes('37 ms')); assert(html.includes('未采样')); assert(html.includes('测试连接人')); assert(html.includes('Peer RTT'));
    fs.writeFileSync(path.join(data, 'peer-panel-preview.html'), html);
  });
  await check('backend config exposes matching metrics contract and diagnostic route is authenticated', async () => {
    const config = await (await fetch(base + '/api/p2p/config')).json();
    assert.equal(config.peerMetrics.staleAfterMs, 30000); assert.equal(config.peerMetrics.metric, 'rtt'); assert.equal(config.peerMetrics.uploadsAutomatically, false);
    const payload = { log: cases[0].log };
    const options = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
    assert.equal((await fetch(base + '/api/admin/p2p/inspect-log', options)).status, 401);
    options.headers.Authorization = 'Bearer ' + authService.generateToken('admin');
    const response = await fetch(base + '/api/admin/p2p/inspect-log', options);
    assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.data.peers[0].latencyMs, 37);
    options.body = JSON.stringify({ log: 'x'.repeat(65537) });
    assert.equal((await fetch(base + '/api/admin/p2p/inspect-log', options)).status, 400);
  });
  console.log(`P2P_REGRESSION_RESULT passed=${count} failed=0 fixture=${data}`);
} finally {
  await new Promise(resolve => server.close(resolve)); freeQuotaService.flushNow(); deviceService.flushNow();
}
