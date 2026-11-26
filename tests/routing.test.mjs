import test from './scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fixture,ok,refuse,executor,harness,source,git} from './helpers.mjs';
import {remoteCall} from '../lib/remote.mjs';
import {startServer,stopServer} from '../lib/remote-server.mjs';
import {config,defaults} from '../lib/runtime.mjs';
import {file,read,write,hash,actor} from '../lib/util.mjs';
import {routingAdmin,routingWorker,routeCandidates,localRoutingIdentity,validateRoutingPolicy} from '../lib/routing.mjs';
import {createCheckpoint,restoreCheckpoint} from '../lib/checkpoint.mjs';
import {prepare,workArgs} from './remote-helpers.mjs';

const bindings=[{binding_id:'preferred-a',transport:'remote',principal:'pref-a',cognizer_id:'preferred'},{binding_id:'preferred-b',transport:'remote',principal:'pref-b',cognizer_id:'preferred'},
  {binding_id:'base',transport:'remote',principal:'base',cognizer_id:'base'},
  {binding_id:'local',transport:'local',principal:actor(),host:os.hostname(),cognizer_id:'base'}];
const policy=(extra={})=>({schema_version:1,mode:'prefer',cognizer_id:'preferred',work_kinds:['observation','cognitive'],grace_seconds:60,fallback:['base'],readiness_ttl_seconds:300,workers:bindings,...extra});
const registration=(cfg,extra={})=>({host_contracts:['file-worker-v1','remote-worker-v2','memory-worker-v3','cognitive-worker-v2'],capabilities:['cognizer-routing-v1','purpose-guidance-v2','memory-provider-v1','cognitive-task-v1','cognitive-context-v1','cognitive-result-v1','learning-hypothesis-v1','hypothesis-unknown-confidence-v1'],harness_manifest_sha256:hash(fs.readFileSync(file(cfg.harness.root,'RELEASE.json'))),...extra});
const apply=(f,p,revision=0)=>ok('routing','apply',f.root,{expected_revision:revision,preferred_cognizer:p});
const call=(f,p,name,args={})=>remoteCall(f.root,p,name,args);
const register=(f,p,extra={})=>call(f,p,'chelm_routing_register',registration(config(f.root),extra));
const next=(f,p,request_id=p,extra={})=>call(f,p,'chelm_request_work',{request_id,executor,...extra});
const refs=w=>({work_id:w.work_id,attempt:w.attempt});

function cheap(t,p=policy()){
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'routing-test-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const cfg={...defaults(),harness:{root:harness},preferred_cognizer:p};
  const who=principal=>({transport:'remote',principal});
  const reg=(principal,extra={})=>routingWorker(root,cfg,who(principal),'register',registration(cfg,extra));
  const items=[{routing_key:'source-one'},{routing_key:'source-two'}];
  const route=(principal,kind='observation',contract='remote-worker-v2',rows=items)=>routeCandidates(root,cfg,who(principal),kind,contract,rows);
  return {root,cfg,who,reg,items,route};
}

test('Routing policy schema rejects ambiguous trust, unsupported modes/scopes/bounds and require fallback',()=>{
  assert.equal(validateRoutingPolicy().mode,'disabled');
  assert.equal(validateRoutingPolicy({schema_version:1,mode:'disabled'}).mode,'disabled');
  for(const p of [policy({mode:'auto'}),policy({work_kinds:[]}),policy({grace_seconds:3601}),policy({readiness_ttl_seconds:0}),policy({mode:'require'}),policy({workers:[...bindings,bindings[0]]}),policy({workers:bindings.map(w=>w.transport==='local'?{...w,host:undefined}:w)}),policy({executor:'shem'})])assert.throws(()=>validateRoutingPolicy(p));
});

test('Durable bounded grace survives polls, heartbeats, restart, expiry, incompatibility and rollback without starvation',t=>{
  const f=cheap(t),start=Date.now();t.mock.timers.enable({apis:['Date'],now:start});
  f.reg('base');f.reg('pref-a');
  assert.equal(f.route('base').deferred.reason,'preferred_grace');
  const pending=read(file(f.root,'host/routing/state.json')).pending;
  t.mock.timers.tick(30000);f.reg('pref-a');f.route('base');
  assert.deepEqual(read(file(f.root,'host/routing/state.json')).pending,pending);
  const changed=routingAdmin(f.root,f.cfg,'apply',{expected_revision:0,preferred_cognizer:policy({mode:'require',fallback:[]})});
  assert.equal(changed.revision,1);assert.equal(f.route('base').deferred.reason,'preferred_required');
  routingAdmin(f.root,f.cfg,'apply',{expected_revision:1,preferred_cognizer:policy()});
  t.mock.timers.tick(30000);
  assert.equal(f.route('base').items.length,2); // file-backed load after policy switches
  t.mock.timers.tick(300001);
  assert.equal(f.route('pref-a').deferred.reason,'worker_expired');
  f.reg('pref-a',{harness_manifest_sha256:'0'.repeat(64)});
  assert.equal(f.route('pref-a').deferred.reason,'worker_incompatible');
  f.reg('base');assert.equal(f.route('base').items.length,2);
  assert.equal(f.route('unknown').deferred.reason,'worker_unregistered');
});

test('Scope, capability negotiation, allowlist, queue order and request-supplied identity do not grant eligibility',t=>{
  const f=cheap(t,policy({work_kinds:['cognitive'],fallback:[]}));
  assert.equal(f.route('unknown').items.length,2); // explicitly outside policy scope
  f.reg('base');assert.equal(f.route('base','cognitive','cognitive-worker-v2').deferred.reason,'fallback_not_allowed');
  f.reg('pref-a',{host_contracts:['remote-worker-v2']});
  assert.equal(f.route('pref-a','cognitive','cognitive-worker-v2').deferred.reason,'worker_incompatible');
  f.reg('pref-a');assert.deepEqual(f.route('pref-a','cognitive','cognitive-worker-v2').items,f.items);
  assert.throws(()=>routingWorker(f.root,f.cfg,f.who('base'),'register',{...registration(f.cfg),cognizer_id:'preferred'}),e=>e.code==='input_invalid');
  assert.throws(()=>routingWorker(f.root,f.cfg,{...f.who('pref-a'),transport:'local',host:os.hostname()},'register',registration(f.cfg)),e=>e.code==='routing_identity_unregistered');
});

test('CAS preview/apply is atomic and read-only preview leaves memory, intake, pending and guidance intact',async t=>{
  const f=fixture(t);f.submit();const before=git(f.instance,'rev-parse','HEAD'),sources=fs.readdirSync(file(f.instance,'inbox'));
  const preview=ok('routing','preview',f.root,{expected_revision:0,preferred_cognizer:policy()});
  assert.equal(preview.next_revision,1);assert.equal(fs.existsSync(file(f.root,'host/routing/state.json')),false);
  apply(f,policy());refuse('routing_revision_conflict','routing','apply',f.root,{expected_revision:0,preferred_cognizer:null});
  const competing=await Promise.allSettled([import('../lib/app.mjs').then(({execute})=>execute('routing','apply',{runtime:f.root},{expected_revision:1,preferred_cognizer:null})),import('../lib/app.mjs').then(({execute})=>execute('routing','apply',{runtime:f.root},{expected_revision:1,preferred_cognizer:policy()}))]);
  assert.equal(competing.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(git(f.instance,'rev-parse','HEAD'),before);assert.deepEqual(fs.readdirSync(file(f.instance,'inbox')),sources);
  const status=ok('doctor',null,f.root);assert.equal(status.cognizer_routing.revision,2);
});

test('Config-2 local/file/stdio and remote queue enforce preference, retain owner retry and allow submission after a switch',async t=>{
  const f=fixture(t);f.submit();apply(f,policy());await register(f,'base');await register(f,'pref-a');
  const refused=await next(f,'base');assert.equal(refused.status,'deferred');assert.equal(refused.reason,'preferred_grace');assert(!JSON.stringify(refused).includes('source-one'));
  ok('routing-worker','register',f.root,registration(config(f.root)));
  assert.equal(ok('worker','next',f.root,{executor:{...executor,id:'pref-a',cognizer_id:'preferred'}}).status,'deferred');
  const cli=new Client({name:'local-routing',version:'1'});
  await cli.connect(new StdioClientTransport({command:process.execPath,args:[file(source,'bin/chelm-mcp.mjs'),'--runtime',f.root]}));
  try{
    assert((await cli.listTools()).tools.some(t=>t.name==='chelm_routing_register'));
    const r=await cli.callTool({name:'chelm_next',arguments:{executor}});assert.equal(JSON.parse(r.content[0].text).status,'deferred');
  }finally{await cli.close();}
  const w=await next(f,'pref-a','owned');assert.equal(w.routing.cognizer_id,'preferred');
  const candidate=await prepare((name,args)=>call(f,'pref-a',name,args),w);
  const validated=await call(f,'pref-a','chelm_validate_candidate',candidate);
  apply(f,policy({cognizer_id:'base',fallback:[]}),1);
  assert.equal((await next(f,'pref-a','owned')).work_id,w.work_id);
  assert.equal((await call(f,'pref-a','chelm_renew_work',refs(w))).routing.revision,1);
  const receipt=await call(f,'pref-a','chelm_submit_candidate',{...candidate,candidate_digest:validated.candidate_digest,submission_id:'one'});
  assert.equal(receipt.status,'committed');assert.equal((await next(f,'pref-a','owned')).receipt.head,receipt.head);
  assert.equal(f.read('memory/processed.json').observations.length,1);
  assert.equal((await next(f,'base','empty')).status,'no-work');
});

test('Two independent authenticated MCP clients compete, server restart retains clocks, runtime access precedes registration',async t=>{
  const f=fixture(t);f.submit();apply(f,policy());
  let server;const clients=[];
  const service=()=>startServer({port:0,public_url:'http://127.0.0.1/mcp',development:true,runtimes:{app:f.root,other:f.root},auth:{mode:'worker-tokens',workers:[{principal:'pref-a',runtimes:['app'],token_env:'PREF'},{principal:'base',runtimes:['app'],token_env:'BASE'}]}},{env:{PREF:'synthetic-preferred-token-for-routing-only',BASE:'synthetic-base-token-for-routing-only'}});
  const connect=async(token,runtime='app')=>{
    const c=new Client({name:'independent-'+token,version:'1'});clients.push(c);
    await c.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+server.address().port+'/mcp/'+runtime),{requestInit:{headers:{Authorization:'Bearer '+token}}}));return c;
  };
  t.after(async()=>{for(const c of clients)await c.close();if(server)await stopServer(server);});
  server=await service();
  const a=await connect('synthetic-preferred-token-for-routing-only'),b=await connect('synthetic-base-token-for-routing-only');
  const tool=async(c,name,args={})=>JSON.parse((await c.callTool({name,arguments:args})).content[0].text);
  await tool(a,'chelm_routing_register',registration(config(f.root)));await tool(b,'chelm_routing_register',registration(config(f.root)));
  assert.equal((await tool(b,'chelm_request_work',{request_id:'first-poller',executor})).status,'deferred');
  const clock=read(file(f.root,'host/routing/state.json')).pending;
  await a.close();await b.close();await stopServer(server);server=await service();
  const aa=await connect('synthetic-preferred-token-for-routing-only'),bb=await connect('synthetic-base-token-for-routing-only');
  assert.equal((await tool(bb,'chelm_request_work',{request_id:'second-poller',executor})).status,'deferred');
  assert.deepEqual(read(file(f.root,'host/routing/state.json')).pending,clock);
  const w=await tool(aa,'chelm_request_work',{request_id:'winner',executor});assert.equal(w.routing.cognizer_id,'preferred');
  assert.equal((await tool(bb,'chelm_work_status',refs(w))).error.code,'work_not_owned');
  await assert.rejects(connect('synthetic-base-token-for-routing-only','other'));
  await call(f,'pref-a','chelm_abandon_work',refs(w));
  const concurrent=await Promise.all([tool(bb,'chelm_request_work',{request_id:'race-base',executor}),tool(aa,'chelm_request_work',{request_id:'race-pref',executor})]);
  assert(!concurrent[0].work_id);
  const won=concurrent[1].work_id?concurrent[1]:await tool(aa,'chelm_request_work',{request_id:'race-pref',executor});
  assert.equal(won.routing.cognizer_id,'preferred');await call(f,'pref-a','chelm_abandon_work',refs(won));
});

test('Require mode covers no-inbox cognitive tasks, multi-instance disjoint quotas, local identity and owner recovery',async t=>{
  const f=fixture(t),cfg=read(file(f.root,'chelm.runtime.json'));cfg.remote.max_active_work=2;write(file(f.root,'chelm.runtime.json'),cfg);
  apply(f,policy({mode:'require',fallback:[]}));
  const a=ok('task','create',f.root,{idempotency_key:'a',text:'First question'}).task,b=ok('task','create',f.root,{idempotency_key:'b',text:'Second question'}).task;
  await register(f,'base');await register(f,'pref-a');await register(f,'pref-b');
  assert.equal((await next(f,'base','require',{work_kind:'cognitive'})).reason,'preferred_required');
  assert.equal(ok('cognitive-worker','next',f.root,{executor,request_id:'bypass'}).reason,'worker_unregistered');
  const w1=await next(f,'pref-a','a',{work_kind:'cognitive'}),w2=await next(f,'pref-b','b',{work_kind:'cognitive'});
  assert.deepEqual(new Set([w1.task_id,w2.task_id]),new Set([a.task_id,b.task_id]));assert.notEqual(w1.work_id,w2.work_id);
  assert.equal((await next(f,'pref-a','capacity',{work_kind:'cognitive'})).reason,'capacity');
  apply(f,null,1);
  assert.equal((await next(f,'pref-a','a',{work_kind:'cognitive'})).routing.revision,1);
  await call(f,'pref-a','chelm_abandon_work',refs(w1));await call(f,'pref-b','chelm_abandon_work',refs(w2));
  assert.equal(ok('status',null,f.root).lease.state,'idle');
});

test('Provider memory-worker v3 local/remote enforcement and unchanged request retry survive policy change and lost claim response',async t=>{
  const f=fixture(t);ok('memory','upgrade',f.root,undefined,{harness:process.env.CHELM_PROVIDER_HARNESS_ROOT??harness,apply:true});f.submit();apply(f,policy());await register(f,'base');await register(f,'pref-a');
  assert.equal((await call(f,'base','chelm_memory_next',{request_id:'base',executor})).status,'deferred');
  assert.equal(ok('memory-worker','next',f.root,{request_id:'local',executor}).reason,'worker_unregistered');
  const request={request_id:'lost',executor};
  await assert.rejects(remoteCall(f.root,'pref-a','chelm_memory_next',request,{afterMemoryClaim(){throw Error('lost claim response');}}),/lost claim response/);
  apply(f,policy({cognizer_id:'base',fallback:[]}),1);
  const recovered=await call(f,'pref-a','chelm_memory_next',request);assert.equal(recovered.routing.revision,1);assert.equal(recovered.status,'assigned');
  assert.equal((await call(f,'pref-a','chelm_memory_next',request)).work_id,recovered.work_id);
  await call(f,'pref-a','chelm_memory_abandon',refs(recovered));
  const w=await call(f,'base','chelm_memory_next',{request_id:'new-base',executor});assert.equal(w.routing.cognizer_id,'base');
  await call(f,'base','chelm_memory_abandon',refs(w));
  ok('routing-worker','register',f.root,registration(config(f.root)));
  apply(f,policy({cognizer_id:'base',mode:'require',fallback:[]}),2);
  const local=ok('memory-worker','next',f.root,{request_id:'local-preferred',executor});assert.equal(local.routing.identity.transport,'local');
  ok('memory-worker','abandon',f.root,refs(local));
  const task=ok('task','create',f.root,{idempotency_key:'local-cognition',text:'A provider question'}).task;
  const cog=ok('cognitive-worker','next',f.root,{request_id:'local-cog',executor,task_id:task.task_id});assert.equal(cog.routing.cognizer_id,'base');
  ok('cognitive-worker','abandon',f.root,refs(cog));
});

test('Complete checkpoints retain effective policy/grace and clear readiness; disabled configuration preserves legacy clients',async t=>{
  const f=fixture(t);f.submit();apply(f,policy());await register(f,'base');assert.equal((await next(f,'base')).status,'deferred');
  const clock=read(file(f.root,'host/routing/state.json')).pending;
  const c=await createCheckpoint(f.root,path.join(f.base,'routing-checkpoint.json'));
  const restored=path.join(f.base,'restored');await restoreCheckpoint(restored,c.output,{apply:true,harness,expected_sha256:c.sha256});
  const s=ok('routing','status',restored);assert.equal(s.policy.cognizer_id,'preferred');assert.equal(s.revision,1);assert(s.workers.every(w=>w.registration===null));
  assert.deepEqual(read(file(restored,'host/routing/state.json')).pending,clock);
  apply({root:restored},{schema_version:1,mode:'disabled'},1);
  const w=ok('worker','next',restored,{executor}).work_unit;assert(!w.routing);ok('worker','abandon',restored,{executor,run_id:w.run_id});
});

test('Unknown claim/publication remains reserved past expiry and cannot be rerouted by fallback',async t=>{
  const f=fixture(t);ok('memory','upgrade',f.root,undefined,{harness:process.env.CHELM_PROVIDER_HARNESS_ROOT??harness,apply:true});f.submit();apply(f,policy({grace_seconds:0}));await register(f,'base');await register(f,'pref-a');
  const request={request_id:'uncertain',executor};
  await assert.rejects(remoteCall(f.root,'pref-a','chelm_memory_next',request,{afterMemoryClaim(){throw Error('response lost');}}),/response lost/);
  const records=fs.readdirSync(file(f.root,'host/remote/work')),p=file(f.root,'host/remote/work/'+records[0]+'/record.json'),a=read(p);
  // Simulated service downtime beyond the assignment's deadline. Only the host
  // assignment deadline is changed; canonical protocol lease/ledger are untouched.
  a.expires_at=new Date(Date.now()-1000).toISOString();write(p,a);
  const b=await call(f,'base','chelm_memory_next',{request_id:'no-repeat',executor});assert.equal(b.status,'busy');
  assert.equal(fs.readdirSync(file(f.root,'host/remote/work')).length,1);
  const recovered=await call(f,'pref-a','chelm_memory_next',request);assert.equal(recovered.status,'assigned');
  await call(f,'pref-a','chelm_memory_abandon',refs(recovered));
});

test('Integration/review stays with original owner through require-policy switch and unknown commit reconciliation',async t=>{
  const f=fixture(t),cfg=read(file(f.root,'chelm.runtime.json'));cfg.remote.max_active_work=2;write(file(f.root,'chelm.runtime.json'),cfg);
  f.submit('a','First declaration.');f.submit('b','Second declaration.');apply(f,policy({grace_seconds:0}));await register(f,'base');await register(f,'pref-a');
  const run=p=>(name,args)=>call(f,p,name,args);
  const a=await next(f,'pref-a','first',{max:1}),b=await next(f,'base','second',{max:1});assert.notEqual(a.sources[0].id,b.sources[0].id);
  const ca=await prepare(run('pref-a'),a),cb=await prepare(run('base'),b);
  const va=await run('pref-a')('chelm_validate_candidate',ca),vb=await run('base')('chelm_validate_candidate',cb);
  await run('pref-a')('chelm_submit_candidate',{...ca,candidate_digest:va.candidate_digest,submission_id:'first'});
  const reviewed=await run('base')('chelm_submit_candidate',{...cb,candidate_digest:vb.candidate_digest,submission_id:'second'});
  assert.equal(reviewed.status,'integration-required');
  apply(f,policy({mode:'require',fallback:[]}),1);
  const w=await next(f,'base','resume-owner');assert.equal(w.kind,'integration');assert.equal(w.routing.cognizer_id,'base');
  assert.equal(w.attempt,2);
  const c=await prepare(run('base'),w),v=await run('base')('chelm_validate_candidate',c),args={...c,candidate_digest:v.candidate_digest,submission_id:'reviewed'};
  await assert.rejects(remoteCall(f.root,'base','chelm_submit_candidate',args,{afterCAS(){throw Error('unknown commit');}}),/unknown commit/);
  const receipt=await run('base')('chelm_submit_candidate',args);assert.equal(receipt.status,'committed');
  assert.equal((await next(f,'base','second')).work_id,w.work_id);assert.equal(f.read('memory/processed.json').observations.length,2);
});

test('Runtime schema seed, local preferred registration and reserved-principal refusal are explicit',async t=>{
  const f=fixture(t),raw=read(file(f.root,'chelm.runtime.json'));
  raw.preferred_cognizer=policy({cognizer_id:'base',mode:'require',fallback:[]});write(file(f.root,'chelm.runtime.json'),raw);f.submit();
  assert.equal(ok('worker','next',f.root,{executor}).reason,'worker_unregistered');
  ok('routing-worker','register',f.root,registration(config(f.root)));
  const w=ok('worker','next',f.root,{executor}).work_unit;assert.equal(w.routing.identity.transport,'local');assert.equal(w.routing.cognizer_id,'base');
  const blocked=ok('worker','next',f.root,{executor});assert.equal(blocked.status,'busy');assert.equal(blocked.reason,'lease');
  ok('worker','abandon',f.root,{executor,run_id:w.run_id});
  await assert.rejects(next(f,'local:'+actor(),'reserved'),e=>e.code==='unauthorized');
  raw.preferred_cognizer=policy();write(file(f.root,'chelm.runtime.json'),raw);
  refuse('routing_config_changed','routing','status',f.root);
});

test('Routing schema/tool/spec declarations stay aligned across optional bindings',async()=>{
  const {remoteToolSchemas}=await import('../lib/remote-tools.mjs');
  const {validateShape}=await import('../lib/schema.mjs');
  const specs=read(file(source,'schemas/routing-worker-tools.json'));
  const {$schema,...policySchema}=read(file(source,'schemas/cognizer-routing.schema.json'));
  assert.deepEqual(read(file(source,'schemas/runtime-config.schema.json')).properties.preferred_cognizer,policySchema);
  for(const d of specs){assert(remoteToolSchemas[d.name]);assert.deepEqual(validateShape({},d.inputSchema).length>0,!remoteToolSchemas[d.name].safeParse({}).success);}
  assert(fs.readFileSync(file(source,'specifications/COGNIZER_ROUTING.sudo.md'),'utf8').includes('routeCandidates'));
});

test('Provider publication response loss is recovered once after switch and expired owner deadline',async t=>{
  const f=fixture(t);ok('memory','upgrade',f.root,undefined,{harness:process.env.CHELM_PROVIDER_HARNESS_ROOT??harness,apply:true});f.submit();apply(f,policy());await register(f,'pref-a');
  const w=await call(f,'pref-a','chelm_memory_next',{request_id:'publish-once',executor}),attempt_id=randomUUID();
  const change={provider_version:1,base_snapshot:w.snapshot_id,policy_id:w.policy_id,lease_id:w.run_id,run_id:w.run_id,attempt_id,idempotency_key:'routing-'+w.run_id,at:new Date().toISOString(),sources:w.sources.map(({id,sha256})=>({id,sha256})),operations:[
    {op:'append_journal',record:{id:w.run_id,policy_id:w.policy_id,review:'Synthetic routing fixture. Sources and warnings reviewed; no model used; no semantic claims added.',verification_id:attempt_id,model:executor.model}},
    {op:'append_verification',record:{id:attempt_id,run_id:w.run_id,result:'Synthetic transport fixture; host checks pending.'}}]};
  const slot=w.output_slots[0];await call(f,'pref-a','chelm_memory_stage',{...refs(w),slot_id:slot.slot_id,revision:1,text:JSON.stringify(change),final:true});
  const c={...refs(w),outputs:[{slot_id:slot.slot_id,revision:1}]},v=await call(f,'pref-a','chelm_memory_validate',c),args={...c,candidate_digest:v.candidate_digest,submission_id:'publish-once'};
  await assert.rejects(remoteCall(f.root,'pref-a','chelm_memory_submit',args,{afterMemoryPublish(){throw Error('publication response lost');}}),/publication response lost/);
  const before=git(f.instance,'rev-parse','HEAD');apply(f,null,1);
  const p=file(f.root,'host/remote/work/'+w.work_id+'/record.json'),a=read(p);a.expires_at=new Date(Date.now()-1000).toISOString();write(p,a);
  const recovered=await call(f,'pref-a','chelm_memory_submit',args);assert.equal(recovered.status,'committed');assert.equal(git(f.instance,'rev-parse','HEAD'),before);
  assert.deepEqual(await call(f,'pref-a','chelm_memory_submit',args),recovered);assert.equal(f.read('memory/processed.json').observations.length,1);
});

test('Independent work clocks allow oldest fallback without a newer item renewing its grace',t=>{
  const f=cheap(t),start=Date.now();t.mock.timers.enable({apis:['Date'],now:start});f.reg('base');
  f.route('base','observation','remote-worker-v2',[f.items[0]]);
  t.mock.timers.tick(30000);f.route('base');
  t.mock.timers.tick(30000);assert.deepEqual(f.route('base').items,[f.items[0]]);
  t.mock.timers.tick(30000);assert.deepEqual(f.route('base').items,f.items);
});

test('Cognitive result response loss recovers the same receipt after require selection changes',async t=>{
  const f=fixture(t);apply(f,policy({mode:'require',fallback:[]}));await register(f,'pref-a');
  const task=ok('task','create',f.root,{idempotency_key:'empty-result',text:'A synthetic task'}).task;
  const w=await next(f,'pref-a','cog-once',{work_kind:'cognitive',task_id:task.task_id});
  await call(f,'pref-a','chelm_cognitive_read',{...refs(w),request_id:'round',operation:'round'});
  await call(f,'pref-a','chelm_cognitive_read',{...refs(w),request_id:'context',operation:'context'});
  const r=await call(f,'pref-a','chelm_cognitive_read',{...refs(w),request_id:'receipt',operation:'receipt'});
  const result={protocol_version:1,task_id:w.task_id,binding:w.task.binding,outcome:'answer',answer:'Synthetic deterministic fixture; no model used.',findings:[],questions:[],uncertainty:[],stop_reason:'complete',coverage:r.coverage,usage:r.usage,model:{requested:null,observed:null,configuration:'No LLM; fixed fixture.',cost:null}};
  const slot=w.output_slots[0];await call(f,'pref-a','chelm_stage_output',{...refs(w),slot_id:slot.slot_id,revision:1,text:JSON.stringify(result),final:true});
  const c={...refs(w),outputs:[{slot_id:slot.slot_id,revision:1}]},v=await call(f,'pref-a','chelm_validate_candidate',c),args={...c,candidate_digest:v.candidate_digest,submission_id:'cog-once'};
  await assert.rejects(remoteCall(f.root,'pref-a','chelm_submit_candidate',args,{afterCognitiveCommit(){throw Error('cognitive response lost');}}),/cognitive response lost/);
  apply(f,policy({cognizer_id:'base',mode:'require',fallback:[]}),1);
  const receipt=await call(f,'pref-a','chelm_submit_candidate',args);assert.equal(receipt.status,'committed');
  assert.deepEqual((await next(f,'pref-a','cog-once',{work_kind:'cognitive',task_id:task.task_id})).receipt,receipt);
  assert.equal(ok('task','get',f.root,{task_id:task.task_id}).task.history.length,1);
});
