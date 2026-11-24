import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn, spawnSync} from 'node:child_process';
import {ownedProcess} from '../tools/owned-process.mjs';
import {source} from './helpers.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, limit = 5000) {
  const deadline = Date.now() + limit;
  while (!check()) { assert(Date.now() < deadline, 'Owned process did not exit within cleanup budget'); await pause(30); }
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'chelm-owned-'));
  t.after(() => fs.rmSync(base, {recursive:true, force:true, maxRetries:10, retryDelay:100}));
  const pidFile = path.join(base, 'started.json'), script = path.join(base, 'child.cjs');
  fs.writeFileSync(script, `const fs=require('node:fs'); const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    child.unref();fs.writeFileSync(process.argv[2],JSON.stringify([process.pid,child.pid]));
    if(process.argv[3]==='throw')throw Error('synthetic');
    if(process.argv[3]==='success'){process.stdout.write('done');process.exit(0);}setInterval(()=>{},1000);`);
  return {base, pidFile, script};
}
test('Owned timeout occurs after child startup, kills descendants, preserves unrelated sentinel', async t => {
  const f = fixture(t), sentinel = spawn(process.execPath, ['-e','setInterval(()=>{},1000)'], {stdio:'ignore'});
  t.after(() => sentinel.kill());
  const started = Date.now();
  const r = ownedProcess(process.execPath, [f.script, f.pidFile], {timeout:3000, phase:'synthetic delayed descendant'});
  assert.equal(r.error?.code, 'operation_timeout', r.stderr);
  assert.match(r.stderr, /synthetic delayed descendant/);
  assert.match(r.stderr, /operation_timeout/);
  assert(fs.existsSync(f.pidFile), 'Timeout must occur after recorded descendant startup');
  const pids = JSON.parse(fs.readFileSync(f.pidFile));
  await until(() => pids.every(pid => !alive(pid)));
  assert(Date.now() - started < 8000);
  assert(alive(sentinel.pid));
});
test('Abrupt caller termination leaves supervisor able to clean its owned child tree', async t => {
  const f = fixture(t), caller = path.join(f.base, 'caller.mjs');
  fs.writeFileSync(caller, `import {ownedProcess} from ${JSON.stringify(new URL('../tools/owned-process.mjs', import.meta.url).href)};
    ownedProcess(process.execPath,${JSON.stringify([f.script,f.pidFile])},{timeout:30000,phase:'abrupt caller'});`);
  const parent = spawn(process.execPath, [caller], {stdio:'ignore'});
  t.after(() => { if (parent.exitCode === null) parent.kill('SIGKILL'); });
  await until(() => fs.existsSync(f.pidFile));
  const pids = JSON.parse(fs.readFileSync(f.pidFile));
  parent.kill('SIGKILL');
  await until(() => pids.every(pid => !alive(pid)));
});
test('Owned normal success and thrown error preserve exit/output and remove descendants', async t => {
  const f=fixture(t);
  const normal = ownedProcess(process.execPath, [f.script,f.pidFile,'success'], {timeout:3000});
  assert.equal(normal.status, 0, normal.stderr); assert.equal(normal.stdout, 'done');
  await until(()=>JSON.parse(fs.readFileSync(f.pidFile)).every(pid=>!alive(pid)));
  const thrown = ownedProcess(process.execPath, [f.script,f.pidFile,'throw'], {timeout:3000});
  assert.equal(thrown.status, 1); assert.match(thrown.stderr, /synthetic/);
  await until(()=>JSON.parse(fs.readFileSync(f.pidFile)).every(pid=>!alive(pid)));
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
