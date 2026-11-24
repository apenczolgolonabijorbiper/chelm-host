import test from './scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { integrity, packageRoot } from '../lib/harness.mjs';
import { dependencyStatus, installDependencies, resolveNpmCli } from '../lib/dependencies.mjs';
import { hash } from '../lib/util.mjs';
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chelm-deps-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}
test('managed dependencies are excluded only by an explicit thin manifest; source integrity stays strict', t => {
  const dir = temporary(t);
  fs.mkdirSync(path.join(dir, 'node_modules'));
  fs.writeFileSync(path.join(dir, 'node_modules/a'), 'dependency');
  fs.writeFileSync(path.join(dir, 'source'), 'immutable');
  const manifest = { schema_version: 1, files: { source: hash('immutable') },
    runtime_dependencies: { manager: 'npm', lockfile: 'package-lock.json' } };
  const save = () => fs.writeFileSync(path.join(dir, 'RELEASE.json'), JSON.stringify(manifest));
  save();
  assert.deepEqual(integrity(dir).problems, []);
  fs.writeFileSync(path.join(dir, 'source'), 'edited');
  assert.deepEqual(integrity(dir).problems, ['mismatched: source']);
  delete manifest.runtime_dependencies;
  manifest.files['node_modules/a'] = hash('dependency');
  save();
  fs.writeFileSync(path.join(dir, 'node_modules/a'), 'edited dependency');
  assert(integrity(dir).problems.includes('mismatched: node_modules/a'));
});
test('npm executes through node with an argv path containing spaces; failed repair preserves dependencies', t => {
  const dir = temporary(t);
  const target = path.join(dir, 'package');
  fs.mkdirSync(target);
  for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(packageRoot, name), path.join(target, name));
  fs.mkdirSync(path.join(target, 'node_modules'));
  fs.writeFileSync(path.join(target, 'node_modules/keep'), 'previous dependencies');
  const npm = path.join(dir, 'fake npm cli.js');
  fs.writeFileSync(npm, "if (process.argv[2] !== 'ci' || !process.argv.includes('--ignore-scripts')) process.exit(23); process.exit(42);");
  assert.equal(resolveNpmCli(npm), npm);
  assert.throws(() => installDependencies(target, { 'npm-cli': npm }), /restoration failed/);
  assert.equal(fs.readFileSync(path.join(target, 'node_modules/keep'), 'utf8'), 'previous dependencies');
  assert.deepEqual(fs.readdirSync(dir).sort(), ['fake npm cli.js', 'package']);
});
test('thin installer skips dependencies, reports remote setup steps and retains old version on failed upgrade', t => {
  if (!fs.existsSync(path.join(packageRoot, 'RELEASE.json'))) return t.skip('Staged release check');
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'RELEASE.json')));
  assert(manifest.runtime_dependencies);
  assert(!Object.keys(manifest.files).some(p => p.startsWith('node_modules/')));
  const dir = temporary(t), app = path.join(dir, 'application');
  const invoke = (...flags) => spawnSync(process.execPath, [path.join(packageRoot, 'integration/install.mjs'), '--repo', app, ...flags], { encoding: 'utf8' });
  let r = invoke('--skip-dependencies');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const installed = path.join(app, 'vendor/chelm-host');
  assert.equal(dependencyStatus(installed).ready, false);
  r = spawnSync(process.execPath, [path.join(installed, 'bin/chelm.mjs'), 'version'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const [bin, args] of [['chelm-serve.mjs', ['--config', 'unused.json']], ['chelm-remote-mcp.mjs', []]]) {
    r = spawnSync(process.execPath, [path.join(installed, 'bin', bin), ...args], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /install-dependencies.mjs/);
  }
  const installedManifest = path.join(installed, 'RELEASE.json');
  const previous = { ...manifest, version: '0.99.0' };
  fs.writeFileSync(installedManifest, JSON.stringify(previous));
  const agents = fs.readFileSync(path.join(app, 'AGENTS.md'));
  const state = fs.readFileSync(path.join(app, '.chelm-install.json'));
  const npm = path.join(dir, 'failed npm.js');
  fs.writeFileSync(npm, 'process.exit(42);');
  r = invoke('--upgrade', '--npm-cli', npm);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /dependency_install_failed/);
  assert.equal(JSON.parse(fs.readFileSync(installedManifest)).version, '0.99.0');
  assert.deepEqual(fs.readFileSync(path.join(app, 'AGENTS.md')), agents);
  assert.deepEqual(fs.readFileSync(path.join(app, '.chelm-install.json')), state);
  assert.deepEqual(fs.readdirSync(path.join(app, 'vendor')), ['chelm-host']);
});
test('restored release dependencies carry a locked receipt and installation is idempotent', t => {
  if (!fs.existsSync(path.join(packageRoot, 'RELEASE.json'))) return t.skip('Staged release check');
  assert(dependencyStatus(packageRoot).ready);
  const receipt = path.join(packageRoot, 'node_modules/.chelm-dependencies.json');
  const before = fs.statSync(receipt).mtimeMs;
  assert.equal(installDependencies(packageRoot).restored, false);
  assert.equal(fs.statSync(receipt).mtimeMs, before);
});
