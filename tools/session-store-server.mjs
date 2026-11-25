#!/usr/bin/env node
// Synthetic private HTTP binding; never expose this loopback-only server publicly.
import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {FileSessionStore} from '../integration/local-session/file-store.mjs';
import {DurableSessions} from '../lib/durable-session.mjs';
import {sessionHandler} from '../integration/local-session/transport.mjs';
const {CHELM_SESSION_STORE:root,CHELM_SESSION_TOKEN:token,CHELM_SESSION_RUNTIME:runtime_id,CHELM_SESSION_OWNER:principal,CHELM_SESSION_PACKAGES:pins}=process.env;
if(!root||!token||token.length<32||!principal||!pins)throw Error('Explicit private store, owner, runtime, package pins and >=32 character token required');
const coordinator=new DurableSessions(new FileSessionStore(root),{runtime_id,principal,expected:JSON.parse(pins),max_checkpoint_bytes:8*1024*1024});
const handler=sessionHandler(async req=>{const b=Buffer.from(req.headers.get('authorization')??''),expected=Buffer.from('Bearer '+token);return b.length===expected.length&&timingSafeEqual(b,expected)?coordinator:null;});
const server=http.createServer(async(req,res)=>{
  try{
    const request=new Request('http://localhost'+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})});
    // Agent-side Git/Python work can block its event loop past the server's
    // keep-alive deadline. Use a fresh socket for each fixture request so a
    // buffered idle-close cannot be mistaken for a lost publication response.
    // Never retry a potentially committed write to hide transport failures.
    const response=await handler(request);res.writeHead(response.status,{...Object.fromEntries(response.headers),connection:'close'});res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(503);res.end();}
});
server.requestTimeout=65000;server.listen(Number(process.env.CHELM_SESSION_PORT??0),'127.0.0.1',()=>process.stdout.write(JSON.stringify({url:`http://127.0.0.1:${server.address().port}/chelm-session`})+'\n'));
