import test from './scenario.mjs';
import assert from 'node:assert/strict';
import http from 'node:http';
import {startServer,stopServer} from '../lib/remote-server.mjs';

const token='synthetic-diagnostics-token-0123456789';
const config={port:0,public_url:'http://127.0.0.1/mcp',development:true,runtimes:{app:process.cwd()},
  auth:{mode:'worker-tokens',workers:[{principal:'worker',runtimes:['app'],token_env:'TOKEN'}]}};

test('MCP diagnostics correlate reused sockets and aborted bodies without retaining private input',async t=>{
  const events=[];
  let observedRequest,observedAbort;
  const server=await startServer(config,{env:{TOKEN:token},diagnostics:event=>{
    events.push(event);
    if(event.phase==='request')observedRequest?.();
    if(event.phase==='request_aborted')observedAbort?.();
  }});
  const agent=new http.Agent({keepAlive:true,maxSockets:1});
  t.after(async()=>{agent.destroy();await stopServer(server);});
  function request(body) {
    return new Promise((resolve,reject)=>{
      const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/mcp?private-query',method:'POST',agent,
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'}},res=>{
        res.resume();res.once('end',()=>resolve(res.statusCode));
      });
      req.on('error',reject);req.end(body);
    });
  }
  assert.equal(await request(JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'private-client-name',version:'1'}}})),200);
  assert.equal(await request('private-invalid-json'),400);
  const requests=events.filter(e=>e.phase==='request');
  assert.equal(requests.length,2);
  assert.equal(requests[0].socket_id,requests[1].socket_id,'HTTP keep-alive must reuse the socket');
  assert.notEqual(requests[0].request_id,requests[1].request_id);
  assert(events.some(e=>e.phase==='body_received'&&e.method==='initialize'&&e.complete));
  assert(events.some(e=>e.phase==='response_finished'&&e.status===200));
  assert(events.some(e=>e.phase==='transport_closed'));

  const received=new Promise(resolve=>{observedRequest=resolve;});
  const aborted=new Promise(resolve=>{observedAbort=resolve;});
  const req=http.request({hostname:'127.0.0.1',port:server.address().port,path:'/mcp',method:'POST',agent,
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
  req.on('error',()=>{});req.write('{"private-partial-body":');
  await received;req.destroy();await aborted;
  agent.destroy();await stopServer(server);
  await new Promise(resolve=>setImmediate(resolve));
  const abort=events.find(e=>e.phase==='request_aborted');
  assert.equal(abort.complete,false);
  assert(events.some(e=>e.phase==='socket_closed'&&e.socket_id===abort.socket_id));
  const encoded=JSON.stringify(events);
  for(const value of [token,'private-query','private-client-name','private-invalid-json','private-partial-body'])assert(!encoded.includes(value));
});

test('A throwing optional MCP diagnostics callback cannot break requests or shutdown',async t=>{
  const server=await startServer(config,{diagnostics(){throw Error('private diagnostic failure');}});
  t.after(()=>stopServer(server));
  const result=await fetch(`http://127.0.0.1:${server.address().port}/.well-known/oauth-protected-resource`);
  assert.equal(result.status,200);await result.json();
  await stopServer(server);
});
