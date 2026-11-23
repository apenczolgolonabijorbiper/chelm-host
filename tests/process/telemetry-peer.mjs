// Deterministic crash/race injection in a separate process, without production hooks.
import fs from 'node:fs';
import path from 'node:path';
import {recordRead} from '../../lib/telemetry.mjs';
const [root, mode, marker, gate] = process.argv.slice(2);
const rename = fs.renameSync;
let intercepted = false;
fs.renameSync = function (from, to) {
  if (mode === 'crash-before-shard' && to.includes('read-shards')) {
    fs.writeFileSync(marker + '.before', 'ready');
    const until = Date.now() + 20000;
    while (Date.now() < until)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    throw Error('parent did not kill the shard writer');
  }
  if (intercepted || to !== path.join(root, 'host/metrics/reads.json'))
    return rename(from, to);
  intercepted = true;
  fs.writeFileSync(marker + '.before', 'ready');
  const until = Date.now() + 20000;
  while (!fs.existsSync(gate)) {
    if (Date.now() > until) throw Error('telemetry test gate timed out');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  const result = rename(from, to);
  if (mode === 'crash-after') {
    fs.writeFileSync(marker + '.after', 'renamed');
    while (Date.now() < until)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    throw Error('parent did not kill the injected publisher');
  }
  return result;
};
recordRead(root, 'read summary', 7, false);
