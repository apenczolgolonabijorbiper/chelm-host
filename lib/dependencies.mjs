// Installer-managed dependencies. This module intentionally uses only Node built-ins.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hash, read, write, safeAbs, assert, renameWithRetry } from './util.mjs';
export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const receiptName = '.chelm-dependencies.json';
const remove = p => fs.rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
export function dependencyStatus(packageDir = root) {
  try {
    packageDir = safeAbs(packageDir);
    const lockHash = hash(fs.readFileSync(path.join(packageDir, 'package-lock.json')));
    const dependencies = read(path.join(packageDir, 'package.json')).dependencies;
    const manifest = read(path.join(packageDir, 'RELEASE.json'), null);
    // Source checkouts and legacy bundled releases have no installer receipt.
    if (manifest?.runtime_dependencies?.manager === 'npm') {
      const receipt = read(path.join(packageDir, 'node_modules', receiptName));
      if (receipt.lockfile_sha256 !== lockHash) throw Error('Dependency lockfile changed');
    }
    for (const [name, version] of Object.entries(dependencies)) {
      const installed = read(path.join(packageDir, 'node_modules', name, 'package.json'));
      if (installed.version !== version) throw Error('Incorrect dependency: ' + name);
    }
    return { ready: true, lockfile_sha256: lockHash, dependencies };
  } catch (error) {
    return { ready: false, diagnostic: error.message };
  }
}
export function requireDependencies(packageDir = root) {
  assert(dependencyStatus(packageDir).ready, 'dependencies_missing',
    'Remote MCP dependencies are missing or outdated. Run node "' +
    path.join(packageDir, 'integration/install-dependencies.mjs') + '" (requires npm).');
}
export function resolveNpmCli(explicit, env = process.env, executable = process.execPath) {
  const candidates = [explicit ?? env.CHELM_NPM_CLI, env.npm_execpath,
    path.join(path.dirname(executable), 'node_modules/npm/bin/npm-cli.js'),
    path.resolve(path.dirname(executable), '../lib/node_modules/npm/bin/npm-cli.js')];
  for (const folder of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    candidates.push(path.join(folder, 'node_modules/npm/bin/npm-cli.js'));
    try { candidates.push(fs.realpathSync(path.join(folder, 'npm'))); } catch {}
  }
  const selected = candidates.find(p => p && fs.existsSync(p) &&
    (p === (explicit ?? env.CHELM_NPM_CLI) || path.basename(p) === 'npm-cli.js'));
  assert(selected, 'npm_unavailable', 'npm is required; install npm or use --skip-dependencies for local-only operation. Set --npm-cli <npm-cli.js> to override discovery.');
  return path.resolve(selected);
}
export function installDependencies(packageDir = root, options = {}) {
  packageDir = safeAbs(packageDir);
  const before = dependencyStatus(packageDir);
  if (before.ready && !options.force) return { ...before, restored: false };
  const npmCli = resolveNpmCli(options['npm-cli']);
  // Sibling workspace allows atomic activation on the same filesystem.
  const temp = fs.mkdtempSync(packageDir + '.deps-');
  const target = safeAbs(path.join(packageDir, 'node_modules'));
  const backup = path.join(temp, 'previous');
  try {
    for (const name of ['package.json', 'package-lock.json'])
      fs.copyFileSync(path.join(packageDir, name), path.join(temp, name));
    const result = spawnSync(process.execPath, [npmCli, 'ci', '--omit=dev', '--ignore-scripts',
      '--no-audit', '--no-fund', '--prefer-offline'], {
      cwd: temp, encoding: 'utf8', timeout: 300000, maxBuffer: 4 * 1024 * 1024,
      windowsHide: true
    });
    assert(!result.error && result.status === 0, 'dependency_install_failed',
      'Locked dependency restoration failed; existing installation retained. ' +
      (result.error?.message ?? result.stderr ?? '').slice(-2000));
    const checked = dependencyStatus(temp);
    assert(checked.ready, 'dependency_install_failed', 'Restored dependency versions differ from package.json');
    write(path.join(temp, 'node_modules', receiptName), {
      schema_version: 1, lockfile_sha256: checked.lockfile_sha256, dependencies: checked.dependencies
    });
    if (fs.existsSync(target)) renameWithRetry(target, backup);
    try { renameWithRetry(path.join(temp, 'node_modules'), target); }
    catch (error) {
      if (fs.existsSync(backup)) renameWithRetry(backup, target);
      throw error;
    }
    return { ...checked, restored: true };
  } finally { remove(temp); }
}
