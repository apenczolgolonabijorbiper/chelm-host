import fs from 'node:fs';
import path from 'node:path';
import {config} from './runtime.mjs';
import {verifyHarness} from './harness.mjs';
import {backend} from './worker.mjs';
import {activeAssignments} from './remote-state.mjs';
import {instanceDrafts} from './instance-operational.mjs';
import {file,read,write,assert,git,now} from './util.mjs';

// Caller holds the host operation lock. Knowledge and Git history are untouched.
export async function upgradeHarness(root,cfg,{harness,apply=false}={}) {
  assert(harness,'usage','Specify --harness for the approved target package');
  const before=verifyHarness(cfg).compatibility;
  const next={...cfg,harness:{...cfg.harness,root:path.resolve(harness)}};
  const after=verifyHarness(next).compatibility;
  const status=await backend(cfg).status();
  assert(status.lease.status!=='processing'&&!status.recovery_required&&activeAssignments(root).length===0&&
    !fs.existsSync(file(root,'host/publication-pending.json')),'busy','Drain leases, assignments and recovery before Harness upgrade');
  assert(instanceDrafts(cfg.instance.path).length===0,'busy','Settle instance drafts before Harness upgrade');
  const checked=await backend(next).validate({});
  assert(checked.ok,'validation_failed','Target Harness cannot reopen this runtime');
  const result={status:apply?'upgraded':'ready',before,after,knowledge_rewritten:false,
    checkpoint_compatibility:'Existing checkpoints require the original exact package; create a new checkpoint after upgrade'};
  if(apply) {
    const raw=read(file(root,'chelm.runtime.json'));
    write(file(root,'host/logs/harness-upgrade-'+Date.now()+'.json'),{at:now(),...result});
    write(file(root,'chelm.runtime.json'),{...raw,harness:{...raw.harness,root:next.harness.root}});
    config(root);
  }
  return result;
}
