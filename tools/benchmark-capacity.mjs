// Synthetic host capacity measurements. Never point this at a production runtime.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { initialize, config } from '../lib/runtime.mjs';
import { publish, view } from '../lib/read-model.mjs';
import { write, file, git, tail, snapshot, RAW_TREE_BYTES } from '../lib/util.mjs';
const option = (key, fallback) => {
  const i = process.argv.indexOf('--' + key); return i < 0 ? fallback : process.argv[i + 1];
};
if (!option('harness')) throw Error('--harness is required');
const harness = path.resolve(option('harness')), output = option('output');
const samples = Number(option('samples', '3'));
if (!Number.isInteger(samples) || samples < 1 || samples > 20) throw Error('samples must be 1..20');
const { syntheticState } = await import(pathToFileURL(path.join(harness, 'tools/benchmark-capacity.mjs')));
const { graphLimits } = await import(pathToFileURL(path.join(harness, 'server/memory-model.mjs')));
const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chelm-capacity-'));
const previousTrace = process.env.CHELM_TIMINGS_FILE;
const timed = fn => { const at = performance.now(); const value = fn(); return { elapsed_ms: performance.now() - at, value }; };
const commandVersion = (exe, args) => {
  const r = spawnSync(exe, args, { encoding: 'utf8', timeout: 30000 });
  return r.status === 0 ? (r.stdout || r.stderr).trim() : 'unavailable';
};
let benchmarkError;
try {
  const root = path.join(base, 'runtime');
  await initialize(root, { harness, python: process.env.GOLEM_PYTHON ?? (process.platform === 'win32' ? 'py' : 'python3') });
  const cfg = config(root), inst = cfg.instance.path;
  // Disposable capacity repositories must not spawn detached maintenance that
  // can retain Windows directory handles while the benchmark removes them.
  git(inst, ['config', 'gc.auto', '0']);
  git(inst, ['config', 'maintenance.auto', 'false']);
  const state = syntheticState(graphLimits.sources, { entities: graphLimits.entities, claims: graphLimits.claims });
  for (const [p, bytes] of state.notes) writeRaw(p, bytes);
  write(file(inst, 'memory/graph.json'), state.graph);
  write(file(inst, 'memory/processed.json'), state.ledger);
  writeRaw('memory/runs/baseline.md', '# Synthetic capacity baseline\nStarted: 2026-01-01T00:00:00.000Z\nNo language model used.\n');
  const registry = Object.fromEntries(Array.from({ length: 10000 }, (_, i) => ['subject-' + i, [{
    kind: 'synthetic', ids: [state.graph.sources[i % state.graph.sources.length].id]
  }]]));
  write(file(root, 'host/intake/registry.json'), registry);
  const conversation = file(root, 'host/conversation/turns.jsonl');
  fs.writeFileSync(conversation, Array.from({ length: 100000 }, (_, n) => JSON.stringify({
    n, role: n % 2 ? 'golem' : 'user', text: 'Synthetic żółć 😀 turn ' + n,
    at: '2026-01-01T00:00:00.000Z'
  })).join('\n') + '\n');
  // Bound bulk setup just like the harness capacity fixture: one giant add
  // can exceed the per-child timeout on Windows disks.
  const added = [...state.notes.keys(), 'memory/graph.json', 'memory/processed.json', 'memory/runs/baseline.md'];
  for (let i = 0; i < added.length; i += 256)
    git(inst, ['add', '--pathspec-from-file=-', '--pathspec-file-nul'], { input: added.slice(i, i + 256).join('\0') + '\0' });
  git(inst, ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@local', 'commit', '-qm', 'Synthetic capacity fixture']);
  const trace = path.join(base, 'children.jsonl'); process.env.CHELM_TIMINGS_FILE = trace;
  const rows = [];
  for (let i = 0; i < samples; i++) {
    fs.writeFileSync(trace, '');
    const shallow = timed(() => publish(root, cfg));
    assert.equal(Object.keys(view(root, 'subjects').data).length, 10000);
    const deep = timed(() => publish(root, cfg, { deep: true }));
    const children = fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
    const turns = timed(() => tail(conversation, 200));
    assert.equal(turns.value.length, 200); assert.equal(turns.value.at(-1).n, 99999);
    const validator = children.filter(r => r.kind === 'validator').reduce((s, r) => s + r.elapsed_ms, 0);
    const statistics = children.filter(r => r.kind === 'statistics').reduce((s, r) => s + r.elapsed_ms, 0);
    rows.push({ regeneration_ms: shallow.elapsed_ms, deep_refresh_ms: deep.elapsed_ms,
      validator_ms: validator, statistics_ms: statistics, tail_100000_ms: turns.elapsed_ms,
      rm6_target_ms: 3000, rm6_target_met: shallow.elapsed_ms < 3000 });
  }
  const tree = snapshot(inst), treeBytes = [...tree.values()].reduce((n, b) => n + b.length, 0);
  // Exact logical bound and one byte above it, including duplicate object accounting.
  writeRaw('capacity-padding', Buffer.alloc(RAW_TREE_BYTES - treeBytes, 120));
  git(inst, ['add', 'capacity-padding']); git(inst, ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@local', 'commit', '-qm', 'Exact tree bound']);
  assert.equal([...snapshot(inst).values()].reduce((n, b) => n + b.length, 0), RAW_TREE_BYTES);
  fs.appendFileSync(file(inst, 'capacity-padding'), 'x'); git(inst, ['add', 'capacity-padding']);
  git(inst, ['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@local', 'commit', '-qm', 'Above tree bound']);
  assert.throws(() => snapshot(inst), { code: 'capacity_exceeded' });
  const report = { schema_version: 1, recorded_at: new Date().toISOString(), harness_version: '0.10.0',
    environment: { platform: process.platform, release: os.release(), arch: os.arch(), cpu_model: os.cpus()[0]?.model,
      cpus: os.cpus().length, total_memory_bytes: os.totalmem(), load_average: os.loadavg(), node: process.version,
      python: commandVersion(cfg.harness.python, ['--version']), git: commandVersion(cfg.harness.git, ['--version']) },
    fixture: { sources: graphLimits.sources, entities: graphLimits.entities, claims: graphLimits.claims,
      subjects: 10000, conversation_turns: 100000, committed_tree_bytes: treeBytes, exact_64_mib_accepted: true, over_64_mib_refused: true },
    method: 'Synthetic generated host runtime; no inference. Regeneration excludes validator/statistics; deep refresh includes both, reported separately. Samples run sequentially after fixture setup. Results characterize this machine, not the reference workstation.',
    samples: rows };
  if (output) { fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); }
  process.stdout.write(JSON.stringify(report) + '\n');
  function writeRaw(p, bytes) { const target = file(inst, p); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, bytes); }
} catch (error) {
  benchmarkError = error;
  throw error;
} finally {
  if (previousTrace === undefined) delete process.env.CHELM_TIMINGS_FILE; else process.env.CHELM_TIMINGS_FILE = previousTrace;
  try {
    await fs.promises.rm(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (cleanupError) {
    if (!benchmarkError) throw cleanupError;
    // Never replace the actual benchmark failure with a secondary cleanup error.
    process.stderr.write('Capacity fixture cleanup failed: ' + cleanupError.code + '\n');
  }
}
