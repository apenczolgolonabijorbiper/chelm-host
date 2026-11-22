import fs from 'node:fs';
import {
  profileBundle
} from './profile-install.mjs';
import {
  createAdapter
} from './backend.mjs';
import path from 'node:path';
import {
  randomUUID
} from 'node:crypto';
import {
  file,
  read,
  write,
  atomic,
  assert,
  fail,
  safeAbs,
  git,
  child,
  now,
  hash,
  parseNote,
  json,
  setGitExecutable
} from './util.mjs';
import {
  validateShape
} from './schema.mjs';
import {
  packageRoot,
  verifyHarness,
  harness
} from './harness.mjs';
export const defaults = () => ({
  schema_version: 2,
  runtime_id: randomUUID(),
  label: 'real',
  sandbox: {
    resettable: false
  },
  harness: {
    root: '',
    node: process.execPath,
    python: process.platform === 'win32' ? 'py' : 'python3',
    git: 'git'
  },
  instance: {
    path: 'instance',
    git_identity: {
      name: 'chelm-host',
      email: 'chelm-host@local'
    }
  },
  intake: {
    subject_header: 'subject_id',
    max_observation_chars: 3500,
    max_message_chars: 4000,
    question_source: 'chelm-conversation',
    oversize: 'truncate',
    kind_sets: {}
  },
  conversation: {
    tail: 200
  },
  requests: {
    kinds: [],
    max_open_proposed_per_subject: 20,
    reason_max_chars: 300
  },
  remote: {max_active_work: 1, assignment_minutes: 30, max_lifetime_minutes: 480},
  observability: {operation_phases:false,read_metrics:false},
  profile_expectation: null,
  archive: {
    root: 'archive'
  }
});

function checkKeys(obj, template, label) {
  assert(obj && typeof obj === 'object' && !Array.isArray(obj), 'config_invalid', 'Invalid ' + label);
  for (const k of Object.keys(obj)) assert(Object.hasOwn(template, k), 'config_invalid',
    'Unknown config key: ' + label + '.' + k);
}
export function config(root) {
  root = safeAbs(root);
  const raw = read(file(root, 'chelm.runtime.json'));
  const issues = validateShape(raw, read(file(packageRoot, 'schemas/runtime-config.schema.json')));
  assert(issues.length === 0, 'config_invalid', issues[0] ?? 'Invalid runtime config');
  checkKeys(raw, defaults(), 'runtime');
  assert(raw.schema_version === 2, 'config_invalid', 'Unsupported runtime config version');
  const template = defaults();
  for (const k of ['sandbox', 'harness', 'instance', 'intake', 'conversation', 'requests', 'remote',
      'archive'
    ]) checkKeys(raw[k], template[k], k);
  if(raw.observability!==undefined)checkKeys(raw.observability,template.observability,'observability');
  checkKeys(raw.instance.git_identity, template.instance.git_identity, 'git_identity');
  assert(/^[a-z_]+$/.test(raw.intake.subject_header) && !['id', 'recorded_at', 'kind', 'chunk', 'question_id',
    'question_text', 'question_source'
  ].includes(raw.intake.subject_header), 'config_invalid', 'Invalid subject header');
  for (const n of [raw.intake.max_observation_chars, raw.intake.max_message_chars, raw.conversation.tail, raw
      .requests.max_open_proposed_per_subject, raw.requests.reason_max_chars
    ]) assert(Number.isInteger(n) && n > 0, 'config_invalid', 'Invalid config bound');
  assert(raw.intake.max_observation_chars >= 8 && ['truncate', 'refuse'].includes(raw.intake.oversize),
    'config_invalid', 'Invalid intake bounds');
  assert(Array.isArray(raw.requests.kinds), 'config_invalid',
    'Expected kinds array');
  const cfg = structuredClone(raw);
  setGitExecutable(cfg.harness.git);
  for (const [obj, k] of [
      [cfg.harness, 'root'],
      [cfg.instance, 'path'],
      [cfg.archive, 'root']
    ]) obj[k] = safeAbs(path.resolve(root, obj[k]));
  if (cfg.profile_expectation) {
    assert(typeof cfg.profile_expectation.source === 'string' && typeof cfg.profile_expectation.enforce ===
      'boolean', 'config_invalid', 'Invalid profile expectation');
    cfg.profile_expectation.source = safeAbs(path.resolve(root, cfg.profile_expectation.source));
  }
  for (const [k,min,max] of [['max_active_work',1,16],['assignment_minutes',1,480],['max_lifetime_minutes',1,1440]]) assert(Number.isInteger(cfg.remote[k])&&cfg.remote[k]>=min&&cfg.remote[k]<=max,'config_invalid','Invalid remote bound: '+k);
  outside(cfg.instance.path, cfg.harness.root);
  outside(cfg.instance.path, packageRoot);
  assert(!cfg.instance.path.startsWith(cfg.archive.root + path.sep), 'config_invalid',
    'Instance cannot be inside archive');
  return cfg;
}
export function outside(childRoot, parent) {
  const rel = path.relative(parent, childRoot);
  assert(rel && (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)), 'unsafe_path',
    'Runtime and instance must be outside vendor packages');
}
export function hostInit(root) {
  for (const p of ['host/intake', 'host/conversation', 'host/requests', 'host/remote/work', 'host/read-model',
      'host/locks', 'host/logs'
    ]) fs.mkdirSync(file(root, p), {
    recursive: true
  });
  for (const [p, v] of [
      ['host/intake/registry.json', {}],
      ['host/requests/requests.json', []],
      ['host/workers.json', {}]
    ])
    if (!fs.existsSync(file(root, p))) write(file(root, p), v);
  if (!fs.existsSync(file(root, 'host/conversation/turns.jsonl'))) atomic(file(root,
    'host/conversation/turns.jsonl'), '');
}
export function commitAll(cfg, subject, paths) {
  git(cfg.instance.path, ['add', '--', ...(paths ?? ['.'])]);
  return git(cfg.instance.path, ['-c', 'user.name=' + cfg.instance.git_identity.name, '-c', 'user.email=' +
    cfg.instance.git_identity.email, 'commit', '-q', '--allow-empty', '-m', subject
  ]);
}

function profileFiles(instance, profile) {
  assert(profile && typeof profile.core === 'string', 'input_invalid', 'Profile core must be text');
  atomic(file(instance, 'profiles/default.md'), profile.core);
  const selected = {
    path: 'profiles/default.md'
  };
  if (profile.sections) {
    assert(Array.isArray(profile.sections), 'input_invalid', 'Invalid sections');
    selected.sections = profile.sections.map(s => {
      assert(/^[a-z][a-z0-9_-]{1,40}$/.test(s.id) && typeof s.text === 'string' && Array.isArray(s.kinds),
        'input_invalid', 'Invalid profile section');
      const p = 'profiles/' + s.id + '.md';
      atomic(file(instance, p), s.text);
      return {
        id: s.id,
        path: p,
        kinds: s.kinds
      };
    });
  }
  if (profile.vocabulary) {
    write(file(instance, 'profiles/vocabulary.json'), profile.vocabulary);
    selected.vocabulary = 'profiles/vocabulary.json';
  }
  write(file(instance, 'golem.config.json'), {
    schema_version: 1,
    profile: selected
  });
}
export async function initialize(root, o = {}) {
  root = safeAbs(root);
  outside(root, packageRoot);
  const engine = safeAbs(path.resolve(o.harness ?? ''));
  outside(root, engine);
  assert(!fs.existsSync(root) || fs.readdirSync(root).length === 0, 'runtime_exists',
    'Runtime directory must be empty');
  assert(!o.sandbox || root.split(path.sep).includes('sandbox'), 'unsafe_path',
    'Sandbox runtime path must contain a sandbox segment');
  const cfg = defaults();
  cfg.harness.root = engine;
  if (o.git) cfg.harness.git = o.git;
  if (o.python) cfg.harness.python = o.python;
  cfg.label = o.label ?? 'real';
  cfg.sandbox.resettable = !!o.sandbox;
  cfg.instance.path = o['instance-path'] ?? 'instance';
  verifyHarness(cfg);
  const inst = safeAbs(path.resolve(root, cfg.instance.path));
  outside(inst, engine);
  outside(inst, packageRoot);
  assert(!fs.existsSync(inst) || fs.readdirSync(inst).length === 0, 'runtime_exists',
    'Instance directory must be empty');
  fs.mkdirSync(root, {
    recursive: true
  });
  write(file(root, 'chelm.runtime.json'), cfg);
  child(cfg.harness.python, [file(engine, 'processor/init-instance.py'), '--root', inst, ...(o.profile ? [
    '--profile'
  ] : [])], {
    timeout: 300000
  });
  if (o.purpose) atomic(file(inst, 'instance/purpose.md'), fs.readFileSync(safeAbs(o.purpose)));
  if (o.profile && fs.existsSync(file(safeAbs(o.profile), 'golem.config.json'))) {
    const bundle = await profileBundle(o.profile);
    assert(!o.purpose || !bundle.files.has('instance/purpose.md'),'profile_invalid','Ambiguous purpose: bundle purpose.md and --purpose');
    for (const [p, b] of bundle.files) atomic(file(inst, p), b);
  } else if (o.profile) {
    const src = safeAbs(o.profile),
      core = fs.readFileSync(file(src, 'default.md'), 'utf8');
    const selection = read(file(inst, 'golem.config.json'));
    atomic(file(inst, 'profiles/default.md'), core);
    if (fs.existsSync(file(src, 'vocabulary.json'))) {
      atomic(file(inst, 'profiles/vocabulary.json'), fs.readFileSync(file(src, 'vocabulary.json')));
      selection.profile.vocabulary = 'profiles/vocabulary.json';
    }
    const descriptor = read(file(src, 'profile.json'), {
      sections: []
    });
    assert(Array.isArray(descriptor.sections), 'input_invalid', 'profile.json sections must be an array');
    selection.profile.sections = descriptor.sections.map(section => {
      assert(/^[a-z][a-z0-9_-]{1,40}$/.test(section.id) && Array.isArray(section.kinds),
        'input_invalid',
        'Invalid profile section');
      const target = 'profiles/' + section.id + '.md';
      atomic(file(inst, target), fs.readFileSync(file(src, section.path)));
      return {
        id: section.id,
        path: target,
        kinds: section.kinds
      };
    });
    write(file(inst, 'golem.config.json'), selection);
  }
  const live = config(root);
  const validation = harness(live, 'validate', inst);
  assert(validation.valid, 'instance_incompatible', 'Initializer produced an invalid instance');
  git(inst, ['init', '-q']);
  git(inst, ['config', 'core.autocrlf', 'false']);
  commitAll(live, 'init: fresh instance');
  hostInit(root);
  return {
    runtime_id: cfg.runtime_id,
    head: git(inst, ['rev-parse', 'HEAD']).trim(),
    layout: validation.layout
  };
}
export function compatible(cfg) {
  const instance = cfg.instance.path;
  assert(fs.existsSync(instance), 'instance_missing', 'Instance does not exist');
  const graph = read(file(instance, 'memory/graph.json'));
  assert(graph.schema_version === 2 && fs.existsSync(file(instance, 'instance/purpose.md')) && !fs.existsSync(
      file(instance, 'persona')), 'instance_incompatible',
    'A canonical graph schema 2 instance is required');
  assert(read(file(instance, 'memory/hypotheses.json')).schema_version === 1, 'instance_incompatible',
    'Hypotheses schema 1 is required');
}

function intakeStoreInputs(o, input) {
  let base = process.cwd(),
    entries = input.intake_stores;
  if (entries === undefined && o['intake-stores']) {
    const supplied = safeAbs(o['intake-stores']);
    if (fs.statSync(supplied).isDirectory()) entries = fs.readdirSync(supplied).filter(n => n.endsWith(
      '.json')).sort().map(n => ({
      path: path.join(supplied, n)
    }));
    else {
      const d = read(supplied);
      if (Array.isArray(d) || Array.isArray(d.stores)) {
        entries = Array.isArray(d) ? d : d.stores;
        base = path.dirname(supplied);
      } else entries = [{
        path: supplied
      }];
    }
  }
  assert(entries === undefined || Array.isArray(entries), 'input_invalid',
    'intake_stores must be a list of {path,subject_id}');
  return (entries ?? []).map(entry => {
    assert(entry && typeof entry.path === 'string', 'input_invalid', 'Store path is required');
    const store = safeAbs(path.resolve(base, entry.path)),
      data = read(store);
    assert(Array.isArray(data.entries ?? data.groups), 'input_invalid',
      'Store must contain entries or groups');
    const named = path.basename(store, '.json');
    const subject = entry.subject_id ?? data.subject_id;
    if (subject === undefined) assert(!
      /^(?:golem[-_.]?)?(?:observations?|observation[-_]?store|store|registry|intake|entries|data|index|state|notes|requests|memory|events|jobs|records)(?:[-_.](?:store|state|data))?$/i
      .test(named), 'subject_required', 'A generic store filename requires an explicit subject_id');
    assert(subject === undefined || typeof subject === 'string' && subject.trim(), 'input_invalid',
      'Store subject_id must be a nonempty string');
    assert(entry.subject_id === undefined || data.subject_id === undefined || entry.subject_id === data
      .subject_id, 'subject_conflict', 'Store and mapping subjects disagree');
    return {
      path: store,
      data,
      subject: subject ?? named
    };
  });
}
export async function adopt(root, o, input = {}) {
  const stores = intakeStoreInputs(o, input);
  const requestData = o.requests ? read(safeAbs(o.requests)) : null;
  const importedRequests = requestData === null ? [] : Array.isArray(requestData) ? requestData :
    requestData.requests ?? requestData.jobs;
  assert(Array.isArray(importedRequests), 'input_invalid',
    'Requests must be an array, {requests:[...]} or {jobs:[...]}');
  root = safeAbs(root);
  assert(!fs.existsSync(root) || !fs.readdirSync(root).length, 'runtime_exists', 'Runtime must be empty');
  outside(root, packageRoot);
  const cfg = defaults();
  outside(root, safeAbs(o.harness));
  cfg.harness.root = safeAbs(o.harness);
  cfg.instance.path = safeAbs(o.instance);
  if (o.python) cfg.harness.python = o.python;
  if (o['subject-header']) cfg.intake.subject_header = o['subject-header'];
  verifyHarness(cfg);
  setGitExecutable(cfg.harness.git);
  compatible(cfg);
  const v = harness(cfg, 'validate', cfg.instance.path);
  assert(v.valid, 'instance_incompatible', 'Existing instance is incompatible');
  const existingStatus = await createAdapter({
    instance: cfg.instance.path,
    harness: cfg.harness.root,
    node: cfg.harness.node,
    git: cfg.harness.git
  }).status();
  assert(!existingStatus.recovery_required, 'recovery_required',
    'Resolve adapter recovery and edited protocol files before adoption');
  const lease = JSON.parse(git(cfg.instance.path, ['show', 'HEAD:memory/processing-lock.json']));
  assert(!(lease.status === 'processing' && Date.parse(lease.expires_at) > Date.now()), 'lease_held',
    'Cannot adopt a held lease');
  const pending = path.join(cfg.instance.path, '.git/golem-adapter-pending.json');
  assert(!fs.existsSync(pending), 'recovery_required', 'Resolve adapter recovery before adoption');
  fs.mkdirSync(root, {
    recursive: true
  });
  write(file(root, 'chelm.runtime.json'), cfg);
  hostInit(root);
  let orphaned_groups = 0;
  if (o.conversation) {
    const lines = fs.readFileSync(safeAbs(o.conversation), 'utf8').split('\n').filter(Boolean).map(s => {
      const t = JSON.parse(s);
      t.observation_id = t.observation_id ?? t.observationId;
      t.question_id = t.question_id ?? t.questionId;
      delete t.observationId;
      delete t.questionId;
      return t;
    });
    atomic(file(root, 'host/conversation/turns.jsonl'), lines.map(x => JSON.stringify(x)).join('\n') +
      '\n');
  }
  if (stores.length) {
    const registry = Object.create(null);
    for (const {
        data,
        subject
      }
      of stores) {
      registry[subject] ??= [];
      registry[subject].push(...(data.entries ?? data.groups ?? []).map(g => {
        const notes = (g.ids ?? []).map(id => {
          try {
            return parseNote(`inbox/${id}.md`, fs.readFileSync(file(cfg.instance.path,
              `inbox/${id}.md`), 'utf8')).body.trim();
          } catch {
            return null;
          }
        });
        const orphaned = notes.some(x => x === null);
        if (orphaned) orphaned_groups++;
        const content_key = orphaned ? null : g.content_key ?? g.contentHash ?? hash(g.kind +
          '\u001f' +
          notes.join('\u001f\n'));
        return {
          ...g,
          content_key,
          key: content_key ? g.kind + ':' + content_key : null,
          orphaned,
          created_at: g.created_at ?? g.createdAt
        };
      }));
    }
    write(file(root, 'host/intake/registry.json'), registry);
  }
  if (o.requests) {
    const mapped = importedRequests.filter(r => r.requestedBy === 'golem')
      .map(r => ({
        id: r.id,
        kind: r.kind,
        subject_id: r.subject_id ?? r.featureId ?? '',
        reason: r.reason ?? '',
        status: ({
          proposed: 'proposed',
          queued: 'accepted',
          running: 'accepted',
          done: 'fulfilled',
          cancelled: 'cancelled',
          failed: 'accepted'
        })[r.status] ?? 'proposed',
        created_at: r.createdAt,
        updated_at: r.finishedAt ?? r.startedAt ?? r.createdAt,
        created_by: 'golem',
        note: r.error ?? ''
      }));
    write(file(root, 'host/requests/requests.json'), mapped);
  }
  return {
    runtime_id: cfg.runtime_id,
    orphaned_groups,
    layout: v.layout
  };
}
export function setProfile(root, cfg, input) {
  const instance = cfg.instance.path,
    paths = ['instance/purpose.md', 'golem.config.json', ...(fs.existsSync(file(instance, 'profiles')) ? fs
      .readdirSync(file(instance, 'profiles'), {
        recursive: true
      }) : []).filter(p => fs.statSync(file(instance, 'profiles/' + p)).isFile()).map(p => 'profiles/' + p)];
  const backup = new Map(paths.map(p => [p, fs.existsSync(file(instance, p)) ? fs.readFileSync(file(instance,
    p)) : null]));
  try {
    if (input.purpose !== undefined) {
      assert(typeof input.purpose === 'string', 'input_invalid', 'Purpose must be text');
      atomic(file(instance, 'instance/purpose.md'), input.purpose);
    }
    if (input.profile !== undefined) {
      if (input.profile === null) write(file(instance, 'golem.config.json'), {
        schema_version: 1
      });
      else profileFiles(instance, input.profile);
    }
    const result = harness(cfg, 'validate', instance);
    commitAll(cfg, 'profile: update application guidance', ['instance', 'profiles', 'golem.config.json']
      .filter(p => fs.existsSync(file(instance, p))));
    return result;
  } catch (e) {
    for (const p of (fs.existsSync(file(instance, 'profiles')) ? fs.readdirSync(file(instance, 'profiles'), {
        recursive: true
      }) : []).filter(p => fs.statSync(file(instance, 'profiles/' + p)).isFile()).map(p => 'profiles/' + p))
      if (!backup.has(p)) fs.rmSync(file(instance, p));
    for (const [p, b] of backup)
      if (b === null) fs.rmSync(file(instance, p), {
        force: true
      });
      else atomic(file(instance, p), b);
    throw e;
  }
}
