#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {ownedProcess} from './owned-process.mjs';
import {createHash} from 'node:crypto';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const key of ['CHELM_HARNESS_ROOT','CHELM_PROVIDER_HARNESS_ROOT'])
  if (process.env[key]) process.env[key]=path.resolve(process.env[key]);
const options = {concurrency: process.platform === 'win32' ? 2 : 4, repeat: 1, label: 'supported', 'attempt-ms':600000};
for (let i=2; i<process.argv.length; i+=2) {
  const key=process.argv[i].slice(2), value=process.argv[i+1];
  if (!['concurrency','repeat','report','label','name','file','attempt-ms'].includes(key) || !value) throw Error('Unknown/missing test policy option');
  options[key]=['concurrency','repeat','attempt-ms'].includes(key)?Number(value):value;
}
for (const k of ['concurrency','repeat']) if (!Number.isInteger(options[k]) || options[k]<1 || options[k]>10) throw Error('Invalid '+k);
const maxAttemptMs = process.platform === 'win32' ? 750000 : 600000;
if (!Number.isInteger(options['attempt-ms']) || options['attempt-ms'] < 1000 || options['attempt-ms'] > maxAttemptMs) {
  throw Error('Invalid attempt budget');
}
const tests = fs.readdirSync(path.join(root,'tests'), {recursive:true}).filter(p=>p.endsWith('.test.mjs')).sort().map(p=>path.join('tests',p)).filter(p=>!options.file || p.replaceAll('\\','/')===options.file);
if (!tests.length) throw Error('No matching test files');
const report={platform:process.platform,os_release:os.release(),node:process.version,policy:options,
  harness:process.env.CHELM_HARNESS_ROOT??null,provider_harness:process.env.CHELM_PROVIDER_HARNESS_ROOT??null,attempts:[]};
const destination=path.resolve(options.report??process.env.CHELM_ACCEPTANCE_REPORT_DIR??path.join(root,'dist'));
fs.mkdirSync(destination,{recursive:true});
report.packages={};
for(const [name,dir] of Object.entries({host:root,harness:process.env.CHELM_HARNESS_ROOT,provider:process.env.CHELM_PROVIDER_HARNESS_ROOT})) {
  if(dir&&fs.existsSync(path.join(dir,'RELEASE.json'))) {
    const bytes=fs.readFileSync(path.join(dir,'RELEASE.json'));
    report.packages[name]={version:JSON.parse(bytes).version,manifest_sha256:createHash('sha256').update(bytes).digest('hex')};
  }
}
let failed=false;
// Every requested attempt is retained; none is a retry that discards a failure.
for(let attempt=1;attempt<=options.repeat;attempt++) {
  const started=Date.now(), phase=`${options.label} suite attempt ${attempt}`;
  const metrics=fs.mkdtempSync(path.join(os.tmpdir(),'chelm-test-metrics-'));
  const args=['--test','--test-reporter=tap',`--test-concurrency=${options.concurrency}`,'--test-timeout=600000',
    ...(options.name?['--test-name-pattern='+options.name]:[]),...tests];
  const r=ownedProcess(process.execPath,args,{cwd:root,timeout:options['attempt-ms'],phase,env:{...process.env,CHELM_PROCESS_REPORT_DIR:metrics}});
  const log=String(r.stdout??'')+String(r.stderr??'');
  const logName=`tests-${options.label}-${process.platform}-${attempt}.log`;
  fs.writeFileSync(path.join(destination,logName),log);
  const counts={}; for(const k of ['tests','pass','fail','cancelled','skipped'])counts[k]=Number(log.match(new RegExp('^# '+k+' (\\d+)','m'))?.[1]??0);
  const commands=fs.readdirSync(metrics).filter(p=>p.endsWith('.json')).map(p=>JSON.parse(fs.readFileSync(path.join(metrics,p))));
  fs.rmSync(metrics,{recursive:true,force:true});
  const events=commands.filter(c=>c.phase.startsWith('test CLI ')||c.phase.startsWith('service-probe ')).flatMap(c=>[[c.started_ms,1],[c.ended_ms,-1]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  let active=0,peak=0;for(const [,change]of events){active+=change;peak=Math.max(peak,active);}
  report.attempts.push({attempt,elapsed_ms:Date.now()-started,exit:r.status,signal:r.signal,error:r.error?.code??null,counts,log:logName,
    max_concurrent_supervised_commands:peak,commands});
  fs.writeFileSync(path.join(destination,`tests-${options.label}-${process.platform}.json`),JSON.stringify(report,null,2)+'\n');
  process.stdout.write(log);
  if(r.status!==0 || r.error || !counts.tests || counts.fail || counts.cancelled)failed=true;
}
process.exitCode=failed?1:0;
