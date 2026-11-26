// Storage-neutral coordinator. No filesystem, inference, GitHub, model client or scheduler.
// The store must provide linearizable CAS, immutable objects and strongly consistent reads/deletes.
import {checkpointAllowedPath,checkpointRequired} from './checkpoint-format.mjs';
export class SessionError extends Error{constructor(code,message){super(message);this.code=code;}}
const requireThat=(v,code,message)=>{if(!v)throw new SessionError(code,message);};
const copy=v=>structuredClone(v);
const hex=/^[a-f0-9]{64}$/;
const key=v=>{requireThat(typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v)&&!['constructor','prototype','__proto__'].includes(v),'invalid_key','Stable bounded identity required');return v;};
export async function digest(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
const encoded=v=>new TextEncoder().encode(JSON.stringify(v));

export class DurableSessions{
  constructor(store,{runtime_id,principal,expected,clock=Date.now,max_checkpoint_bytes=140*1024*1024,max_state_bytes=4*1024*1024}={}){
    requireThat(/^[a-f0-9-]{36}$/.test(runtime_id)&&typeof principal==='string'&&principal.length>0,'authorization','Trusted runtime/principal binding required');
    requireThat(expected&&Object.keys(expected).length===4&&typeof expected.host_version==='string'&&expected.host_version.length>0&&typeof expected.harness_version==='string'&&/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(expected.harness_version)&&hex.test(expected.host_code_sha256)&&hex.test(expected.harness_manifest_sha256),'package_binding','Exact trusted package identities required');
    Object.assign(this,{store,runtime_id,principal,expected,clock,max_checkpoint_bytes,max_state_bytes});
  }
  async transaction(fn){
    for(let retry=0;retry<32;retry++){
      const original=await this.store.readState(this.runtime_id);
      requireThat(!original||original.owner===this.principal,'authorization','Runtime belongs to another principal');
      const next=original?copy(original):{version:0,runtime_id:this.runtime_id,owner:this.principal,generation:1,revision:0,fence:0,session:null,head:null,objects:{},receipts:{},requests:{},retired:[],copies:{}};
      const value=fn(next);next.version++;
      requireThat(encoded(next).length<=this.max_state_bytes,'capacity_exceeded','Coordinator state budget exceeded; reset/retention administration required');
      if(await this.store.compareAndSwap(this.runtime_id,original?.version??null,next))return copy(value);
    }
    throw new SessionError('store_busy','Coordinator contention; retry the same request identity');
  }
  async status(){const s=await this.store.readState(this.runtime_id);requireThat(s&&s.owner===this.principal,'authorization','Unknown or unauthorized runtime');return copy({runtime_id:s.runtime_id,generation:s.generation,revision:s.revision,head:s.head,session:s.session,pending:Object.values(s.requests).filter(r=>r.state!=='durably-saved'),cleanup_pending:s.retired.length>0,local_copies:s.copies});}
  generation(s,g){requireThat(g===s.generation,'generation_changed','Runtime was reset; reconnect explicitly');}
  authority(s,b,checkBase=true){
    this.generation(s,b?.generation);
    const a=s.session;
    requireThat(a&&a.owner===this.principal&&a.session_id===b.session_id&&a.fence===b.fence&&a.expires_at>this.clock(),'session_fenced','Session expired, revoked or replaced');
    if(checkBase)requireThat(b.base_revision===s.revision&&a.base_revision===s.revision,'head_moved','Session must use the exact durable base revision');
    return a;
  }
  acquire({generation,base_revision,session_id,ttl_ms=300000}){
    key(session_id);requireThat(Number.isInteger(ttl_ms)&&ttl_ms>=1000&&ttl_ms<=900000,'invalid_bound','Session TTL must be 1s..15min');
    return this.transaction(s=>{
      this.generation(s,generation);requireThat(base_revision===s.revision,'head_moved','Restore the selected checkpoint before acquiring authority');
      requireThat(!s.copies[session_id]||s.copies[session_id].generation===generation,'idempotency_conflict','Use a new session identity after reset; retain old copy cleanup inventory');
      if(s.session&&s.session.expires_at>this.clock()){
        requireThat(s.session.session_id===session_id&&s.session.owner===this.principal,'session_busy','One publishing session is already active');return s.session;
      }
      s.session={owner:this.principal,session_id,generation,fence:++s.fence,base_revision,issued_at:this.clock(),expires_at:this.clock()+ttl_ms};
      s.copies[session_id]={generation,cleanup:'reachable'};return s.session;
    });
  }
  renew(binding,ttl_ms=300000){requireThat(Number.isInteger(ttl_ms)&&ttl_ms>=1000&&ttl_ms<=900000,'invalid_bound','Invalid TTL');return this.transaction(s=>{const a=this.authority(s,binding);requireThat(this.clock()+ttl_ms<=a.issued_at+8*3600000,'session_fenced','Maximum session lifetime reached');a.expires_at=this.clock()+ttl_ms;return a;});}
  release(binding){return this.transaction(s=>{this.authority(s,binding);s.session=null;++s.fence;return {state:'stopped',generation:s.generation};});}
  intake({generation,request_id,payload}){
    requireThat(payload!==undefined,'invalid_input','Durable input payload is required');
    key(request_id);const bytes=encoded(payload);requireThat(bytes.length<=262144,'capacity_exceeded','Durable request must be at most 256 KiB');
    // Evidence is persisted before any local execution; a checkpoint never replaces this queue.
    return digest(bytes).then(identity=>this.transaction(s=>{
      this.generation(s,generation);const old=s.requests[request_id];
      if(old){requireThat(old.identity===identity,'idempotency_conflict','Request ID has different input');return old;}
      return s.requests[request_id]={request_id,identity,payload,state:'queued'};
    }));
  }
  progress(binding,request_ids,state){
    requireThat(['local-committed','checkpoint-pending'].includes(state)&&Array.isArray(request_ids)&&request_ids.length<=100,'invalid_bound','Invalid progress update');
    return this.transaction(s=>{this.authority(s,binding);for(const id of request_ids){const r=s.requests[key(id)];requireThat(r,'request_unknown','Unknown request');if(r.state!=='durably-saved')r.state=state;}return {state};});
  }
  async validate(bytes){
    requireThat(bytes instanceof Uint8Array&&bytes.length<=this.max_checkpoint_bytes,'capacity_exceeded','Bounded checkpoint bytes required');
    let a;try{a=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new SessionError('checkpoint_invalid','Invalid checkpoint envelope');}
    const m=a?.manifest;
    requireThat(m?.format==='chelm-runtime-checkpoint'&&m.version===1&&m.runtime_id===this.runtime_id,'checkpoint_invalid','Checkpoint runtime/format differs');
    for(const [k,v]of Object.entries(this.expected))requireThat(m[k]===v,'package_binding','Checkpoint package binding differs');
    requireThat(Array.isArray(m.files)&&m.files.length<=20000&&Array.isArray(a.entries)&&m.files.length===a.entries.length,'checkpoint_invalid','Invalid checkpoint inventory');
    const names=new Set();let total=0;
    for(let i=0;i<m.files.length;i++){
      const r=m.files[i],e=a.entries[i];
      requireThat(checkpointAllowedPath(r.path)&&!names.has(r.path.toLowerCase())&&e.path===r.path,'checkpoint_invalid','Unsafe checkpoint paths');names.add(r.path.toLowerCase());
      requireThat(Number.isSafeInteger(r.size)&&r.size>=0&&hex.test(r.sha256)&&typeof e.base64==='string'&&e.base64.length===4*Math.ceil(r.size/3),'checkpoint_invalid','Invalid checkpoint component');
      total+=r.size;requireThat(total<=96*1024*1024,'capacity_exceeded','Decoded checkpoint exceeds budget');
      let b;try{const raw=atob(e.base64);requireThat(btoa(raw)===e.base64,'checkpoint_invalid','Noncanonical base64');b=Uint8Array.from(raw,c=>c.charCodeAt(0));}catch{throw new SessionError('checkpoint_invalid','Invalid base64');}
      requireThat(b.length===r.size&&await digest(b)===r.sha256,'checkpoint_invalid','Checkpoint bytes changed');
    }
    requireThat(checkpointRequired.every(p=>names.has(p)),'checkpoint_invalid','Missing required runtime components');
    return {sha256:await digest(bytes),size:bytes.length,checkpoint_id:await digest(new TextEncoder().encode(JSON.stringify(m,null,2)+'\n')),head:m.git?.head,durable_binding:m.durable_binding};
  }
  async upload(binding,submission_id,bytes,hooks={}){
    key(submission_id);const value=await this.validate(bytes),objectKey=`${this.runtime_id}/${binding.generation}/${await digest(encoded(submission_id))}`,writer=crypto.randomUUID();
    requireThat(value.durable_binding?.generation===binding.generation&&value.durable_binding?.base_revision===binding.base_revision,'generation_changed','Checkpoint must be captured for this durable generation/base');
    const ticket=await this.transaction(s=>{
      this.authority(s,binding);const prior=s.objects[submission_id];
      if(prior){requireThat(prior.status!=='discarded'&&prior.sha256===value.sha256&&prior.fence===binding.fence,'idempotency_conflict','Upload identity or session changed');if(prior.status==='staging'){prior.writers.push(writer);prior.inflight=true;}return prior;}
      const t={...value,key:objectKey,submission_id,fence:binding.fence,base_revision:binding.base_revision,status:'staging',inflight:true,writers:[writer]};s.objects[submission_id]=t;return t;
    });
    if(ticket.status==='verified'||ticket.status==='published')return ticket;
    // Object outcome may be unknown after a timeout. Keep its durable ticket until reconciled.
    await this.store.putImmutable(objectKey,bytes);
    try{
      await hooks.afterUpload?.();
      const stored=await this.store.getObject(objectKey),valid=stored&&await digest(stored)===value.sha256;
      return await this.transaction(s=>{this.authority(s,binding);requireThat(valid,'object_unavailable','Object readback failed');const t=s.objects[submission_id];requireThat(t?.sha256===value.sha256,'idempotency_conflict','Upload ticket changed');t.status='verified';t.writers=t.writers.filter(w=>w!==writer);t.inflight=t.writers.length>0;return t;});
    }
    catch(error){
      // Reset may have retired the ticket during upload. Mark the observed write settled,
      // leaving its key inventoried for the purge sweeper. Never select it as head.
      await this.transaction(s=>{const t=s.retired.find(t=>t.key===objectKey)??s.objects[submission_id];if(t){t.writers=t.writers.filter(w=>w!==writer);t.inflight=t.writers.length>0;}return null;});throw error;
    }
  }
  async publish(binding,{submission_id,request_ids=[],projection=null},hooks={}){
    key(submission_id);requireThat(Array.isArray(request_ids)&&request_ids.length<=100&&new Set(request_ids).size===request_ids.length,'invalid_bound','Invalid acknowledgement inventory');
    requireThat(encoded(projection).length<=262144,'capacity_exceeded','Projection must be at most 256 KiB');
    const identity=await digest(encoded({submission_id,request_ids,projection}));
    const receipt=await this.transaction(s=>{
      this.authority(s,binding,false);const prior=s.receipts[submission_id];
      if(prior){requireThat(prior.identity===identity,'idempotency_conflict','Publication metadata changed');return prior;}
      this.authority(s,binding);
      const t=s.objects[submission_id];requireThat(t?.status==='verified'&&t.fence===binding.fence&&t.base_revision===binding.base_revision,'object_unavailable','Upload and verify immutable checkpoint first');
      for(const id of request_ids)requireThat(s.requests[key(id)]&&s.requests[id].state==='checkpoint-pending','request_unsettled','Only explicitly checkpoint-pending requests may be acknowledged');
      const r={state:'durably-saved',runtime_id:this.runtime_id,generation:s.generation,revision:++s.revision,submission_id,identity,checkpoint_id:t.checkpoint_id,sha256:t.sha256,key:t.key,request_ids,projection};
      t.status='published';s.head=r;s.receipts[submission_id]=r;s.session.base_revision=s.revision;
      for(const id of request_ids){s.requests[id].state='durably-saved';s.requests[id].receipt={generation:s.generation,revision:s.revision,submission_id};}
      return r;
    });
    await hooks.afterPublish?.();return receipt;
  }
  recover({generation,submission_id}){return this.transaction(s=>{this.generation(s,generation);return s.receipts[key(submission_id)]??null;});}
  async download({generation,revision}){
    const s=await this.status();this.generation(s,generation);requireThat(s.head&&s.revision===revision,'head_moved','Fetch the authoritative current checkpoint');
    const b=await this.store.getObject(s.head.key);requireThat(b&&await digest(b)===s.head.sha256,'object_unavailable','Selected checkpoint unavailable or corrupt');
    // Recheck after the object read; a reset/moved head cannot be served as current.
    const after=await this.status();this.generation(after,generation);requireThat(after.revision===revision,'head_moved','Head changed during download');return b;
  }
  reset({generation,reset_id}){
    key(reset_id);return this.transaction(s=>{
      if(s.last_reset?.reset_id===reset_id){requireThat(s.last_reset.from===generation,'idempotency_conflict','Reset identity changed');return s.last_reset;}
      this.generation(s,generation);s.session=null;++s.fence;
      s.retired.push(...Object.values(s.objects).map(t=>({key:t.key,inflight:t.inflight,writers:t.writers})));
      for(const c of Object.values(s.copies))c.cleanup='pending-unreachable';
      s.generation++;s.revision=0;s.head=null;s.objects={};s.receipts={};s.requests={};
      s.last_reset={reset_id,from:generation,generation:s.generation,state:'fenced',cleanup_pending:s.retired.length>0};return s.last_reset;
    });
  }
  async sweep(){
    const s=await this.store.readState(this.runtime_id);requireThat(s?.owner===this.principal,'authorization','Unauthorized runtime');
    for(const t of s.retired){
      await this.store.deleteObject(t.key);
      if(!t.inflight)await this.transaction(current=>{current.retired=current.retired.filter(r=>r.key!==t.key||r.inflight);return null;});
    }
    return this.status();
  }
  // Only a trusted adapter with a definitive storage operation outcome may settle
  // an interrupted upload. A timeout/404 alone is not proof that a write cannot arrive later.
  settleRetiredUpload(objectKey){return this.transaction(s=>{const t=s.retired.find(t=>t.key===objectKey);requireThat(t,'object_unknown','Retired upload not inventoried');t.inflight=false;t.writers=[];return {key:objectKey,state:'settled'};});}
  async discardUpload(binding,submission_id){
    const objectKey=await this.transaction(s=>{this.authority(s,binding);const t=s.objects[key(submission_id)];requireThat(t&&t.status!=='published'&&!t.inflight,'upload_uncertain','Settle all writes and preserve selected history before cleanup');t.status='discarded';return t.key;});
    await this.store.deleteObject(objectKey);return {state:'discarded',submission_id};
  }
  localCleanup({session_id,generation}){return this.transaction(s=>{const c=s.copies[key(session_id)];requireThat(c&&c.generation===generation&&generation<s.generation,'generation_changed','Cleanup acknowledgement must identify a retired copy');c.cleanup='confirmed';return c;});}
}
