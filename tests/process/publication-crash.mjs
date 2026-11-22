import { config } from '../../lib/runtime.mjs';
import { snapshot, git } from '../../lib/util.mjs';
import { publishTree } from '../../lib/publication.mjs';
const [root, workId, checkpoint] = process.argv.slice(2), cfg = config(root);
const tree = snapshot(cfg.instance.path);
tree.set('memory/index.md', Buffer.from('# Process crash recovery fixture\n'));
publishTree(root, cfg, git(cfg.instance.path, ['rev-parse', 'HEAD']).trim(), tree,
  { work_id: workId, candidate_digest: 'a'.repeat(64) },
  { [checkpoint]() { process.kill(process.pid, 'SIGKILL'); } });
