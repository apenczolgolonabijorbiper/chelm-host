import test from './scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fixture,ok,executor,analyze,git,harness,refuse} from './helpers.mjs';
import {createCheckpoint,restoreCheckpoint,inspectCheckpoint,checkpointLimits} from '../lib/checkpoint.mjs';
import {file,read,write,hash,json,actor} from '../lib/util.mjs';
import {completedCognition} from './session-fixture.mjs';
import {checkBundle} from '../lib/checkpoint-pack.mjs';
const refuses=code=>e=>e.code===code;
const restoreOptions=c=>({apply:true,harness,expected_sha256:c.sha256});
async function capture(f,name='checkpoint'){return createCheckpoint(f.root,path.join(f.base,name+'.json'));}
function ingest(f){const ids=f.submit();const w=ok('worker','next',f.root,{executor}).work_unit;analyze(f,w);ok('worker','submit',f.root,{executor,run_id:w.run_id,outputs:['memory/graph.json',w.journal_path]});return ids;}

test('Complete checkpoint preserves history, queued tasks, exact results, receipts and historical citations at a moved root',async t=>{
  const f=fixture(t,{profile:true}),ids=ingest(f),done=await completedCognition(f.root);
  const queued=ok('task','create',f.root,{idempotency_key:'queued',text:'Continue later'}).task;
  ok('submit',null,f.root,{subject_id:'pending',groups:[{kind:'record',lines:['Pending fresh evidence.']}]});
  const head=git(f.instance,'rev-parse','HEAD'),history=git(f.instance,'log','--format=%H');
  const c=await capture(f),repeat=await capture(f,'repeat');assert.equal(c.sha256,repeat.sha256);
  const target=path.join(f.base,'different-owner-path');
  await restoreCheckpoint(target,c.output,restoreOptions(c));
  assert.equal(git(file(target,'instance'),'rev-parse','HEAD'),head);assert.equal(git(file(target,'instance'),'log','--format=%H'),history);
  const task=ok('task','get',target,{task_id:done.task.task_id}).task;
  assert.deepEqual(task.result,done.result);assert.deepEqual(task.receipt,done.receipt);
  const citation=ok('task','evidence',target,{task_id:done.task.task_id,work_id:done.w.work_id,source_id:ids[0],length:16000});
  assert.equal(citation.text,done.result.findings[0].evidence[0].quote);
  assert.equal(ok('task','get',target,{task_id:queued.task_id}).task.state,'queued');
  const next=ok('cognitive-worker','next',target,{executor,request_id:'fresh-assignment',task_id:queued.task_id});assert.notEqual(next.work_id,done.w.work_id);
  assert.deepEqual(read(file(target,'host/workers.json')),{});assert.equal(read(file(target,'host/tasks/'+queued.task_id+'.json')).owner,actor());
  assert.equal(ok('status',null,target).counts.processed,1);assert.equal(ok('status',null,target).counts.ready+ok('status',null,target).counts.waiting_for_age,1);
  assert.equal(read(file(target,'host/checkpoint/restore.json')).publishing_authority,false);
  await assert.rejects(restoreCheckpoint(target,c.output,restoreOptions(c)),refuses('runtime_exists'));
});
test('Checkpoint CLI restore refuses implicit owner binding; includes no Git remotes, credentials, hooks, locks, packages or auth canaries',async t=>{
  const f=fixture(t),secret='SECRET_CANARY_NEVER_EXPORT';
  fs.writeFileSync(file(f.root,'credentials.json'),secret);fs.mkdirSync(file(f.root,'host/remote-auth'));fs.writeFileSync(file(f.root,'host/remote-auth/keys.json'),secret);
  git(f.instance,'remote','add','origin','https://user:'+secret+'@example.invalid/memory.git');
  fs.writeFileSync(path.join(f.instance,'.git/hooks/post-checkout'),secret);
  const c=await capture(f);assert(!fs.readFileSync(c.output,'utf8').includes(secret));
  for(const b of inspectCheckpoint(c.output).files.values())assert(!b.includes(Buffer.from(secret)));
  const target=path.join(f.base,'restored');refuse('restore_authorization','checkpoint','restore',target,undefined,{checkpoint:c.output,sha256:c.sha256,harness});
  ok('checkpoint','inspect',f.root,undefined,{checkpoint:c.output});
  ok('checkpoint','restore',target,undefined,{checkpoint:c.output,sha256:c.sha256,harness,apply:true});
  assert.equal(git(file(target,'instance'),'remote'), '');assert.equal(fs.existsSync(path.join(target,'instance/.git/hooks/post-checkout')),false);
  const rebuilt=await createCheckpoint(target,path.join(f.base,'second.json'));assert(rebuilt.size>0);
});
test('Checkpoint refuses active/expired work, unresolved publication, changed protocol/drafts and external roots',async t=>{
  const f=fixture(t);f.submit();const w=ok('worker','next',f.root,{executor}).work_unit;
  await assert.rejects(capture(f),refuses('busy'));
  ok('worker','abandon',f.root,{executor,run_id:w.run_id,outputs:[]});
  write(file(f.root,'host/publication-pending.json'),{});await assert.rejects(capture(f),refuses('recovery_required'));fs.rmSync(file(f.root,'host/publication-pending.json'));
  fs.appendFileSync(file(f.instance,'memory/index.md'),'draft');await assert.rejects(capture(f),refuses('busy'));git(f.instance,'restore','memory/index.md');
  const cfg=read(file(f.root,'chelm.runtime.json'));cfg.archive.root=path.join(f.base,'outside');write(file(f.root,'chelm.runtime.json'),cfg);await assert.rejects(capture(f),refuses('checkpoint_external_root'));
});
test('Checkpoint validates all archive paths, required inventory, bytes, versions and budgets before activation',async t=>{
  const f=fixture(t),c=await capture(f),original=JSON.parse(fs.readFileSync(c.output));
  const bad=async(change,code)=>{const a=structuredClone(original);change(a);await assert.rejects(restoreCheckpoint(path.join(f.base,'bad'),Buffer.from(json(a)),{...restoreOptions(c),expected_sha256:hash(json(a))}),refuses(code));assert(!fs.existsSync(path.join(f.base,'bad')));};
  await bad(a=>{a.manifest.version=2;},'checkpoint_unsupported');
  await bad(a=>{a.manifest.host_code_sha256='0'.repeat(64);},'checkpoint_unsupported');
  await bad(a=>{a.manifest.files[0].path='../escape';a.entries[0].path='../escape';},'checkpoint_path');
  await bad(a=>{a.entries[0].base64=Buffer.from('bad').toString('base64');},'checkpoint_invalid');
  await bad(a=>{a.manifest.files.splice(0,1);a.entries.splice(0,1);},'checkpoint_invalid');
  await bad(a=>{a.manifest.files[0].size=checkpointLimits.bytes+1;},'checkpoint_invalid');
  await assert.rejects(restoreCheckpoint(path.join(f.base,'bad'),Buffer.from('{'),restoreOptions(c)),refuses('checkpoint_invalid'));
  // A valid envelope hash cannot hide an incomplete Git pack.
  await bad(a=>{const i=a.entries.findIndex(e=>e.path==='instance.bundle'),b=Buffer.from('bad Git bundle');a.entries[i].base64=b.toString('base64');a.manifest.files[i].size=b.length;a.manifest.files[i].sha256=hash(b);},'checkpoint_history');
  assert.equal(fs.readdirSync(f.base).filter(p=>p.includes('.restore-')).length,0);
});
test('Unsupported historical secret paths and links are refused rather than exported or followed',async t=>{
  const f=fixture(t);fs.writeFileSync(file(f.instance,'secret.env'),'SECRET');git(f.instance,'add','secret.env');git(f.instance,'-c','user.name=x','-c','user.email=x@local','commit','-qm','secret');fs.rmSync(file(f.instance,'secret.env'));
  await assert.rejects(capture(f),refuses('checkpoint_path'));
});
test('Config-3 checkpoint keeps provider snapshot receipts and passes public audit after restore',async t=>{
  const f=fixture(t);ingest(f);
  ok('memory','upgrade',f.root,undefined,{harness,apply:true});
  const task=await completedCognition(f.root),c=await capture(f),target=path.join(f.base,'provider-restored');
  await restoreCheckpoint(target,c.output,restoreOptions(c));
  assert.deepEqual(ok('task','get',target,{task_id:task.task.task_id}).task.receipt,task.receipt);
  assert.deepEqual(ok('memory','audit',target).errors,[]);
  const source=task.result.findings[0].evidence[0];assert.equal(ok('task','evidence',target,{task_id:task.task.task_id,work_id:task.w.work_id,source_id:source.source_id,length:16000}).text,source.quote);
});
test('Archive and compressed Git budgets refuse before import; hardlinks and edited owners cannot gain access',async t=>{
  const f=fixture(t),c=await capture(f),large=path.join(f.base,'too-large.json'),fd=fs.openSync(large,'wx');fs.ftruncateSync(fd,checkpointLimits.archive_bytes+1);fs.closeSync(fd);
  assert.throws(()=>inspectCheckpoint(large),refuses('capacity_exceeded'));
  fs.linkSync(file(f.instance,'instance/purpose.md'),path.join(f.base,'linked-purpose'));
  await assert.rejects(capture(f,'linked'),refuses('checkpoint_path'));fs.rmSync(path.join(f.base,'linked-purpose'));
  const lockdir=path.join(f.instance,'.git/golem-adapter-operation.lock');fs.mkdirSync(lockdir);await assert.rejects(capture(f,'locked'),refuses('recovery_required'));fs.rmdirSync(lockdir);
  const header=Buffer.from('# v2 git bundle\n'+'a'.repeat(40)+' refs/heads/main\n\n'),pack=Buffer.alloc(12);pack.write('PACK');pack.writeUInt32BE(2,4);pack.writeUInt32BE(1,8);
  // Blob declared at >64 MiB, followed by no compressed bytes. Refuse its bound before decoding/import.
  assert.throws(()=>checkBundle(Buffer.concat([header,pack,Buffer.from([0xb0,0x80,0x80,0x80,0x04]),Buffer.alloc(20)])),refuses('capacity_exceeded'));
  const task=ok('task','create',f.root,{idempotency_key:'owner-check',text:'Queued'}).task;
  const next=await capture(f,'owner'),a=JSON.parse(fs.readFileSync(next.output));
  const i=a.entries.findIndex(e=>e.path==='host/tasks/'+task.task_id+'.json'),tweak=JSON.parse(Buffer.from(a.entries[i].base64,'base64'));tweak.owner='another-os-principal';const b=Buffer.from(json(tweak));a.entries[i].base64=b.toString('base64');a.manifest.files[i].size=b.length;a.manifest.files[i].sha256=hash(b);
  await assert.rejects(restoreCheckpoint(path.join(f.base,'forged'),Buffer.from(json(a)),{...restoreOptions(next),expected_sha256:hash(json(a))}),refuses('checkpoint_owner'));
});
