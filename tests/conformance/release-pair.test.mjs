import test from '../scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {fixture,harness,source,ok} from '../helpers.mjs';
import {version,verifyHarness} from '../../lib/harness.mjs';
import {hash} from '../../lib/util.mjs';

test('release pair pins the published harness identity and exercises its new command surface',t=>{
 const compatibility=JSON.parse(fs.readFileSync(path.join(source,'compatibility.json'))),pin=compatibility.published_harness;
 assert.equal(pin.version,'0.13.0');assert.equal(version().package_version,'1.3.0');assert.equal(version().harness_supported,'=0.13.0');
 assert.equal(hash(fs.readFileSync(path.join(harness,'RELEASE.json'))),pin.manifest_sha256);
 assert.equal(verifyHarness({harness:{root:harness}}).manifest.version,pin.version);
 const f=fixture(t),result=spawnSync(process.execPath,[path.join(harness,'processor/memory-tool.mjs'),'validate','--root',f.instance,'--timings','true'],{encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);const value=JSON.parse(result.stdout);assert.equal(value.valid,true);assert.ok(value.timings.phases.schema.elapsed_ms>=0);
 assert.equal(ok('read','summary',f.root).view.harness_version,'0.13.0');
});

test('the coordinated host refuses unsupported versions and changed manifest identity',t=>{
 const base=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'chelm-release-pin-'));t.after(()=>fs.rmSync(base,{recursive:true,force:true,maxRetries:5,retryDelay:100}));
 const engine=path.join(base,'engine');fs.cpSync(harness,engine,{recursive:true});
 const manifestPath=path.join(engine,'RELEASE.json'),original=fs.readFileSync(manifestPath,'utf8'),manifest=JSON.parse(original);
 manifest.version='0.10.0';fs.writeFileSync(manifestPath,JSON.stringify(manifest));
 assert.throws(()=>verifyHarness({harness:{root:engine}}),{code:'harness_unsupported'});
 fs.writeFileSync(manifestPath,original+'\n');
 assert.throws(()=>verifyHarness({harness:{root:engine}}),{code:'package_invalid'});
});
