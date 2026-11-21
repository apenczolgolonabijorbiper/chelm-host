import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  createAdapter
} from '../../lib/backend.mjs';
import {
  fixture,
  ok,
  refuse,
  analyze,
  executor,
  git,
  harness
} from '../helpers.mjs';
test('NFR-8: post-CAS interruption recovers once and preserves unrelated drafts', async t => {
  const f = fixture(t);
  f.submit();
  const adapter = createAdapter({
    instance: f.instance,
    harness,
    hooks: {
      afterPublish({
        operation
      }) {
        if (operation.startsWith('complete')) throw Error('Injected publication interruption');
      }
    }
  });
  const claim = await adapter.claim();
  const u = {
    ...claim,
    journal_path: `memory/runs/${claim.run_id}.md`,
    claimed_at: new Date().toISOString()
  };
  analyze(f, u);
  f.write('scratch.md', 'Keep this unrelated draft');
  await assert.rejects(() => adapter.commit({
    run: claim.run_id
  }), /Injected/);
  assert.equal((await adapter.status()).recovery_required, true);
  const head = git(f.instance, 'rev-parse', 'HEAD');
  const next = ok('worker', 'next', f.root, {
    executor
  });
  assert.equal(next.status, 'no-work');
  assert.equal(git(f.instance, 'rev-parse', 'HEAD'), head);
  assert.equal((await adapter.status()).recovery_required, false);
  assert.equal(f.text('scratch.md'), 'Keep this unrelated draft');
});
test('HAR-4: compare-and-swap refuses concurrent HEAD movement and keeps the lease', async t => {
  const f = fixture(t);
  f.submit();
  const adapter = createAdapter({
    instance: f.instance,
    harness,
    hooks: {
      beforeCommit() {
        f.write('concurrent.md', 'Independent committed change');
        git(f.instance, 'add', 'concurrent.md');
        git(f.instance, '-c', 'user.name=Synthetic', '-c', 'user.email=test@local', 'commit', '-qm',
          'Concurrent writer');
      }
    }
  });
  const claim = await adapter.claim();
  analyze(f, {
    ...claim,
    journal_path: `memory/runs/${claim.run_id}.md`,
    claimed_at: new Date().toISOString()
  });
  await assert.rejects(() => adapter.commit({
    run: claim.run_id
  }), /Head changed/);
  assert.equal((await adapter.status()).lease.run_id, claim.run_id);
  assert.equal(f.read('memory/processed.json').observations.length, 0);
});
test('RT-11/TST-7: in-place adoption preserves Git HEAD and imports missing-key/orphaned stores', t => {
  const f = fixture(t),
    ids = f.submit('Subject'),
    store = path.join(f.base, 'Subject.json');
  fs.writeFileSync(store, JSON.stringify({
    entries: [{
      kind: 'record',
      ids,
      createdAt: new Date().toISOString()
    }, {
      kind: 'missing',
      ids: ['00000000-0000-4000-8000-000000000099']
    }]
  }));
  const conversation = path.join(f.base, 'old.jsonl');
  fs.writeFileSync(conversation, JSON.stringify({
    at: new Date().toISOString(),
    role: 'user',
    text: 'Synthetic',
    observationId: ids[0],
    questionId: ''
  }) + '\n');
  const before = git(f.instance, 'rev-parse', 'HEAD'),
    runtime = path.join(f.base, 'adopted');
  const adopted = ok('adopt', null, runtime, undefined, {
    harness,
    instance: f.instance,
    'intake-stores': store,
    conversation
  });
  assert.equal(adopted.orphaned_groups, 1);
  assert.equal(git(f.instance, 'rev-parse', 'HEAD'), before);
  assert.equal(ok('conversation', null, runtime).messages[0].observation_id, ids[0]);
  const resubmit = ok('submit', null, runtime, {
    subject_id: 'Subject',
    groups: [{
      kind: 'record',
      lines: ['Zażółć gęślą jaźń. Synthetic record.']
    }]
  });
  assert.equal(resubmit.written, 0);
  f.write('memory/processing-lock.json', {
    schema_version: 1,
    status: 'error',
    observation_ids: []
  });
  refuse('recovery_required', 'adopt', null, path.join(f.base, 'refused'), undefined, {
    harness,
    instance: f.instance
  });
});
