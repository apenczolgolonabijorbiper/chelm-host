// Synthetic filesystem/Git/child-process probe, intended to be launched by the IIS worker.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  spawnSync
} from 'node:child_process';
import {
  fileURLToPath
} from 'node:url';
const settings = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtime = settings.runtime;
const executor = {
  id: 'iis-service-probe',
  kind: 'scripted',
  model: 'none (synthetic service identity test)',
  host: os.hostname()
};

function call(command, input, extras = []) {
  const args = [path.join(pkg, 'bin/chelm.mjs'), ...command, '--runtime', runtime, ...extras, ...(input ? [
    '--input', '-'
  ] : [])];
  const r = spawnSync(process.execPath, args, {
    input: input ? JSON.stringify(input) : undefined,
    encoding: 'utf8',
    timeout: 180000
  });
  const value = JSON.parse(r.stdout ?? 'null');
  if (r.status !== 0 || !value?.ok) throw Error('Service probe ' + command.join(' ') + ' failed: ' + JSON
    .stringify(value));
  return value;
}
try {
  call(['init'], null, ['--harness', settings.harness, '--python', settings.python, '--git', settings.git]);
  call(['verify']);
  const sent = call(['submit'], {
    subject_id: 'synthetic-iis',
    groups: [{
      kind: 'record',
      chunks: ['Synthetic IIS process can retain this declaration.']
    }]
  });
  const observation = sent.groups[0].observation_ids[0],
    instance = path.join(runtime, 'instance');
  // Age only this private synthetic fixture before exercising the owned lease.
  const note = path.join(instance, 'inbox', observation + '.md');
  fs.writeFileSync(note, fs.readFileSync(note, 'utf8').replace(/^recorded_at: .*$/m, 'recorded_at: ' +
    new Date(Date.now() - 120000).toISOString()));
  fs.rmSync(path.join(instance, 'evidence', observation + '.json'));
  call(['index']);
  const u = call(['worker', 'next'], {
    executor,
    max: 1
  }).work_unit;
  if (!u) throw Error('Expected a claimed synthetic observation');
  const graph = JSON.parse(fs.readFileSync(path.join(instance, 'memory/graph.json'))),
    s = u.sources[0];
  graph.updated_at = new Date().toISOString();
  graph.sources.push({
    id: s.id,
    path: s.path,
    sha256: s.sha256,
    recorded_at: s.recorded_at
  });
  const entity = 'ent-' + s.id;
  graph.entities.push({
    id: entity,
    type: 'other',
    kind: 'record',
    label: 'Synthetic IIS record',
    aliases: [],
    source_ids: [s.id],
    created_at: graph.updated_at,
    uncertainty: []
  });
  graph.claims.push({
    id: 'clm-' + s.id,
    subject_id: entity,
    attributed_to_id: entity,
    predicate: 'describes',
    object: {
      value: 'Synthetic service check'
    },
    classification: 'source_assertion',
    sources: [{
      observation_id: s.id,
      quote: 'Synthetic IIS process can retain this declaration.'
    }],
    asserted_at: s.recorded_at,
    valid_time: {
      from: null,
      to: null,
      expression: null,
      precision: 'unknown'
    },
    status: 'active',
    supersedes: [],
    uncertainty: [],
    created_at: graph.updated_at
  });
  fs.writeFileSync(path.join(instance, 'memory/graph.json'), JSON.stringify(graph, null, 2) + '\n');
  fs.writeFileSync(path.join(instance, u.journal_path), '# IIS synthetic cycle\nStarted: ' + u.claimed_at +
    '\nNo language model was used. Source and warnings reviewed; verification by harness candidate validation.\n'
    );
  call(['worker', 'validate'], {
    executor,
    run_id: u.run_id,
    outputs: []
  });
  call(['worker', 'submit'], {
    executor,
    run_id: u.run_id,
    outputs: []
  });
  const summary = call(['read', 'summary']).view;
  if (summary.processed !== 1 || summary.totals.claims !== 1) throw Error(
    'Committed read view did not match the synthetic cycle');
  call(['ask'], {
    text: 'Synthetic IIS record'
  });
  process.stdout.write(JSON.stringify({
    passed: true,
    actor: os.userInfo().username,
    node: process.version,
    platform: process.platform,
    os_release: os.release(),
    operations: ['init', 'verify', 'submit', 'index', 'worker next', 'worker validate', 'worker submit',
      'read summary', 'ask'
    ],
    processed: summary.processed,
    claims: summary.totals.claims
  }) + '\n');
} catch (e) {
  process.stdout.write(JSON.stringify({
    passed: false,
    error: e.message
  }) + '\n');
  process.exitCode = 1;
}
