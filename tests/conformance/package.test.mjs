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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chelm-install-'));
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
