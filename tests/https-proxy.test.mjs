import test from './scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import {harness} from './helpers.mjs';
import {exerciseHttpsProxy, assertRedacted} from '../tools/https-proxy-acceptance.mjs';

const cert = fs.readFileSync(new URL('./fixtures/https-proxy/cert.pem', import.meta.url));
const key = fs.readFileSync(new URL('./fixtures/https-proxy/key.pem', import.meta.url));

// Real certificate/hostname verification with a fixture CA, never an insecure TLS flag.
function trustedFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {ca: cert, method: options.method ?? 'GET',
      headers: Object.fromEntries(new Headers(options.headers)), signal: options.signal}, response => {
      const chunks = [];
      response.on('data', b => chunks.push(b));
      response.on('error', reject);
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode, headers: response.headers})));
    });
    request.on('error', reject);
    request.end(options.body);
  });
}

test('HTTPS termination proxies official MCP negotiation, authorization, work, reconnect and redacted logs', async t => {
  const reservation = http.createServer();
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
  const backendPort = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const access = [];
  const proxy = https.createServer({key, cert}, (req, res) => {
    const upstream = http.request({hostname: '127.0.0.1', port: backendPort,
      method: req.method, path: req.url, headers: req.headers}, backend => {
      access.push({method: req.method, status: backend.statusCode});
      res.writeHead(backend.statusCode, backend.headers); backend.pipe(res);
    });
    upstream.on('error', () => {res.writeHead(502); res.end();});
    req.pipe(upstream);
  });
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {proxy.close(resolve); proxy.closeAllConnections();}));
  const url = `https://127.0.0.1:${proxy.address().port}/mcp`;
  await assert.rejects(fetch(url), 'Untrusted fixture certificate must be refused');
  const report = await exerciseHttpsProxy({url, backendPort, harness, fetchImpl: trustedFetch});
  assert.equal(report.ok, true);
  assert(report.checks.length >= 16);
  assert(access.some(e => e.status === 401));
  assert(access.some(e => e.status === 413));
  assertRedacted(JSON.stringify(access) + JSON.stringify(report));
});

test('HTTPS acceptance redaction check refuses credential, observation and upload leakage', () => {
  for (const value of ['chelm-https-secret-test', 'chelm-https-observation-test', 'chelm-https-upload-test'])
    assert.throws(() => assertRedacted(value));
  assertRedacted('{"status":401,"method":"POST"}');
});
