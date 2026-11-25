// Copy with its imports into an application-owned server build. No Python, Git or inference here.
import {DurableSessions} from '../../lib/durable-session.mjs';
import {D1R2SessionStore} from './d1-r2-store.mjs';
import {sessionHandler} from './transport.mjs';
export function createSessionWorker(authenticate){return {fetch(request,env){
  return sessionHandler(async req=>{
    // Application authentication maps the caller to a known owned runtime and expected package pins.
    const identity=await authenticate(req,env);if(!identity)return null;
    return new DurableSessions(new D1R2SessionStore(env.DB,env.BUCKET),{...identity,max_checkpoint_bytes:8*1024*1024,max_state_bytes:1024*1024});
  })(request);
}};}
