import fs from 'node:fs';
import {
  performance
} from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import {
  createHash,
  randomUUID
} from 'node:crypto';
import {
  spawnSync
} from 'node:child_process';
export const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const now = () => new Date().toISOString();
export const hash = b => createHash('sha256').update(b).digest('hex');
export const json = v => JSON.stringify(v, null, 2) + '\n';
export class ChelmError extends Error {
  constructor(code, message, details = {}, exit = 1) {
    super(message);
    this.code = code;
    this.details = details;
    this.exit = exit;
  }
}
export const fail = (code, message, details = {}, exit = 1) => {
  throw new ChelmError(code, message, details, exit);
};
export const assert = (ok, code, message, details = {}, exit = 1) => {
  if (!ok) fail(code, message, details, exit);
};
export const id = v => {
  assert(uuid.test(v), 'invalid_id', 'Expected a lowercase UUID');
  return v;
};
export function safeAbs(p) {
  let at = path.parse(path.resolve(p)).root;
  for (const segment of path.resolve(p).slice(at.length).split(path.sep)) {
    at = path.join(at, segment);
    if (fs.existsSync(at) || (() => {
        try {
          return fs.lstatSync(at)
        } catch {
          return false
        }
      })()) assert(!fs.lstatSync(at).isSymbolicLink(), 'unsafe_path', 'Symbolic link refused: ' + at);
  }
  return path.resolve(p);
}
export function relative(p) {
  assert(typeof p === 'string' && p.length && !/[\\:\x00-\x1f*?\[\]]/.test(p) && !path.isAbsolute(p) && p
    .split('/').every(s => s && s !== '.' && s !== '..' && s.toLowerCase() !== '.git'), 'unsafe_path',
    'Unsafe relative path');
  return p;
}
export const file = (root, p) => safeAbs(path.join(safeAbs(root), relative(p)));
export const read = (p, fallback) => {
  safeAbs(p);
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw e;
  }
};
export function renameWithRetry(from, to, {
  platform = process.platform,
  rename = fs.renameSync,
  wait = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  maxAttempts = 8
} = {}) {
  for (let attempt = 0;; attempt++) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      if (platform !== 'win32' || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >=
        maxAttempts - 1) throw error;
      wait(Math.min(10 * 2 ** attempt, 250));
    }
  }
}
export function atomic(p, bytes) {
  safeAbs(p);
  fs.mkdirSync(path.dirname(p), {
    recursive: true
  });
  const tmp = p + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(tmp, bytes, {
      flag: 'wx'
    });
    renameWithRetry(tmp, p);
  } finally {
    fs.rmSync(tmp, {
      force: true
    });
  }
}
export const write = (p, v) => atomic(p, json(v));
export function child(exe, args, {
  input,
  timeout = 60000,
  cwd,
  env = {},
  encoding = 'utf8'
} = {}) {
  const clean = {
    ...process.env
  };
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES'
    ]) delete clean[k];
  const started = performance.now();
  const r = spawnSync(exe, args, {
    input,
    timeout,
    cwd,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
    shell: false,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    env: {
      ...clean,
      ...env,
      GIT_TERMINAL_PROMPT: '0',
      GCM_INTERACTIVE: 'Never'
    }
  });
  if (process.env.CHELM_TIMINGS_FILE) {
    const kind = String(args[0]).endsWith('process.py') ? 'indexer' : args[1] === 'validate' ? 'validator' :
      args[1] === 'context' ? 'retrieval' : 'other';
    fs.appendFileSync(safeAbs(process.env.CHELM_TIMINGS_FILE), JSON.stringify({
      kind,
      elapsed_ms: performance.now() - started
    }) + '\n');
  }
  if (r.error || r.status !== 0) {
    const verb = args.includes('-C') ? args[args.indexOf('-C') + 2] : args[0];
    fail('child_failed', 'Command failed: ' + path.basename(exe) + ' ' + String(verb ?? '') +
      ' (' + (r.error?.code ?? 'exit ' + r.status) + ')', {
      child_error: r.error?.code ?? null,
      diagnostic: String(r.stderr || r.error?.message || '').slice(0, 2000)
    });
  }
  return r.stdout;
}
let gitExecutable = 'git';
export const setGitExecutable = executable => {
  gitExecutable = executable;
};
// Local runtime Git must not depend on a loaded user profile or global hooks/config.
export const git = (root, args, opts = {}) => child(gitExecutable, ['-c', 'core.autocrlf=false', '-C',
  safeAbs(root), ...args
], {
  ...opts,
  env: {
    ...opts.env,
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1'
  }
});
export function resolveActor({
  platform = process.platform,
  userInfo = () => os.userInfo(),
  whoami
} = {}) {
  try {
    return userInfo().username;
  } catch (error) {
    if (platform !== 'win32') throw error;
    // An unloaded Windows virtual-account profile can make libuv's passwd lookup fail.
    // Obtain the security principal from the OS; never trust USERNAME/USERDOMAIN inputs.
    const result = whoami ? whoami() : spawnSync(path.join(process.env.SystemRoot ?? 'C:\\Windows',
      'System32', 'whoami.exe'), ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 1024 * 1024,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const sid = result.status === 0 ? String(result.stdout).match(
      /(?:^|[",\s])(S-1-(?:[0-9]+-)*[0-9]+)(?:[",\s]|$)/)?.[1] : null;
    assert(sid, 'identity_unavailable', 'Cannot resolve the Windows process security identity');
    return sid;
  }
}
let processActor;
export const actor = () => processActor ??= resolveActor();
export function tail(p, n = 200) {
  safeAbs(p);
  if (!fs.existsSync(p)) return [];
  const fd = fs.openSync(p, 'r');
  try {
    let pos = fs.fstatSync(fd).size,
      parts = [],
      lines = 0;
    while (pos > 0 && lines <= n) {
      const size = Math.min(65536, pos),
        b = Buffer.alloc(size);
      pos -= size;
      fs.readSync(fd, b, 0, size, pos);
      parts.unshift(b);
      lines += b.toString().split('\n').length - 1;
    }
    return Buffer.concat(parts).toString('utf8').split('\n').filter(Boolean).slice(-n).map(s => JSON.parse(
      s));
  } finally {
    fs.closeSync(fd);
  }
}
export async function lock(root, command, fn) {
  const p = file(root, 'host/locks/operation.lock');
  fs.mkdirSync(path.dirname(p), {
    recursive: true
  });
  let fd;
  try {
    fd = fs.openSync(p, 'wx');
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const old = read(p);
    let alive = true;
    if (old.host === os.hostname()) try {
      process.kill(old.pid, 0);
    } catch (e) {
      if (e.code === 'ESRCH') alive = false;
    }
    if (!alive && Date.now() - Date.parse(old.started_at) > 600000) {
      fs.unlinkSync(p);
      fd = fs.openSync(p, 'wx');
      log(root, 'stale-lock', 'recovered', {});
    } else fail('busy', 'Another runtime operation is in progress');
  }
  fs.writeFileSync(fd, json({
    pid: process.pid,
    host: os.hostname(),
    command,
    started_at: now()
  }));
  fs.closeSync(fd);
  const start = Date.now();
  try {
    const result = await fn();
    log(root, command, 'ok', {
      duration_ms: Date.now() - start
    });
    return result;
  } catch (e) {
    log(root, command, e.code ?? 'failed', {
      duration_ms: Date.now() - start
    });
    throw e;
  } finally {
    fs.rmSync(p, {
      force: true
    });
  }
}
export function log(root, command, outcome, extra) {
  const p = file(root, 'host/logs/chelm.jsonl');
  fs.mkdirSync(path.dirname(p), {
    recursive: true
  });
  if (fs.existsSync(p) && fs.statSync(p).size > 10 * 1024 * 1024) {
    fs.rmSync(p + '.5', {
      force: true
    });
    for (let i = 4; i >= 1; i--) {
      if (fs.existsSync(p + '.' + i)) fs.renameSync(p + '.' + i, p + '.' + (i + 1));
    }
    fs.renameSync(p, p + '.1');
  }
  fs.appendFileSync(p, JSON.stringify({
    at: now(),
    command,
    runtime_id: read(file(root, 'chelm.runtime.json'), {}).runtime_id,
    actor: actor(),
    outcome,
    ...extra
  }) + '\n');
}
export function snapshot(root, ref = 'HEAD') {
  const rows = git(root, ['ls-tree', '-r', '-z', ref]).split('\0').filter(Boolean).map(s => {
    const m = s.match(/^(100644|100755) blob ([a-f0-9]+)\t([\s\S]+)$/);
    assert(m, 'package_invalid', 'Unsupported Git object');
    return {
      sha: m[2],
      path: relative(m[3])
    };
  });
  const hashes = [...new Set(rows.map(r => r.sha))],
    data = git(root, ['cat-file', '--batch'], {
      input: hashes.join('\n') + '\n',
      encoding: null
    }),
    blobs = new Map();
  let pos = 0;
  for (const sha of hashes) {
    const end = data.indexOf(10, pos),
      m = data.subarray(pos, end).toString().match(/^([a-f0-9]+) blob (\d+)$/);
    assert(m && m[1] === sha, 'package_invalid', 'Invalid Git batch');
    const start = end + 1,
      finish = start + Number(m[2]);
    assert(finish < data.length && data[finish] === 10, 'package_invalid', 'Truncated Git batch');
    blobs.set(sha, data.subarray(start, finish));
    pos = finish + 1;
  }
  return new Map(rows.map(r => [r.path, blobs.get(r.sha)]));
}
export function materialize(tree, root) {
  fs.mkdirSync(root, {
    recursive: true
  });
  for (const [p, b] of tree) atomic(file(root, p), b);
  fs.mkdirSync(file(root, 'inbox'), {
    recursive: true
  });
}
export function parseNote(p, text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  assert(m, 'malformed_sources', 'Incomplete source');
  const fields = Object.create(null);
  for (const line of m[1].split('\n')) {
    const h = line.match(/^([a-z_]+):\s*(.*?)\s*$/);
    assert(h && !Object.hasOwn(fields, h[1]), 'malformed_sources', 'Invalid source header');
    fields[h[1]] = h[2].startsWith('"') ? JSON.parse(h[2]) : h[2];
  }
  assert(uuid.test(fields.id) && p === `inbox/${fields.id}.md` && m[2].trim() && Number.isFinite(Date.parse(
    fields.recorded_at)), 'malformed_sources', 'Invalid source');
  return {
    ...fields,
    path: p,
    body: m[2],
    sha256: hash(text)
  };
}
