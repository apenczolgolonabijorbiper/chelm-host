import test from '../scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fixture,ok,refuse,executor,source,git} from '../helpers.mjs';
import {config} from '../../lib/runtime.mjs';
import {openMemory,upgradeMemory} from '../../lib/memory-provider.mjs';
import {remoteCall} from '../../lib/remote.mjs';
import {createAdapter} from '../../lib/backend.mjs';
import {verifyHarness} from '../../lib/harness.mjs';
import {snapshot,hash} from '../../lib/util.mjs';
const candidateHarness=process.env.CHELM_PROVIDER_HARNESS_ROOT;
const providerTest=(name,fn)=>test(name,{skip:!candidateHarness?'Set CHELM_PROVIDER_HARNESS_ROOT to the published provider package':false},fn);
function upgrade(f){return ok('memory','upgrade',f.root,undefined,{harness:candidateHarness,apply:true});}
const args=w=>({work_id:w.work_id,attempt:w.attempt});
async function changes(run,w){
 const operations=[],at=new Date().toISOString();
 for(const s of w.sources){
   let bytes=[],offset=0;
   do{const r=await run('source',{...args(w),source_id:s.id,offset,max_bytes:20});const b=Buffer.from(r.base64,'base64');bytes.push(b);offset+=b.length;if(offset===r.total_bytes)break;}while(true);
   const raw=Buffer.concat(bytes);assert.equal(hash(raw),s.sha256);const quote=raw.toString('utf8').split('\n---\n').slice(1).join('\n---\n').trim();
   operations.push({op:'add_entity',record:{id:'ent-'+s.id,type:'other',kind:'record',label:'Synthetic',aliases:[],source_ids:[s.id],uncertainty:[],created_at:at}},
   {op:'add_claim',record:{id:'clm-'+s.id,subject_id:'ent-'+s.id,attributed_to_id:'ent-'+s.id,predicate:'describes',object:{value:'Synthetic'},classification:'source_assertion',sources:[{observation_id:s.id,quote}],asserted_at:s.recorded_at,valid_time:{from:null,to:null,expression:null,precision:'unknown'},status:'active',supersedes:[],uncertainty:[],created_at:at}});
 }
 const attempt_id=randomUUID();
 operations.push({op:'append_journal',record:{id:w.run_id,policy_id:w.policy_id,review:'Sources and warnings reviewed; no unresolved alternatives. No language model used.',verification_id:attempt_id,model:executor.model}},
 {op:'append_verification',record:{id:attempt_id,run_id:w.run_id,result:'Deterministic fixture; host checks pending. No actual LLM evaluation.'}});
 return {provider_version:1,base_snapshot:w.snapshot_id,policy_id:w.policy_id,lease_id:w.run_id,run_id:w.run_id,attempt_id,idempotency_key:'cycle-'+w.run_id,at,sources:w.sources.map(({id,sha256})=>({id,sha256})),operations};
}
async function upload(run,w,change,revision=1){
 const text=JSON.stringify(change);const slot_id=w.output_slots[0].slot_id;
 let offset=0;
 // exercise split UTF-8 uploads without a filesystem output from the agent
 for(let pos=0;pos<text.length;pos+=8000){const chunk=text.slice(pos,pos+8000),r=await run('stage',{...args(w),slot_id,revision,offset,text:chunk,final:pos+8000>=text.length});offset=r.next_offset;}
 return {...args(w),outputs:[{slot_id,revision}]};
}
const remote=(f,principal='provider-worker')=>(tool,input={})=>remoteCall(f.root,principal,'chelm_memory_'+tool,input);
providerTest('provider selection preserves existing knowledge and rejects unsupported selections',async t=>{
 const f=fixture(t,{profile:true});f.submit();const legacy=ok('worker','next',f.root,{executor}).work_unit;
 const {analyze}=await import('../helpers.mjs');analyze(f,legacy);ok('worker','submit',f.root,{executor,run_id:legacy.run_id});
 const before=snapshot(f.instance),head=git(f.instance,'rev-parse','HEAD');
 const plan=ok('memory','upgrade',f.root,undefined,{harness:candidateHarness});assert.equal(plan.status,'ready');
 assert.equal(config(f.root).schema_version,2);upgrade(f);
 assert.equal(git(f.instance,'rev-parse','HEAD'),head);assert.deepEqual(snapshot(f.instance),before);
 const status=ok('status',null,f.root);assert.equal(status.backend.kind,'json-git');assert.equal(status.snapshot_id,head);assert.equal(status.head,head);
 assert.equal(ok('context',null,f.root,{query:'Synthetic'}).claims.length,1);
 assert.equal(ok('inspect','claims',f.root).total,1);
 assert.equal(ok('read','journals',f.root).view.data.length,1);
 const p=path.join(f.root,'chelm.runtime.json'),cfg=JSON.parse(fs.readFileSync(p));cfg.memory.kind='sqlite';fs.writeFileSync(p,JSON.stringify(cfg));
 refuse('config_invalid','status',null,f.root);
});
providerTest('local CLI semantic cycle isolates drafts, refuses graph workers and retains portable export',async t=>{
 const f=fixture(t);upgrade(f);const ids=f.submit();
 const run=(cmd,input={})=>Promise.resolve(ok('memory-worker',cmd,f.root,input));
 const w=await run('next',{request_id:'local-1',executor});assert.equal(w.worker_contract,3);
 assert.deepEqual(w.output_slots.map(s=>s.path),['changes.json']);assert(!w.artifacts.some(a=>a.path.endsWith('graph.json')));
 const change=await changes(run,w),c=await upload(run,w,change),v=await run('validate',c);
 assert.equal(ok('context',null,f.root,{query:'Synthetic'}).claims.length,0);
 refuse('contract_removed','worker','next',f.root,{executor});
 const receipt=await run('submit',{...c,candidate_digest:v.candidate_digest,submission_id:'local-submit'});
 assert.equal(receipt.status,'committed');assert.equal(f.read('memory/processed.json').observations.length,1);
 assert.equal(ok('get','item',f.root,{id:'clm-'+ids[0]}).item.id,'clm-'+ids[0]);
 assert.equal(ok('read','journals',f.root).view.data[0].verification_id,change.attempt_id);
 assert.equal(ok('read','observations',f.root).view.data[0].evidence,true);
 assert(ok('get','observation',f.root,{id:ids[0]}).evidence);
 assert.deepEqual(ok('memory','audit',f.root).errors,[]);
 const output=path.join(f.base,'portable.jsonl');ok('memory','export',f.root,{output});
 assert(fs.readFileSync(output,'utf8').includes(change.attempt_id));
 assert.equal((await run('status',args(w))).receipt.id,change.idempotency_key);
});
providerTest('remote semantic cycle enforces owner, attempt, exact evidence, bad quote and response-loss recovery',async t=>{
 const f=fixture(t,{profile:true});upgrade(f);f.submit();const run=remote(f);
 const w=await run('next',{request_id:'remote-1',executor});
 assert.equal((await run('next',{request_id:'remote-1',executor})).work_id,w.work_id);
 await assert.rejects(remote(f,'other')('status',args(w)),{code:'work_not_owned'});
 await assert.rejects(run('status',{...args(w),attempt:2}),{code:'stale_attempt'});
 const change=await changes(run,w),bad=structuredClone(change);bad.operations.find(x=>x.op==='add_claim').record.sources[0].quote='absent quote';
 const b=await upload(run,w,bad);await assert.rejects(run('validate',b),/validation|quote/i);
 const c=await upload(run,w,change,2),v=await run('validate',c);
 const submitted={...c,candidate_digest:v.candidate_digest,submission_id:'remote-submit'};
 await assert.rejects(remoteCall(f.root,'provider-worker','chelm_memory_submit',submitted,{afterMemoryPublish(){throw Error('lost response');}}),/lost response/);
 const recovered=await run('status',args(w));assert.equal(recovered.receipt.status,'committed');
 const retry=await run('submit',submitted);assert.equal(retry.id,recovered.receipt.id);
 assert.equal(f.read('memory/processed.json').observations.length,1);
 await assert.rejects(run('submit',{...submitted,submission_id:'changed'}),{code:'idempotency_conflict'});
 assert.equal(ok('context',null,f.root,{query:'Synthetic'}).claims.length,1);
});
providerTest('publication rechecks source/policy and stale snapshots; renew supports semantic rebase',async t=>{
 const f=fixture(t,{profile:true});upgrade(f);f.submit();const run=remote(f),w=await run('next',{request_id:'rebase',executor});
 const change=await changes(run,w),c=await upload(run,w,change);await run('validate',c);
 await run('renew',args(w));await assert.rejects(run('submit',{...c,candidate_digest:(await run('validate',c)).candidate_digest,submission_id:'old'}),/snapshot|Head changed/i);
 const rebased=await run('rebase',c),updated=await upload(run,{...w,snapshot_id:rebased.snapshot_id},rebased.change,2),v=await run('validate',updated);
 const before=f.text(w.sources[0].path);f.write(w.sources[0].path,before+'Changed');
 await assert.rejects(run('submit',{...updated,candidate_digest:v.candidate_digest,submission_id:'source-change'}),/source changed/i);
 assert.equal(f.read('memory/processed.json').observations.length,0);f.write(w.sources[0].path,before);
 f.write('instance/purpose.md',f.text('instance/purpose.md')+'Changed policy');
 await assert.rejects(run('submit',{...updated,candidate_digest:v.candidate_digest,submission_id:'source-change'}),/policy|profile changed/i);
});
providerTest('local MCP advertises and completes a semantic cycle through shared schemas',async t=>{
 const f=fixture(t);upgrade(f);f.submit();const client=new Client({name:'provider-conformance',version:'1'});
 await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(source,'bin/chelm-mcp.mjs'),'--runtime',f.root],stderr:'pipe'}));t.after(()=>client.close());
 const run=async(cmd,input={})=>{const r=await client.callTool({name:'chelm_memory_'+cmd,arguments:input});const v=JSON.parse(r.content[0].text);assert(!r.isError,JSON.stringify(v));return v;};
 const names=(await client.listTools()).tools.map(t=>t.name);assert(names.includes('chelm_memory_source'));
 const w=await run('next',{request_id:'mcp',executor}),change=await changes(run,w),c=await upload(run,w,change),v=await run('validate',c);
 assert.equal((await run('submit',{...c,candidate_digest:v.candidate_digest,submission_id:'mcp-submit'})).status,'committed');
});

// Run the vendor's unmodified suite against Chelm's transactional JSON store,
// not just the vendor's own reference Git host.
if(candidateHarness){
 const load=p=>import(new URL('file://'+path.join(candidateHarness,p)).href);
 const {providerConformance}=await load('adapters/conformance/provider-suite.mjs');
 const {corpus,run:reservedRun,at}=await load('adapters/conformance/providers/corpus.mjs');
 providerConformance('Chelm JSON/Git provider',async t=>{
   const f=fixture(t,{profile:true});upgrade(f);const state=corpus();let clock=Date.now(),fault;
   f.write('profiles/vocabulary.json',state.meta.policy.vocabulary);
   f.write('golem.config.json',{schema_version:1,profile:{path:'profiles/default.md',vocabulary:'profiles/vocabulary.json'}});
   f.write('memory/graph.json',{schema_version:2,updated_at:at,sources:state.rows.sources,entities:state.rows.entities,claims:state.rows.claims});
   f.write('memory/processed.json',{schema_version:1,updated_at:at,observations:state.rows.processed});
   for(const row of state.rows.observations)f.write(row.path,state.evidence.get(row.id).toString('utf8'));
   const pending=state.rows.observations[1];
   f.write('memory/processing-lock.json',{schema_version:1,status:'processing',run_id:reservedRun,observation_ids:[pending.id],sources:[{id:pending.id,path:pending.path,sha256:pending.sha256}],expires_at:new Date(clock+900000).toISOString()});
   const commit=()=>{git(f.instance,'add','.');git(f.instance,'-c','user.name=Synthetic','-c','user.email=synthetic@local','commit','-qm','Synthetic provider corpus');};commit();
   const cfg=config(f.root),options={instance:f.instance,harness:cfg.harness.root,provider_v1:true,now:()=>clock};
   const adapter=createAdapter({...options,hooks:{beforeMemoryPublish(){if(fault==='before'){fault=null;throw Error('Interrupted before publication');}},afterPublish({operation}){if(fault==='after'&&operation.startsWith('semantic-complete')){fault=null;throw Error('Response lost after publication');}}}});
   return {provider:await adapter.openMemory({instance_id:'synthetic-instance'}),reserve(){},expire(){clock+=900001;},
     changeSource(){f.write(pending.path,f.text(pending.path)+'Changed source');},changePolicy(){f.write('instance/purpose.md',f.text('instance/purpose.md')+'Changed policy');},
     advance(){f.write('advance.txt','Concurrent host artifact');commit();},interrupt(point){fault=point;},
     reopen:async()=>{const fresh=createAdapter(options);await fresh.reconcile();return fresh.openMemory({instance_id:'synthetic-instance'});}};
 });
}

providerTest('HTTP MCP uses shared memory schemas, authenticated scope and byte-paged protocols',async t=>{
 const {startServer}=await import('../../lib/remote-server.mjs');
 const {StreamableHTTPClientTransport}=await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
 const f=fixture(t);upgrade(f);f.submit();
 const token='synthetic-provider-token-01234567890123456789';
 const server=await startServer({port:0,public_url:'http://127.0.0.1/mcp',development:true,runtimes:{app:f.root},auth:{mode:'worker-tokens',workers:[{principal:'provider-http',runtimes:['app'],token_env:'PROVIDER_TOKEN'}]}},{env:{PROVIDER_TOKEN:token}});
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url=`http://127.0.0.1:${server.address().port}/mcp`;
 assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401);
 const client=new Client({name:'provider-http-conformance',version:'1'});await client.connect(new StreamableHTTPClientTransport(new URL(url),{requestInit:{headers:{Authorization:'Bearer '+token}}}));t.after(()=>client.close());
 const run=async(cmd,input={})=>{const r=await client.callTool({name:'chelm_memory_'+cmd,arguments:input}),value=JSON.parse(r.content[0].text);assert(value.ok,JSON.stringify(value));return value;};
 const w=await run('next',{request_id:'http',executor});
 for(const a of w.artifacts){let all=[],offset=0;for(;;){const r=await run('artifact',{...args(w),artifact_id:a.artifact_id,offset});all.push(Buffer.from(r.base64,'base64'));if(r.next_offset===null)break;offset=r.next_offset;}assert.equal(hash(Buffer.concat(all)),a.sha256);}
 const change=await changes(run,w),c=await upload(run,w,change),v=await run('validate',c);assert.equal((await run('submit',{...c,candidate_digest:v.candidate_digest,submission_id:'http-submit'})).status,'committed');
 assert((await client.listPrompts()).prompts.some(p=>p.name==='chelm_memory_once'));
});
providerTest('cognition reads retained provider snapshots without a graph workspace',async t=>{
 const {taskAction}=await import('../../lib/cognitive.mjs');
 const f=fixture(t);upgrade(f);f.submit();const run=remote(f),w=await run('next',{request_id:'cognition-memory',executor}),change=await changes(run,w),c=await upload(run,w,change),v=await run('validate',c);await run('submit',{...c,candidate_digest:v.candidate_digest,submission_id:'cognition-intake'});
 const task=(await taskAction(f.root,'create',{idempotency_key:'cognition-provider',text:'What does the source assert?'})).task;
 const a=await remoteCall(f.root,'cognitive-provider','chelm_request_work',{work_kind:'cognitive',request_id:'cognitive-provider',task_id:task.task_id,executor});
 assert(!fs.existsSync(path.join(f.root,'host/remote/work',a.work_id,'snapshot')));
 const read=(operation,options)=>remoteCall(f.root,'cognitive-provider','chelm_cognitive_read',{...args(a),request_id:operation,operation,options});
 await read('round');const context=await read('context',{query:'Synthetic',current:false});assert.equal(context.claims.length,1);
 const s=await read('source',{id:w.sources[0].id,length:16000});assert.equal(s.sha256,w.sources[0].sha256);
 assert.equal(ok('status',null,f.root).lease.state,'idle');
});

test('memory SudoLang tool names exist in both published transports',async()=>{
 const {remoteToolSchemas}=await import('../../lib/remote-tools.mjs');
 const definitions=JSON.parse(fs.readFileSync(path.join(source,'schemas/memory-worker-tools.json')));
 const prompt=fs.readFileSync(path.join(source,'prompts/memory-worker-once.sudo.md'),'utf8');
 for(const name of prompt.match(/\bchelm_memory_[a-z_]+\b/g)??[]){assert(remoteToolSchemas[name],name);assert(definitions.some(t=>t.name===name),name);}
});
providerTest('interrupted claim recovers the same assignment and admin cancellation releases its lease',async t=>{
 const f=fixture(t);upgrade(f);f.submit();const input={request_id:'lost-claim',executor};
 await assert.rejects(remoteCall(f.root,'claim-owner','chelm_memory_next',input,{afterMemoryClaim(){throw Error('lost claim response');}}),/lost claim response/);
 const run=remote(f,'claim-owner'),w=await run('next',input);assert.equal(w.status,'assigned');assert.equal(w.sources.length,1);
 const again=await run('next',input);assert.equal(again.work_id,w.work_id);assert.equal(again.run_id,w.run_id);
 ok('remote','cancel',f.root,{work_id:w.work_id});assert.equal(ok('status',null,f.root).lease.state,'idle');
 assert.equal((await remote(f,'new-owner')('next',{request_id:'new-claim',executor})).sources[0].id,w.sources[0].id);
});

test('retained Work inference response is immutable and separately reviewed',()=>{
 const dir=path.join(source,'docs/evidence/provider-work-2026-11-24');
 const hashes=JSON.parse(fs.readFileSync(path.join(dir,'hashes.json')));
 for(const [p,digest]of Object.entries(hashes))assert.equal(hash(fs.readFileSync(path.join(dir,p))),digest,p);
 const response=JSON.parse(fs.readFileSync(path.join(dir,'response.json'))),readback=JSON.parse(fs.readFileSync(path.join(dir,'readback.json'))),receipt=JSON.parse(fs.readFileSync(path.join(dir,'receipt.json')));
 assert.equal(readback.claims.length,2);assert.equal(receipt.status,'committed');assert.equal(receipt.run_id,response.run_id);
 assert.equal(response.operations.filter(o=>o.op==='add_claim').length,2);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'semantic-verdict.json'))).independent,false);
});
providerTest('all platforms use the identical published provider manifest',()=>{
 const catalog=JSON.parse(fs.readFileSync(path.join(source,'harness-compatibility.json'))),v=JSON.parse(fs.readFileSync(path.join(candidateHarness,'RELEASE.json'))).version,pin=catalog.approved_releases[v];
 assert.ok(pin.features.includes('memory_provider'));
 assert.equal(hash(fs.readFileSync(path.join(candidateHarness,'RELEASE.json'))),pin.manifest_sha256);
 assert.equal(verifyHarness({harness:{root:candidateHarness},memory:{}}).compatibility.features.memory_provider.status,'pass');
});
