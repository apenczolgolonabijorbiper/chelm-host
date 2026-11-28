// Issue #3: collect measurements on the operator's machine, never a live runtime.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {ownedProcess} from './owned-process.mjs';
import {integrity, verifyHarness} from '../lib/harness.mjs';

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const write = (p, value) => fs.writeFileSync(p, JSON.stringify(value, null, 2) + '\n', {mode:0o600});
const inside = (parent, child) => { const rel=path.relative(parent, child); return !rel || (!rel.startsWith('..'+path.sep) && rel!=='..' && !path.isAbsolute(rel)); };
const positive = n => Number.isFinite(n) && n >= 0;
function resolvedDestination(candidate) {
  // Resolve existing ancestors without creating anything before the package guard.
  let ancestor=path.resolve(candidate);const suffix=[];
  while(!fs.existsSync(ancestor)) {suffix.unshift(path.basename(ancestor));ancestor=path.dirname(ancestor);}
  return path.join(fs.realpathSync(ancestor),...suffix);
}

export function parseOptions(argv, platform=process.platform) {
  const command=argv[0], allowed=['harness','output','context','machine-label','load-note','samples','suite-repeat','expected-identity','launch-context'];
  if (!['performance','service'].includes(command)) throw Error('Use performance or service; see docs/ISSUE_3_ACCEPTANCE.md');
  const options={command,samples:5,'suite-repeat':1};
  for(let i=1;i<argv.length;i+=2) {
    const key=argv[i].slice(2), value=argv[i+1];
    if(!argv[i].startsWith('--') || !allowed.includes(key) || !value || value.startsWith('--') || Object.hasOwn(options,key) && !['samples','suite-repeat'].includes(key))
      throw Error('Unknown, duplicate or missing option: '+argv[i]);
    // Numeric defaults may be overridden once.
    if(argv.slice(1,i).includes(argv[i])) throw Error('Duplicate option: '+argv[i]);
    options[key]=value;
  }
  for(const key of ['harness','output','context','machine-label','load-note']) if(!options[key]?.trim()) throw Error('Missing --'+key);
  const contexts=command==='performance'?['local','hosted-runner','reference-workstation']:['local','hosted-runner','target-server'];
  if(!contexts.includes(options.context)) throw Error('Invalid --context for '+command);
  if(['reference-workstation','target-server'].includes(options.context) && platform!=='win32') throw Error('Reference workstation/target server acceptance requires Windows');
  for(const [key,max] of [['samples',20],['suite-repeat',3]]) {
    options[key]=Number(options[key]);
    if(!Number.isInteger(options[key]) || options[key]<1 || options[key]>max) throw Error('Invalid --'+key);
  }
  if(options.context==='reference-workstation' && options.samples<3) throw Error('Reference evidence needs at least three timing samples');
  if(command==='service' && (!options['expected-identity']?.trim() || !options['launch-context']?.trim())) throw Error('Service mode requires --expected-identity and --launch-context');
  if(command==='performance' && (options['expected-identity'] || options['launch-context'])) throw Error('Identity options require service mode');
  return options;
}

export function summarizePerformance(latency, capacity, builds, samples, repeats) {
  const checks=[];
  const add=(requirement, name, values, count, target_ms) => {
    const complete=Array.isArray(values) && values.length===count && values.every(positive);
    checks.push({requirement,name,state:!complete?'incomplete':values.every(n=>n<target_ms)?'met':'unmet',target_ms,
      samples_ms:values??[],max_ms:complete?Math.max(...values):null});
  };
  const startup=latency?.node_process_start_ms;
  checks.push({requirement:'TST-9',name:'Node process startup',state:Array.isArray(startup)&&startup.length===samples&&startup.every(positive)?'measured':'incomplete',samples_ms:startup??[],target_ms:null});
  for(const [name,target] of Object.entries({submit:2000,ask:3000,status:1000})) {
    const rows=latency?.commands?.[name]?.samples;
    const valid=rows?.every(r=>positive(r.elapsed_ms)&&positive(r.excluded_ms)&&positive(r.nfr_ms)&&positive(r.retrieval_ms)&&r.excluded_ms<=r.elapsed_ms&&Math.abs(r.nfr_ms-(r.elapsed_ms-r.excluded_ms))<0.01);
    add('NFR-4',name,valid?rows.map(r=>r.nfr_ms):undefined,samples,target);
  }
  const rows=capacity?.samples;
  const valid=rows?.every(r=>[r.regeneration_ms,r.deep_refresh_ms,r.validator_ms,r.statistics_ms,r.tail_100000_ms].every(positive));
  add('RM-6','Capacity regeneration',valid?rows.map(r=>r.regeneration_ms):undefined,samples,3000);
  const fixture=capacity?.fixture;
  checks.push({requirement:'NFR-5',name:'Capacity and committed-tree boundaries',state:fixture?.subjects===10000&&fixture?.conversation_turns===100000&&fixture?.exact_64_mib_accepted===true&&fixture?.over_64_mib_refused===true&&valid&&rows.length===samples?'measured':'incomplete'});
  add('TST-9','Full staged build and suites (includes setup)',builds.map(r=>r?.suite_seconds===undefined?null:r.suite_seconds*1000),repeats,600000);
  return {checks,measurements_complete:checks.every(c=>c.state!=='incomplete'),unmet_targets:checks.filter(c=>c.state==='unmet').map(c=>c.name)};
}

function packageIdentity(root) {
  const manifest=path.join(root,'RELEASE.json');
  if(fs.existsSync(manifest)) {
    const checked=integrity(root);
    if(checked.problems.length) throw Error('Package integrity failed: '+checked.problems.join(', '));
    return {version:checked.manifest.version,manifest_sha256:sha(fs.readFileSync(manifest)),integrity:'verified'};
  }
  // Record exact source inputs, including uncommitted/untracked implementation files.
  const r=ownedProcess('git',['-C',root,'ls-files','-z','--cached','--others','--exclude-standard'],{timeout:10000,phase:'source inventory'});
  if(r.status!==0 || r.error) throw Error('Use a verified release or Git source checkout');
  const files=[...new Set(r.stdout.split('\0').filter(Boolean))].sort();
  const digest=createHash('sha256');
  for(const file of files) {digest.update(file+'\0');digest.update(fs.existsSync(path.join(root,file))?sha(fs.readFileSync(path.join(root,file))):'deleted');digest.update('\n');}
  const head=ownedProcess('git',['-C',root,'rev-parse','HEAD'],{timeout:10000,phase:'source revision'});
  return {version:read(path.join(root,'package.json')).version,git_head:head.status===0?head.stdout.trim():null,source_sha256:digest.digest('hex'),integrity:'source snapshot; staged build verifies release'};
}

function environment(python) {
  const command=(exe,args) => {const r=ownedProcess(exe,args,{python,timeout:15000,phase:'machine inventory'});return r.status===0&&!r.error?(r.stdout||r.stderr).trim():null;};
  const windows=process.platform==='win32';
  const whoami=windows?path.join(process.env.SystemRoot??'C:\\Windows','System32/whoami.exe'):'whoami';
  const name=command(whoami,[]);
  const sid=windows?command(whoami,['/user','/fo','csv','/nh'])?.match(/S-1-(?:\d+-)*\d+/)?.[0]??null:null;
  let windows_os=null;
  if(windows) {
    const value=command(path.join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command','Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version,BuildNumber | ConvertTo-Json -Compress']);
    try {windows_os=JSON.parse(value);} catch { /* Missing inventory remains explicit. */ }
  }
  return {platform:process.platform,os_release:os.release(),windows_os,arch:os.arch(),cpu_model:os.cpus()[0]?.model??null,cpus:os.cpus().length,
    total_memory_bytes:os.totalmem(),node:process.version,python:command(python,['--version']),git:command('git',['--version']),
    identity:{name,sid},detected_ci:Boolean(process.env.CI||process.env.GITHUB_ACTIONS||process.env.TF_BUILD)};
}
const load=()=>({at:new Date().toISOString(),free_memory_bytes:os.freemem(),load_average:process.platform==='win32'?null:os.loadavg(),cpu_times:os.cpus().map(c=>c.times)});

export async function collect(options) {
  const harness=fs.realpathSync(path.resolve(options.harness));
  const destination=resolvedDestination(options.output);
  if(inside(pkg,destination)||inside(harness,destination)) throw Error('Evidence directory must be outside both packages');
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  // Refuse an existing directory; never overwrite a previous failed measurement.
  fs.mkdirSync(destination,{mode:0o700});
  const python=process.env.GOLEM_PYTHON??(process.platform==='win32'?'py':'python3');
  const report={schema_version:1,kind:'issue3-'+options.command,started_at:new Date().toISOString(),context:options.context,
    machine_label:options['machine-label'],operator_load_note:options['load-note'],samples:options.samples,suite_repeat:options['suite-repeat'],
    phases:[],load_before:load(),limitations:['Synthetic disposable runtimes; no inference or consuming-application HTTP/export acceptance.','Context and load note are operator declarations; CI/local results do not certify a reference workstation.'],complete:false};
  const save=()=>write(path.join(destination,'report.json'),report);
  save();
  let scratch;
  try {
    report.environment=environment(python);
    if(!report.environment.python || !report.environment.git || !report.environment.identity.name)
      throw Error('Required tool-version or OS process identity inventory unavailable');
    if(['reference-workstation','target-server'].includes(options.context) && !report.environment.windows_os)
      throw Error('Windows edition/build inventory unavailable');
    if(report.environment.detected_ci && ['reference-workstation','target-server'].includes(options.context)) throw Error('Detected CI cannot be declared reference/target evidence');
    report.host=packageIdentity(pkg);
    const checked=verifyHarness({harness:{root:harness,node:process.execPath,python,git:'git'}});
    report.harness={version:checked.manifest.version,manifest_sha256:checked.compatibility.manifest_sha256};
    // The deterministic release builder uses the published reference pair, not arbitrary approved versions.
    if(options.command==='performance' && report.harness.manifest_sha256!==read(path.join(pkg,'compatibility.json')).published_harness.manifest_sha256)
      throw Error('Performance bundle requires the published reference harness for its staged build');
    save();
    const run=(name,exe,args,timeout=600000) => {
      process.stderr.write('Measuring '+name+'\n');
      const before=performance.now();
      const r=ownedProcess(exe,args,{python,cwd:pkg,timeout,phase:'reference acceptance '+name,
        env:{...process.env,GOLEM_PYTHON:python,CHELM_HARNESS_ROOT:harness,CHELM_PROVIDER_HARNESS_ROOT:harness}});
      fs.writeFileSync(path.join(destination,name+'.stdout.log'),r.stdout??'',{mode:0o600});
      fs.writeFileSync(path.join(destination,name+'.stderr.log'),r.stderr??'',{mode:0o600});
      const phase={name,elapsed_ms:performance.now()-before,exit:r.status,signal:r.signal??null,error:r.error?.code??null,ok:r.status===0&&!r.error};
      report.phases.push(phase);save();return phase;
    };
    if(options.command==='performance') {
      run('latency',process.execPath,[path.join(pkg,'tools/benchmark-host.mjs'),'--harness',harness,'--samples',String(options.samples),'--output',path.join(destination,'latency.json')]);
      run('capacity',process.execPath,[path.join(pkg,'tools/benchmark-capacity.mjs'),'--harness',harness,'--samples',String(options.samples),'--output',path.join(destination,'capacity.json')]);
      const builds=[];
      for(let i=1;i<=options['suite-repeat'];i++) {
        const dir=path.join(destination,'build-'+i);fs.mkdirSync(dir);
        // Existing per-command/file/attempt budgets remain in the staged builder.
        const phase=run('build-'+i,python,[path.join(pkg,'tools/build-release.py'),'--harness',harness,'--provider-harness',harness,'--output',path.join(dir,'chelm-host.zip')],process.platform==='win32'?3600000:1200000);
        const timing=path.join(dir,'test-timing-'+process.platform+'.json');
        builds.push(phase.ok&&fs.existsSync(timing)?read(timing):null);
      }
      const result=name=>{const p=path.join(destination,name+'.json');return fs.existsSync(p)?read(p):null;};
      report.performance=summarizePerformance(result('latency'),result('capacity'),builds,options.samples,options['suite-repeat']);
      report.complete=report.performance.measurements_complete&&report.phases.every(p=>p.ok);
    } else {
      if(!report.host.manifest_sha256) throw Error('Service probe requires an extracted verified host release');
      const actual=report.environment.identity;
      report.service={expected_identity:options['expected-identity'],actual_identity:actual,launch_context:options['launch-context'],
        invocation_evidence:'operator-declared; independently confirm this command was launched by the consuming service',
        identity_match:[actual.name,actual.sid].some(v=>v?.toLowerCase()===options['expected-identity'].toLowerCase())};
      save();
      if(!report.service.identity_match) throw Error('Actual OS process identity differs from --expected-identity');
      scratch=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'chelm-reference-service-'));
      const settings=path.join(scratch,'settings.json');
      write(settings,{runtime:path.join(scratch,'runtime'),harness,python,git:'git'});
      const phase=run('service',process.execPath,[path.join(pkg,'tools/service-probe.mjs'),settings],180000);
      const result=read(path.join(destination,'service.stdout.log'));
      report.service.result=result;
      report.complete=phase.ok&&result.passed===true&&report.service.identity_match;
      report.limitations.push('This process probe does not verify IIS HTTPS/ARR or prove how the operator launched it.');
    }
    const finalHost=packageIdentity(pkg), finalHarness=verifyHarness({harness:{root:harness,node:process.execPath,python,git:'git'}});
    report.package_inputs_unchanged=JSON.stringify(finalHost)===JSON.stringify(report.host)&&finalHarness.compatibility.manifest_sha256===report.harness.manifest_sha256;
    if(!report.package_inputs_unchanged) throw Error('Package inputs changed during measurement');
  } catch(error) {
    report.complete=false;
    report.error={code:error.code??null,message:error.message};
  } finally {
    if(scratch)try{await fs.promises.rm(scratch,{recursive:true,force:true,maxRetries:10,retryDelay:200});}catch(e){report.cleanup_error=e.code;report.complete=false;}
    report.finished_at=new Date().toISOString();report.load_after=load();save();
    const files=[];
    const walk=(dir,rel='')=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,entry.name),key=rel+entry.name;if(entry.isDirectory())walk(p,key+'/');else files.push([key,sha(fs.readFileSync(p))]);}};
    walk(destination);write(path.join(destination,'SHA256.json'),Object.fromEntries(files.sort(([a],[b])=>a.localeCompare(b))));
  }
  return {report,destination};
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const {report,destination}=await collect(parseOptions(process.argv.slice(2)));
    process.stdout.write(JSON.stringify({complete:report.complete,context:report.context,unmet_targets:report.performance?.unmet_targets??[],report:path.join(destination,'report.json')})+'\n');
    // Target misses are measurements. Execution/incomplete evidence is a failure.
    process.exitCode=report.complete?0:1;
  } catch(error) {process.stderr.write(error.message+'\n');process.exitCode=1;}
}
