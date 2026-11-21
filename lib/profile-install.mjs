import fs from 'node:fs';
import path from 'node:path';
import {
  file,
  read,
  atomic,
  hash,
  assert,
  git,
  snapshot
} from './util.mjs';
import {
  loadProfile,
  instancePath
} from './profile.mjs';
import {
  harness
} from './harness.mjs';
import {
  commitAll
} from './runtime.mjs';

async function readProfileBundle(source) {
  assert(typeof source === 'string' && source.length, 'usage', 'Profile source directory is required', {},
    2);
  source = path.resolve(source);
  const configuration = fs.readFileSync(file(source, 'golem.config.json'));
  const selection = JSON.parse(configuration.toString('utf8'));
  assert(selection.schema_version === 1, 'profile_invalid', 'Profile mirror needs configuration schema 1');
  await loadProfile(source);
  const selected = selection.profile;
  const paths = selected ? [selected.path, ...(selected.sections ?? []).map(s => s.path), ...(selected
    .vocabulary ? [selected.vocabulary] : [])] : [];
  const files = new Map([
    ['golem.config.json', configuration]
  ]);
  for (const p of paths) {
    instancePath(p);
    assert(p !== 'golem.config.json' && !/^(memory|questions|instance|inbox|evidence|vendor)\//.test(p),
      'profile_invalid', 'Selected profile path is reserved: ' + p);
    files.set(p, fs.readFileSync(file(source, p)));
  }
  return {
    source,
    files
  };
}
export async function profileBundle(source) {
  try {
    return await readProfileBundle(source);
  } catch (e) {
    if (['unsafe_path', 'usage', 'profile_invalid'].includes(e.code)) throw e;
    const error = new Error('Invalid profile mirror: ' + e.message);
    error.code = 'profile_invalid';
    error.exit = 1;
    // CLI refusals use ChelmError so malformed mirrors never look like internal failures.
    const {
      fail
    } = await import('./util.mjs');
    fail('profile_invalid', error.message);
  }
}
export async function checkProfile(cfg, source = cfg.profile_expectation?.source) {
  assert(source, 'usage', 'Specify --source or configure profile_expectation', {}, 2);
  try {
    const bundle = await profileBundle(source);
    const files = [...bundle.files].map(([p, b]) => {
      const installed = file(cfg.instance.path, p);
      const actual = fs.existsSync(installed) ? hash(fs.readFileSync(installed)) : null;
      return {
        path: p,
        expected_sha256: hash(b),
        installed_sha256: actual,
        matches: actual === hash(b)
      };
    });
    return {
      source_abs: bundle.source,
      matches: files.every(r => r.matches),
      files
    };
  } catch (e) {
    return {
      source_abs: path.resolve(source),
      matches: false,
      files: [],
      problems: [{
        code: e.code ?? 'profile_invalid',
        message: e.message
      }]
    };
  }
}
export async function installProfile(root, cfg, source) {
  const bundle = await profileBundle(source),
    tree = snapshot(cfg.instance.path);
  const targets = [...bundle.files.keys()];
  // Protect pre-existing drafts and index entries before any write.
  const staged = git(cfg.instance.path, ['diff', '--cached', '--name-only', '--', ...targets]).trim();
  assert(!staged, 'profile_dirty', 'Preserve staged profile changes before installation');
  const backup = new Map();
  for (const p of targets) {
    const target = file(cfg.instance.path, p),
      b = fs.existsSync(target) ? fs.readFileSync(target) : null;
    assert(b === null && !tree.has(p) || b !== null && tree.has(p) && hash(b) === hash(tree.get(p)),
      'profile_dirty', 'Preserve profile draft: ' + p);
    backup.set(p, b);
  }
  try {
    for (const [p, b] of bundle.files) atomic(file(cfg.instance.path, p), b);
    harness(cfg, 'validate', cfg.instance.path);
    const changed = targets.filter(p => !tree.has(p) || hash(tree.get(p)) !== hash(bundle.files.get(p)));
    if (changed.length) commitAll(cfg, 'profile: install byte-exact application mirror', targets);
    return {
      changed: changed.length > 0,
      ...await checkProfile(cfg, source)
    };
  } catch (e) {
    for (const [p, b] of backup)
      if (b === null) fs.rmSync(file(cfg.instance.path, p), {
        force: true
      });
      else atomic(file(cfg.instance.path, p), b);
    git(cfg.instance.path, ['reset', '-q', 'HEAD', '--', ...targets]);
    throw e;
  }
}
