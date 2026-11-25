import {createSessionWorker} from './integration/local-session/worker.mjs';
const identity={runtime_id:'cbb11a5b-6951-4dc8-935a-e66b46dd2fe5',principal:'vendor-synthetic-acceptance',expected:{host_version:'1.3.0',host_code_sha256:'1dd6711b4d99afd29b4323c342efdb52a9679d1965dd55b3cbd7e6e72c446238',harness_version:'0.13.0',harness_manifest_sha256:'fa8ae35da38a1f64e82336ef99c46fdce35a502c2ff5ebf197e618f10e76e17b'}};
const agent=createSessionWorker(async(request,env)=>{
  if(!env.CHELM_AGENT_TOKEN)return null;
  const actual=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(request.headers.get('authorization')??''));
  const expected=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('Bearer '+env.CHELM_AGENT_TOKEN));
  let difference=0;const a=new Uint8Array(actual),b=new Uint8Array(expected);for(let i=0;i<a.length;i++)difference|=a[i]^b[i];
  return difference===0?identity:null;
});
export default {fetch(request,env,ctx){
 if(new URL(request.url).pathname==='/chelm-session')return agent.fetch(request,env,ctx);
 if(new URL(request.url).pathname!=='/')return new Response('Not found',{status:404});
 return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Chelm local sessions</title><style>body{font:18px/1.6 system-ui;max-width:46rem;margin:10vh auto;padding:1.5rem;color:#e5edf8;background:#101a2c}h1{line-height:1.2;color:#8fcaff}a{color:#8fcaff}code{font-size:1rem}</style><h1>Chelm local session acceptance</h1><p>Private synthetic vendor verification for issue #45.</p><p>This deployment uses a D1 coordinator and immutable R2 checkpoints. Agent requests require platform service access and a separate application credential.</p><p>No consumer runtime or private notebook data is stored here.</p><p><a href="https://github.com/apenczolgolonabijorbiper/chelm-host/pull/57">Implementation and acceptance record</a></p></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
}};
