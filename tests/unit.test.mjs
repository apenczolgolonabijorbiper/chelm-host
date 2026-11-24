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
      'a//b'
    ]) assert.throws(() => relative(p));
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chelm-path-'));
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
test('NFR-5: conversation tail reads bounded blocks and preserves UTF-8', t => {
  const p = path.join(fs.realpathSync(os.tmpdir()), 'chelm-tail-' + process.pid);
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
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chelm-lock-'));
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

test('CON-2: launching a CLI through an OS path alias still emits JSON', async t => {
  const {
    spawnSync
  } = await import('node:child_process');
  const {
    source
  } = await import('./helpers.mjs');
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chelm-entry-'));
  t.after(() => fs.rmSync(base, {
    recursive: true,
    force: true
  }));
  const alias = path.join(base, 'alias');
  try {
    fs.symlinkSync(source, alias, 'dir');
  } catch (e) {
    if (e.code === 'EPERM') return;
    throw e;
  }
  const r = spawnSync(process.execPath, [path.join(alias, 'bin/chelm.mjs'), 'version'], {
    encoding: 'utf8'
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).package_version, '1.2.0');
});


test('NFR-1: unloaded Windows profiles use the actual OS SID and fail closed on lookup errors', async () => {
  const {
    resolveActor
  } = await import('../lib/util.mjs');
  const missing = () => {
    throw Object.assign(Error('uv_os_get_passwd ENOMEM'), {
      code: 'ERR_SYSTEM_ERROR'
    });
  };
  const whoami = () => ({
    status: 0,
    stdout: '"iis apppool\\synthetic","S-1-5-82-123-456"\r\n'
  });
  assert.equal(resolveActor({
    platform: 'win32',
    userInfo: missing,
    whoami
  }), 'S-1-5-82-123-456');
  assert.equal(resolveActor({
    platform: 'win32',
    userInfo: () => ({
      username: 'ordinary-user'
    }),
    whoami
  }), 'ordinary-user');
  assert.throws(() => resolveActor({
    platform: 'win32',
    userInfo: missing,
    whoami: () => ({
      status: 1,
      stdout: 'untrusted-name'
    })
  }), e => e.code === 'identity_unavailable');
  assert.throws(() => resolveActor({
    platform: 'linux',
    userInfo: missing,
    whoami
  }), /ENOMEM/);
});
