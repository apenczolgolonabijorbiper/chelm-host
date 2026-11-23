// Owner-side raw Git publication with a durable reconciliation record.
import fs from 'node:fs';
import { publish } from './read-model.mjs';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { currentOperation } from './telemetry.mjs';
import { file, read, write, atomic, hash, assert, git, snapshot } from './util.mjs';
export function reconcilePublication(root, cfg) {
  const marker = file(root, 'host/publication-pending.json');
  if (!fs.existsSync(marker)) return;
  const pending = read(marker),
    head = git(cfg.instance.path, ['rev-parse', 'HEAD']).trim();
  if (head === pending.old) {
    fs.rmSync(marker);
    return;
  }
  assert(head === pending.next, 'recovery_required', 'Publication HEAD advanced during recovery');
  const tree = snapshot(cfg.instance.path);
  for (const row of pending.writes) {
    const p = file(cfg.instance.path, row.path),
      actual = fs.existsSync(p) ? hash(fs.readFileSync(p)) : null;
    assert(
      actual === row.before || actual === row.after,
      'recovery_required',
      'Preserve edited publication file: ' + row.path
    );
  }
  // Refuse a third-party index edit rather than resetting it.
  const staged = new Map(
    git(cfg.instance.path, ['ls-files', '--stage', '-z'])
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/);
        return [m[4], { mode: m[1], sha: m[2], stage: m[3] }];
      })
  );
  for (const row of pending.writes) {
    const actual = staged.get(row.path);
    if (actual)
      assert(
        actual.stage === '0' &&
          [row.before_object, row.after_object]
            .filter(Boolean)
            .some((v) => v.sha === actual.sha && v.mode === actual.mode),
        'recovery_required',
        'Preserve edited publication index'
      );
    else
      assert(
        !row.before_object || !row.after_object,
        'recovery_required',
        'Preserve staged publication deletion'
      );
  }
  for (const row of pending.writes) {
    const p = file(cfg.instance.path, row.path);
    if (tree.has(row.path)) atomic(p, tree.get(row.path));
    else fs.rmSync(p, { force: true });
  }
  if (pending.writes.length)
    git(cfg.instance.path, ['reset', '-q', 'HEAD', '--', ...pending.writes.map((r) => r.path)]);
  if (pending.assignment) {
    const p = file(root, 'host/remote/work/' + pending.assignment.work_id + '/record.json'),
      a = read(p);
    a.status = 'committed';
    a.receipt = {
      work_id: a.work_id,
      status: 'committed',
      head: pending.next,
      candidate_digest: pending.assignment.candidate_digest
    };
    write(p, a);
  }
  // Keep the reconciliation marker until app projections are durable too. A
  // process killed after CAS or during view generation must not return a receipt
  // forever while leaving the consuming app on the old committed snapshot.
  publish(root, cfg, { deep: true });
  fs.rmSync(marker);
}
export function publishTree(root, cfg, expected, desired, assignment, hooks = {}) {
  const context = currentOperation(), started = context?.enabled ? performance.now() : null;
  const original = snapshot(cfg.instance.path, expected),
    paths = [...new Set([...original.keys(), ...desired.keys()])].filter(
      (p) => hash(original.get(p) ?? '') !== hash(desired.get(p) ?? '')
    );
  const staged = git(cfg.instance.path, ['diff', '--cached', '--name-only']).trim().split('\n');
  for (const p of paths) {
    const target = file(cfg.instance.path, p),
      actual = fs.existsSync(target) ? hash(fs.readFileSync(target)) : null;
    assert(
      actual === (original.has(p) ? hash(original.get(p)) : null) ||
        actual === (desired.has(p) ? hash(desired.get(p)) : null),
      'busy',
      'Preserve local draft before publication: ' + p
    );
    assert(!staged.includes(p), 'busy', 'Preserve staged change before publication: ' + p);
  }
  const index = file(root, 'host/remote/index-' + randomUUID()),
    env = { GIT_INDEX_FILE: index };
  const objects = file(root, 'host/remote/objects-' + randomUUID());
  const previousObjects = new Map(
    git(cfg.instance.path, ['ls-tree', '-r', '-z', expected])
      .split('\0')
      .filter(Boolean)
      .map((line) => {
        const m = line.match(/^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/);
        return [m[3], { mode: m[1], sha: m[2] }];
      })
  );
  const nextObjects = new Map();
  try {
    git(cfg.instance.path, ['read-tree', expected], { env });
    const added = paths.filter((p) => desired.has(p));
    materializeObjects();
    function materializeObjects() {
      for (const p of added) atomic(file(objects, p), desired.get(p));
    }
    const hashes = added.length
      ? git(cfg.instance.path, ['hash-object', '-w', '--no-filters', '--stdin-paths'], {
          input: added.map((p) => file(objects, p)).join('\n') + '\n'
        })
          .trim()
          .split('\n')
      : [];
    const rows = paths
      .map((p) => {
        if (!desired.has(p)) return `0 ${'0'.repeat(40)}\t${p}\0`;
        const object = {
          sha: hashes[added.indexOf(p)],
          mode: previousObjects.get(p)?.mode ?? '100644'
        };
        nextObjects.set(p, object);
        return `${object.mode} ${object.sha}\t${p}\0`;
      })
      .join('');
    if (rows) git(cfg.instance.path, ['update-index', '-z', '--index-info'], { env, input: rows });
    const tree = git(cfg.instance.path, ['write-tree'], { env }).trim();
    const next = git(
      cfg.instance.path,
      [
        '-c',
        'user.name=' + cfg.instance.git_identity.name,
        '-c',
        'user.email=' + cfg.instance.git_identity.email,
        'commit-tree',
        tree,
        '-p',
        expected
      ],
      { input: 'remote: ' + assignment.work_id + '\n' }
    ).trim();
    write(file(root, 'host/publication-pending.json'), {
      old: expected,
      next,
      assignment,
      writes: paths.map((p) => ({
        path: p,
        before: original.has(p) ? hash(original.get(p)) : null,
        after: desired.has(p) ? hash(desired.get(p)) : null,
        before_object: previousObjects.get(p) ?? null,
        after_object: nextObjects.get(p) ?? null
      }))
    });
    hooks.beforeCAS?.();
    git(cfg.instance.path, ['update-ref', 'HEAD', next, expected]);
    hooks.afterCAS?.();
    // Publication assembly/CAS only: post-CAS view regeneration is excluded.
    if (started !== null) context.metrics.mergePhase('publication', {calls:1, elapsed_ms:performance.now()-started});
    reconcilePublication(root, cfg);
    return next;
  } finally {
    fs.rmSync(index, { force: true });
    fs.rmSync(objects, { recursive: true, force: true });
  }
}
