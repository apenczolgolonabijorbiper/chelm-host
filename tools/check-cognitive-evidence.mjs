// Checks retained bytes/bindings/schema/provenance. Semantic verdicts remain separate.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const [root,harness]=process.argv.slice(2);
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const sha=p=>createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const {validateResult,validateLearning}=await import(pathToFileURL(path.resolve(harness,'server/cognitive-task.mjs')));
const review=read(path.join(root,'semantic-review.json'));
let count=0;
for(const row of review.cases){
  const dir=path.join(root,row.case_id),request=read(path.join(dir,'request.json')),response=read(path.join(dir,'response.json')),completion=read(path.join(dir,'completion.json'));
  assert.equal(sha(path.join(dir,'response.json')),completion.response_sha256);
  assert.equal(completion.response_sha256,row.response_sha256);
  assert.deepEqual(validateResult(response,request.work.task,request.receipt),[]);
  if(fs.existsSync(path.join(dir,'learning.json')))assert.deepEqual(validateLearning(read(path.join(dir,'learning.json')),request.work.task,request.receipt),[]);
  assert.equal(completion.receipt.status,'committed');assert.equal(completion.read_only_memory_preserved,true);
  assert.equal(completion.task.result.answer,response.answer);
  assert.deepEqual(completion.receipt.binding,response.binding);
  assert(row.reason&&['pass','fail'].includes(row.verdict));count++;
}
const manifest=read(path.join(root,'hashes.json'));
for(const [name,digest]of Object.entries(manifest.files))assert.equal(sha(path.join(root,name)),digest,name);
console.log(JSON.stringify({cases:count,integrity:'pass',semantic_review:'retained separately; not automatically verified'}));
