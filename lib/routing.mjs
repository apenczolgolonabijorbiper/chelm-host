// Request-driven dispatch only. All mutations run under the runtime operation lock.
// Identity comes from the authenticated transport / OS, never executor metadata.
import fs from 'node:fs';
import os from 'node:os';
import {file,read,write,assert,actor,hash,now} from './util.mjs';
import {validateShape} from './schema.mjs';
import policySchema from '../schemas/cognizer-routing.schema.json' with {type:'json'};
import toolSchemas from '../schemas/routing-worker-tools.json' with {type:'json'};
import qualification from '../harness-compatibility.json' with {type:'json'};

export const routingCapability='cognizer-routing-v1';
export const localRoutingIdentity=()=>({transport:'local',principal:actor(),host:os.hostname()});
export const remoteRoutingIdentity=principal=>({transport:'remote',principal});
const statePath=root=>file(root,'host/routing/state.json');
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const digest=v=>hash(JSON.stringify(stable(v)));
const disabled=()=>({schema_version:1,mode:'disabled'});
export function validateRoutingPolicy(value){
  if(value===undefined||value===null)return disabled();
  const errors=validateShape(value,policySchema);
  assert(!errors.length,'routing_policy_invalid',errors[0]);
  const p=structuredClone(value);
  if(p.mode==='disabled'){
    assert(Object.keys(p).every(k=>['schema_version','mode'].includes(k)),'routing_policy_invalid','Disabled policy accepts only schema_version and mode');
    return p;
  }
  for(const k of ['cognizer_id','work_kinds','grace_seconds','fallback','readiness_ttl_seconds','workers'])assert(Object.hasOwn(p,k),'routing_policy_invalid','Missing routing policy field: '+k);
  for(const list of [p.work_kinds,p.fallback,p.workers.map(w=>w.binding_id)])assert(new Set(list).size===list.length,'routing_policy_invalid','Duplicate routing identity or scope');
  assert(!p.fallback.includes(p.cognizer_id),'routing_policy_invalid','Preferred cognizer cannot also be fallback');
  assert(p.mode!=='require'||p.fallback.length===0,'routing_policy_invalid','Require mode has no fallback');
  const identities=p.workers.map(w=>{
    assert(w.transport!=='local'||typeof w.host==='string','routing_policy_invalid','Local bindings require an OS hostname');
    assert(w.transport!=='remote'||w.host===undefined,'routing_policy_invalid','Remote bindings use authenticated principal only');
    return digest({transport:w.transport,principal:w.principal,host:w.host??null});
  });
  assert(new Set(identities).size===identities.length,'routing_policy_invalid','One authenticated identity cannot name several cognizers');
  for(const c of [p.cognizer_id,...p.fallback])assert(p.workers.some(w=>w.cognizer_id===c),'routing_policy_invalid','No configured binding for cognizer: '+c);
  return p;
}
function load(root,cfg){
  const seed=validateRoutingPolicy(cfg.preferred_cognizer);
  const s=read(statePath(root),null);
  if(s){
    assert(s.schema_version===1&&s.runtime_id===cfg.runtime_id,'routing_state_invalid','Routing state belongs to another runtime');
    assert(Number.isSafeInteger(s.revision)&&s.revision>=0&&s.registrations&&s.pending&&Array.isArray(s.history),'routing_state_invalid','Malformed routing state');
    for(const p of Object.values(s.pending))assert(Number.isFinite(Date.parse(p.eligible_at)),'routing_state_invalid','Malformed pending eligibility clock');
    validateRoutingPolicy(s.policy);
    assert(s.seed_digest===digest(seed),'routing_config_changed','Runtime routing seed changed; restore the seed and use routing preview/apply');
    return s;
  }
  return {schema_version:1,runtime_id:cfg.runtime_id,revision:0,seed_digest:digest(seed),policy:seed,registrations:{},pending:{},history:[]};
}
const bindingFor=(p,who)=>p.workers?.find(w=>w.transport===who.transport&&w.principal===who.principal&&(w.transport!=='local'||w.host===who.host));
const manifest=cfg=>hash(fs.readFileSync(file(cfg.harness.root,'RELEASE.json')));
const requirements=(kind,contract)=>({host_contract:contract,capabilities:[routingCapability,...(kind==='cognitive'?['cognitive-task-v1','cognitive-context-v1','cognitive-result-v1','learning-hypothesis-v1','hypothesis-unknown-confidence-v1']:contract==='memory-worker-v3'?['memory-provider-v1']:['purpose-guidance-v2'])]});
function readiness(s,cfg,w,kind,contract,at){
  const r=s.registrations[w.binding_id],req=requirements(kind,contract);
  if(!r||r.binding_digest!==digest(w))return {ready:false,reason:'worker_unregistered'};
  const expires=Math.min(Date.parse(r.expires_at),Date.parse(r.heartbeat_at)+s.policy.readiness_ttl_seconds*1000);
  if(!Number.isFinite(expires)||expires<=at)return {ready:false,reason:'worker_expired'};
  const release=read(file(cfg.harness.root,'RELEASE.json')),approved=qualification.approved_releases[release.version];
  const feature=kind==='cognitive'?'cognitive_tasks':contract==='memory-worker-v3'?'memory_provider':'file_worker';
  if(!approved?.features.includes(feature)||approved.manifest_sha256!==manifest(cfg))return {ready:false,reason:'worker_incompatible'};
  if(r.harness_manifest_sha256!==manifest(cfg)||!r.host_contracts.includes(req.host_contract)||!req.capabilities.every(c=>r.capabilities.includes(c)))return {ready:false,reason:'worker_incompatible'};
  return {ready:true,reason:'ready'};
}
function preferredReadiness(s,cfg,kind){
  const states=s.policy.workers.filter(w=>w.cognizer_id===s.policy.cognizer_id).map(w=>readiness(s,cfg,w,kind,kind==='cognitive'?'cognitive-worker-v2':cfg.memory?'memory-worker-v3':w.transport==='local'?'file-worker-v1':'remote-worker-v2',Date.now()));
  return states.some(r=>r.ready)?'ready':states.some(r=>r.reason==='worker_incompatible')?'incompatible':states.some(r=>r.reason==='worker_expired')?'expired':'unregistered';
}
export function routingStatus(root,cfg){
  const s=load(root,cfg),p=s.policy,at=Date.now();
  return {capability:routingCapability,revision:s.revision,policy:p,source:fs.existsSync(statePath(root))?'persisted':'runtime_seed',local_identity:localRoutingIdentity(),
    effective:Object.fromEntries((p.work_kinds??[]).map(k=>[k,{preferred_readiness:preferredReadiness(s,cfg,k),degraded:preferredReadiness(s,cfg,k)!=='ready'}])),
    configured_seed:cfg.preferred_cognizer??null,
    workers:(p.workers??[]).map(w=>({...w,registration:s.registrations[w.binding_id]??null,eligibility:Object.fromEntries((p.work_kinds??[]).map(k=>[k,readiness(s,cfg,w,k,k==='cognitive'?'cognitive-worker-v2':cfg.memory?'memory-worker-v3':w.transport==='local'?'file-worker-v1':'remote-worker-v2',at)]))})),
    pending_grace_records:Object.keys(s.pending).length,history:s.history};
}
export function routingBusy(root,cfg,kind,reason){
  const s=load(root,cfg);
  return s.policy.mode!=='disabled'&&s.policy.work_kinds.includes(kind)
    ?{status:'busy',reason,retry_after_seconds:30,routing:{capability:routingCapability,revision:s.revision,scope:kind}}
    :{status:'no-work',retry_after_seconds:30};
}
// Local admin authority is the existing runtime filesystem/OS account boundary.
// No worker MCP/HTTP tool exposes these operations.
export function routingAdmin(root,cfg,command,input={}){
  const s=load(root,cfg);
  if(command==='status')return routingStatus(root,cfg);
  assert(['preview','apply'].includes(command),'usage','Expected routing status|preview|apply');
  assert(Object.keys(input).every(k=>['expected_revision','preferred_cognizer'].includes(k))&&Object.hasOwn(input,'preferred_cognizer'),'input_invalid','Supply expected_revision and preferred_cognizer');
  assert(Number.isSafeInteger(input.expected_revision)&&input.expected_revision===s.revision,'routing_revision_conflict','Routing policy revision changed',{revision:s.revision});
  const policy=validateRoutingPolicy(input.preferred_cognizer);
  const result={revision:s.revision,next_revision:s.revision+1,policy,affects:'new_assignments_only',local_identity:localRoutingIdentity()};
  if(command==='preview')return result;
  s.history.push({revision:s.revision,policy:s.policy,replaced_at:now(),actor:localRoutingIdentity()});s.history=s.history.slice(-20);
  s.policy=policy;s.revision++;s.applied_at=now();
  s.registrations=Object.fromEntries(Object.entries(s.registrations).filter(([id,r])=>policy.workers?.some(w=>w.binding_id===id&&r.binding_digest===digest(w))));
  // Keep pending eligibility clocks across switches/rollback; registrations are
  // invalidated by binding digest, so changing a binding never transfers readiness.
  write(statePath(root),s);
  return {...result,revision:s.revision,applied:true};
}
export function routingWorker(root,cfg,who,command,input={}){
  const schema=toolSchemas.find(t=>t.name==='chelm_routing_'+command)?.inputSchema;
  assert(schema,'tool_unknown','Unknown routing worker operation');
  const errors=validateShape(input,schema);assert(!errors.length,'input_invalid',errors[0]);
  const s=load(root,cfg),w=bindingFor(s.policy,who);
  assert(w,'routing_identity_unregistered','No routing binding for this authenticated identity');
  if(command!=='status'){
    if(command==='register')s.registrations[w.binding_id]={binding_digest:digest(w),host_contracts:input.host_contracts,capabilities:input.capabilities,harness_manifest_sha256:input.harness_manifest_sha256,registered_at:now()};
    const r=s.registrations[w.binding_id];
    assert(r?.binding_digest===digest(w),'routing_registration_required','Register this binding before heartbeat');
    r.heartbeat_at=now();r.expires_at=new Date(Date.now()+s.policy.readiness_ttl_seconds*1000).toISOString();
    write(statePath(root),s);
  }
  return {capability:routingCapability,revision:s.revision,binding_id:w.binding_id,cognizer_id:w.cognizer_id,identity:who,mode:s.policy.mode,scope:s.policy.work_kinds,
    required_harness_manifest_sha256:manifest(cfg),
    required_contracts:Object.fromEntries(s.policy.work_kinds.map(k=>[k,requirements(k,k==='cognitive'?'cognitive-worker-v2':cfg.memory?'memory-worker-v3':who.transport==='local'?'file-worker-v1':'remote-worker-v2')])),
    registration:s.registrations[w.binding_id]??null,
    eligibility:Object.fromEntries(s.policy.work_kinds.map(k=>[k,readiness(s,cfg,w,k,k==='cognitive'?'cognitive-worker-v2':cfg.memory?'memory-worker-v3':who.transport==='local'?'file-worker-v1':'remote-worker-v2',Date.now())]))};
}
// Called after authorization/retry/availability checks and before claim/reserve,
// within the SAME runtime operation lock. items are in the queue's existing order.
// A key identifies a source digest or task revision, never a poll/request/worker.
export function routeCandidates(root,cfg,who,kind,contract,items){
  const s=load(root,cfg),p=s.policy;
  if(p.mode==='disabled'||!p.work_kinds.includes(kind)||!items.length)return {items};
  const at=Date.now();
  for(const i of items)s.pending[i.routing_key]??={eligible_at:new Date(at).toISOString()};
  write(statePath(root),s);
  const w=bindingFor(p,who),ready=w?readiness(s,cfg,w,kind,contract,at):{ready:false,reason:'worker_unregistered'};
  const selected=[];let retry=30,reason=ready.reason;
  if(ready.ready){
    if(w.cognizer_id===p.cognizer_id)selected.push(...items);
    else if(p.mode==='require')reason='preferred_required';
    else if(!p.fallback.includes(w.cognizer_id))reason='fallback_not_allowed';
    else{
      reason='preferred_grace';
      for(const i of items){
        const remaining=p.grace_seconds*1000-(at-Date.parse(s.pending[i.routing_key].eligible_at));
        if(remaining<=0)selected.push(i);
        else retry=Math.min(retry,Math.max(1,Math.ceil(remaining/1000)));
      }
    }
  }
  if(!selected.length)return {items:[],deferred:{status:'deferred',reason,retry_after_seconds:retry,routing:{capability:routingCapability,revision:s.revision,mode:p.mode,scope:kind,preferred_readiness:preferredReadiness(s,cfg,kind)}}};
  return {items:selected,routing:{capability:routingCapability,revision:s.revision,mode:p.mode,scope:kind,cognizer_id:w.cognizer_id,binding_id:w.binding_id,identity:who,selected_at:new Date(at).toISOString()}};
}
export const observationRoutingKey=s=>'observation:'+s.id+':'+s.sha256;
