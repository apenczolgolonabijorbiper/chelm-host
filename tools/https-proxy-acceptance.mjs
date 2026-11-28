// Disposable HTTPS transport acceptance. No production runtime or inference input.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID, randomBytes, createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {startServer, stopServer} from '../lib/remote-server.mjs';
import {ownedProcess} from './owned-process.mjs';
import {inspectRemoteDiscovery} from './remote-discovery.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Fixed prefixes also let the IIS wrapper inspect its W3C logs after flushing.
export const privatePrefixes = ['chelm-https-secret-', 'chelm-https-observation-', 'chelm-https-upload-'];
export function assertRedacted(text) {
  assert(!privatePrefixes.some(prefix => text.includes(prefix)), 'Private canary found in logs');
}

export async function exerciseHttpsProxy({url, backendPort, harness, fetchImpl = fetch}) {
  url = new URL(url);
  assert(url.protocol === 'https:' && url.pathname === '/mcp' && !url.username && !url.password && !url.search && !url.hash,
    'Use a credential-free HTTPS /mcp URL');
  assert(Number.isInteger(backendPort) && backendPort > 0 && backendPort < 65536, 'Explicit backend port required');
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chelm-https-'));
  const root = path.join(base, 'sandbox', 'runtime'), diagnostics = [], clients = [];
  const checks = [];
  let server;
  const check = (name, condition) => {
    if (!condition) throw Object.assign(Error('HTTPS acceptance check failed'), {name: 'AssertionError', failed_check: name});
    checks.push({name, pass: true});
  };
  function cli(args, input) {
    const r = ownedProcess(process.execPath, [path.join(packageRoot, 'bin/chelm.mjs'), ...args, '--runtime', root,
      ...(input ? ['--input', '-'] : [])], {encoding: 'utf8', input: input ? JSON.stringify(input) : undefined,
      timeout: 180000, phase: 'HTTPS acceptance CLI ' + args[0]});
    let value;
    try {value = JSON.parse(r.stdout);} catch {throw Error('HTTPS fixture CLI returned no JSON');}
    assert(r.status === 0 && value.ok, 'HTTPS fixture CLI failed: ' + (value.error?.code ?? 'unknown'));
    return value;
  }
  try {
    cli(['init', '--sandbox', '--harness', path.resolve(harness)]);
    const observation = privatePrefixes[1] + randomUUID();
    const sent = cli(['submit'], {subject_id: 'HTTPS-SYNTHETIC', groups: [{kind: 'record', chunks: [observation]}]});
    // Only this newly created synthetic fixture bypasses the intake age wait.
    for (const id of sent.groups.flatMap(g => g.observation_ids)) {
      const source = path.join(root, 'instance/inbox', id + '.md');
      fs.writeFileSync(source, fs.readFileSync(source, 'utf8').replace(/^recorded_at: .*$/m,
        'recorded_at: ' + new Date(Date.now() - 120000).toISOString()));
      fs.rmSync(path.join(root, 'instance/evidence', id + '.json'), {force: true});
    }
    cli(['index']);
    const token = privatePrefixes[0] + randomBytes(32).toString('hex');
    server = await startServer({port: backendPort, public_url: url.href, allowed_origins: ['https://allowed.example'],
      runtimes: {app: root, other: root}, auth: {mode: 'worker-tokens', workers: [
        {principal: 'https-worker', runtimes: ['app'], token_env: 'TOKEN'}]}},
    {env: {TOKEN: token}, diagnostics: event => diagnostics.push(event)});
    check('backend_loopback_only', server.address().address === '127.0.0.1');
    const request = async (endpoint, {credential = token, headers = {}, body = '{}'} = {}) => {
      const r = await fetchImpl(endpoint, {method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
          ...(credential ? {Authorization: 'Bearer ' + credential} : {}), ...headers}, body});
      const text = await r.text();
      return {status: r.status, headers: r.headers, text};
    };
    // Readiness uses only discovery and never retries a worker operation.
    let metadata;
    for (let i = 0; i < 30; i++) {
      try {
        const r = await fetchImpl(new URL('/.well-known/oauth-protected-resource/mcp', url),
          {redirect: 'error', signal: AbortSignal.timeout(1000)});
        if (r.status === 200) {metadata = await r.json(); break;}
        await r.body?.cancel();
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    check('https_metadata', metadata?.resource === url.href);
    const denied = await request(url, {credential: null, headers: {
      'X-Forwarded-User': 'https-worker', 'X-Remote-User': 'https-worker', 'X-Forwarded-Proto': 'https'}});
    check('forwarded_identity_not_authority', denied.status === 401);
    check('authorization_discovery', denied.headers.get('www-authenticate')?.includes(
      url.origin + '/.well-known/oauth-protected-resource/mcp'));
    check('wrong_token', (await request(url, {credential: privatePrefixes[0] + 'wrong'})).status === 401);
    check('cross_runtime', (await request(new URL('/mcp/other', url))).status === 403);
    check('denied_origin', (await request(url, {headers: {Origin: 'https://denied.invalid'}})).status === 403);
    check('invalid_json', (await request(new URL('/mcp?' + privatePrefixes[1] + 'query', url), {
      headers: {'User-Agent': privatePrefixes[0] + 'user-agent', Cookie: privatePrefixes[2] + 'cookie',
        Referer: 'https://example.invalid/' + privatePrefixes[1] + 'referer'},
      body: privatePrefixes[2] + 'invalid-json'})).status === 400);
    check('request_bound', (await request(url, {body: 'x'.repeat(256 * 1024 + 1)})).status === 413);
    const unknown = await request(url, {body: JSON.stringify({jsonrpc: '2.0', id: 42, method: 'unknown'})});
    check('jsonrpc_error', JSON.parse(unknown.text).error?.code === -32601);
    const connect = async () => {
      const client = new Client({name: 'chelm-https-acceptance', version: '1'});
      clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL('/mcp/app', url), {fetch: fetchImpl,
        requestInit: {headers: {Authorization: 'Bearer ' + token, Origin: 'https://allowed.example'}}}));
      return client;
    };
    let client = await connect();
    check('worker_discovery', (await inspectRemoteDiscovery(client)).pass);
    const call = async (name, args = {}) => {
      const result = await client.callTool({name, arguments: args});
      const value = JSON.parse(result.content[0].text);
      assert(!result.isError && value.ok, 'HTTPS worker operation failed: ' + name);
      return value;
    };
    const work = await call('chelm_request_work', {request_id: randomUUID(), executor: {
      id: 'https-synthetic', kind: 'scripted', model: 'none (HTTPS transport fixture)', host: 'synthetic'}});
    check('worker_assignment', work.status === 'assigned');
    const identity = {work_id: work.work_id, attempt: work.attempt};
    const artifact = await call('chelm_read_artifact', {...identity, artifact_id: work.sources[0].artifact_id, offset: 0});
    check('observation_read', artifact.text.includes(observation));
    const slot = work.output_slots.find(s => s.path.startsWith('memory/runs/') && s.path.endsWith('.md'));
    await call('chelm_stage_output', {...identity, slot_id: slot.slot_id, revision: 1, offset: 0,
      text: privatePrefixes[2] + randomUUID(), final: true});
    check('bounded_upload', true);
    await client.close();
    client = await connect();
    const recovered = await call('chelm_work_status', identity);
    check('reconnect_keeps_assignment', recovered.status === 'staging' && recovered.work_id === work.work_id && recovered.attempt === work.attempt);
    await call('chelm_abandon_work', identity);
    check('explicit_abandon', true);
    await Promise.all(clients.map(c => c.close()));
    await stopServer(server); server = null;
    const logRoot = path.join(root, 'host/logs');
    const logs = fs.readdirSync(logRoot).filter(p => p.startsWith('chelm.jsonl'))
      .map(p => fs.readFileSync(path.join(logRoot, p), 'utf8')).join('\n');
    assertRedacted(logs + JSON.stringify(diagnostics));
    check('service_log_redaction', logs.includes('remote-worker') && diagnostics.some(e => e.phase === 'tool_finished'));
    return {schema_version: 1, kind: 'https-proxy-acceptance', ok: true, recorded_at: new Date().toISOString(),
      platform: process.platform, os_release: os.release(), node: process.version,
      package_manifest_sha256: fs.existsSync(path.join(packageRoot, 'RELEASE.json'))
        ? createHash('sha256').update(fs.readFileSync(path.join(packageRoot, 'RELEASE.json'))).digest('hex') : null,
      checks, inference: 'not exercised', authentication: 'controlled worker tokens; official SDK client',
      limitations: ['No live OAuth issuer/renewal or IDE flow', 'Synthetic runtime on one machine; no consumer deployment certification']};
  } finally {
    await Promise.all(clients.map(c => c.close().catch(() => {})));
    await stopServer(server);
    fs.rmSync(base, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const option = key => {const i = process.argv.indexOf('--' + key); return i < 0 ? undefined : process.argv[i + 1];};
  const output = path.resolve(option('output') ?? 'https-proxy.json');
  let report;
  try {
    report = await exerciseHttpsProxy({url: option('url'), backendPort: Number(option('backend-port')), harness: option('harness')});
  } catch (error) {
    // Do not print transport errors: upstreams can echo authorization or bodies.
    report = {schema_version: 1, kind: 'https-proxy-acceptance', ok: false, error_class: error.name,
      ...(error.failed_check ? {failed_check: error.failed_check} : {})};
    process.exitCode = 1;
  }
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
