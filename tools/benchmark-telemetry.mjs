// Synthetic acceptance measurements, not a production latency guarantee.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {execute} from '../lib/app.mjs';
import {readSummary, recordRead, percentile} from '../lib/telemetry.mjs';

const args = process.argv.slice(2);
const option = name => args[args.indexOf(name)+1];
const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const memory = () => ({rss_bytes:process.memoryUsage().rss, heap_used_bytes:process.memoryUsage().heapUsed,
  peak_rss_bytes:process.resourceUsage().maxRSS*1024});
const sizes = dir => {
  let files=0, bytes=0;
  if (fs.existsSync(dir)) for (const item of fs.readdirSync(dir,{withFileTypes:true})) {
    const p=path.join(dir,item.name);
    if (item.isDirectory()) {const nested=sizes(p);files+=nested.files;bytes+=nested.bytes;}
    else {files++;bytes+=fs.statSync(p).size;}
  }
  return {files,bytes};
};

if (args.includes('--scenario')) {
  const count=Number(option('--scenario')), samples=count===10000?1:1000;
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'chelm-telemetry-scale-'));
  try {
    const dir=path.join(root,'host/metrics/read-shards');fs.mkdirSync(dir,{recursive:true});
    const at=Date.now();
    for(let i=0;i<count;i++)fs.writeFileSync(path.join(dir,`00000000-0000-4000-8000-${String(i).padStart(12,'0')}.json`),
      JSON.stringify({updated_ms:at,views:{'read summary':{calls:samples,errors:0,
        samples:Array.from({length:samples},(_,j)=>({at:at-j,id:`sample-${i}-${j}`,ms:j%50}))}}}));
    global.gc?.();const before=memory(), elapsed=[];
    let summary;
    for(let i=0;i<3;i++){const t=performance.now();summary=readSummary(root);elapsed.push(performance.now()-t);}
    const after=memory(),t=performance.now();recordRead(root,'read summary',3,false);
    const materialize_ms=performance.now()-t;
    const final=readSummary(root);
    console.log(JSON.stringify({shards:count,samples_per_shard:samples,aggregation_ms:elapsed,
      materialize_or_cap_refusal_ms:materialize_ms,calls_before:summary.calls,calls_after:final.calls,
      complete:final.complete,window_samples:final.views['read summary'].window_samples,
      metrics_disk:sizes(path.join(root,'host/metrics')),memory_before:before,memory_after:after,
      memory_after_materialization:memory(),heap_delta_bytes:after.heap_used_bytes-before.heap_used_bytes}));
  } finally {fs.rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
} else {
  if(!args.includes('--harness')||!args.includes('--output'))throw Error('Use --harness PATH --output FILE');
  const base=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'chelm-telemetry-benchmark-'));
  try {
    const root=path.join(base,'runtime');
    const init=spawnSync(process.execPath,[path.join(source,'bin/chelm.mjs'),'init','--runtime',root,
      '--harness',path.resolve(option('--harness')),'--python',process.env.GOLEM_PYTHON??(process.platform==='win32'?'py':'python3')],{encoding:'utf8'});
    if(init.status!==0)throw Error(init.stdout+init.stderr);
    const config=path.join(root,'chelm.runtime.json'), cfg=JSON.parse(fs.readFileSync(config)),reads=[];
    // Warm both code paths, then alternate order to avoid a one-way warm-up bias.
    for(let round=0;round<4;round++)for(const enabled of (round%2?[true,false]:[false,true])){
      cfg.observability={read_metrics:enabled,operation_phases:false};fs.writeFileSync(config,JSON.stringify(cfg));
      await execute('read','summary',{runtime:root});
      const durations=[];
      for(let i=0;i<25;i++){const start=performance.now();await execute('read','summary',{runtime:root});durations.push(performance.now()-start);}
      reads.push({enabled,durations_ms:durations});
    }
    const summarize=enabled=>{const values=reads.filter(r=>r.enabled===enabled).flatMap(r=>r.durations_ms);
      return {samples:values.length,p50_ms:percentile(values,.5),p95_ms:percentile(values,.95),total_ms:values.reduce((a,b)=>a+b,0)};};
    const off=summarize(false), on=summarize(true),scale=[];
    for(const count of [1,16,128,10000]){
      const r=spawnSync(process.execPath,['--expose-gc',fileURLToPath(import.meta.url),'--scenario',String(count)],{encoding:'utf8',timeout:180000});
      if(r.status!==0)throw Error(r.stdout+r.stderr);scale.push(JSON.parse(r.stdout));
    }
    const report={schema_version:1,recorded_at:new Date().toISOString(),environment:{platform:process.platform,
      os:os.release(),node:process.version,arch:process.arch,cpu:os.cpus()[0]?.model},
      method:'Synthetic empty-summary app reads, 100 per mode in alternating warmed rounds; excludes CLI startup. Scale cases use isolated --expose-gc processes, one view, 3 aggregations, persisted synthetic shards. RSS/heap are process observations, not universal bounds. 10,000-shard case is sparse (one sample per shard), not the fully populated cap.',
      reads:{off,on,added_p50_ms:on.p50_ms-off.p50_ms,raw_rounds:reads},scale,
      limits:{retention_days:7,shard_cap:10000,samples_per_view_per_shard:1000,
        max_read_shard_bytes:8*1024*1024},
      qualification:'No inference or consumer/reference-workstation measurement; no hard latency threshold. Full-window 10,000-shard peak memory is not certified. Original Windows RM-6 target miss remains separately tracked.'};
    const output=path.resolve(option('--output'));fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify({output,reads:{off,on,added_p50_ms:report.reads.added_p50_ms},scale}));
  } finally {fs.rmSync(base,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
}
