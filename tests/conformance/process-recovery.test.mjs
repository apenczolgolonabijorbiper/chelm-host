import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fork, spawnSync, execFile } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { fixture, executor, source, git, ok } from '../helpers.mjs';
import { call, workArgs, finish, prepare } from '../remote-helpers.mjs';
import { reconcilePublication } from '../../lib/publication.mjs';
import { config } from '../../lib/runtime.mjs';

function launch(script, args = [], env = {}) {
  const child = fork(path.join(source, 'tests/process', script), args, {
    env: { ...process.env, ...env }, stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('Fixture startup timed out')); }, 30000);
    child.once('message', value => { clearTimeout(timer); resolve(value); });
    child.once('error', e => { clearTimeout(timer); reject(e); });
    child.once('exit', code => { clearTimeout(timer); reject(Error('Fixture exited: ' + code)); });
  });
  return { child, ready };
}
async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = once(child, 'exit'); child.kill('SIGKILL'); await done;
}
function rpc(child) {
  let sequence = 0;
  return (name, args = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { child.off('message', listener); reject(Error('Peer RPC timeout')); }, 30000);
    const listener = message => {
      if (message.id !== id) return;
      clearTimeout(timer); child.off('message', listener);
      if (message.error) reject(Error(message.error));
      else if (!message.value.ok) reject(Object.assign(Error(message.value.error.message), message.value.error));
      else resolve(message.value);
    };
    child.on('message', listener); child.send({ id, name, args });
  });
}

test('two independent HTTP clients through proxy survive service kill/restart and lost receipts', async t => {
  const f = fixture(t); f.submit('A'); f.submit('B', 'Second process source.');
  const p = path.join(f.root, 'chelm.runtime.json'), cfg = JSON.parse(fs.readFileSync(p));
  cfg.remote.max_active_work = 2; fs.writeFileSync(p, JSON.stringify(cfg));
  const tokenA = 'process-a-test-only-01234567890123456789', tokenB = 'process-b-test-only-01234567890123456789';
  const serviceConfig = path.join(f.base, 'service.json');
  fs.writeFileSync(serviceConfig, JSON.stringify({ port: 0, public_url: 'http://127.0.0.1/mcp', development: true,
    runtimes: { app: f.root }, auth: { mode: 'worker-tokens', workers: [
      { principal: 'a', runtimes: ['app'], token_env: 'PROCESS_TOKEN_A' },
      { principal: 'b', runtimes: ['app'], token_env: 'PROCESS_TOKEN_B' }
    ] } }));
  let service, backendPort;
  const children = [];
  t.after(async () => { for (const child of children) await stop(child); });
  async function start() {
    service = launch('remote-service.mjs', [serviceConfig], { PROCESS_TOKEN_A: tokenA, PROCESS_TOKEN_B: tokenB });
    children.push(service.child); backendPort = (await service.ready).port;
  }
  await start();
  const proxy = http.createServer((req, res) => {
    const upstream = http.request({ hostname: '127.0.0.1', port: backendPort, method: req.method, path: req.url, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { proxy.close(resolve); proxy.closeAllConnections(); }));
  const url = `http://127.0.0.1:${proxy.address().port}/mcp`;
  const pa = launch('remote-peer.mjs', [], { CHELM_TEST_URL: url, CHELM_TEST_TOKEN: tokenA }); children.push(pa.child); await pa.ready;
  const pb = launch('remote-peer.mjs', [], { CHELM_TEST_URL: url, CHELM_TEST_TOKEN: tokenB }); children.push(pb.child); await pb.ready;
  const samples = [];
  const measured = child => {
    const run = rpc(child);
    return async (name, args = {}) => {
      const at = performance.now();
      try {
        const value = await run(name, args);
        samples.push({ tool: name, elapsed_ms: performance.now() - at,
          request_json_bytes: Buffer.byteLength(JSON.stringify({ name, arguments: args })),
          response_json_bytes: Buffer.byteLength(JSON.stringify(value)) });
        return value;
      } catch (error) { throw error; }
    };
  };
  const probePath = path.join(f.base, 'remote-probe.json');
  await new Promise((resolve, reject) => execFile(process.execPath,
    [path.join(source, 'tools/probe-remote.mjs'), '--url', url, '--token-env', 'PROBE_TOKEN', '--output', probePath],
    { env: { ...process.env, PROBE_TOKEN: tokenA }, timeout: 30000 },
    (error, stdout, stderr) => error ? reject(Error(stderr || error.message)) : resolve(stdout)));
  const probe = JSON.parse(fs.readFileSync(probePath));
  assert.equal(probe.ok, true); assert.equal(probe.tools.length, 11); assert.equal(probe.prompts.length, 3);
  assert.equal(fs.readFileSync(probePath, 'utf8').includes(tokenA), false);
  const a = measured(pa.child), b = measured(pb.child), request = { executor, request_id: randomUUID(), max: 1 };
  const wa = await a('chelm_request_work', request);
  const wb = await b('chelm_request_work', { ...request, request_id: randomUUID() });
  assert.notEqual(wa.sources[0].id, wb.sources[0].id);
  await assert.rejects(b('chelm_work_status', workArgs(wa)), { code: 'work_not_owned' });
  await stop(service.child); await start();
  assert.equal((await a('chelm_request_work', request)).work_id, wa.work_id);
  assert.equal((await a('chelm_work_status', workArgs(wa))).status, 'assigned');
  await a('chelm_context', { ...workArgs(wa), filters: { query: 'Synthetic', limit: 5 } });
  const receipt = await finish(a, wa); assert.equal(receipt.status, 'committed');
  // Discard the original client and restart the service; recover through a fresh client.
  await stop(pa.child); await stop(service.child); await start();
  const reconnected = launch('remote-peer.mjs', [], { CHELM_TEST_URL: url, CHELM_TEST_TOKEN: tokenA }); children.push(reconnected.child); await reconnected.ready;
  assert.equal((await rpc(reconnected.child)('chelm_work_status', workArgs(wa))).receipt.head, receipt.head);
  const integration = await finish(b, wb);
  assert.equal(integration.status, 'integration-required');
  assert.equal((await finish(b, integration.work_unit)).status, 'committed');
  assert.equal(f.read('memory/graph.json').claims.length, 2);
  if (process.env.CHELM_ACCEPTANCE_REPORT_DIR) {
    const report = { schema_version: 1, platform: process.platform, node: process.version,
      fixture: 'Two deterministic external SDK clients, one HTTP proxy and restarted owner service on the same machine; no language model.',
      method: 'Per-tool wall time and JSON payload bytes; excludes HTTP headers. Validate is measured separately. Submit includes mandatory fresh validation, merge and owner publication; it is not pure Git latency.',
      inference_ms: null, input_tokens: null, output_tokens: null, billed_cost: null, samples };
    fs.mkdirSync(process.env.CHELM_ACCEPTANCE_REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(process.env.CHELM_ACCEPTANCE_REPORT_DIR, 'remote-phases-' + process.platform + '.json'), JSON.stringify(report, null, 2) + '\n');
  }
});

for (const checkpoint of ['beforeCAS', 'afterCAS']) {
  test(`publication survives process termination ${checkpoint}, reconciles once and preserves drafts`, async t => {
    const f = fixture(t); f.submit();
    const run = call(f), w = await run('chelm_request_work', { executor, request_id: randomUUID() });
    f.write('unrelated.md', 'Preserve unrelated draft.');
    const before = git(f.instance, 'rev-parse', 'HEAD');
    const crashed = spawnSync(process.execPath, [path.join(source, 'tests/process/publication-crash.mjs'), f.root, w.work_id, checkpoint], { encoding: 'utf8', timeout: 30000 });
    assert.equal(crashed.error, undefined);
    assert.notEqual(crashed.status, 0, crashed.stderr);
    assert(fs.existsSync(path.join(f.root, 'host/publication-pending.json')));
    const after = git(f.instance, 'rev-parse', 'HEAD');
    assert.equal(after === before, checkpoint === 'beforeCAS');
    reconcilePublication(f.root, config(f.root)); reconcilePublication(f.root, config(f.root));
    assert.equal(f.text('unrelated.md'), 'Preserve unrelated draft.');
    assert.equal(fs.existsSync(path.join(f.root, 'host/publication-pending.json')), false);
    if (checkpoint === 'afterCAS') {
      assert.equal((await run('chelm_work_status', workArgs(w))).receipt.head, after);
      assert.equal(f.text('memory/index.md'), '# Process crash recovery fixture\n');
    } else assert.equal((await run('chelm_work_status', workArgs(w))).status, 'assigned');
  });
}

for (const checkpoint of ['beforeCAS', 'afterCAS']) {
  test(`full candidate submit killed ${checkpoint} recovers through public status/submit exactly once`, async t => {
    const f = fixture(t); const [sourceId] = f.submit();
    const run = call(f), w = await run('chelm_request_work', { executor, request_id: randomUUID() });
    const candidate = await prepare(run, w), validated = await run('chelm_validate_candidate', candidate);
    const args = { ...candidate, candidate_digest: validated.candidate_digest, submission_id: randomUUID() };
    const argsPath = path.join(f.base, 'candidate.json'); fs.writeFileSync(argsPath, JSON.stringify(args));
    f.write('unrelated.md', 'Unrelated candidate draft.');
    const crashed = spawnSync(process.execPath, [path.join(source, 'tests/process/submit-crash.mjs'), f.root, argsPath, checkpoint], { encoding: 'utf8', timeout: 30000 });
    assert.equal(crashed.error, undefined); assert.notEqual(crashed.status, 0, crashed.stderr);
    assert(fs.existsSync(path.join(f.root, 'host/publication-pending.json')));
    await assert.rejects(run('chelm_work_status', workArgs(w)), { code: 'busy' });
    // Advance only the dead owner's fixture lock age; production deliberately
    // waits ten minutes before breaking a dead same-host operation lock.
    const lockPath = path.join(f.root, 'host/locks/operation.lock');
    const lock = JSON.parse(fs.readFileSync(lockPath)); lock.started_at = '2000-01-01T00:00:00.000Z';
    fs.writeFileSync(lockPath, JSON.stringify(lock));
    await run('chelm_work_status', workArgs(w));
    const result = await run('chelm_submit_candidate', args);
    assert.equal(result.status, 'committed');
    const head = git(f.instance, 'rev-parse', 'HEAD'); assert.equal(result.head, head);
    assert.equal((await run('chelm_submit_candidate', args)).head, head);
    assert.equal(f.read('memory/processed.json').observations.filter(r => r.id === sourceId).length, 1);
    assert.equal(f.read('memory/graph.json').claims.length, 1);
    assert.equal(ok('read', 'summary', f.root).view.processed, 1);
    assert.equal(ok('read', 'summary', f.root).view.head, head);
    assert.equal(f.text('unrelated.md'), 'Unrelated candidate draft.');
    assert.equal(git(f.instance, 'rev-parse', 'HEAD'), head);
  });
}
