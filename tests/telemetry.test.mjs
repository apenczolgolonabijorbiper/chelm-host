import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fixture, ok, executor, analyze } from "./helpers.mjs";
import { execute } from "../lib/app.mjs";
import {
  readSummary,
  recordRead,
  operationSummary,
  usage,
  percentile,
} from "../lib/telemetry.mjs";
import { log } from "../lib/util.mjs";
import { call, prepare, workArgs } from "./remote-helpers.mjs";
const config = (f, values) => {
  const p = path.join(f.root, "chelm.runtime.json"),
    cfg = JSON.parse(fs.readFileSync(p));
  cfg.observability = values;
  fs.writeFileSync(p, JSON.stringify(cfg));
};
const logs = (f) =>
  fs
    .readFileSync(path.join(f.root, "host/logs/chelm.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((s) => JSON.parse(s));

test("operation logs contain baseline identity, optional real phases, nullable usage and no private content", (t) => {
  const f = fixture(t);
  f.submit("S-1", "SECRET_OBSERVATION_CONTENT");
  ok("refresh", null, f.root);
  assert.equal(logs(f).at(-1).phases, undefined);
  config(f, { operation_phases: true, read_metrics: false });
  ok("refresh", null, f.root);
  const refresh = logs(f).at(-1);
  assert.ok(refresh.phases.operation.elapsed_ms >= 0);
  assert.ok(refresh.git.calls > 0);
  assert.deepEqual(refresh.ids, {});
  assert.deepEqual(refresh.counts, {});
  const unit = ok("worker", "next", f.root, { executor }).work_unit;
  analyze(f, unit);
  const reported = {
    model_ms: 12,
    input_tokens: 20,
    output_tokens: 5,
    cached_input_tokens: null,
  };
  ok("worker", "submit", f.root, {
    executor,
    run_id: unit.run_id,
    usage: reported,
  });
  const submitted = logs(f).at(-1);
  assert.equal(submitted.run_id, unit.run_id);
  assert.deepEqual(submitted.executor, executor);
  assert.deepEqual(submitted.usage, reported);
  assert.equal(submitted.counts.processed, 1);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(f.root, "host/workers.json")))[
      unit.run_id
    ].usage,
    reported,
  );
  const before = fs.readFileSync(
    path.join(f.root, "host/logs/chelm.jsonl"),
    "utf8",
  );
  ok("read", "summary", f.root);
  ok("status", null, f.root);
  assert.equal(
    fs.readFileSync(path.join(f.root, "host/logs/chelm.jsonl"), "utf8"),
    before,
  );
  assert.ok(!before.includes("SECRET_OBSERVATION_CONTENT"));
  const original = process.env.CHELM_TIMINGS_FILE;
  process.env.CHELM_TIMINGS_FILE = f.root;
  try {
    ok("refresh", null, f.root);
  } finally {
    if (original === undefined) delete process.env.CHELM_TIMINGS_FILE;
    else process.env.CHELM_TIMINGS_FILE = original;
  }
});

test("read metrics track 100 results, failures and lock-free concurrent processes; status writes nothing", async (t) => {
  const f = fixture(t);
  config(f, { read_metrics: true });
  for (let i = 0; i < 99; i++)
    await execute("read", i % 2 ? "summary" : "questions", { runtime: f.root });
  await assert.rejects(execute("read", "not-a-view", { runtime: f.root }));
  let summary = readSummary(f.root);
  assert.equal(summary.calls, 100);
  assert.equal(summary.errors, 1);
  assert.ok(summary.views["read summary"].p95_ms >= 0);
  // Holding the mutation lock must not block either normal reads or telemetry.
  fs.writeFileSync(path.join(f.root, "host/locks/operation.lock"), "held");
  await execute("read", "summary", { runtime: f.root });
  fs.unlinkSync(path.join(f.root, "host/locks/operation.lock"));
  const module = fileURLToPath(
    new URL("../lib/telemetry.mjs", import.meta.url),
  );
  await Promise.all(
    Array.from(
      { length: 16 },
      () =>
        new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              "--input-type=module",
              "-e",
              `import {recordRead} from ${JSON.stringify(pathToFileURL(module).href)};recordRead(process.argv[1],'read summary',7,false);`,
              f.root,
            ],
            { stdio: "pipe" },
          );
          let stderr = "";
          child.stderr.on("data", (x) => (stderr += x));
          child.on("error", reject);
          child.on("exit", (code) =>
            code === 0 ? resolve() : reject(Error(stderr)),
          );
        }),
    ),
  );
  summary = readSummary(f.root);
  assert.equal(summary.calls, 117);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(f.root, "host/metrics/reads.json")))
      .calls,
    117,
  );
  const before = fs.readFileSync(
      path.join(f.root, "host/metrics/reads.json"),
      "utf8",
    ),
    status = await execute("status", null, { runtime: f.root });
  assert.equal(status.observability.reads.calls, 117);
  assert.equal(
    fs.readFileSync(path.join(f.root, "host/metrics/reads.json"), "utf8"),
    before,
  );
  for (let i = 0; i < 1010; i++) recordRead(f.root, "read summary", i, false);
  summary = readSummary(f.root);
  assert.equal(summary.views["read summary"].window_samples, 1000);
  assert.equal(summary.calls, 1127);
  // Broken metrics storage must not break a successful read.
  fs.renameSync(
    path.join(f.root, "host/metrics"),
    path.join(f.root, "host/metrics-before"),
  );
  fs.writeFileSync(path.join(f.root, "host/metrics"), "not a directory");
  await execute("read", "summary", { runtime: f.root });
});

test("24-hour summary handles rotation, cutoff and partial/corrupt records without writes", (t) => {
  const f = fixture(t),
    p = path.join(f.root, "host/logs/chelm.jsonl"),
    now = Date.parse("2026-11-22T20:00:00Z");
  const row = (at, command, duration_ms) =>
    JSON.stringify({ at, command, duration_ms, outcome: "ok" });
  fs.writeFileSync(
    p + ".1",
    row("2026-11-21T19:00:00Z", "refresh", 999) +
      "\n" +
      row("2026-11-21T20:00:00Z", "refresh", 3) +
      "\n",
  );
  fs.writeFileSync(
    p,
    row("2026-11-22T19:00:00Z", "refresh", 9) +
      "\n" +
      row("2026-11-22T19:00:00Z", "worker submit", 7) +
      "\n" +
      row("2026-11-22T19:00:00Z", "remote-worker", 100) +
      '\nBAD\n{"partial":',
  );
  const result = operationSummary(f.root, { now });
  assert.equal(result.p95_ms.refresh, 9);
  assert.equal(result.p95_ms.submit, 7);
  assert.equal(result.counts.find((r) => r.command === "refresh").count, 2);
  assert.equal(result.counts.length, 2);
  assert.equal(result.coverage.malformed_lines, 1);
  assert.equal(result.coverage.partial_lines, 1);
  assert.equal(result.coverage.full_window, true);
  log(f.root, "refresh", "ok", {
    arbitrary: "SECRET",
    ids: { reason: "SECRET" },
    executor: { ...executor, extra: "SECRET" },
  });
  assert.ok(!fs.readFileSync(p, "utf8").includes("SECRET"));
  assert.equal(percentile([], 0.95), null);
  assert.deepEqual(usage(), {
    model_ms: null,
    input_tokens: null,
    output_tokens: null,
    cached_input_tokens: null,
  });
  for (const value of [
    { input_tokens: -1 },
    { output_tokens: 0.5 },
    { model_ms: Infinity },
    { secret: "x" },
    null,
  ])
    assert.throws(() => usage(value));
});

test("remote usage is durable, retry-fenced and correlated with publication run", async (t) => {
  const f = fixture(t);
  config(f, { operation_phases: true, read_metrics: true });
  f.submit();
  const run = call(f),
    w = await run("chelm_request_work", { request_id: randomUUID(), executor }),
    candidate = await prepare(run, w),
    v = await run("chelm_validate_candidate", candidate),
    args = {
      ...candidate,
      candidate_digest: v.candidate_digest,
      submission_id: randomUUID(),
      usage: { input_tokens: 3 },
    };
  const result = await run("chelm_submit_candidate", args);
  assert.equal(result.status, "committed");
  assert.equal((await run("chelm_submit_candidate", args)).head, result.head);
  await assert.rejects(
    run("chelm_submit_candidate", { ...args, usage: { input_tokens: 4 } }),
    { code: "idempotency_conflict" },
  );
  const record = JSON.parse(
    fs.readFileSync(
      path.join(f.root, "host/remote/work", w.work_id, "record.json"),
    ),
  );
  assert.equal(record.submission.usage.input_tokens, 3);
  const submitted = logs(f).filter(
    (e) => e.command === "remote chelm_submit_candidate" && e.outcome === "ok",
  )[0];
  assert.equal(submitted.run_id, record.publication_run);
  assert.equal(submitted.executor.id, executor.id);
  await run("chelm_work_status", workArgs(w));
});

const commonKeys = ['at','command','runtime_id','actor','outcome','duration_ms','ids','counts','executor','run_id','work_id','subject_id'].sort();
const assertCommon = event => {
  assert.deepEqual(Object.keys(event).sort(), commonKeys);
  assert.equal(typeof event.runtime_id, 'string');
  assert.ok(Number.isFinite(event.duration_ms) && event.duration_ms >= 0);
  assert.equal(typeof event.ids, 'object');
  assert.equal(typeof event.counts, 'object');
};

test('VI-021: intake, duplicate, refresh, failure and reset emit the exact baseline envelope; reads stay unlogged', async t => {
  const f = fixture(t);
  const input={subject_id:'S-1',groups:[{kind:'record',lines:['SENTINEL_PRIVATE_SOURCE']}]};
  const result = ok('submit',null,f.root,input);
  const submitted = logs(f).at(-1);
  assertCommon(submitted);
  assert.equal(submitted.counts.written, result.written);
  assert.equal(submitted.ids.subject_id, 'S-1');
  ok('submit',null,f.root,input);
  assert.equal(logs(f).at(-1).counts.written, 0);
  assert.equal(logs(f).at(-1).counts.skipped_groups, 1);
  ok('refresh', null, f.root);
  const before = fs.readFileSync(path.join(f.root, 'host/logs/chelm.jsonl'), 'utf8');
  // A held operation lock proves these reads neither lock nor emit operation events.
  fs.writeFileSync(path.join(f.root, 'host/locks/operation.lock'), 'held');
  for (const [command, sub] of [['read','summary'],['status',null],['conversation',null],['subject','S-1'],['requests','list'],['worker','context']])
    await execute(command, sub, {runtime:f.root}, {executor});
  fs.unlinkSync(path.join(f.root, 'host/locks/operation.lock'));
  assert.equal(fs.readFileSync(path.join(f.root, 'host/logs/chelm.jsonl'), 'utf8'), before);
  await assert.rejects(execute('submit', null, {runtime:f.root}, {subject_id:'S-1',groups:[]}), {code:'input_invalid'});
  assert.notEqual(logs(f).at(-1).outcome, 'ok');
  ok('reset', null, f.root, undefined, {scope:'instance'});
  for (const event of logs(f)) assertCommon(event);
  assert.ok(!JSON.stringify(logs(f)).includes('SENTINEL_PRIVATE_SOURCE'));
});

test('VI-021: local and remote no-work preserve validated executor; rejected ownership exposes none', async t => {
  const f = fixture(t);
  assert.equal(ok('worker','next',f.root,{executor:{...executor,extra:'SENTINEL_PRIVATE_EXTRA'}}).status,'no-work');
  assert.deepEqual(logs(f).at(-1).executor,executor);
  const run = call(f);
  assert.equal((await run('chelm_request_work',{executor,request_id:randomUUID()})).status,'no-work');
  assert.deepEqual(logs(f).at(-1).executor,executor);
  f.submit();
  const w = await run('chelm_request_work',{executor,request_id:randomUUID()});
  const stored=JSON.parse(fs.readFileSync(path.join(f.root,'host/remote/work',w.work_id,'record.json')));
  assert.equal(logs(f).at(-1).run_id,stored.run_id);
  await run('chelm_work_status',workArgs(w));
  assert.deepEqual(logs(f).at(-1).executor,executor);
  await assert.rejects(call(f,'another-principal')('chelm_work_status',workArgs(w)),{code:'work_not_owned'});
  assert.equal(logs(f).at(-1).executor,null);
  assert.deepEqual(logs(f).at(-1).ids,{});
  assert.ok(!JSON.stringify(logs(f)).includes('SENTINEL_PRIVATE_EXTRA'));
});

test('VI-021: stale-lock recovery and failed logging preserve committed results and original errors', async t => {
  const {lock} = await import('../lib/util.mjs');
  const os = await import('node:os');
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root,'host/locks/operation.lock'),JSON.stringify({pid:2147483647,host:os.hostname(),started_at:'2000-01-01T00:00:00Z'}));
  await lock(f.root,'refresh',async()=>({}));
  const recovered=logs(f).find(e=>e.command==='stale-lock');
  assertCommon(recovered);assert.equal(recovered.outcome,'recovered');
  const p=path.join(f.root,'host/logs/chelm.jsonl');
  fs.rmSync(p);fs.mkdirSync(p);
  const result=ok('submit',null,f.root,{subject_id:'S-1',groups:[{kind:'record',lines:['SENTINEL_COMMITTED_WITHOUT_LOG']}]});
  assert.equal(result.written,1);
  const original=Object.assign(new Error('SENTINEL_RAW_ERROR'),{code:'input_invalid'});
  await assert.rejects(lock(f.root,'refresh',async()=>{throw original;}),e=>e===original);
  assert.equal(ok('subject','S-1',f.root).ok,true);
});

test('VI-021: actual rotation retains five files and independent process appends remain parseable', async t => {
  const f=fixture(t), p=path.join(f.root,'host/logs/chelm.jsonl');
  for(let i=0;i<6;i++){
    fs.writeFileSync(p,'\n'.repeat(10*1024*1024+1));
    log(f.root,'refresh','ok');
    assertCommon(logs(f).at(-1));
  }
  for(let i=1;i<=5;i++)assert.ok(fs.existsSync(p+'.'+i));
  assert.equal(fs.existsSync(p+'.6'),false);
  const module=pathToFileURL(fileURLToPath(new URL('../lib/util.mjs',import.meta.url))).href;
  await Promise.all(Array.from({length:8},()=>new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',`import {log} from ${JSON.stringify(module)};for(let i=0;i<20;i++)log(process.argv[1],'refresh','ok');`,f.root],{stdio:'pipe'});
    child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(Error('append process failed')));
  })));
  const events=logs(f);
  assert.equal(events.length,161);
  events.forEach(assertCommon);
});
