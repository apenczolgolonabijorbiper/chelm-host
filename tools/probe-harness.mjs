// Run only after package integrity/trust checks, or in an isolated qualification stage.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
export async function probe(root) {
  const contracts={}, capabilities=new Set(), errors={};
  const schema=(name,key,property='schema_version')=>{
    try {contracts[key]=JSON.parse(fs.readFileSync(path.join(root,'schemas',name))).properties[property].const;}
    catch {contracts[key]=null;}
  };
  schema('memory-graph.schema.json','graph');schema('hypotheses.schema.json','hypotheses');
  schema('cognitive-task.schema.json','cognitive_task','protocol_version');
  for(const [name,pick] of Object.entries({
    'server/cognitive-task.mjs':m=>({capabilities:m.cognitiveCapabilities}),
    'server/memory-contract.mjs':m=>m.memoryContract
  })) {
    try {const d=pick(await import(pathToFileURL(path.join(root,name)).href));
      for(const [k,v] of Object.entries(d)) if(k==='capabilities')v.forEach(c=>capabilities.add(c));else contracts[k]=v;
    } catch(e) {errors[name]=e.message;}
  }
  // Public adapter status supplies the file-worker contract and capabilities.
  // A temporary initialized instance is supplied by qualification, not by this probe.
  return {contracts,capabilities:[...capabilities],errors};
}
export function featureStatus(required,detected,hasFile) {
  return Object.fromEntries(Object.entries(required).map(([name,r])=>{
    const missing=[...Object.entries(r.contracts).filter(([k,v])=>detected.contracts[k]!==v).map(([k,v])=>`contract ${k}=${v}`),
      ...r.capabilities.filter(c=>!detected.capabilities.includes(c)),...r.files.filter(p=>!hasFile(p)).map(p=>'file '+p)];
    return [name,{status:missing.length?'unsupported':'pass',missing}];
  }));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  const root=path.resolve(process.argv[2]);
  const d=await probe(root);
  const temp=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'chelm-contract-'));
  try {
    const instance=path.join(temp,'instance');
    execFileSync(process.argv[3]??'python3',[path.join(root,'processor/init-instance.py'),'--root',instance]);
    const git=process.argv[4]??'git';
    for(const args of [['init','--template=','-q'],['add','.'],['-c','core.hooksPath=','-c','commit.gpgsign=false','-c','user.name=qualification','-c','user.email=qualification@local','commit','-qm','initialize']])execFileSync(git,['-C',instance,...args]);
    const {createAdapter}=await import(pathToFileURL(path.join(root,'adapters/reference-git/adapter.mjs')).href);
    const s=await createAdapter({instance,harness:root,git}).status();
    d.contracts.adapter=s.contract_version;d.capabilities=[...new Set([...d.capabilities,...s.capabilities])];
  } catch(e) {d.errors.adapter=e.message;}
  finally {fs.rmSync(temp,{recursive:true,force:true});}
  console.log(JSON.stringify(d));
}
