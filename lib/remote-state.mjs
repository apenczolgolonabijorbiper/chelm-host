import fs from 'node:fs';
import { file, read, write, now } from './util.mjs';
export const terminal = new Set(['committed', 'abandoned', 'cancelled', 'expired', 'failed']);
// An uncertain claim/publication must be reconciled explicitly, even after its
// deadline. Routing fallback cannot convert an unknown outcome into fresh work.
const uncertain = a => ['claiming','submitting','submitted'].includes(a.status) && !a.receipt;
export function assignments(root) {
  const dir = file(root, 'host/remote/work');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => /^[a-f0-9-]{36}$/.test(n))
    .flatMap((n) => {
      const p = file(dir, n + '/record.json');
      return fs.existsSync(p) ? [read(p)] : [];
    });
}
export function activeAssignments(root) {
  return assignments(root).filter(
    (a) => !terminal.has(a.status) && (uncertain(a) || Date.parse(a.expires_at) > Date.now())
  );
}
export function expireAssignments(root) {
  for (const a of assignments(root))
    if (!terminal.has(a.status) && !uncertain(a) && Date.parse(a.expires_at) <= Date.now()) {
      a.status = 'expired';
      a.updated_at = now();
      write(file(root, 'host/remote/work/' + a.work_id + '/record.json'), a);
    }
}
export const reservedIds = (root) =>
  new Set(activeAssignments(root).flatMap((a) => a.sources.map((s) => s.id)));
