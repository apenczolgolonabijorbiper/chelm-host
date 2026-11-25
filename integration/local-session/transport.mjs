import {SessionError} from '../../lib/durable-session.mjs';
const b64=bytes=>{let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);};
const unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
export async function sessionRpc(c,operation,args={}){
  switch(operation){
    case 'initialize':return c.transaction(s=>({runtime_id:s.runtime_id,generation:s.generation,revision:s.revision}));
    case 'status':return c.status();
    case 'acquire':return c.acquire(args);
    case 'renew':return c.renew(args.binding,args.ttl_ms);
    case 'release':return c.release(args.binding);
    case 'intake':return c.intake(args);
    case 'progress':return c.progress(args.binding,args.request_ids,args.state);
    case 'upload':return c.upload(args.binding,args.submission_id,unb64(args.base64));
    case 'publish':return c.publish(args.binding,args.publication);
    case 'discard-upload':return c.discardUpload(args.binding,args.submission_id);
    case 'recover':return c.recover(args);
    case 'download':return {base64:b64(await c.download(args))};
    case 'reset':return c.reset(args);
    case 'sweep':return c.sweep();
    case 'local-cleanup':return c.localCleanup(args);
    default:throw new SessionError('operation_unknown','Unknown local-session operation');
  }
}
export async function boundedBody(response,max=12*1024*1024){
  if(Number(response.headers.get('content-length'))>max)throw new SessionError('capacity_exceeded','Transport body exceeds budget');
  const reader=response.body?.getReader();if(!reader)return new Uint8Array();
  const chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw new SessionError('capacity_exceeded','Transport body exceeds budget');}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
// authorize(request) must authenticate first, then bind a runtime to its owning application principal.
// It must never accept an identity or a store namespace from the request body.
export function sessionHandler(authorize){return async request=>{
  try{
    const coordinator=await authorize(request);
    if(!coordinator)return Response.json({ok:false,error:{code:'authorization',message:'Authentication required'}},{status:401});
    if(request.method!=='POST'||new URL(request.url).pathname!=='/chelm-session')return new Response('Not found',{status:404});
    const bytes=await boundedBody(request),{operation,args}=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    const value=await sessionRpc(coordinator,operation,args);
    const body=JSON.stringify({ok:true,value});if(body.length>12*1024*1024)throw new SessionError('capacity_exceeded','Transport response exceeds budget');
    return new Response(body,{headers:{'content-type':'application/json','cache-control':'no-store'}});
  }catch(e){return Response.json({ok:false,error:{code:e instanceof SessionError?e.code:'store_unavailable',message:e instanceof SessionError?e.message:'Request failed; recover the same submission before retrying'}},{status:409,headers:{'cache-control':'no-store'}});}
};}
export class SessionClient{
  constructor({url,token,fetcher=fetch}){
    const parsed=new URL(url);if(parsed.protocol!=='https:'&&!(parsed.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)))throw new SessionError('authorization','HTTPS is required for private checkpoint transport');
    if(parsed.username||parsed.password||parsed.search||parsed.hash)throw new SessionError('authorization','Credentials/queries must not be embedded in the URL');
    if(typeof token!=='string'||!token)throw new SessionError('authorization','Explicit application transport credential required');
    Object.assign(this,{url,token,fetcher});
  }
  async call(operation,args={}){
    const body=JSON.stringify({operation,args});if(body.length>12*1024*1024)throw new SessionError('capacity_exceeded','Transport request exceeds budget');
    const r=await this.fetcher(this.url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{authorization:'Bearer '+this.token,'content-type':'application/json'},body});
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBody(r)));
    if(!r.ok||data.ok!==true)throw new SessionError(data.error?.code??'store_unavailable',data.error?.message??'Transport failed');return data.value;
  }
  async upload(binding,submission_id,bytes){return this.call('upload',{binding,submission_id,base64:b64(bytes)});}
  async download(binding){return unb64((await this.call('download',binding)).base64);}
}
