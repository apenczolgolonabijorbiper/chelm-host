import test from '../scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fixture, ok, refuse, git } from '../helpers.mjs';
import { leaseState } from '../../lib/read-model.mjs';

test('PAR-12/13/15/20/22: fixed lease, inspection, lookup, baseline and sandbox boundaries', t => {
  const expected = JSON.parse(fs.readFileSync(new URL('./boundaries.expected.json', import.meta.url)));
  assert.equal(leaseState({ status: 'idle' }).state, expected.lease.idle);
  assert.equal(leaseState({ status: 'processing', expires_at: '2000-01-01T00:00:00.000Z' }).state, expected.lease.expired);
  assert.equal(leaseState({ status: 'processing', expires_at: '2999-01-01T00:00:00.000Z' }).state, expected.lease.held);
  const f = fixture(t), baseline = ok('admin-stats', null, f.root);
  assert.deepEqual(baseline.files, []);
  assert.equal(baseline.rows.find(r => r.label === 'instance_commits').value, 0);
  const run = '00000000-0000-4000-8000-000000000901', journal = `memory/runs/${run}.md`;
  f.write(journal, 'J'.repeat(expected.journal_limit + 1));
  git(f.instance, 'add', journal);
  git(f.instance, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'fixed parity boundary');
  assert.equal(ok('get', 'journal', f.root, { id: run + '.md' }).text.length, expected.journal_limit);
  const admin = ok('admin-stats', null, f.root);
  assert.deepEqual(admin.files, [journal]); assert(admin.latest.endsWith('Z'));
  assert.equal(admin.rows.find(r => r.label === 'instance_commits').value, 1);
  for (const [kind, id] of [['item', 'ent-invalid'], ['journal', '../secret.md'], ['observation', '../secret']])
    refuse('invalid_id', 'get', kind, f.root, { id });
  const [id] = f.submit(); f.write(`inbox/${id}.md`, f.text(`inbox/${id}.md`) + 'x'.repeat(expected.observation_limit));
  assert.equal(ok('get', 'observation', f.root, { id }).inbox.length, expected.observation_limit);
  // Published-view fixture exercises presentation bounds independently of validator warning limits.
  const warnings = path.join(f.root, 'host/read-model/warnings.json'), data = JSON.parse(fs.readFileSync(warnings));
  data.data = Array.from({ length: expected.inspection_rows + 1 }, (_, n) => ({ code: 'synthetic', message: 'x'.repeat(expected.inspection_cell + 1), n }));
  fs.writeFileSync(warnings, JSON.stringify(data));
  const table = ok('inspect', 'warnings', f.root);
  assert.equal(table.rows.length, expected.inspection_rows); assert.equal(table.total, expected.inspection_rows + 1);
  assert.equal(table.truncated, true); assert(table.rows.flat().every(cell => cell.length <= expected.inspection_cell));
  refuse('hard_reset_refused', 'reset', null, f.root, undefined, { scope: 'instance', hard: true });
});
