import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  fileURLToPath
} from 'node:url';
import {
  spawnSync
} from 'node:child_process';
import assert from 'node:assert/strict';
export const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const harness = process.env.CHELM_HARNESS_ROOT ?? path.resolve(source, '../harness-release');
export const executor = {
  id: 'synthetic-test',
  kind: 'scripted',
  model: 'none (fixed synthetic rules)',
  host: os.hostname()
};
export function invoke(command, sub, root, input, options = {}) {
  const args = [path.join(source, 'bin/chelm.mjs'), command, ...(sub ? [sub] : []), '--runtime', root];
  if (input !== undefined) args.push('--input', '-');
  for (const [k, v] of Object.entries(options)) {
    args.push('--' + k);
    if (v !== true) args.push(String(v));
  }
  const r = spawnSync(process.execPath, args, {
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: 'utf8',
    timeout: 180000
  });
  assert(!r.error, r.error?.message);
  let value;
  try {
    value = JSON.parse(r.stdout);
  } catch {
    throw Error(r.stderr + '\n' + r.stdout);
  }
  return {
    ...value,
    exit: r.status
  };
}
export function ok(...args) {
  const r = invoke(...args);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.exit, 0);
  return r;
}
export function refuse(code, ...args) {
  const r = invoke(...args);
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.error.code, code, JSON.stringify(r));
  return r;
}
export function fixture(t, {
  profile = false
} = {}) {
  const base = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'chelm-test-')),
    root = path.join(base, 'runtime');
  t.after(() => fs.rmSync(base, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100
  }));
  ok('init', null, root, undefined, {
    harness
  });
  const instance = path.join(root, 'instance');
  const read = p => JSON.parse(fs.readFileSync(path.join(instance, p)));
  const text = p => fs.readFileSync(path.join(instance, p), 'utf8');
  const write = (p, v) => {
    const target = path.join(instance, p);
    fs.mkdirSync(path.dirname(target), {
      recursive: true
    });
    fs.writeFileSync(target, typeof v === 'string' ? v : JSON.stringify(v, null, 2) + '\n');
  };
  if (profile) ok('profile', 'set', root, {
    purpose: 'Keep synthetic declarations.',
    profile: {
      core: 'Read the full source. Never merge by label.',
      vocabulary: {
        schema_version: 2,
        kinds: ['record'],
        predicates: ['describes']
      }
    }
  });
  const submit = (subject = 'S-1', body = 'Zażółć gęślą jaźń. Synthetic record.') => {
    const r = ok('submit', null, root, {
      subject_id: subject,
      groups: [{
        kind: 'record',
        lines: [body]
      }]
    });
    for (const id of r.groups[0].observation_ids) {
      write(`inbox/${id}.md`, text(`inbox/${id}.md`).replace(/^recorded_at: .*$/m, 'recorded_at: ' +
        new Date(Date.now() - 120000).toISOString()));
      fs.rmSync(path.join(instance, `evidence/${id}.json`), {
        force: true
      });
    }
    ok('index', null, root);
    return r.groups[0].observation_ids;
  };
  return {
    root,
    base,
    instance,
    read,
    text,
    write,
    submit
  };
}
export function analyze(f, unit, {
  bad = false
} = {}) {
  const graph = f.read('memory/graph.json');
  graph.updated_at = new Date().toISOString();
  for (const s of unit.sources) {
    const body = f.text(s.path).split('\n---\n').slice(1).join('\n---\n').trim();
    graph.sources.push({
      id: s.id,
      path: s.path,
      sha256: s.sha256,
      recorded_at: s.recorded_at
    });
    const ent = 'ent-' + s.id;
    graph.entities.push({
      id: ent,
      type: 'other',
      kind: 'record',
      label: 'Synthetic record',
      aliases: [],
      source_ids: [s.id],
      uncertainty: [],
      created_at: graph.updated_at
    });
    graph.claims.push({
      id: 'clm-' + s.id,
      subject_id: ent,
      attributed_to_id: ent,
      predicate: 'describes',
      object: {
        value: 'Synthetic'
      },
      classification: 'source_assertion',
      sources: [{
        observation_id: s.id,
        quote: bad ? 'This quote is absent' : body
      }],
      asserted_at: s.recorded_at,
      valid_time: {
        from: null,
        to: null,
        expression: null,
        precision: 'unknown'
      },
      status: 'active',
      supersedes: [],
      uncertainty: [],
      created_at: graph.updated_at
    });
  }
  f.write('memory/graph.json', graph);
  f.write(unit.journal_path,
    `# Synthetic cycle\nStarted: ${unit.claimed_at}\nSources reviewed. No language model used. Warnings reviewed: none.\nUnresolved alternatives: none.\nVerification: harness candidate validation.\n` +
    (unit.guidance ? 'guidance_version: ' + (unit.guidance.guidance_identity ?? unit.guidance_identity) + '\n' : ''));
}
export function git(root, ...args) {
  const r = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8'
  });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
