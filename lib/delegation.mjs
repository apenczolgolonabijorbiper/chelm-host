import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  randomUUID
} from 'node:crypto';
import {
  read,
  write,
  atomic,
  file,
  safeAbs,
  assert,
  fail,
  id,
  hash,
  git,
  now,
  actor,
  snapshot,
  materialize,
  json
} from './util.mjs';
import {
  config,
  defaults,
  hostInit,
  compatible
} from './runtime.mjs';
import {
  harness,
  verifyHarness,
  packageRoot
} from './harness.mjs';
import {
  backend,
  worker,
  executor
} from './worker.mjs';
import {
  view,
  publish
} from './read-model.mjs';
import {
  keyed,
  mergeGraph
} from './merge.mjs';
const rows = root => read(file(root, 'host/delegation/packages.json'));
const persist = (root, data) => write(file(root, 'host/delegation/packages.json'), data);

function packageDir(cfg, packageId, share) {
  id(packageId);
  const base = share ?? cfg.delegation.share_root;
  assert(base, 'delegation_disabled', 'No shared folder configured');
  return file(safeAbs(base), 'delegations/' + packageId);
}

function verifyFiles(dir, manifest) {
  assert(manifest?.schema_version === 1 && manifest.files && typeof manifest.files === 'object',
    'package_invalid', 'Invalid package manifest');
  for (const [p, digest] of Object.entries(manifest.files)) {
    assert(/^[a-f0-9]{64}$/.test(digest), 'package_invalid', 'Invalid file digest');
    const b = fs.readFileSync(file(dir, p));
    assert(hash(b) === digest, 'package_invalid', 'Package file hash mismatch: ' + p);
  }
}
const policy = p => p === 'golem.config.json' || p.startsWith('instance/') || p.startsWith('profiles/');

function unchangedPolicies(base, tip) {
  for (const p of new Set([...base.keys(), ...tip.keys()]))
    if (policy(p)) assert(hash(base.get(p) ?? '') === hash(tip.get(p) ?? ''), 'policy_changed',
      'Committed application policy changed');
}

function allowed(p, ids) {
  return ['memory/graph.json', 'memory/index.md', 'memory/hypotheses.json', 'memory/processed.json',
    'memory/processing-lock.json', 'questions/queue.json', 'questions/queue.md'
  ].includes(p) || /^memory\/(runs|events)\//.test(p) || ids.some(id => p === `inbox/${id}.md` || p ===
    `evidence/${id}.json`);
}
export async function delegate(root, cfg, command, input) {
  const data = rows(root);
  if (command === 'list') {
    return {
      packages: data.map(p => {
        if (!['adopted', 'cancelled'].includes(p.status) && Date.parse(p.expires_at) <= Date.now())
          return {
            ...p,
            status: 'expired'
          };
        const dir = packageDir(cfg, p.package_id);
        if (fs.existsSync(file(dir, 'result.json'))) return {
          ...p,
          status: 'returned',
          returned_at: read(file(dir, 'result.json')).returned_at
        };
        if (fs.existsSync(file(dir, 'taken.json'))) return {
          ...p,
          status: 'taken',
          ...read(file(dir, 'taken.json'))
        };
        return p;
      })
    };
  }
  assert(cfg.delegation.enabled, 'delegation_disabled', 'Delegation is disabled');
  if (command === 'offer') {
    assert(cfg.delegation.participants.length > 0, 'participants_missing',
      'Configure allowed OS user names before offering');
    assert(input.observation_ids?.length || input.subject_id, 'input_invalid',
      'An observation or subject selector is required');
    const status = await backend(cfg).status();
    assert(!status.lease.held, 'busy', 'Cannot offer during a held lease');
    const reserved = new Set(data.filter(p => !['adopted', 'cancelled'].includes(p.status) && Date.parse(p
      .expires_at) > Date.now()).flatMap(p => p.observation_ids));
    const observations = view(root, 'observations').data;
    const sources = status.ready.filter(s => !reserved.has(s.id) && (!input.observation_ids || input
      .observation_ids.includes(s.id)) && (!input.subject_id || observations.find(o => o.id === s.id)
      ?.subject_id === input.subject_id));
    assert(sources.length > 0 && sources.length <= 20, 'sources_unavailable',
      'Select between one and twenty ready, unreserved sources');
    if (input.observation_ids) assert(input.observation_ids.length === sources.length,
      'sources_unavailable', 'Some selected sources are unavailable');
    const package_id = randomUUID(),
      dir = packageDir(cfg, package_id);
    fs.mkdirSync(dir, {
      recursive: true
    });
    const files = {},
      bundle = file(dir, 'instance.bundle');
    const temp = bundle + '.tmp';
    git(cfg.instance.path, ['bundle', 'create', temp, 'HEAD']);
    fs.renameSync(temp, bundle);
    files['instance.bundle'] = hash(fs.readFileSync(bundle));
    for (const s of sources)
      for (const p of [s.path, `evidence/${s.id}.json`]) {
        const src = file(cfg.instance.path, p);
        if (fs.existsSync(src)) {
          const bytes = fs.readFileSync(src);
          atomic(file(dir, p), bytes);
          files[p] = hash(bytes);
        }
      }
    const hours = input.expires_hours ?? cfg.delegation.reservation_hours;
    assert(Number.isFinite(hours) && hours > 0 && hours <= 24 * 30, 'input_invalid',
    'Invalid expiry hours');
    const manifest = {
      schema_version: 1,
      package_id,
      runtime_id: cfg.runtime_id,
      base_head: status.head,
      observations: sources.map(s => ({
        id: s.id,
        sha256: s.sha256,
        kind: s.kind,
        recorded_at: s.recorded_at
      })),
      harness_version: '0.7.0',
      harness_release_sha256: hash(fs.readFileSync(file(cfg.harness.root, 'RELEASE.json'))),
      chelm_version: '0.1.0',
      offered_by: actor(),
      participants: cfg.delegation.participants,
      created_at: now(),
      expires_at: new Date(Date.now() + hours * 3600000).toISOString(),
      note: String(input.note ?? ''),
      files
    };
    write(file(dir, 'manifest.json'), manifest);
    const record = {
      package_id,
      status: 'offered',
      observation_ids: sources.map(s => s.id),
      created_at: manifest.created_at,
      expires_at: manifest.expires_at
    };
    data.push(record);
    persist(root, data);
    return {
      ...record,
      messages: [
        'The package contains the full committed memory of this runtime. Share access must be limited to configured participants.'
      ]
    };
  }
  const record = data.find(p => p.package_id === input.package);
  assert(record, 'package_unknown', 'Package is unknown');
  if (command === 'cancel') {
    assert(record.status !== 'adopted', 'already_adopted', 'Package was already adopted');
    record.status = 'cancelled';
    persist(root, data);
    write(file(packageDir(cfg, record.package_id), 'cancelled.json'), {
      cancelled_at: now(),
      cancelled_by: actor()
    });
    return {
      package_id: record.package_id,
      status: 'cancelled'
    };
  }
  assert(command === 'adopt', 'command_unknown', 'Unknown delegation command');
  if (record.status === 'adopted') return {
    status: 'already_adopted',
    package_id: record.package_id
  };
  assert(record.status !== 'cancelled', 'package_cancelled', 'Package was cancelled');
  assert(Date.parse(record.expires_at) > Date.now(), 'package_expired', 'Package expired');
  const status = await backend(cfg).status();
  assert(!status.lease.held, 'busy', 'Cannot adopt during a held lease');
  const dir = packageDir(cfg, record.package_id),
    manifest = read(file(dir, 'manifest.json')),
    result = read(file(dir, 'result.json'));
  verifyFiles(dir, manifest);
  verifyFiles(dir, result);
  assert(result.package_id === record.package_id && result.base_head === manifest.base_head,
    'package_invalid', 'Result identity mismatch');
  assert(/^[a-f0-9]{40}$/.test(result.tip) && /^[a-f0-9]{40}$/.test(manifest.base_head), 'package_invalid',
    'Invalid Git revision');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chelm-adopt-'));
  try {
    git(tmp, ['init', '-q']);
    git(tmp, ['fetch', '--no-tags', file(dir, 'instance.bundle'), 'HEAD']);
    git(tmp, ['fetch', '--no-tags', file(dir, 'result.bundle'), result.tip]);
    git(tmp, ['bundle', 'verify', file(dir, 'result.bundle')]);
    git(tmp, ['merge-base', '--is-ancestor', manifest.base_head, result.tip]);
    const base = snapshot(tmp, manifest.base_head),
      remote = snapshot(tmp, result.tip),
      local = snapshot(cfg.instance.path);
    unchangedPolicies(base, remote);
    unchangedPolicies(base, local);
    const ids = record.observation_ids;
    const commits = git(tmp, ['rev-list', `${manifest.base_head}..${result.tip}`]).trim().split('\n')
      .filter(Boolean);
    for (const commit of commits) {
      const parents = git(tmp, ['show', '-s', '--format=%P', commit]).trim().split(' ');
      assert(parents.length === 1, 'package_invalid', 'Remote history must be linear');
      for (const p of git(tmp, ['diff-tree', '--no-commit-id', '--name-only', '-r', commit]).trim().split(
          '\n').filter(Boolean)) assert(allowed(p, ids), 'package_invalid',
        'Remote commit modifies a forbidden path: ' + p);
      unchangedPolicies(base, snapshot(tmp, commit));
    }
    for (const s of manifest.observations) {
      const p = `inbox/${id(s.id)}.md`;
      assert(remote.has(p) && hash(remote.get(p)) === s.sha256, 'package_invalid',
        'Returned note bytes changed');
      assert(hash(fs.readFileSync(file(cfg.instance.path, p))) === s.sha256, 'source_changed',
        'Local reserved source changed');
    }
    const parse = (tree, p) => JSON.parse(tree.get(p));
    const localLedger = parse(local, 'memory/processed.json'),
      remoteLedger = parse(remote, 'memory/processed.json'),
      baseLedger = parse(base, 'memory/processed.json');
    for (const row of baseLedger.observations) assert(remoteLedger.observations.some(r => JSON.stringify(
      r) === JSON.stringify(row)), 'package_invalid', 'Retained ledger row changed');
    const added = remoteLedger.observations.filter(r => !baseLedger.observations.some(b => b.id === r.id));
    assert(added.length === ids.length && new Set(added.map(r => r.id)).size === ids.length && added.every(
      r => ids.includes(r.id)), 'package_invalid', 'Result must process exactly the reserved sources');
    assert(!localLedger.observations.some(r => ids.includes(r.id)), 'already_processed',
      'A reserved source was already processed');
    const remoteLease = parse(remote, 'memory/processing-lock.json');
    assert(remoteLease.status !== 'processing', 'package_invalid', 'Returned lease must be released');
    materialize(remote, path.join(tmp, 'validate'));
    atomic(file(tmp, 'previous.json'), base.get('memory/graph.json'));
    harness(cfg, 'validate', path.join(tmp, 'validate'), {
      previous: file(tmp, 'previous.json')
    });
    if (status.head === manifest.base_head) {
      const ref = 'refs/chelm/delegations/' + record.package_id;
      git(cfg.instance.path, ['fetch', '--no-tags', file(dir, 'result.bundle'), result.tip + ':' + ref]);
      const changes = [...new Set([...local.keys(), ...remote.keys()])].filter(p => hash(local.get(p) ??
        '') !== hash(remote.get(p) ?? ''));
      for (const p of changes) {
        const target = file(cfg.instance.path, p),
          actual = fs.existsSync(target) ? hash(fs.readFileSync(target)) : null;
        assert(actual === (local.has(p) ? hash(local.get(p)) : null) || actual === (remote.has(p) ? hash(
          remote.get(p)) : null), 'busy', 'Preserve local drafts before adoption: ' + p);
      }
      const pending = {
        old: status.head,
        next: result.tip,
        writes: changes.map(p => ({
          path: p,
          before: local.has(p) ? hash(local.get(p)) : null,
          after: remote.has(p) ? hash(remote.get(p)) : null
        }))
      };
      write(file(root, 'host/adoption-pending.json'), pending);
      git(cfg.instance.path, ['update-ref', 'HEAD', result.tip, status.head]);
      reconcileAdoption(root, cfg);
      record.status = 'adopted';
      record.adopted_at = now();
      record.head = result.tip;
      persist(root, data);
      return {
        status: 'adopted',
        method: 'fast-forward',
        head: result.tip,
        package_id: record.package_id
      };
    }
    git(cfg.instance.path, ['merge-base', '--is-ancestor', manifest.base_head, 'HEAD']);
    const graph = mergeGraph(parse(base, 'memory/graph.json'), parse(local, 'memory/graph.json'), parse(
      remote, 'memory/graph.json'));
    const questions = {
      ...parse(local, 'questions/queue.json'),
      updated_at: now(),
      questions: keyed(parse(base, 'questions/queue.json').questions, parse(local, 'questions/queue.json')
        .questions, parse(remote, 'questions/queue.json').questions, 'questions')
    };
    const hyps = ['memory/hypotheses.json'].map(p => {
      const b = parse(base, p),
        l = parse(local, p),
        r = parse(remote, p);
      return {
        ...l,
        updated_at: [l.updated_at, r.updated_at].sort().at(-1),
        hypotheses: keyed(b.hypotheses, l.hypotheses, r.hypotheses, 'hypotheses')
      };
    })[0];
    const markdownConflict = ['memory/index.md', 'questions/queue.md'].some(p => hash(local.get(p)) !==
      hash(base.get(p)) && hash(remote.get(p)) !== hash(base.get(p)));
    const events = [];
    for (const [p, b] of remote)
      if (/^memory\/(runs|events)\//.test(p) && !base.has(p)) {
        assert(!local.has(p) || hash(local.get(p)) === hash(b), 'merge_conflict',
          'Journal or event path collision');
        events.push([p, b]);
      }
    const integrationExecutor = {
      id: 'chelm-integrator',
      kind: 'other',
      model: 'none (mechanical integration)',
      host: os.hostname()
    };
    const claimed = await backend(cfg).claim({
      ids,
      max: ids.length
    });
    const owners = read(file(root, 'host/workers.json'));
    owners[claimed.run_id] = {
      actor: actor(),
      host: os.hostname(),
      executor: integrationExecutor,
      sources: claimed.sources,
      outputs: events.map(([p]) => p),
      existing_events: []
    };
    write(file(root, 'host/workers.json'), owners);
    write(file(cfg.instance.path, 'memory/graph.json'), graph);
    write(file(cfg.instance.path, 'questions/queue.json'), questions);
    write(file(cfg.instance.path, 'memory/hypotheses.json'), hyps);
    for (const [p, b] of events) atomic(file(cfg.instance.path, p), b);
    for (const p of ['memory/index.md', 'questions/queue.md'])
      if (hash(local.get(p)) === hash(base.get(p))) atomic(file(cfg.instance.path, p), remote.get(p));
    const journal = `memory/runs/${claimed.run_id}.md`;
    atomic(file(cfg.instance.path, journal),
      `# Integration ${record.package_id}\nStarted: ${now()}\nNo model was used. Remote runs: ${JSON.stringify(result.runs)}\nReview merged memory and summaries.\n` +
      (claimed.guidance_identity ? 'guidance_version: ' + claimed.guidance_identity + '\n' : ''));
    if (markdownConflict) {
      record.status = 'integrating';
      record.integration_run = claimed.run_id;
      persist(root, data);
      return {
        status: 'integration-required',
        work_unit: {
          type: 'integrate',
          run_id: claimed.run_id,
          executor: integrationExecutor,
          workspace_abs: cfg.instance.path,
          journal_path: journal,
          outputs: events.map(([p]) => p),
          task: 'Regenerate memory/index.md and questions/queue.md from merged JSON, review duplicate identities and warnings, validate and submit.',
          guidance: claimed.guidance,
          guidance_identity: claimed.guidance_identity
        }
      };
    }
    const completed = await worker(root, cfg, 'submit', {
      executor: integrationExecutor,
      run_id: claimed.run_id,
      outputs: events.map(([p]) => p)
    });
    record.status = 'adopted';
    record.adopted_at = now();
    persist(root, data);
    return {
      ...completed,
      status: 'adopted',
      method: 'keyed-merge'
    };
  } catch (e) {
    record.refusal = {
      at: now(),
      code: e.code ?? 'package_invalid'
    };
    persist(root, data);
    throw e;
  } finally {
    fs.rmSync(tmp, {
      recursive: true,
      force: true
    });
  }
}
export function reconcileAdoption(root, cfg) {
  const p = file(root, 'host/adoption-pending.json');
  if (!fs.existsSync(p)) return;
  const pending = read(p),
    head = git(cfg.instance.path, ['rev-parse', 'HEAD']).trim();
  if (head === pending.old) {
    fs.rmSync(p);
    return;
  }
  assert(head === pending.next, 'recovery_required', 'Adoption HEAD advanced during recovery');
  const tree = snapshot(cfg.instance.path);
  for (const row of pending.writes) {
    const target = file(cfg.instance.path, row.path),
      actual = fs.existsSync(target) ? hash(fs.readFileSync(target)) : null;
    assert(actual === row.before || actual === row.after, 'recovery_required',
      'Preserve edited file before adoption recovery: ' + row.path);
  }
  for (const row of pending.writes) {
    const target = file(cfg.instance.path, row.path);
    if (tree.has(row.path)) atomic(target, tree.get(row.path));
    else fs.rmSync(target, {
      force: true
    });
  }
  git(cfg.instance.path, ['reset', '-q', 'HEAD', '--', ...pending.writes.map(r => r.path)]);
  fs.rmSync(p);
}
export async function remoteWorker(root, cfg, command, input) {
  executor(input);
  if (command === 'take') {
    const share = safeAbs(input.share_root ?? cfg.delegation.share_root);
    const choices = input.package_id ? [id(input.package_id)] : fs.readdirSync(file(share, 'delegations'))
      .filter(n => /^[a-f0-9-]{36}$/.test(n));
    for (const package_id of choices) {
      const dir = packageDir(cfg, package_id, share);
      if (!fs.existsSync(file(dir, 'manifest.json')) || fs.existsSync(file(dir, 'taken.json'))) continue;
      const manifest = read(file(dir, 'manifest.json'));
      verifyFiles(dir, manifest);
      assert(manifest.participants?.includes(actor()), 'participant_refused',
        'OS user is not an allowed participant');
      assert(Date.parse(manifest.expires_at) > Date.now() && !fs.existsSync(file(dir, 'cancelled.json')),
        'package_expired', 'Package expired or cancelled');
      assert(hash(fs.readFileSync(file(cfg.harness.root, 'RELEASE.json'))) === manifest
        .harness_release_sha256, 'package_invalid', 'Harness release mismatch');
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chelm-take-'));
      try {
        git(tmp, ['init', '-q']);
        git(tmp, ['bundle', 'verify', file(dir, 'instance.bundle')]);
        for (const s of manifest.observations) assert(hash(fs.readFileSync(file(dir,
          `inbox/${id(s.id)}.md`))) === s.sha256, 'package_invalid', 'Note hash mismatch');
      } finally {
        fs.rmSync(tmp, {
          recursive: true,
          force: true
        });
      }
      let fd;
      try {
        fd = fs.openSync(file(dir, 'taken.json'), 'wx');
      } catch (e) {
        if (e.code === 'EEXIST') continue;
        throw e;
      }
      fs.writeFileSync(fd, json({
        taken_by: actor(),
        host: os.hostname(),
        taken_at: now()
      }));
      fs.closeSync(fd);
      const sandbox = file(root, 'sandbox/' + package_id);
      fs.mkdirSync(sandbox, {
        recursive: true
      });
      const c = defaults();
      c.label = 'delegated';
      c.sandbox.resettable = true;
      c.harness = cfg.harness;
      write(file(sandbox, 'chelm.runtime.json'), c);
      hostInit(sandbox);
      const instance = file(sandbox, 'instance');
      fs.mkdirSync(instance);
      git(instance, ['init', '-q']);
      git(instance, ['config', 'core.autocrlf', 'false']);
      git(instance, ['fetch', file(dir, 'instance.bundle'), 'HEAD']);
      git(instance, ['checkout', '-q', '-b', 'main', 'FETCH_HEAD']);
      for (const s of manifest.observations)
        for (const p of [`inbox/${s.id}.md`, `evidence/${s.id}.json`])
          if (fs.existsSync(file(dir, p))) atomic(file(instance, p), fs.readFileSync(file(dir, p)));
      write(file(sandbox, 'host/remote.json'), {
        package_id,
        share_root: share,
        base_head: manifest.base_head,
        manifest
      });
      const live = config(sandbox);
      compatible(live);
      publish(sandbox, live, {
        deep: true
      });
      return {
        status: 'taken',
        package_id,
        runtime_path_abs: sandbox
      };
    }
    return {
      status: 'no-work'
    };
  }
  assert(command === 'return', 'command_unknown', 'Unknown remote worker command');
  const remote = read(file(root, 'host/remote.json'));
  assert(remote.package_id === input.package_id, 'package_unknown', 'Wrong package');
  const dir = packageDir(cfg, remote.package_id, remote.share_root);
  assert(read(file(dir, 'taken.json')).taken_by === actor(), 'participant_refused',
    'OS user does not own package');
  const inv = await backend(cfg).status();
  assert(!inv.lease.held, 'busy', 'Finish or abandon the current lease first');
  const tree = snapshot(cfg.instance.path),
    ledger = JSON.parse(tree.get('memory/processed.json')),
    ids = remote.manifest.observations.map(s => s.id);
  assert(ids.every(id => ledger.observations.some(r => r.id === id)), 'sources_unprocessed',
    'All reserved sources must be processed before return');
  const b = file(dir, 'result.bundle');
  assert(!fs.existsSync(file(dir, 'result.json')), 'already_returned', 'Result already returned');
  const temp = b + '.tmp';
  git(cfg.instance.path, ['bundle', 'create', temp, remote.base_head + '..HEAD']);
  fs.renameSync(temp, b);
  const runs = [...new Set(ledger.observations.filter(r => ids.includes(r.id)).map(r => r.run))].map(
    journal => ({
      run_id: path.basename(journal, '.md'),
      journal,
      observation_ids: ledger.observations.filter(r => r.run === journal).map(r => r.id),
      model: input.executor.model,
      executor: input.executor
    }));
  const validator = harness(cfg, 'validate', cfg.instance.path);
  const result = {
    schema_version: 1,
    package_id: remote.package_id,
    base_head: remote.base_head,
    tip: inv.head,
    runs,
    processed: ids,
    validator,
    returned_by: actor(),
    returned_at: now(),
    files: {
      'result.bundle': hash(fs.readFileSync(b))
    }
  };
  write(file(dir, 'result.json'), result);
  return {
    status: 'returned',
    package_id: remote.package_id,
    tip: inv.head
  };
}
