// Host-owned selection. Only public, integrity-checked Harness modules cross API 2.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {file,read,write,assert,hash,git,snapshot,now,parseNote} from './util.mjs';
import {ensureHarness,verifyHarness,packageRoot} from './harness.mjs';
import {createAdapter} from './backend.mjs';
import {activeAssignments} from './remote-state.mjs';
import {instanceDrafts} from './instance-operational.mjs';

export const selection = Object.freeze({kind:'json-git',provider_version:1,host_api_version:2,storage_version:2});
export function checkSelection(value) {
  assert(value && Object.keys(value).length===4 && Object.entries(selection).every(([k,v])=>value[k]===v),
    'provider_unsupported','Unsupported memory provider, storage version or integration contract');
}
export async function openMemory(cfg, snapshot_id) {
  checkSelection(cfg.memory); ensureHarness(cfg);
  const load=p=>import(pathToFileURL(file(cfg.harness.root,p)).href);
  const [{createMemory,rebaseChanges},contract,transfer]=await Promise.all([
    load('server/provider-memory.mjs'),
    load('server/memory-contract.mjs'),load('server/memory-transfer.mjs')]);
  const adapter=createAdapter({instance:cfg.instance.path,harness:cfg.harness.root,node:cfg.harness.node,git:cfg.harness.git,provider_v1:true});
  const provider=contract.assertProvider(await adapter.openMemory({instance_id:cfg.runtime_id}));
  const memory=createMemory(provider),meta=await memory.open(snapshot_id);
  return {adapter,provider,memory,meta,contract,transfer,rebaseChanges};
}
export async function providerStatus(cfg) {
  const {provider,meta}=await openMemory(cfg);
  return {...cfg.memory,...provider.describe(),kind:cfg.memory.kind,snapshot_id:meta.snapshot_id,
    policy_id:meta.policy_id,physical_provenance:{kind:'git',head:git(cfg.instance.path,['rev-parse','HEAD']).trim()},
    package:{status:'published',production_enabled:true,provider_version:1,host_api_version:2,...verifyHarness(cfg).compatibility}};
}
export async function upgradeMemory(root,cfg,{harness,apply=false}={}) {
  assert(!cfg.memory,'provider_already_selected','A provider is already selected; switching requires verified migration');
  assert(typeof harness==='string'&&harness.length,'usage','Specify the exact provider-enabled Harness package');
  const next={...cfg,schema_version:3,memory:{...selection},harness:{...cfg.harness,root:path.resolve(harness)}};
  verifyHarness(next);
  const {adapter,memory,meta}=await openMemory(next);
  const status=await adapter.status();
  assert(!fs.existsSync(file(root,'host/publication-pending.json')),'recovery_required','Settle host publication recovery before selecting a provider');
  assert(!status.lease.held && !status.recovery_required && activeAssignments(root).length===0,'busy','Drain leases, assignments and recovery before selecting a provider');
  assert(instanceDrafts(cfg.instance.path).length===0,'busy','Preserve and settle instance drafts before provider selection');
  const errors=await memory.audit(meta.snapshot_id);
  assert(errors.length===0,'validation_failed','Existing knowledge failed the provider audit',{errors});
  const before=snapshot(cfg.instance.path),report={status:apply?'selected':'ready',selection:next.memory,
    snapshot_id:meta.snapshot_id,files:before.size,knowledge_rewritten:false,release_status:read(file(packageRoot,'provider-compatibility.json')).status};
  if(apply){
    const p=file(root,'chelm.runtime.json'),original=read(p);
    // Preserve original relative paths and every application-owned setting.
    write(file(root,'host/provider-upgrade-v1.json'),{at:now(),before:original,source_snapshot:meta.snapshot_id,
      hashes:Object.fromEntries([...before].map(([p,b])=>[p,hash(b)])),selection:next.memory});
    write(p,{...original,schema_version:3,memory:{...selection},harness:{...original.harness,root:next.harness.root}});
  }
  return report;
}
// Full enumeration belongs to host read-model refresh, never the agent protocol.
export async function logicalProjection(cfg) {
  const opened=await openMemory(cfg),{provider,memory,meta,contract}=opened,rows={};
  for(const c of contract.collections)rows[c]=await contract.records(provider,meta.snapshot_id,c);
  return {...opened,rows};
}
export async function openCognition(cfg,snapshot_id) {
  const {provider,meta}=await openMemory(cfg,snapshot_id);
  const {createProviderReadView}=await import(pathToFileURL(file(cfg.harness.root,'server/cognitive-reference.mjs')).href);
  return createProviderReadView(provider,meta.snapshot_id);
}
export async function publishProviderLearning(cfg,request) {
  checkSelection(cfg.memory);ensureHarness(cfg);
  // Separate existing cognition contract. JSON provider lifecycle delegates to
  // its public transactional learning operation, never to an agent graph edit.
  const {createAdapter:reference}=await import(pathToFileURL(file(cfg.harness.root,'adapters/reference-git/adapter.mjs')).href);
  return reference({instance:cfg.instance.path,harness:cfg.harness.root,node:cfg.harness.node,git:cfg.harness.git}).publishLearning(request);
}
export function intakeRows(cfg,status,committedIds) {
  // Host intake precedes canonical memory. These rows explicitly have no
  // snapshot binding until a provider-capable claim captures their exact bytes.
  checkSelection(cfg.memory);
  return [...status.ready,...status.waiting_for_age].filter(s=>!committedIds.has(s.id)).map(row=>{
    const s=parseNote(row.path,fs.readFileSync(file(cfg.instance.path,row.path),'utf8'));
    return {id:s.id,kind:s.kind,subject_id:s[cfg.intake.subject_header]??null,chunk:s.chunk??'',recorded_at:s.recorded_at,
      first_line:s.body.split('\n').find(x=>x.trim())?.slice(0,160)??'',state:Date.now()-Date.parse(s.recorded_at)>=60000?'ready':'waiting_for_age',
      evidence:fs.existsSync(file(cfg.instance.path,`evidence/${s.id}.json`)),run:null,processed_at:null,intake_only:true,snapshot_id:null};
  });
}
