import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

// Reserve cleanup time inside the outer bound; callers never delete a runtime
// until this supervisor exits. Each POSIX supervisor has its own session so an
// enclosing process-group kill cannot prevent parent-death cleanup.
export function ownedProcess(executable, args, {timeout = 60000, phase = 'command',
  python = process.env.GOLEM_PYTHON ?? (process.platform === 'win32' ? 'py' : 'python3'), ...options} = {}) {
  const result = spawnSync(python, [fileURLToPath(new URL('./owned-process.py', import.meta.url)),
    String(process.pid), String(timeout / 1000), phase, executable, ...args], {
    ...options, encoding: 'utf8', detached: process.platform !== 'win32', timeout: timeout + 5000,
    killSignal: 'SIGTERM', maxBuffer: 16 * 1024 * 1024
  });
  if (result.status === 124 || result.status === 125) result.error = Object.assign(
    Error(`${phase}: ${result.status === 124 ? 'operation timeout/cancellation' : 'tree cleanup/supervisor failure'} after ${timeout} ms\n${result.stderr}`),
    {code: result.status === 124 ? 'operation_timeout' : 'tree_cleanup_failed'});
  return result;
}
