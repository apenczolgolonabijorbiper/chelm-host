import {verifyHarness} from './harness.mjs';
import {publishProvider} from './provider-views.mjs';
import {publishTaskView} from './cognitive.mjs';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  read,
  write,
  file,
  git,
  snapshot,
  materialize,
  parseNote,
  now,
  tail,
  assert,
  fail,
  uuid
} from './util.mjs';
import {
  harness
} from './harness.mjs';
export const views = ['summary', 'observations', 'subjects', 'questions', 'answers', 'journals', 'warnings',
  'requests', 'delegations', 'tasks'
];
export const view = (root, name) => {
  assert(views.includes(name), 'view_unknown', 'Unknown read-model view');
  try {
    return read(file(root, `host/read-model/${name}.json`));
  } catch (e) {
    if (e.code === 'ENOENT') fail('not_initialized', 'Read model is not initialized');
    throw e;
  }
};
export const leaseState = lease => ({
  state: lease.status === 'processing' ? (Date.parse(lease.expires_at) > Date.now() ? 'held' :
    'expired') : 'idle',
  run_id: lease.run_id ?? lease.last_run_id ?? null,
  expires_at: lease.expires_at ?? null,
  reason: lease.reason ?? lease.error_reason ?? null
});
const decode = (tree, p, fallback) => {
  const b = tree.get(p);
  return b ? JSON.parse(b) : fallback;
};
export function publish(root, cfg, {
  deep = false
} = {}) {
  if(cfg.memory)return publishProvider(root,cfg);
  const inst = cfg.instance.path,
    head = git(inst, ['rev-parse', 'HEAD']).trim(),
    tree = snapshot(inst, head),
    generated_at = now(),
    meta = {
      schema_version: 1,
      generated_at,
      head,
      runtime_id: cfg.runtime_id
    };
  publishTaskView(root,cfg,head);
  const graph = decode(tree, 'memory/graph.json', {}),
    ledger = decode(tree, 'memory/processed.json', {
      observations: []
    }),
    queue = decode(tree, 'questions/queue.json', {
      questions: []
    }),
    hyp = decode(tree, 'memory/hypotheses.json', {
      hypotheses: []
    }),
    rawLease = decode(tree, 'memory/processing-lock.json', {}),
    lease = leaseState(rawLease),
    registry = read(file(root, 'host/intake/registry.json'), {}),
    packages = []; // Deprecated read view retained as an empty app-contract-v1 projection.
  let validation = read(file(root, 'host/read-model/warnings.json'), {
      data: [],
      warning_summary: {
        total: 0
      },
      layout: {
        purpose_path: 'instance/purpose.md',
        hypotheses_path: 'memory/hypotheses.json'
      }
    }),
    stats = read(file(root, 'host/stats.json'), {});
  if (deep) {
    const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chelm-view-'));
    try {
      materialize(tree, tmp);
      const v = harness(cfg, 'validate', tmp);
      stats = harness(cfg, 'stats', tmp);
      validation = {
        ...meta,
        data: v.warnings ?? [],
        warning_summary: v.warning_summary,
        layout: v.layout,
        validation: v
      };
      write(file(root, 'host/read-model/warnings.json'), validation);
      write(file(root, 'host/stats.json'), stats);
    } finally {
      fs.rmSync(tmp, {
        recursive: true,
        force: true
      });
    }
  }
  assert(graph.schema_version === 2, 'instance_incompatible', 'Committed graph schema 2 is required');
  const done = new Map(ledger.observations.map(r => [r.id, r])),
    reserved = new Set(packages.filter(p => !['cancelled', 'adopted'].includes(p.status) && Date.parse(p
      .expires_at) > Date.now()).flatMap(p => p.observation_ids)),
    observations = [],
    malformed = [];
  for (const n of fs.readdirSync(file(inst, 'inbox')).filter(n => n.endsWith('.md'))) {
    try {
      const text = fs.readFileSync(file(inst, 'inbox/' + n), 'utf8'),
        s = parseNote('inbox/' + n, text),
        processed = done.get(s.id);
      observations.push({
        id: s.id,
        kind: s.kind,
        subject_id: s[cfg.intake.subject_header] ?? null,
        chunk: s.chunk ?? '',
        recorded_at: s.recorded_at,
        first_line: s.body.split('\n').find(x => x.trim())?.slice(0, 160) ?? '',
        state: processed ? 'processed' : lease.state === 'held' && rawLease.observation_ids.includes(s
            .id) ? 'claimed' : reserved.has(s.id) ? 'reserved' : Date.now() - Date.parse(s.recorded_at) >=
          60000 ? 'ready' : 'waiting_for_age',
        evidence: fs.existsSync(file(inst, `evidence/${s.id}.json`)),
        run: processed?.run ?? null,
        processed_at: processed?.processed_at ?? null
      });
    } catch {
      malformed.push({
        path: 'inbox/' + n
      });
    }
  }
  observations.sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  const byId = new Map(observations.map(o => [o.id, o])),
    subjects = Object.create(null);
  for (const [subject, groups] of Object.entries(registry)) {
    const kinds = Object.create(null);
    for (const group of groups) {
      kinds[group.kind] ??= {
        observed: 0,
        indexed: 0,
        analyzed: 0
      };
      for (const observation of group.ids) {
        const o = byId.get(observation);
        kinds[group.kind].observed++;
        if (o?.evidence) kinds[group.kind].indexed++;
        if (done.has(observation)) kinds[group.kind].analyzed++;
      }
    }
    const sets = Object.create(null);
    for (const [name, members] of Object.entries(cfg.intake.kind_sets)) {
      sets[name] = {
        observed: 0,
        indexed: 0,
        analyzed: 0
      };
      for (const member of members)
        for (const k of Object.keys(sets[name])) sets[name][k] += kinds[member]?.[k] ?? 0;
    }
    subjects[subject] = {
      groups,
      kinds,
      sets
    };
  }
  const questions = queue.questions.map(q => ({
      ...q,
      at: q.created_at
    })),
    answers = Object.create(null);
  for (const [p, b] of tree)
    if (/^memory\/events\/chat\/[0-9a-f-]+\.json$/.test(p)) {
      const e = JSON.parse(b);
      answers[e.observation_id] = {
        text: e.answer,
        at: e.answered_at,
        question_id: e.question_id
      };
    }
  const journals = [];
  let commitTimes = new Map();
  const log = git(inst, ['log', '--format=@@%cI', '--name-only', '--', 'memory/runs']);
  let stamp;
  for (const line of log.split('\n')) {
    if (line.startsWith('@@')) stamp = line.slice(2);
    else if (line && !commitTimes.has(line)) commitTimes.set(line, stamp);
  }
  for (const [p, b] of tree)
    if (/^memory\/runs\/[0-9a-f-]+\.md$/.test(p)) {
      const rows = ledger.observations.filter(r => r.run === p),
        ids = new Set(rows.map(r => r.id)),
        text = b.toString(),
        started = text.match(/^Started:\s*(.+)$/m)?.[1] ?? '',
        ended = commitTimes.get(p) ?? '',
        sources = (graph.sources ?? []).filter(s => ids.has(s.id)),
        entities = (graph.entities ?? []).filter(e => (e.source_ids ?? []).some(id => ids.has(id))),
        claims = (graph.claims ?? []).filter(c => (c.sources ?? []).some(s => ids.has(s.observation_id))),
        q = questions.filter(q => ids.has(q.source_observation_id)),
        kinds = Object.create(null);
      for (const r of rows) {
        const e = decode(tree, `evidence/${r.id}.json`, {});
        if (e.kind) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
      }
      journals.push({
        id: path.basename(p, '.md'),
        path: p,
        observations: rows.length,
        committed: rows.map(r => r.processed_at).sort().at(-1) ?? '',
        started,
        ended,
        duration: started && ended ? Date.parse(ended) - Date.parse(started) : null,
        observation_kinds: kinds,
        entities: entities.length,
        claims: claims.length,
        relations: claims.filter(c => c.object?.entity_id).length,
        source_assertions: claims.filter(c => c.classification === 'source_assertion').length,
        questions_opened: q.length,
        unresolved: q.filter(x => x.status === 'open').length
      });
    } journals.sort((a, b) => b.ended.localeCompare(a.ended));
  const counts = {};
  for (const o of observations) counts[o.state] = (counts[o.state] ?? 0) + 1;
  const capacity = {};
  for (const [k, v] of Object.entries(stats.capacity ?? {})) capacity[k] = {
    ...v,
    near_limit: v.used >= Math.ceil(.8 * v.limit)
  };
  let conversationCount = 0;
  const conversationPath = file(root, 'host/conversation/turns.jsonl');
  if (fs.existsSync(conversationPath)) {
    const fd = fs.openSync(conversationPath, 'r'),
      buf = Buffer.alloc(65536);
    let count;
    try {
      while ((count = fs.readSync(fd, buf)) > 0)
        for (let i = 0; i < count; i++)
          if (buf[i] === 10) conversationCount++;
    } finally {
      fs.closeSync(fd);
    }
  }
  const cfgFile = decode(tree, 'golem.config.json', {});
  const summary = {
    ...meta,
    instance_path_abs: inst,
    layout: validation.layout,
    exists: true,
    harness_version: verifyHarness(cfg).manifest.version,
    backend: {
      kind: 'chelm-git',
      contract_version: 1,
      capabilities: ['candidate-validation-v1', 'purpose-guidance-v2', 'profile-install-v1', 'core-policies-v2',
        'claim-selectors-v1'
      ]
    },
    profile: {
      selected: !!cfgFile.profile,
      path: cfgFile.profile?.path ?? null,
      vocabulary: cfgFile.profile?.vocabulary ?? null
    },
    totals: {
      sources: graph.sources?.length ?? 0,
      entities: graph.entities?.length ?? 0,
      claims: graph.claims?.length ?? 0,
      relations: graph.claims?.filter(c => c.object?.entity_id).length ?? 0,
      active_claims: graph.claims?.filter(c => c.status === 'active').length ?? 0
    },
    capacity,
    warning_summary: validation.warning_summary,
    metrics_head: validation.head,
    metrics_generated_at: validation.generated_at,
    inbox: observations.length + malformed.length,
    evidence: fs.readdirSync(file(inst, 'evidence')).filter(n => n.endsWith('.json')).length,
    processed: ledger.observations.length,
    pending_analysis: observations.filter(o => !done.has(o.id)).length,
    ready: counts.ready ?? 0,
    waiting_for_age: counts.waiting_for_age ?? 0,
    malformed,
    lease,
    hypotheses: hyp.hypotheses.length,
    past_answers: Math.floor(conversationCount / 2),
    conversation_messages: conversationCount,
    open_questions: questions.filter(q => q.status === 'open').map(q => ({
      id: q.id,
      text: q.text
    })),
    last_run: journals[0] ?? null,
    graph_updated_at: graph.updated_at,
    busy: lease.state === 'held',
    delegation: Object.fromEntries(['offered', 'taken', 'returned'].map(k => [k, packages.filter(p => p
      .status === k).length]))
  };
  const data = {
    summary,
    observations,
    subjects,
    questions,
    answers,
    journals,
    requests: read(file(root, 'host/requests/requests.json'), []),
    delegations: packages
  };
  for (const [name, value] of Object.entries(data)) write(file(root, `host/read-model/${name}.json`), name ===
    'summary' ? value : {
      ...meta,
      data: value
    });
  return summary;
}
export function inspect(root, cfg, metric, subject) {
  const summary = view(root, 'summary');
  let rows = [],
    text = '',
    columns = [],
    source = 'read-model',
    note = '';
  const obs = view(root, 'observations').data.filter(o => !subject || o.subject_id === subject);
  if (['inbox', 'pending'].includes(metric)) {
    columns = ['observation_id', 'kind', 'recorded_at', 'subject_id', 'processed', 'first_line'];
    rows = obs.filter(o => metric === 'inbox' || o.state !== 'processed').map(o => [o.id, o.kind, o
      .recorded_at, o.subject_id, o.state === 'processed', o.first_line
    ]);
  } else if (metric === 'evidence') {
    columns = ['observation_id', 'analyzed', 'size_kb', 'written_utc', 'top_level_keys'];
    rows = obs.filter(o => o.evidence).map(o => {
      const p = file(cfg.instance.path, `evidence/${o.id}.json`),
        s = fs.statSync(p);
      return [o.id, o.state === 'processed', s.size / 1024, s.mtime.toISOString(), Object.keys(read(p))
        .slice(0, 8).join(', ')
      ];
    });
  } else if (['warnings', 'journals', 'open-questions', 'conversation'].includes(metric)) {
    rows = metric === 'conversation' ? tail(file(root, 'host/conversation/turns.jsonl'), cfg.conversation
      .tail).reverse() : view(root, metric === 'open-questions' ? 'questions' : metric).data;
    if (metric === 'open-questions') rows = rows.filter(q => q.status === 'open');
    if (metric === 'warnings') note = 'Warnings prompt review and decide nothing. ' + JSON.stringify(view(
      root, 'warnings').warning_summary);
  } else if (metric === 'lease') {
    columns = ['field', 'value'];
    rows = Object.entries(summary.lease);
  } else {
    const tree = snapshot(cfg.instance.path);
    source = 'committed HEAD';
    if (['entities', 'claims', 'relations'].includes(metric)) {
      const graph = decode(tree, 'memory/graph.json', {});
      rows = metric === 'entities' ? graph.entities : metric === 'claims' ? graph.claims : graph.claims
        .filter(c => c.object?.entity_id);
    } else if (metric === 'processed') rows = decode(tree, 'memory/processed.json', {
      observations: []
    }).observations;
    else if (metric === 'hypotheses') rows = decode(tree, summary.layout.hypotheses_path, {
      hypotheses: []
    }).hypotheses;
    else if (metric === 'last-cycle') text = summary.last_run ? tree.get(summary.last_run.path)?.toString() ??
      '' : '';
    else if (metric === 'validation') text = JSON.stringify(view(root, 'warnings').validation);
    else fail('metric_unknown', 'Unknown inspection metric');
  }
  if (!columns.length && rows.length) {
    columns = [...new Set(rows.flatMap(r => Object.keys(r)))];
    rows = rows.map(r => columns.map(k => r[k]));
  }
  const total = rows.length;
  let truncated = total > 500 || text.length > 20000;
  rows = rows.slice(0, 500).map(row => row.map(cell => {
    const s = typeof cell === 'string' ? cell : JSON.stringify(cell) ?? '';
    if (s.length > 400) truncated = true;
    return s.slice(0, 400);
  }));
  return {
    title: metric,
    source,
    fetched_at: now(),
    note,
    columns,
    rows,
    total,
    truncated,
    text: text.slice(0, 20000)
  };
}
