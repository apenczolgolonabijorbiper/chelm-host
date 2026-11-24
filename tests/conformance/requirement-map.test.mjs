import test from '../scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { source } from '../helpers.mjs';
test('TST-1: every declared requirement has an evidence path and an explicit scope classification', () => {
  const design = fs.readFileSync(path.join(source, 'docs/CHELM_HOST_DESIGN.md'), 'utf8');
  const declared = [...design.matchAll(/^- `([A-Z]+-\d+)`|^\| (PAR-\d+) \|/gm)].map(m => m[1] ?? m[2]);
  const { requirements } = JSON.parse(fs.readFileSync(path.join(source, 'docs/requirement-coverage.json')));
  assert.equal(new Set(requirements.map(r => r.id)).size, requirements.length);
  assert.deepEqual(requirements.map(r => r.id).sort(), declared.sort());
  for (const r of requirements) {
    assert(['behavioral', 'external', 'superseded', 'out-of-scope'].includes(r.status));
    assert(r.scope.length > 20, r.id); assert(r.evidence.length, r.id);
    for (const p of r.evidence) assert(fs.existsSync(path.join(source, p)), r.id + ': ' + p);
  }
  for (const r of requirements.filter(r => r.id.startsWith('DST-'))) assert.equal(r.status, 'superseded');
});
