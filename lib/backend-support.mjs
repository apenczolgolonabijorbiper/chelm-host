import {
  spawnSync
} from 'node:child_process';
import {
  readFileSync
} from 'node:fs';
import {
  parseNote
} from './util.mjs';
export const parseSource = parseNote;
export function boundedSpawn(executable, args, options = {}) {
  const {
    timeout = 60000, ...rest
  } = options;
  const r = spawnSync(executable, args, {
    ...rest,
    timeout,
    env: {
      ...process.env,
      ...rest.env,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never'
    },
    stdio: [rest.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
  });
  if (r.error) throw Error('Child failed: ' + executable + ' (' + r.error.code + ')');
  return r;
}
// Resolve using the public harness CLI; the returned layout is authoritative.
export async function resolveLayout(root, {
  read
} = {}) {
  if (read) {
    for (const p of ['instance/purpose.md', 'memory/hypotheses.json']) await read(p);
    return {
      purpose_path: 'instance/purpose.md',
      hypotheses_path: 'memory/hypotheses.json'
    };
  }
  const fs = await import('node:fs');
  for (const p of ['instance/purpose.md', 'memory/hypotheses.json']) fs.readFileSync(root + '/' + p);
  return {
    purpose_path: 'instance/purpose.md',
    hypotheses_path: 'memory/hypotheses.json'
  };
}
