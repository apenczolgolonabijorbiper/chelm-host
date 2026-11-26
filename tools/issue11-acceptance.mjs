// Operator-owned synthetic fixture and content-free evidence for issue #11.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {inspectRemoteDiscovery} from './remote-discovery.mjs';
const pkg=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const argv=process.argv.slice(2), command=argv[0];
const option=k=>{const i=argv.indexOf('--'+k);return i<0?undefined:argv[i+1];};
const required=k=>{const v=option(k);if(!v)throw Error('Missing --'+k);return v;};
const write=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,JSON.stringify(v,null,2)+'\n',{mode:0o600});};
const machine=()=>({platform:process.platform,os:os.release(),node:process.version,
  host_id:createHash('sha256').update(os.hostname()).digest('hex').slice(0,16)});
function cli(root,args,input){
  const r=spawnSync(process.execPath,[path.join(pkg,'bin/chelm.mjs'),...args,'--runtime',root,...(input?['--input','-']:[])],
    {input:input?JSON.stringify(input):undefined,encoding:'utf8',timeout:180000});
  let v;try{v=JSON.parse(r.stdout);}catch{throw Error('CLI returned no JSON');}
  if(r.status!==0||!v.ok)throw Error('CLI refused: '+(v.error?.code??'unknown'));
  return v;
}
const endpoint=()=>{
  const u=new URL(required('url'));
  if(u.username||u.password||u.search||u.hash||!/^\/mcp(?:\/[a-z0-9_-]+)?$/.test(u.pathname))throw Error('Use a credential-free /mcp[/runtime] URL');
  if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['127.0.0.1','localhost'].includes(u.hostname)))throw Error('HTTPS required outside loopback');
  return u;
};
async function probe(){
  const url=endpoint(),token=process.env[required('token-env')],deniedName=option('denied-token-env');
  if(!token)throw Error('Worker token environment is empty');
  const report={schema_version:1,kind:'issue11-connectivity',recorded_at:new Date().toISOString(),machine:machine(),
    tls:url.protocol==='https:'?'normal certificate verification':'loopback HTTP only',checks:[],inference:'not exercised'};
  const check=(name,pass,fields={})=>report.checks.push({name,pass,...fields});
  const request=async(tokenValue,origin)=>{
    const r=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{
      Authorization:'Bearer '+tokenValue,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(origin?{Origin:origin}:{})},body:'{}'});
    await r.body?.cancel();return r.status;
  };
  const client=new Client({name:'chelm-issue11-acceptance',version:'1'});
  try{
    const code=await request(randomBytes(32).toString('hex'));check('invalid_token',code===401,{http_status:code});
    const origin=await request(token,'https://issue11-denied.invalid');check('denied_origin',origin===403,{http_status:origin});
    if(deniedName){const denied=process.env[deniedName];if(!denied)throw Error('Denied token environment is empty');
      const code=await request(denied);check('denied_runtime',code===403,{http_status:code});}
    else check('denied_runtime',false,{state:'not_run'});
    await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:'Bearer '+token}}}));
    const discovery=await inspectRemoteDiscovery(client);
    const result=await client.callTool({name:'chelm_list_work',arguments:{limit:1}}),v=JSON.parse(result.content[0].text);
    check('discovery',discovery.pass,discovery);
    check('authorized_read',!result.isError&&v.ok===true);
    report.server=client.getServerVersion();
  }catch(e){check('connection',false,{error_class:String(e.name??'Error').slice(0,80)});}
  finally{await client.close().catch(()=>{});}
  report.ok=report.checks.every(c=>c.pass);
  write(path.resolve(required('output')),report);console.log(JSON.stringify({ok:report.ok,checks:report.checks}));
  if(!report.ok)process.exitCode=1;
}
function prepare(){
  const root=path.resolve(required('runtime'));
  if(!root.split(path.sep).some(s=>s.toLowerCase()==='sandbox')||fs.existsSync(root))throw Error('Use a NEW path with a sandbox segment');
  const publicUrl=new URL(required('public-url'));
  if(publicUrl.pathname!=='/mcp'||publicUrl.username||publicUrl.password||publicUrl.search||publicUrl.hash)throw Error('Public URL must end in /mcp without credentials');
  const development=publicUrl.protocol==='http:'&&['localhost','127.0.0.1'].includes(publicUrl.hostname);
  if(publicUrl.protocol!=='https:'&&!development)throw Error('HTTPS required');
  const port=Number(option('port')??4317);if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid port');
  cli(root,['init','--sandbox','--harness',path.resolve(required('harness'))]);
  const cfgPath=path.join(root,'chelm.runtime.json'),cfg=JSON.parse(fs.readFileSync(cfgPath));
  cfg.observability={operation_phases:true,read_metrics:false};cfg.remote.max_active_work=2;write(cfgPath,cfg);
  const sent=cli(root,['submit'],{subject_id:'ISSUE11-SYNTHETIC',groups:[
    {kind:'record',chunks:['ISSUE11 synthetic: Release R-11 requires integration test INT-11. No result for INT-11 has been recorded.']},
    {kind:'record',chunks:['ISSUE11 synthetic: Component C-11 belongs to release R-11. Build B-11 passed unit tests only; integration tests were not reported.']} ]});
  const marker={schema_version:1,kind:'issue11-synthetic-only',runtime_id:cfg.runtime_id,
    created_at:new Date().toISOString(),observation_ids:sent.groups.flatMap(g=>g.observation_ids)};
  write(path.join(root,'operator/issue11.json'),marker);
  write(path.join(root,'operator/service.json'),{listen:'127.0.0.1',port,public_url:publicUrl.href.replace(/\/$/,''),development,
    runtimes:{app:root},auth:{mode:'worker-tokens',workers:[
      {principal:'issue11-worker',runtimes:['app'],token_env:'ISSUE11_WORKER_TOKEN'},
      {principal:'issue11-denied',runtimes:['other'],token_env:'ISSUE11_DENIED_TOKEN'}]}});
  write(path.join(root,'operator/agent-report.template.json'),{schema_version:1,model:'unknown',client:'unknown',
    machine:null,usage:{model_ms:null,input_tokens:null,output_tokens:null,cached_input_tokens:null,billed_cost:null,currency:null},
    scenarios:['cycle','no_work','validation_repair','service_restart','lost_reply','policy_change','concurrent','integration','bounded_loop','revocation']
      .map(name=>({name,status:'not_run',work_id:null,attempt:null,head:null})),finding_review:'not_run'});
  console.log(JSON.stringify({ok:true,runtime:root,observation_ids:marker.observation_ids,
    service_config:path.join(root,'operator/service.json'),minimum_age_seconds:60}));
}
function collect(){
  const root=path.resolve(required('runtime')),marker=JSON.parse(fs.readFileSync(path.join(root,'operator/issue11.json')));
  if(marker.kind!=='issue11-synthetic-only')throw Error('Not an issue11 fixture');
  const cfg=JSON.parse(fs.readFileSync(path.join(root,'chelm.runtime.json')));
  if(cfg.runtime_id!==marker.runtime_id)throw Error('Fixture identity changed');
  const summary=cli(root,['read','summary']).view, status=cli(root,['status']);
  const dir=path.join(root,'host/remote/work'),work=[];
  if(fs.existsSync(dir))for(const name of fs.readdirSync(dir).filter(n=>/^[a-f0-9-]{36}$/.test(n))){
    const a=JSON.parse(fs.readFileSync(path.join(dir,name,'record.json')));
    work.push({work_id:a.work_id,attempt:a.attempt,kind:a.kind,status:a.status,
      source_count:a.sources.length,model:a.executor.model,receipt:a.receipt?{status:a.receipt.status,head:a.receipt.head,candidate_digest:a.receipt.candidate_digest}:null,
      usage:a.submission?.usage??null});
  }
  const phases=[];
  for(const suffix of ['.5','.4','.3','.2','.1','']){
    const p=path.join(root,'host/logs/chelm.jsonl'+suffix);if(!fs.existsSync(p))continue;
    if(fs.statSync(p).size>11*1024*1024)throw Error('Oversized operation log');
    for(const line of fs.readFileSync(p,'utf8').split('\n').filter(Boolean)){
      let e;try{e=JSON.parse(line);}catch{continue;}
      if(!e.command?.startsWith('remote chelm_'))continue;
      phases.push({command:e.command,work_id:e.work_id,run_id:e.run_id,outcome:e.outcome,duration_ms:e.duration_ms,
        phases:Object.fromEntries(Object.entries(e.phases??{}).filter(([k,v])=>/^[a-z_]+$/.test(k)&&Number.isFinite(v.elapsed_ms))
          .map(([k,v])=>[k,{calls:v.calls,elapsed_ms:v.elapsed_ms}]))});
    }
  }
  let source_revision=null;const git=spawnSync('git',['-C',pkg,'rev-parse','HEAD'],{encoding:'utf8'});
  const clean=spawnSync('git',['-C',pkg,'diff','--quiet','HEAD','--'],{encoding:'utf8'});
  if(git.status===0&&clean.status===0&&/^[a-f0-9]{40}$/.test(git.stdout.trim()))source_revision=git.stdout.trim();
  const report={schema_version:1,kind:'issue11-owner',recorded_at:new Date().toISOString(),machine:machine(),
    source_revision,package_manifest_sha256:fs.existsSync(path.join(pkg,'RELEASE.json'))?createHash('sha256').update(fs.readFileSync(path.join(pkg,'RELEASE.json'))).digest('hex'):null,
    runtime_id:marker.runtime_id,harness_version:summary.harness_version,
    counts:{inbox:summary.inbox,processed:summary.processed,pending:summary.pending_analysis,...summary.totals},
    head:summary.head,recovery_required:status.recovery_required,work,operations:phases,
    inference:'Executor-reported usage only; missing provider time/tokens/cost stay unknown. Supply agent-report separately.',
    publication_scope:'publication phase ends after Git CAS and before receipt/read-view reconciliation; nested timings are not additive.'};
  write(path.resolve(required('output')),report);console.log(JSON.stringify({ok:true,work:work.length,processed:summary.processed}));
}
function seed(){
  const root=path.resolve(required('runtime')), m=JSON.parse(fs.readFileSync(path.join(root,'operator/issue11.json')));
  const scenario=required('case');
  if(m.kind!=='issue11-synthetic-only'||!['validation_repair','policy_change','service_restart','concurrent','bounded_loop'].includes(scenario))throw Error('Unknown synthetic scenario');
  if(JSON.parse(fs.readFileSync(path.join(root,'chelm.runtime.json'))).runtime_id!==m.runtime_id)throw Error('Fixture identity changed');
  console.log(JSON.stringify(cli(root,['submit'],{subject_id:'ISSUE11-'+scenario,groups:[{kind:'record',chunks:[`ISSUE11 additional synthetic record for ${scenario}. Request ${randomBytes(8).toString('hex')}; no external test result is asserted.`]}]})));
}
try{
  if(command==='prepare')prepare();else if(command==='probe')await probe();else if(command==='collect')collect();
  else if(command==='seed')seed();
  else throw Error('Use prepare, probe, seed or collect; see docs/ISSUE_11_ACCEPTANCE.md');
}catch(e){console.error('Acceptance tool failed: '+e.message);process.exitCode=1;}
