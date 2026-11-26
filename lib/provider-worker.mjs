// The same authenticated, snapshot-bound transport serves local and remote agents.
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {openMemory} from './memory-provider.mjs';
import {file,read,assert,fail,now,hash} from './util.mjs';
import {assignments,activeAssignments,terminal} from './remote-state.mjs';
import {recordPath,workDir,save,addArtifact,stage,candidate,CHUNK_BYTES} from './work-artifacts.mjs';
import {executor} from './worker.mjs';
import {checkProfile} from './profile-install.mjs';
import {publishProvider} from './provider-views.mjs';
import tools from '../schemas/memory-worker-tools.json' with {type:'json'};
import {validateShape} from './schema.mjs';

const protocols=['docs/MEMORY_PROVIDERS.md','docs/MEMORY_MODEL.md','docs/ANALYSIS_WORKFLOW.md'];
const describe=a=>({worker_contract:3,kind:'memory',work_id:a.work_id,attempt:a.attempt,status:a.status,
  run_id:a.run_id,claimed_at:a.claimed_at,expires_at:a.expires_at,snapshot_id:a.base_snapshot,policy_id:a.policy_id,
  lease_id:a.run_id,sources:a.sources,guidance:a.guidance,artifacts:a.artifacts,output_slots:a.slots,
  warnings:a.warnings??[],warning_summary:a.warning_summary??null,
  limits:{chunk_bytes:CHUNK_BYTES,candidate_bytes:a.output_max_bytes,source_bytes:65536},receipt:a.receipt??null});
function samePackage(cfg,a){assert((a.harness_manifest_sha256??'fa8ae35da38a1f64e82336ef99c46fdce35a502c2ff5ebf197e618f10e76e17b')===hash(fs.readFileSync(file(cfg.harness.root,'RELEASE.json'))),'policy_changed','Harness changed during provider assignment');}
function owned(root,principal,args){
  const a=read(recordPath(root,args.work_id));
  assert(a.kind==='memory'&&a.principal===principal,'work_not_owned','Memory work belongs to another principal');
  assert(args.attempt===a.attempt,'stale_attempt','Assignment attempt changed');return a;
}
function binding(a,change){
  assert(change.run_id===a.run_id&&change.lease_id===a.run_id&&change.base_snapshot===a.base_snapshot&&change.policy_id===a.policy_id,
    'binding_mismatch','Change must use the assigned run, lease, snapshot and policy');
  assert(JSON.stringify(change.sources)===JSON.stringify(a.sources.map(({id,sha256})=>({id,sha256}))),
    'binding_mismatch','Change must complete exactly the assigned source identities in order');
  assert(change.operations.find(o=>o.op==='append_journal')?.record?.model===a.executor.model,'model_mismatch','Journal must identify the declared actual model');
}
async function recover(root,cfg,a,memory,adapter){
  if(!a.submission)return null;
  const receipt=await memory.recover(a.submission.key);
  if(!receipt)return null;
  assert(receipt.change_digest===a.submission.change_digest&&receipt.candidate_digest===a.submission.logical_digest,
    'idempotency_conflict','Recovered receipt differs from the retained submission');
  a.receipt={status:'committed',...receipt};a.status='committed';save(root,a);
  await adapter.reconcile();
  await publishProvider(root,cfg);return a.receipt;
}
async function bindClaim(root,cfg,a,claim,memory){
  const current=await memory.open(claim.head);
  Object.assign(a,{run_id:claim.run_id,status:Date.parse(claim.expires_at)>Date.now()?'assigned':'expired',claimed_at:claim.claimed_at??now(),expires_at:claim.expires_at,
    max_expires_at:new Date(Date.parse(a.created_at)+cfg.remote.max_lifetime_minutes*60000).toISOString(),
    harness_manifest_sha256:hash(fs.readFileSync(file(cfg.harness.root,'RELEASE.json'))),
    base_snapshot:current.snapshot_id,policy_id:current.policy_id,guidance:current.policy,sources:claim.sources,
    slots:[{slot_id:randomUUID(),path:'changes.json',required:true}],artifacts:[]});
  for(const p of protocols)addArtifact(a,workDir(root,a.work_id),p,fs.readFileSync(file(cfg.harness.root,p)),'protocol');
  const warnings=await memory.warnings(current.snapshot_id);
  a.warnings=warnings.warnings;a.warning_summary={total:warnings.total,truncated:warnings.truncated};
  save(root,a);await publishProvider(root,cfg);return describe(a);
}
async function recoverClaim(root,cfg,a,adapter,memory){
  if(a.status!=='claiming')return;
  await adapter.reconcile();const status=await adapter.status();
  if(status.lease.host_request_id===a.work_id&&status.lease.status==='processing')
    await bindClaim(root,cfg,a,{...status.lease,head:status.head},memory);
  else {a.status='failed';a.last_error={code:'claim_not_recoverable',at:now()};save(root,a);}
}
export async function memoryWorkCall(root,cfg,principal,tool,args={},hooks={}) {
  assert(cfg.memory,'provider_unavailable','Select a verified memory provider first');
  const schema=tools.find(t=>t.name==='chelm_memory_'+tool)?.inputSchema;
  assert(schema,'tool_unknown','Unknown memory worker operation');
  const errors=validateShape(args,schema);assert(!errors.length,'input_invalid',errors[0]);
  const {adapter,memory,meta,contract,provider,rebaseChanges}=await openMemory(cfg);
  if(tool==='next'){
    const declared=executor(args);
    assert(typeof args.request_id==='string'&&args.request_id.length>0&&args.request_id.length<=128,'input_invalid','A stable request_id is required');
    const identity=contract.digest({request_id:args.request_id,executor:declared,max:args.max??20});
    const prior=assignments(root).find(a=>a.principal===principal&&a.request_id===args.request_id);
    if(prior){samePackage(cfg,prior);assert(prior.kind==='memory'&&prior.request_identity===identity,'idempotency_conflict','Work request changed');await recoverClaim(root,cfg,prior,adapter,memory);await recover(root,cfg,prior,memory,adapter);return describe(prior);}
    if(activeAssignments(root).some(a=>a.kind!=='cognitive'))return {status:'no-work',retry_after_seconds:30};
    if(cfg.profile_expectation?.enforce)assert((await checkProfile(cfg)).matches,'profile_mismatch','Reviewed guidance source has drifted');
    const status=await adapter.status();
    assert(!status.recovery_required,'recovery_required','Settle adapter recovery before claiming');
    if(status.lease.held)return {status:'no-work',retry_after_seconds:30};
    // Persist request identity before claim so an interrupted response cannot
    // create a second assignment. An uncertain claim requires explicit recovery.
    const work_id=randomUUID(),a={kind:'memory',work_id,attempt:1,principal,executor:declared,request_id:args.request_id,
      harness_manifest_sha256:hash(fs.readFileSync(file(cfg.harness.root,'RELEASE.json'))),request_identity:identity,status:'claiming',created_at:now(),sources:[],artifacts:[],slots:[],receipt:null,
      expires_at:new Date(Date.now()+900000).toISOString(),output_max_bytes:1024*1024};
    save(root,a);
    try{
      const claimed=await adapter.claim({max:args.max??20,required_capabilities:['memory-provider-v1'],host_request_id:work_id});
      if(claimed.status==='no-work'){a.status='abandoned';save(root,a);return claimed;}
      await hooks.afterMemoryClaim?.(claimed);
      return bindClaim(root,cfg,a,claimed,memory);
    }catch(e){a.last_error={code:e.code??'claim_uncertain',at:now()};save(root,a);throw e;}
  }
  if(tool==='list'){
    const offset=args.offset??0,limit=args.limit??50;
    assert(Number.isInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>0&&limit<=100,'input_invalid','Invalid page');
    const all=assignments(root).filter(a=>a.kind==='memory'&&a.principal===principal);
    return {work:all.slice(offset,offset+limit).map(describe),next_offset:offset+limit<all.length?offset+limit:null};
  }
  const a=owned(root,principal,args);
  samePackage(cfg,a);
  await recoverClaim(root,cfg,a,adapter,memory);
  if(['status','submit'].includes(tool)){
    const receipt=await recover(root,cfg,a,memory,adapter);
    if(receipt){
      if(tool==='submit')assert(a.submission.id===args.submission_id&&a.submission.manifest_digest===args.candidate_digest,
        'idempotency_conflict','Submission identity changed');
      return tool==='status'?describe(a):receipt;
    }
  }
  if(tool==='status')return {...describe(a),current_snapshot_id:meta.snapshot_id};
  assert(!terminal.has(a.status)&&a.run_id&&Date.parse(a.expires_at)>Date.now(),'work_inactive','Assignment is inactive or its claim needs recovery');
  if(tool==='context')return memory.context(a.base_snapshot,args.filters??{});
  if(tool==='source')return {snapshot_id:a.base_snapshot,id:args.source_id,...await memory.source(a.base_snapshot,args.source_id,{offset:args.offset??0,max_bytes:args.max_bytes??65536})};
  if(tool==='read'){
    assert(['entities','claims','questions','hypotheses','journals','verification','receipts','processed'].includes(args.collection),'input_invalid','Unsupported exact-read collection');
    return {snapshot_id:a.base_snapshot,record:await memory.read(a.base_snapshot,args.collection,args.id)};
  }
  if(tool==='artifact'){
    const item=a.artifacts.find(x=>x.artifact_id===args.artifact_id);assert(item,'artifact_unknown','Unknown protocol artifact');
    const bytes=fs.readFileSync(file(workDir(root,a.work_id),'artifacts/'+item.artifact_id));
    assert(hash(bytes)===item.sha256,'digest_mismatch','Protocol artifact changed');
    const offset=args.offset??0;assert(Number.isInteger(offset)&&offset>=0&&offset<=bytes.length,'input_invalid','Invalid byte offset');
    const end=Math.min(bytes.length,offset+CHUNK_BYTES);
    return {...item,offset,base64:bytes.subarray(offset,end).toString('base64'),next_offset:end<bytes.length?end:null};
  }
  if(tool==='stage'){assert(!a.submission,'submission_pending','Recover the retained submission before changing outputs');return stage(root,a,args);}
  if(tool==='abandon'){
    assert(!a.submission,'submission_pending','Inspect/recover an uncertain submission before abandoning');
    await adapter['release-error']({run:a.run_id});a.status='abandoned';save(root,a);await publishProvider(root,cfg);return describe(a);
  }
  if(tool==='renew'){
    assert(Date.now()<Date.parse(a.max_expires_at),'work_inactive','Maximum assignment lifetime reached');
    const result=await adapter.renew({run:a.run_id});a.expires_at=new Date(Math.min(Date.parse(result.expires_at),Date.parse(a.max_expires_at))).toISOString();
    save(root,a);return {...describe(a),current_snapshot_id:result.head,rebase_required:true};
  }
  assert(['validate','submit','rebase'].includes(tool),'tool_unknown','Unknown memory worker operation');
  const manifest=candidate(root,a,args);let change;
  try{change=JSON.parse(manifest.entries[0].bytes);}catch{fail('input_invalid','The changes.json slot requires a JSON semantic change set');}
  binding(a,change);
  if(tool==='rebase'){
    assert(!a.submission,'submission_pending','Recover an uncertain submission before rebasing');
    const rebased=await rebaseChanges(provider,change,meta.snapshot_id);a.base_snapshot=meta.snapshot_id;save(root,a);
    return {change:rebased,...describe(a),restage_required:true};
  }
  // Reprepare in each process; no ephemeral draft handle is persisted as truth.
  const prepared=await memory.prepare(change);
  try{
    if(tool==='validate'){
      const warnings=await memory.warnings(prepared.snapshot_id);
      return {status:'valid',candidate_digest:manifest.digest,logical_candidate_digest:prepared.candidate_digest,
        change_digest:prepared.change_digest,warnings:warnings.warnings,warning_summary:{total:warnings.total,truncated:warnings.truncated}};
    }
    assert(typeof args.submission_id==='string'&&args.submission_id.length>0&&args.submission_id.length<=128,'input_invalid','Stable submission_id required');
    assert(args.candidate_digest===manifest.digest,'digest_mismatch','Submit the validated output manifest digest');
    const submission={id:args.submission_id,key:change.idempotency_key,change_digest:prepared.change_digest,logical_digest:prepared.candidate_digest,manifest_digest:manifest.digest};
    if(a.submission)assert(contract.digest(a.submission)===contract.digest(submission),'idempotency_conflict','Submission changed');
    a.submission=submission;a.status='submitting';save(root,a);
    let receipt;
    try{
      receipt=await memory.publish(prepared);
      await hooks.afterMemoryPublish?.(receipt);
    }catch(error){
      // A durable negative recovery permits repair. If recovery itself fails,
      // retain the submission as uncertain and refuse changed intent.
      const prior=await memory.recover(submission.key);
      if(!prior){delete a.submission;a.status='staging';save(root,a);}
      throw error;
    }
    a.receipt={status:'committed',...receipt};a.status='committed';save(root,a);await publishProvider(root,cfg);return a.receipt;
  }finally{await memory.abort(prepared.candidate_id);}
}
