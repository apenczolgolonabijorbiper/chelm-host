import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {file,id,read,write,atomic,assert,hash,json,git,materialize,now} from './util.mjs';
export const CHUNK_BYTES = 32768,
  MAX_BYTES = 64 * 1024 * 1024;

export const recordPath = (root, work) => file(root, 'host/remote/work/' + id(work) + '/record.json');
export const workDir = (root, work) => file(root, 'host/remote/work/' + id(work));
export const save = (root, a) => {
  a.updated_at = now();
  write(recordPath(root, a.work_id), a);
};

export function setupRepository(cfg, dir, tree) {
  materialize(tree, dir);
  git(dir, ['init', '-q']);
  // Capture raw bytes, never run checkout/add filters from instance attributes.
  const paths = [...tree.keys()];
  const hashes = git(dir, ['hash-object', '-w', '--no-filters', '--stdin-paths'], {
    input: paths.map((p) => file(dir, p)).join('\n') + '\n'
  })
    .trim()
    .split('\n');
  git(dir, ['update-index', '-z', '--index-info'], {
    input: paths.map((p, i) => `100644 ${hashes[i]}\t${p}\0`).join('')
  });
  const captured = git(dir, ['write-tree']).trim();
  const commit = git(
    dir,
    ['-c', 'user.name=chelm-host', '-c', 'user.email=chelm-host@local', 'commit-tree', captured],
    { input: 'remote immutable base\n' }
  ).trim();
  git(dir, ['symbolic-ref', 'HEAD', 'refs/heads/main']);
  git(dir, ['update-ref', 'HEAD', commit]);
}

export function addArtifact(a, dir, p, bytes, role) {
  const artifact_id = randomUUID();
  atomic(file(dir, 'artifacts/' + artifact_id), bytes);
  a.artifacts.push({ artifact_id, path: p, role, size_bytes: bytes.length, sha256: hash(bytes) });
}

export function stage(root, a, args) {
  const slot = a.slots.find((s) => s.slot_id === args.slot_id);
  assert(slot, 'bad_outputs', 'Unknown output slot');
  assert(
    Number.isInteger(args.revision) && args.revision >= 1 && args.revision <= 100,
    'input_invalid',
    'Output revision must be 1..100'
  );
  assert(
    typeof args.text === 'string' && args.text.isWellFormed(),
    'input_invalid',
    'Output must be well-formed Unicode'
  );
  const b = Buffer.from(args.text),
    offset = args.offset ?? 0;
  assert(
    b.length > 0 && b.length <= CHUNK_BYTES && Number.isInteger(offset) && offset >= 0,
    'input_invalid',
    'Invalid chunk offset or size'
  );
  const dir = workDir(root, a.work_id),
    key = slot.slot_id + '/' + args.revision,
    target = file(dir, 'uploads/' + key),
    meta = read(target + '.json', {}),
    old = fs.existsSync(target) ? fs.readFileSync(target) : Buffer.alloc(0);
  if (offset < old.length) {
    assert(
      offset + b.length <= old.length && old.subarray(offset, offset + b.length).equals(b),
      'upload_conflict',
      'Conflicting retry bytes'
    );
    assert(
      !args.final || (offset + b.length === old.length && meta.complete),
      'upload_conflict',
      'Final flag differs from stored revision'
    );
    return {
      size_bytes: old.length,
      next_offset: old.length,
      complete: !!meta.complete,
      sha256: meta.sha256,
      revision: args.revision
    };
  }
  assert(
    !meta.complete && offset === old.length && old.length + b.length <= (a.output_max_bytes ?? MAX_BYTES),
    'upload_conflict',
    'Missing, complete or overlapping output bytes'
  );
  const quota = file(dir, 'upload-index.json'),
    entries = read(quota, {});
  entries[key] = old.length + b.length;
  assert(
    Object.values(entries).reduce((n, v) => n + v, 0) <= (a.output_max_bytes ?? MAX_BYTES),
    'capacity_exceeded',
    'Upload storage quota exceeded'
  );
  const next = Buffer.concat([old, b]),
    complete = !!args.final,
    sha256 = complete ? hash(next) : undefined;
  write(quota, entries);
  atomic(target, next);
  write(target + '.json', { complete, sha256 });
  a.status = 'staging';
  save(root, a);
  return {
    size_bytes: next.length,
    next_offset: next.length,
    complete,
    sha256,
    revision: args.revision
  };
}
export function candidate(root, a, args) {
  assert(
    Array.isArray(args.outputs) && args.outputs.length > 0 && args.outputs.length <= a.slots.length,
    'bad_outputs',
    'Expected declared output slots'
  );
  const digestPattern = /^[a-f0-9]{64}$/;
  const seen = new Set(),
    entries = args.outputs
      .map((o) => {
        const slot = a.slots.find((s) => s.slot_id === o.slot_id);
        assert(
          slot &&
            !seen.has(o.slot_id) &&
            Number.isInteger(o.revision) &&
            o.revision >= 1 &&
            o.revision <= 100,
          'bad_outputs',
          'Invalid or duplicate output slot'
        );
        seen.add(o.slot_id);
        const target = file(workDir(root, a.work_id), 'uploads/' + slot.slot_id + '/' + o.revision),
          meta = read(target + '.json');
        assert(
          meta.complete && digestPattern.test(meta.sha256),
          'digest_mismatch',
          'Output revision is incomplete'
        );
        const bytes = fs.readFileSync(target);
        assert(hash(bytes) === meta.sha256, 'digest_mismatch', 'Incomplete or altered output');
        return { ...o, sha256: meta.sha256, path: slot.path, bytes };
      })
      .sort((x, y) => x.path.localeCompare(y.path));
  assert(
    a.slots.filter((s) => s.required).every((s) => seen.has(s.slot_id)),
    'journal_missing',
    'Upload the assignment journal'
  );
  const digest = hash(json(entries.map(({ bytes, ...e }) => e)));
  assert(
    !args.candidate_digest || args.candidate_digest === digest,
    'digest_mismatch',
    'Candidate manifest digest differs'
  );
  return { entries, digest };
}
