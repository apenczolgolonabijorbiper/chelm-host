// Agent-side deployment lifecycle over an explicitly configured narrow authenticated binding.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {SessionClient} from '../integration/local-session/transport.mjs';
import {createCheckpoint,restoreCheckpoint,inspectCheckpoint} from './checkpoint.mjs';
import {config} from './runtime.mjs';
import {file,write,read,assert,lock,hash,safeAbs} from './util.mjs';
const connection=root=>file(root,'host/session/connection.json');
const pendingPath=root=>file(root,'host/session/pending.json');
const stable=v=>{assert(typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(v),'input_invalid','A stable bounded session/submission/reset ID is required');return v;};
const portableBinding=b=>({generation:b.generation,base_revision:b.base_revision});
export async function localSession(root,sub,options,input,client){
  root=safeAbs(root);
  client??=new SessionClient({url:process.env.CHELM_SESSION_URL,token:process.env.CHELM_SESSION_TOKEN});
  if(['initialize','status','sweep'].includes(sub))return client.call(sub);
  if(sub==='intake')return client.call('intake',input);
  if(sub==='recover')return client.call('recover',input);
  if(sub==='connect'){
    stable(input.session_id);
    const status=await client.call('status');
    if(!fs.existsSync(root)){
      assert(status.head,'checkpoint_missing','Initialize the first local runtime before connecting an empty durable store');
      const bytes=await client.download({generation:status.generation,revision:status.revision});
      assert(hash(bytes)===status.head.sha256,'checkpoint_invalid','Downloaded checkpoint differs from authoritative head');
      await restoreCheckpoint(root,bytes,{...options,expected_sha256:status.head.sha256});
    }
    return lock(root,'session connect',async()=>{
      assert(config(root).runtime_id===status.runtime_id,'binding_mismatch','Local runtime does not belong to this store');
      const previous=read(connection(root),null);
      if(previous){
        assert(previous.url===client.url,'binding_mismatch','Explicitly detach from the previous storage binding');
        assert(previous.stopped||previous.binding.session_id===input.session_id,'session_busy','Use the retained session ID or stop the previous session');
        const binding=await client.call('acquire',{generation:previous.binding.generation,base_revision:previous.binding.base_revision,session_id:input.session_id});
        const local_ids=previous.local_ids??[{session_id:previous.binding.session_id,generation:previous.binding.generation}];
        if(!local_ids.some(x=>x.session_id===binding.session_id&&x.generation===binding.generation))local_ids.push({session_id:binding.session_id,generation:binding.generation});
        write(connection(root),{...previous,binding,local_ids,stopped:false});return {state:'ready',binding};
      }
      if(status.head){const restored=read(file(root,'host/checkpoint/restore.json'),null);assert(restored?.sha256===status.head.sha256,'head_moved','Restore the selected durable head into a fresh directory');}
      const binding={generation:status.generation,base_revision:status.revision,session_id:input.session_id};
      // Persist request identity before an acquisition response can be lost.
      const local_ids=[{session_id:binding.session_id,generation:binding.generation}];
      write(connection(root),{url:client.url,binding,checkpoints:[],local_ids,stopped:false});
      const acquired=await client.call('acquire',binding);write(connection(root),{url:client.url,binding:acquired,checkpoints:[],local_ids,stopped:false});
      return {state:'ready',binding:acquired};
    });
  }
  return lock(root,'session '+sub,async()=>{
    const c=read(connection(root));assert(c.url===client.url,'binding_mismatch','Session transport binding changed');
    if(sub==='renew'){c.binding=await client.call('renew',{binding:c.binding});write(connection(root),c);return {state:'ready',binding:c.binding};}
    if(sub==='save'){
      stable(input.submission_id);
      let pending=read(pendingPath(root),null);
      if(pending){
        assert(pending.publication.submission_id===input.submission_id,'checkpoint_pending','Recover the pending submission before a different save');
        if(input.request_ids!==undefined)assert(JSON.stringify(input.request_ids)===JSON.stringify(pending.publication.request_ids),'idempotency_conflict','Pending request inventory changed');
        if(input.projection!==undefined)assert(JSON.stringify(input.projection)===JSON.stringify(pending.publication.projection),'idempotency_conflict','Pending projection changed');
      }
      else{
        const request_ids=input.request_ids??[],projection=input.projection??null;
        const publication={submission_id:input.submission_id,request_ids,projection};
        const recovered=await client.call('recover',{generation:c.binding.generation,submission_id:input.submission_id});
        if(recovered){assert(recovered.identity===hash(JSON.stringify(publication)),'idempotency_conflict','Saved submission metadata changed');return {state:'durably-saved',receipt:recovered};}
        await client.call('progress',{binding:c.binding,request_ids,state:'checkpoint-pending'});
        const output=root+'.checkpoint-'+hash(input.submission_id)+'.json';
        const cp=await createCheckpoint(root,output,portableBinding(c.binding),false);
        pending={output,sha256:cp.sha256,binding:c.binding,publication};
        c.checkpoints.push(output);write(connection(root),c);write(pendingPath(root),pending);
      }
      const prior=await client.call('recover',{generation:pending.binding.generation,submission_id:input.submission_id});
      let receipt=prior;
      if(!receipt){
        const bytes=fs.readFileSync(safeAbs(pending.output));assert(hash(bytes)===pending.sha256,'checkpoint_invalid','Pending local checkpoint changed');
        inspectCheckpoint(bytes);
        await client.upload(pending.binding,input.submission_id,bytes);
        receipt=await client.call('publish',{binding:pending.binding,publication:pending.publication});
      }
      assert(receipt.sha256===pending.sha256&&receipt.identity===hash(JSON.stringify(pending.publication)),'idempotency_conflict','Recovered receipt differs from pending checkpoint');
      c.binding={...c.binding,base_revision:Math.max(c.binding.base_revision,receipt.revision)};write(connection(root),c);fs.rmSync(pendingPath(root));
      fs.rmSync(safeAbs(pending.output),{force:true});c.checkpoints=c.checkpoints.filter(p=>p!==pending.output);write(connection(root),c);
      return {state:'durably-saved',receipt};
    }
    if(sub==='stop'){
      assert(!fs.existsSync(pendingPath(root)),'checkpoint_pending','Recover the pending publication before stopping');
      if(!c.stopped)await client.call('release',{binding:c.binding});c.stopped=true;write(connection(root),c);return {state:'stopped',local_copy_retained:true};
    }
    if(sub==='reset'){
      assert(options.apply===true,'restore_authorization','Full reset requires --apply');stable(input.reset_id);
      const receipt=await client.call('reset',{generation:c.binding.generation,reset_id:input.reset_id});
      // Only paths recorded by this host and directly beside this owned root are removable.
      for(const p of c.checkpoints){const target=safeAbs(p);assert(path.dirname(target)===path.dirname(root)&&target.startsWith(root+'.checkpoint-'),'unsafe_path','Unowned checkpoint cleanup path');fs.rmSync(target,{force:true});}
      const status=await client.call('sweep');
      // Defer removal until after the local operation lock's final log/unlock.
      return {state:'reset',receipt,cleanup_pending:status.cleanup_pending,detached_copies:status.local_copies,remove_local:true,session_id:c.binding.session_id,generation:c.binding.generation,local_ids:c.local_ids??[{session_id:c.binding.session_id,generation:c.binding.generation}]};
    }
    assert(false,'usage','Expected session initialize|status|intake|connect|renew|save|recover|stop|reset|sweep');
  }).then(async result=>{
    if(result.remove_local){
      fs.rmSync(root,{recursive:true,force:true});
      try{for(const identity of result.local_ids)await client.call('local-cleanup',identity);result.local_cleanup='confirmed';}catch{result.local_cleanup='removed-acknowledgement-pending';}
      delete result.remove_local;
      delete result.local_ids;
    }
    return result;
  });
}
