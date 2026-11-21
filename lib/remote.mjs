import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  file,
  read,
  write,
  atomic,
  assert,
  fail,
  hash,
  now,
  id,
  git,
  snapshot,
  materialize,
  lock,
  json
} from './util.mjs';
import { config } from './runtime.mjs';
import { backend, executor } from './worker.mjs';
import { harness, mergeHarness, packageRoot, verifyHarness } from './harness.mjs';
import { loadGuidance, guidanceIdentity } from './guidance.mjs';
import { checkProfile } from './profile-install.mjs';
import { publish, view } from './read-model.mjs';
import { assignments, activeAssignments, expireAssignments, terminal } from './remote-state.mjs';
import { publishTree, reconcilePublication } from './publication.mjs';

export const CHUNK_BYTES = 32768,
  MAX_BYTES = 64 * 1024 * 1024;
const protocol = [
  'AGENTS.md',
  'docs/PROCESSING.md',
  'docs/ANALYSIS_WORKFLOW.md',
  'docs/MEMORY_MODEL.md'
];
const outputs = [
  'memory/graph.json',
  'memory/index.md',
  'memory/hypotheses.json',
  'questions/queue.json',
  'questions/queue.md'
];
const recordPath = (root, work) => file(root, 'host/remote/work/' + id(work) + '/record.json');
const workDir = (root, work) => file(root, 'host/remote/work/' + id(work));
const save = (root, a) => {
  a.updated_at = now();
  write(recordPath(root, a.work_id), a);
};
const digestPattern = /^[a-f0-9]{64}$/;
function policy(tree) {
  return hash(
    json(
      [...tree]
        .filter(
          ([p]) =>
            p === 'golem.config.json' ||
            p.startsWith('profiles/') ||
            p.startsWith('guidance/') ||
            p.startsWith('instance/')
        )
        .map(([p, b]) => [p, hash(b)])
    )
  );
}
function owned(root, principal, args, { active = true } = {}) {
  const a = read(recordPath(root, args.work_id));
  assert(
    a.principal === principal,
    'work_not_owned',
    'Work does not belong to this authenticated principal'
  );
  assert(args.attempt === a.attempt, 'stale_attempt', 'Assignment attempt changed');
  if (active)
    assert(
      !terminal.has(a.status) && Date.parse(a.expires_at) > Date.now(),
      'work_inactive',
      'Assignment expired or completed'
    );
  return a;
}
function describe(a) {
  return {
    worker_contract: 2,
    work_id: a.work_id,
    attempt: a.attempt,
    kind: a.kind,
    status: a.status,
    base_head: a.base_head,
    claimed_at: a.claimed_at,
    expires_at: a.expires_at,
    guidance_identity: a.guidance_identity,
    sources: a.sources.map((s) => ({
      id: s.id,
      sha256: s.sha256,
      kind: s.kind,
      recorded_at: s.recorded_at,
      artifact_id: a.artifacts.find((x) => x.path === s.path)?.artifact_id
    })),
    artifacts: a.artifacts.filter(
      (x) =>
        x.role === 'protocol' ||
        outputs.includes(x.path) ||
        x.path === 'golem.config.json' ||
        /^(profiles|guidance|instance)\//.test(x.path) ||
        x.path === `memory/runs/${a.run_id}.guidance.json` ||
        a.sources.some((s) => s.path === x.path)
    ),
    artifact_count: a.artifacts.length,
    output_slots: a.slots,
    needs_regeneration: a.needs_regeneration ?? [],
    warnings: a.warnings,
    limits: { chunk_bytes: CHUNK_BYTES, candidate_bytes: MAX_BYTES },
    receipt: a.receipt
  };
}
function setupRepository(cfg, dir, tree) {
  materialize(tree, dir);
  git(dir, ['init', '-q']);
  // Capture raw bytes, never run checkout/add filters from instance attributes.
  const paths = [...tree.keys()];
  const hashes = git(dir, ['hash-object', '-w', '--no-filters', '--stdin-paths'], {
    input: paths.map((p) => file(dir, p)).join('\n') + '\n'
  })
    .trim()
    .split('\n');
  git(dir, ['update-index', '-z', '--index-info'], {
    input: paths.map((p, i) => `100644 ${hashes[i]}\t${p}\0`).join('')
  });
  const captured = git(dir, ['write-tree']).trim();
  const commit = git(
    dir,
    ['-c', 'user.name=chelm-host', '-c', 'user.email=chelm-host@local', 'commit-tree', captured],
    { input: 'remote immutable base\n' }
  ).trim();
  git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(dir, ['update-ref', 'HEAD', commit]);
}

function addArtifact(a, dir, p, bytes, role) {
  const artifact_id = randomUUID();
  atomic(file(dir, 'artifacts/' + artifact_id), bytes);
  a.artifacts.push({ artifact_id, path: p, role, size_bytes: bytes.length, sha256: hash(bytes) });
}
function inventory(a, dir, cfg, input) {
  a.artifacts = [];
  for (const p of protocol)
    addArtifact(a, dir, p, fs.readFileSync(file(cfg.harness.root, p)), 'protocol');
  const selected = JSON.parse(input.get('golem.config.json')?.toString('utf8') ?? '{}').profile;
  const guidancePaths = new Set([
    'golem.config.json',
    'instance/purpose.md',
    ...(selected
      ? [
          selected.path,
          ...(selected.sections ?? []).map((s) => s.path),
          ...(selected.vocabulary ? [selected.vocabulary] : [])
        ]
      : [])
  ]);
  for (const [p, b] of input)
    if (
      outputs.includes(p) ||
      guidancePaths.has(p) ||
      /^(inbox|evidence)\/[a-f0-9-]{36}\.(md|json)$/.test(p) ||
      /^memory\/(runs|events)\//.test(p)
    )
      addArtifact(a, dir, p, b, p.startsWith('inbox/') ? 'source' : 'memory');
  a.slots = [
    ...outputs,
    `memory/runs/${a.run_id}.md`,
    ...a.sources
      .filter((s) => s.kind === 'question_answer')
      .map((s) => `memory/events/chat/${s.id}.json`)
  ].map((p) => ({ slot_id: randomUUID(), path: p, required: p === `memory/runs/${a.run_id}.md` }));
}
function validRequestId(v) {
  assert(
    typeof v === 'string' && v.length > 0 && v.length <= 128,
    'input_invalid',
    'A stable request_id of 1..128 characters is required'
  );
}
async function request(root, cfg, principal, args) {
  executor(args);
  validRequestId(args.request_id);
  const prior = assignments(root).find(
    (a) => a.principal === principal && a.request_id === args.request_id
  );
  if (prior) return describe(prior);
  const pending = activeAssignments(root).find(
    (a) => a.kind === 'integration' && a.principal === principal
  );
  if (pending) return describe(pending);
  if (activeAssignments(root).length >= cfg.remote.max_active_work)
    return { status: 'no-work', retry_after_seconds: 30 };
  if (cfg.profile_expectation?.enforce) {
    const c = await checkProfile(cfg);
    assert(c.matches, 'profile_mismatch', 'Reviewed application guidance has drifted');
  }
  const adapter = backend(cfg),
    s = await adapter.status();
  assert(!s.recovery_required, 'recovery_required', 'Resolve storage recovery before assignment');
  if (s.lease.held) return { status: 'no-work', retry_after_seconds: 30 };
  assert(
    !s.malformed.length,
    'source_changed',
    'Malformed or changed retained sources require attention'
  );
  const max = args.max ?? 20;
  assert(Number.isInteger(max) && max >= 1 && max <= 20, 'input_invalid', 'max must be 1..20');
  const reserved = new Set(activeAssignments(root).flatMap((a) => a.sources.map((s) => s.id)));
  const observations = view(root, 'observations').data;
  const sources = s.ready
    .filter(
      (x) =>
        !reserved.has(x.id) &&
        (!args.kinds || args.kinds.includes(x.kind)) &&
        (!args.subject_id ||
          observations.find((o) => o.id === x.id)?.subject_id === args.subject_id)
    )
    .slice(0, max);
  if (!sources.length) return { status: 'no-work', retry_after_seconds: 30 };
  const base = snapshot(cfg.instance.path),
    bound = await loadGuidance(cfg.instance.path, {
      kinds: [...new Set(sources.map((s) => s.kind))]
    });
  // Reject dirty selected policy before constructing a snapshot from it.
  const committed = await loadGuidance(cfg.instance.path, {
    kinds: [...new Set(sources.map((s) => s.kind))],
    read: async (p) => {
      if (!base.has(p)) {
        const e = Error('Missing');
        e.code = 'ENOENT';
        throw e;
      }
      return base.get(p);
    }
  });
  assert(
    JSON.stringify(bound) === JSON.stringify(committed),
    'policy_changed',
    'Commit or restore purpose/profile before requesting work'
  );
  const work_id = randomUUID(),
    dir = workDir(root, work_id);
  fs.mkdirSync(dir, { recursive: true });
  try {
    materialize(base, file(dir, 'base'));
    const sandbox = file(dir, 'sandbox');
    setupRepository(cfg, sandbox, base);
    for (const source of sources)
      for (const p of [source.path, `evidence/${source.id}.json`]) {
        const src = file(cfg.instance.path, p);
        if (fs.existsSync(src)) atomic(file(sandbox, p), fs.readFileSync(src));
      }
    const sandboxCfg = { ...cfg, instance: { ...cfg.instance, path: sandbox } };
    const claimed = await backend(sandboxCfg).claim({
      ids: sources.map((s) => s.id),
      max: sources.length,
      required_capabilities: ['purpose-guidance-v2']
    });
    const input = snapshot(sandbox);
    for (const source of sources)
      for (const p of [source.path, `evidence/${source.id}.json`])
        if (fs.existsSync(file(sandbox, p))) input.set(p, fs.readFileSync(file(sandbox, p)));
    assert(
      [...input.values()].reduce((n, b) => n + b.length, 0) <= MAX_BYTES,
      'capacity_exceeded',
      'Assignment snapshot exceeds 64 MiB'
    );
    materialize(input, file(dir, 'input'));
    const a = {
      schema_version: 2,
      work_id,
      attempt: 1,
      principal,
      request_id: args.request_id,
      executor: args.executor,
      kind: 'analysis',
      status: 'assigned',
      base_head: s.head,
      policy: policy(base),
      harness_release_sha256: hash(fs.readFileSync(file(cfg.harness.root, 'RELEASE.json'))),
      claimed_at: claimed.guidance_version
        ? read(file(sandbox, 'memory/processing-lock.json')).claimed_at
        : now(),
      created_at: now(),
      expires_at: new Date(Date.now() + cfg.remote.assignment_minutes * 60000).toISOString(),
      max_expires_at: new Date(Date.now() + cfg.remote.max_lifetime_minutes * 60000).toISOString(),
      run_id: claimed.run_id,
      guidance_identity: claimed.guidance_identity,
      sources,
      warnings: view(root, 'warnings').data
    };
    inventory(a, dir, cfg, input);
    save(root, a);
    return describe(a);
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}
function stage(root, a, args) {
  const slot = a.slots.find((s) => s.slot_id === args.slot_id);
  assert(slot, 'bad_outputs', 'Unknown output slot');
  assert(
    Number.isInteger(args.revision) && args.revision >= 1 && args.revision <= 100,
    'input_invalid',
    'Output revision must be 1..100'
  );
  assert(
    typeof args.text === 'string' && args.text.isWellFormed(),
    'input_invalid',
    'Output must be well-formed Unicode'
  );
  const b = Buffer.from(args.text),
    offset = args.offset ?? 0;
  assert(
    b.length > 0 && b.length <= CHUNK_BYTES && Number.isInteger(offset) && offset >= 0,
    'input_invalid',
    'Invalid chunk offset or size'
  );
  const dir = workDir(root, a.work_id),
    key = slot.slot_id + '/' + args.revision,
    target = file(dir, 'uploads/' + key),
    meta = read(target + '.json', {}),
    old = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0);
  if (offset < old.length) {
    assert(
      offset + b.length <= old.length && old.subarray(offset, offset + b.length).equals(b),
      'upload_conflict',
      'Conflicting retry bytes'
    );
    assert(
      !args.final || (offset + b.length === old.length && meta.complete),
      'upload_conflict',
      'Final flag differs from stored revision'
    );
    return {
      size_bytes: old.length,
      next_offset: old.length,
      complete: !!meta.complete,
      sha256: meta.sha256,
      revision: args.revision
    };
  }
  assert(
    !meta.complete && offset === old.length && old.length + b.length <= MAX_BYTES,
    'upload_conflict',
    'Missing, complete or overlapping output bytes'
  );
  const quota = file(dir, 'upload-index.json'),
    entries = read(quota, {});
  entries[key] = old.length + b.length;
  assert(
    Object.values(entries).reduce((n, v) => n + v, 0) <= MAX_BYTES,
    'capacity_exceeded',
    'Upload storage quota exceeded'
  );
  const next = Buffer.concat([old, b]),
    complete = !!args.final,
    sha256 = complete ? hash(next) : undefined;
  write(quota, entries);
  atomic(target, next);
  write(target + '.json', { complete, sha256 });
  a.status = 'staging';
  save(root, a);
  return {
    size_bytes: next.length,
    next_offset: next.length,
    complete,
    sha256,
    revision: args.revision
  };
}
function candidate(root, a, args) {
  assert(
    Array.isArray(args.outputs) && args.outputs.length > 0 && args.outputs.length <= a.slots.length,
    'bad_outputs',
    'Expected declared output slots'
  );
  const seen = new Set(),
    entries = args.outputs
      .map((o) => {
        const slot = a.slots.find((s) => s.slot_id === o.slot_id);
        assert(
          slot &&
            !seen.has(o.slot_id) &&
            Number.isInteger(o.revision) &&
            o.revision >= 1 &&
            o.revision <= 100,
          'bad_outputs',
          'Invalid or duplicate output slot'
        );
        seen.add(o.slot_id);
        const target = file(workDir(root, a.work_id), 'uploads/' + slot.slot_id + '/' + o.revision),
          meta = read(target + '.json');
        assert(
          meta.complete && digestPattern.test(meta.sha256),
          'digest_mismatch',
          'Output revision is incomplete'
        );
        const bytes = fs.readFileSync(target);
        assert(hash(bytes) === meta.sha256, 'digest_mismatch', 'Incomplete or altered output');
        return { ...o, sha256: meta.sha256, path: slot.path, bytes };
      })
      .sort((x, y) => x.path.localeCompare(y.path));
  assert(
    a.slots.filter((s) => s.required).every((s) => seen.has(s.slot_id)),
    'journal_missing',
    'Upload the assignment journal'
  );
  const digest = hash(json(entries.map(({ bytes, ...e }) => e)));
  assert(
    !args.candidate_digest || args.candidate_digest === digest,
    'digest_mismatch',
    'Candidate manifest digest differs'
  );
  return { entries, digest };
}
function directoryTree(dir) {
  const tree = new Map();
  function walk(at, prefix = '') {
    for (const ent of fs.readdirSync(at, { withFileTypes: true })) {
      if (ent.name === '.git') continue;
      const rel = prefix + ent.name;
      assert(!ent.isSymbolicLink(), 'unsafe_path', 'Linked artifact refused');
      if (ent.isDirectory()) walk(path.join(at, ent.name), rel + '/');
      else tree.set(rel, fs.readFileSync(file(dir, rel)));
    }
  }
  walk(dir);
  return tree;
}
function checkFresh(root, cfg, a) {
  assert(
    hash(fs.readFileSync(file(cfg.harness.root, 'RELEASE.json'))) === a.harness_release_sha256,
    'policy_changed',
    'Harness release changed during work'
  );
  const current = snapshot(cfg.instance.path);
  assert(
    policy(current) === a.policy,
    'policy_changed',
    'Committed purpose/profile changed; obtain fresh work'
  );
  const ledger = JSON.parse(current.get('memory/processed.json'));
  for (const s of a.sources) {
    assert(
      hash(fs.readFileSync(file(cfg.instance.path, s.path))) === s.sha256,
      'source_changed',
      'Assigned source bytes changed'
    );
    assert(
      !ledger.observations.some((r) => r.id === s.id),
      'already_processed',
      'Assigned source already processed'
    );
  }
  return current;
}
function completedCandidate(root, cfg, a, c) {
  const dir = workDir(root, a.work_id),
    input = directoryTree(file(dir, 'input'));
  for (const e of c.entries) input.set(e.path, e.bytes);
  const journal = input.get(`memory/runs/${a.run_id}.md`)?.toString('utf8') ?? '';
  assert(
    journal.split('\n').includes('guidance_version: ' + a.guidance_identity) &&
      journal.includes('Started: ' + a.claimed_at),
    'guidance_missing',
    'Journal requires exact Started and guidance_version'
  );
  assert(
    journal.includes(a.executor.model),
    'journal_missing',
    'Journal must name the declared actual model'
  );
  const ledger = JSON.parse(input.get('memory/processed.json')),
    at = now(),
    paths = c.entries.map((e) => e.path);
  ledger.updated_at = at;
  if (!a.integration)
    ledger.observations.push(
      ...a.sources.map((s) => ({
        id: s.id,
        source_file: s.path,
        source_sha256: s.sha256,
        status: 'processed',
        processed_at: at,
        outputs: paths,
        run: `memory/runs/${a.run_id}.md`
      }))
    );
  input.set('memory/processed.json', Buffer.from(json(ledger)));
  input.set(
    'memory/processing-lock.json',
    Buffer.from(
      json({
        schema_version: 1,
        status: 'idle',
        observation_ids: [],
        last_run_id: a.run_id,
        completed_at: at
      })
    )
  );
  return input;
}
async function validate(root, cfg, a, args) {
  checkFresh(root, cfg, a);
  const c = candidate(root, a, args),
    tree = completedCandidate(root, cfg, a, c),
    dir = file(workDir(root, a.work_id), 'candidate');
  fs.rmSync(dir, { recursive: true, force: true });
  materialize(tree, dir);
  const validation = harness(cfg, 'validate', dir, {
    previous: file(workDir(root, a.work_id), 'base/memory/graph.json')
  });
  return { c, tree, validation };
}
async function submit(root, cfg, a, args) {
  validRequestId(args.submission_id);
  if (a.submission) {
    assert(
      a.submission.id === args.submission_id && a.submission.digest === args.candidate_digest,
      'idempotency_conflict',
      'Submission identity or candidate changed'
    );
    if (a.receipt) return a.receipt;
  }
  const { c, tree, validation } = await validate(root, cfg, a, args);
  assert(
    args.candidate_digest === c.digest,
    'digest_mismatch',
    'Submit the exact validated candidate digest'
  );
  a.submission = { id: args.submission_id, digest: c.digest };
  a.status = 'submitted';
  save(root, a);
  const dir = workDir(root, a.work_id),
    current = checkFresh(root, cfg, a),
    head = git(cfg.instance.path, ['rev-parse', 'HEAD']).trim();
  const existing = await backend(cfg).status();
  if (existing.lease.held && a.publication_run === existing.lease.run_id)
    await backend(cfg)['release-error']({ run: a.publication_run });
  else assert(!existing.lease.held, 'busy', 'A local worker holds the publication lease');
  let desired = tree;
  if (head !== a.base_head) {
    const ours = file(dir, 'ours');
    fs.rmSync(ours, { recursive: true, force: true });
    materialize(current, ours);
    const merged = file(dir, 'merged');
    fs.rmSync(merged, { recursive: true, force: true });
    const report = await mergeHarness(cfg, {
      base: file(dir, 'base'),
      ours,
      theirs: file(dir, 'candidate'),
      out: merged
    });
    desired = directoryTree(merged);
    if (report.requires_review) {
      // An integration assignment is a new attempt; old uploads cannot submit against it.
      a.attempt++;
      a.kind = 'integration';
      a.status = 'assigned';
      a.base_head = head;
      a.submission = null;
      a.needs_regeneration = report.needs_regeneration;
      a.warnings = report.warnings;
      a.claimed_at = now();
      a.expires_at = new Date(
        Math.min(Date.now() + cfg.remote.assignment_minutes * 60000, Date.parse(a.max_expires_at))
      ).toISOString();
      fs.rmSync(file(dir, 'base'), { recursive: true, force: true });
      materialize(current, file(dir, 'base'));
      // Keep completed ledger and immutable remote run. Integration only edits summaries + its own journal.
      const integrationRun = randomUUID();
      a.run_id = integrationRun;
      const guidance = await loadGuidance(cfg.instance.path, {
        kinds: [...new Set(a.sources.map((s) => s.kind))]
      });
      a.guidance_identity = guidanceIdentity(guidance.guidance_version);
      desired.set(`memory/runs/${integrationRun}.guidance.json`, Buffer.from(json(guidance)));
      fs.rmSync(file(dir, 'input'), { recursive: true, force: true });
      materialize(desired, file(dir, 'input'));
      inventory(a, dir, cfg, desired);
      a.slots = a.slots.filter((s) =>
        ['memory/index.md', 'questions/queue.md', `memory/runs/${integrationRun}.md`].includes(
          s.path
        )
      );
      a.integration = true;
      save(root, a);
      return { status: 'integration-required', work_unit: describe(a) };
    }
  }
  // The owner takes a short real harness lease only during final publication.
  const claim = await backend(cfg).claim({
    ids: a.sources.map((s) => s.id),
    max: a.sources.length
  });
  a.publication_run = claim.run_id;
  save(root, a);
  try {
    const claimed = snapshot(cfg.instance.path);
    for (const [p, b] of claimed)
      if (p.startsWith('memory/runs/') && !desired.has(p)) desired.set(p, b);
    const stamp = now(),
      journal = `memory/runs/${claim.run_id}.md`;
    desired.set(
      journal,
      Buffer.from(
        `# Owner publication\nStarted: ${read(file(cfg.instance.path, 'memory/processing-lock.json')).claimed_at}\nModel: none (mechanical publication). Remote executor: ${a.executor.model}\nguidance_version: ${claim.guidance_identity}\nSources: ${a.sources.map((s) => s.id).join(', ')}\nVerification: local harness validation; warnings reviewed.\n`
      )
    );
    desired.set(
      'memory/processing-lock.json',
      Buffer.from(
        json({
          schema_version: 1,
          status: 'idle',
          observation_ids: [],
          last_run_id: claim.run_id,
          completed_at: stamp
        })
      )
    );
    const final = file(dir, 'final');
    fs.rmSync(final, { recursive: true, force: true });
    materialize(desired, final);
    atomic(file(dir, 'previous.json'), current.get('memory/graph.json'));
    harness(cfg, 'validate', final, { previous: file(dir, 'previous.json') });
    checkFresh(root, cfg, a);
    const next = publishTree(root, cfg, claim.head, desired, {
      work_id: a.work_id,
      candidate_digest: c.digest
    });
    a = read(recordPath(root, a.work_id));
    publish(root, cfg, { deep: true });
    return { ...a.receipt, head: next, validation };
  } catch (e) {
    if (!fs.existsSync(file(root, 'host/publication-pending.json')))
      try {
        await backend(cfg)['release-error']({ run: claim.run_id });
      } catch {}
    throw e;
  }
}
export async function remoteCall(root, principal, tool, args = {}) {
  assert(
    typeof principal === 'string' && principal.length,
    'unauthorized',
    'Verified worker principal required'
  );
  root = path.resolve(root);
  const cfg = config(root);
  verifyHarness(cfg);
  return lock(root, 'remote ' + tool, async () => {
    try {
      reconcilePublication(root, cfg);
      expireAssignments(root);
      if (tool === 'chelm_request_work') return await request(root, cfg, principal, args);
      if (tool === 'chelm_list_work') {
        const all = assignments(root).filter((a) => a.principal === principal),
          offset = args.offset ?? 0,
          limit = args.limit ?? 50;
        assert(
          Number.isInteger(offset) &&
            offset >= 0 &&
            Number.isInteger(limit) &&
            limit >= 1 &&
            limit <= 100,
          'input_invalid',
          'Invalid list bounds'
        );
        return {
          work: all.slice(offset, offset + limit).map((a) => ({
            work_id: a.work_id,
            attempt: a.attempt,
            kind: a.kind,
            status: a.status,
            executor: a.executor,
            expires_at: a.expires_at,
            receipt: a.receipt
          })),
          next_offset: offset + limit < all.length ? offset + limit : null
        };
      }
      let a = owned(root, principal, args, {
        active: !['chelm_work_status', 'chelm_submit_candidate'].includes(tool)
      });
      if (tool === 'chelm_work_status') return describe(a);
      if (tool === 'chelm_submit_candidate' && a.receipt) {
        assert(
          a.submission?.id === args.submission_id && a.submission.digest === args.candidate_digest,
          'idempotency_conflict',
          'Submission changed'
        );
        return a.receipt;
      }
      assert(
        !terminal.has(a.status) && Date.parse(a.expires_at) > Date.now(),
        'work_inactive',
        'Assignment is no longer active'
      );
      if (tool === 'chelm_renew_work') {
        a.expires_at = new Date(
          Math.min(Date.now() + cfg.remote.assignment_minutes * 60000, Date.parse(a.max_expires_at))
        ).toISOString();
        save(root, a);
        return describe(a);
      }
      if (tool === 'chelm_abandon_work') {
        a.status = 'abandoned';
        save(root, a);
        return { status: a.status, work_id: a.work_id };
      }
      if (tool === 'chelm_list_artifacts') {
        const all = a.artifacts.filter(
            (x) =>
              (!args.path_prefix || x.path.startsWith(args.path_prefix)) &&
              (!args.observation_id || x.path === `inbox/${args.observation_id}.md`)
          ),
          offset = args.offset ?? 0,
          limit = args.limit ?? 50;
        return {
          artifacts: all.slice(offset, offset + limit),
          next_offset: offset + limit < all.length ? offset + limit : null
        };
      }
      if (tool === 'chelm_read_artifact') {
        const artifact = a.artifacts.find((x) => x.artifact_id === args.artifact_id);
        assert(artifact, 'artifact_unknown', 'Unknown assignment artifact');
        const bytes = fs.readFileSync(
          file(workDir(root, a.work_id), 'artifacts/' + artifact.artifact_id)
        );
        assert(hash(bytes) === artifact.sha256, 'digest_mismatch', 'Captured artifact changed');
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes),
          offset = args.offset ?? 0;
        assert(
          Number.isInteger(offset) && offset >= 0 && offset <= text.length,
          'input_invalid',
          'Invalid UTF-16 text offset'
        );
        let end = Math.min(text.length, offset + 8192);
        if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
        return {
          ...artifact,
          text: text.slice(offset, end),
          offset,
          next_offset: end < text.length ? end : null
        };
      }
      if (tool === 'chelm_context') {
        const allowed = [
            'query',
            'entity',
            'source',
            'predicate',
            'type',
            'kind',
            'status',
            'hops',
            'expansion_budget',
            'current',
            'valid_at',
            'limit',
            'external_id',
            'scheme',
            'namespace'
          ],
          options = args.filters ?? {};
        assert(
          Object.keys(options).every((k) => allowed.includes(k)),
          'input_invalid',
          'Unknown retrieval filter'
        );
        assert(
          !options.limit ||
            (Number.isInteger(options.limit) && options.limit >= 1 && options.limit <= 100),
          'input_invalid',
          'Retrieval limit must be 1..100'
        );
        return harness(cfg, 'context', file(workDir(root, a.work_id), 'input'), options);
      }
      if (tool === 'chelm_stage_output') {
        assert(!a.submission, 'candidate_frozen', 'Submission already fixed');
        return stage(root, a, args);
      }
      if (tool === 'chelm_validate_candidate') {
        const { c, validation } = await validate(root, cfg, a, args);
        return { status: 'validated', candidate_digest: c.digest, validation };
      }
      if (tool === 'chelm_submit_candidate') return await submit(root, cfg, a, args);
      fail('tool_unknown', 'Unknown remote worker tool');
    } catch (error) {
      if (typeof args.work_id === 'string' && /^[a-f0-9-]{36}$/.test(args.work_id))
        try {
          const a = read(recordPath(root, args.work_id));
          if (a.principal === principal && !terminal.has(a.status)) {
            a.last_error = { code: error.code ?? 'internal_error', at: now() };
            save(root, a);
          }
        } catch {}
      throw error;
    }
  });
}
