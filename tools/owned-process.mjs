import {spawn, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

function outcome(result, phase, timeout) {
  if (result.status === 124 || result.status === 125) result.error ??= Object.assign(
    Error(`${phase}: ${result.status === 124 ? 'operation timeout/cancellation' : 'tree cleanup/supervisor failure'} after ${timeout} ms\n${result.stderr}`),
    {code: result.status === 124 ? 'operation_timeout' : 'tree_cleanup_failed'});
  return result;
}

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
  return outcome(result, phase, timeout);
}

// The same supervisor and ownership policy, while leaving the caller's event
// loop free to report progress. Output remains bounded and retained on failure.
export function ownedProcessAsync(executable, args, {timeout = 60000, phase = 'command',
  python = process.env.GOLEM_PYTHON ?? (process.platform === 'win32' ? 'py' : 'python3'),
  input, ...options} = {}) {
  return new Promise(resolve => {
    const child = spawn(python, [fileURLToPath(new URL('./owned-process.py', import.meta.url)),
      String(process.pid), String(timeout / 1000), phase, executable, ...args], {
      ...options, stdio: ['pipe','pipe','pipe'], detached: process.platform !== 'win32',
      timeout: timeout + 5000, killSignal: 'SIGTERM'
    });
    const chunks = {stdout: [], stderr: []}, sizes = {stdout: 0, stderr: 0};
    let error;
    child.on('error', value => { error ??= value; });
    // An early child exit may close stdin; its exit/error is still authoritative.
    child.stdin.on('error', value => { if (value.code !== 'EPIPE') error ??= value; });
    for (const stream of ['stdout','stderr']) child[stream].on('data', chunk => {
      const remaining = 16 * 1024 * 1024 - sizes[stream];
      if (remaining > 0) chunks[stream].push(chunk.subarray(0, remaining));
      sizes[stream] += chunk.length;
      if (sizes[stream] > 16 * 1024 * 1024 && !error) {
        error = Object.assign(Error('Owned process output exceeded its buffer'), {code:'ENOBUFS'});
        child.kill('SIGTERM');
      }
    });
    child.on('close', (status, signal) => resolve(outcome({status, signal, error,
      stdout: Buffer.concat(chunks.stdout).toString('utf8'),
      stderr: Buffer.concat(chunks.stderr).toString('utf8')}, phase, timeout)));
    child.stdin.end(input);
  });
}
