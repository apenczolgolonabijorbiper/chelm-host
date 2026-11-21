import fs from 'node:fs';
import { assignments, expireAssignments, terminal } from './remote-state.mjs';
import { file, read, write, assert, id, now } from './util.mjs';
export function remoteAdmin(root, command, input) {
  expireAssignments(root);
  if (command === 'list') return { work: assignments(root).map(({ artifacts, slots, ...a }) => a) };
  if (command === 'cancel') {
    const p = file(root, 'host/remote/work/' + id(input.work_id) + '/record.json'),
      a = read(p);
    assert(!terminal.has(a.status), 'work_inactive', 'Assignment is already terminal');
    a.status = 'cancelled';
    a.updated_at = now();
    write(p, a);
    return { work_id: a.work_id, status: a.status };
  }
  assert(command === 'prune', 'usage', 'Expected remote list|cancel|prune');
  let removed = 0;
  for (const a of assignments(root))
    if (terminal.has(a.status) && Date.now() - Date.parse(a.updated_at) > 7 * 24 * 3600000) {
      const dir = file(root, 'host/remote/work/' + a.work_id);
      for (const name of fs.readdirSync(dir))
        if (name !== 'record.json') fs.rmSync(file(dir, name), { recursive: true, force: true });
      removed++;
    }
  return { pruned: removed, retention_days: 7 };
}
