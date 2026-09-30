#!/usr/bin/env node
// Isolated regressions: no live service, Steam installation or game data is touched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.env.REVIEW_PROJECT_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vulnerable = process.argv.includes('--expect-vulnerable');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'critical-regression-'));
process.env.DATA_DIR = data;
process.env.JWT_SECRET = crypto.randomBytes(48).toString('hex');
process.env.ADMIN_PASS = 'fixture-old-password';
process.env.LICENSE_PRIVATE_KEY = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
delete process.env.LICENSE_PUBLIC_KEY_HEX;
const url = f => pathToFileURL(path.join(root, 'server/dist', f)).href;
const load = f => import(url(f));
const { AuthService } = await load('services/authService.js');
const results = {};
const check = async (name, action) => {
  try { await action(); results[name] = vulnerable ? 'VULNERABLE' : 'PASS'; }
  catch (e) { results[name] = 'FAIL'; console.error(name, e); }
};

await check('auth', async () => {
  // Exercise both current and legacy credentials, and password change vs logout.
  for (const legacy of [false, true]) for (const action of ['password', 'logout']) {
    const salt = crypto.randomBytes(16).toString('hex');
    const iterations = legacy ? 10000 : 210000;
    fs.writeFileSync(path.join(data, 'admin_credentials.json'), JSON.stringify({ username: 'admin', salt,
      passwordHash: crypto.pbkdf2Sync(process.env.ADMIN_PASS, salt, iterations, 64, 'sha512').toString('hex'),
      pbkdf2Iterations: iterations, tokenVersion: 1 }));
    const auth = new AuthService();
    const oldToken = auth.generateToken('admin');
    const original = auth.hashPasswordAsync.bind(auth);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    auth.hashPasswordAsync = async (...args) => { const hash = await original(...args); await gate; return hash; };
    const pending = auth.login('admin', process.env.ADMIN_PASS, 'race-fixture');
    if (action === 'password') assert(auth.changePassword(process.env.ADMIN_PASS, 'renamed-admin', 'fixture-new-password', 'admin').success);
    else auth.revokeAllTokens();
    assert.equal(auth.verifyToken(oldToken), null);
    release();
    const completed = await pending;
    auth.hashPasswordAsync = original;
    assert.equal(completed.success, vulnerable, `${action}/${legacy}: stale login`);
    assert.equal(!!auth.verifyToken(oldToken), vulnerable, `${action}/${legacy}: revoked token`);
    if (action === 'password') {
      assert.equal((await auth.login('renamed-admin', 'fixture-new-password', 'new-fixture')).success, !vulnerable);
      assert.equal((await auth.login('admin', process.env.ADMIN_PASS, 'old-fixture')).success, vulnerable);
    } else if (!vulnerable) {
      assert((await auth.login('admin', process.env.ADMIN_PASS, 'fresh-fixture')).success);
    }
  }
});

await check('shutdown', async () => {
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const dir = fs.mkdtempSync(path.join(data, 'shutdown-'));
    for (const file of ['license_keys.json', 'devices.json', 'steam_all_games.json', 'chinese_games_cache.json', 'sponsors.json', 'notices.json', 'versions.json']) fs.writeFileSync(path.join(dir, file), '[]');
    for (const file of ['steam_tokens.json', 'steam_depot_keys.json']) fs.writeFileSync(path.join(dir, file), '{}');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      await import(${JSON.stringify(url('routes/index.js'))});
      const {deviceService:d}=await import(${JSON.stringify(url('services/deviceService.js'))});
      const {freeQuotaService:q}=await import(${JSON.stringify(url('services/freeQuotaService.js'))});
      const {dlcIndexService:i}=await import(${JSON.stringify(url('services/dlcIndexService.js'))});
      const {toolboxService:t}=await import(${JSON.stringify(url('services/toolboxService.js'))});
      d.recordHeartbeat({deviceId:'exit-fixture',ip:'fixture'});
      q.reserve('exit-fixture',990001).settle(true);
      i.set(990001,{dlcIds:['990002'],dlcDepots:{},depots:[]});
      // Force an asynchronous write to be in flight, then dirty the index again.
      const writing=i.flush();
      i.set(990003,{dlcIds:['990004'],dlcDepots:{},depots:[]});
      t.recordRepairLog({deviceId:'exit-fixture',actionType:'clear_cache',success:true,message:'fixture'});
      process.emit(${JSON.stringify(signal)});
    `], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8', timeout: 20000 });
    assert.equal(child.status, 0, child.stderr);
    const quotaPath = path.join(dir, 'free_quota.json');
    const devices = JSON.parse(fs.readFileSync(path.join(dir, 'devices.json'), 'utf8'));
    assert.equal(fs.existsSync(quotaPath) && devices.length === 1, !vulnerable, signal);
    if (!vulnerable) {
      assert.equal(JSON.parse(fs.readFileSync(quotaPath, 'utf8'))['exit-fixture'].used, 1);
      const index = JSON.parse(fs.readFileSync(path.join(dir, 'dlc_index.json'), 'utf8'));
      assert(index['990001'] && index['990003'], 'both pending and subsequent index updates persist');
      assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'toolbox_repair_logs.json'), 'utf8')).length, 1);
    }
  }
});

await check('backup', async () => {
  const module = path.join(root, 'src-tauri/src/file_restore.rs');
  const original = fs.readFileSync(path.join(root, 'src-tauri/src/localgames.rs'), 'utf8');
  if (!vulnerable) {
    assert(original.includes('crate::file_restore::restore_appid_tree(game_path)'), 'production delegates to the tested restore helper');
    assert(original.includes('clean_steam_appid_txt_all_locations(&gp_open)?;'), 'restore errors abort launch');
  }
  const legacy = original.slice(original.indexOf('fn clean_steam_appid_txt_all_locations('), original.indexOf('/// 确保 HKCU\\Software\\Valve\\Steam\\Apps'));
  const source = fs.existsSync(module)
    ? `#[path=${JSON.stringify(module.replaceAll('\\', '/'))}] mod file_restore; use file_restore::restore_appid_tree as restore;`
    : legacy + '\nuse clean_steam_appid_txt_all_locations as restore;';
  const dir = path.join(data, 'native'); fs.mkdirSync(dir);
  const rs = path.join(data, 'backup_probe.rs'), exe = path.join(data, 'backup_probe.exe');
  fs.writeFileSync(rs, `use std::fs;use std::path::{Path,PathBuf};\n${source}\n` + String.raw`
    fn main() {
      use std::os::windows::fs::OpenOptionsExt;
      let dir=PathBuf::from(std::env::args().nth(1).unwrap());
      fs::write(dir.join("fixture.exe"),b"inert fixture").unwrap();
      fs::write(dir.join("steam_appid.txt"),b"480").unwrap();
      fs::write(dir.join("steam_appid.txt.cfd_bak"),b"12345").unwrap();
      let lock=fs::OpenOptions::new().read(true).share_mode(0).open(dir.join("steam_appid.txt")).unwrap();
      let _=restore(&dir); drop(lock);
      assert_eq!(fs::read_to_string(dir.join("steam_appid.txt")).unwrap(),"480");
      println!("BACKUP_RETAINED={}",dir.join("steam_appid.txt.cfd_bak").exists());
    }
  `);
  const build = spawnSync('rustc', ['--edition=2021', '--crate-name', 'backup_probe', rs, '-o', exe], { encoding: 'utf8', timeout: 120000 });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(exe, [dir], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert(run.stdout.includes(`BACKUP_RETAINED=${!vulnerable}`), run.stdout);
});

console.log('CRITICAL_RESULT ' + Object.entries(results).map(([k, v]) => `${k}=${v}`).join(' '));
if (Object.values(results).includes('FAIL')) process.exitCode = 1;
