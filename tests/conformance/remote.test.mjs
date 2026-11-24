import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { fixture, executor, ok, refuse, git, analyze } from '../helpers.mjs';
import { remoteCall } from '../../lib/remote.mjs';
import { startServer } from '../../lib/remote-server.mjs';
import { hash, read, file } from '../../lib/util.mjs';
import { cutover } from '../../lib/cutover.mjs';

import { call, workArgs, artifacts, prepare, finish } from '../remote-helpers.mjs';

test('remote contract: immutable artifacts, idempotent assignment/publication, ownership, retry and local coordination', async (t) => {
  const f = fixture(t);
  f.submit();
  const run = call(f),
    request = { executor, request_id: randomUUID(), max: 1 };
  const w = await run('chelm_request_work', request);
  assert.equal(w.status, 'assigned');
  assert.equal(w.guidance_identity.length, 64);
  assert.equal((await run('chelm_request_work', request)).work_id, w.work_id);
  assert.equal(ok('worker', 'next', f.root, { executor }).status, 'no-work');
  assert.equal(f.read('memory/processing-lock.json').status, 'idle'); // inference holds no live lease
  await assert.rejects(call(f, 'other')('chelm_work_status', workArgs(w)), {
    code: 'work_not_owned'
  });
  await assert.rejects(run('chelm_read_artifact', { ...workArgs(w), artifact_id: '../secret' }), {
    code: 'artifact_unknown'
  });
  await run('chelm_renew_work', workArgs(w));
  const c = await prepare(run, w),
    v = await run('chelm_validate_candidate', c),
    args = { ...c, candidate_digest: v.candidate_digest, submission_id: randomUUID() };
  const result = await run('chelm_submit_candidate', args);
  assert.equal(result.status, 'committed');
  assert.equal(
    (await remoteCall(f.root, 'worker-b', 'chelm_submit_candidate', args)).head,
    result.head
  );
  assert.equal(ok('read', 'summary', f.root).view.processed, 1);
  assert.equal((await run('chelm_list_work')).work.length, 1);
  await assert.rejects(run('chelm_submit_candidate', { ...args, submission_id: 'different' }), {
    code: 'idempotency_conflict'
  });
  refuse('contract_removed', 'delegate', 'offer', f.root, {});
});

test('remote contract: validation repair, expiry, policy drift and chunk refusal', async (t) => {
  const f = fixture(t);
  f.submit();
  const run = call(f),
    w = await run('chelm_request_work', { executor, request_id: randomUUID() });
  const bad = await prepare(run, w, { bad: true });
  await assert.rejects(run('chelm_validate_candidate', bad), { code: 'validation_failed' });
  const c = await prepare(run, w);
  await run('chelm_validate_candidate', c);
  const slot = w.output_slots[0];
  await assert.rejects(
    run('chelm_stage_output', {
      ...workArgs(w),
      slot_id: slot.slot_id,
      revision: 3,
      offset: 1,
      text: 'x',
      final: true
    }),
    { code: 'upload_conflict' }
  );
  f.write('instance/purpose.md', 'Changed purpose.');
  git(f.instance, 'add', 'instance/purpose.md');
  git(
    f.instance,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@local',
    'commit',
    '-qm',
    'policy change'
  );
  await assert.rejects(run('chelm_validate_candidate', c), { code: 'policy_changed' });
  const p = path.join(f.root, 'host/remote/work', w.work_id, 'record.json'),
    a = JSON.parse(fs.readFileSync(p));
  a.expires_at = '2000-01-01T00:00:00Z';
  fs.writeFileSync(p, JSON.stringify(a));
  assert.equal((await run('chelm_work_status', workArgs(w))).status, 'expired');
  await assert.rejects(run('chelm_renew_work', workArgs(w)), { code: 'work_inactive' });
});

test('remote concurrent batches: moved-head merge and remote integration review', async (t) => {
  const f = fixture(t);
  const ids = f.submit();
  f.submit('S-2', 'Second synthetic source.');
  const cfgPath = path.join(f.root, 'chelm.runtime.json'),
    cfg = JSON.parse(fs.readFileSync(cfgPath));
  cfg.remote.max_active_work = 2;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  const b = call(f),
    c = call(f, 'worker-c');
  const wb = await b('chelm_request_work', { executor, request_id: randomUUID(), max: 1 }),
    wc = await c('chelm_request_work', { executor, request_id: randomUUID(), max: 1 });
  assert.notEqual(wb.sources[0].id, wc.sources[0].id);
  assert.equal((await finish(b, wb)).status, 'committed');
  const merged = await finish(c, wc);
  assert.equal(merged.status, 'integration-required');
  assert.equal(merged.work_unit.kind, 'integration');
  await assert.rejects(c('chelm_renew_work', workArgs(wc)), { code: 'stale_attempt' });
  const done = await finish(c, merged.work_unit);
  assert.equal(done.status, 'committed');
  assert.equal(f.read('memory/graph.json').claims.length, 2);
  assert.equal(ok('read', 'summary', f.root).view.processed, 2);
});

test('MCP Streamable HTTP: official client, auth, runtime scope and remote cycle', async (t) => {
  const f = fixture(t);
  f.submit();
  const token = 'synthetic-test-only-credential-0123456789';
  const server = await startServer(
    {
      port: 0,
      public_url: 'http://127.0.0.1/mcp',
      development: true,
      runtimes: { myapp: f.root },
      auth: {
        mode: 'worker-tokens',
        workers: [{ principal: 'worker-b', runtimes: ['myapp'], token_env: 'TEST_WORKER_TOKEN' }]
      }
    },
    { env: { TEST_WORKER_TOKEN: token } }
  );
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 401);
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token, Origin: 'https://evil.invalid' },
        body: '{}'
      })
    ).status,
    403
  );
  assert.equal(
    (
      await fetch(url + '/forbidden', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: '{}'
      })
    ).status,
    403
  );
  const client = new Client({ name: 'chelm-test-agent', version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: 'Bearer ' + token } }
    })
  );
  t.after(() => client.close());
  assert.equal((await client.listTools()).tools.length, 25);
  assert.equal((await client.listPrompts()).prompts.length, 7);
  assert(
    (await client.getPrompt({ name: 'chelm_remote_loop' })).messages[0].content.text.includes(
      'RemoteGolemWorker'
    )
  );
  const run = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    const v = JSON.parse(result.content[0].text);
    assert.equal(v.ok, true, JSON.stringify(v));
    return v;
  };
  const w = await run('chelm_request_work', { executor, request_id: randomUUID() });
  assert.equal((await finish(run, w)).status, 'committed');
});

test('cutover preflight: retain memory, archive legacy metadata, explicit cancellation', async (t) => {
  const f = fixture(t),
    p = path.join(f.root, 'chelm.runtime.json'),
    cfg = JSON.parse(fs.readFileSync(p)),
    before = git(f.instance, 'rev-parse', 'HEAD');
  cfg.schema_version = 1;
  delete cfg.remote;
  cfg.delegation = {
    enabled: true,
    share_root: 'not-accessed',
    participants: [],
    reservation_hours: 8
  };
  fs.writeFileSync(p, JSON.stringify(cfg));
  fs.mkdirSync(path.join(f.root, 'host/delegation'), { recursive: true });
  fs.writeFileSync(
    path.join(f.root, 'host/delegation/packages.json'),
    JSON.stringify([{ package_id: randomUUID(), status: 'returned' }])
  );
  assert.equal((await cutover(f.root)).unsettled.length, 1);
  await assert.rejects(cutover(f.root, { apply: true }), { code: 'legacy_work_pending' });
  const result = await cutover(f.root, { apply: true, cancel_legacy: true });
  assert.equal(result.changed, true);
  assert(fs.existsSync(path.join(result.archive, 'chelm.runtime.json')));
  assert.equal(git(f.instance, 'rev-parse', 'HEAD'), before);
  assert.equal(ok('status', null, f.root).exists, true);
});

test('owner publication recovery: durable receipt after CAS, preserve unrelated drafts', async (t) => {
  const { config } = await import('../../lib/runtime.mjs');
  const { publishTree, reconcilePublication } = await import('../../lib/publication.mjs');
  const { snapshot } = await import('../../lib/util.mjs');
  const f = fixture(t);
  f.submit();
  const run = call(f),
    w = await run('chelm_request_work', { executor, request_id: randomUUID() }),
    cfg = config(f.root),
    head = git(f.instance, 'rev-parse', 'HEAD'),
    tree = snapshot(f.instance);
  tree.set('memory/index.md', Buffer.from('# Recovered publication\n'));
  f.write('unrelated.md', 'Keep this draft.');
  assert.throws(
    () =>
      publishTree(
        f.root,
        cfg,
        head,
        tree,
        { work_id: w.work_id, candidate_digest: hash('fixture') },
        {
          afterCAS() {
            throw Error('synthetic interruption');
          }
        }
      ),
    /interruption/
  );
  assert.equal(f.text('memory/index.md').includes('Recovered'), false);
  reconcilePublication(f.root, cfg);
  assert.equal(f.text('memory/index.md'), '# Recovered publication\n');
  assert.equal(f.text('unrelated.md'), 'Keep this draft.');
  assert.equal(
    (await run('chelm_work_status', workArgs(w))).receipt.head,
    git(f.instance, 'rev-parse', 'HEAD')
  );
  reconcilePublication(f.root, cfg);
});

test('remote context artifact manifest pages; forbidden slots and changed sources refuse', async (t) => {
  const f = fixture(t);
  f.submit();
  const run = call(f),
    w = await run('chelm_request_work', { executor, request_id: randomUUID() });
  const manifest = await run('chelm_list_artifacts', { ...workArgs(w), limit: 1 });
  assert.equal(manifest.artifacts.length, 1);
  assert.equal(manifest.next_offset, 1);
  const source = await run('chelm_list_artifacts', {
    ...workArgs(w),
    observation_id: w.sources[0].id
  });
  assert.equal(source.artifacts.length, 1);
  await assert.rejects(
    run('chelm_stage_output', {
      ...workArgs(w),
      slot_id: randomUUID(),
      revision: 1,
      text: 'evil',
      final: true
    }),
    { code: 'bad_outputs' }
  );
  const c = await prepare(run, w);
  const p = source.artifacts[0].path;
  f.write(p, f.text(p) + 'Changed.');
  await assert.rejects(run('chelm_validate_candidate', c), { code: 'source_changed' });
});

test('OAuth JWT worker authorization verifies signature, issuer, audience, scope and expiry', async () => {
  const { verifyWorkerJwt } = await import('../../lib/remote-server.mjs');
  const { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK } = await import('jose');
  const { privateKey, publicKey } = await generateKeyPair('RS256'),
    jwk = await exportJWK(publicKey);
  jwk.kid = 'test';
  const keys = createLocalJWKSet({ keys: [jwk] });
  const auth = {
    issuer: 'https://issuer.example/',
    audience: 'https://golem.example/mcp',
    workers: [{ principal: 'worker-b', runtimes: ['myapp'] }]
  };
  const sign = (scope = 'chelm:worker', audience = auth.audience, expiry = '1h', issuer = auth.issuer, subject = 'worker-b') =>
    new SignJWT({ scope })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .setSubject(subject)
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime(expiry)
      .sign(privateKey);
  assert.equal(await verifyWorkerJwt(await sign(), auth, keys), 'worker-b');
  assert.equal(await verifyWorkerJwt(await sign('other'), auth, keys), null);
  assert.equal(await verifyWorkerJwt(await sign('chelm:worker', 'other'), auth, keys), null);
  assert.equal(
    await verifyWorkerJwt(await sign('chelm:worker', auth.audience, '-1s'), auth, keys),
    null
  );
  assert.equal(await verifyWorkerJwt('tampered', auth, keys), null);
  assert.equal(await verifyWorkerJwt(await sign('chelm:worker', auth.audience, '1h', 'https://wrong-issuer.example/'), auth, keys), null);
  assert.equal(await verifyWorkerJwt(await sign('chelm:worker', auth.audience, '1h', auth.issuer, 'unknown-worker'), auth, keys), null);
  const revoked = { ...auth, workers: [] };
  assert.equal(await verifyWorkerJwt(await sign(), revoked, keys), null);
});

test('remote SudoLang prompts name only shipped tools and runner passes one-cycle prompt', async (t) => {
  const { remoteToolSchemas } = await import('../../lib/remote-tools.mjs');
  const { source } = await import('../helpers.mjs');
  const { spawn } = await import('node:child_process');
  for (const name of [
    'remote-worker-once.sudo.md',
    'remote-worker-loop.sudo.md',
    'remote-integration.sudo.md'
  ]) {
    const text = fs.readFileSync(path.join(source, 'prompts', name), 'utf8');
    for (const tool of text.match(/chelm_[a-z_]+/g) ?? [])
      assert(Object.hasOwn(remoteToolSchemas, tool), tool);
  }
  const f = fixture(t),
    config = path.join(f.base, 'runner.json');
  fs.writeFileSync(
    config,
    JSON.stringify({
      command: process.execPath,
      args: [
        '-e',
        "let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>{if(!s.includes('RemoteGolemWorker'))process.exitCode=1;});"
      ],
      max_cycles: 1,
      interval_seconds: 5,
      cycle_timeout_seconds: 5
    })
  );
  const child = spawn(
    process.execPath,
    [path.join(source, 'tools/run-remote-agent.mjs'), '--config', config],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let err = '';
  child.stderr.on('data', (b) => (err += b));
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(code, 0, err);
});

test('stdio bridge exposes remote tools through a separate Node process', async (t) => {
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const { source } = await import('../helpers.mjs');
  const f = fixture(t),
    secret = 'synthetic-bridge-test-only-token-0123456789';
  const server = await startServer(
    {
      port: 0,
      public_url: 'http://127.0.0.1/mcp',
      development: true,
      runtimes: { myapp: f.root },
      auth: {
        mode: 'worker-tokens',
        workers: [{ principal: 'bridge-worker', runtimes: ['myapp'], token_env: 'BRIDGE_TOKEN' }]
      }
    },
    { env: { BRIDGE_TOKEN: secret } }
  );
  const client = new Client({ name: 'bridge-test', version: '1' });
  t.after(async () => {
    await client.close();
    await new Promise((resolve) => server.close(resolve));
  });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [
      path.join(source, 'bin/chelm-remote-mcp.mjs'),
      '--url',
      `http://127.0.0.1:${server.address().port}/mcp`,
      '--token-env',
      'BRIDGE_TOKEN'
    ],
    env: { ...process.env, BRIDGE_TOKEN: secret },
    stderr: 'pipe'
  });
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 25);
  const r = await client.callTool({ name: 'chelm_list_work', arguments: {} });
  assert.equal(JSON.parse(r.content[0].text).ok, true);
  // The bridge intentionally forwards worker tools only; native HTTP clients also get MCP prompts.
});

test('remote moved-head record conflict refuses publication and records an owner-visible diagnostic', async (t) => {
  const f = fixture(t);
  f.submit();
  const u = ok('worker', 'next', f.root, { executor }).work_unit;
  analyze(f, u);
  ok('worker', 'submit', f.root, { executor, run_id: u.run_id, outputs: [] });
  f.submit('L', 'Left observation.');
  f.submit('R', 'Right observation.');
  const p = path.join(f.root, 'chelm.runtime.json'),
    cfg = JSON.parse(fs.readFileSync(p));
  cfg.remote.max_active_work = 2;
  fs.writeFileSync(p, JSON.stringify(cfg));
  const b = call(f),
    c = call(f, 'worker-c'),
    wb = await b('chelm_request_work', { executor, request_id: randomUUID(), max: 1 }),
    wc = await c('chelm_request_work', { executor, request_id: randomUUID(), max: 1 });
  async function complete(run, w, value) {
    const candidate = await prepare(run, w, { externalValue: value }),
      v = await run('chelm_validate_candidate', candidate);
    return run('chelm_submit_candidate', {
      ...candidate,
      candidate_digest: v.candidate_digest,
      submission_id: randomUUID()
    });
  }
  assert.equal((await complete(b, wb, 'left')).status, 'committed');
  await assert.rejects(complete(c, wc, 'right'), { code: 'merge_conflict' });
  assert.equal(f.read('memory/graph.json').claims.length, 2);
  const record = JSON.parse(
    fs.readFileSync(path.join(f.root, 'host/remote/work', wc.work_id, 'record.json'))
  );
  assert.equal(record.last_error.code, 'merge_conflict');
});

test('remote assignment preserves CRLF reviewed guidance despite committed Git attributes', async (t) => {
  const f = fixture(t);
  f.write('.gitattributes', '*.md text eol=lf\n');
  git(f.instance, 'add', '.gitattributes');
  git(
    f.instance,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@local',
    'commit',
    '-qm',
    'attributes'
  );
  const mirror = path.join(f.base, 'reviewed-source');
  fs.mkdirSync(path.join(mirror, 'profiles'), { recursive: true });
  fs.writeFileSync(
    path.join(mirror, 'golem.config.json'),
    JSON.stringify({ schema_version: 1, profile: { path: 'profiles/core.md' } })
  );
  const core = '# Reviewed guidance\r\nPreserve exact bytes. Żółć.\r\n';
  fs.writeFileSync(path.join(mirror, 'profiles/core.md'), core);
  fs.writeFileSync(path.join(mirror, 'purpose.md'), 'Synthetic purpose.\r\n');
  ok('profile', 'install', f.root, undefined, { source: mirror });
  f.submit();
  const run = call(f),
    w = await run('chelm_request_work', { executor, request_id: randomUUID() });
  const values = await artifacts(run, w);
  assert.equal(values['profiles/core.md'], core);
  assert.equal(values['instance/purpose.md'], 'Synthetic purpose.\r\n');
  await run('chelm_abandon_work', workArgs(w));
});

test('0.10 guidance rejects invalid declarative vocabulary before remote assignment', async (t) => {
  const f = fixture(t, { profile: true });
  f.submit();
  f.write('profiles/vocabulary.json', {
    schema_version: 2,
    kinds: ['record'],
    predicates: ['describes'],
    single_valued: ['outside']
  });
  git(f.instance, 'add', 'profiles/vocabulary.json');
  git(
    f.instance,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@local',
    'commit',
    '-qm',
    'invalid policy fixture'
  );
  await assert.rejects(
    call(f)('chelm_request_work', { executor, request_id: randomUUID() }),
    /Single-valued predicate outside vocabulary/
  );
  assert.equal(f.read('memory/processing-lock.json').status, 'idle');
});
