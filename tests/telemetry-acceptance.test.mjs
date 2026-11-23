import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture, ok, executor, analyze, refuse} from './helpers.mjs';
import {operation, currentOperation} from '../lib/telemetry.mjs';
import {readSummary, recordRead} from '../lib/telemetry.mjs';

const config = (f, enabled) => {
  const p = path.join(f.root, 'chelm.runtime.json'), c = JSON.parse(fs.readFileSync(p));
  c.observability = {operation_phases: enabled, read_metrics: false};
  fs.writeFileSync(p, JSON.stringify(c));
};
const events = f => fs.readFileSync(path.join(f.root, 'host/logs/chelm.jsonl'), 'utf8')
  .trim().split('\n').map(JSON.parse);

test('VP-021 phases: disabled fields, enabled refresh/submit/failure, no carryover', t => {
  const f = fixture(t);
  f.submit();
  ok('refresh', null, f.root);
  for (const key of ['phases', 'git']) assert.equal(events(f).at(-1)[key], undefined);
  config(f, true);
  ok('refresh', null, f.root);
  assert.ok(events(f).at(-1).phases.validator.calls > 0);
  assert.ok(events(f).at(-1).git.calls > 0);
  const unit = ok('worker', 'next', f.root, {executor}).work_unit;
  analyze(f, unit);
  ok('worker', 'submit', f.root, {executor, run_id: unit.run_id});
  const submitted = events(f).at(-1);
  assert.equal(submitted.run_id, unit.run_id);
  assert.ok(submitted.git.calls > 0);
  assert.ok(submitted.phases.operation.elapsed_ms >= 0);
  refuse('input_invalid', 'submit', null, f.root, {groups: []});
  const failed = events(f).at(-1);
  assert.equal(failed.outcome, 'input_invalid');
  assert.ok(failed.phases.operation.elapsed_ms >= 0);
  // The application's failure path refreshes views and legitimately runs Git.
  // It must not inherit the preceding successful adapter submission's phases.
  assert.ok(Number.isSafeInteger(failed.git.calls));
  assert.equal(Object.keys(failed.phases).some(k => k.startsWith('adapter_')), false);
  assert.equal(failed.usage, undefined);
  assert.equal(failed.run_id, null);
  config(f, false);
  ok('refresh', null, f.root);
  for (const key of ['phases', 'git']) assert.equal(events(f).at(-1)[key], undefined);
});

test('VP-021 overlapping operation contexts isolate successful and failing phases', async t => {
  const f = fixture(t); config(f, true);
  let release, entered;
  const gate = new Promise(r => { release = r; });
  const ready = new Promise(r => { entered = r; });
  const first = operation(f.root, 'refresh', async () => {
    const c = currentOperation();
    await c.metrics.async('first_only', async () => { entered(); await gate; });
    assert.equal(currentOperation(), c);
    return c.metrics.report();
  });
  await ready;
  const second = await operation(f.root, 'submit', async () => {
    const c = currentOperation();
    assert.throws(() => c.metrics.sync('second_only', () => { throw Error('synthetic'); }));
    return c.metrics.report();
  });
  release();
  const one = await first;
  assert.ok(one.phases.first_only);
  assert.equal(one.phases.second_only, undefined);
  assert.ok(second.phases.second_only);
  assert.equal(second.phases.first_only, undefined);
  assert.equal(currentOperation(), undefined);
});

function root(t) {
  const p = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chelm-metrics-acceptance-'));
  t.after(() => fs.rmSync(p, {recursive:true, force:true, maxRetries:10, retryDelay:100}));
  return p;
}
async function waitFor(p, child) {
  const until = Date.now() + 15000;
  while (!fs.existsSync(p)) {
    if (child.exitCode !== null || Date.now() > until) throw Error('publisher barrier not reached: ' + p);
    await delay(10);
  }
}
function peer(t, p, mode, marker, gate) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./process/telemetry-peer.mjs', import.meta.url)), p, mode, marker, gate], {stdio:['ignore','pipe','pipe']});
  let errors = ''; child.stderr.on('data', b => {errors += b;});
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({code, signal, errors}));
  });
  t.after(async () => {if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await done;});
  return {child, done};
}

test('VP-021 kill before shard persistence does not invent a completed sample', async t => {
  const p = root(t), marker=path.join(p,'marker'), gate=path.join(p,'gate');
  const {child,done}=peer(t,p,'crash-before-shard',marker,gate);
  await waitFor(marker+'.before',child);
  child.kill('SIGKILL'); await done;
  assert.equal(readSummary(p).calls,0);
  const open=path.join(p,'open');fs.writeFileSync(open,'continue');
  assert.equal((await peer(t,p,'normal',path.join(p,'restart'),open).done).code,0);
  assert.equal(readSummary(p).calls,1);
});

for (const crash of [false, true]) test(`VP-021 ${crash ? 'killed' : 'out-of-order'} summary publisher preserves persisted counters and restart repairs cache`, async t => {
  const p = root(t), marker = path.join(p,'marker'), gate = path.join(p,'gate');
  const {child, done} = peer(t, p, crash ? 'crash-after' : 'pause-before', marker, gate);
  await waitFor(marker + '.before', child); // A has computed its one-call summary.
  recordRead(p, 'read summary', 3, true); // B publishes a newer two-call summary.
  assert.equal(readSummary(p).calls, 2);
  fs.writeFileSync(gate, 'continue'); // A now publishes its older cached summary.
  if (crash) {
    await waitFor(marker + '.after', child);
    child.kill('SIGKILL'); await done;
    assert.equal(JSON.parse(fs.readFileSync(path.join(p,'host/metrics/reads.json'))).calls, 1);
    assert.equal(readSummary(p).calls, 2); // authoritative, read-only aggregation
    const before = fs.readFileSync(path.join(p,'host/metrics/reads.json'),'utf8');
    assert.equal(readSummary(p).errors, 1);
    assert.equal(fs.readFileSync(path.join(p,'host/metrics/reads.json'),'utf8'), before);
  } else {
    assert.equal((await done).code, 0);
    assert.equal(JSON.parse(fs.readFileSync(path.join(p,'host/metrics/reads.json'))).calls, 2);
  }
  // A genuinely new process/session keeps the prior persisted totals.
  const restarted = peer(t, p, 'normal', path.join(p,'restart'), path.join(p,'open'));
  fs.writeFileSync(path.join(p,'open'), 'continue');
  assert.equal((await restarted.done).code, 0);
  assert.equal(readSummary(p).calls, 3);
  assert.equal(readSummary(p).errors, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(p,'host/metrics/reads.json'))).calls, 3);
});

test('VP-021 retention, corrupt shards, saturation and bounded percentile window', t => {
  const p = root(t), dir = path.join(p,'host/metrics/read-shards');
  fs.mkdirSync(dir, {recursive:true});
  const stamp = Date.now();
  const shard = (updated_ms, calls = 1) => ({updated_ms, views:{'read summary':{calls, errors:0, samples:[{at:updated_ms, id:'synthetic', ms:2}]}}});
  const expired = path.join(dir,'00000000-0000-4000-8000-000000000000.json');
  fs.writeFileSync(expired, JSON.stringify(shard(stamp - 8*86400000, 99)));
  fs.utimesSync(expired, new Date(stamp - 8*86400000), new Date(stamp - 8*86400000));
  assert.equal(readSummary(p).calls, 0);
  assert.ok(fs.existsSync(expired)); // read-only summary does not clean files
  recordRead(p, 'read summary', 1, false);
  assert.equal(fs.existsSync(expired), false);
  const broken = path.join(dir,'00000000-0000-4000-8000-000000000001.json');
  fs.writeFileSync(broken, '{partial');
  assert.equal(readSummary(p).complete, false);
  fs.unlinkSync(broken);
  for (let i=0; i<9999; i++) fs.writeFileSync(path.join(dir, `00000000-0000-4000-8000-${String(i).padStart(12,'0')}.json`), JSON.stringify(shard(stamp)));
  const summary = readSummary(p);
  assert.equal(summary.calls, 10000);
  assert.equal(summary.complete, false);
  assert.equal(summary.views['read summary'].window_samples, 1000);
  assert.equal(summary.views['read summary'].p95_ms, 2);
  // A new process at the cap cannot introduce another shard or alter counts.
  return (async () => {
    const open = path.join(p,'open'); fs.writeFileSync(open,'continue');
    const {done} = peer(t,p,'normal',path.join(p,'cap'),open);
    assert.equal((await done).code, 0);
    assert.equal(fs.readdirSync(dir).length, 10000);
    assert.equal(readSummary(p).calls, 10000);
  })();
});
