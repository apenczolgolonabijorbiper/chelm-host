#!/usr/bin/env node
// Optional local stdio bridge. The worker machine needs Node and this package,
// but never a harness installation, Python, Git or server filesystem access.
import { requireDependencies } from '../lib/dependencies.mjs';
const value = (k) => {
  const i = process.argv.indexOf(k);
  return i < 0 ? undefined : process.argv[i + 1];
};
try {
  requireDependencies();
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const { Server } = await import('@modelcontextprotocol/sdk/server/index.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { ListToolsRequestSchema, CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js');
  const url = new URL(value('--url')),
    token = process.env[value('--token-env') ?? 'CHELM_WORKER_TOKEN'];
  if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname))
    throw Error('Remote MCP requires HTTPS');
  if (!token) throw Error('Worker credential environment variable is missing');
  const remote = new Client({ name: 'chelm-stdio-bridge', version: '1.4.1' });
  await remote.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: 'Bearer ' + token } }
    })
  );
  const local = new Server(
    { name: 'chelm-remote-worker', version: '1.4.1' },
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
