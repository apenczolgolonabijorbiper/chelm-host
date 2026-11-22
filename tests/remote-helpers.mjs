import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { executor } from './helpers.mjs';
import { remoteCall } from '../lib/remote.mjs';
import { hash } from '../lib/util.mjs';

export const call =
  (f, principal = 'worker-b') =>
  (name, args = {}) =>
    remoteCall(f.root, principal, name, args);
export const workArgs = (w) => ({ work_id: w.work_id, attempt: w.attempt });
export async function artifacts(run, w) {
  const values = {};
  for (const a of w.artifacts) {
    let text = '',
      offset = 0;
    for (;;) {
      const r = await run('chelm_read_artifact', {
        ...workArgs(w),
        artifact_id: a.artifact_id,
        offset
      });
      text += r.text;
      if (r.next_offset === null) break;
      offset = r.next_offset;
    }
    assert.equal(hash(text), a.sha256);
    values[a.path] = text;
  }
  return values;
}
export async function prepare(run, w, { bad = false, externalValue } = {}) {
  const values = await artifacts(run, w),
    changes = {};
  if (w.kind === 'analysis') {
    const graph = JSON.parse(values['memory/graph.json']);
    graph.updated_at = new Date().toISOString();
    if (externalValue)
      graph.entities[0].external_ids = [
        { scheme: 'test', namespace: 'remote', value: externalValue }
      ];
    for (const s of w.sources) {
      const p = w.artifacts.find((a) => a.artifact_id === s.artifact_id).path,
        body = values[p].split('\n---\n')[1].trim(),
        entity = 'ent-' + s.id;
      graph.sources.push({ id: s.id, path: p, sha256: s.sha256, recorded_at: s.recorded_at });
      graph.entities.push({
        id: entity,
        type: 'other',
        kind: 'record',
        label: 'Synthetic ' + s.id,
        aliases: [],
        source_ids: [s.id],
        uncertainty: [],
        created_at: graph.updated_at
      });
      graph.claims.push({
        id: 'clm-' + s.id,
        subject_id: entity,
        attributed_to_id: entity,
        predicate: 'describes',
        object: { value: 'Synthetic' },
        classification: 'source_assertion',
        sources: [{ observation_id: s.id, quote: bad ? 'absent quote' : body }],
        asserted_at: s.recorded_at,
        valid_time: { from: null, to: null, expression: null, precision: 'unknown' },
        status: 'active',
        supersedes: [],
        uncertainty: [],
        created_at: graph.updated_at
      });
    }
    changes['memory/graph.json'] = JSON.stringify(graph, null, 2) + '\n';
  } else {
    changes['memory/index.md'] =
      '# Reviewed combined memory\nAll merged source-grounded declarations reviewed.\n';
    changes['questions/queue.md'] = values['questions/queue.md'];
  }
  const journal = w.output_slots.find(
    (s) => s.path.startsWith('memory/runs/') && s.path.endsWith('.md')
  );
  changes[journal.path] =
    `# Synthetic remote journal\nStarted: ${w.claimed_at}\nModel: ${executor.model}\nguidance_version: ${w.guidance_identity}\nSources: ${w.sources.map((s) => s.id).join(', ')}\nWarnings reviewed. No language model used. Unresolved alternatives: none. Verification: harness.\n`;
  const outputs = [];
  for (const [p, text] of Object.entries(changes)) {
    const slot = w.output_slots.find((s) => s.path === p);
    assert(slot);
    const revision = bad ? 1 : 2,
      args = { ...workArgs(w), slot_id: slot.slot_id, revision, offset: 0, text, final: true };
    await run('chelm_stage_output', args);
    await run('chelm_stage_output', args);
    outputs.push({ slot_id: slot.slot_id, revision });
  }
  return { ...workArgs(w), outputs };
}
export async function finish(run, w) {
  const c = await prepare(run, w),
    v = await run('chelm_validate_candidate', c);
  return run('chelm_submit_candidate', {
    ...c,
    candidate_digest: v.candidate_digest,
    submission_id: randomUUID()
  });
}

