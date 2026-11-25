import {ok,executor} from './helpers.mjs';
import {remoteCall} from '../lib/remote.mjs';
// Deterministic transport fixture. Never represents model/semantic acceptance.
export async function completedCognition(root,text='Explain the declarations.',request_id='answer-1'){
  const task=ok('task','create',root,{idempotency_key:request_id,text}).task;
  const call=(tool,input)=>remoteCall(root,'synthetic-reader',tool,input);
  const w=await call('chelm_request_work',{work_kind:'cognitive',executor,request_id,task_id:task.task_id});
  const b={work_id:w.work_id,attempt:w.attempt};
  await call('chelm_cognitive_read',{...b,request_id:'round',operation:'round'});
  const context=await call('chelm_cognitive_read',{...b,request_id:'context',operation:'context',options:{current:false}}),findings=[];
  for(const c of context.claims){
    const id=c.sources[0].observation_id;
    const s=await call('chelm_cognitive_read',{...b,request_id:'source-'+id,operation:'source',options:{id,length:16000}});
    findings.push({id:'f-'+c.id,classification:'source_assertion',text:'Synthetic declaration.',claim_ids:[c.id],premise_ids:[],evidence:[{source_id:id,sha256:s.sha256,start:s.start,quote:s.text}],uncertainty:[]});
  }
  const r=await call('chelm_cognitive_read',{...b,request_id:'receipt',operation:'receipt'});
  const result={protocol_version:1,task_id:w.task_id,binding:w.task.binding,outcome:'answer',answer:'Synthetic deterministic fixture; no model used.',findings,questions:[],uncertainty:[],stop_reason:'complete',coverage:r.coverage,usage:r.usage,model:{requested:null,observed:null,configuration:'No LLM; fixed fixture.',cost:null}};
  const slot=w.output_slots.find(s=>s.path==='result.json');
  await call('chelm_stage_output',{...b,slot_id:slot.slot_id,revision:1,text:JSON.stringify(result),final:true});
  const input={...b,outputs:[{slot_id:slot.slot_id,revision:1}]},v=await call('chelm_validate_candidate',input);
  const receipt=await call('chelm_submit_candidate',{...input,candidate_digest:v.candidate_digest,submission_id:'commit'});
  return {task,w,result:ok('task','get',root,{task_id:task.task_id}).task.result,receipt};
}
