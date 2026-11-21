#!/usr/bin/env node
import fs from 'node:fs';
import { startServer } from '../lib/remote-server.mjs';
const at = process.argv.indexOf('--config');
if (at < 0 || !process.argv[at + 1]) {
  process.stderr.write('Usage: node bin/chelm-serve.mjs --config <service.json>\n');
  process.exitCode = 2;
} else
  try {
    const server = await startServer(JSON.parse(fs.readFileSync(process.argv[at + 1], 'utf8')));
    process.stderr.write(
      'Chelm remote MCP listening on ' + JSON.stringify(server.address()) + '\n'
    );
    for (const sig of ['SIGTERM', 'SIGINT'])
      process.on(sig, () => server.close(() => process.exit(0)));
  } catch (e) {
    process.stderr.write('Cannot start remote MCP: ' + e.message + '\n');
    process.exitCode = 1;
  }
