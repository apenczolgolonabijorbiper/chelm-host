import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, ok, refuse, harness, executor, git } from '../helpers.mjs';
import { note, contentKey, chunks } from '../../lib/intake.mjs';
import { propose } from '../../lib/requests.mjs';
import { config } from '../../lib/runtime.mjs';

test('PAR-1..5: fixed byte-format/chunk/key fixtures, exactly one indexing pass and message limits', t => {
  const f = fixture(t), expected = JSON.parse(fs.readFileSync(new URL('./protocol.expected.json', import.meta.url)));
  assert.equal(note(expected.note.input), expected.note.output);
  assert.deepEqual(chunks(expected.chunks.lines, expected.chunks.max_chars), expected.chunks.output);
  assert.equal(contentKey(expected.content_key.kind, expected.content_key.bodies), expected.content_key.value);
  const trace = path.join(f.base, 'children.jsonl'), previous = process.env.CHELM_TIMINGS_FILE;
  t.after(() => { if (previous === undefined) delete process.env.CHELM_TIMINGS_FILE; else process.env.CHELM_TIMINGS_FILE = previous; });
  fs.writeFileSync(trace, ''); process.env.CHELM_TIMINGS_FILE = trace;
  const input = { subject_id: 'fixed', groups: [{ kind: 'record', chunks: ['First.', 'Second.'] }] };
  assert.equal(ok('submit', null, f.root, input).indexed, 2);
  const indexed = () => fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r => r.kind === 'indexer').length;
  assert.equal(indexed(), expected.indexer_passes_per_submission);
  assert.equal(ok('submit', null, f.root, input).written, 0); assert.equal(indexed(), 1);
  refuse('message_empty', 'ask', null, f.root, { text: '' });
  refuse('message_too_long', 'ask', null, f.root, { text: 'x'.repeat(expected.max_message_chars + 1) });
  assert.equal(ok('ask', null, f.root, { text: 'x'.repeat(expected.max_message_chars) }).mode, 'pending');
});

test('PAR-18/19/21/22/23: fixed request/claim bounds, archived baseline and safe sandbox recreation', t => {
  const f = fixture(t), expected = JSON.parse(fs.readFileSync(new URL('./protocol.expected.json', import.meta.url)));
  const p = path.join(f.root, 'chelm.runtime.json'), cfg = JSON.parse(fs.readFileSync(p));
  cfg.requests.kinds = Array.from({ length: expected.request_limit + 1 }, (_, i) => 'collect-' + i);
  fs.writeFileSync(p, JSON.stringify(cfg));
  for (let i = 0; i < expected.request_limit; i++) {
    const r = propose(f.root, config(f.root), { kind: cfg.requests.kinds[i], subject_id: 'S', reason: 'r'.repeat(301) });
    assert.equal(r.request.reason.length, expected.reason_limit);
  }
  assert.throws(() => propose(f.root, config(f.root), { kind: cfg.requests.kinds.at(-1), subject_id: 'S', reason: 'extra' }), { code: 'request_limit' });
  const sent = ok('submit', null, f.root, { groups: [{ kind: 'record', chunks: Array.from({ length: 21 }, (_, i) => 'Synthetic ' + i) }] });
  assert.equal(ok('worker', 'next', f.root, { executor }).status, 'no-work');
  for (const id of sent.groups[0].observation_ids) {
    f.write('inbox/' + id + '.md', f.text('inbox/' + id + '.md').replace(/^recorded_at: .*$/m, 'recorded_at: 2020-01-01T00:00:00.000Z'));
    fs.rmSync(path.join(f.instance, 'evidence', id + '.json'), { force: true });
  }
  ok('index', null, f.root);
  const claimStarted = Date.now();
  const unit = ok('worker', 'next', f.root, { executor }).work_unit;
  const claimEnded = Date.now();
  assert.equal(unit.sources.length, expected.max_sources);
  const lease = f.read('memory/processing-lock.json');
  // Claim and expiry use separate clock reads. Bound the expiry by the actual
  // command interval instead of requiring millisecond-identical reads.
  assert(Date.parse(lease.expires_at) >= claimStarted + expected.lease_ms);
  assert(Date.parse(lease.expires_at) <= claimEnded + expected.lease_ms);
  ok('worker', 'abandon', f.root, { executor, run_id: unit.run_id });
  const reset = ok('reset', null, f.root, undefined, { scope: 'instance' });
  assert.match(path.basename(reset.archived_to), /^instance-\d{8}-\d{6}$/);
  assert.equal(fs.readdirSync(path.join(f.instance, 'inbox')).length, 0);
  assert.match(git(f.instance, 'log', '-1', '--format=%s'), /^init:/);
  assert.equal(fs.existsSync(path.join(f.instance, 'instance/purpose.md')), true);
  assert.equal(fs.existsSync(path.join(f.instance, 'memory/hypotheses.json')), true);
  const sandbox = path.join(f.base, 'sandbox', 'runtime');
  ok('init', null, sandbox, undefined, { harness, sandbox: true });
  fs.writeFileSync(path.join(sandbox, 'discard-me.txt'), 'Disposable sandbox data.');
  ok('reset', null, sandbox, undefined, { scope: 'instance', hard: true });
  assert.equal(fs.existsSync(path.join(sandbox, 'discard-me.txt')), false);
  assert.equal(ok('status', null, sandbox).sandbox.resettable, true);
});
