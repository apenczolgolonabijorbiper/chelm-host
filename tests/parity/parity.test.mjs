import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  fixture,
  ok,
  source,
  git
} from '../helpers.mjs';

test(
  'TST-5: published synthetic parity fixture preserves history, views, answers, journals and subject counts',
  t => {
    const f = fixture(t),
      base = path.join(source, 'tests/parity'),
      expected = JSON.parse(fs.readFileSync(path.join(base, 'expected.json')));
    fs.cpSync(path.join(base, 'instance'), f.instance, {
      recursive: true
    });
    fs.cpSync(path.join(base, 'host'), path.join(f.root, 'host'), {
      recursive: true
    });
    const cfgFile = path.join(f.root, 'chelm.runtime.json'),
      cfg = JSON.parse(fs.readFileSync(cfgFile));
    cfg.intake.kind_sets = {
      all: ['record', 'change', 'question_answer']
    };
    cfg.requests.kinds = ['collect'];
    fs.writeFileSync(cfgFile, JSON.stringify(cfg));
    git(f.instance, 'add', '-A');
    git(f.instance, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@local', 'commit', '-qm',
      'fixture: committed parity memory');
    ok('refresh', null, f.root);
    const summary = ok('read', 'summary', f.root).view;
    for (const key of ['inbox', 'evidence', 'processed', 'pending_analysis', 'hypotheses', 'past_answers'])
      assert.equal(summary[key], expected[key], key);
    assert.deepEqual(summary.totals, expected.totals);
    assert.equal(summary.open_questions[0].id, expected.open_question);
    const conversation = ok('conversation', null, f.root);
    assert.equal(conversation.messages.length, 4);
    assert.equal(conversation.answers[expected.answer_observation].text, 'The visit is completed.');
    const journal = ok('read', 'journals', f.root).view.data[0];
    for (const [key, value] of Object.entries(expected.journal)) assert.equal(journal[key], value, key);
    for (const [subject, counts] of Object.entries(expected.subjects)) assert.deepEqual(ok('subject',
      subject, f.root).sets.all, counts);
    assert.equal(ok('inspect', 'relations', f.root).total, 1);
    assert.equal(ok('inspect', 'claims', f.root).total, 3);
    assert.equal(ok('requests', 'list', f.root).requests[0].status, 'proposed');
    const deep = ok('read', 'summary', f.root, undefined, {
      deep: true
    });
    assert.equal(deep.validate.ok, true);
    assert.equal(deep.totals.claims, 3);
  });
