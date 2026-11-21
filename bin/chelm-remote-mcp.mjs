#!/usr/bin/env node
// Optional local stdio bridge. The worker machine needs Node and this package,
// but never a harness installation, Python, Git or server filesystem access.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
const value = (k) => {
  const i = process.argv.indexOf(k);
  return i < 0 ? undefined : process.argv[i + 1];
};
try {
  const url = new URL(value('--url')),
    token = process.env[value('--token-env') ?? 'CHELM_WORKER_TOKEN'];
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname))
    throw Error('Remote MCP requires HTTPS');
  if (!token) throw Error('Worker credential environment variable is missing');
  const remote = new Client({ name: 'chelm-stdio-bridge', version: '1.0.0' });
  await remote.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: 'Bearer ' + token } }
    })
  );
  const local = new Server(
    { name: 'chelm-remote-worker', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );
  local.setRequestHandler(ListToolsRequestSchema, async () => remote.listTools());
  local.setRequestHandler(CallToolRequestSchema, async (req) => remote.callTool(req.params));
  await local.connect(new StdioServerTransport());
  process.stdin.on('end', () => remote.close().catch(() => {}));
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
      await remote.close();
      await local.close();
      process.exit(0);
    });
} catch (e) {
  process.stderr.write('Chelm remote connection failed: ' + e.message + '\n');
  process.exitCode = 1;
}
