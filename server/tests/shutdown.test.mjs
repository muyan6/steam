import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const moduleUrl = new URL('../dist/utils/shutdown.js', import.meta.url).href;
const run = code => spawnSync(process.execPath, ['--input-type=module', '-e', `
  import {registerShutdownHook, setShutdownServer} from ${JSON.stringify(moduleUrl)};
  ${code}
`], { encoding: 'utf8', timeout: 15000, cwd: fileURLToPath(new URL('../', import.meta.url)) });

test('a failed hook does not skip later async hooks; repeated signals do not reenter', () => {
  const result = run(`
    let count=0;
    registerShutdownHook('failed',()=>{console.log('FIRST');throw Error('fixture failure');});
    registerShutdownHook('later',async()=>{
      await new Promise(r=>setTimeout(r,30));
      console.log('LATER='+ ++count);
    });
    process.emit('SIGTERM'); process.emit('SIGINT'); process.emit('SIGTERM');
  `);
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout.trim(), 'FIRST\nLATER=1');
});

test('HTTP requests already in flight finish before flush', () => {
  const result = run(`
    const {createServer}=await import('node:http');
    let completed=false;
    const server=createServer((_req,res)=>{
      process.emit('SIGTERM');
      setTimeout(()=>{completed=true;res.end('done');},80);
    });
    setShutdownServer(server);
    registerShutdownHook('state',()=>{
      if(!completed)throw Error('flushed before request settled');
      console.log('DRAINED=true');
    });
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    await fetch('http://127.0.0.1:'+server.address().port);
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'DRAINED=true');
});

test('natural exit flushes and preserves a preexisting failure status', () => {
  const result = run(`
    registerShutdownHook('natural',async()=>{await new Promise(r=>setTimeout(r,10));console.log('NATURAL_FLUSH');});
    process.exitCode=7;
  `);
  assert.equal(result.status, 7, result.stderr);
  assert.equal(result.stdout.trim(), 'NATURAL_FLUSH');
});
