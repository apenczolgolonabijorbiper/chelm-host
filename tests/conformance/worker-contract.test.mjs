import test from '../scenario.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  spawnSync
} from 'node:child_process';
import {
  fixture,
  ok,
  refuse,
  executor,
  analyze,
  git,
  source
} from '../helpers.mjs';
test('WRK-1..6/HAR-4: source selectors, owner renewal, isolated candidate, successful completion', t => {
  const f = fixture(t, {
    profile: true
  });
  f.submit('S-1');
  f.submit('S-2');
  const r = ok('worker', 'next', f.root, {
      executor,
      subject_id: 'S-2',
      max: 1
    }),
    u = r.work_unit;
  assert.equal(u.sources.length, 1);
  assert.equal(u.sources[0].subject_id, 'S-2');
  assert.equal(u.guidance.text.includes('Read the full source'), true);
  refuse('lease_not_owned', 'worker', 'renew', f.root, {
    executor: {
      ...executor,
      id: 'other'
    },
    run_id: u.run_id
  });
  ok('worker', 'renew', f.root, {
    executor,
    run_id: u.run_id
  });
  analyze(f, u);
  f.write('scratch.txt', 'Preserve this draft');
  const before = git(f.instance, 'rev-parse', 'HEAD');
  ok('worker', 'validate', f.root, {
    executor,
    run_id: u.run_id,
    outputs: []
  });
  assert.equal(git(f.instance, 'rev-parse', 'HEAD'), before);
  assert.equal(ok('read', 'summary', f.root).view.totals.claims, 0);
  const draft = f.text('memory/graph.json');
  f.write('memory/graph.json', '{incomplete draft');
  assert.equal(ok('read', 'summary', f.root).view.totals.claims, 0);
  f.write('memory/graph.json', draft);
  const complete = ok('worker', 'submit', f.root, {
    executor,
    run_id: u.run_id,
    outputs: []
  });
  assert.equal(complete.status, 'committed');
  assert.equal(ok('read', 'summary', f.root).view.totals.claims, 1);
  assert.equal(f.text('scratch.txt'), 'Preserve this draft');
  assert.equal(ok('read', 'journals', f.root).view.data[0].source_assertions, 1);
  assert.equal(ok('read', 'observations', f.root).view.data.filter(o => o.state === 'processed').length,
    1);
});
test('WRK-4/6: validation errors restore protocol outputs and safely release the lease', t => {
  const f = fixture(t);
  f.submit();
  const u = ok('worker', 'next', f.root, {
    executor
  }).work_unit;
  analyze(f, u, {
    bad: true
  });
  refuse('validation_failed', 'worker', 'submit', f.root, {
    executor,
    run_id: u.run_id,
    outputs: []
  });
  assert.equal(f.read('memory/graph.json').claims.length, 0);
  assert(!fs.existsSync(path.join(f.instance, u.journal_path)));
  assert.equal(f.read('memory/processing-lock.json').status, 'error');
  assert.equal(ok('status', null, f.root).counts.processed, 0);
});
test('HAR-10: committed policy change refuses completion and permits explicit reclaim', t => {
  const f = fixture(t, {
    profile: true
  });
  f.submit();
  const u = ok('worker', 'next', f.root, {
    executor
  }).work_unit;
  analyze(f, u);
  f.write('profiles/default.md', 'New policy. Review source-grounded declarations.');
  git(f.instance, 'add', 'profiles/default.md');
  git(f.instance, '-c', 'user.name=Synthetic', '-c', 'user.email=test@local', 'commit', '-qm',
    'Policy update');
  refuse('policy_changed', 'worker', 'submit', f.root, {
    executor,
    run_id: u.run_id,
    outputs: []
  });
  assert.equal(f.read('memory/processing-lock.json').status, 'error');
  assert.equal(f.read('memory/graph.json').claims.length, 1);
  const reclaimed = ok('worker', 'next', f.root, {
    executor
  }).work_unit;
  assert.notEqual(reclaimed.run_id, u.run_id);
  assert(reclaimed.guidance.text.endsWith('New policy. Review source-grounded declarations.'));
  ok('worker', 'abandon', f.root, {
    executor,
    run_id: reclaimed.run_id
  });
});
test('WRK-3/4: missing journal and unsafe outputs retain the lease for correction', t => {
  const f = fixture(t);
  f.submit();
  const u = ok('worker', 'next', f.root, {
    executor
  }).work_unit;
  refuse('output_missing', 'worker', 'submit', f.root, {
    executor,
    run_id: u.run_id,
    outputs: []
  });
  refuse('bad_outputs', 'worker', 'submit', f.root, {
    executor,
    run_id: u.run_id,
    outputs: ['inbox/evil.md']
  });
  assert.equal(f.read('memory/processing-lock.json').status, 'processing');
  ok('worker', 'abandon', f.root, {
    executor,
    run_id: u.run_id,
    reason: 'Never store this transcript'
  });
  assert(!f.text('memory/processing-lock.json').includes('Never store'));
});
test('WRK MCP: initialize, notifications, tools and all seven local method round trips', t => {
  const f = fixture(t);
  const calls = [{
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05'
      }
    }, {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    }, ...['next', 'context', 'validate', 'submit', 'renew', 'abandon', 'propose']
    .map((n, i) => ({
      jsonrpc: '2.0',
      id: i + 3,
      method: 'tools/call',
      params: {
        name: 'chelm_' + n,
        arguments: {
          executor
        }
      }
    }))
  ];
  const r = spawnSync(process.execPath, [path.join(source, 'bin/chelm-mcp.mjs'), '--runtime', f.root], {
    input: calls.map(c => JSON.stringify(c)).join('\n') + '\n',
    encoding: 'utf8',
    timeout: 180000
  });
  assert.equal(r.status, 0, r.stderr);
  const messages = r.stdout.trim().split('\n').map(s => JSON.parse(s));
  assert.equal(messages.length, 9);
  assert.equal(messages[0].result.serverInfo.version, '1.4.0');
  assert.equal(messages[1].result.tools.length, 34);
  for (const reply of messages.slice(2)) assert(reply.result.content[0].text);
});
