// Synthetic vendor evidence. Measures JSON costs; never run on a consumer store.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {initialize,config} from '../lib/runtime.mjs';
import {upgradeMemory,openMemory} from '../lib/memory-provider.mjs';
import {publishProvider} from '../lib/provider-views.mjs';
import {file,write,git,hash} from '../lib/util.mjs';
const opt=k=>process.argv[process.argv.indexOf('--'+k)+1];
assert(process.argv.includes('--harness')&&process.argv.includes('--provider-harness'));
const harness=path.resolve(opt('harness')),candidateHarness=path.resolve(opt('provider-harness'));
const {syntheticState}=await import(pathToFileURL(file(candidateHarness,'tools/benchmark-capacity.mjs')).href);
const base=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'chelm-provider-bench-'));
const samples=[];
const measure=async fn=>{const at=performance.now();const value=await fn();return {elapsed_ms:performance.now()-at,value};};
try{
 for(const [name,count,entities,claims]of [['small',20,10,40],['large',1000,1000,4000]]){
   const root=file(base,name),startup=await measure(()=>initialize(root,{harness,python:process.env.GOLEM_PYTHON??'python3'}));
   const cfg0=config(root),inst=cfg0.instance.path;git(inst,['config','gc.auto','0']);git(inst,['config','maintenance.auto','false']);
   await upgradeMemory(root,cfg0,{harness:candidateHarness,apply:true});const cfg=config(root),state=syntheticState(count,{entities,claims});
   for(const [p,text]of state.notes){fs.mkdirSync(path.dirname(file(inst,p)),{recursive:true});fs.writeFileSync(file(inst,p),text);}
   write(file(inst,'memory/graph.json'),state.graph);write(file(inst,'memory/processed.json'),state.ledger);
   const paths=[...state.notes.keys(),'memory/graph.json','memory/processed.json'];
   for(let n=0;n<paths.length;n+=256)git(inst,['add','--pathspec-from-file=-','--pathspec-file-nul'],{input:paths.slice(n,n+256).join('\0')+'\0'});
   git(inst,['-c','user.name=Synthetic','-c','user.email=synthetic@local','commit','-qm','Synthetic provider benchmark']);
   const loaded=await measure(()=>openMemory(cfg)),{memory,meta,adapter}=loaded.value;
   const context=await measure(()=>memory.context(meta.snapshot_id,{entity_id:'ent-000000',limit:5}));
   const validation=await measure(()=>memory.audit(meta.snapshot_id));assert.deepEqual(validation.value,[]);
   const refresh=await measure(()=>publishProvider(root,cfg));
   const id=randomUUID(),source=`---\nid: ${id}\nrecorded_at: 2026-01-01T00:00:00.000Z\nkind: synthetic\n---\nSynthetic additional observation.\n`;
   fs.writeFileSync(file(inst,'inbox/'+id+'.md'),source);
   const claim=await adapter.claim({max:1,required_capabilities:['memory-provider-v1']}),snapshot=await memory.open(claim.head),attempt_id=randomUUID();
   const change={provider_version:1,base_snapshot:snapshot.snapshot_id,policy_id:snapshot.policy_id,lease_id:claim.run_id,run_id:claim.run_id,attempt_id,idempotency_key:attempt_id,at:new Date().toISOString(),sources:[{id,sha256:hash(source)}],operations:[
     {op:'append_journal',record:{id:claim.run_id,policy_id:snapshot.policy_id,review:'Synthetic benchmark. No LLM. No new semantic claim.',model:'none',verification_id:attempt_id}},
     {op:'append_verification',record:{id:attempt_id,run_id:claim.run_id,result:'Synthetic measured deterministic validation'}}]};
   const prepared=await measure(()=>memory.prepare(change));const publication=await measure(()=>memory.publish(prepared.value));
   const current=await memory.open();assert.equal((await memory.read(current.snapshot_id,'processed',id)).status,'processed');
   samples.push({name,sources:count,entities,claims,graph_bytes:fs.statSync(file(inst,'memory/graph.json')).size,
     startup_ms:startup.elapsed_ms,provider_load_ms:loaded.elapsed_ms,context_ms:context.elapsed_ms,
     context_output_bytes:Buffer.byteLength(JSON.stringify(context.value)),changes_bytes:Buffer.byteLength(JSON.stringify(change)),
     audit_ms:validation.elapsed_ms,candidate_prepare_validate_ms:prepared.elapsed_ms,publish_revalidate_ms:publication.elapsed_ms,read_model_refresh_ms:refresh.elapsed_ms,
     cumulative_host_peak_rss_mib:process.resourceUsage().maxRSS/1024});
   if(name==='large'){
     // Trailing JSON whitespace changes no logical knowledge. Physical refusal
     // is tested before any attempt to parse this >100 MB graph.
     fs.appendFileSync(file(inst,'memory/graph.json'),Buffer.alloc(101*1024*1024,32));
     git(inst,['add','memory/graph.json']);git(inst,['-c','user.name=Synthetic','-c','user.email=synthetic@local','commit','-qm','Synthetic oversized boundary']);
     await assert.rejects(openMemory(cfg),/64 MiB/);
   }
 }
 const report={schema_version:1,at:new Date().toISOString(),platform:process.platform,node:process.version,
   harness_pin:JSON.parse(fs.readFileSync(new URL('../provider-compatibility.json',import.meta.url))),
   method:'Sequential synthetic fixtures. No LLM. Initialization uses published Harness; provider operations use the same exact published contract package. Timings overlap and are not additive. RSS is cumulative process maximum, not per-phase allocation or combined child peak.',
   json_whole_store_costs_remain:true,agent_graph_bytes:0,oversized_graph_mib:101,oversized_refused:true,samples};
 const output=opt('output');if(process.argv.includes('--output')){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
 console.log(JSON.stringify(report));
}finally{await fs.promises.rm(base,{recursive:true,force:true,maxRetries:10,retryDelay:200});}
