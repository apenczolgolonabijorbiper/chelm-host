import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {startServer,stopServer} from '../lib/remote-server.mjs';
import fs from 'node:fs';
import path from 'node:path';

export function causeChain(error) {
  const chain=[];
  for(let e=error;e&&chain.length<8;e=e.cause)chain.push({name:e.name,code:e.code??null,syscall:e.syscall??null});
  return chain;
}
export function mcpSession(t, root, {hooks={}, label='cognitive'}={}) {
  let server, client, generation=0;
  const phases=[];
  const record=value=>{if(phases.length<1000)phases.push(value);};
  async function phase(name, operation) {
    const started=performance.now();
    try {const value=await operation();record({name,generation,elapsed_ms:performance.now()-started,ok:true});return value;}
    catch(e) {const causes=causeChain(e);record({name,generation,elapsed_ms:performance.now()-started,ok:false,causes});
      throw Error(`MCP phase ${name} generation ${generation} failed after ${Math.round(performance.now()-started)} ms: ${JSON.stringify(causes)}`);}
  }
  async function connect() {
    generation++;
    server=await phase('start-server',()=>startServer({port:0,public_url:'http://127.0.0.1/mcp',development:true,runtimes:{app:root},
      auth:{mode:'worker-tokens',workers:[{principal:'worker-b',runtimes:['app'],token_env:'TEST_COGNITIVE_TOKEN'}]}},
      {env:{TEST_COGNITIVE_TOKEN:'synthetic-conformance-token-not-a-secret'},hooks,diagnostics:event=>record({generation,...event})}));
    client=new Client({name:'independent-cognitive-client',version:'1'});
    await phase('connect',()=>client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+server.address().port+'/mcp'),
      {requestInit:{headers:{Authorization:'Bearer synthetic-conformance-token-not-a-secret'}}}),{timeout:15000}));
  }
  async function close() {
    const oldClient=client,oldServer=server;client=server=null;
    // Always attempt server cleanup even if client.close throws.
    try {if(oldClient)await phase('close-client',()=>oldClient.close());}
    finally {if(oldServer)await phase('close-server',()=>stopServer(oldServer));}
  }
  t.after(async()=>{try {await close();}finally {
    if(process.env.CHELM_ACCEPTANCE_REPORT_DIR) {
      const output=path.resolve(process.env.CHELM_ACCEPTANCE_REPORT_DIR);fs.mkdirSync(output,{recursive:true});
      fs.writeFileSync(path.join(output,`mcp-${label}-${process.platform}-${process.pid}.json`),JSON.stringify({node:process.version,platform:process.platform,phases},null,2)+'\n');
    }
  }});
  return {connect,close,phase,get server(){return server;},call:(name,input)=>phase('tool '+name,()=>client.callTool({name,arguments:input},undefined,{timeout:60000}))};
}
