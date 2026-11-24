import test from './scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,ok,refuse,source,harness} from './helpers.mjs';
import {inspectRuntime,legacyConfig} from '../lib/runtime-readiness.mjs';
import {spawnSync} from 'node:child_process';
import {hash} from '../lib/util.mjs';

function legacy(f) {
  // v0.2.0 config defaults: current synthetic instance/harness paths only;
  // no consumer data or claim that an untouched historical runtime was executed.
  const config=path.join(f.root,'chelm.runtime.json'),raw=JSON.parse(fs.readFileSync(config));
  raw.schema_version=1;delete raw.remote;delete raw.observability;
  raw.delegation={enabled:true,share_root:null,reservation_hours:8,participants:[]};
  fs.writeFileSync(config,JSON.stringify(raw));assert(legacyConfig(raw));return config;
}
test('Recognized v0.2.0 config: common commands give runnable preflight, preserve bytes, explicit apply archives metadata',t=>{
  const f=fixture(t),config=legacy(f),before=fs.readFileSync(config),graph=fs.readFileSync(path.join(f.instance,'memory/graph.json'));
  for(const command of ['status','refresh']) {
    const value=refuse('migration_required',command,null,f.root);
    const d=value.error.details;assert.deepEqual(d.supported_versions,[2,3]);assert.equal(d.detected_version,1);
    const r=spawnSync(d.preflight.executable,d.preflight.argv,{encoding:'utf8',timeout:5000});
    assert.equal(r.status,0,r.stdout+r.stderr);
    const result=JSON.parse(r.stdout);assert.equal(result.migration_required,true);assert.equal(result.changed,false);
  }
  assert.deepEqual(fs.readFileSync(config),before);assert.deepEqual(fs.readFileSync(path.join(f.instance,'memory/graph.json')),graph);
  const applied=ok('migrate',null,f.root,undefined,{apply:true});assert(applied.changed);
  assert.deepEqual(fs.readFileSync(path.join(applied.archive,'chelm.runtime.json')),Buffer.from(JSON.stringify(JSON.parse(before),null,2)+'\n'));
  assert.deepEqual(fs.readFileSync(path.join(f.instance,'memory/graph.json')),graph);
  assert(ok('refresh',null,f.root).ok);assert.equal(JSON.parse(fs.readFileSync(config)).schema_version,2);
});
test('Malformed/unknown versions and corrupt current configs do not masquerade as migratable',t=>{
  const f=fixture(t),config=path.join(f.root,'chelm.runtime.json'),raw=JSON.parse(fs.readFileSync(config));
  for(const value of [null,{}, {...raw,schema_version:99},{...raw,schema_version:'1'},{schema_version:1}, {...raw,remote:null}]) {
    assert(!legacyConfig(value));fs.writeFileSync(config,JSON.stringify(value));refuse('config_invalid','status',null,f.root);
  }
  fs.writeFileSync(config,'{');refuse('config_invalid','status',null,f.root);
  fs.writeFileSync(config,JSON.stringify(raw));assert.equal(inspectRuntime(f.root).schema_version,2);ok('refresh',null,f.root);
});
test('Installer reports legacy migration in ordinary and deferred modes without changing the runtime',t=>{
  if(!fs.existsSync(path.join(source,'RELEASE.json')))return t.skip('Staged distribution check');
  const f=fixture(t),config=legacy(f),before=hash(fs.readFileSync(config)),graph=hash(fs.readFileSync(path.join(f.instance,'memory/graph.json')));
  for(const deferred of [false,true]) {
    const app=path.join(f.base,'application '+deferred+" 'quote $value");fs.mkdirSync(app);
    const args=[path.join(source,'integration/install.mjs'),'--repo',app,'--runtime-hint',f.root,'--skip-dependencies',
      ...(deferred?['--defer-agent-integration']:[])];
    const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:10000});assert.equal(r.status,0,r.stdout+r.stderr);
    const v=JSON.parse(r.stdout);assert.equal(v.runtime_status.status,'migration_required');
    assert(v.messages.some(m=>m.includes('migration required')));
    const p=v.runtime_status.preflight;const preflight=spawnSync(p.executable,p.argv,{encoding:'utf8',timeout:5000});
    assert.equal(preflight.status,0,preflight.stdout+preflight.stderr);assert.equal(JSON.parse(preflight.stdout).changed,false);
    const quoted=process.platform==='win32'
      ? spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',p.powershell],{encoding:'utf8',timeout:10000})
      : spawnSync('sh',['-c',p.posix],{encoding:'utf8',timeout:5000});
    assert.equal(quoted.status,0,quoted.stdout+quoted.stderr);assert.equal(JSON.parse(quoted.stdout).changed,false);
    assert.equal(hash(fs.readFileSync(config)),before);assert.equal(hash(fs.readFileSync(path.join(f.instance,'memory/graph.json'))),graph);
  }
});
test('Installer read-only readiness distinguishes unresolved, absent and corrupt hints; schema 3 remains supported',t=>{
  const f=fixture(t);assert.equal(inspectRuntime('<private-runtime>').status,'unresolved');
  assert.equal(inspectRuntime(path.join(f.base,'absent')).status,'missing');
  const config=path.join(f.root,'chelm.runtime.json');
  ok('memory','upgrade',f.root,undefined,{harness,apply:true});
  assert.equal(inspectRuntime(f.root).schema_version,3);ok('refresh',null,f.root);
  fs.writeFileSync(config,'{');assert.equal(inspectRuntime(f.root).status,'invalid_config');
  fs.rmSync(config);fs.mkdirSync(config);assert.equal(inspectRuntime(f.root).status,'unreadable');
});
