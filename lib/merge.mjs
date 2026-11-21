import {
  fail
} from './util.mjs';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const union = (a, b) => [...new Map([...a, ...b].map(v => [JSON.stringify(v), v])).values()];
export function keyed(base = [], local = [], remote = [], collection = 'records') {
  const b = new Map(base.map(r => [r.id, r])),
    l = new Map(local.map(r => [r.id, r])),
    r = new Map(remote.map(r => [r.id, r])),
    result = [],
    conflicts = [];
  for (const id of new Set([...b.keys(), ...l.keys(), ...r.keys()])) {
    const before = b.get(id),
      left = l.get(id),
      right = r.get(id);
    if (before && (!left || !right)) {
      conflicts.push({
        collection,
        id,
        reason: 'removed'
      });
      continue;
    }
    if (before && collection === 'claims') {
      for (const item of [left, right]) {
        const {
          status,
          ...old
        } = before, {
          status: _,
          ...next
        } = item;
        if (!same(old, next)) conflicts.push({
          collection,
          id,
          reason: 'immutable claim changed'
        });
      }
    }
    if (same(left, right)) {
      if (left) result.push(left);
      continue;
    }
    if (same(before, left)) {
      if (right) result.push(right);
      continue;
    }
    if (same(before, right)) {
      if (left) result.push(left);
      continue;
    }
    if (collection === 'entities' && before && left && right) {
      const strip = e => {
        const {
          source_ids,
          external_ids,
          ...rest
        } = e;
        return rest;
      };
      if (same(strip(before), strip(left)) && same(strip(before), strip(right)) && [left, right].every(e => (
          before.source_ids ?? []).every(v => (e.source_ids ?? []).includes(v)) && (before.external_ids ??
        []).every(v => (e.external_ids ?? []).some(x => same(x, v))))) {
        result.push({
          ...left,
          source_ids: union(left.source_ids ?? [], right.source_ids ?? []),
          ...((left.external_ids || right.external_ids) ? {
            external_ids: union(left.external_ids ?? [], right.external_ids ?? [])
          } : {})
        });
        continue;
      }
    }
    conflicts.push({
      collection,
      id,
      reason: 'both changed'
    });
  }
  if (conflicts.length) fail('merge_conflict', 'Records changed incompatibly', {
    conflicts
  });
  return result;
}
export function mergeGraph(base, local, remote) {
  return {
    ...local,
    updated_at: [local.updated_at, remote.updated_at].sort().at(-1),
    sources: keyed(base.sources, local.sources, remote.sources, 'sources'),
    entities: keyed(base.entities, local.entities, remote.entities, 'entities'),
    claims: keyed(base.claims, local.claims, remote.claims, 'claims')
  };
}
