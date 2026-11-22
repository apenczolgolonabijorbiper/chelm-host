import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fixture, executor, git } from '../helpers.mjs';
import { call, workArgs, prepare, finish } from '../remote-helpers.mjs';
import { CHUNK_BYTES, MAX_BYTES } from '../../lib/remote.mjs';
import { hash } from '../../lib/util.mjs';

test('remote upload boundaries: Unicode byte offsets, truncation, concurrent retries and quota refusal', async t => {
  const f = fixture(t); f.submit();
  const run = call(f), w = await run('chelm_request_work', { executor, request_id: randomUUID() });
  const args = { ...workArgs(w), slot_id: w.output_slots[0].slot_id, revision: 1 };
  const text = 'ż😀'.repeat(4000); // 24,000 UTF-8 bytes, 12,000 UTF-16 units
  const first = await run('chelm_stage_output', { ...args, text, final: false });
  assert.equal(first.next_offset, Buffer.byteLength(text));
  await assert.rejects(run('chelm_validate_candidate', { ...workArgs(w), outputs: [{ slot_id: args.slot_id, revision: 1 }] }), { code: 'digest_mismatch' });
  await assert.rejects(run('chelm_stage_output', { ...args, offset: text.length, text: 'wrong offset' }), { code: 'upload_conflict' });
  await assert.rejects(run('chelm_stage_output', { ...args, offset: first.next_offset, text: '\uD800' }), { code: 'input_invalid' });
  await assert.rejects(run('chelm_stage_output', { ...args, offset: first.next_offset, text: 'a'.repeat(CHUNK_BYTES + 1) }), { code: 'input_invalid' });
  const tail = { ...args, offset: first.next_offset, text: '終わり😀', final: true };
  const results = await Promise.allSettled([run('chelm_stage_output', tail), run('chelm_stage_output', tail)]);
  // The cross-process mutex can refuse a concurrent caller; retry is safe.
  for (const result of results) {
    if (result.status === 'rejected') assert.equal(result.reason.code, 'busy');
    else assert.equal(result.value.sha256, hash(text + tail.text));
  }
  assert.equal((await run('chelm_stage_output', tail)).sha256, hash(text + tail.text));
  await assert.rejects(run('chelm_stage_output', { ...tail, text: 'different' }), { code: 'upload_conflict' });
  const dir = path.join(f.root, 'host/remote/work', w.work_id);
  fs.writeFileSync(path.join(dir, 'upload-index.json'), JSON.stringify({ retained: MAX_BYTES }));
  await assert.rejects(run('chelm_stage_output', { ...args, revision: 2, text: 'over quota' }), { code: 'capacity_exceeded' });
  assert.equal(fs.existsSync(path.join(dir, 'uploads', args.slot_id, '2')), false);
});

test('integration attempts recheck changed policy and another publication before committing', async t => {
  const f = fixture(t); f.submit('A'); f.submit('B', 'Second source.'); f.submit('C', 'Third source.');
  const cfgPath = path.join(f.root, 'chelm.runtime.json'), cfg = JSON.parse(fs.readFileSync(cfgPath));
  cfg.remote.max_active_work = 3; fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  const a = call(f, 'a'), b = call(f, 'b'), c = call(f, 'c');
  const wa = await a('chelm_request_work', { executor, request_id: randomUUID(), max: 1 });
  const wb = await b('chelm_request_work', { executor, request_id: randomUUID(), max: 1 });
  const wc = await c('chelm_request_work', { executor, request_id: randomUUID(), max: 1 });
  await finish(a, wa);
  const ib = (await finish(b, wb)).work_unit;
  const ic = (await finish(c, wc)).work_unit;
  assert.equal((await finish(b, ib)).status, 'committed');
  const refreshed = await finish(c, ic);
  assert.equal(refreshed.status, 'integration-required');
  assert.equal(refreshed.work_unit.attempt, ic.attempt + 1);
  await assert.rejects(c('chelm_renew_work', workArgs(ic)), { code: 'stale_attempt' });
  const candidate = await prepare(c, refreshed.work_unit);
  const validation = await c('chelm_validate_candidate', candidate);
  const before = git(f.instance, 'rev-parse', 'HEAD');
  f.write('instance/purpose.md', 'Changed integration policy.');
  git(f.instance, 'add', 'instance/purpose.md');
  git(f.instance, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'policy');
  const policyHead = git(f.instance, 'rev-parse', 'HEAD');
  assert.notEqual(before, policyHead);
  await assert.rejects(c('chelm_submit_candidate', { ...candidate, candidate_digest: validation.candidate_digest, submission_id: randomUUID() }), { code: 'policy_changed' });
  assert.equal(git(f.instance, 'rev-parse', 'HEAD'), policyHead);
  assert.equal(f.read('memory/graph.json').claims.length, 2);
});

test('committed raw tree bound counts duplicate blobs and refuses before loading oversized memory', async t => {
  const { snapshot, RAW_TREE_BYTES } = await import('../../lib/util.mjs');
  const f = fixture(t);
  // Two paths share a single 32 MiB Git blob. Logical tree bytes exceed 64 MiB
  // once canonical memory is included, despite the smaller batch object stream.
  const bytes = Buffer.alloc(RAW_TREE_BYTES / 2, 120);
  fs.writeFileSync(path.join(f.instance, 'large-a'), bytes);
  fs.writeFileSync(path.join(f.instance, 'large-b'), bytes);
  git(f.instance, 'add', 'large-a', 'large-b');
  git(f.instance, '-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-qm', 'oversized duplicate blobs');
  assert.throws(() => snapshot(f.instance), { code: 'capacity_exceeded' });
});

test('HTTP token revocation, runtime denial and executor spoofing preserve authenticated ownership and redact logs', async t => {
  const { startServer } = await import('../../lib/remote-server.mjs');
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const f = fixture(t); f.submit('private-subject', 'Private observation marker 923487.');
  const token = 'test-revocation-secret-01234567890123456789', env = { REVOCABLE_TOKEN: token };
  const server = await startServer({ port: 0, public_url: 'http://127.0.0.1/mcp', development: true,
    runtimes: { allowed: f.root, forbidden: f.root }, auth: { mode: 'worker-tokens', workers: [
      { principal: 'verified-principal', runtimes: ['allowed'], token_env: 'REVOCABLE_TOKEN' }
    ] } }, { env });
  const client = new Client({ name: 'auth-boundary-fixture', version: '1' });
  t.after(async () => { await client.close(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  assert.equal((await fetch(url + '/forbidden', { method: 'POST', headers: { Authorization: 'Bearer ' + token } })).status, 403);
  assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer incorrect' } })).status, 401);
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: 'Bearer ' + token } } }));
  const response = await client.callTool({ name: 'chelm_request_work', arguments: {
    executor: { ...executor, id: 'spoofed-administrator', host: 'spoofed-host' }, request_id: randomUUID()
  } });
  const work = JSON.parse(response.content[0].text); assert.equal(work.ok, true);
  const stored = JSON.parse(fs.readFileSync(path.join(f.root, 'host/remote/work', work.work_id, 'record.json')));
  assert.equal(stored.principal, 'verified-principal');
  await assert.rejects(call(f, 'spoofed-administrator')('chelm_work_status', workArgs(work)), { code: 'work_not_owned' });
  delete env.REVOCABLE_TOKEN;
  assert.equal((await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token } })).status, 401);
  const logs = fs.readFileSync(path.join(f.root, 'host/logs/chelm.jsonl'), 'utf8');
  for (const secret of [token, 'Private observation marker 923487.', 'spoofed-host']) assert.equal(logs.includes(secret), false);
});
