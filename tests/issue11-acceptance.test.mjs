import test from './scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {source,harness} from './helpers.mjs';
import {startServer} from '../lib/remote-server.mjs';
const exec=promisify(execFile), tool=path.join(source,'tools/issue11-acceptance.mjs');
test('issue11 operator toolkit: isolated preparation, auth refusals, measured bridge and content-free collection', async t=>{
  const base=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'chelm-issue11-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const root=path.join(base,'sandbox/runtime');
  await assert.rejects(exec(process.execPath,[tool,'prepare','--runtime',path.join(base,'ordinary'),'--harness',harness,'--public-url','http://127.0.0.1/mcp']));
  const prepared=JSON.parse((await exec(process.execPath,[tool,'prepare','--runtime',root,'--harness',harness,'--public-url','http://127.0.0.1/mcp','--port','0'])).stdout);
  assert.equal(prepared.observation_ids.length,2);
  await assert.rejects(exec(process.execPath,[tool,'prepare','--runtime',root,'--harness',harness,'--public-url','http://127.0.0.1/mcp']));
  const token='ISSUE11_TOKEN_CANARY_'+'x'.repeat(40), denied='ISSUE11_DENIED_CANARY_'+'y'.repeat(40);
  const env={...process.env,ISSUE11_WORKER_TOKEN:token,ISSUE11_DENIED_TOKEN:denied};
  const server=await startServer(JSON.parse(fs.readFileSync(prepared.service_config)),{env});
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const url=`http://127.0.0.1:${server.address().port}/mcp/app`, report=path.join(base,'connectivity.json');
  await exec(process.execPath,[tool,'probe','--url',url,'--token-env','ISSUE11_WORKER_TOKEN','--denied-token-env','ISSUE11_DENIED_TOKEN','--output',report],{env});
  assert.equal(JSON.parse(fs.readFileSync(report)).ok,true);
  const broken=path.join(base,'broken.json');
  await assert.rejects(exec(process.execPath,[tool,'probe','--url',url,'--token-env','ISSUE11_WORKER_TOKEN','--output',broken],{env}));
  assert.equal(JSON.parse(fs.readFileSync(broken)).checks.find(c=>c.name==='denied_runtime').state,'not_run');
  const calls=path.join(base,'worker-tools.jsonl'), client=new Client({name:'operator-test',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(source,'tools/acceptance-mcp.mjs'),'--url',url,'--token-env','ISSUE11_WORKER_TOKEN','--report',calls],env});
  t.after(()=>client.close());
  await client.connect(transport);
  await client.listTools();
  await client.callTool({name:'chelm_list_work',arguments:{}});
  // Tool results travel unmodified; instrumentation records byte counts, not bodies.
  const records=fs.readFileSync(calls,'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(records[0].tool,'chelm_list_work');
  assert.ok(records[0].request_json_bytes>0&&records[0].response_json_bytes>0);
  await exec(process.execPath,[tool,'seed','--runtime',root,'--case','policy_change']);
  const owner=path.join(base,'owner.json');
  await exec(process.execPath,[tool,'collect','--runtime',root,'--output',owner]);
  const summary=JSON.parse(fs.readFileSync(owner));assert.equal(summary.counts.inbox,3);
  for(const p of [report,broken,calls,owner]){
    const text=fs.readFileSync(p,'utf8');assert.equal(text.includes(token),false);assert.equal(text.includes(denied),false);
    assert.equal(text.includes('Release R-11 requires'),false);assert.equal(text.includes(root),false);
  }
});
