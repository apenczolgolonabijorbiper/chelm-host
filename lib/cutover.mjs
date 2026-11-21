import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { file, read, write, assert, lock } from './util.mjs';
export async function cutover(root, { apply = false, cancel_legacy = false } = {}) {
  return lock(root, 'remote-worker cutover', async () => {
    const marker = file(root, 'host/cutover-pending.json');
    let raw = read(file(root, 'chelm.runtime.json'));
    if (fs.existsSync(marker)) {
      const pending = read(marker);
      if (!apply) return { changed: false, recovery_required: true, archive: pending.archive };
      raw = pending.next;
      write(file(root, 'chelm.runtime.json'), raw);
      fs.rmSync(file(root, 'host/delegation'), { recursive: true, force: true });
      fs.rmSync(marker);
      return { changed: true, recovered: true, archive: pending.archive };
    }
    if (!raw.delegation) return { changed: false, migration_required: false };
    const instance = path.resolve(root, raw.instance.path),
      lease = read(file(instance, 'memory/processing-lock.json'));
    assert(
      lease.status !== 'processing',
      'busy',
      'Drain/release old processing lease with Chelm 0.2 before cutover'
    );
    assert(
      !fs.existsSync(file(root, 'host/adoption-pending.json')) &&
        !fs.existsSync(path.join(instance, '.git/golem-adapter-pending.json')),
      'recovery_required',
      'Resolve legacy publication recovery using Chelm 0.2 first'
    );
    const packages = read(file(root, 'host/delegation/packages.json'), []),
      unsettled = packages.filter((p) => !['adopted', 'cancelled'].includes(p.status));
    if (!apply)
      return {
        changed: false,
        migration_required: true,
        unsettled: unsettled.map((p) => ({ package_id: p.package_id, status: p.status })),
        actions: [
          'Finish old returned work using Chelm 0.2, or apply with --cancel-legacy to archive and requeue sources.'
        ]
      };
    assert(
      !unsettled.length || cancel_legacy,
      'legacy_work_pending',
      'Settle old packages or explicitly use --cancel-legacy'
    );
    const archive = file(root, 'archive/worker-v1-' + randomUUID());
    fs.mkdirSync(archive, { recursive: true });
    write(file(archive, 'chelm.runtime.json'), raw);
    if (fs.existsSync(file(root, 'host/delegation')))
      fs.cpSync(file(root, 'host/delegation'), file(archive, 'delegation'), {
        recursive: true,
        dereference: false
      });
    const next = { ...raw };
    delete next.delegation;
    next.remote = { max_active_work: 1, assignment_minutes: 30, max_lifetime_minutes: 480 };
    next.schema_version = 2;
    write(marker, { archive, next });
    write(file(root, 'chelm.runtime.json'), next);
    fs.rmSync(file(root, 'host/delegation'), { recursive: true, force: true });
    fs.rmSync(marker);
    return { changed: true, archive, cancelled: unsettled.map((p) => p.package_id) };
  });
}
