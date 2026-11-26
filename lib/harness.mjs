import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  fileURLToPath
} from 'node:url';
import {
  read,
  write,
  hash,
  file,
  safeAbs,
  child,
  assert,
  fail,
  snapshot,
  materialize,
  now
} from './util.mjs';
import {featureStatus} from '../tools/probe-harness.mjs';
export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compatibility = read(file(packageRoot,'compatibility.json'));
export const qualification = read(file(packageRoot,'harness-compatibility.json'));
const detectedCache = new Map();
export const contracts = {
  app: 1,
  worker: 2,
  read_model: 1,
  runtime_config: 2,
  remote_worker: 2,
  cognitive_task: 1,
  memory_worker: 3,
  provider_runtime_config: 3,
  runtime_checkpoint: 1,
  durable_session: 1
};
export const capabilities = ['remote-worker-v2', 'harness-merge', 'purpose-guidance-v2', 'profile-install-v1',
  'core-policies-v2',
  'producer-receipts-v1', 'mcp-worker-v1', 'runtime-checkpoint-v1', 'durable-session-v1'
];
export const version = () => ({
  package_version: '1.3.1',
  contracts,
  harness_supported: compatibility.harness_supported,
  supported_harness_versions: Object.keys(qualification.approved_releases),
  reference_harness_version: qualification.reference_version,
  capabilities,
  memory_providers: {status:'published',worker_contract:3,provider_version:1,host_api_version:2,runtime_config:3,production_enabled:true},
  cognitive_tasks: {contract:1,status:'supported',required_capabilities:['cognitive-task-v1','cognitive-context-v1','cognitive-result-v1','learning-hypothesis-v1','hypothesis-unknown-confidence-v1']}
});
export function integrity(root) {
  root = safeAbs(root);
  const manifest = read(file(root, 'RELEASE.json')),
    problems = [];
  assert(manifest.schema_version === 1 && manifest.files && typeof manifest.files === 'object',
    'package_invalid', 'Invalid release manifest');
  const listed = new Set(Object.keys(manifest.files));
  const managedDependencies = manifest.runtime_dependencies?.manager === 'npm' &&
    manifest.runtime_dependencies?.lockfile === 'package-lock.json' &&
    ![...listed].some(p => p.startsWith('node_modules/'));


  function walk(dir, rel = '') {
    for (const e of fs.readdirSync(dir, {
        withFileTypes: true
      })) {
      const p = rel + e.name;
      if (e.isSymbolicLink()) {
        problems.push('symlink: ' + p);
        continue;
      }
      if (p === 'node_modules' && e.isDirectory() && managedDependencies) continue;
      if (e.isDirectory()) walk(path.join(dir, e.name), p + '/');
      else if (p !== 'RELEASE.json') {
        if (!listed.has(p)) problems.push('unlisted: ' + p);
        else if (hash(fs.readFileSync(file(root, p))) !== manifest.files[p]) problems.push('mismatched: ' +
          p);
        listed.delete(p);
      }
    }
  }
  walk(root);
  for (const p of listed) problems.push('missing: ' + p);
  return {
    manifest,
    problems
  };
}
export function verifyHarness(cfg) {
  const root = safeAbs(cfg.harness.root);
  let checked;
  try {
    checked = integrity(root);
  } catch (e) {
    fail('package_invalid', 'Harness release integrity unavailable', {
      diagnostic: e.message
    });
  }
  assert(checked.problems.length === 0, 'package_invalid', 'Harness release integrity failed');
  const entry=qualification.approved_releases[checked.manifest.version];
  assert(entry, 'harness_unsupported', 'Harness release is not approved; run isolated qualification before promotion',
    {version:checked.manifest.version,approved:Object.keys(qualification.approved_releases)});
  const manifest_sha256=hash(fs.readFileSync(file(root,'RELEASE.json')));
  assert(manifest_sha256===entry.manifest_sha256,'package_invalid','Harness manifest differs from its approved release identity');
  const key=root+':'+manifest_sha256;
  let detected=detectedCache.get(key);
  if(!detected) {
    detected=JSON.parse(child(cfg.harness.node??process.execPath,[file(packageRoot,'tools/probe-harness.mjs'),root,
      cfg.harness.python??(process.platform==='win32'?'py':'python3'),cfg.harness.git??'git']));
    detectedCache.set(key,detected);
  }
  const features=featureStatus(qualification.requirements,detected,p=>fs.existsSync(file(root,p)));
  for(const [name,result] of Object.entries(features)) if(!entry.features.includes(name))features[name]={status:'unsupported',missing:['Feature has not been approved for this release']};
  assert(features.file_worker.status==='pass','harness_unsupported','Harness file-worker contracts unavailable',{features});
  if(cfg.memory)assert(features.memory_provider.status==='pass','provider_unsupported','Harness provider contracts unavailable',{features});
  return {...checked,compatibility:{version:entry.version,origin:entry.release_url,archive:entry.archive,
    archive_sha256:entry.archive_sha256,manifest_sha256,required:qualification.requirements,detected,features,
    checkpoint:qualification.checkpoint_policy}};
}
export function ensureHarness(cfg) {
  // Always recheck bytes, even when contract discovery is cached in this process.
  return verifyHarness(cfg);
}
export function requireHarnessFeature(cfg,name) {
  const result=verifyHarness(cfg).compatibility.features[name];
  assert(result?.status==='pass','capability_unavailable','Harness feature is not approved: '+name,{feature:result});
}
export function harness(cfg, command, root, options = {}) {
  ensureHarness(cfg);
  const args = [file(cfg.harness.root, 'processor/memory-tool.mjs'), command, '--root', root];
  for (const [k, v] of Object.entries(options))
    if (v !== undefined && v !== null) args.push('--' + k.replaceAll('_', '-'), String(v));
  try {
    return JSON.parse(child(cfg.harness.node, args));
  } catch (e) {
    fail('validation_failed', e.details?.diagnostic?.split('\n')[0] || e.message, {
      command
    });
  }
}
export function index(cfg, instance) {
  ensureHarness(cfg);
  const out = child(cfg.harness.python, [file(cfg.harness.root, 'processor/process.py'), '--root',
    instance
  ], {
    timeout: 300000
  });
  return out.split('\n').filter(s => s.startsWith('Indexed:')).length;
}
export function committedHarness(cfg, instance, command, options = {}) {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chelm-snapshot-'));
  try {
    materialize(snapshot(instance), tmp);
    return harness(cfg, command, tmp, options);
  } finally {
    fs.rmSync(tmp, {
      recursive: true,
      force: true
    });
  }
}
export function verify(cfg) {
  const problems = [];
  let selected_harness=null;
  try {
    problems.push(...integrity(packageRoot).problems.map(x => 'chelm: ' + x));
  } catch (e) {
    problems.push('chelm: ' + e.message);
  }
  try {
    selected_harness=verifyHarness(cfg).compatibility;
  } catch (e) {
    problems.push(e.message);
  }
  for (const [exe, args] of [
      [cfg.harness.node, ['--version']],
      [cfg.harness.python, ['--version']],
      [cfg.harness.git, ['--version']]
    ]) try {
    const v = child(exe, args);
    if (exe === cfg.harness.node) {
      const [a, b] = v.trim().replace(/^v/, '').split('.').map(Number);
      if (a < 22 || a === 22 && b < 12) problems.push('Node >=22.12 required');
    }
    if (exe === cfg.harness.python) {
      const m = v.match(/(\d+)\.(\d+)/);
      if (!m || +m[1] < 3 || +m[1] === 3 && +m[2] < 12) problems.push('Python >=3.12 required');
    }
  } catch {
    problems.push('Tool unavailable: ' + exe);
  }
  return {
    problems, selected_harness
  };
}

export async function mergeHarness(cfg, options) {
  ensureHarness(cfg);
  const {
    boundedSpawn
  } = await import('./backend-support.mjs');
  const args = [file(cfg.harness.root, 'processor/memory-tool.mjs'), 'merge'];
  for (const [k, v] of Object.entries(options)) args.push('--' + k, v);
  const result = boundedSpawn(cfg.harness.node, args, {
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 64 * 1024 * 1024
  });
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    fail('validation_failed', 'Harness merge did not return a JSON report');
  }
  assert(result.status === 0 && !report.conflict_summary?.total, 'merge_conflict',
    'Harness refused the candidate merge', {
      report
    });
  return report;
}
