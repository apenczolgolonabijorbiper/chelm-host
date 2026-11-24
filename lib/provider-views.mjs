import {logicalProjection,providerStatus,openMemory,intakeRows} from './memory-provider.mjs';
import {file,read,write,now,parseNote,tail,assert,fail} from './util.mjs';
import {publishTaskView} from './cognitive.mjs';

export async function publishProvider(root,cfg) {
  const {provider,memory,meta,rows,adapter,contract}=await logicalProjection(cfg);
  const status=await adapter.status(),head=status.head,stamp={schema_version:1,generated_at:now(),
    runtime_id:cfg.runtime_id,head,snapshot_id:meta.snapshot_id,policy_id:meta.policy_id};
  const lease={state:status.lease.held?'held':status.lease.status==='processing'?'expired':'idle',
    run_id:status.lease.run_id??status.lease.last_run_id??null,expires_at:status.lease.expires_at??null};
  const done=new Map(rows.processed.map(r=>[r.id,r])),artifacts=new Map(rows.artifacts.map(r=>[r.origin_locator,Buffer.from(r.base64,'base64')]));
  const observations=[];
  for(const row of rows.observations){
    const bytes=await contract.evidenceBytes(provider,meta.snapshot_id,row.id),s=parseNote(row.path,bytes.toString('utf8')),p=done.get(s.id);
    observations.push({id:s.id,kind:s.kind,subject_id:s[cfg.intake.subject_header]??null,chunk:s.chunk??'',recorded_at:s.recorded_at,
      first_line:s.body.split('\n').find(x=>x.trim())?.slice(0,160)??'',
      state:p?'processed':status.lease.held&&status.lease.observation_ids.includes(s.id)?'claimed':Date.now()-Date.parse(s.recorded_at)>=60000?'ready':'waiting_for_age',
      evidence:artifacts.has(`evidence/${s.id}.json`),run:p?.run??null,processed_at:p?.processed_at??null});
  }
  observations.push(...intakeRows(cfg,status,new Set(observations.map(o=>o.id))));
  observations.sort((a,b)=>b.recorded_at.localeCompare(a.recorded_at));
  // Intake is host state, including not-yet-committed observations. It is not
  // substituted for canonical provider knowledge or snapshot evidence.
  const registry=read(file(root,'host/intake/registry.json'),{}),subjects=Object.create(null);
  for(const [subject,groups]of Object.entries(registry)){
    const kinds=Object.create(null),sets=Object.create(null);
    for(const group of groups){const k=kinds[group.kind]??={observed:0,indexed:0,analyzed:0};
      for(const id of group.ids){const o=observations.find(x=>x.id===id);k.observed++;if(o?.evidence)k.indexed++;if(done.has(id))k.analyzed++;}}
    for(const [name,members]of Object.entries(cfg.intake.kind_sets))sets[name]=Object.fromEntries(['observed','indexed','analyzed'].map(k=>[k,members.reduce((n,m)=>n+(kinds[m]?.[k]??0),0)]));
    subjects[subject]={groups,kinds,sets};
  }
  const events=[...rows.events];
  for(const [p,b]of artifacts)if(/^memory\/events\/chat\/[^/]+\.json$/.test(p)){const e=JSON.parse(b);if(!events.some(x=>x.observation_id===e.observation_id))events.push(e);}
  const answers=Object.fromEntries(events.map(e=>[e.observation_id,{text:e.answer,at:e.answered_at,question_id:e.question_id}]));
  const journals=rows.journals.map(j=>({...j,path:null,committed:rows.processed.filter(p=>p.run===j.id).map(p=>p.processed_at).sort().at(-1)??'',
    observations:rows.processed.filter(p=>p.run===j.id).length}));
  for(const [p,b]of artifacts)if(/^memory\/runs\/[0-9a-f-]+\.md$/.test(p)){
    const id=p.split('/').at(-1).slice(0,-3);if(!journals.some(j=>j.id===id))journals.push({id,path:p,text:b.toString(),committed:rows.processed.filter(x=>x.run===p).map(x=>x.processed_at).sort().at(-1)??''});}
  journals.sort((a,b)=>b.committed.localeCompare(a.committed));
  const stats=await memory.stats(meta.snapshot_id),warnings=await memory.warnings(meta.snapshot_id),errors=await memory.audit(meta.snapshot_id);
  const warning_summary={total:warnings.total,truncated:warnings.truncated},layout={purpose_path:'instance/purpose.md',hypotheses_path:'memory/hypotheses.json'};
  const validation={valid:errors.length===0,errors,warnings:warnings.warnings,warning_summary,layout};
  const config=JSON.parse(artifacts.get('golem.config.json')??'{}'),turns=tail(file(root,'host/conversation/turns.jsonl'),1000000);
  const backend=await providerStatus(cfg);
  const summary={...stamp,instance_path_abs:cfg.instance.path,layout,exists:true,harness_version:'0.12.0',backend,
    profile:{selected:!!config.profile,path:config.profile?.path??null,vocabulary:config.profile?.vocabulary??null},
    totals:{sources:rows.sources.length,entities:rows.entities.length,claims:rows.claims.length,relations:rows.claims.filter(c=>c.object?.entity_id).length,active_claims:rows.claims.filter(c=>c.status==='active').length},
    capacity:Object.fromEntries(Object.entries(stats.capacity??{}).map(([k,v])=>[k,{...v,near_limit:v.used>=Math.ceil(.8*v.limit)}])),warning_summary,metrics_head:head,metrics_generated_at:stamp.generated_at,inbox:observations.length,
    evidence:observations.filter(o=>o.evidence).length,processed:rows.processed.length,pending_analysis:observations.filter(o=>o.state!=='processed').length,
    ready:status.ready.length,waiting_for_age:status.waiting_for_age.length,malformed:status.malformed,lease,hypotheses:rows.hypotheses.length,
    past_answers:Math.floor(turns.length/2),conversation_messages:turns.length,open_questions:rows.questions.filter(q=>q.status==='open').map(({id,text})=>({id,text})),
    last_run:journals[0]??null,graph_updated_at:meta.updated_at,busy:lease.state==='held',delegation:{offered:0,taken:0,returned:0}};
  const views={observations,subjects,questions:rows.questions,answers,journals,warnings:warnings.warnings,requests:read(file(root,'host/requests/requests.json'),[]),delegations:[]};
  for(const [name,data]of Object.entries(views))write(file(root,`host/read-model/${name}.json`),{...stamp,data,...(name==='warnings'?{warning_summary,layout,validation}:{})});
  write(file(root,'host/stats.json'),stats);publishTaskView(root,cfg,head);
  write(file(root,'host/read-model/summary.json'),summary);return summary;
}

export async function providerGet(cfg,sub,id) {
  const {memory,meta,provider,contract}=await openMemory(cfg);
  if(sub==='item'){
    const collection=id?.startsWith('ent-')?'entities':'claims',item=await memory.read(meta.snapshot_id,collection,id);
    assert(item,'item_unknown','Logical item not found');return {item,snapshot_id:meta.snapshot_id};
  }
  if(sub==='journal'){
    const key=id?.endsWith('.md')?id.slice(0,-3):id,row=await memory.read(meta.snapshot_id,'journals',key);
    if(row)return {journal:row,text:row.review,snapshot_id:meta.snapshot_id};
    const artifacts=await contract.records(provider,meta.snapshot_id,'artifacts',{},'audit');
    const old=artifacts.find(x=>x.origin_locator==='memory/runs/'+id);assert(old,'journal_unknown','Journal not found');
    return {text:Buffer.from(old.base64,'base64').toString('utf8').slice(0,20000),snapshot_id:meta.snapshot_id};
  }
  if(sub==='observation'){
    const bytes=await contract.evidenceBytes(provider,meta.snapshot_id,id);
    const artifacts=await contract.records(provider,meta.snapshot_id,'artifacts');
    const original=p=>{const r=artifacts.find(x=>x.origin_locator===p);return r?Buffer.from(r.base64,'base64').toString('utf8').slice(0,60000):null;};
    const events=await contract.records(provider,meta.snapshot_id,'events');
    return {id,inbox:bytes.toString('utf8').slice(0,60000),evidence:original(`evidence/${id}.json`),
      chat_event:original(`memory/events/chat/${id}.json`)??(events.find(x=>x.observation_id===id)?JSON.stringify(events.find(x=>x.observation_id===id)):null),
      analyzed:!!await memory.read(meta.snapshot_id,'processed',id),snapshot_id:meta.snapshot_id};
  }
  fail('usage','Unknown provider get operation');
}
