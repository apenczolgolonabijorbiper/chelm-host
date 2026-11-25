#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import {
  randomUUID
} from 'node:crypto';
import {
  file,
  read,
  write,
  atomic,
  assert,
  safeAbs,
  hash
} from '../lib/util.mjs';
import {
  integrity,
  packageRoot
} from '../lib/harness.mjs';
import { installDependencies } from '../lib/dependencies.mjs';
import {inspectRuntime} from '../lib/runtime-readiness.mjs';
const begin = '<!-- chelm-host:begin -->',
  end = '<!-- chelm-host:end -->';

function installPackage(dest, source, options) {
  if (!fs.existsSync(dest) || options.upgrade && read(file(dest, 'RELEASE.json')).version !== source.manifest
    .version) {
    fs.mkdirSync(path.dirname(dest), {
      recursive: true
    });
    const stage = dest + '.' + randomUUID() + '.tmp';
    fs.mkdirSync(stage);
    try {
      for (const p of ['RELEASE.json', ...Object.keys(source.manifest.files)]) atomic(file(stage, p), fs
        .readFileSync(file(packageRoot, p)));
      if (!options['skip-dependencies']) installDependencies(stage, options);
      if (fs.existsSync(dest)) {
        const old = dest + '.' + randomUUID() + '.old';
        fs.renameSync(dest, old);
        try { fs.renameSync(stage, dest); }
        catch (e) { fs.renameSync(old, dest); throw e; }
        fs.rmSync(old, { recursive: true, maxRetries: 10, retryDelay: 100 });
      } else fs.renameSync(stage, dest);
    } finally { fs.rmSync(stage, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
  } else if (!options['skip-dependencies']) installDependencies(dest, options);
}

function resolveHint(repo, hint) {
  assert(typeof hint === 'string' && hint.length && !/[\r\n\0]/.test(hint), 'input_invalid',
    'Runtime hint must be one line');
  if (hint === '<private-runtime>') return hint;
  return path.isAbsolute(hint) ? safeAbs(hint) : file(repo, hint.replaceAll('\\', '/'));
}
export function install(options) {
  const source = integrity(packageRoot);
  assert(!source.problems.length, 'package_invalid', 'Source package failed integrity verification');
  assert(options.repo, 'usage', '--repo is required');
  const repo = safeAbs(options.repo);
  fs.mkdirSync(repo, {
    recursive: true
  });
  const dest = file(repo, 'vendor/chelm-host'),
    statePath = file(repo, '.chelm-install.json'),
    state = read(statePath, null);
  if (fs.existsSync(dest)) {
    const old = integrity(dest);
    assert(!old.problems.length, 'install_conflict', 'Installed package is edited: ' + old.problems.join(
      ', '));
    assert(old.manifest.version === source.manifest.version || options.upgrade, 'install_conflict',
      'Use --upgrade to replace the installed version');
    if (old.manifest.version === source.manifest.version) assert(JSON.stringify(old.manifest.files) === JSON
      .stringify(source.manifest.files), 'install_conflict', 'Same version has different package bytes');
  }
  const deferred = options['skip-agent-integration'] || options['defer-agent-integration'];
  if (deferred) {
    assert(!options['register-mcp'], 'usage',
      'MCP registration cannot be combined with deferred agent integration');
    const hint = options['runtime-hint'] ?? state?.runtime_hint ?? '<private-runtime>';
    const runtime_path_abs = resolveHint(repo, hint);
    const runtime_status = inspectRuntime(runtime_path_abs, file(dest,'bin/chelm.mjs'));
    installPackage(dest, source, options);
    const next = {
      ...state,
      schema_version: 1,
      version: source.manifest.version,
      runtime_hint: hint,
      integration_deferred: true
    };
    if (JSON.stringify(state) !== JSON.stringify(next)) write(statePath, next);
    return {
      installed_to: dest,
      integration_deferred: true,
      runtime_path_abs,
      runtime_status,
      messages: ['Agent integration deferred; rerun the installer without the defer/skip flag to install it.',runtime_status.message]
    };
  }
  const hint = options['runtime-hint'] ?? state?.runtime_hint ?? '<private-runtime>',
    block =
    `${begin}\nUse vendor/chelm-host/AGENTS.md for all Golem operations.\nRuntime: ${hint}\nWorker entry: node vendor/chelm-host/bin/chelm.mjs worker next --runtime ${hint} --input -\n${end}`;
  assert(!/[\r\n]/.test(hint), 'input_invalid', 'Runtime hint must be one line');
  const runtimePath = resolveHint(repo, hint);
  const runtime_status = inspectRuntime(runtimePath, file(dest,'bin/chelm.mjs'));
  const agentsPath = file(repo, 'AGENTS.md'),
    agents = fs.existsSync(agentsPath) ? fs.readFileSync(agentsPath, 'utf8') : '';
  const start = agents.indexOf(begin),
    finish = agents.indexOf(end);
  assert((start < 0) === (finish < 0) &&
    (start < 0 || finish > start) &&
    agents.indexOf(begin, start + 1) < 0 && agents.indexOf(end, finish + 1) < 0, 'install_conflict',
    'Malformed managed AGENTS block');
  const existing = start >= 0 ? agents.slice(start, finish + end.length) : null;
  if (existing) assert(state && hash(existing) === state.agents_hash, 'install_conflict',
    'Managed AGENTS block was edited');
  const nextAgents = existing ? agents.replace(existing, block) : agents + (agents && !agents.endsWith('\n') ?
    '\n' : '') + '\n' + block + '\n';
  const rule = '---\nalwaysApply: true\n---\nRead and follow vendor/chelm-host/AGENTS.md. Runtime: ' + hint +
    '\n',
    rulePath = file(repo, '.cursor/rules/chelm-host.mdc');
  if (fs.existsSync(rulePath)) assert(state && hash(fs.readFileSync(rulePath)) === state.rule_hash,
    'install_conflict', 'Managed Cursor rule was edited');
  const mcpPath = file(repo, '.cursor/mcp.json'),
    mcp = read(mcpPath, {
      mcpServers: {}
    });
  assert(mcp && typeof mcp === 'object' && mcp.mcpServers && typeof mcp.mcpServers === 'object',
    'install_conflict', 'Invalid Cursor MCP configuration');
  const server = {
    command: 'node',
    args: [file(repo, 'vendor/chelm-host/bin/chelm-mcp.mjs'), '--runtime', runtimePath]
  };
  if (options['register-mcp'] && mcp.mcpServers.chelm) assert(state?.mcp_hash === hash(JSON.stringify(mcp
    .mcpServers.chelm)), 'install_conflict', 'Existing chelm MCP server is not managed or was edited');
  // All conflicts are checked above before any package or integration write.
  installPackage(dest, source, options);
  if (nextAgents !== agents) atomic(agentsPath, nextAgents);
  if (!fs.existsSync(rulePath) || fs.readFileSync(rulePath, 'utf8') !== rule) atomic(rulePath, rule);
  if (options['register-mcp']) {
    const old = JSON.stringify(mcp.mcpServers.chelm);
    mcp.mcpServers.chelm = server;
    if (old !== JSON.stringify(server)) write(mcpPath, mcp);
  }
  const nextState = {
    schema_version: 1,
    version: source.manifest.version,
    runtime_hint: hint,
    integration_deferred: false,
    agents_hash: hash(block),
    rule_hash: hash(rule),
    ...(options['register-mcp'] ? {
      mcp_hash: hash(JSON.stringify(server))
    } : state?.mcp_hash ? {
      mcp_hash: state.mcp_hash
    } : {})
  };
  if (JSON.stringify(state) !== JSON.stringify(nextState)) write(statePath, nextState);
  return {
    installed_to: dest,
    mcp: server,
    runtime_path_abs: runtimePath,
    runtime_status,
    messages: [...(options['register-mcp'] ? [] : ['Add the returned mcp entry to your client configuration.']),runtime_status.message]
  };
}
try {
  const options = {};
  for (let i = 2; i < process.argv.length; i++) {
    const key = process.argv[i].slice(2);
    assert(['repo', 'runtime-hint', 'register-mcp', 'upgrade', 'skip-agent-integration',
        'defer-agent-integration', 'skip-dependencies', 'npm-cli'
      ].includes(key), 'usage',
      'Unknown installer option');
    options[key] = ['register-mcp', 'upgrade', 'skip-agent-integration', 'defer-agent-integration', 'skip-dependencies'].includes(
      key) ? true : process.argv[++i];
  }
  const result = install(options);
  process.stdout.write(JSON.stringify({
    ok: true,
    ...result
  }) + '\n');
} catch (e) {
  process.stdout.write(JSON.stringify({
    ok: false,
    error: {
      code: e.code ?? 'internal_error',
      message: e.message
    }
  }) + '\n');
  process.exitCode = 1;
}
