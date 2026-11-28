import test from './scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const python=process.env.GOLEM_PYTHON ?? (process.platform==='win32'?'py':'python3');
test('Test shards cover every file once, retain every repeat and propagate a failed attempt', t=>{
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'chelm-policy-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  fs.mkdirSync(path.join(base,'tools'));fs.mkdirSync(path.join(base,'tests'));
  for(const name of ['run-tests.mjs','owned-process.mjs','owned-process.py'])
    fs.copyFileSync(path.join(root,'tools',name),path.join(base,'tools',name));
  for(let i=0;i<8;i++)fs.writeFileSync(path.join(base,'tests',`case-${i}.test.mjs`),
    `import {test} from 'node:test';test('case ${i}',()=>{});`);
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  function run(...args){return spawnSync(process.execPath,[path.join(base,'tools/run-tests.mjs'),
    '--report',path.join(base,'reports'),...args],{env,encoding:'utf8',timeout:30000});}
  const covered=[];
  for(let index=1;index<=4;index++){
    const label='shard-'+index,r=run('--shard',`${index}/4`,'--repeat','3','--label',label);
    assert.equal(r.status,0,r.stderr+r.stdout);
    const report=JSON.parse(fs.readFileSync(path.join(base,'reports',`tests-${label}-${process.platform}.json`)));
    assert.equal(report.test_files.length,2);assert.equal(report.attempts.length,3);
    assert(report.attempts.every(a=>a.exit===0&&a.counts.pass===2&&a.counts.skipped===0));
    covered.push(...report.test_files);
  }
  assert.equal(new Set(covered).size,8);
  for(const invalid of ['0/4','5/4','1/99','1/0','1.5/4']) assert.notEqual(run('--shard',invalid).status,0);
  assert.notEqual(run('--shard','1/4','--file','tests/case-0.test.mjs').status,0);
  // Fail only the first requested attempt. Later passes must not mask it.
  fs.writeFileSync(path.join(base,'tests/case-0.test.mjs'),
    `import {test} from 'node:test';import fs from 'node:fs';
    const marker=${JSON.stringify(path.join(base,'marker'))};
    test('one retained failure',()=>{if(!fs.existsSync(marker)){fs.writeFileSync(marker,'');throw Error('injected');}});`);
  const failed=run('--shard','1/4','--repeat','3','--label','failure');
  assert.equal(failed.status,1);
  const report=JSON.parse(fs.readFileSync(path.join(base,'reports',`tests-failure-${process.platform}.json`)));
  assert.equal(report.attempts.length,3);
  assert.equal(report.attempts[0].counts.fail,1);
  assert.equal(report.attempts[1].counts.fail,0);
  assert.equal(report.attempts[2].counts.fail,0);
});

test('Windows coverage gate rejects missing, overlapping, mixed-package and masked-failure evidence',()=>{
  const result=spawnSync(python,['-B',path.join(root,'tools/test-windows-reliability.py')],
    {encoding:'utf8',timeout:30000});
  assert.equal(result.status,0,result.stderr+result.stdout);
});
