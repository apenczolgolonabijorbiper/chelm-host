import fs from 'node:fs';
import { remoteCall } from '../../lib/remote.mjs';
const [root, argsPath, checkpoint] = process.argv.slice(2);
await remoteCall(root, 'worker-b', 'chelm_submit_candidate', JSON.parse(fs.readFileSync(argsPath)), {
  [checkpoint]() { process.kill(process.pid, 'SIGKILL'); }
});
