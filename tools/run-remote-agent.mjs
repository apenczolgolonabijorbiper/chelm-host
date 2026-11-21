// Run a configured agent CLI repeatedly; the CLI owns inference and MCP access.
// No shell interpolation, inference client or model credentials in Chelm.
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2),
  i = args.indexOf('--config');
if (i < 0) throw Error('Usage: node tools/run-remote-agent.mjs --config worker.json');
const config = JSON.parse(fs.readFileSync(args[i + 1], 'utf8'));
if (
  typeof config.command !== 'string' ||
  !Array.isArray(config.args) ||
  !config.args.every((x) => typeof x === 'string')
)
  throw Error('Expected executable command and args array');
const cycles = config.max_cycles ?? 1,
  interval = config.interval_seconds ?? 30,
  timeout = config.cycle_timeout_seconds ?? 1800;
if (
  !Number.isInteger(cycles) ||
  cycles < 1 ||
  cycles > 10000 ||
  !Number.isFinite(interval) ||
  interval < 5 ||
  interval > 3600 ||
  !Number.isFinite(timeout) ||
  timeout < 1 ||
  timeout > 3600
)
  throw Error('Invalid runner bounds');
const prompt = fs.readFileSync(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../prompts/remote-worker-once.sudo.md'
  ),
  'utf8'
);
let stopped = false,
  current;
for (const sig of ['SIGTERM', 'SIGINT'])
  process.on(sig, () => {
    stopped = true;
    current?.kill();
  });
let failures = 0;
for (let cycle = 0; cycle < cycles && !stopped; cycle++) {
  const code = await new Promise((resolve, reject) => {
    current = spawn(config.command, config.args, {
      cwd: config.cwd ?? process.cwd(),
      shell: false,
      stdio: ['pipe', 'inherit', 'inherit'],
      env: process.env
    });
    let hardKill;
    const timer = setTimeout(() => {
      current.kill();
      hardKill = setTimeout(() => current.kill('SIGKILL'), 5000);
    }, timeout * 1000);
    current.once('error', (e) => {
      clearTimeout(timer);
      clearTimeout(hardKill);
      reject(e);
    });
    current.once('close', (code) => {
      clearTimeout(timer);
      clearTimeout(hardKill);
      resolve(code ?? 1);
    });
    current.stdin.on('error', () => {});
    current.stdin.end(prompt);
  });
  failures = code === 0 ? 0 : failures + 1;
  if (failures >= 3)
    throw Error('Three agent cycles failed; inspect agent diagnostics and authentication');
  if (cycle + 1 < cycles && !stopped)
    await new Promise((resolve) => {
      let remaining = interval;
      const timer = setInterval(() => {
        if (stopped || --remaining <= 0) {
          clearInterval(timer);
          resolve();
        }
      }, 1000);
    });
}
