#!/usr/bin/env node
import { integrity } from '../lib/harness.mjs';
import { root, installDependencies } from '../lib/dependencies.mjs';
import { assert } from '../lib/util.mjs';
try {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i].slice(2);
    assert(['package', 'npm-cli', 'force'].includes(key), 'usage', 'Unknown dependency installer option');
    options[key] = key === 'force' ? true : process.argv[++i];
  }
  const target = options.package ?? root;
  assert(!integrity(target).problems.length, 'package_invalid', 'Package source integrity failed');
  process.stdout.write(JSON.stringify({ ok: true, ...installDependencies(target, options) }) + '\n');
} catch (error) {
  process.stderr.write(error.message + '\n');
  process.exitCode = 1;
}
