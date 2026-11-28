import test from './scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseOptions, summarizePerformance, collect} from '../tools/reference-acceptance.mjs';

const row=n=>({elapsed_ms:n+100,excluded_ms:100,nfr_ms:n,retrieval_ms:10});
function evidence() {
  return {latency:{node_process_start_ms:[40,45,50],commands:Object.fromEntries(['submit','ask','status'].map(k=>[k,{samples:[row(100),row(200),row(300)]}]))},
    capacity:{fixture:{subjects:10000,conversation_turns:100000,exact_64_mib_accepted:true,over_64_mib_refused:true},samples:[1,2,3].map(()=>({regeneration_ms:1000,deep_refresh_ms:6000,validator_ms:2000,statistics_ms:2000,tail_100000_ms:1}))},
    builds:[{suite_seconds:100},{suite_seconds:110}]};
}
const summarize=e=>summarizePerformance(e.latency,e.capacity,e.builds,3,2);

test('Reference evidence retains target misses, partial attempts and raw retrieval/exclusion boundaries',()=>{
  const e=evidence();
  assert.equal(summarize(e).measurements_complete,true);
  e.capacity.samples[1].regeneration_ms=3000; // strict under-3-second target
  e.latency.commands.ask.samples[2]=row(3500);
  e.builds[0].suite_seconds=601;
  const result=summarize(e);
  assert.equal(result.measurements_complete,true);
  assert.deepEqual(result.unmet_targets,['ask','Capacity regeneration','Full staged build and suites (includes setup)']);
  assert.deepEqual(result.checks.find(c=>c.name==='ask').samples_ms,[100,200,3500]);
  // A fast subset or a missing phase cannot be promoted into full acceptance.
  e.builds[0]=null;
  e.latency.commands.submit.samples.pop();
  assert.equal(summarize(e).measurements_complete,false);
  assert.equal(summarize(e).checks.find(c=>c.name.startsWith('Full staged')).state,'incomplete');
  e.latency.commands.status.samples[0].excluded_ms=10000;
  assert.equal(summarize(e).checks.find(c=>c.name==='status').state,'incomplete');
  e.capacity.fixture.over_64_mib_refused=false;
  assert.equal(summarize(e).checks.find(c=>c.requirement==='NFR-5').state,'incomplete');
  e.latency.node_process_start_ms=[NaN,40,50];
  assert.equal(summarize(e).checks[0].state,'incomplete');
  assert.equal(summarizePerformance(null,null,[],3,2).measurements_complete,false);
});

test('Reference CLI refuses ambiguous contexts, duplicate flags and unbounded/missing inputs',()=>{
  const args=['performance','--harness','h','--output','o','--context','local','--machine-label','development','--load-note','idle'];
  assert.equal(parseOptions(args).samples,5);
  assert.throws(()=>parseOptions([...args,'--runtime','production']));
  assert.throws(()=>parseOptions([...args,'--output','other']));
  assert.throws(()=>parseOptions([...args,'--samples','21']));
  assert.throws(()=>parseOptions([...args,'--samples','2','--samples','3']));
  assert.throws(()=>parseOptions([...args,'--suite-repeat','0']));
  assert.throws(()=>parseOptions(args.slice(0,-1)));
  const reference=args.map(v=>v==='local'?'reference-workstation':v);
  assert.throws(()=>parseOptions(reference,'linux'));
  assert.equal(parseOptions(reference,'win32').context,'reference-workstation');
  assert.throws(()=>parseOptions([...reference,'--samples','1'],'win32'),/at least three/);
  const service=[...args];service[0]='service';
  assert.throws(()=>parseOptions(service));
  assert.equal(parseOptions([...service,'--expected-identity','IIS APPPOOL\\Consumer','--launch-context','launched by consumer worker'],'win32').command,'service');
});

test('Reference collection preserves failed reports and checksums; refuses reuse and package-local writes',async t=>{
  const base=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'chelm-reference-test-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true,maxRetries:10,retryDelay:100}));
  const harness=path.join(base,'invalid-harness');fs.mkdirSync(harness);
  const output=path.join(base,'evidence');
  const options=parseOptions(['performance','--harness',harness,'--output',output,'--context','local','--machine-label','synthetic validation','--load-note','not acceptance']);
  const {report}=await collect(options);
  assert.equal(report.complete,false);
  assert.ok(report.error);
  assert.deepEqual(report.phases,[]);
  const files=JSON.parse(fs.readFileSync(path.join(output,'SHA256.json')));
  assert.equal(files['report.json'],createHash('sha256').update(fs.readFileSync(path.join(output,'report.json'))).digest('hex'));
  const retained=fs.readFileSync(path.join(output,'report.json'));
  await assert.rejects(collect(options),{code:'EEXIST'});
  assert.deepEqual(fs.readFileSync(path.join(output,'report.json')),retained);
  await assert.rejects(collect({...options,output:path.join(harness,'evidence')}),/outside both packages/);
  assert.equal(fs.existsSync(path.join(harness,'evidence')),false);
  await assert.rejects(collect({...options,output:path.join(harness,'new-parent','nested','evidence')}),/outside both packages/);
  assert.equal(fs.existsSync(path.join(harness,'new-parent')),false);
});
