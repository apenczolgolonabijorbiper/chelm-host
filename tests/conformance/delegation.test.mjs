import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  fixture,
  ok,
  refuse,
  executor,
  analyze
} from '../helpers.mjs';

function enable(f) {
  const p = path.join(f.root, 'chelm.runtime.json'),
    cfg = JSON.parse(fs.readFileSync(p));
  cfg.delegation = {
    enabled: true,
    share_root: path.join(f.base, 'share'),
    participants: [os.userInfo().username],
    reservation_hours: 8
  };
  fs.writeFileSync(p, JSON.stringify(cfg));
  return cfg;
}

function remote(root) {
  const instance = path.join(root, 'instance');
  return {
    root,
    instance,
    read: p => JSON.parse(fs.readFileSync(path.join(instance, p))),
    text: p => fs.readFileSync(path.join(instance, p), 'utf8'),
    write: (p, v) => {
      const target = path.join(instance, p);
      fs.mkdirSync(path.dirname(target), {
        recursive: true
      });
      fs.writeFileSync(target, typeof v === 'string' ? v : JSON.stringify(v, null, 2) + '\n');
    }
  };
}

function finish(f) {
  const u = ok('worker', 'next', f.root, {
    executor
  }).work_unit;
  assert(u);
  analyze(f, u);
  ok('worker', 'submit', f.root, {
    executor,
    run_id: u.run_id,
    outputs: []
  });
  return u;
}
test('DST-1..31/TST-8: reservation, take, remote processing, return and fast-forward adoption', t => {
  const f = fixture(t);
  enable(f);
  const ids = f.submit();
  const offer = ok('delegate', 'offer', f.root, {
    observation_ids: ids
  });
  assert(offer.messages.some(m => m.includes('full committed memory')));
  assert.equal(ok('worker', 'next', f.root, {
    executor
  }).status, 'no-work');
  const taken = ok('worker', 'take', f.root, {
    executor,
    package_id: offer.package_id
  });
  const sandbox = remote(taken.runtime_path_abs);
  finish(sandbox);
  ok('worker', 'return', sandbox.root, {
    executor,
    package_id: offer.package_id
  });
  assert.equal(ok('delegate', 'list', f.root).packages[0].status, 'returned');
  const adopted = ok('delegate', 'adopt', f.root, undefined, {
    package: offer.package_id
  });
  assert.equal(adopted.method, 'fast-forward');
  assert.equal(ok('read', 'summary', f.root).view.processed, 1);
  assert.equal(ok('delegate', 'adopt', f.root, undefined, {
    package: offer.package_id
  }).status, 'already_adopted');
});
test('DST-32/33: moved-head keyed merge retains both independent analyses', t => {
  const f = fixture(t);
  enable(f);
  const first = f.submit('A'),
    offer = ok('delegate', 'offer', f.root, {
      observation_ids: first
    });
  f.submit('B');
  finish(f);
  const taken = ok('worker', 'take', f.root, {
      executor,
      package_id: offer.package_id
    }),
    sandbox = remote(taken.runtime_path_abs);
  finish(sandbox);
  ok('worker', 'return', sandbox.root, {
    executor,
    package_id: offer.package_id
  });
  const adopted = ok('delegate', 'adopt', f.root, undefined, {
    package: offer.package_id
  });
  assert.equal(adopted.status, 'integration-required');
  const unit = adopted.work_unit;
  assert.equal(unit.method, 'harness-merge');
  assert(unit.needs_regeneration.includes('memory/index.md'));
  f.write('memory/index.md', '# Reviewed merged memory\n' + f.read('memory/graph.json').entities.map(e =>
    e.id + ' ' + e.label).join('\n') + '\n');
  ok('worker', 'validate', f.root, {
    executor: unit.executor,
    run_id: unit.run_id,
    outputs: unit.outputs
  });
  ok('worker', 'submit', f.root, {
    executor: unit.executor,
    run_id: unit.run_id,
    outputs: unit.outputs
  });
  assert.equal(ok('delegate', 'list', f.root).packages[0].status, 'adopted');
  assert.equal(ok('read', 'summary', f.root).view.processed, 2);
  assert.equal(ok('read', 'summary', f.root).view.totals.claims, 2);
});
test('DST-21/30: tampered offers and cancellation refuse before local memory changes', t => {
  const f = fixture(t),
    cfg = enable(f);
  const ids = f.submit(),
    offer = ok('delegate', 'offer', f.root, {
      observation_ids: ids
    }),
    note = path.join(cfg.delegation.share_root, 'delegations', offer.package_id, 'inbox', ids[0] + '.md');
  fs.appendFileSync(note, 'Tampered');
  refuse('package_invalid', 'worker', 'take', f.root, {
    executor,
    package_id: offer.package_id
  });
  assert(!fs.existsSync(path.join(cfg.delegation.share_root, 'delegations', offer.package_id,
    'taken.json')));
  ok('delegate', 'cancel', f.root, undefined, {
    package: offer.package_id
  });
  refuse('package_cancelled', 'delegate', 'adopt', f.root, undefined, {
    package: offer.package_id
  });
  assert.equal(ok('worker', 'next', f.root, {
    executor
  }).status, 'claimed');
});
