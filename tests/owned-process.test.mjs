import test from './scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import net from 'node:net';
import {ownedProcess, ownedProcessAsync} from '../tools/owned-process.mjs';
import {source} from './helpers.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, limit = 5000) {
  const deadline = Date.now() + limit;
  while (!check()) { assert(Date.now() < deadline, 'Owned process did not exit within cleanup budget'); await pause(30); }
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function closed(port) {
  await new Promise((resolve,reject)=>{
    const socket=net.connect({host:'127.0.0.1',port});
    socket.once('connect',()=>{socket.destroy();reject(Error('Owned listening socket survived cleanup'));});
    socket.once('error',resolve);
    socket.setTimeout(1000,()=>{socket.destroy();reject(Error('Socket cleanup check timed out'));});
  });
}
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'chelm-owned-'));
  t.after(() => fs.rmSync(base, {recursive:true, force:true, maxRetries:10, retryDelay:100}));
  const pidFile = path.join(base, 'started.json'), script = path.join(base, 'child.cjs');
  const listener=path.join(base,'listener.cjs');
  fs.writeFileSync(listener,`require('node:net').createServer().listen(0,'127.0.0.1',function(){process.send({port:this.address().port});});`);
  fs.writeFileSync(script, `const fs=require('node:fs'); const {fork}=require('node:child_process');
    const child=fork(${JSON.stringify(listener)},[],{stdio:['ignore','ignore','ignore','ipc']});
    child.once('message',({port})=>{fs.writeFileSync(process.argv[2],JSON.stringify({pids:[process.pid,child.pid],port}));
      if(process.argv[3]==='throw')throw Error('synthetic');
      if(process.argv[3]==='success'){process.stdout.write('done');process.exit(0);}setInterval(()=>{},1000);});`);
  return {base, pidFile, script};
}
for (const run of [ownedProcess, ownedProcessAsync]) {
test(`${run.name}: timeout after child startup kills descendants and preserves unrelated sentinel`, async t => {
  const f = fixture(t), sentinel = spawn(process.execPath, ['-e','setInterval(()=>{},1000)'], {stdio:'ignore'});
  t.after(() => sentinel.kill());
  const started = Date.now();
  const r = await run(process.execPath, [f.script, f.pidFile], {timeout:3000, phase:'synthetic delayed descendant'});
  assert.equal(r.error?.code, 'operation_timeout', r.stderr);
  assert.match(r.stderr, /synthetic delayed descendant/);
  assert.match(r.stderr, /operation_timeout/);
  assert(fs.existsSync(f.pidFile), 'Timeout must occur after recorded descendant startup');
  const {pids,port} = JSON.parse(fs.readFileSync(f.pidFile));
  await until(() => pids.every(pid => !alive(pid)));
  await closed(port);
  assert(Date.now() - started < 8000);
  assert(alive(sentinel.pid));
});
test(`${run.name}: abrupt caller termination leaves supervisor able to clean its owned child tree`, async t => {
  const f = fixture(t), caller = path.join(f.base, 'caller.mjs');
  fs.writeFileSync(caller, `import {${run.name}} from ${JSON.stringify(new URL('../tools/owned-process.mjs', import.meta.url).href)};
    await ${run.name}(process.execPath,${JSON.stringify([f.script,f.pidFile])},{timeout:30000,phase:'abrupt caller'});`);
  const parent = spawn(process.execPath, [caller], {stdio:'ignore'});
  t.after(() => { if (parent.exitCode === null) parent.kill('SIGKILL'); });
  await until(() => fs.existsSync(f.pidFile));
  const {pids,port} = JSON.parse(fs.readFileSync(f.pidFile));
  parent.kill('SIGKILL');
  await until(() => pids.every(pid => !alive(pid)));
  await closed(port);
});
test(`${run.name}: normal success and thrown error preserve exit/output and remove descendants`, async t => {
  const f=fixture(t);
  const normal = await run(process.execPath, [f.script,f.pidFile,'success'], {timeout:3000});
  assert.equal(normal.status, 0, normal.stderr); assert.equal(normal.stdout, 'done');
  await until(()=>JSON.parse(fs.readFileSync(f.pidFile)).pids.every(pid=>!alive(pid)));
  await closed(JSON.parse(fs.readFileSync(f.pidFile)).port);
  const thrown = await run(process.execPath, [f.script,f.pidFile,'throw'], {timeout:3000});
  assert.equal(thrown.status, 1); assert.match(thrown.stderr, /synthetic/);
  await until(()=>JSON.parse(fs.readFileSync(f.pidFile)).pids.every(pid=>!alive(pid)));
  await closed(JSON.parse(fs.readFileSync(f.pidFile)).port);
});
}
test('Async supervision preserves finite stdin/output and reports spawn and buffer failures', async () => {
  const echoed=await ownedProcessAsync(process.execPath,['-e',
    "process.stdin.pipe(process.stdout);process.stderr.write('diagnostic');"],{input:'finite input',timeout:3000});
  assert.equal(echoed.status,0,echoed.stderr);
  assert.equal(echoed.stdout,'finite input');assert.equal(echoed.stderr,'diagnostic');
  const absent=await ownedProcessAsync(process.execPath,[],{python:path.join(os.tmpdir(),'missing-python-'+process.pid)});
  assert.equal(absent.error?.code,'ENOENT');
  const oversized=await ownedProcessAsync(process.execPath,['-e',"process.stdout.write('x'.repeat(17*1024*1024));"],{timeout:3000});
  assert.equal(oversized.error?.code,'ENOBUFS');
  assert.equal(Buffer.byteLength(oversized.stdout),16*1024*1024);
});
test('CLI finite stdin EOF: empty/malformed input is usage; valid JSON reaches runtime handling', () => {
  for (const input of ['', '{', '{}']) {
    const r = spawnSync(process.execPath, [path.join(source,'bin/chelm.mjs'),'cognitive-worker','read',
      '--runtime', path.join(os.tmpdir(),'chelm-absent-'+process.pid), '--input','-'], {input, encoding:'utf8', timeout:3000});
    assert(!r.error, r.error?.message);
    const value = JSON.parse(r.stdout); assert.equal(value.ok, false);
    assert.equal(value.error.code === 'usage', input !== '{}');
  }
});
test('Injected async scenario hang reaches its own finite budget before the file/suite limit',t=>{
  const f=fixture(t),script=path.join(f.base,'hang.test.mjs');
  fs.writeFileSync(script,`import test from ${JSON.stringify(new URL('./scenario.mjs',import.meta.url).href)};
    test('injected hang',{timeout:50},async t=>{const timer=setInterval(()=>{},1000);t.after(()=>clearInterval(timer));await new Promise(()=>{});});`);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const r=ownedProcess(process.execPath,['--test','--test-reporter=tap',script],{timeout:3000,phase:'injected scenario hang',env});
  assert(!r.error,r.error?.message);assert.equal(r.status,1);assert.match(r.stdout,/test timed out after 50ms/);
});
