// Synthetic filesystem/Git/child-process probe, intended to be launched by the IIS worker.
import fs from 'node:fs';
import {
  actor
} from '../lib/util.mjs';
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
if (process.argv[3] === '--refresh') {
  call(['refresh']);
  process.stdout.write(JSON.stringify({refreshed:true})+'\n');
  process.exit(0);
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
  fs.writeFileSync(path.join(instance, u.journal_path), '# IIS synthetic cycle\nStarted: ' + u.claimed_at + '\nguidance_version: ' + u.guidance.guidance_identity +
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
  const before = call(['read', 'summary']).view.head;
  const task = call(['task', 'create'], {idempotency_key:'iis-cognition',text:'What can the synthetic IIS source retain?'}).task;
  const work = call(['cognitive-worker','next'], {work_kind:'cognitive',request_id:'iis-assignment',task_id:task.task_id,executor});
  const identity = {work_id:work.work_id,attempt:work.attempt};
  const cognition = (operation, options) => call(['cognitive-worker','read'], {...identity,request_id:'iis-'+operation,operation,options});
  cognition('round');
  const context = cognition('context', {current:false});
  const claim = context.claims[0];
  const source = cognition('source', {id:claim.sources[0].observation_id,length:16000});
  const delivery = cognition('receipt');
  const result = {protocol_version:1,task_id:task.task_id,binding:work.task.binding,outcome:'answer',
    answer:'The synthetic source declares that the IIS process can retain this declaration.',
    findings:[{id:'iis-finding',classification:'source_assertion',text:'The IIS process can retain the synthetic declaration.',claim_ids:[claim.id],premise_ids:[],
      evidence:[{source_id:source.id,sha256:source.sha256,start:source.start,quote:source.text}],uncertainty:[]}],
    questions:[],uncertainty:[],stop_reason:'complete',coverage:delivery.coverage,usage:delivery.usage,
    model:{requested:null,observed:null,configuration:'Deterministic IIS service probe; no language model.',cost:null}};
  // Source delivery uses the portable source id; keep exact retained text/hash.
  result.findings[0].evidence[0].source_id = claim.sources[0].observation_id;
  const slot = work.output_slots.find(s=>s.path==='result.json');
  call(['cognitive-worker','stage'], {...identity,slot_id:slot.slot_id,revision:1,offset:0,text:JSON.stringify(result),final:true});
  const outputs=[{slot_id:slot.slot_id,revision:1}];
  const validated=call(['cognitive-worker','validate'], {...identity,outputs});
  const receipt=call(['cognitive-worker','submit'], {...identity,outputs,candidate_digest:validated.candidate_digest,submission_id:'iis-result'});
  const completed=call(['task','get'], {task_id:task.task_id}).task;
  if (receipt.status!=='committed'||completed.state!=='completed'||completed.result.findings.length!==1||call(['read','summary']).view.head!==before)
    throw Error('IIS cognitive result/receipt or read-only memory invariant failed');
  call(['ask'], {
    text: 'Synthetic IIS record'
  });
  process.stdout.write(JSON.stringify({
    passed: true,
    actor: actor(),
    node: process.version,
    platform: process.platform,
    os_release: os.release(),
    operations: ['init', 'verify', 'submit', 'index', 'worker next', 'worker validate', 'worker submit',
      'read summary', 'ask', 'task create', 'cognitive-worker next/read/stage/validate/submit', 'task get'
    ],
    cognitive_task: {task_id:task.task_id,work_id:work.work_id,state:completed.state,receipt:completed.receipt,read_only_preserved:true},
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
