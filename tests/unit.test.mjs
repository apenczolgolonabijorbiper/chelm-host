import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  chunks,
  contentKey,
  note
} from '../lib/intake.mjs';
import {
  keyed,
  mergeGraph
} from '../lib/merge.mjs';
import {
  relative,
  file,
  tail,
  lock,
  write
} from '../lib/util.mjs';
import {
  parse
} from '../bin/chelm.mjs';
test('APP-11/12: parity chunking and byte identity', () => {
  assert.deepEqual(chunks(['abcd', 'efgh'], 8), ['abcd\n', 'efgh\n']);
  assert.deepEqual(chunks(['abcdefghijk'], 8), ['abcd ...\n']);
  assert.throws(() => chunks(['abcdefghijk'], 8, 'refuse'), e => e.code === 'record_too_long');
  assert.equal(contentKey('note', [' x\r\n']), contentKey('note', ['x']));
  assert.notEqual(contentKey('a', ['x']), contentKey('b', ['x']));
});
test('SEC-2: paths reject traversal, drives, reserved Git and links', t => {
  for (const p of ['../a', 'a/../b', 'a\\b', 'C:/a', '.git/config', 'x/.GIT/config', '/etc/passwd',
      'a//b']) assert.throws(() => relative(p));
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'chelm-path-'));
  t.after(() => fs.rmSync(base, {
    recursive: true,
    force: true
  }));
  fs.mkdirSync(path.join(base, 'real'));
  try {
    fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'), 'dir');
    assert.throws(() => file(base, 'link/a'));
  } catch (e) {
    if (e.code !== 'EPERM') throw e;
  }
});
test('DST-32: keyed conflicts, removals, append-only entity identifiers and retained claims', () => {
  const base = [{
    id: 'e',
    label: 'a',
    source_ids: ['a'],
    external_ids: []
  }];
  assert.deepEqual(keyed(base, [{
    ...base[0],
    source_ids: ['a', 'b']
  }], [{
    ...base[0],
    source_ids: ['a', 'c']
  }], 'entities')[0].source_ids, ['a', 'b', 'c']);
  assert.throws(() => keyed(base, [], base), e => e.code === 'merge_conflict');
  assert.throws(() => keyed(base, [{
    ...base[0],
    label: 'b'
  }], [{
    ...base[0],
    label: 'c'
  }]), e => e.code === 'merge_conflict');
  assert.throws(() => keyed([{
    id: 'c',
    predicate: 'a',
    status: 'active'
  }], [{
    id: 'c',
    predicate: 'b',
    status: 'active'
  }], [{
    id: 'c',
    predicate: 'a',
    status: 'active'
  }], 'claims'), e => e.code === 'merge_conflict');
});
test('NFR-5: conversation tail reads bounded blocks and preserves UTF-8', t => {
  const p = path.join(os.tmpdir(), 'chelm-tail-' + process.pid);
  t.after(() => fs.rmSync(p, {
    force: true
  }));
  fs.writeFileSync(p, Array.from({
    length: 100000
  }, (_, n) => JSON.stringify({
    n,
    text: 'żółć'
  })).join('\n') + '\n');
  const rows = tail(p, 200);
  assert.equal(rows.length, 200);
  assert.equal(rows[0].n, 99800);
  assert.equal(rows.at(-1).text, 'żółć');
});
test('NFR-6: exclusive cross-process operation lock refuses a second caller', async t => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'chelm-lock-'));
  t.after(() => fs.rmSync(base, {
    recursive: true,
    force: true
  }));
  write(path.join(base, 'chelm.runtime.json'), {});
  await lock(base, 'test', async () => {
    await assert.rejects(() => lock(base, 'second', async () => {}), e => e.code === 'busy');
  });
});
test('CON-1: CLI rejects duplicate/incomplete flags', () => {
  assert.throws(() => parse(['status', '--runtime']));
  assert.throws(() => parse(['status', '--runtime', 'a', '--runtime', 'b']));
});
