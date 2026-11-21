import fs from 'node:fs';
import {
  randomUUID
} from 'node:crypto';
import {
  file,
  read,
  write,
  atomic,
  assert,
  fail,
  hash,
  now,
  parseNote,
  id
} from './util.mjs';
import {
  index
} from './harness.mjs';
export const normalize = s => s.replaceAll('\r\n', '\n').trim();
export const contentKey = (kind, bodies) => hash(kind + '\u001f' + bodies.map(normalize).join('\u001f\n'));
export function chunks(lines, max = 3500, oversize = 'truncate') {
  assert(Array.isArray(lines) && lines.every(s => typeof s === 'string'), 'input_invalid',
    'Lines must be strings');
  assert(Number.isInteger(max) && max >= 8 && ['truncate', 'refuse'].includes(oversize), 'input_invalid',
    'Invalid chunking options');
  const result = [];
  let current = '';
  for (let line of lines) {
    line = line.replaceAll('\r\n', '\n');
    if (line.length > max) {
      if (oversize === 'refuse') fail('record_too_long', 'Input record exceeds chunk bound');
      line = line.slice(0, max - 4) + ' ...';
    }
    if (current && current.length + line.length + 1 > max) {
      result.push(current);
      current = '';
    }
    current += line + '\n';
  }
  if (current) result.push(current);
  return result;
}
const header = (key, value, quoted = false) => {
  assert(/^[a-z_]+$/.test(key) && typeof value === 'string' && !/[\r\n\x00]/.test(value), 'input_invalid',
    'Invalid source header');
  return key + ': ' + (quoted || /[#"{}\[\]]/.test(value) || value !== value.trim() ? JSON.stringify(
    value) : value);
};
export function note({
  observation_id,
  at,
  kind,
  subject,
  subjectHeader,
  chunk,
  extras = {},
  question
}) {
  const h = [header('id', observation_id), header('recorded_at', at), header('kind', kind)];
  if (subject !== undefined) h.push(header(subjectHeader, subject));
  h.push(header('chunk', chunk));
  const reserved = ['id', 'recorded_at', 'kind', 'chunk', subjectHeader, 'question_id', 'question_text',
    'question_source'
  ];
  for (const [k, v] of Object.entries(extras)) {
    assert(!reserved.includes(k), 'input_invalid', 'Reserved extra header: ' + k);
    h.push(header(k, String(v)));
  }
  if (question) {
    h.push(header('question_id', question.id), header('question_text', question.text, true), header(
      'question_source', question.source));
  }
  return '---\n' + h.join('\n') + '\n---\n\n';
}
export function submit(root, cfg, input, question) {
  assert(input && Array.isArray(input.groups) && input.groups.length > 0, 'input_invalid', 'Expected groups');
  assert(input.subject_id === undefined || typeof input.subject_id === 'string' && input.subject_id.length >
    0, 'input_invalid', 'Invalid subject');
  const registry = read(file(root, 'host/intake/registry.json'), {}),
    at = now(),
    plans = [],
    virtual = Object.assign(Object.create(null), structuredClone(registry));
  let skipped_groups = 0;
  for (const group of input.groups) {
    assert(typeof group.kind === 'string' && group.kind.trim() && !/[\r\n]/.test(group.kind), 'input_invalid',
      'Invalid kind');
    assert((group.chunks === undefined) !== (group.lines === undefined), 'input_invalid',
      'Exactly one of chunks or lines is required');
    const max = group.max_chars ?? cfg.intake.max_observation_chars;
    const oversize = group.oversize ?? cfg.intake.oversize;
    assert(Number.isInteger(max) && max >= 8 && ['truncate', 'refuse'].includes(oversize),
      'input_invalid', 'Invalid chunking options');
    const bodies = group.chunks === undefined ? chunks(group.lines, max, oversize) : (() => {
      assert(Array.isArray(group.chunks) && group.chunks.every(s => typeof s === 'string'),
        'input_invalid', 'Chunks must be strings');
      return group.chunks.map(body => {
        body = body.replaceAll('\r\n', '\n');
        if (body.length <= max) return body;
        if (oversize === 'refuse') fail('record_too_long', 'Input chunk exceeds chunk bound');
        return body.slice(0, max - 4) + ' ...';
      });
    })();
    assert(Array.isArray(bodies) && bodies.length > 0 && bodies.every(s => typeof s === 'string' && normalize(
      s)), 'input_invalid', 'Empty or invalid chunks');
    const key = contentKey(group.kind, bodies),
      subject = input.subject_id,
      records = virtual[subject ?? ''] ?? [];
    if (group.receipt) {
      assert(['namespace', 'record', 'revision'].every(k => typeof group.receipt[k] === 'string' && group
        .receipt[k].length), 'input_invalid', 'Invalid producer receipt');
      const receiptKey = JSON.stringify(['namespace', 'record', 'revision'].map(k => group.receipt[k])),
        prior = Object.values(virtual).flat().find(g => g.receipt && JSON.stringify(['namespace', 'record',
          'revision'
        ].map(k => g.receipt[k])) === receiptKey);
      if (prior) {
        assert(prior.content_key === key, 'receipt_conflict', 'Retained revision has different content');
        plans.push({
          kind: group.kind,
          content_key: key,
          status: 'skipped',
          observation_ids: prior.ids
        });
        skipped_groups++;
        continue;
      }
    }
    const duplicate = subject !== undefined && records.find(g => g.key === group.kind + ':' + key && !g
      .orphaned);
    if (duplicate) {
      plans.push({
        kind: group.kind,
        content_key: key,
        status: 'skipped',
        observation_ids: duplicate.ids
      });
      skipped_groups++;
      continue;
    }
    const ids = bodies.map(() => randomUUID()),
      notes = bodies.map((body, i) => ({
        id: ids[i],
        bytes: note({
          observation_id: ids[i],
          at,
          kind: group.kind,
          subject,
          subjectHeader: cfg.intake.subject_header,
          chunk: `${i+1}/${bodies.length}`,
          extras: group.extra_headers,
          question
        }) + normalize(body) + '\n'
      }));
    plans.push({
      kind: group.kind,
      content_key: key,
      status: 'written',
      observation_ids: ids,
      notes
    });
    if (subject !== undefined || group.receipt) {
      virtual[subject ?? ''] ??= [];
      virtual[subject ?? ''].push({
        key: group.kind + ':' + key,
        kind: group.kind,
        content_key: key,
        ids,
        created_at: at,
        ...(group.receipt ? {
          receipt: group.receipt
        } : {})
      });
    }
  }
  const newCount = plans.flatMap(p => p.notes ?? []).length,
    summary = read(file(root, 'host/read-model/summary.json'), {}),
    limit = summary.capacity?.sources?.limit;
  if (limit) assert(fs.readdirSync(file(cfg.instance.path, 'inbox')).filter(n => n.endsWith('.md')).length +
    newCount <= limit, 'capacity_exceeded', 'Source capacity would be exceeded');
  const written = [];
  try {
    for (const p of plans)
      for (const n of p.notes ?? []) {
        const target = file(cfg.instance.path, `inbox/${n.id}.md`);
        atomic(target, n.bytes);
        written.push(n.id);
      }
    const indexed = written.length && input.index !== false ? index(cfg, cfg.instance.path) : 0;
    write(file(root, 'host/intake/registry.json'), virtual);
    return {
      written: written.length,
      skipped_groups,
      indexed,
      groups: plans.map(({
        notes,
        ...p
      }) => p)
    };
  } catch (e) {
    for (const observation of written) {
      fs.rmSync(file(cfg.instance.path, `inbox/${observation}.md`), {
        force: true
      });
      fs.rmSync(file(cfg.instance.path, `evidence/${observation}.json`), {
        force: true
      });
    }
    throw e;
  }
}
export function importSources(root, cfg, input) {
  assert(input && Array.isArray(input.observations), 'malformed_sources', 'Expected observations');
  const seen = new Set();
  for (const o of input.observations) {
    id(o.id);
    assert(!seen.has(o.id), 'malformed_sources', 'Duplicate source ID');
    seen.add(o.id);
    const source = parseNote(`inbox/${o.id}.md`, o.inbox);
    assert(source.id === o.id, 'malformed_sources', 'Note ID mismatch');
    const target = file(cfg.instance.path, `inbox/${o.id}.md`);
    if (fs.existsSync(target)) assert(hash(fs.readFileSync(target)) === hash(o.inbox), 'malformed_sources',
      'Existing note bytes differ');
    if (o.evidence) assert(o.evidence.id === o.id && o.evidence.sha256 === hash(o.inbox), 'malformed_sources',
      'Evidence does not match note');
  }
  assert(input.registry_groups === undefined || Array.isArray(input.registry_groups) && input.registry_groups
    .every(g => Array.isArray(g.ids) && g.ids.every(v => typeof v === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v))), 'malformed_sources',
    'Invalid registry groups');
  let added = 0,
    present = 0,
    evidence_added = 0,
    index_error = null;
  const unresolved_question_links = [],
    questions = read(file(root, 'host/read-model/questions.json'), {
      data: []
    }).data;
  for (const o of input.observations) {
    const p = file(cfg.instance.path, `inbox/${o.id}.md`);
    if (fs.existsSync(p)) present++;
    else {
      atomic(p, o.inbox);
      added++;
    }
    const e = file(cfg.instance.path, `evidence/${o.id}.json`);
    if (o.evidence && !fs.existsSync(e)) {
      write(e, o.evidence);
      evidence_added++;
    }
    const source = parseNote(`inbox/${o.id}.md`, o.inbox);
    if (source.kind === 'question_answer' && !questions.some(q => q.id === source.question_id))
      unresolved_question_links.push({
        observation_id: o.id,
        question_id: source.question_id
      });
  }
  if (added) try {
    index(cfg, cfg.instance.path);
  } catch (e) {
    index_error = e.message;
  }
  if (input.subject_id) {
    const registry = Object.assign(Object.create(null), read(file(root, 'host/intake/registry.json')));
    const records = input.replace_registry ? [] : registry[input.subject_id] ?? [];
    for (const group of input.registry_groups ?? [])
      if (!records.some(g => g.key === group.key && JSON.stringify(g.ids) === JSON.stringify(group.ids)))
        records.push(group);
    registry[input.subject_id] = records;
    write(file(root, 'host/intake/registry.json'), registry);
  }
  const processed = new Set(read(file(root, 'host/read-model/observations.json'), {
    data: []
  }).data.filter(o => o.state === 'processed').map(o => o.id));
  return {
    added,
    present,
    evidence_added,
    pending: input.observations.filter(o => !processed.has(o.id)).length,
    index_error,
    unresolved_question_links
  };
}
