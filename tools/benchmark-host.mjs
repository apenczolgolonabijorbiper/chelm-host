import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  fileURLToPath
} from 'node:url';
import {
  spawnSync
} from 'node:child_process';
import {
  performance
} from 'node:perf_hooks';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = k => process.argv[process.argv.indexOf('--' + k) + 1];
const harness = path.resolve(option('harness')),
  output = option('output');
const samples = Number(process.argv.includes('--samples') ? option('samples') : 3);
if (!Number.isInteger(samples) || samples < 1 || samples > 20) throw Error('samples must be 1..20');
const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chelm-latency-'));
const python = process.env.GOLEM_PYTHON ?? (process.platform === 'win32' ? 'py' : 'python3');

function call(command, runtime, input, extras = []) {
  const trace = path.join(base, 'children.jsonl');
  fs.writeFileSync(trace, '');
  const args = [path.join(root, 'bin/chelm.mjs'), ...command, '--runtime', runtime, ...extras, ...(input ? [
    '--input', '-'
  ] : [])];
  const at = performance.now();
  const r = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    input: input ? JSON.stringify(input) : undefined,
    timeout: 180000,
    env: {
      ...process.env,
      CHELM_TIMINGS_FILE: trace
    }
  });
  const elapsed = performance.now() - at,
    value = JSON.parse(r.stdout ?? 'null');
  if (r.status !== 0 || !value?.ok) throw Error('Benchmark command failed: ' + command.join(' ') + ' ' + JSON
    .stringify(value));
  const children = fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map(s => JSON.parse(s));
  const excluded = children.filter(r => ['indexer', 'validator'].includes(r.kind)).reduce((sum, r) => sum + r
    .elapsed_ms, 0);
  return {
    elapsed_ms: elapsed,
    excluded_ms: excluded,
    nfr_ms: Math.max(0, elapsed - excluded),
    retrieval_ms: children.filter(r => r.kind === 'retrieval').reduce((sum, r) => sum + r.elapsed_ms, 0)
  };
}
const measured = {
  submit: [],
  ask: [],
  status: []
};
try {
  for (let n = 0; n < samples; n++) {
    const runtime = path.join(base, 'run-' + n);
    call(['init'], runtime, null, ['--harness', harness, '--python', python]);
    measured.submit.push(call(['submit'], runtime, {
      subject_id: 'synthetic',
      groups: Array.from({
        length: 10
      }, (_, i) => ({
        kind: 'record',
        lines: ['Synthetic group ' + i + ' for latency measurement.']
      }))
    }));
    measured.ask.push(call(['ask'], runtime, {
      text: 'What is known about the synthetic records?'
    }));
    measured.status.push(call(['status'], runtime));
  }
  const targets = {
    submit: 2000,
    ask: 3000,
    status: 1000
  };
  const commands = Object.fromEntries(Object.entries(measured).map(([name, rows]) => {
    const sorted = rows.map(r => r.nfr_ms).sort((a, b) => a - b);
    return [name, {
      target_ms: targets[name],
      median_ms: sorted[Math.floor(sorted.length / 2)],
      max_ms: sorted.at(-1),
      target_met: sorted.at(-1) < targets[name],
      samples: rows
    }];
  }));
  const startup = Array.from({ length: samples }, () => {
    const at = performance.now();
    const r = spawnSync(process.execPath, ['-e', ''], { encoding: 'utf8' });
    if (r.status !== 0) throw Error('Node startup probe failed');
    return performance.now() - at;
  });
  const report = {
    schema_version: 1,
    recorded_at: new Date().toISOString(),
    environment: {
      platform: process.platform,
      os_release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
      cpu_model: os.cpus()[0]?.model,
      total_memory_bytes: os.totalmem(),
      load_average: os.loadavg(),
      python: spawnSync(python, ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'unavailable',
      git: spawnSync('git', ['--version'], { encoding: 'utf8' }).stdout?.trim() || 'unavailable',
      node: process.version
    },
    harness_version: JSON.parse(fs.readFileSync(path.join(harness,'RELEASE.json'))).version,
    fixture: 'Fresh canonical empty memory; submit 10 synthetic groups, ask once, then status per sample.',
    method: 'Wall time includes CLI startup. NFR-4 excludes measured indexer/validator children; ask retains retrieval time. This is not a capacity benchmark or reference-consumer measurement.',
    node_process_start_ms: startup,
    commands
  };
  if (output) {
    fs.mkdirSync(path.dirname(path.resolve(output)), {
      recursive: true
    });
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  }
  process.stdout.write(JSON.stringify(report) + '\n');
} finally {
  fs.rmSync(base, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}
