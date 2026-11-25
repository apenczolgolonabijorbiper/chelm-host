import test from '../scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture, executor, source, analyze } from '../helpers.mjs';

test('local MCP: nine successful scenarios cover all seven current tools and a real publication', async t => {
  const f = fixture(t), p = path.join(f.root, 'chelm.runtime.json'), cfg = JSON.parse(fs.readFileSync(p));
  cfg.requests.kinds = ['collect']; fs.writeFileSync(p, JSON.stringify(cfg));
  const client = new Client({ name: 'chelm-local-conformance', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [path.join(source, 'bin/chelm-mcp.mjs'), '--runtime', f.root], stderr: 'pipe' }));
  t.after(() => client.close());
  let successes = 0;
  const names = new Set();
  async function run(name, args = {}) {
    const result = await client.callTool({ name: 'chelm_' + name, arguments: { executor, ...args } });
    const value = JSON.parse(result.content[0].text);
    assert.equal(result.isError, false, JSON.stringify(value)); assert.equal(value.ok, true);
    successes++; names.add(name); return value;
  }
  assert.equal((await run('next')).status, 'no-work');
  await run('context', { query: 'Synthetic' });
  await run('propose', { kind: 'collect', subject_id: 'S-1', reason: 'Synthetic proposal.' });
  f.submit();
  const first = (await run('next')).work_unit;
  await run('renew', { run_id: first.run_id });
  await run('abandon', { run_id: first.run_id });
  const unit = (await run('next')).work_unit;
  analyze(f, unit);
  await run('validate', { run_id: unit.run_id, outputs: [] });
  await run('submit', { run_id: unit.run_id, outputs: [] });
  assert.equal(successes, 9);
  assert.equal(names.size, 7);
  assert.equal(f.read('memory/processed.json').observations.length, 1);
});
