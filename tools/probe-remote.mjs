// Read-only connectivity/discovery probe. Credentials never enter the report.
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const option = name => { const i = process.argv.indexOf('--' + name); return i < 0 ? undefined : process.argv[i + 1]; };
if (!option('url') || !option('token-env')) throw Error('--url and --token-env are required');
const url = new URL(option('url'));
if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) throw Error('Non-loopback URL requires HTTPS');
if (url.username || url.password || url.search || url.hash) throw Error('URL must not contain credentials, query or fragment');
const token = process.env[option('token-env')]; if (!token) throw Error('Credential environment variable is empty');
const client = new Client({ name: 'chelm-acceptance-probe', version: '1' });
try {
  const at = performance.now();
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: 'Bearer ' + token } } }));
  const tools = (await client.listTools()).tools.map(t => t.name), prompts = (await client.listPrompts()).prompts.map(p => p.name);
  const listed = await client.callTool({ name: 'chelm_list_work', arguments: { limit: 1 } });
  const value = JSON.parse(listed.content[0].text);
  if (listed.isError || !value.ok) throw Error('Read-only work listing refused');
  const pkg = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url)));
  const report = { ok: true, recorded_at: new Date().toISOString(), node: process.version,
    sdk: pkg.packages['node_modules/@modelcontextprotocol/sdk'].version, server: client.getServerVersion(),
    tools, prompts, elapsed_ms: performance.now() - at, inference: 'not exercised' };
  if (option('output')) { const output = path.resolve(option('output')); fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); }
  process.stdout.write(JSON.stringify(report) + '\n');
} finally { await client.close(); }
