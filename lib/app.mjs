import fs from 'node:fs';
import path from 'node:path';
import {
  read,
  write,
  file,
  atomic,
  assert,
  fail,
  git,
  now,
  tail,
  uuid,
  id,
  snapshot,
  lock,
  child,
  safeAbs
} from './util.mjs';
import {
  version,
  verify,
  packageRoot,
  harness,
  committedHarness,
  index
} from './harness.mjs';
import {
  config,
  initialize,
  adopt,
  compatible,
  hostInit,
  commitAll,
  setProfile
} from './runtime.mjs';
import {
  submit,
  importSources
} from './intake.mjs';
import {
  view,
  publish,
  inspect,
  leaseState,
  views
} from './read-model.mjs';
import {
  worker,
  backend
} from './worker.mjs';
import {
  setRequest
} from './requests.mjs';
import {
  delegate,
  remoteWorker,
  reconcileAdoption
} from './delegation.mjs';

function contextOptions(input) {
  const allowed = ['query', 'entity', 'source', 'limit', 'predicate', 'type', 'kind', 'status', 'hops',
    'expansion_budget', 'current', 'valid_at', 'external_id'
  ];
  for (const k of Object.keys(input)) assert(allowed.includes(k) || k === 'executor', 'input_invalid',
    'Unknown retrieval option: ' + k);
  for (const [k, min, max] of [
      ['limit', 1, 100],
      ['hops', 1, 3],
      ['expansion_budget', 1, 20000]
    ])
    if (input[k] !== undefined) assert(Number.isInteger(input[k]) && input[k] >= min && input[k] <= max,
      'input_invalid', 'Retrieval bound: ' + k);
  if (input.current !== undefined) assert(typeof input.current === 'boolean', 'input_invalid',
    'current must be boolean');
  if (input.status !== undefined) assert(['active', 'all'].includes(input.status), 'input_invalid',
    'Invalid status');
  const out = {};
  for (const k of allowed)
    if (input[k] !== undefined && k !== 'external_id') out[k] = input[k];
  if (input.external_id) {
    assert(['value', 'scheme', 'namespace'].every(k => typeof input.external_id[k] === 'string' && input
      .external_id[k]), 'input_invalid', 'Scoped external ID requires value, scheme, namespace');
    out.external_id = input.external_id.value;
    out.scheme = input.external_id.scheme;
    out.namespace = input.external_id.namespace;
  }
  return out;
}
export async function execute(command, sub, options = {}, input = {}) {
  if (command === 'version') return version();
  if (command === 'verify') {
    let cfg;
    if (options.runtime) cfg = config(options.runtime);
    else {
      assert(options.harness, 'usage', 'verify requires --harness or --runtime', {}, 2);
      cfg = {
        harness: {
          root: safeAbs(options.harness),
          node: process.execPath,
          python: options.python ?? (process.platform === 'win32' ? 'py' : 'python3'),
          git: 'git'
        }
      };
    }
    const result = verify(cfg);
    if (result.problems.length) fail('verification_failed', 'Package, harness or tool verification failed',
      result);
    return result;
  }
  const root = safeAbs(options.runtime ?? '');
  assert(options.runtime, 'usage', '--runtime is required', {}, 2);
  if (command === 'init' || command === 'adopt') {
    const result = command === 'init' ? initialize(root, options) : await adopt(root, options);
    const cfg = config(root);
    publish(root, cfg, {
      deep: true
    });
    return result;
  }
  const cfg = config(root);
  assert(fs.existsSync(cfg.instance.path), 'instance_missing', 'Instance does not exist');
  const published = view(root, 'summary');
  assert(published.layout?.purpose_path === 'instance/purpose.md' && published.layout?.hypotheses_path ===
    'memory/hypotheses.json', 'instance_incompatible', 'Published instance uses an incompatible layout');
  const pure = command === 'read' && !options.deep || ['status', 'conversation', 'subject', 'requests']
    .includes(command) && sub !== 'set' || command === 'worker' && sub === 'context';
  if (command === 'read' && !options.deep) return {
    view: view(root, sub)
  };
  if (command === 'status') {
    const summary = view(root, 'summary'),
      lease = summary.lease.state === 'held' && Date.parse(summary.lease.expires_at) <= Date.now() ? {
        ...summary.lease,
        state: 'expired'
      } : summary.lease;
    const operation = fs.existsSync(file(root, 'host/locks/operation.lock')),
      recovery = fs.existsSync(file(root, 'host/adoption-pending.json')) || fs.existsSync(path.join(cfg
        .instance.path, '.git/golem-adapter-pending.json'));
    return {
      runtime_id: cfg.runtime_id,
      label: cfg.label,
      sandbox: cfg.sandbox,
      instance_path_abs: cfg.instance.path,
      exists: true,
      layout: summary.layout,
      head: summary.head,
      harness_version: summary.harness_version,
      lease,
      counts: {
        inbox: summary.inbox,
        ready: summary.ready,
        waiting_for_age: summary.waiting_for_age,
        malformed: summary.malformed.length,
        processed: summary.processed
      },
      recovery_required: recovery,
      backend: summary.backend,
      profile: summary.profile,
      busy: lease.state === 'held' || operation,
      busy_reasons: [...(lease.state === 'held' ? ['lease'] : []), ...(operation ? ['operation'] : [])],
      read_model: {
        generated_at: summary.generated_at,
        head: summary.head
      }
    };
  }
  if (command === 'conversation') {
    const turns = tail(file(root, 'host/conversation/turns.jsonl'), cfg.conversation.tail),
      ids = new Set(turns.map(t => t.observation_id)),
      answers = Object.fromEntries(Object.entries(view(root, 'answers').data).filter(([id]) => ids.has(
        id))),
      questions = view(root, 'questions').data;
    return {
      messages: turns,
      answers,
      open_questions: questions.filter(q => q.status === 'open').map(q => ({
        id: q.id,
        text: q.text
      })),
      questions
    };
  }
  if (command === 'subject') {
    const subject = sub,
      subjects = view(root, 'subjects').data;
    assert(subjects[subject], 'subject_unknown', 'Subject has no intake records');
    if (options.rows || options._rest?.includes('rows')) {
      const kinds = options.kinds?.split(','),
        filter = options.filter ?? 'all';
      assert(['all', 'indexed', 'analyzed'].includes(filter), 'input_invalid', 'Invalid subject filter');
      return {
        rows: view(root, 'observations').data.filter(o => o.subject_id === subject && (!kinds || kinds
          .includes(o.kind)) && (filter === 'all' || filter === 'indexed' && o.evidence || filter ===
          'analyzed' && o.state === 'processed')).map(o => ({
          observation_id: o.id,
          kind: o.kind,
          sent_at: o.recorded_at,
          evidence: o.evidence,
          analyzed: o.state === 'processed'
        }))
      };
    }
    return subjects[subject];
  }
  if (command === 'requests' && sub === 'list') return {
    requests: view(root, 'requests').data.filter(r => (!options.subject || r.subject_id === options
      .subject) && (!options.status || r.status === options.status))
  };
  if (command === 'context' || command === 'worker' && sub === 'context') return committedHarness(cfg, cfg
    .instance.path, 'context', contextOptions(input));
  if (command === 'inspect') return inspect(root, cfg, sub, options.subject);
  if (command === 'get') {
    const value = options._rest?.[0] ?? input.id;
    const tree = snapshot(cfg.instance.path);
    if (sub === 'item') {
      assert(/^(clm|ent)-[a-f0-9-]{36}$/.test(value) && uuid.test(value.slice(4)), 'invalid_id',
        'Invalid graph item ID');
      const g = JSON.parse(tree.get('memory/graph.json')),
        item = [...g.entities, ...g.claims].find(r => r.id === value);
      assert(item, 'item_unknown', 'Graph item not found');
      return {
        item
      };
    }
    if (sub === 'journal') {
      assert(value?.endsWith('.md'), 'invalid_id', 'Expected UUID.md');
      id(value.slice(0, -3));
      const b = tree.get('memory/runs/' + value);
      assert(b, 'journal_unknown', 'Journal not found');
      return {
        text: b.toString().slice(0, 20000)
      };
    }
    if (sub === 'observation') {
      id(value);
      const p = file(cfg.instance.path, `inbox/${value}.md`);
      assert(fs.existsSync(p), 'observation_unknown', 'Observation not found');
      const event = tree.get(`memory/events/chat/${value}.json`),
        evidence = file(cfg.instance.path, `evidence/${value}.json`);
      return {
        id: value,
        inbox: fs.readFileSync(p, 'utf8').slice(0, 60000),
        evidence: fs.existsSync(evidence) ? fs.readFileSync(evidence, 'utf8').slice(0, 60000) : null,
        chat_event: event?.toString().slice(0, 60000) ?? null,
        analyzed: JSON.parse(tree.get('memory/processed.json')).observations.some(r => r.id === value),
        group: options.subject ? view(root, 'subjects').data[options.subject]?.groups.find(g => g.ids
          .includes(value)) ?? null : null
      };
    }
    fail('usage', 'Unknown get subcommand', {}, 2);
  }
  if (command === 'export-sources') {
    const groups = view(root, 'subjects').data[options.subject]?.groups;
    assert(groups, 'subject_unknown', 'Subject has no intake records');
    const ids = [...new Set(groups.flatMap(g => g.ids))],
      observations = [];
    let missing_notes = 0,
      analysed = 0;
    const processed = new Set(view(root, 'observations').data.filter(o => o.state === 'processed').map(o =>
      o.id));
    for (const observation of ids) {
      id(observation);
      const p = file(cfg.instance.path, `inbox/${observation}.md`);
      if (!fs.existsSync(p)) {
        missing_notes++;
        continue;
      }
      observations.push({
        id: observation,
        inbox: fs.readFileSync(p, 'utf8'),
        evidence: read(file(cfg.instance.path, `evidence/${observation}.json`), null)
      });
      if (processed.has(observation)) analysed++;
    }
    return {
      subject_id: options.subject,
      registry_groups: groups,
      observations,
      observation_count: observations.length,
      missing_notes,
      analysed
    };
  }
  if (command === 'admin-stats') {
    const summary = view(root, 'summary'),
      commits = git(cfg.instance.path, ['log', '--format=%H %s']).trim().split('\n'),
      baseline = commits.find(s => s.slice(41).startsWith('init:'))?.slice(0, 40),
      names = baseline ? git(cfg.instance.path, ['diff', '--name-only', baseline, 'HEAD']).trim().split(
        '\n').filter(Boolean) : [...snapshot(cfg.instance.path).keys()];
    let latest = null;
    for (const p of names) {
      const target = file(cfg.instance.path, p);
      if (fs.existsSync(target)) {
        const at = fs.statSync(target).mtime.toISOString();
        if (!latest || at > latest) latest = at;
      }
    }
    return {
      rows: Object.entries({
        observations_sent: summary.inbox,
        observations_processed: summary.processed,
        sources: summary.totals.sources,
        entities: summary.totals.entities,
        claims: summary.totals.claims,
        questions: view(root, 'questions').data.length,
        evidence_files: summary.evidence,
        subjects: Object.keys(view(root, 'subjects').data).length,
        conversation_messages: summary.conversation_messages,
        instance_commits: baseline ? commits.findIndex(s => s.startsWith(baseline)) : commits.length
      }).map(([label, value]) => ({
        label,
        value
      })),
      files: names,
      latest
    };
  }
  return lock(root, [command, sub].filter(Boolean).join(' '), async () => {
    try {
      reconcileAdoption(root, cfg);
      await backend(cfg).reconcile();
      let result, deep = false;
      const held = () => view(root, 'summary').lease.state === 'held' && Date.parse(view(root,
        'summary').lease.expires_at) > Date.now();
      if (['reset', 'profile', 'migrate'].includes(command)) assert(!held(), 'busy',
        'Administrative changes are refused while a lease is held');
      if (command === 'submit') result = submit(root, cfg, input);
      else if (command === 'index') result = {
        indexed: index(cfg, cfg.instance.path)
      };
      else if (['ask', 'answer'].includes(command)) {
        assert(typeof input.text === 'string' && input.text.trim(), 'message_empty',
          'Message is empty');
        assert(input.text.length <= cfg.intake.max_message_chars, 'message_too_long',
          'Message exceeds the configured limit');
        let question;
        if (command === 'answer') {
          const q = view(root, 'questions').data.find(q => q.id === input.question_id && q.status ===
            'open');
          assert(q, 'question_not_open', 'Question is not open');
          question = {
            id: q.id,
            text: q.text,
            source: cfg.intake.question_source
          };
        }
        const sent = submit(root, cfg, {
            groups: [{
              kind: question ? 'question_answer' : 'user_question',
              chunks: [input.text]
            }]
          }, question),
          observation_id = sent.groups[0].observation_ids[0],
          matches = [];
        let mode = question ? 'queued' : 'pending';
        if (!question) {
          const context = committedHarness(cfg, cfg.instance.path, 'context', {
            ...contextOptions(input.retrieval ?? {}),
            query: input.text,
            limit: 5
          });
          for (const c of context.claims ?? []) {
            const quote = c.sources?.[0]?.quote ?? '',
              match = matches.find(m => m.classification === c.classification && m.quote === quote);
            if (match) {
              if (!match.predicates.includes(c.predicate)) match.predicates.push(c.predicate);
            } else matches.push({
              classification: c.classification,
              predicates: [c.predicate],
              quote
            });
          }
          if (matches.length) mode = 'retrieval';
        }
        matches.splice(3);
        const text = mode === 'retrieval' ?
          `Retrieval, not analysis: ${matches.length} matching claim(s) in analyzed memory.\n` +
          matches.map(m => `- [${m.classification}] ${m.predicates.join(', ')}: ${m.quote}`).join(
            '\n') : mode === 'queued' ?
          `Queued as answer to ${input.question_id} (observation ${observation_id}). The analysis cycle will review it; the answer appears here when analysis writes it.` :
          `No analyzed memory matches this yet. Your message is queued as observation ${observation_id} for the next analysis cycle (${sent.indexed} indexed).`;
        const at = now(),
          turns = [{
            at,
            role: 'user',
            text: input.text,
            observation_id,
            question_id: input.question_id ?? ''
          }, {
            at,
            role: 'golem',
            text,
            observation_id,
            mode,
            matches
          }];
        fs.appendFileSync(file(root, 'host/conversation/turns.jsonl'), turns.map(t => JSON.stringify(
          t)).join('\n') + '\n');
        result = {
          mode,
          observation_id,
          indexed: sent.indexed,
          matches,
          text
        };
      } else if (command === 'import-sources') {
        result = importSources(root, cfg, input);
        deep = true;
      } else if (command === 'refresh') {
        result = {};
        deep = true;
      } else if (command === 'read' && sub === 'summary' && options.deep) {
        const validation = committedHarness(cfg, cfg.instance.path, 'validate'),
          stats = committedHarness(cfg, cfg.instance.path, 'stats');
        result = {
          view: view(root, 'summary'),
          validate: {
            ok: validation.valid,
            message: 'Valid committed memory',
            layout: validation.layout,
            warning_summary: validation.warning_summary
          },
          warnings: validation.warnings,
          ...stats
        };
        return result;
      } else if (command === 'requests' && sub === 'set') result = setRequest(root, {
        ...input,
        id: options.id ?? input.id,
        status: options.status ?? input.status,
        note: options.note ?? input.note
      });
      else if (command === 'worker') {
        result = ['take', 'return'].includes(sub) ? await remoteWorker(root, cfg, sub, input) :
          await worker(root, cfg, sub, input);
        deep = sub === 'submit';
        if (sub === 'submit') {
          const packages = read(file(root, 'host/delegation/packages.json'));
          for (const p of packages)
            if (p.status === 'integrating' && p.integration_run === input.run_id) {
              p.status = 'adopted';
              p.adopted_at = now();
            } write(file(root, 'host/delegation/packages.json'), packages);
        }
      } else if (command === 'delegate') {
        if (sub === 'adopt' && options['all-ready']) {
          const packages = await delegate(root, cfg, 'list', {});
          result = {
            results: []
          };
          for (const p of packages.packages.filter(p => p.status === 'returned')) result.results.push(
            await delegate(root, cfg, 'adopt', {
              package: p.package_id
            }));
        } else result = await delegate(root, cfg, sub, {
          ...input,
          package: options.package ?? input.package
        });
        deep = sub === 'adopt';
      } else if (command === 'profile' && sub === 'set') {
        result = setProfile(root, cfg, input);
        deep = true;
      } else if (command === 'migrate') {
        result = {
          changed: false,
          messages: ['Runtime schema 1 needs no migration for Chelm-host 0.1.0.']
        };
      } else if (command === 'reset') {
        assert(options.scope === 'instance', 'usage', 'reset requires --scope instance', {}, 2);
        if (options.hard) assert(cfg.sandbox.resettable && root.split(path.sep).includes('sandbox'),
          'hard_reset_refused', 'Hard reset requires a sandbox runtime in a sandbox path');
        if (options.hard) {
          assert(cfg.instance.path.startsWith(root + path.sep), 'hard_reset_refused',
            'Sandbox hard reset cannot remove an external instance');
          fs.rmSync(root, {
            recursive: true,
            force: true
          });
          const initialized = initialize(root, {
            harness: cfg.harness.root,
            python: cfg.harness.python,
            label: cfg.label,
            sandbox: true
          });
          publish(root, config(root), {
            deep: true
          });
          return {
            ...initialized,
            archived_to: null
          };
        }
        const stamp = now().replace(/[-:]/g, '').replace('T', '-').slice(0, 15),
          archive = file(cfg.archive.root, 'instance-' + stamp);
        assert(!fs.existsSync(archive), 'archive_exists', 'Archive timestamp already exists');
        fs.mkdirSync(archive, {
          recursive: true
        });
        const preserve = [];
        const tree = snapshot(cfg.instance.path);
        for (const [p, b] of tree)
          if (p === 'instance/purpose.md' || p === 'golem.config.json' || p.startsWith('profiles/'))
            preserve.push([p, b]);
        fs.renameSync(cfg.instance.path, file(archive, 'instance'));
        for (const p of ['host/intake/registry.json', 'host/conversation/turns.jsonl',
            'host/requests/requests.json'
          ]) {
          const dest = file(archive, p);
          fs.mkdirSync(path.dirname(dest), {
            recursive: true
          });
          fs.renameSync(file(root, p), dest);
        }
        hostInit(root);
        write(file(root, 'host/delegation/packages.json'), []);
        write(file(root, 'host/workers.json'), {});
        child(cfg.harness.python, [file(cfg.harness.root, 'processor/init-instance.py'), '--root', cfg
          .instance.path
        ]);
        for (const [p, b] of preserve) atomic(file(cfg.instance.path, p), b);
        try {
          harness(cfg, 'validate', cfg.instance.path);
        } catch {
          for (const [p] of preserve)
            if (p !== 'instance/purpose.md') fs.rmSync(file(cfg.instance.path, p), {
              force: true
            });
          harness(cfg, 'validate', cfg.instance.path);
        }
        git(cfg.instance.path, ['init', '-q']);
        commitAll(cfg, 'init: fresh instance');
        result = {
          archived_to: archive,
          head: git(cfg.instance.path, ['rev-parse', 'HEAD']).trim(),
          messages: options.hard ? ['A recoverable archive was retained for this sandbox reset.'] :
            []
        };
        deep = true;
      } else fail('usage', 'Unknown command or subcommand', {}, 2);
      publish(root, cfg, {
        deep
      });
      return result;
    } catch (e) {
      try {
        publish(root, cfg);
      } catch {}
      throw e;
    }
  });
}
