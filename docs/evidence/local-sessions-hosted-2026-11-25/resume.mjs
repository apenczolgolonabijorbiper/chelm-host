// Run in the NEXT independent agent conversation, from the exact PR #57 code.
// stdin: one JSON line {token: existing owner-private Sites service credential}.
// No credentials are written or printed. This script verifies bytes, not agent independence.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)),source=path.resolve(here,'../../..');
const [harness,target]=process.argv.slice(2);
assert(harness&&target,'Usage: node resume.mjs EXACT_HARNESS FRESH_RUNTIME');
const secret=JSON.parse(await new Promise(resolve=>{let s='';process.stdin.on('data',b=>{s+=b;if(s.includes('\n'))resolve(s.split('\n')[0]);});}));process.stdin.pause();
const read=p=>JSON.parse(fs.readFileSync(path.join(here,p),'utf8'));
const observed=read('hosted.json'),request=read('request.json'),accepted=read('accepted.json');
const {SessionClient}=await import(pathToFileURL(path.join(source,'integration/local-session/transport.mjs')));
const {localSession}=await import(pathToFileURL(path.join(source,'lib/local-session.mjs')));
const {execute}=await import(pathToFileURL(path.join(source,'lib/app.mjs')));
const client=new SessionClient({url:observed.site.url+'/chelm-session',token:secret.token,fetcher:(url,options)=>fetch(url,{...options,headers:{...options.headers,'OAI-Sites-Authorization':'Bearer '+secret.token}})});
const status=await client.call('status');assert.equal(status.runtime_id,observed.runtime_id);assert.equal(status.generation,1);assert.equal(status.head.sha256,observed.saved.sha256);
assert(!fs.existsSync(target),'Use a nonexistent owned private target');
await localSession(target,'connect',{apply:true,harness:path.resolve(harness)},{session_id:'acceptance-resume-'+Date.now()},client);
const task=(await execute('task','get',{runtime:target},{task_id:request.task.task_id})).task;
assert.deepEqual(task.receipt,accepted.receipt);assert.equal(task.result.answer,accepted.result.answer);
const local=await execute('status',null,{runtime:target});assert.equal(local.head,accepted.receipt.binding.snapshot_id);
for(const s of request.sources){const result=await execute('task','evidence',{runtime:target},{task_id:task.task_id,work_id:task.receipt.work_id,source_id:s.id,length:16000});assert.equal(result.text,s.text);assert.equal(result.sha256,s.sha256);const observation=await execute('get','observation',{runtime:target},{id:s.id});assert.equal(observation.analyzed,true);}
const input=status.pending.find(r=>r.request_id===observed.pending_request_id);assert(input,'Follow-up durable input missing');
const intake=await execute('submit',null,{runtime:target},{subject_id:'hosted-follow-up',groups:[{kind:'record',lines:[input.payload.text]}]});
console.log(JSON.stringify({checks:'pass',runtime:path.resolve(target),task_id:task.task_id,checkpoint_sha256:status.head.sha256,pending_request_id:input.request_id,intake,next:'Follow AGENTS.md and the file-worker contract to analyze the queued source with the actual agent. Save/acknowledge this request only after a settled commit. Then test reset and detached-session refusal. Record conversation independence separately.'},null,2));
