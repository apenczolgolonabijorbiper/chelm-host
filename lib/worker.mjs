import fs from 'node:fs';
import os from 'node:os';
import {
  createAdapter
} from './backend.mjs';
import {
  file,
  read,
  write,
  atomic,
  assert,
  fail,
  id,
  actor,
  snapshot,
  relative,
  now,
  hash
} from './util.mjs';
import {
  ensureHarness
} from './harness.mjs';
import {
  view
} from './read-model.mjs';
import {
  propose
} from './requests.mjs';
export const backend = cfg => {
  ensureHarness(cfg);
  return createAdapter({
    instance: cfg.instance.path,
    harness: cfg.harness.root,
    node: cfg.harness.node,
    git: cfg.harness.git
  });
};
export function executor(input) {
  const e = input.executor;
  assert(e && typeof e.id === 'string' && ['agent', 'scripted', 'other'].includes(e.kind) && typeof e
    .model === 'string' && typeof e.host === 'string', 'input_invalid',
    'Executor {id,kind,model,host} is required');
  return e;
}
export function backendError(e) {
  const m = e.message;
  let code = /profile changed/i.test(m) ? 'policy_changed' : /Head changed/i.test(m) ? 'head_moved' :
    /Candidate validation|validation failed/i.test(m) ? 'validation_failed' : /source changed/i.test(m) ?
    'source_changed' : /lease is held/i.test(m) ? 'lease_held' : /own an unexpired/i.test(m) ?
    'lease_not_owned' : /Output path|Unsafe/i.test(m) ? 'bad_outputs' : /guidance_version/i.test(m) ?
    'guidance_missing' : /ENOENT/i.test(m) ? 'output_missing' : /operation is running/i.test(m) ? 'busy' :
    'backend_refused';
  fail(code, m);
}

function ownership(root, run) {
  id(run);
  const owners = read(file(root, 'host/workers.json'));
  assert(owners[run] && owners[run].actor === actor() && owners[run].host === os.hostname(),
    'lease_not_owned', 'Caller does not own this work unit');
  return owners[run];
}
export function restore(root, cfg, run, outputs = []) {
  const tree = snapshot(cfg.instance.path),
    protocol = ['memory/graph.json', 'memory/index.md', 'memory/hypotheses.json', 'questions/queue.json',
      'questions/queue.md'
    ],
    known = read(file(root, 'host/workers.json'))[run];
  const paths = new Set([...protocol, ...(known?.outputs ?? []), ...outputs, `memory/runs/${run}.md`]);
  for (const source of known?.sources ?? []) {
    const p = `memory/events/chat/${source.id}.json`;
    if (!known.existing_events?.includes(p)) paths.add(p);
  }
  for (const p of paths) {
    relative(p);
    assert(protocol.includes(p) || p === `memory/runs/${run}.md` || /^memory\/(events|runs)\//.test(p),
      'bad_outputs', 'Cannot restore a reserved output');
    if (tree.has(p)) atomic(file(cfg.instance.path, p), tree.get(p));
    else fs.rmSync(file(cfg.instance.path, p), {
      force: true
    });
  }
}
export async function worker(root, cfg, command, input) {
  executor(input);
  const adapter = backend(cfg);
  if (command === 'next') {
    const max = input.max ?? 20;
    assert(Number.isInteger(max) && max >= 1 && max <= 20, 'input_invalid', 'max must be 1..20');
    const inv = await adapter.status();
    assert(!inv.recovery_required, 'recovery_required',
      'Resolve adapter publication recovery before processing');
    let available = inv.ready;
    const observations = view(root, 'observations').data;
    if (input.subject_id) available = available.filter(s => observations.find(o => o.id === s.id)
      ?.subject_id === input.subject_id);
    if (input.kinds) {
      assert(Array.isArray(input.kinds), 'input_invalid', 'kinds must be an array');
      available = available.filter(s => input.kinds.includes(s.kind));
    }
    const packages = read(file(root, 'host/delegation/packages.json'));
    const reserved = new Set(packages.filter(p => !['adopted', 'cancelled'].includes(p.status) && Date
      .parse(p.expires_at) > Date.now()).flatMap(p => p.observation_ids));
    available = available.filter(s => !reserved.has(s.id)).slice(0, max);
    if (!available.length) return {
      status: 'no-work'
    };
    let claimed;
    try {
      claimed = await adapter.claim({
        max,
        ids: available.map(s => s.id)
      });
    } catch (e) {
      backendError(e);
    }
    if (claimed.status === 'no-work') return claimed;
    const owners = read(file(root, 'host/workers.json')),
      tree = snapshot(cfg.instance.path);
    owners[claimed.run_id] = {
      actor: actor(),
      host: os.hostname(),
      executor: input.executor,
      claimed_at: now(),
      sources: claimed.sources,
      outputs: [],
      existing_events: [...tree.keys()].filter(p => p.startsWith('memory/events/'))
    };
    write(file(root, 'host/workers.json'), owners);
    const summary = view(root, 'summary');
    return {
      status: 'claimed',
      work_unit: {
        run_id: claimed.run_id,
        claimed_at: owners[claimed.run_id].claimed_at,
        expires_at: claimed.expires_at,
        workspace_abs: cfg.instance.path,
        sources: claimed.sources.map(s => ({
          ...s,
          subject_id: observations.find(o => o.id === s.id)?.subject_id ?? null
        })),
        protocol: ['AGENTS.md', 'docs/PROCESSING.md', 'docs/ANALYSIS_WORKFLOW.md', 'docs/MEMORY_MODEL.md']
          .map(p => file(cfg.harness.root, p)).concat(file(cfg.instance.path, summary.layout.purpose_path)),
        ...(claimed.guidance ? {
          guidance: {
            text: claimed.guidance,
            boundary: claimed.guidance_boundary,
            version: claimed.guidance_version,
            guidance_identity: claimed.guidance_identity,
            snapshot_path: claimed.guidance_path
          }
        } : {}),
        journal_path: `memory/runs/${claimed.run_id}.md`,
        output_rules: {
          allowed: ['memory/graph.json', 'memory/index.md', 'memory/hypotheses.json',
            'questions/queue.json', 'questions/queue.md', 'memory/runs/*', 'memory/events/**'
          ],
          forbidden: ['inbox', 'profiles', 'instance', 'golem.config.json', 'vendor',
            'memory/processed.json', 'memory/processing-lock.json'
          ],
          journal_model: input.executor.model
        },
        warnings: view(root, 'warnings').data,
        warning_summary: summary.warning_summary,
        capacity: summary.capacity
      }
    };
  }
  if (command === 'propose') return propose(root, cfg, input);
  const owner = ownership(root, input.run_id);
  assert(owner.executor.id === input.executor.id, 'lease_not_owned',
  'Executor does not own this work unit');
  const outputs = input.outputs ?? [];
  assert(Array.isArray(outputs) && outputs.every(p => typeof p === 'string'), 'input_invalid',
    'outputs must be paths');
  for (const p of outputs) {
    relative(p);
    assert(['memory/graph.json', 'memory/index.md', 'memory/hypotheses.json', 'questions/queue.json',
      'questions/queue.md'
    ].includes(p) || /^memory\/(runs|events)\//.test(p), 'bad_outputs', 'Output path is reserved');
  }
  if (command === 'abandon') {
    restore(root, cfg, input.run_id, outputs);
    try {
      return await adapter['release-error']({
        run: input.run_id
      });
    } catch (e) {
      backendError(e);
    }
  }
  if (command === 'renew') {
    try {
      return await adapter.renew({
        run: input.run_id
      });
    } catch (e) {
      backendError(e);
    }
  }
  assert(['validate', 'submit'].includes(command), 'command_unknown', 'Unknown worker command');
  const owners = read(file(root, 'host/workers.json'));
  owners[input.run_id].outputs = outputs;
  write(file(root, 'host/workers.json'), owners);
  if (command === 'submit' && input.requests) {
    for (const r of input.requests) {
      assert(cfg.requests.kinds.includes(r.kind) && typeof r.subject_id === 'string' && typeof r.reason ===
        'string', 'input_invalid', 'Invalid completion request');
    }
  }
  try {
    const result = await adapter[command === 'submit' ? 'commit' : 'validate']({
      run: input.run_id,
      outputs
    });
    if (command === 'submit') {
      const requests = (input.requests ?? []).map(r => propose(root, cfg, r));
      return {
        ...result,
        requests
      };
    }
    return result;
  } catch (e) {
    if (command === 'submit' && /profile changed/i.test(e.message)) {
      try {
        await adapter['release-error']({
          run: input.run_id
        });
      } catch {}
      fail('policy_changed',
        'Committed policy changed; reclaim sources and review drafts under the new guidance', {
          observation_ids: owner.sources.map(s => s.id)
        });
    }
    if (command === 'submit' && /Candidate validation|source changed|Source changed/i.test(e.message)) {
      restore(root, cfg, input.run_id, outputs);
      try {
        await adapter['release-error']({
          run: input.run_id
        });
      } catch {}
    }
    backendError(e);
  }
}
