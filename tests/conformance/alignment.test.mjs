import test from '../scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  fixture,
  ok,
  refuse,
  harness,
  executor,
  source,
  git
} from '../helpers.mjs';
import {
  renameWithRetry,
  atomic
} from '../../lib/util.mjs';

test('VF-3: explicit store subjects, generic-name preflight and consumer jobs wrapper', t => {
  const f = fixture(t),
    ids = f.submit('REC-1');
  const store = path.join(f.base, 'observations.json'),
    jobs = path.join(f.base, 'jobs.json');
  fs.writeFileSync(store, JSON.stringify({
    entries: [{
      kind: 'record',
      ids
    }]
  }));
  fs.writeFileSync(jobs, JSON.stringify({
    jobs: [{
      id: 'a'.repeat(32),
      kind: 'collect',
      featureId: 'REC-1',
      requestedBy: 'golem',
      status: 'done',
      reason: 'Synthetic request',
      createdAt: new Date().toISOString()
    }]
  }));
  const denied = path.join(f.base, 'denied');
  refuse('subject_required', 'adopt', null, denied, undefined, {
    harness,
    instance: f.instance,
    'intake-stores': store
  });
  assert(!fs.existsSync(denied));
  const target = path.join(f.base, 'adopted');
  ok('adopt', null, target, {
    intake_stores: [{
      path: store,
      subject_id: 'REC-1'
    }]
  }, {
    harness,
    instance: f.instance,
    requests: jobs
  });
  assert.equal(ok('subject', 'REC-1', target).kinds.record.observed, 1);
  const requests = ok('requests', 'list', target).requests;
  assert.equal(requests[0].subject_id, 'REC-1');
  assert.equal(requests[0].status, 'fulfilled');
  assert.equal(fs.readFileSync(store, 'utf8'), JSON.stringify({
    entries: [{
      kind: 'record',
      ids
    }]
  }));
});

test('VF-4: mirrored profiles retain exact bytes; status and enforced next detect source drift', t => {
  const f = fixture(t),
    mirror = path.join(f.base, 'mirror');
  fs.mkdirSync(path.join(mirror, 'guidance'), {
    recursive: true
  });
  const configuration = Buffer.from(
    '{\r\n  "schema_version": 1, "profile": {"path":"guidance/core.md","sections":[{"id":"records","path":"guidance/records.md","kinds":["record"]}],"vocabulary":"guidance/vocabulary.json"}\r\n}\r\n'
    );
  const core = Buffer.from('# Purpose\r\nRead exact source quotations. Żółć.\r\n');
  fs.writeFileSync(path.join(mirror, 'golem.config.json'), configuration);
  fs.writeFileSync(path.join(mirror, 'guidance/core.md'), core);
  fs.writeFileSync(path.join(mirror, 'guidance/records.md'),
    '# Records\r\nTreat source assertions as assertions.\r\n');
  fs.writeFileSync(path.join(mirror, 'guidance/vocabulary.json'),
    '{"schema_version":2,"kinds":["record"],"predicates":["describes"]}\r\n');
  const before = git(f.instance, 'rev-parse', 'HEAD');
  assert.equal(ok('profile', 'install', f.root, undefined, {
    source: mirror
  }).matches, true);
  assert.notEqual(git(f.instance, 'rev-parse', 'HEAD'), before);
  assert.deepEqual(fs.readFileSync(path.join(f.instance, 'golem.config.json')), configuration);
  assert.deepEqual(fs.readFileSync(path.join(f.instance, 'guidance/core.md')), core);
  assert.equal(ok('profile', 'check', f.root, undefined, {
    source: mirror
  }).matches, true);
  assert.equal(ok('profile', 'install', f.root, undefined, {
    source: mirror
  }).changed, false);
  const runtime = path.join(f.root, 'chelm.runtime.json'),
    cfg = JSON.parse(fs.readFileSync(runtime));
  cfg.profile_expectation = {
    source: mirror,
    enforce: true
  };
  fs.writeFileSync(runtime, JSON.stringify(cfg));
  fs.appendFileSync(path.join(mirror, 'guidance/core.md'), 'New expected guidance.\r\n');
  assert.equal(ok('status', null, f.root).profile.expected.matches, false);
  refuse('profile_mismatch', 'worker', 'next', f.root, {
    executor
  });
  assert.equal(f.read('memory/processing-lock.json').status, 'idle');
  ok('profile', 'install', f.root, undefined, {
    source: mirror
  });
  assert.equal(ok('worker', 'next', f.root, {
    executor
  }).status, 'no-work');
  const second = path.join(f.base, 'profile-init');
  ok('init', null, second, undefined, {
    harness,
    profile: mirror
  });
  assert.deepEqual(fs.readFileSync(path.join(second, 'instance/golem.config.json')), configuration);
});

test('VF-4: invalid or reserved profile mirrors do not change installed bytes or HEAD', t => {
  const f = fixture(t),
    mirror = path.join(f.base, 'bad-mirror');
  fs.mkdirSync(path.join(mirror, 'memory'), {
    recursive: true
  });
  fs.writeFileSync(path.join(mirror, 'golem.config.json'), JSON.stringify({
    schema_version: 1,
    profile: {
      path: 'memory/graph.json'
    }
  }));
  fs.writeFileSync(path.join(mirror, 'memory/graph.json'), 'Not instructions');
  const before = git(f.instance, 'rev-parse', 'HEAD');
  refuse('profile_invalid', 'profile', 'install', f.root, undefined, {
    source: mirror
  });
  assert.equal(git(f.instance, 'rev-parse', 'HEAD'), before);
  assert.equal(f.read('memory/graph.json').claims.length, 0);
});

test('VF-6: bounded Windows sharing retries preserve atomic replacement and propagate other failures', () => {
  const waits = [];
  let attempts = 0;
  renameWithRetry('old', 'new', {
    platform: 'win32',
    rename: () => {
      if (attempts++ < 3) throw Object.assign(Error('busy'), {
        code: ['EPERM', 'EACCES', 'EBUSY'][attempts - 1]
      });
    },
    wait: ms => waits.push(ms)
  });
  assert.equal(attempts, 4);
  assert.deepEqual(waits, [10, 20, 40]);
  attempts = 0;
  assert.throws(() => renameWithRetry('a', 'b', {
    platform: 'win32',
    maxAttempts: 3,
    rename: () => {
      attempts++;
      throw Object.assign(Error('still busy'), {
        code: 'EBUSY'
      });
    },
    wait: () => {}
  }), /still busy/);
  assert.equal(attempts, 3);
  attempts = 0;
  assert.throws(() => renameWithRetry('a', 'b', {
    platform: 'linux',
    rename: () => {
      attempts++;
      throw Object.assign(Error('denied'), {
        code: 'EACCES'
      });
    }
  }), /denied/);
  assert.equal(attempts, 1);
});

test('VF-2: rebased adapter batches index metadata and exposes safe 0.9.x timings', async t => {
  const {
    createAdapter
  } = await import('../../lib/backend.mjs');
  const {
    analyze
  } = await import('../helpers.mjs');
  const f = fixture(t);
  f.submit();
  const adapter = createAdapter({
    instance: f.instance,
    harness,
    timings: true
  });
  const claim = await adapter.claim();
  analyze(f, {
    ...claim,
    claimed_at: new Date().toISOString(),
    journal_path: `memory/runs/${claim.run_id}.md`
  });
  const outputs = Array.from({
    length: 12
  }, (_, i) => `memory/events/perf-${i}.md`);
  for (const p of outputs) f.write(p, 'Synthetic performance event.');
  const result = await adapter.commit({
    run: claim.run_id,
    outputs
  });
  assert.equal(result.status, 'committed');
  assert(result.timings.git.commands['ls-tree'].calls <= 4, JSON.stringify(result.timings));
  assert(result.timings.git.commands['update-index'].calls <= 3, JSON.stringify(result.timings));
  assert.equal(result.timings.counts.claimed_sources, 1);
});
