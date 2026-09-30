import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bash = process.env.GIT_BASH || (process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'bash');
const posix = value => process.platform === 'win32'
  ? value.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`)
  : value;
const write = (root, name, data) => {
  const target = path.join(root, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
};
const run = (cmd, args, cwd, env) => {
  const result = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, `${cmd} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
};
const git = (root, ...args) => run('git', args, root);

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'steammaster-updater-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const remote = path.join(temp, 'remote.git');
  const root = path.join(temp, 'app');
  const fakeBin = path.join(temp, 'bin');
  fs.mkdirSync(root);
  fs.mkdirSync(fakeBin);
  run('git', ['init', '--bare', remote], temp);
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Updater Test');
  git(root, 'config', 'user.email', 'updater@example.invalid');
  git(root, 'remote', 'add', 'origin', remote);
  write(root, '.gitignore', 'server/.env\nserver/data/\nserver/node_modules/\nserver/dist/\n.server-update.*/\n.server-backups/\n');
  write(root, 'frontend.txt', 'frontend-unchanged');
  write(root, 'update.sh', 'old-root-script');
  write(root, 'server/update.sh', 'old-server-script');
  write(root, 'server/src/server.ts', 'old-server-source');
  write(root, 'server/scripts/old.sh', 'old-script');
  write(root, 'server/package.json', '{"name":"old","type":"module"}');
  write(root, 'server/package-lock.json', '{}');
  write(root, 'server/tsconfig.json', '{}');
  write(root, 'server/ecosystem.config.cjs', 'old-config');
  write(root, 'src-tauri/src/license_verify.rs', 'pub const DEFAULT_PUBKEY_HEX: &str = "old";');
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'initial');
  const oldCommit = git(root, 'rev-parse', 'HEAD');

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const publicHex = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  write(root, 'server/update.sh', fs.readFileSync(path.join(sourceRoot, 'server/update.sh')));
  write(root, 'update.sh', fs.readFileSync(path.join(sourceRoot, 'update.sh')));
  write(root, 'server/scripts/verifyDeployment.mjs', fs.readFileSync(path.join(sourceRoot, 'server/scripts/verifyDeployment.mjs')));
  write(root, 'server/src/server.ts', 'new-server-source');
  write(root, 'server/package.json', '{"name":"new","type":"module"}');
  write(root, 'server/ecosystem.config.cjs', 'new-config');
  write(root, 'src-tauri/src/license_verify.rs', `pub const DEFAULT_PUBKEY_HEX: &str = "${publicHex}";`);
  git(root, 'add', '.');
  git(root, 'commit', '-m', 'new server');
  git(root, 'push', 'origin', 'main');
  git(root, 'reset', '--hard', oldCommit);
  write(root, 'server/update.sh', fs.readFileSync(path.join(sourceRoot, 'server/update.sh')));
  write(root, 'server/.env', `JWT_SECRET=test-secret\nLICENSE_PUBLIC_KEY_HEX=${publicHex}\n`);
  write(root, 'server/data/license_ed25519_private.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }));
  write(root, 'server/data/license_ed25519_public.pem', publicKey.export({ type: 'spki', format: 'pem' }));
  write(root, 'server/data/license_ed25519_public.hex', publicHex);
  write(root, 'server/data/license_keys.json', '{"members":"unchanged"}');
  write(root, 'server/dist/server.js', 'old-dist');
  write(root, 'server/node_modules/old-module.txt', 'old-module');

  write(fakeBin, 'npm', `#!/usr/bin/env bash
set -e
if [[ "$1" == ci ]]; then
  mkdir -p node_modules/dotenv
  cat > node_modules/dotenv/package.json <<'EOF'
{"name":"dotenv","type":"module","main":"index.js"}
EOF
  cat > node_modules/dotenv/index.js <<'EOF'
export default { parse(buffer) { return Object.fromEntries(String(buffer).split(/\\r?\\n/).filter(x => x.includes('=')).map(x => { const i=x.indexOf('='); return [x.slice(0,i),x.slice(i+1).replace(/^"|"$/g,'')]; })); } };
EOF
else
  mkdir -p dist
  printf 'new-dist' > dist/server.js
fi
`);
  write(fakeBin, 'pm2', '#!/usr/bin/env bash\necho "$*" >> "$CALL_LOG"\nexit 0\n');
  write(fakeBin, 'curl', '#!/usr/bin/env bash\nif [[ "${FAIL_HEALTH:-0}" == 1 ]]; then exit 22; fi\nprintf \'{"status":"ok"}\'\n');
  for (const command of ['npm', 'pm2', 'curl']) fs.chmodSync(path.join(fakeBin, command), 0o755);
  return { root, fakeBin, temp, publicHex };
}

function invoke(f, env = {}) {
  const command = `export PATH='${posix(f.fakeBin)}':"$PATH"; exec bash '${posix(path.join(f.root, 'server/update.sh'))}'`;
  return spawnSync(bash, ['-c', command], {
    cwd: f.root, encoding: 'utf8', timeout: 120000,
    env: { ...process.env, CALL_LOG: path.join(f.temp, 'pm2.log'), ...env }
  });
}

test('only backend is promoted; data and frontend stay byte-identical', t => {
  const f = fixture(t);
  const beforeData = fs.readFileSync(path.join(f.root, 'server/data/license_keys.json'));
  const beforeEnv = fs.readFileSync(path.join(f.root, 'server/.env'));
  const result = invoke(f);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(fs.readFileSync(path.join(f.root, 'server/src/server.ts'), 'utf8'), 'new-server-source');
  assert.equal(fs.readFileSync(path.join(f.root, 'frontend.txt'), 'utf8'), 'frontend-unchanged');
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'server/data/license_keys.json')), beforeData);
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'server/.env')), beforeEnv);
  assert.match(result.stdout, /健康状态 ok/);
});

test('failed health check restores old server and root wrapper', t => {
  const f = fixture(t);
  const result = invoke(f, { FAIL_HEALTH: '1' });
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(path.join(f.root, 'server/src/server.ts'), 'utf8'), 'old-server-source');
  assert.equal(fs.readFileSync(path.join(f.root, 'server/dist/server.js'), 'utf8'), 'old-dist');
  assert.equal(fs.readFileSync(path.join(f.root, 'update.sh'), 'utf8'), 'old-root-script');
  assert.equal(fs.readFileSync(path.join(f.root, 'server/data/license_keys.json'), 'utf8'), '{"members":"unchanged"}');
  assert.match(result.stdout, /旧代码已恢复/);
});

test('mismatched signing key stops before promotion', t => {
  const f = fixture(t);
  write(f.root, 'server/data/license_ed25519_public.hex', '0'.repeat(64));
  const result = invoke(f);
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(path.join(f.root, 'server/src/server.ts'), 'utf8'), 'old-server-source');
  assert.equal(fs.existsSync(path.join(f.root, '.server-backups')), false);
});
