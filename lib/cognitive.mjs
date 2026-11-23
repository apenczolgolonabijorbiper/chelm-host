// Host lifecycle and durable transport binding for the portable Harness protocol.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {file,read,write,hash,json,assert,fail,id,now,git,snapshot,lock,actor,parseNote} from './util.mjs';
import {config} from './runtime.mjs';
import {checkProfile} from './profile-install.mjs';
import {ensureHarness} from './harness.mjs';
import {executor} from './worker.mjs';
import {usage,metadata} from './telemetry.mjs';
import {assignments,activeAssignments,terminal} from './remote-state.mjs';
import {recordPath,workDir,save,setupRepository,addArtifact,stage,candidate} from './work-artifacts.mjs';

export const cognitiveCommands = {
  next:'chelm_request_work', status:'chelm_work_status', list:'chelm_list_work',
  artifacts:'chelm_list_artifacts', artifact:'chelm_read_artifact', read:'chelm_cognitive_read',
  stage:'chelm_stage_output', validate:'chelm_validate_candidate', submit:'chelm_submit_candidate',
  renew:'chelm_renew_work', abandon:'chelm_abandon_work'
};
const defaults={rounds:8,context_requests:24,claims:40,source_bytes:262144,expansion_budget:4000,elapsed_ms:600000};
const taskPath=(root,key)=>file(root,'host/tasks/'+id(key)+'.json');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const fingerprint=v=>hash(JSON.stringify(stable(v)));
function fields(input,allowed){assert(input&&typeof input==='object'&&!Array.isArray(input),'input_invalid','Expected an input object');for(const k of Object.keys(input))assert(allowed.includes(k),'input_invalid','Unknown cognitive option: '+k);}
function key(v){assert(typeof v==='string'&&v.length>0&&v.length<=128,'input_invalid','Stable idempotency/request key of 1..128 characters required');return v;}
const taskRecords=root=>{
  const dir=file(root,'host/tasks');
  return fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>read(file(dir,n))).sort((a,b)=>a.created_at.localeCompare(b.created_at)||a.task_id.localeCompare(b.task_id)):[];
};
const attempts=(root,t)=>assignments(root).filter(a=>a.kind==='cognitive'&&a.task_id===t.task_id).sort((a,b)=>a.assignment_index-b.assignment_index);
const latest=(root,t)=>attempts(root,t).filter(a=>a.task_revision===t.revision).at(-1);
function state(root,t){
  if(t.cancelled_at)return 'cancelled';
  const a=latest(root,t);
  if(a?.completion)return a.completion.state;
  if(Date.parse(t.deadline)<=Date.now())return 'expired';
  if(a&&!terminal.has(a.status)&&Date.parse(a.expires_at)>Date.now())return 'running';
  if(attempts(root,t).length>=t.max_attempts)return 'failed';
  return 'queued';
}
function render(root,t,head){
  const aa=attempts(root,t),a=latest(root,t),s=state(root,t);
  return {...t,state:s,attempts:aa.map(x=>({work_id:x.work_id,attempt:x.attempt,revision:x.task_revision,status:x.status,expires_at:x.expires_at,receipt:x.receipt??null})),
    result:a?.completion?.result??null,receipt:a?.receipt??null,learning:a?.learning??{state:'none'},
    answered_at:a?.completion?.published_at??null,answered_binding:a?.task.binding??null,
    stale:a?head!==a.base_head:null,current_snapshot_id:head,
    history:aa.filter(x=>x.completion).map(x=>({work_id:x.work_id,revision:x.task_revision,...x.completion,learning:x.learning??{state:'none'}}))};
}
export function publishTaskView(root,cfg,head){
  write(file(root,'host/read-model/tasks.json'),{schema_version:1,runtime_id:cfg.runtime_id,generated_at:now(),head,data:taskRecords(root).map(t=>render(root,t,head))});
}
// The production loader only imports modules from a verified supported package.
// Tests inject a real, pinned Harness source engine through function-only hooks.
export async function loadCognitiveEngine(root){
  const core=await import(pathToFileURL(file(root,'server/cognitive-task.mjs')).href);
  const {createAdapter}=await import(pathToFileURL(file(root,'adapters/reference-git/adapter.mjs')).href);
  return {...core,adapter:instance=>createAdapter({instance,harness:root}),protocol:p=>fs.readFileSync(file(root,p),'utf8')};
}
async function engineFor(cfg,override){
  if(override)return override;
  ensureHarness(cfg);
  assert(fs.existsSync(file(cfg.harness.root,'server/cognitive-task.mjs')),'capability_unavailable',
    'The pinned published Harness 0.11.0 lacks cognitive-task-v1. A supported published cognition release must be pinned before enabling task execution.');
  const engine=await loadCognitiveEngine(cfg.harness.root);
  assert(['cognitive-task-v1','cognitive-context-v1','cognitive-result-v1','learning-hypothesis-v1'].every(c=>engine.cognitiveCapabilities.includes(c)),
    'capability_unavailable','Harness cognitive contracts unavailable');
  return engine;
}
function checkErrors(errors){assert(errors.length===0,'cognitive_invalid','Harness rejected cognitive data',{errors});}
function message(text){return {id:randomUUID(),author:'user',kind:'user_question',text,reply_to:[],intent:{category:'unknown',origin:'user',basis:'unknown',description:'User intent awaits cognitive interpretation.',uncertainty:[]}};}
function ownedTask(root,task_id,owner){assert(fs.existsSync(taskPath(root,task_id)),'task_unknown','Task is unknown or archived');const t=read(taskPath(root,task_id));assert(t.owner===owner,'task_not_owned','Task belongs to another application principal');return t;}
function headView(root){return read(file(root,'host/read-model/summary.json')).head;}
export async function taskAction(root,sub,input={},hooks={}){
  const cfg=config(root),owner=actor();
  if(['get','list','evidence'].includes(sub)){
    fields(input,sub==='list'?['offset','limit','conversation_id']:sub==='get'?['task_id']:['task_id','work_id','source_id','start','length']);
    if(sub==='list'){
      const offset=input.offset??0,limit=input.limit??50;
      assert(Number.isInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>=1&&limit<=100,'input_invalid','Invalid page bounds');
      const rows=taskRecords(root).filter(t=>t.owner===owner&&(!input.conversation_id||t.conversation_id===input.conversation_id));
      return {tasks:rows.slice(offset,offset+limit).map(t=>render(root,t,headView(root))),next_offset:offset+limit<rows.length?offset+limit:null};
    }
    const t=ownedTask(root,input.task_id,owner);
    if(sub==='get'){const value=render(root,t,headView(root)),cached=read(file(root,'host/read-model/tasks.json'),{data:[]}).data.find(row=>row.task_id===t.task_id);return {task:value,read_view_refresh_pending:!same(cached?.receipt,value.receipt)||!same(cached?.learning,value.learning)};}
    const a=attempts(root,t).find(a=>a.work_id===input.work_id);
    assert(a?.completion,'result_unavailable','No retained result for this attempt');
    assert(a.completion.result.findings.some(f=>f.evidence.some(e=>e.source_id===input.source_id)),'source_unavailable','Source is not cited by this answer');
    id(input.source_id);
    const p=file(workDir(root,a.work_id),'snapshot/inbox/'+input.source_id+'.md');
    assert(fs.existsSync(p),'source_unavailable','Retained snapshot evidence unavailable');
    const bytes=fs.readFileSync(p),s=parseNote('inbox/'+input.source_id+'.md',bytes.toString('utf8'));
    const expected=a.trusted.sources.find(s=>s.id===input.source_id)?.sha256;
    assert(hash(bytes)===expected,'source_unavailable','Retained snapshot evidence changed');
    const start=input.start??0,length=input.length??4000;
    assert(Number.isInteger(start)&&start>=0&&start<=s.body.length&&Number.isInteger(length)&&length>0&&length<=16000,'input_invalid','Invalid source range');
    return {binding:a.task.binding,source_id:s.id,sha256:s.sha256,start,text:s.body.slice(start,start+length),next_offset:start+length<s.body.length?start+length:null};
  }
  return lock(root,'task '+sub,async()=>{
    const engine=await engineFor(cfg,hooks.engine);
    let result;
    if(sub==='create'){
      fields(input,['idempotency_key','text','messages','conversation_id','mode','scope','limits','freshness','max_attempts','max_continuations','timeout_ms','output_max_bytes']);
      key(input.idempotency_key);
      const prior=taskRecords(root).find(t=>t.owner===owner&&t.idempotency_key===input.idempotency_key);
      const identity=fingerprint(input);
      if(prior){assert(prior.input_identity===identity,'idempotency_conflict','Task input changed for this key');return {task:render(root,prior,headView(root))};}
      assert(!(input.text!==undefined&&input.messages!==undefined),'input_invalid','Supply text or messages');
      const task_id=randomUUID(),binding={instance_id:cfg.runtime_id,snapshot_id:'unassigned',guidance_id:'unassigned'};
      const task={protocol_version:1,task_id,conversation_id:input.conversation_id??task_id,binding,mode:input.mode??'read_only',messages:input.messages??[message(input.text)],scope:input.scope??{subject_ids:[],valid_at:null},limits:{...defaults,...input.limits}};
      checkErrors(engine.validateTask(task));
      const freshness=input.freshness??'allow_stale',max_attempts=input.max_attempts??3,max_continuations=input.max_continuations??2,timeout=input.timeout_ms??3600000,output_max_bytes=input.output_max_bytes??262144;
      assert(['allow_stale','require_current'].includes(freshness),'input_invalid','Invalid freshness');
      for(const [v,min,max]of [[max_attempts,1,16],[max_continuations,0,8],[timeout,1000,86400000],[output_max_bytes,1024,1048576]])assert(Number.isInteger(v)&&v>=min&&v<=max,'input_invalid','Unsupported task bound');
      const t={task_id,owner,idempotency_key:input.idempotency_key,input_identity:identity,conversation_id:task.conversation_id,template:task,revision:1,continuations:0,continuation_keys:[],created_at:now(),deadline:new Date(Date.now()+timeout).toISOString(),freshness,max_attempts,max_continuations,output_max_bytes};
      write(taskPath(root,task_id),t);result={task:render(root,t,headView(root))};
    }else{
      fields(input,sub==='cancel'?['task_id']:sub==='continue'?['task_id','idempotency_key','messages']:sub==='learning'?['task_id','work_id','allowed','reference']:[]);
      const t=ownedTask(root,input.task_id,owner),s=state(root,t);
      if(sub==='cancel'){
        assert(!['completed','failed','expired'].includes(s),'task_terminal','Task has already stopped');
        t.cancelled_at??=now();write(taskPath(root,t.task_id),t);
        for(const a of attempts(root,t))if(!terminal.has(a.status)){a.status='cancelled';save(root,a);}
      }else if(sub==='continue'){
        key(input.idempotency_key);const prior=t.continuation_keys.find(k=>k.key===input.idempotency_key);
        if(prior){assert(prior.identity===fingerprint(input),'idempotency_conflict','Continuation input changed');return {task:render(root,t,headView(root))};}
        assert(['needs_input','completed','failed'].includes(s)&&Date.parse(t.deadline)>Date.now(),'task_not_resumable','Task cannot continue in this state');
        assert(t.continuations<t.max_continuations&&attempts(root,t).length<t.max_attempts,'budget','Continuation/attempt budget exhausted');
        assert(Array.isArray(input.messages)&&input.messages.length>0&&input.messages.every(m=>['user','application'].includes(m.author)),'input_invalid','Continuation requires explicit application/user messages');
        const a=latest(root,t),previous=a?.completion?.result;
        const transcript=[...t.template.messages,...(previous?[{id:'answer-'+a.work_id,author:'golem',kind:'answer',text:previous.answer.slice(0,16000),reply_to:t.template.messages.slice(-32).map(m=>m.id),intent:{category:'explain',origin:'golem',basis:'explicit',description:'Retained result of the preceding bounded invocation.',uncertainty:previous.uncertainty.slice(0,20)}}]:[]),...(previous?.questions??[]).map(q=>({id:q.id,author:'golem',kind:q.kind,text:q.text,reply_to:q.reply_to,intent:q.intent}))];
        const messages=[...transcript,...input.messages];
        checkErrors(engine.validateTask({...t.template,messages}));
        t.template.messages=messages;t.revision++;t.continuations++;t.continuation_keys.push({key:input.idempotency_key,identity:fingerprint(input)});write(taskPath(root,t.task_id),t);
      }else if(sub==='learning'){
        assert(typeof input.allowed==='boolean'&&typeof input.reference==='string'&&input.reference.length>0&&input.reference.length<=1000,'input_invalid','Application authorization and reference required');
        const a=attempts(root,t).find(a=>a.work_id===input.work_id);
        assert(a?.completion?.proposal,'proposal_unavailable','This result has no learning proposal');
        assert(s!=='cancelled','task_terminal','Cancelled task cannot publish learning');
        if(['publishing','blocked'].includes(a.learning?.state)){
          const receipt_path='memory/learning/'+hash(json(a.completion.proposal.proposal_id))+'.json';
          const tree=snapshot(cfg.instance.path),retained=tree.get(receipt_path);
          if(retained){const prior=JSON.parse(retained);assert(same(prior.proposal,a.completion.proposal)&&prior.task_id===t.task_id,'learning_conflict','Retained learning identity differs');a.learning={state:'committed',at:prior.published_at,receipt:{status:'already_published',head:git(cfg.instance.path,['rev-parse','HEAD']).trim(),receipt_path},reference:prior.authorization_reference};save(root,a);}
        }
        if(a.learning?.state==='committed'){assert(input.allowed,'learning_terminal','Learning already committed');const {publish}=await import('./read-model.mjs');publish(root,cfg);return {learning:a.learning};}
        if(a.learning?.state==='rejected'){assert(!input.allowed,'learning_terminal','Learning already rejected');return {learning:a.learning};}
        if(!input.allowed)a.learning={state:'rejected',at:now(),reference:input.reference};
        else{
          assert(t.template.mode==='propose_learning','mode_unsupported','Read-only tasks cannot learn');
          a.learning={state:'publishing',at:now(),reference:input.reference};save(root,a);
          try{
            const receipt=await engine.adapter(cfg.instance.path).publishLearning({task:a.task,proposal:a.completion.proposal,authorization:{allowed:true,task_id:t.task_id,proposal_id:a.completion.proposal.proposal_id,reference:input.reference}});
            a.learning={state:'committed',receipt,at:now(),reference:input.reference};
          }catch(e){a.learning={state:'blocked',reason:e.message,at:now(),reference:input.reference};}
        }
        save(root,a);if(a.learning.state==='committed'){const {publish}=await import('./read-model.mjs');publish(root,cfg);}result={learning:a.learning};
      }else fail('usage','Unknown task command');
      result??={task:render(root,t,headView(root))};
    }
    const head=git(cfg.instance.path,['rev-parse','HEAD']).trim();publishTaskView(root,cfg,head);
    return result;
  });
}

export function describeCognitive(a){
  return {worker_contract:2,kind:'cognitive',work_id:a.work_id,attempt:a.attempt,task_id:a.task_id,status:a.status,claimed_at:a.claimed_at,expires_at:a.expires_at,
    task:a.task,guidance:a.guidance,base_head:a.base_head,guidance_identity:a.task.binding.guidance_id,artifacts:a.artifacts,artifact_count:a.artifacts.length,output_slots:a.slots,
    limits:{chunk_bytes:32768,candidate_bytes:a.output_max_bytes},receipt:a.receipt??null,learning:a.learning??{state:'none'}};
}
export async function requestCognitive(root,cfg,principal,args,hooks={}){
  const engine=await engineFor(cfg,hooks.engine);executor(args);key(args.request_id);
  const identity=fingerprint({executor:args.executor,task_id:args.task_id??null});
  const prior=assignments(root).find(a=>a.principal===principal&&a.request_id===args.request_id);
  if(prior){assert(prior.kind==='cognitive'&&prior.request_identity===identity,'idempotency_conflict','Work request changed');return describeCognitive(prior);}
  // Independent quotas preserve observation capacity; explicit selection gives the external scheduler fairness control.
  if(activeAssignments(root).filter(a=>a.kind==='cognitive').length>=cfg.remote.max_active_work)return {status:'no-work',retry_after_seconds:30};
  const t=taskRecords(root).find(t=>state(root,t)==='queued'&&(!args.task_id||args.task_id===t.task_id));
  if(!t)return {status:'no-work',retry_after_seconds:30};
  if(cfg.profile_expectation?.enforce)assert((await checkProfile(cfg)).matches,'profile_mismatch','Reviewed application guidance has drifted');
  const work_id=randomUUID(),dir=workDir(root,work_id),base_head=git(cfg.instance.path,['rev-parse','HEAD']).trim(),tree=snapshot(cfg.instance.path,base_head);
  try{
  setupRepository(cfg,file(dir,'snapshot'),tree);
  const captured=await engine.adapter(file(dir,'snapshot')).openCognition({instance_id:cfg.runtime_id});
  const task={...t.template,binding:{...captured.binding,snapshot_id:base_head}};
  checkErrors(engine.validateTask(task));
  const a={kind:'cognitive',work_id,attempt:1,task_id:t.task_id,task_revision:t.revision,assignment_index:attempts(root,t).length+1,principal,executor:executor(args),request_id:args.request_id,request_identity:identity,status:'assigned',task,guidance:captured.guidance,base_head,
    pending_count:read(file(root,'host/read-model/observations.json')).data.filter(o=>o.state!=='processed').length,
    sources:[],created_at:now(),claimed_at:now(),updated_at:now(),expires_at:new Date(Math.min(Date.now()+cfg.remote.assignment_minutes*60000,Date.now()+task.limits.elapsed_ms,Date.parse(t.deadline))).toISOString(),
    max_expires_at:new Date(Math.min(Date.now()+task.limits.elapsed_ms,Date.parse(t.deadline))).toISOString(),harness_release_sha256:hash(fs.readFileSync(file(cfg.harness.root,'RELEASE.json'))),
    output_max_bytes:t.output_max_bytes,artifacts:[],slots:[{slot_id:randomUUID(),path:'result.json',required:true},...(task.mode==='propose_learning'?[{slot_id:randomUUID(),path:'learning.json',required:false}]:[])],operations:[],receipt:null};
  for(const p of ['docs/COGNITIVE_TASKS.md','integration/COGNITIVE_TASK.sudo.md','schemas/cognitive-result.schema.json','schemas/cognitive-learning.schema.json'])
    addArtifact(a,dir,p,Buffer.from(await engine.protocol(p,cfg)), 'protocol');
  save(root,a);return describeCognitive(a);
  }catch(e){if(!fs.existsSync(recordPath(root,work_id)))fs.rmSync(dir,{recursive:true,force:true});throw e;}
}
async function sessionFor(root,a,engine){
  const captured=await engine.adapter(file(workDir(root,a.work_id),'snapshot')).openCognition({instance_id:a.task.binding.instance_id});
  assert(captured.binding.guidance_id===a.task.binding.guidance_id,'snapshot_changed','Retained guidance changed');
  const binding=a.task.binding;
  const pending_count=a.pending_count??captured.pending_count;
  const view={...captured,binding,pending_count,context:async o=>({...await captured.context(o),binding,pending_count}),source:async(i,r)=>({...await captured.source(i,r),binding})};
  let clock=0;const s=engine.createCognitiveSession(a.task,view,{now:()=>clock});
  const perform=async op=>{if(op.operation==='round'){s.beginRound();return s.receipt().usage;}if(op.operation==='context')return s.context(op.options??{});if(op.operation==='source')return s.source(op.options?.id,op.options??{});if(op.operation==='receipt')return s.receipt();fail('input_invalid','Unknown cognition read operation');};
  for(const op of a.operations){clock=op.elapsed_ms;await perform(op);}
  clock=Math.max(0,Date.now()-Date.parse(a.claimed_at));
  return {s,perform};
}
async function fresh(cfg,a,engine){
  assert(hash(fs.readFileSync(file(cfg.harness.root,'RELEASE.json')))===a.harness_release_sha256,'policy_changed','Harness changed during assignment');
  const current=await engine.adapter(cfg.instance.path).openCognition({instance_id:cfg.runtime_id});
  assert(current.binding.guidance_id===a.task.binding.guidance_id,'policy_changed','Committed guidance changed; explicitly continue on a new snapshot');
  return current.binding.snapshot_id!==a.base_head;
}
export async function cognitiveWorkCall(root,cfg,a,tool,args,hooks={}){
  if(tool==='chelm_work_status')return describeCognitive(a);
  if(tool==='chelm_submit_candidate'&&a.completion){
    assert(a.submission.id===args.submission_id&&a.submission.digest===args.candidate_digest&&same(a.submission.outputs,args.outputs)&&same(a.submission.usage,usage(args.usage)),'idempotency_conflict','Completion retry differs');return a.receipt;
  }
  const t=read(taskPath(root,a.task_id));
  if(tool==='chelm_submit_candidate')metadata({usage:usage(args.usage)});
  assert(!t.cancelled_at&&!terminal.has(a.status)&&a.task_revision===t.revision&&Date.parse(a.expires_at)>Date.now(),'work_inactive','Cognitive attempt is no longer active');
  const engine=await engineFor(cfg,hooks.engine);
  if(tool==='chelm_renew_work'){a.expires_at=new Date(Math.min(Date.now()+cfg.remote.assignment_minutes*60000,Date.parse(a.max_expires_at))).toISOString();save(root,a);return describeCognitive(a);}
  if(tool==='chelm_abandon_work'){a.status='abandoned';save(root,a);return {status:'abandoned',work_id:a.work_id};}
  if(tool==='chelm_cognitive_read'){
    key(args.request_id);assert(!a.validated,'candidate_frozen','Evidence receipt frozen after validation; repair by submitting a new output revision');
    const identity=fingerprint({operation:args.operation,options:args.options??{}}),prior=a.operations.find(o=>o.request_id===args.request_id);
    if(prior){assert(prior.identity===identity,'idempotency_conflict','Read request changed');return prior.response;}
    assert(a.operations.length<100,'budget','Tool usage exhausted');
    await fresh(cfg,a,engine);
    const {s,perform}=await sessionFor(root,a,engine),op={request_id:args.request_id,operation:args.operation,options:args.options??{},identity,elapsed_ms:Date.now()-Date.parse(a.claimed_at)};
    op.response=await perform(op);assert(Buffer.byteLength(json([...a.operations,op]))<=8*1024*1024,'budget','Cumulative context/audit storage exceeds 8 MiB');a.operations.push(op);a.trusted=s.receipt();save(root,a);return op.response;
  }
  if(tool==='chelm_stage_output'){assert(!a.submission,'candidate_frozen','Result submission is fixed');a.validated=null;return stage(root,a,args);}
  if(tool==='chelm_validate_candidate'||tool==='chelm_submit_candidate'){
    const c=candidate(root,a,args);
    if(a.submission)assert(a.submission.id===args.submission_id&&a.submission.digest===c.digest,'idempotency_conflict','Submission changed');
    const stale=await fresh(cfg,a,engine);
    assert(!stale||t.freshness==='allow_stale','stale_snapshot','Task requires current memory; explicitly continue');
    let sealed;
    if(a.validated?.digest===c.digest)sealed=a.validated;
    else{
      const {s}=await sessionFor(root,a,engine);const entry=c.entries.find(e=>e.path==='result.json');
      let result,proposal=null;
      try{result=JSON.parse(entry.bytes);const p=c.entries.find(e=>e.path==='learning.json');if(p)proposal=JSON.parse(p.bytes);}catch{fail('cognitive_invalid','Outputs must be JSON');}
      // Executor usage is never trusted. Bind authoritative measurements then retain exact uploaded bytes.
      try{result=s.finish(result);}catch(e){fail('cognitive_invalid',e.message);}
      const trusted=s.receipt();result.usage=trusted.usage;checkErrors(engine.validateResult(result,a.task,trusted));
      assert(result.usage.rounds>0,'cognitive_invalid','Begin at least one bounded round');
      if(proposal)checkErrors(engine.validateLearning(proposal,a.task,trusted));
      sealed={digest:c.digest,result,proposal,trusted,bytes:Object.fromEntries(c.entries.map(e=>[e.path,e.bytes.toString('utf8')]))};
      a.validated=sealed;save(root,a);
    }
    if(tool==='chelm_validate_candidate')return {status:'validated',candidate_digest:c.digest,usage:sealed.result.usage,coverage:sealed.result.coverage,stale};
    key(args.submission_id);assert(args.candidate_digest===c.digest,'digest_mismatch','Submit the validated digest');
    a.submission={id:args.submission_id,digest:c.digest,outputs:args.outputs,usage:usage(args.usage)};a.trusted=sealed.trusted;
    const result=sealed.result,published_at=now();
    a.completion={reported_usage:usage(args.usage),result,proposal:sealed.proposal,accepted_bytes:sealed.bytes,published_at,stale,
      state:result.outcome==='answer'&&result.stop_reason==='complete'?'completed':result.stop_reason==='missing_evidence'?'needs_input':'failed'};
    a.learning={state:sealed.proposal?'pending':'none'};a.status='committed';
    a.receipt={status:'committed',task_state:a.completion.state,task_id:a.task_id,work_id:a.work_id,attempt:a.attempt,task_revision:a.task_revision,submission_id:args.submission_id,candidate_digest:c.digest,binding:a.task.binding,published_at};
    save(root,a); // One atomic record contains exact bytes, sealed result, receipt and final state.
    hooks.afterCognitiveCommit?.();
    publishTaskView(root,cfg,git(cfg.instance.path,['rev-parse','HEAD']).trim());return a.receipt;
  }
  assert(['chelm_list_artifacts','chelm_read_artifact'].includes(tool),'tool_unknown','Use cognitive read operations for this assignment');
  return null; // Shared immutable artifact paging remains in the existing transport.
}
