import fs from 'node:fs';
import path from 'node:path';
import {file,read,assert} from './util.mjs';
import {validateShape} from './schema.mjs';
import {packageRoot} from './harness.mjs';

// Preserved byte-for-byte from v0.2.0 (2739a4ef34a037a8d0bec2be5c8f95ca3b6f96fc).
// Recognition only. Current config validation and explicit cutover remain separate.
export function legacyConfig(raw) {
  return raw?.schema_version === 1 && validateShape(raw,
    read(file(packageRoot,'schemas/legacy/runtime-config-v1.schema.json'))).length === 0;
}
export function migrationGuidance(root, cli = file(packageRoot,'bin/chelm.mjs')) {
  const argv=[cli,'migrate','--runtime',root];
  const posix=[process.execPath,...argv].map(s=>"'"+s.replaceAll("'", "'\\''")+"'").join(' ');
  const powershell='& '+[process.execPath,...argv].map(s=>"'"+s.replaceAll("'","''")+"'").join(' ');
  return {detected_version:1,supported_versions:[2,3],runtime_ready:false,
    preflight:{executable:process.execPath,argv,posix,powershell},
    message:'Runtime migration required. Run preflight: '+(process.platform==='win32'?powershell:posix)};
}
export function requireCurrentVersion(raw, root) {
  if(legacyConfig(raw)) {
    const details=migrationGuidance(root);
    assert(false,'migration_required',details.message,details);
  }
  assert([2,3].includes(raw?.schema_version),'config_invalid','Unsupported or malformed runtime config version',
    {detected_version:raw?.schema_version??null,supported_versions:[2,3]});
}
export function inspectRuntime(root, cli) {
  if(root==='<private-runtime>')return {status:'unresolved',runtime_ready:null,
    message:'Package installed; runtime hint is unresolved. Select and verify an existing runtime explicitly.'};
  let raw;
  try {raw=JSON.parse(fs.readFileSync(path.join(root,'chelm.runtime.json'),'utf8'));}
  catch(e) {return {status:e.code==='ENOENT'?'missing':e instanceof SyntaxError?'invalid_config':'unreadable',runtime_ready:false,
    message:'Package installed; runtime configuration is '+(e.code==='ENOENT'?'absent':e instanceof SyntaxError?'malformed':'unreadable')+'. Runtime readiness was not established.'};}
  if(legacyConfig(raw))return {status:'migration_required',...migrationGuidance(root,cli)};
  const issues=validateShape(raw,read(file(packageRoot,'schemas/runtime-config.schema.json')));
  if(issues.length)return {status:'invalid_config',runtime_ready:false,message:'Package installed; runtime config is invalid: '+issues[0]};
  return {status:'supported_config',schema_version:raw.schema_version,runtime_ready:null,
    message:'Package installed; runtime config version is supported. Run verify/refresh explicitly to establish readiness.'};
}
