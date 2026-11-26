import test from './scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fixture,git,source,harness} from './helpers.mjs';
import {hash} from '../lib/util.mjs';
import {verifyHarness,qualification} from '../lib/harness.mjs';
import {instanceDrafts} from '../lib/instance-operational.mjs';
import {featureStatus} from '../tools/probe-harness.mjs';

test('contract decisions reject missing capabilities and incompatible schema versions independently',()=>{
  const required=qualification.requirements;
  const detected={contracts:{graph:2,hypotheses:1,adapter:1,cognitive_task:1,provider_version:1,logical_version:2,host_api_version:2},
    capabilities:[...new Set(Object.values(required).flatMap(r=>r.capabilities))]};
  assert(Object.values(featureStatus(required,detected,()=>true)).every(r=>r.status==='pass'));
  detected.capabilities=detected.capabilities.filter(c=>c!=='semantic-changes-v1');
  let rows=featureStatus(required,detected,()=>true);
  assert.equal(rows.memory_provider.status,'unsupported');assert.equal(rows.file_worker.status,'pass');
  detected.contracts.graph=3;detected.contracts.cognitive_task=2;
  rows=featureStatus(required,detected,p=>p!=='server/cognitive-task.mjs');
  assert.equal(rows.file_worker.status,'unsupported');assert.equal(rows.cognitive_tasks.status,'unsupported');
});

test('approved release still rejects changed bytes in the same process after discovery was cached',t=>{
  const base=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'chelm-integrity-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const engine=path.join(base,'engine');fs.cpSync(harness,engine,{recursive:true});
  const cfg={harness:{root:engine}};verifyHarness(cfg);
  fs.appendFileSync(path.join(engine,'processor/memory-tool.mjs'),'\n// tampered\n');
  assert.throws(()=>verifyHarness(cfg),{code:'package_invalid'});
});

test('an approved identity with incompatible contracts fails closed before runtime work',t=>{
  const base=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'chelm-contract-negative-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const engine=path.join(base,'engine'),host=path.join(base,'host');
  fs.cpSync(harness,engine,{recursive:true});
  for(const dir of ['lib','tools'])fs.cpSync(path.join(source,dir),path.join(host,dir),{recursive:true,filter:p=>!p.includes('__pycache__')});
  for(const name of ['package.json','compatibility.json','harness-compatibility.json'])fs.copyFileSync(path.join(source,name),path.join(host,name));
  const schema=path.join(engine,'schemas/memory-graph.schema.json'),value=JSON.parse(fs.readFileSync(schema));value.properties.schema_version.const=999;fs.writeFileSync(schema,JSON.stringify(value));
  const mp=path.join(engine,'RELEASE.json'),m=JSON.parse(fs.readFileSync(mp));m.files['schemas/memory-graph.schema.json']=hash(fs.readFileSync(schema));fs.writeFileSync(mp,JSON.stringify(m));
  const cp=path.join(host,'harness-compatibility.json'),c=JSON.parse(fs.readFileSync(cp));c.approved_releases[m.version].manifest_sha256=hash(fs.readFileSync(mp));fs.writeFileSync(cp,JSON.stringify(c));
  // Only this disposable copy trusts the synthetic identity; no production override exists.
  const script=`import {verifyHarness} from ${JSON.stringify('file://'+path.join(host,'lib/harness.mjs'))};try{verifyHarness({harness:{root:process.argv[1]}});process.exit(2)}catch(e){console.log(e.code)}`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script,engine],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout.trim(),'harness_unsupported');
});

test('only the empty untracked indexer lock is operational state',t=>{
  const f=fixture(t),lock=path.join(f.instance,'.golem-indexer.lock');fs.writeFileSync(lock,'');
  assert.deepEqual(instanceDrafts(f.instance),[]);
  fs.writeFileSync(lock,'draft');assert.equal(instanceDrafts(f.instance).length,1);
  fs.writeFileSync(lock,'');git(f.instance,'add','.golem-indexer.lock');
  assert.equal(instanceDrafts(f.instance).length,1);
  fs.writeFileSync(path.join(f.instance,'ordinary.md'),'draft');assert.equal(instanceDrafts(f.instance).length,2);
});
