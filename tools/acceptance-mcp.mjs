// Explicit opt-in, content-free tool timing bridge for the issue #11 test only.
import fs from 'node:fs';
import path from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
const option=k=>{const i=process.argv.indexOf('--'+k);return i<0?undefined:process.argv[i+1];};
try{
  const url=new URL(option('url')),report=path.resolve(option('report'));
  if(url.username||url.password||url.search||url.hash)throw Error('Credential-free URL required');
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost'].includes(url.hostname)))throw Error('HTTPS required');
  const token=process.env[option('token-env')??'ISSUE11_WORKER_TOKEN'];if(!token)throw Error('Missing credential environment');
  fs.mkdirSync(path.dirname(report),{recursive:true});
  const remote=new Client({name:'chelm-acceptance-bridge',version:'1'});
  await remote.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer '+token}}}));
  const local=new Server({name:'chelm-acceptance-worker',version:'1'},{capabilities:{tools:{}}});
  local.setRequestHandler(ListToolsRequestSchema,()=>remote.listTools());
  local.setRequestHandler(CallToolRequestSchema,async(req)=>{
    const at=performance.now();let response_bytes=null,outcome='transport_error';
    try{const r=await remote.callTool(req.params);response_bytes=Buffer.byteLength(JSON.stringify(r));outcome=r.isError?'tool_error':'ok';return r;}
    finally{try{fs.appendFileSync(report,JSON.stringify({at:new Date().toISOString(),tool:/^chelm_[a-z_]+$/.test(req.params.name)?req.params.name:'other',
      elapsed_ms:performance.now()-at,request_json_bytes:Buffer.byteLength(JSON.stringify(req.params)),response_json_bytes:response_bytes,outcome})+'\n',{mode:0o600});}catch{}}
  });
  await local.connect(new StdioServerTransport());
  process.stdin.on('end',()=>remote.close().catch(()=>{}));
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await remote.close();await local.close();process.exit(0);});
}catch(e){console.error('Acceptance bridge connection failed ('+String(e.name??'Error')+')');process.exitCode=1;}
