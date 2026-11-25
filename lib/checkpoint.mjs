// Complete, settled host checkpoints. This is intentionally separate from logical memory transfer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {file,read,write,atomic,assert,hash,json,git,safeAbs,lock,actor,snapshot} from './util.mjs';
import {config,defaults,hostInit,outside} from './runtime.mjs';
import {packageRoot,verifyHarness,harness,version} from './harness.mjs';
import {backend} from './worker.mjs';
import {assignments,terminal} from './remote-state.mjs';
import {publish} from './read-model.mjs';
import {openMemory} from './memory-provider.mjs';
import {checkProfile} from './profile-install.mjs';
import {checkBundle} from './checkpoint-pack.mjs';
import {validateShape} from './schema.mjs';
import {checkpointAllowedPath,checkpointInstancePath,checkpointPortable,checkpointRequired} from './checkpoint-format.mjs';

export const checkpointLimits=Object.freeze({bytes:96*1024*1024,archive_bytes:140*1024*1024,files:20000,commits:2000});
const hex=/^[a-f0-9]{64}$/;
export function instancePath(p){portable(p);return checkpointInstancePath(p);}
function portable(p){assert(checkpointPortable(p),'checkpoint_path','Nonportable checkpoint path');return p;}
function allowed(p){portable(p);return checkpointAllowedPath(p);}
function regular(p,max=checkpointLimits.bytes){const s=fs.lstatSync(safeAbs(p));assert(s.isFile()&&s.nlink===1,'checkpoint_path','Linked or special checkpoint input refused');assert(s.size<=max,'capacity_exceeded','Checkpoint input too large');return fs.readFileSync(p);}
function walk(root,fn,prefix=''){
  for(const e of fs.readdirSync(root,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    const p=prefix+e.name,abs=safeAbs(path.join(root,e.name));
    assert(!e.isSymbolicLink(),'checkpoint_path','Linked runtime content refused');
    if(e.isDirectory())walk(abs,fn,p+'/');else fn(p,regular(abs));
  }
}
export function checkpointCodeIdentity(){
  const rows=[];
  for(const dir of ['lib','bin','schemas','integration'])walk(file(packageRoot,dir),(p,b)=>rows.push([dir+'/'+p,hash(b)]));
  return hash(json(rows.sort((a,b)=>a[0].localeCompare(b[0]))));
}
function portableConfig(cfg){
  const out={};
  for(const k of ['schema_version','runtime_id','label','sandbox','intake','conversation','requests','remote','observability','memory'])if(cfg[k]!==undefined)out[k]=cfg[k];
  if(cfg.profile_expectation)out.profile_expectation={enforce:cfg.profile_expectation.enforce};
  return out;
}
async function settled(root,cfg){
  assert(cfg.instance.path===file(root,'instance')&&cfg.archive.root===file(root,'archive'),'checkpoint_external_root','Checkpoint v1 requires contained canonical instance/archive roots');
  for(const p of ['host/publication-pending.json','host/adoption-pending.json','host/cutover-pending.json'])assert(!fs.existsSync(file(root,p)),'recovery_required','Settle host publication/adoption before checkpoint');
  assert(!fs.existsSync(file(root,'host/delegation')),'recovery_required','Complete legacy delegation cutover before checkpoint');
  const gd=path.join(cfg.instance.path,'.git');
  assert(fs.lstatSync(gd).isDirectory(),'checkpoint_path','A dedicated Git directory is required');
  // No operation/recovery/alternate object database can be made portable implicitly.
  walk(gd,(p)=>assert(!/(?:\.lock$|pending|shallow|grafts|alternates)/i.test(p),'recovery_required','Settle Git locks, recovery and external history before checkpoint'));
  for(const p of fs.readdirSync(gd,{recursive:true}))assert(!/(?:\.lock(?:[/\\]|$)|pending|shallow|grafts|alternates)/i.test(p),'recovery_required','Settle Git mutexes and recovery');
  assert(!git(cfg.instance.path,['diff','--cached','--name-only']).trim(),'busy','Settle staged instance files before checkpoint');
  const status=await backend(cfg).status();
  assert(!status.recovery_required,'recovery_required','Settle adapter recovery before checkpoint');
  assert(status.lease.status!=='processing','busy','Release even expired processing leases before checkpoint');
  for(const a of assignments(root)){
    assert(terminal.has(a.status),'busy','Settle all assignments, including expired unresolved work');
    assert(!['publishing','blocked'].includes(a.learning?.state),'recovery_required','Reconcile learning publication before checkpoint');
    assert(!a.submission||a.receipt||['abandoned','cancelled','failed','expired'].includes(a.status),'recovery_required','Unknown submission outcome');
  }
  return status;
}
function history(instance){
  assert(!git(instance,['replace','-l']).trim(),'checkpoint_history','Git replacements are unsupported');
  const refs=git(instance,['for-each-ref','--format=%(refname)']).trim().split('\n').filter(Boolean);
  assert(refs.length>0&&refs.length<=100&&refs.every(r=>/^refs\/(?:heads|tags)\/[A-Za-z0-9_./-]+$/.test(r)),'checkpoint_history','Only bounded local branches/tags are supported');
  const commits=git(instance,['rev-list','--all']).trim().split('\n').filter(Boolean);
  assert(commits.length<=checkpointLimits.commits,'capacity_exceeded','Checkpoint history commit budget exceeded');
  let total=0;
  for(const commit of commits){
    for(const row of git(instance,['ls-tree','-r','-l','-z',commit]).split('\0').filter(Boolean)){
      const m=row.match(/^100644 blob ([a-f0-9]+) +(\d+)\t([\s\S]+)$/);
      assert(m&&instancePath(m[3]),'checkpoint_path','History contains unsupported paths, executables or links');
      total+=Number(m[2]);
      assert(total<=512*1024*1024,'capacity_exceeded','Expanded checkpoint history budget exceeded');
    }
  }
  git(instance,['fsck','--full','--no-reflogs']);
  return {head:git(instance,['rev-parse','HEAD']).trim(),branch:git(instance,['symbolic-ref','HEAD']).trim(),refs};
}
function add(map,p,b){assert(allowed(p),'checkpoint_path','Uninventoried checkpoint component');assert(!map.has(p),'checkpoint_invalid','Duplicate checkpoint component');map.set(p,Buffer.from(b));}
function captureHost(root,map){
  for(const p of ['host/intake/registry.json','host/conversation/turns.jsonl','host/requests/requests.json'])add(map,p,regular(file(root,p)));
  const owners={...read(file(root,'host/checkpoint/workers.json'),{}),...read(file(root,'host/workers.json'),{})};
  for(const v of Object.values(owners)){delete v.actor;delete v.host;}
  add(map,'host/checkpoint/workers.json',json(owners));
  const tasks=file(root,'host/tasks');
  if(fs.existsSync(tasks))walk(tasks,(p,b)=>{
    const t=JSON.parse(b);assert(t.owner===actor(),'checkpoint_owner','Only the owning OS account can checkpoint tasks');
    t.owner='@restore-owner';add(map,'host/tasks/'+p,json(t));
  });
  for(const saved of assignments(root)){
    const a=structuredClone(saved);a.principal='checkpoint:retained';
    add(map,`host/remote/work/${a.work_id}/record.json`,json(a));
    // Read-only config-2 cognitive citations resolve exact retained bytes here.
    if(a.completion&&a.kind==='cognitive'&&a.provider_version!==1){
      for(const source of a.trusted.sources){
        const p=`host/remote/work/${a.work_id}/snapshot/inbox/${source.id}.md`,b=regular(file(root,p));
        assert(hash(b)===source.sha256,'checkpoint_invalid','Retained citation bytes changed');add(map,p,b);
      }
    }
  }
}
export async function createCheckpoint(root,output,durable_binding,useLock=true){
  root=safeAbs(root);output=safeAbs(output);outside(output,root);outside(output,packageRoot);
  if(durable_binding!==undefined)assert(durable_binding&&Object.keys(durable_binding).length===2&&Number.isSafeInteger(durable_binding.generation)&&durable_binding.generation>0&&Number.isSafeInteger(durable_binding.base_revision)&&durable_binding.base_revision>=0,'checkpoint_invalid','Expected only durable generation and base_revision');
  const action=async()=>{
    const cfg=config(root);verifyHarness(cfg);await settled(root,cfg);
    const h=history(cfg.instance.path),files=new Map();
    const reachable=new Set(git(cfg.instance.path,['rev-list','--all']).trim().split('\n'));
    for(const a of assignments(root))if(a.completion&&a.provider_version===1)assert(reachable.has(a.base_snapshot),'checkpoint_history','Retain historical provider snapshots on a local branch/tag before checkpoint');
    add(files,'runtime.json',json(portableConfig(cfg)));
    walk(cfg.instance.path,(p,b)=>{if(!p.startsWith('.git/')){assert(instancePath(p),'checkpoint_path','Uninventoried instance component: '+p);add(files,'instance/'+p,b);}});
    // Allow pending intake outside HEAD, but reject edits/deletions to committed files.
    const tree=snapshot(cfg.instance.path);
    for(const [p,b]of tree)assert(files.get('instance/'+p)?.equals(b),'busy','Settle modified committed instance files before checkpoint');
    captureHost(root,files);
    const scratch=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'chelm-bundle-'));
    try{const bundle=path.join(scratch,'history.bundle');git(cfg.instance.path,['bundle','create',bundle,'--all']);add(files,'instance.bundle',regular(bundle));}finally{fs.rmSync(scratch,{recursive:true,force:true});}
    const entries=[...files].sort(([a],[b])=>a.localeCompare(b));
    const manifest={format:'chelm-runtime-checkpoint',version:1,runtime_id:cfg.runtime_id,host_version:version().package_version,host_code_sha256:checkpointCodeIdentity(),harness_version:'0.13.0',harness_manifest_sha256:hash(regular(file(cfg.harness.root,'RELEASE.json'))),git:h,...(durable_binding?{durable_binding}:{}),
      files:entries.map(([p,b])=>({path:p,size:b.length,sha256:hash(b)}))};
    const archive={manifest,entries:entries.map(([p,b])=>({path:p,base64:b.toString('base64')}))};
    const bytes=Buffer.from(json(archive));inspectCheckpoint(bytes);
    if(fs.existsSync(output))assert(regular(output,checkpointLimits.archive_bytes).equals(bytes),'checkpoint_exists','Existing output has different bytes');
    else{
      const temporary=output+'.tmp-'+randomUUID(),fd=fs.openSync(temporary,'wx',0o600);
      try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      try{fs.linkSync(temporary,output);}finally{fs.rmSync(temporary,{force:true});}
    }
    return {state:'local-committed',checkpoint_id:hash(json(manifest)),sha256:hash(bytes),size:bytes.length,output,manifest};
  };
  return useLock?lock(root,'checkpoint create',action):action();
}
export function inspectCheckpoint(input){
  const bytes=typeof input==='string'?regular(input,checkpointLimits.archive_bytes):Buffer.from(input);
  assert(bytes.length<=checkpointLimits.archive_bytes,'capacity_exceeded','Checkpoint archive too large');
  let a;try{a=JSON.parse(bytes);}catch{assert(false,'checkpoint_invalid','Truncated or invalid checkpoint JSON');}
  const m=a?.manifest;
  assert(m?.format==='chelm-runtime-checkpoint'&&m.version===1,'checkpoint_unsupported','Unsupported checkpoint format');
  assert(validateShape(a,read(file(packageRoot,'schemas/runtime-checkpoint.schema.json'))).length===0,'checkpoint_invalid','Checkpoint does not match the public envelope schema');
  assert(m.host_version===version().package_version&&m.host_code_sha256===checkpointCodeIdentity()&&m.harness_version==='0.13.0','checkpoint_unsupported','Checkpoint requires the exact host implementation and Harness pin');
  assert(Array.isArray(m.files)&&m.files.length<=checkpointLimits.files&&Array.isArray(a.entries)&&a.entries.length===m.files.length,'checkpoint_invalid','Invalid checkpoint inventory');
  const files=new Map(),folded=new Set();let total=0;
  for(let i=0;i<m.files.length;i++){
    const row=m.files[i],entry=a.entries[i];assert(allowed(row.path)&&entry.path===row.path&&!folded.has(row.path.toLowerCase()),'checkpoint_path','Unsafe, duplicate or unordered checkpoint inventory');
    folded.add(row.path.toLowerCase());
    assert(Number.isSafeInteger(row.size)&&row.size>=0&&hex.test(row.sha256)&&typeof entry.base64==='string'&&entry.base64.length===4*Math.ceil(row.size/3),'checkpoint_invalid','Invalid checkpoint file metadata');
    total+=row.size;assert(total<=checkpointLimits.bytes,'capacity_exceeded','Decoded checkpoint budget exceeded');
    const b=Buffer.from(entry.base64,'base64');assert(b.length===row.size&&b.toString('base64')===entry.base64&&hash(b)===row.sha256,'checkpoint_invalid','Checkpoint file hash/size differs');files.set(row.path,b);
  }
  for(const p of checkpointRequired)assert(files.has(p),'checkpoint_invalid','Missing required checkpoint component');
  const cfg=JSON.parse(files.get('runtime.json'));
  checkBundle(files.get('instance.bundle'));
  assert(cfg.runtime_id===m.runtime_id&&/^[a-f0-9-]{36}$/.test(m.runtime_id),'checkpoint_invalid','Runtime identity differs');
  assert(Object.keys(cfg).every(k=>['schema_version','runtime_id','label','sandbox','intake','conversation','requests','remote','observability','memory','profile_expectation'].includes(k)),'checkpoint_invalid','Unsafe config binding');
  assert(!cfg.profile_expectation||Object.keys(cfg.profile_expectation).every(k=>k==='enforce'),'checkpoint_invalid','Unsafe profile binding');
  assert(JSON.parse(files.get('instance/memory/processing-lock.json')).status!=='processing','busy','Active lease cannot be restored');
  for(const [p,b]of files){
    if(/^host\/tasks\//.test(p))assert(JSON.parse(b).owner==='@restore-owner','checkpoint_owner','Archive cannot choose an OS principal');
    if(p.endsWith('/record.json')){const r=JSON.parse(b);assert(terminal.has(r.status)&&r.principal==='checkpoint:retained'&&!['publishing','blocked'].includes(r.learning?.state),'checkpoint_invalid','Archive contains assignment authority or unresolved work');}
  }
  return {manifest:m,files,sha256:hash(bytes),checkpoint_id:hash(json(m)),size:bytes.length};
}
export async function restoreCheckpoint(root,input,options={}){
  root=safeAbs(root);outside(root,packageRoot);
  assert(options.apply===true,'restore_authorization','Restore requires --apply to bind tasks to the current authenticated OS account');
  assert(!fs.existsSync(root),'runtime_exists','Restore target must be a fresh nonexistent owned directory');
  const checked=inspectCheckpoint(input);
  assert(hex.test(options.expected_sha256)&&checked.sha256===options.expected_sha256,'checkpoint_invalid','Trusted checkpoint digest required');
  const engine=safeAbs(options.harness);outside(root,engine);
  const stage=root+'.restore-'+randomUUID();fs.mkdirSync(stage,{mode:0o700});
  try{
    const cfg={...defaults(),...JSON.parse(checked.files.get('runtime.json'))};
    cfg.harness={root:engine,node:process.execPath,python:options.python??(process.platform==='win32'?'py':'python3'),git:options.git??'git'};
    cfg.instance={...defaults().instance,path:'instance'};cfg.archive={root:'archive'};
    if(cfg.profile_expectation){assert(options.source,'restore_binding','Rebind the reviewed external profile source explicitly');cfg.profile_expectation.source=safeAbs(options.source);}
    verifyHarness(cfg);
    assert(hash(regular(file(engine,'RELEASE.json')))===checked.manifest.harness_manifest_sha256,'checkpoint_unsupported','Harness package identity differs');
    for(const [p,b]of checked.files){
      if(['runtime.json','instance.bundle','host/checkpoint/workers.json'].includes(p))continue;
      if(p.startsWith('host/tasks/')){const t=JSON.parse(b);t.owner=actor();write(file(stage,p),t);}else atomic(file(stage,p),b);
    }
    write(file(stage,'chelm.runtime.json'),cfg);const live=config(stage),inst=live.instance.path;
    for(const p of ['inbox','evidence','memory/runs','memory/events/chat','profiles'])fs.mkdirSync(file(inst,p),{recursive:true});
    // An empty Git init plus a verified bundle never imports remotes, hooks, helpers or local config.
    git(inst,['init','--template=','-q']);git(inst,['config','core.autocrlf','false']);
    const bundle=file(stage,'history.bundle');atomic(bundle,checked.files.get('instance.bundle'));
    git(inst,['bundle','verify',bundle]);
    git(inst,['fetch','--update-head-ok','--no-tags',bundle,'+refs/heads/*:refs/heads/*','+refs/tags/*:refs/tags/*']);
    const h=checked.manifest.git;assert(/^refs\/heads\/[A-Za-z0-9_./-]+$/.test(h.branch),'checkpoint_invalid','Invalid attached branch');
    git(inst,['symbolic-ref','HEAD',h.branch]);
    const actual=history(inst);assert(actual.head===h.head&&json(actual.refs)===json(h.refs),'checkpoint_history','Git history or refs differ');
    git(inst,['read-tree','HEAD']);
    for(const [p,b]of snapshot(inst))assert(checked.files.get('instance/'+p)?.equals(b),'checkpoint_invalid','Working copy differs from retained HEAD');
    fs.rmSync(bundle);hostInit(stage);write(file(stage,'host/workers.json'),{});
    atomic(file(stage,'host/checkpoint/workers.json'),checked.files.get('host/checkpoint/workers.json'));
    await settled(stage,live);
    const v=harness(live,'validate',inst);assert(v.valid,'validation_failed','Restored logical memory failed Harness validation');
    if(live.memory){const opened=await openMemory(live);assert((await opened.memory.audit(opened.meta.snapshot_id)).length===0,'validation_failed','Restored provider audit failed');}
    if(live.profile_expectation?.enforce)assert((await checkProfile(live)).matches,'profile_mismatch','Rebound reviewed source differs from installed guidance');
    // A malformed citation snapshot must not become an activated runtime.
    for(const a of assignments(stage))if(a.completion&&a.kind==='cognitive'&&a.provider_version!==1)for(const s of a.trusted.sources)assert(hash(regular(file(stage,`host/remote/work/${a.work_id}/snapshot/inbox/${s.id}.md`)))===s.sha256,'checkpoint_invalid','Missing/corrupt historical citation');
    await publish(stage,live,{deep:true});
    write(file(stage,'host/checkpoint/restore.json'),{checkpoint_id:checked.checkpoint_id,sha256:checked.sha256,owner:actor(),publishing_authority:false});
    // Config paths are relative. Bind the only absolute view field before atomic activation.
    const summary=read(file(stage,'host/read-model/summary.json'));summary.instance_path_abs=file(root,'instance');write(file(stage,'host/read-model/summary.json'),summary);
    fs.renameSync(stage,root);
    return {state:'ready',runtime_id:cfg.runtime_id,head:h.head,checkpoint_id:checked.checkpoint_id,publishing_authority:false};
  }catch(e){fs.rmSync(stage,{recursive:true,force:true});throw e;}
}
