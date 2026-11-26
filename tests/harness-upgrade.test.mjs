import test from './scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,executor,ok,refuse,analyze,harness} from './helpers.mjs';
import {snapshot} from '../lib/util.mjs';

test('approved Harness upgrade preserves knowledge, drains work and retains exact checkpoint identities',t=>{
  const target=process.env.CHELM_UPGRADE_HARNESS_ROOT??harness;
  const f=fixture(t);f.submit();
  const w=ok('worker','next',f.root,{executor}).work_unit;
  refuse('busy','harness','upgrade',f.root,undefined,{harness:target,apply:true});
  const configPath=path.join(f.root,'chelm.runtime.json'),raw=fs.readFileSync(configPath);
  const from=JSON.parse(fs.readFileSync(path.join(harness,'RELEASE.json'))).version;
  const to=JSON.parse(fs.readFileSync(path.join(target,'RELEASE.json'))).version;
  if(from!==to){
    const changed=JSON.parse(raw);changed.harness.root=target;fs.writeFileSync(configPath,JSON.stringify(changed));
    refuse('policy_changed','worker','validate',f.root,{executor,run_id:w.run_id});
    fs.writeFileSync(configPath,raw);
  }
  analyze(f,w);ok('worker','validate',f.root,{executor,run_id:w.run_id});
  ok('worker','submit',f.root,{executor,run_id:w.run_id});
  const before=snapshot(f.instance),checkpoint=path.join(f.base,'before.json');
  const c=ok('checkpoint','create',f.root,undefined,{output:checkpoint});
  const plan=ok('harness','upgrade',f.root,undefined,{harness:target});assert.equal(plan.status,'ready');
  const upgraded=ok('harness','upgrade',f.root,undefined,{harness:target,apply:true});assert.equal(upgraded.status,'upgraded');
  assert.deepEqual(snapshot(f.instance),before);
  assert.equal(ok('status',null,f.root).head,c.manifest.git.head);
  assert.equal(ok('read','summary',f.root).view.harness_version,JSON.parse(fs.readFileSync(path.join(target,'RELEASE.json'))).version);
  if(upgraded.before.manifest_sha256!==upgraded.after.manifest_sha256)
    refuse('checkpoint_unsupported','checkpoint','restore',path.join(f.base,'wrong-restore'),undefined,{checkpoint,harness:target,sha256:c.sha256,apply:true});
  f.submit('S-2','Second synthetic source after package upgrade.');
  const next=ok('worker','next',f.root,{executor}).work_unit;analyze(f,next);
  ok('worker','validate',f.root,{executor,run_id:next.run_id});ok('worker','submit',f.root,{executor,run_id:next.run_id});
  assert.equal(f.read('memory/graph.json').claims.length,2);
  const after=ok('checkpoint','create',f.root,undefined,{output:path.join(f.base,'after.json')});
  assert(!after.manifest.files.some(r=>r.path.includes('.golem-indexer.lock')));
  const restored=path.join(f.base,'restored-after');
  ok('checkpoint','restore',restored,undefined,{checkpoint:after.output,harness:target,sha256:after.sha256,apply:true});
  assert.equal(ok('read','summary',restored).view.harness_version,to);
});

test('config-3 upgrade preserves the provider selection and reopens its snapshot',t=>{
  const target=process.env.CHELM_UPGRADE_HARNESS_ROOT??harness;
  const catalog=JSON.parse(fs.readFileSync(new URL('../harness-compatibility.json',import.meta.url)));
  const versions=[harness,target].map(p=>JSON.parse(fs.readFileSync(path.join(p,'RELEASE.json'))).version);
  if(versions.some(v=>!catalog.approved_releases[v]?.features.includes('memory_provider')))return;
  const f=fixture(t);ok('memory','upgrade',f.root,undefined,{harness,apply:true});
  const before=snapshot(f.instance),status=ok('status',null,f.root);
  ok('harness','upgrade',f.root,undefined,{harness:target,apply:true});
  assert.deepEqual(snapshot(f.instance),before);
  assert.equal(ok('status',null,f.root).snapshot_id,status.snapshot_id);
  assert.deepEqual(ok('memory','audit',f.root).errors,[]);
  f.submit();const w=ok('memory-worker','next',f.root,{executor,request_id:'upgrade-binding'});
  if(versions[0]!==versions[1]){
    const configPath=path.join(f.root,'chelm.runtime.json'),raw=fs.readFileSync(configPath),changed=JSON.parse(raw);
    changed.harness.root=harness;fs.writeFileSync(configPath,JSON.stringify(changed));
    refuse('policy_changed','memory-worker','status',f.root,{work_id:w.work_id,attempt:w.attempt});
    fs.writeFileSync(configPath,raw);
  }
  ok('memory-worker','abandon',f.root,{work_id:w.work_id,attempt:w.attempt});
});
