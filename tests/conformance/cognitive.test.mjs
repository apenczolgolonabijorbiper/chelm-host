import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {z} from 'zod';
import {fixture,executor,ok,analyze,git,source,harness} from '../helpers.mjs';
import {taskAction,loadCognitiveEngine,cognitiveCommands} from '../../lib/cognitive.mjs';
import {remoteCall} from '../../lib/remote.mjs';
import {remoteToolSchemas} from '../../lib/remote-tools.mjs';
import {file,read,write,hash} from '../../lib/util.mjs';
const integration=test;
const args=w=>({work_id:w.work_id,attempt:w.attempt});
async function setup(t){
  const f=fixture(t),engine=await loadCognitiveEngine(harness),hooks={};
  const task=(op,input)=>taskAction(f.root,op,input,hooks);
  const call=(name,input,principal='worker-b',extra={})=>remoteCall(f.root,principal,name,input,{...hooks,...extra});
  const create=async(input={})=>(await task('create',{idempotency_key:'question-1',text:'Compare the source declarations.',...input})).task;
  const next=async(task_id,request_id='assign-1',principal='worker-b')=>call('chelm_request_work',{work_kind:'cognitive',request_id,executor,task_id},principal);
  return {...f,engine,task,call,create,next};
}
async function resultFor(f,w,{missing=false}={}){
  await f.call('chelm_cognitive_read',{...args(w),request_id:'round-1',operation:'round'});
  const context=await f.call('chelm_cognitive_read',{...args(w),request_id:'context-1',operation:'context',options:{current:false}});
  const findings=[];
  for(const c of context.claims){
    const id=c.sources[0].observation_id;
    const s=await f.call('chelm_cognitive_read',{...args(w),request_id:'source-'+id,operation:'source',options:{id,length:16000}});
    findings.push({id:'f-'+c.id,classification:'source_assertion',text:'Synthetic source assertion.',claim_ids:[c.id],premise_ids:[],evidence:[{source_id:id,sha256:s.sha256,start:s.start,quote:s.text}],uncertainty:[]});
  }
  const r=await f.call('chelm_cognitive_read',{...args(w),request_id:'receipt',operation:'receipt'});
  return {protocol_version:1,task_id:w.task_id,binding:w.task.binding,outcome:missing?'insufficient':'answer',answer:missing?'More evidence is needed.':'Synthetic deterministic fixture; no model was used.',findings,
    questions:missing?[{id:'follow-up',kind:'collection_request',origin:'golem',text:'Provide the missing declaration.',reply_to:[w.task.messages[0].id],premise_ids:[],intent:{origin:'golem',category:'verify',basis:'explicit',description:'Check missing evidence',uncertainty:[]}}]:[],
    uncertainty:missing?['Evidence is incomplete.']:[],stop_reason:missing?'missing_evidence':'complete',coverage:r.coverage,usage:r.usage,model:{requested:null,observed:null,configuration:'Scripted deterministic transport test; no LLM.',cost:null}};
}
async function stage(f,w,result,proposal){
  const outputs=[];
  for(const [p,v]of Object.entries({'result.json':result,...(proposal?{'learning.json':proposal}:{})})){
    const slot=w.output_slots.find(s=>s.path===p);assert(slot);
    const input={...args(w),slot_id:slot.slot_id,revision:1,offset:0,text:JSON.stringify(v),final:true};
    await f.call('chelm_stage_output',input);await f.call('chelm_stage_output',input);
    outputs.push({slot_id:slot.slot_id,revision:1});
  }
  return {...args(w),outputs};
}
const submit=async(f,c,extra={})=>{
  const v=await f.call('chelm_validate_candidate',c);
  const input={...c,candidate_digest:v.candidate_digest,submission_id:'submission-1'};
  return {input,receipt:await f.call('chelm_submit_candidate',input,'worker-b',extra)};
};
function ingest(f){
  f.submit('S-1','First source declaration.');f.submit('S-2','Second independent declaration.');
  const w=ok('worker','next',f.root,{executor}).work_unit;analyze(f,w);
  ok('worker','submit',f.root,{executor,run_id:w.run_id,outputs:['memory/graph.json',w.journal_path]});
}

test('Cognition tool schemas and dependency-free stdio declarations agree',()=>{
  const defs=read(file(source,'schemas/cognitive-worker-tools.json'));
  for(const name of ['cognitive-worker-once.sudo.md','cognitive-worker-resume.sudo.md','cognitive-worker-loop.sudo.md']){const prompt=fs.readFileSync(file(source,'prompts/'+name),'utf8');for(const tool of prompt.match(/\bchelm_[a-z_]+\b/g)??[])assert(remoteToolSchemas[tool],name+': unknown tool '+tool);}
  for(const [op,remote]of Object.entries(cognitiveCommands))assert.deepEqual(defs.find(t=>t.name==='chelm_cognitive_'+op).inputSchema,z.toJSONSchema(remoteToolSchemas[remote],{target:'draft-7'}));
});
test('Published 0.12.0 creates cognition tasks through the production CLI',async t=>{
  const f=fixture(t);
  const created=ok('task','create',f.root,{idempotency_key:'new',text:'Hello'}).task;
  assert.equal(created.state,'queued');
  assert.equal(ok('task','list',f.root).tasks[0].task_id,created.task_id);
});
integration('Empty inbox lifecycle, exact/conflicting retries, atomic ownership, principal scoping and cancellation',async t=>{
  const f=await setup(t),task=await f.create();
  assert.equal(task.state,'queued');assert.equal((await f.create()).task_id,task.task_id);
  await assert.rejects(f.create({text:'Changed'}),e=>e.code==='idempotency_conflict');
  const [a,b]=await Promise.allSettled([f.next(task.task_id),f.next(task.task_id,'assign-2','worker-c')]);
  assert.equal(a.status,'fulfilled');assert(b.status==='rejected'||b.value.status==='no-work');const w=a.value;
  assert.equal(w.kind,'cognitive');assert.equal(ok('status',null,f.root).lease.state,'idle');
  await assert.rejects(f.call('chelm_work_status',args(w),'worker-c'),e=>e.code==='work_not_owned');
  await assert.rejects(f.call('chelm_work_status',{...args(w),attempt:2}),e=>e.code==='stale_attempt');
  assert.equal((await f.next(task.task_id)).work_id,w.work_id);
  await f.task('cancel',{task_id:task.task_id});
  assert.equal((await f.task('get',{task_id:task.task_id})).task.state,'cancelled');
  await assert.rejects(f.call('chelm_cognitive_read',{...args(w),request_id:'x',operation:'round'}),e=>e.code==='work_inactive');
  assert.equal((await f.call('chelm_work_status',args(w))).status,'cancelled');
});
integration('Multi-source result, evidence scoping, exact bytes and response-loss recovery preserve canonical memory',async t=>{
  const f=await setup(t);ingest(f);
  const before=git(f.instance,'rev-parse','HEAD'),tree=git(f.instance,'status','--porcelain');
  const task=await f.create(),w=await f.next(task.task_id),r=await resultFor(f,w);assert.equal(r.findings.length,2);
  const c=await stage(f,w,r),v=await f.call('chelm_validate_candidate',c),input={...c,candidate_digest:v.candidate_digest,submission_id:'loss'};
  await assert.rejects(f.call('chelm_submit_candidate',input,'worker-b',{afterCognitiveCommit(){throw Error('injected response loss');}}),/response loss/);
  const recovered=(await f.task('get',{task_id:task.task_id})).task;
  assert.equal(recovered.state,'completed');assert.equal(recovered.history.length,1);
  const receipt=await f.call('chelm_submit_candidate',input);assert.deepEqual(receipt,recovered.receipt);
  assert.equal((await f.call('chelm_list_work',{})).work.filter(a=>a.kind==='cognitive').length,1);
  const source=r.findings[0].evidence[0],evidence=await f.task('evidence',{task_id:task.task_id,work_id:w.work_id,source_id:source.source_id,length:16000});
  assert.equal(evidence.text,source.quote);assert.deepEqual(evidence.binding,w.task.binding);
  const stored=read(file(f.root,'host/remote/work/'+w.work_id+'/record.json'));
  assert.equal(stored.completion.accepted_bytes['result.json'],JSON.stringify(r));
  assert.equal(git(f.instance,'rev-parse','HEAD'),before);assert.equal(git(f.instance,'status','--porcelain'),tree);
  await assert.rejects(f.call('chelm_submit_candidate',{...input,submission_id:'different'}),e=>e.code==='idempotency_conflict');
  ok('refresh',null,f.root);assert.equal(ok('read','tasks',f.root).view.data[0].state,'completed');
});
integration('Bounded reads deduplicate retries, reject forged citations and arbitrary canonical output slots',async t=>{
  const f=await setup(t);ingest(f);const task=await f.create(),w=await f.next(task.task_id);
  const readArgs={...args(w),request_id:'same-read',operation:'context'};
  const first=await f.call('chelm_cognitive_read',readArgs);assert.deepEqual(await f.call('chelm_cognitive_read',readArgs),first);
  await assert.rejects(f.call('chelm_cognitive_read',{...readArgs,options:{query:'different'}}),e=>e.code==='idempotency_conflict');
  const r=await resultFor(f,w);r.findings[0].evidence[0].quote='Invented';const c=await stage(f,w,r);
  await assert.rejects(f.call('chelm_validate_candidate',c),e=>e.code==='cognitive_invalid');
  await assert.rejects(f.call('chelm_stage_output',{...args(w),slot_id:'00000000-0000-4000-8000-000000000001',revision:1,text:'{}',final:true}),e=>e.code==='bad_outputs');
});
integration('Expired work resumes with a fresh owned attempt and total attempt/deadline budgets remain finite',async t=>{
  const f=await setup(t),task=await f.create({max_attempts:2}),w=await f.next(task.task_id);
  const p=file(f.root,'host/remote/work/'+w.work_id+'/record.json'),a=read(p);a.expires_at=new Date(0).toISOString();write(p,a);
  await assert.rejects(f.call('chelm_cognitive_read',{...args(w),request_id:'x',operation:'round'}),e=>e.code==='work_inactive');
  const next=await f.next(task.task_id,'retry');assert.notEqual(next.work_id,w.work_id);
  assert.equal((await f.task('get',{task_id:task.task_id})).task.attempts.length,2);
  await f.call('chelm_abandon_work',args(next));assert.equal((await f.task('get',{task_id:task.task_id})).task.state,'failed');
  const other=await f.create({idempotency_key:'timeout',timeout_ms:1000});
  const tp=file(f.root,'host/tasks/'+other.task_id+'.json'),record=read(tp);record.deadline=new Date(0).toISOString();write(tp,record);
  assert.equal((await f.task('get',{task_id:other.task_id})).task.state,'expired');
});
integration('Concurrent memory commits retain honest stale bindings, strict freshness and guidance policy refusal',async t=>{
  const f=await setup(t),task=await f.create(),w=await f.next(task.task_id),r=await resultFor(f,w),c=await stage(f,w,r);
  f.submit('S-1','Concurrent pending evidence.');const a=await submit(f,c);assert.equal(a.receipt.status,'committed');
  // Intake alone is uncommitted: publish a real observation cycle while another read task is active.
  const strict=await f.create({idempotency_key:'strict',freshness:'require_current'}),sw=await f.next(strict.task_id,'strict');
  const sr=await resultFor(f,sw),sc=await stage(f,sw,sr);assert.equal(sr.coverage.pending_count,1,'Pending uncommitted intake stays visible but uncitable');
  const unit=ok('worker','next',f.root,{executor}).work_unit;analyze(f,unit);ok('worker','submit',f.root,{executor,run_id:unit.run_id,outputs:['memory/graph.json',unit.journal_path]});
  await assert.rejects(f.call('chelm_validate_candidate',sc),e=>e.code==='stale_snapshot');
  assert.equal((await f.task('get',{task_id:task.task_id})).task.stale,true);
});
integration('Reviewed learning commits once; rejection preserves memory and bounded follow-up retains result history',async t=>{
  const f=await setup(t),task=await f.create({mode:'propose_learning',max_continuations:1}),w=await f.next(task.task_id),r=await resultFor(f,w,{missing:true});
  const proposal={protocol_version:1,proposal_id:'proposal-1',task_id:task.task_id,binding:w.task.binding,operation:'add_hypothesis',target_id:null,hypothesis_id:'hyp-check',statement:'A further check may be useful.',support:[],refutation:[],uncertainty:['No independent verification.'],rationale:'Missing evidence.',verification_needed:['Obtain a source.']};
  await submit(f,await stage(f,w,r,proposal));
  assert.equal((await f.task('get',{task_id:task.task_id})).task.state,'needs_input');
  const before=git(f.instance,'rev-parse','HEAD');
  const learning=await f.task('learning',{task_id:task.task_id,work_id:w.work_id,allowed:true,reference:'Existing application authorization'});
  assert.equal(learning.learning.state,'committed',JSON.stringify(learning));assert.notEqual(git(f.instance,'rev-parse','HEAD'),before);
  assert.deepEqual((await f.task('learning',{task_id:task.task_id,work_id:w.work_id,allowed:true,reference:'Retry'})).learning,learning.learning);
  const recordPath=file(f.root,'host/remote/work/'+w.work_id+'/record.json'),record=read(recordPath);record.learning={state:'publishing'};write(recordPath,record);
  await assert.rejects(f.task('learning',{task_id:task.task_id,work_id:w.work_id,allowed:false,reference:'Unknown outcome recovery'}),e=>e.code==='learning_terminal');
  assert.equal((await f.task('get',{task_id:task.task_id})).task.learning.state,'committed');
  const msg={id:'reply-1',author:'user',kind:'question_answer',text:'Collection was denied. Keep the uncertainty.',reply_to:['follow-up'],intent:{category:'clarify',origin:'user',basis:'explicit',description:'Respond to evidence request',uncertainty:[]}};
  await f.task('continue',{task_id:task.task_id,idempotency_key:'resume-1',messages:[msg]});
  const w2=await f.next(task.task_id,'second'),r2=await resultFor(f,w2);await submit(f,await stage(f,w2,r2));
  const final=(await f.task('get',{task_id:task.task_id})).task;assert.equal(final.history.length,2);assert.equal(final.state,'completed');
  await assert.rejects(f.task('continue',{task_id:task.task_id,idempotency_key:'exhausted',messages:[msg]}),e=>e.code==='budget');
});

import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {startServer} from '../../lib/remote-server.mjs';
integration('Independent authenticated MCP client completes and reconnects to the same snapshot/result contract',async t=>{
  const f=await setup(t);ingest(f);const task=await f.create();
  let server,client;
  async function connect(){
    server=await startServer({port:0,public_url:'http://127.0.0.1/mcp',development:true,runtimes:{app:f.root},auth:{mode:'worker-tokens',workers:[{principal:'worker-b',runtimes:['app'],token_env:'TEST_COGNITIVE_TOKEN'}]}},{env:{TEST_COGNITIVE_TOKEN:'synthetic-conformance-token-not-a-secret'}});
    client=new Client({name:'independent-cognitive-client',version:'1'});
    await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+server.address().port+'/mcp'),{requestInit:{headers:{Authorization:'Bearer synthetic-conformance-token-not-a-secret'}}}));
  }
  async function close(){await client?.close();await new Promise(resolve=>server.close(resolve));}
  await connect();t.after(close);
  f.call=async(name,input)=>{
    const result=await client.callTool({name,arguments:input});
    const value=JSON.parse(result.content[0].text);assert.notEqual(result.isError,true,JSON.stringify(value));const {ok,...payload}=value;assert.equal(ok,true,JSON.stringify(value));return payload;
  };
  const w=await f.call('chelm_request_work',{work_kind:'cognitive',request_id:'http-work',task_id:task.task_id,executor});
  const result=await resultFor(f,w),c=await stage(f,w,result),done=await submit(f,c);
  await close();await connect();
  assert.deepEqual((await f.call('chelm_work_status',args(w))).receipt,done.receipt);
  assert.deepEqual(await f.call('chelm_submit_candidate',done.input),done.receipt);
  assert.equal(ok('task','get',f.root,{task_id:task.task_id}).task.state,'completed');
});

integration('Read-only/rejected/stale learning and policy drift cannot publish invalid canonical changes',async t=>{
  const f=await setup(t);ingest(f);const task=await f.create({mode:'propose_learning',max_continuations:1}),w=await f.next(task.task_id),r=await resultFor(f,w);
  const proposal={protocol_version:1,proposal_id:'deny',task_id:task.task_id,binding:w.task.binding,operation:'add_hypothesis',target_id:null,hypothesis_id:'hyp-deny',statement:'This is an unverified hypothesis.',support:[r.findings[0].claim_ids[0]],refutation:[],uncertainty:['Unverified'],rationale:'A check is proposed.',verification_needed:['Obtain independent evidence.']};
  await submit(f,await stage(f,w,r,proposal));const before=git(f.instance,'rev-parse','HEAD');
  assert.equal((await f.task('learning',{task_id:task.task_id,work_id:w.work_id,allowed:false,reference:'Policy denies writeback'})).learning.state,'rejected');
  assert.equal(git(f.instance,'rev-parse','HEAD'),before);
  const second=await f.create({idempotency_key:'stale-proposal',mode:'propose_learning'}),w2=await f.next(second.task_id,'stale-proposal'),r2=await resultFor(f,w2);
  const p2={...proposal,proposal_id:'stale',task_id:second.task_id,binding:w2.task.binding,hypothesis_id:'hyp-stale'};
  await submit(f,await stage(f,w2,r2,p2));
  f.write('instance/purpose.md','Changed committed application policy.');git(f.instance,'add','instance/purpose.md');git(f.instance,'-c','user.name=Test','-c','user.email=test@local','commit','-qm','policy change');
  const head=git(f.instance,'rev-parse','HEAD');
  assert.equal((await f.task('learning',{task_id:second.task_id,work_id:w2.work_id,allowed:true,reference:'Existing app policy'})).learning.state,'blocked');
  assert.equal(git(f.instance,'rev-parse','HEAD'),head);assert.equal((await f.task('get',{task_id:second.task_id})).task.state,'completed');
  const third=await f.create({idempotency_key:'policy-change'}),w3=await f.next(third.task_id,'policy-change');
  f.write('instance/purpose.md','Second committed policy.');git(f.instance,'add','instance/purpose.md');git(f.instance,'-c','user.name=Test','-c','user.email=test@local','commit','-qm','second policy');
  await assert.rejects(f.call('chelm_cognitive_read',{...args(w3),operation:'context',request_id:'policy'}),e=>e.code==='policy_changed');
});


integration('Exhausted cognition budgets return stable errors while leaving memory untouched',async t=>{
  const f=await setup(t),task=await f.create({limits:{rounds:1}}),w=await f.next(task.task_id);
  const before=git(f.instance,'rev-parse','HEAD');
  await f.call('chelm_cognitive_read',{...args(w),request_id:'round-1',operation:'round'});
  await assert.rejects(f.call('chelm_cognitive_read',{...args(w),request_id:'round-2',operation:'round'}),e=>e.code==='budget');
  assert.equal(git(f.instance,'rev-parse','HEAD'),before);
  assert.equal(ok('status',null,f.root).lease.state,'idle');
});
