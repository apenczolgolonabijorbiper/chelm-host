// Deterministic transport fixture. No model or access to runtime files on the client.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const client = new Client({ name: 'chelm-process-fixture', version: '1' });
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.CHELM_TEST_URL), {
  requestInit: { headers: { Authorization: 'Bearer ' + process.env.CHELM_TEST_TOKEN } }
}));
process.send({ ready: true });
process.on('message', async ({ id, name, args }) => {
  try {
    const result = await client.callTool({ name, arguments: args });
    process.send({ id, value: JSON.parse(result.content[0].text) });
  } catch (e) { process.send({ id, error: e.message }); }
});
