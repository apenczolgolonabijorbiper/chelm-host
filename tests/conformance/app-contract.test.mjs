import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  fixture,
  ok,
  refuse,
  invoke,
  executor,
  analyze,
  git,
  harness
} from '../helpers.mjs';
test('APP-10..16/PAR-1..4: intake, exact headers, dedupe, receipt conflict and atomic refusal', t => {
  const f = fixture(t);
  let r = ok('submit', null, f.root, {
    subject_id: 'REC-1',
    groups: [{
      kind: 'record',
      lines: ['A', 'B'],
      receipt: {
        namespace: 'test',
        record: '1',
        revision: '1'
      }
    }]
  });
  assert.equal(r.written, 1);
  assert.equal(r.indexed, 1);
  const text = f.text('inbox/' + r.groups[0].observation_ids[0] + '.md');
  assert.match(text,
    /^---\nid: [a-f0-9-]+\nrecorded_at: .*Z\nkind: record\nsubject_id: REC-1\nchunk: 1\/1\n---\n\nA\nB\n$/
    );
  r = ok('submit', null, f.root, {
    subject_id: 'REC-1',
    groups: [{
      kind: 'record',
      lines: ['A', 'B']
    }]
  });
  assert.equal(r.written, 0);
  assert.equal(r.skipped_groups, 1);
  const count = fs.readdirSync(path.join(f.instance, 'inbox')).length;
  refuse('receipt_conflict', 'submit', null, f.root, {
    groups: [{
      kind: 'record',
      lines: ['changed'],
      receipt: {
        namespace: 'test',
        record: '1',
        revision: '1'
      }
    }]
  });
  refuse('record_too_long', 'submit', null, f.root, {
    groups: [{
      kind: 'record',
      lines: ['ok']
    }, {
      kind: 'record',
      lines: ['long long long'],
      max_chars: 8,
      oversize: 'refuse'
    }]
  });
  refuse('input_invalid', 'submit', null, f.root, {
    groups: [{
      kind: 'record',
      chunks: ['x'],
      extra_headers: {
        id: 'bad'
      }
    }]
  });
  assert.equal(fs.readdirSync(path.join(f.instance, 'inbox')).length, count);
});
test('APP-20..24/PAR-5..8: conversation limits, pending/retrieval and open-question answers', t => {
  const f = fixture(t);
  refuse('message_empty', 'ask', null, f.root, {
    text: ' '
  });
  refuse('message_too_long', 'ask', null, f.root, {
    text: 'a'.repeat(4001)
  });
  refuse('question_not_open', 'answer', null, f.root, {
    question_id: 'missing',
    text: 'x'
  });
  const pending = ok('ask', null, f.root, {
    text: 'What is known?'
  });
  assert.equal(pending.mode, 'pending');
  const c = ok('conversation', null, f.root);
  assert.equal(c.messages.length, 2);
  assert.equal(c.messages[0].observation_id, pending.observation_id);
});
test('APP-30..41: read views, inspection, lookup, counts, source-only transfer', t => {
  const f = fixture(t);
  const [id] = f.submit();
  for (const name of ['summary', 'observations', 'subjects', 'questions', 'answers', 'journals',
      'warnings', 'requests', 'delegations'
    ]) {
    const r = ok('read', name, f.root);
    assert.equal(r.view.schema_version, 1);
    assert(r.view.head);
  }
  const subject = ok('subject', 'S-1', f.root);
  assert.equal(subject.kinds.record.observed, 1);
  assert.equal(subject.kinds.record.indexed, 1);
  const exported = ok('export-sources', null, f.root, undefined, {
    subject: 'S-1'
  });
  assert.equal(exported.observation_count, 1);
  const second = path.join(f.base, 'second');
  ok('init', null, second, undefined, {
    harness
  });
  const imported = ok('import-sources', null, second, exported);
  assert.equal(imported.added, 1);
  assert.equal(imported.pending, 1);
  assert.equal(ok('status', null, second).counts.processed, 0);
  assert.equal(ok('import-sources', null, second, exported).present, 1);
  for (const metric of ['inbox', 'pending', 'evidence', 'processed', 'entities', 'claims', 'relations',
      'hypotheses', 'warnings', 'open-questions', 'lease', 'journals', 'last-cycle', 'validation',
      'conversation'
    ]) assert.equal(ok('inspect', metric, f.root).title, metric);
  refuse('invalid_id', 'get', 'observation', f.root);
});
test('APP-50..52/PAR-18: explicit request transitions, duplicate and kind bounds', t => {
  const f = fixture(t);
  const cfgPath = path.join(f.root, 'chelm.runtime.json'),
    cfg = JSON.parse(fs.readFileSync(cfgPath));
  cfg.requests.kinds = ['collect'];
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  const input = {
    executor,
    kind: 'collect',
    subject_id: 'S',
    reason: 'x'.repeat(400)
  };
  let r = ok('worker', 'propose', f.root, input);
  assert.equal(r.request.reason.length, 300);
  assert.equal(ok('worker', 'propose', f.root, input).duplicate, true);
  refuse('request_kind_unknown', 'worker', 'propose', f.root, {
    ...input,
    kind: 'execute'
  });
  ok('requests', 'set', f.root, undefined, {
    id: r.request.id,
    status: 'accepted'
  });
  ok('requests', 'set', f.root, undefined, {
    id: r.request.id,
    status: 'fulfilled'
  });
  refuse('request_transition_invalid', 'requests', 'set', f.root, undefined, {
    id: r.request.id,
    status: 'accepted'
  });
  assert.equal(ok('requests', 'list', f.root).requests.length, 1);
});
test('RT-10..12/PAR-19..23: canonical layout, busy reset, safe archive and incompatible adoption', t => {
  const f = fixture(t, {
    profile: true
  });
  assert(fs.existsSync(path.join(f.instance, 'instance/purpose.md')));
  f.submit();
  const claim = ok('worker', 'next', f.root, {
    executor
  });
  refuse('busy', 'reset', null, f.root, undefined, {
    scope: 'instance'
  });
  ok('worker', 'abandon', f.root, {
    executor,
    run_id: claim.work_unit.run_id
  });
  const reset = ok('reset', null, f.root, undefined, {
    scope: 'instance'
  });
  assert(fs.existsSync(path.join(reset.archived_to, 'instance/memory/graph.json')));
  assert.equal(ok('status', null, f.root).profile.selected, true);
  refuse('hard_reset_refused', 'reset', null, f.root, undefined, {
    scope: 'instance',
    hard: true
  });
  f.write('memory/graph.json', {
    schema_version: 1
  });
  const before = git(f.instance, 'rev-parse', 'HEAD');
  refuse('instance_incompatible', 'adopt', null, path.join(f.base, 'adopted'), undefined, {
    harness,
    instance: f.instance
  });
  assert.equal(git(f.instance, 'rev-parse', 'HEAD'), before);
});
test('APP-20/21/22: retrieved claims and committed answers are distinct from queued messages', t => {
  const f = fixture(t),
    ids = f.submit(),
    u = ok('worker', 'next', f.root, {
      executor
    }).work_unit;
  analyze(f, u);
  const queue = f.read('questions/queue.json'),
    qid = 'q-synthetic-1';
  queue.questions.push({
    id: qid,
    status: 'open',
    text: 'What changed?',
    source_observation_id: ids[0],
    created_at: new Date().toISOString(),
    analysis: {
      status: 'pending',
      source_observation_ids: [ids[0]]
    }
  });
  f.write('questions/queue.json', queue);
  f.write('questions/queue.md', '# Questions\n' + qid + ' What changed?\n');
  ok('worker', 'submit', f.root, {
    executor,
    run_id: u.run_id,
    outputs: []
  });
  assert.equal(ok('ask', null, f.root, {
    text: 'Synthetic'
  }).mode, 'retrieval');
  const answer = ok('answer', null, f.root, {
    question_id: qid,
    text: 'A synthetic follow-up.'
  });
  assert.equal(answer.mode, 'queued');
  assert.match(f.text('inbox/' + answer.observation_id + '.md'), /question_text: "What changed\?"/);
  assert.equal(ok('conversation', null, f.root).open_questions[0].id, qid);
});
test('APP-10/34: opaque subject IDs cannot collide with JavaScript object prototypes', t => {
  const f = fixture(t);
  for (const subject of ['__proto__', 'constructor', 'toString']) {
    const r = ok('submit', null, f.root, {
      subject_id: subject,
      groups: [{
        kind: 'constructor',
        chunks: ['Opaque identifiers remain data.']
      }]
    });
    assert.equal(r.written, 1);
    assert.equal(ok('subject', subject, f.root).kinds.constructor.observed, 1);
  }
});
