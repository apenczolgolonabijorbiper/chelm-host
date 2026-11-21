import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  spawnSync
} from 'node:child_process';
import {
  integrity
} from '../../lib/harness.mjs';
import {
  validateShape
} from '../../lib/schema.mjs';
import {
  fixture,
  ok,
  refuse,
  source,
  harness
} from '../helpers.mjs';
test('PKG/INS-1..6: release integrity, installer idempotence and conflict preflight', t => {
  if (!fs.existsSync(path.join(source, 'RELEASE.json'))) {
    t.skip('Run by the release builder against the staged distribution');
    return;
  }
  assert.deepEqual(integrity(source).problems, []);
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chelm-install-'));
  t.after(() => fs.rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100
  }));
  const app = path.join(root, 'App żółć spaces');
  fs.mkdirSync(app);
  fs.writeFileSync(path.join(app, 'AGENTS.md'), '# Existing text\n');
  const call = () => spawnSync(process.execPath, [path.join(source, 'integration/install.mjs'), '--repo',
    app, '--runtime-hint', path.join(root, 'private runtime'), '--register-mcp'
  ], {
    encoding: 'utf8'
  });
  let r = call();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const agents = fs.readFileSync(path.join(app, 'AGENTS.md'), 'utf8');
  assert(agents.startsWith('# Existing text\n'));
  const mtime = fs.statSync(path.join(app, 'AGENTS.md')).mtimeMs;
  r = call();
  assert.equal(r.status, 0, r.stdout);
  assert.equal(fs.statSync(path.join(app, 'AGENTS.md')).mtimeMs, mtime);
  assert.deepEqual(integrity(path.join(app, 'vendor/chelm-host')).problems, []);
  fs.appendFileSync(path.join(app, '.cursor/rules/chelm-host.mdc'), 'Edited\n');
  r = call();
  assert.equal(r.status, 1);
  assert.equal(JSON.parse(r.stdout).error.code, 'install_conflict');
  assert.equal(fs.readFileSync(path.join(app, 'AGENTS.md'), 'utf8'), agents);
});
test('Schemas: runtime and all published read views satisfy the distributed schemas', t => {
  const f = fixture(t);
  for (const name of ['summary', 'observations', 'subjects', 'questions', 'answers', 'journals',
      'warnings', 'requests', 'delegations'
    ]) {
    const schema = JSON.parse(fs.readFileSync(path.join(source, 'schemas/read-model/' + name +
      '.schema.json')));
    const value = ok('read', name, f.root).view;
    assert.deepEqual(validateShape(value, schema), [], name);
  }
  const configPath = path.join(f.root, 'chelm.runtime.json'),
    cfg = JSON.parse(fs.readFileSync(configPath));
  cfg.intake.unknown = true;
  fs.writeFileSync(configPath, JSON.stringify(cfg));
  refuse('config_invalid', 'status', null, f.root);
});

test('VF-5: deferred integration leaves agent files untouched and resolves a repository-relative runtime',
  t => {
    if (!fs.existsSync(path.join(source, 'RELEASE.json'))) {
      t.skip('Staged distribution check');
      return;
    }
    const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chelm-defer-'));
    t.after(() => fs.rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100
    }));
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# Application instructions\n');
    const call = (...flags) => spawnSync(process.execPath, [path.join(source, 'integration/install.mjs'),
      '--repo', root, '--runtime-hint', 'App_Data/golem-runtime', ...flags
    ], {
      encoding: 'utf8'
    });
    let r = call('--skip-agent-integration');
    assert.equal(r.status, 0, r.stdout);
    assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), '# Application instructions\n');
    assert(!fs.existsSync(path.join(root, '.cursor')));
    assert.equal(JSON.parse(r.stdout).integration_deferred, true);
    r = call('--register-mcp');
    assert.equal(r.status, 0, r.stdout);
    assert(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8').startsWith(
    '# Application instructions\n'));
    const mcp = JSON.parse(fs.readFileSync(path.join(root, '.cursor/mcp.json')));
    assert.equal(mcp.mcpServers.chelm.args.at(-1), path.join(root, 'App_Data/golem-runtime'));
    const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    r = call('--defer-agent-integration');
    assert.equal(r.status, 0, r.stdout);
    assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), agents);
  });

test('VF-7: packaged service probe completes a synthetic lease under the executing identity', t => {
  if (!fs.existsSync(path.join(source, 'RELEASE.json'))) {
    t.skip('Staged distribution check');
    return;
  }
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chelm-service-'));
  t.after(() => fs.rmSync(base, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100
  }));
  const config = path.join(base, 'probe.json');
  fs.writeFileSync(config, JSON.stringify({
    runtime: path.join(base, 'runtime'),
    harness,
    python: process.env.GOLEM_PYTHON ?? (process.platform === 'win32' ? 'py' : 'python3'),
    git: 'git'
  }));
  const r = spawnSync(process.execPath, [path.join(source, 'tools/service-probe.mjs'), config], {
    encoding: 'utf8',
    timeout: 180000
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const value = JSON.parse(r.stdout);
  assert.equal(value.passed, true);
  assert.equal(value.processed, 1);
  assert.equal(value.claims, 1);
});
