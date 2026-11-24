// Mechanical acceptance transport/retention only. An external agent authors responses.
// Run from a checkout with locked dependencies installed. Never point at a private runtime.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const [op,statePath,arg]=process.argv.slice(2);
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const save=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n');};
const sha=b=>createHash('sha256').update(b).digest('hex');
const state=read(statePath), {package_root:pkg,harness_root:harness,runtime,evidence}=state;
const executor={id:'chatgpt-work-acceptance',kind:'agent',model:'unknown (ChatGPT Work)',host:'ChatGPT Work Linux executor'};
const instance=path.join(runtime,'instance');
state.timings??=[];state.cases??={};
const call=(words,input,extra=[])=>{
  const start=performance.now();
  const result=spawnSync(process.execPath,[path.join(pkg,'bin/chelm.mjs'),...words,'--runtime',runtime,...extra,...(input?['--input','-']:[])],{input:input?JSON.stringify(input):undefined,encoding:'utf8',timeout:180000});
  state.timings.push({command:words.join(' '),elapsed_ms:performance.now()-start});save(statePath,state);
  const value=JSON.parse(result.stdout);assert.equal(result.status,0,JSON.stringify(value));assert.equal(value.ok,true,JSON.stringify(value));
  const {ok,messages,...payload}=value;return payload;
};
const git=(...args)=>{const r=spawnSync('git',['-C',instance,...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
async function transport(kind){
  if(kind==='local')return {call:(tool,input)=>call(['cognitive-worker',({chelm_request_work:'next',chelm_cognitive_read:'read',chelm_stage_output:'stage',chelm_validate_candidate:'validate',chelm_submit_candidate:'submit',chelm_work_status:'status',chelm_list_artifacts:'artifacts',chelm_read_artifact:'artifact'})[tool]],input),close:async()=>{}};
  const {startServer}=await import(pathToFileURL(path.join(pkg,'lib/remote-server.mjs')));
  const token='disposable-loopback-acceptance-token';
  const server=await startServer({port:0,public_url:'http://127.0.0.1/mcp',development:true,runtimes:{app:runtime},auth:{mode:'worker-tokens',workers:[{principal:'acceptance-worker',runtimes:['app'],token_env:'CHELM_ACCEPTANCE_TOKEN'}]}},{env:{CHELM_ACCEPTANCE_TOKEN:token}});
  const client=new Client({name:'independent-acceptance-client',version:'1'});
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+server.address().port+'/mcp'),{requestInit:{headers:{Authorization:'Bearer '+token}}}));
  return {call:async(tool,input)=>{const start=performance.now(),r=await client.callTool({name:tool,arguments:input}),v=JSON.parse(r.content[0].text);state.timings.push({command:'HTTP '+tool,elapsed_ms:performance.now()-start});save(statePath,state);assert.equal(v.ok,true,JSON.stringify(v));const {ok,...payload}=v;return payload;},close:async()=>{await client.close();await new Promise(resolve=>server.close(resolve));}};
}
// Fixture ingestion is deterministic and explicitly separate from cognitive inference.
function ingest(rows){
  for(const row of rows){
    const sent=call(['submit'],{subject_id:row.key,groups:[{kind:'record',chunks:[row.text]}]});
    const id=sent.groups[0].observation_ids[0],note=path.join(instance,'inbox',id+'.md');
    fs.writeFileSync(note,fs.readFileSync(note,'utf8').replace(/^recorded_at: .*$/m,'recorded_at: '+new Date(Date.now()-120000).toISOString()));
    fs.rmSync(path.join(instance,'evidence',id+'.json'));row.id=id;
  }
  call(['index']);const unit=call(['worker','next'],{executor:{...executor,kind:'scripted',model:'none (deterministic fixture seeding)'}}).work_unit;
  assert(unit);const graph=read(path.join(instance,'memory/graph.json'));graph.updated_at=new Date().toISOString();
  for(const row of rows){const s=unit.sources.find(s=>s.id===row.id),entity='ent-'+s.id;
    graph.sources.push({id:s.id,path:s.path,sha256:s.sha256,recorded_at:s.recorded_at});
    graph.entities.push({id:entity,type:'other',kind:'record',label:row.key,aliases:[],source_ids:[s.id],uncertainty:[],created_at:graph.updated_at});
    graph.claims.push({id:'clm-'+s.id,subject_id:entity,attributed_to_id:entity,predicate:'describes',object:{value:row.text},classification:'source_assertion',sources:[{observation_id:s.id,quote:row.text}],asserted_at:s.recorded_at,valid_time:{from:row.from??null,to:row.to??null,expression:null,precision:row.from?'exact':'unknown'},status:'active',supersedes:[],uncertainty:[],created_at:graph.updated_at});
  }
  save(path.join(instance,'memory/graph.json'),graph);
  fs.writeFileSync(path.join(instance,unit.journal_path),'# Acceptance fixture seeding\nStarted: '+unit.claimed_at+'\nguidance_version: '+unit.guidance.guidance_identity+'\nDeterministic synthetic seeding; no language model. All source quotes and warnings reviewed. Host checks pending. Completion record: acceptance-state.json keyed by run '+unit.run_id+'.\n');
  const done=call(['worker','submit'],{executor:{...executor,kind:'scripted',model:'none (deterministic fixture seeding)'},run_id:unit.run_id,outputs:['memory/graph.json',unit.journal_path]});
  state.seed_receipts??=[];state.seed_receipts.push(done);state.sources??=[];state.sources.push(...rows);save(statePath,state);
}
const scenarios={
  'local-current':{transport:'local',text:'Compare the Cedar shipment plans. Which plan is latest, how much did it move, and does that establish actual shipment?'},
  'remote-current':{transport:'remote',text:'Compare the Cedar shipment plans. Which plan is latest, how much did it move, and does that establish actual shipment?'},
  'local-asof':{transport:'local',text:'As of 10 May 2026, what was Cedar shipment planned for?',scope:{subject_ids:[],valid_at:'2026-05-10T00:00:00Z'}},
  'remote-identity':{transport:'remote',text:'Which project does Alex Nowak lead? Clarify if the identity is ambiguous.'},
  'remote-missing':{transport:'remote',text:'When did Cedar actually ship, and was it late against the revised plan? Request evidence if missing. You may propose learning separately.',mode:'propose_learning'}
};
if(op==='init'){
  assert(!fs.existsSync(runtime),'Use a fresh disposable runtime');
  call(['init'],null,['--harness',harness]);
  const config=read(path.join(runtime,'chelm.runtime.json'));config.observability={...config.observability,operation_phases:true};save(path.join(runtime,'chelm.runtime.json'),config);
  ingest([
    {key:'cedar-plan-old',text:'Project Cedar shipment planned for 10 June 2026. This plan was issued on 1 May 2026.',from:'2026-05-01T00:00:00Z',to:'2026-05-20T00:00:00Z'},
    {key:'cedar-plan-new',text:'Project Cedar shipment planned for 17 June 2026. This revised plan was issued on 20 May 2026. It replaces the 1 May plan. The actual shipment has not been confirmed.',from:'2026-05-20T00:00:00Z'},
    {key:'alex-pl17',text:'Alex Nowak, employee PL-17 in Krakow, leads Project Cedar.'},
    {key:'alex-de08',text:'Alex Nowak, employee DE-08 in Berlin, leads Project Birch.'}
  ]);
  save(path.join(evidence,'fixture.json'),{sources:state.sources,seeding:'Deterministic observations and graph claims, not model inference.'});
}else if(op==='prepare'){
  const spec=scenarios[arg]??{transport:'remote',resume:true};
  let task;
  if(spec.resume){task=call(['task','get'],{task_id:state.cases['remote-missing'].task_id}).task;assert.equal(task.state,'queued');}
  else task=call(['task','create'],{idempotency_key:arg,text:spec.text,mode:spec.mode??'read_only',...(spec.scope?{scope:spec.scope}:{}),limits:{elapsed_ms:3600000},timeout_ms:7200000}).task;
  const t=await transport(spec.transport);
  try{
    const work=await t.call('chelm_request_work',{work_kind:'cognitive',request_id:arg,task_id:task.task_id,executor});
    assert.equal(work.kind,'cognitive','Complete the previous case before requesting another assignment');
    const identity={work_id:work.work_id,attempt:work.attempt};
    const artifacts=[];for(const a of work.artifacts){let offset=0;do{const item=await t.call('chelm_read_artifact',{...identity,artifact_id:a.artifact_id,offset});artifacts.push(item);offset=item.next_offset;}while(offset!==null);}
    await t.call('chelm_cognitive_read',{...identity,request_id:'round',operation:'round'});
    const context=await t.call('chelm_cognitive_read',{...identity,request_id:'context',operation:'context',options:{current:false}}),sources=[];
    for(const id of new Set(context.claims.flatMap(c=>c.sources.map(s=>s.observation_id))))sources.push(await t.call('chelm_cognitive_read',{...identity,request_id:'source-'+id,operation:'source',options:{id,length:16000}}));
    const receipt=await t.call('chelm_cognitive_read',{...identity,request_id:'receipt',operation:'receipt'});
    state.cases[arg]={transport:spec.transport,task_id:task.task_id,work,head_before:git('rev-parse','HEAD'),tree_before:git('status','--porcelain')};save(statePath,state);
    const request={case_id:arg,work,artifacts,context,sources,receipt};save(path.join(evidence,arg,'request.json'),request);console.log(JSON.stringify({case_id:arg,task:work.task,context,sources,receipt},null,2));
  }finally{await t.close();}
}else if(op==='complete'){
  const c=state.cases[arg],w=c.work,identity={work_id:w.work_id,attempt:w.attempt},dir=path.join(evidence,arg);
  const responsePath=path.join(dir,'response.json'),response=fs.readFileSync(responsePath),r=JSON.parse(response);
  assert(!fs.existsSync(path.join(dir,'completion.json')),'Never rerun or revise accepted responses');
  const t=await transport(c.transport);
  try{
    const outputs=[];
    for(const [name,bytes] of [['result.json',response],...(fs.existsSync(path.join(dir,'learning.json'))?[['learning.json',fs.readFileSync(path.join(dir,'learning.json'))]]:[])]){
      const slot=w.output_slots.find(s=>s.path===name);assert(slot);
      await t.call('chelm_stage_output',{...identity,slot_id:slot.slot_id,revision:1,offset:0,text:bytes.toString('utf8'),final:true});outputs.push({slot_id:slot.slot_id,revision:1});
    }
    const validation=await t.call('chelm_validate_candidate',{...identity,outputs});
    const input={...identity,outputs,candidate_digest:validation.candidate_digest,submission_id:arg};
    const receipt=await t.call('chelm_submit_candidate',input);
    // New server/client sessions use the retained assignment and completion after restart.
    const result=call(['task','get'],{task_id:c.task_id}).task;
    assert.equal(result.result.answer,r.answer);assert.equal(git('rev-parse','HEAD'),c.head_before);assert.equal(git('status','--porcelain'),c.tree_before);
    const citations=[];for(const f of r.findings)for(const e of f.evidence){const retained=call(['task','evidence'],{task_id:c.task_id,work_id:w.work_id,source_id:e.source_id,start:e.start,length:e.quote.length});assert.equal(retained.text,e.quote);citations.push(retained);}
    save(path.join(dir,'completion.json'),{response_sha256:sha(response),validation,receipt,submit_input:input,task:result,citations,read_only_memory_preserved:true});
    console.log(JSON.stringify({case_id:arg,state:result.state,receipt,sha256:sha(response)}));
  }finally{await t.close();}
}else if(op==='collect'){
  ingest([{key:'cedar-actual',text:'Dispatch record CEDAR-2026-0618 confirms that Project Cedar shipped on 18 June 2026.',from:'2026-06-18T00:00:00Z'}]);
  const old=read(path.join(evidence,'remote-missing','response.json'));
  const task=call(['task','continue'],{task_id:state.cases['remote-missing'].task_id,idempotency_key:'approved-collection',messages:[{id:'application-collected',author:'application',kind:'clarification',text:'Application policy approved collection. The dispatch record was submitted as an observation and committed through normal analysis. Please reassess actual shipment and lateness.',reply_to:[old.questions[0].id],intent:{category:'verify',origin:'application',basis:'explicit',description:'Continue after authorized evidence collection',uncertainty:[]}}]}).task;
  save(path.join(evidence,'collection.json'),{authorization:'User-authorized disposable vendor acceptance; application approves synthetic dispatch record collection only.',sources:state.sources.slice(-1),state:task.state,revision:task.revision});
}else if(op==='learning'){
  const c=state.cases[arg],before=git('rev-parse','HEAD'),allowed=arg==='remote-resumed';
  const result=call(['task','learning'],{task_id:c.task_id,work_id:c.work.work_id,allowed,reference:'Application acceptance policy: '+(allowed?'approve the reviewed unverified delay-risk hypothesis':'deny unverified learning before evidence collection')});
  const after=git('rev-parse','HEAD');assert.equal(result.learning.state,allowed?'committed':'rejected');assert.equal(before===after,!allowed);
  save(path.join(evidence,arg,'learning-receipt.json'),{allowed,result,head_before:before,head_after:after});
}else if(op==='verify'){
  const t=await transport('remote'),recovered=[];
  try{
    for(const [name,c] of Object.entries(state.cases)){
      const dir=path.join(evidence,name),completion=read(path.join(dir,'completion.json'));
      assert.equal(sha(fs.readFileSync(path.join(dir,'response.json'))),completion.response_sha256);
      if(c.transport==='remote'){
        const status=await t.call('chelm_work_status',{work_id:c.work.work_id,attempt:c.work.attempt});
        assert.deepEqual(status.receipt,completion.receipt);
        const retry=await t.call('chelm_submit_candidate',completion.submit_input);assert.deepEqual(retry,completion.receipt);
        recovered.push({case_id:name,receipt:retry});
      }
    }
  }finally{await t.close();}
  const final=call(['task','get'],{task_id:state.cases['remote-resumed'].task_id}).task;
  assert.equal(final.history.length,2);assert.equal(final.history[0].state,'needs_input');assert.equal(final.history[1].state,'completed');
  assert.equal(final.learning.state,'committed');
  const graph=read(path.join(instance,'memory/graph.json')),hypotheses=read(path.join(instance,'memory/hypotheses.json'));
  const learning=read(path.join(evidence,'remote-resumed','learning-receipt.json'));
  save(path.join(evidence,'recovery.json'),{recovered,final_task:final,claim_count:graph.claims.length,source_count:graph.sources.length,hypotheses,canonical_learning_receipt:read(path.join(instance,learning.result.learning.receipt.receipt_path))});
  save(path.join(evidence,'phase-timings.json'),{measurement:'Public CLI wall times or HTTP tool wall times, excluding agent reasoning between calls. These overlap with host-internal phases and must not be summed with them.',inference_ms:null,input_tokens:null,output_tokens:null,cost:null,samples:state.timings});
  // Preserve sanitized host envelopes, never worker tokens or server configuration.
  const logs=fs.readdirSync(path.join(runtime,'host/logs')).filter(p=>p.startsWith('chelm.'));
  for(const name of logs)fs.copyFileSync(path.join(runtime,'host/logs',name),path.join(evidence,'host-'+name));
  console.log(JSON.stringify({responses:Object.keys(state.cases).length,recovered:recovered.length,history:final.history.length,learning:final.learning.state}));
}else throw Error('Expected init/prepare/complete/collect/learning/verify');
save(statePath,state);
