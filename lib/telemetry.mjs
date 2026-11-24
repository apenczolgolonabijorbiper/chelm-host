// Local, bounded numeric telemetry. No input bodies, arbitrary errors or outbound I/O.
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { operationMetrics } from "./operation-metrics.mjs";
const operations = new AsyncLocalStorage();
export const currentOperation = () => operations.getStore();
export const metadata = (value) => {
  const c = currentOperation();
  if (c) Object.assign(c.meta, value);
};
export function operation(root, command, fn) {
  const cfg = JSON.parse(
    fs.readFileSync(path.join(root, "chelm.runtime.json"), "utf8"),
  );
  const enabled = cfg.observability?.operation_phases === true;
  return operations.run(
    {
      meta: {},
      started: performance.now(),
      metrics: operationMetrics(enabled),
      enabled,
    },
    () => currentOperation().metrics.async("operation", fn),
  );
}
export function mergeMetrics(report) {
  const c = currentOperation();
  if (!c?.enabled || !report) return;
  for (const [name, row] of Object.entries(report.phases ?? {}))
    c.metrics.mergePhase("adapter_" + name, row);
  c.metrics.mergeGit(report.git);
}
export function usage(value) {
  const keys = [
    "model_ms",
    "input_tokens",
    "output_tokens",
    "cached_input_tokens",
  ];
  if (
    value !== undefined &&
    (!value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).some((k) => !keys.includes(k)))
  )
    throw Object.assign(Error("Invalid usage object"), {
      code: "input_invalid",
    });
  const result = Object.fromEntries(keys.map((k) => [k, value?.[k] ?? null]));
  for (const [k, v] of Object.entries(result))
    if (
      v !== null &&
      (!Number.isFinite(v) ||
        v < 0 ||
        v > Number.MAX_SAFE_INTEGER ||
        (k !== "model_ms" && !Number.isSafeInteger(v)))
    )
      throw Object.assign(Error("Invalid usage field: " + k), {
        code: "input_invalid",
      });
  return result;
}
export const percentile = (values, p) =>
  values.length
    ? [...values].sort((a, b) => a - b)[Math.ceil(p * values.length) - 1]
    : null;
function safe(target) {
  let current = path.parse(path.resolve(target)).root;
  for (const part of path
    .resolve(target)
    .slice(current.length)
    .split(path.sep)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw Error("Unsafe telemetry path");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return target;
}
const atomic = (target, value) => {
  safe(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = target + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temp, JSON.stringify(value) + "\n", { flag: "wx" });
    for (let attempt = 0; ; attempt++) {
      try {
        fs.renameSync(temp, target);
        break;
      } catch (error) {
        if (
          process.platform !== "win32" ||
          !["EPERM", "EACCES", "EBUSY"].includes(error.code) ||
          attempt >= 7
        )
          throw error;
        Atomics.wait(
          new Int32Array(new SharedArrayBuffer(4)),
          0,
          0,
          Math.min(10 * 2 ** attempt, 250),
        );
      }
    }
  } finally {
    try {
      fs.unlinkSync(temp);
    } catch {}
  }
};
const processKey = randomUUID(),
  sampleLimit = 1000,
  shardLimit = 10000,
  retention = 7 * 86400000;
const local = new Map();
const readNames = new Set([
  "read subjects",
  "read requests",
  "read delegations",
  "read summary",
  "read observations",
  "read entities",
  "read claims",
  "read questions",
  "read hypotheses",
  "read warnings",
  "read journals",
  "read answers",
  "read relations",
  "read sources",
  "conversation",
  "subject",
  "requests list",
  "worker context",
  "context",
  "inspect",
  "get",
  "profile check",
  "profile status",
  "export-sources",
  "remote chelm_read_artifact",
  "remote chelm_list_artifacts",
  "remote chelm_context",
  "remote chelm_work_status",
  "remote chelm_list_work",
]);
export function readLabel(command, sub) {
  if (command === "status") return null;
  const label =
    command === "read"
      ? "read " + sub
      : command === "worker"
        ? "worker " + sub
        : command === "profile"
          ? "profile " + sub
          : command === "requests"
            ? "requests " + (sub ?? "list")
            : command;
  return readNames.has(label)
    ? label
    : command === "read"
      ? "read other"
      : null;
}
function shards(root) {
  const dir = path.join(root, "host/metrics/read-shards"),
    now = Date.now();
  let names = [];
  try {
    safe(dir);
    names = fs
      .readdirSync(dir)
      .filter((n) => /^[a-f0-9-]+\.json$/.test(n))
      .sort();
  } catch {
    return { rows: [], token: "", complete: true };
  }
  const rows = [];
  let complete = true;
  const tokens = [];
  for (const name of names.slice(-shardLimit)) {
    try {
      const p = safe(path.join(dir, name));
      if (fs.statSync(p).size > 8 * 1024 * 1024) {
        complete = false;
        continue;
      }
      const text = fs.readFileSync(p, "utf8"),
        row = JSON.parse(text);
      if (
        !Number.isFinite(row.updated_ms) ||
        !row.views ||
        typeof row.views !== "object"
      )
        throw Error("Invalid shard");
      if (now - row.updated_ms > retention) continue;
      rows.push(row);
      tokens.push(name + ":" + createHash("sha256").update(text).digest("hex"));
    } catch {
      complete = false;
    }
  }
  return {
    rows,
    token: tokens.join("|"),
    complete: complete && names.length < shardLimit,
  };
}
export function readSummary(root) {
  const { rows, complete } = shards(root),
    views = {};
  for (const row of rows)
    for (const [name, v] of Object.entries(row.views)) {
      if (!readNames.has(name) && name !== "read other") continue;
      if (
        !v ||
        !Number.isSafeInteger(v.calls) ||
        v.calls < 0 ||
        !Number.isSafeInteger(v.errors) ||
        v.errors < 0 ||
        !Array.isArray(v.samples) ||
        v.samples.length > sampleLimit ||
        v.samples.some(
          (s) =>
            !s ||
            !Number.isFinite(s.at) ||
            !Number.isFinite(s.ms) ||
            s.ms < 0 ||
            typeof s.id !== "string",
        )
      )
        continue;
      const target = (views[name] ??= { calls: 0, errors: 0, samples: [] });
      target.calls += v.calls;
      target.errors += v.errors;
      target.samples.push(...v.samples);
    }
  for (const v of Object.values(views)) {
    v.samples.sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
    v.samples = v.samples.slice(0, sampleLimit);
    v.window_samples = v.samples.length;
    v.p50_ms = percentile(
      v.samples.map((s) => s.ms),
      0.5,
    );
    v.p95_ms = percentile(
      v.samples.map((s) => s.ms),
      0.95,
    );
    delete v.samples;
  }
  return {
    schema_version: 1,
    scope: "retained_process_shards",
    retention_days: 7,
    complete,
    views,
    calls: Object.values(views).reduce((n, v) => n + v.calls, 0),
    errors: Object.values(views).reduce((n, v) => n + v.errors, 0),
  };
}
export function recordRead(root, label, elapsed, error) {
  if (!readNames.has(label) && label !== "read other") return;
  try {
    const dir = path.join(root, "host/metrics/read-shards");
    safe(dir);
    fs.mkdirSync(dir, { recursive: true });
    const files = fs.readdirSync(dir).filter((n) => n.endsWith(".json"));
    for (const name of files) {
      const p = path.join(dir, name);
      try {
        if (Date.now() - fs.statSync(p).mtimeMs > retention) fs.unlinkSync(p);
      } catch {}
    }
    if (
      files.length >= shardLimit &&
      !fs.existsSync(path.join(dir, processKey + ".json"))
    )
      return;
    const row = local.get(root) ?? { updated_ms: Date.now(), views: {} };
    const view = (row.views[label] ??= { calls: 0, errors: 0, samples: [] });
    view.calls++;
    view.errors += error ? 1 : 0;
    row.updated_ms = Date.now();
    view.samples.push({ at: row.updated_ms, id: randomUUID(), ms: elapsed });
    view.samples = view.samples.slice(-sampleLimit);
    local.set(root, row);
    atomic(path.join(dir, processKey + ".json"), row);
    // Recheck after publication: an overlapping older snapshot repairs itself.
    // Crashed publishers may leave a stale materialization; shards remain authoritative.
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = shards(root).token;
      atomic(path.join(root, "host/metrics/reads.json"), readSummary(root));
      if (before === shards(root).token) break;
    }
  } catch {} // A metrics failure must not change a read's result or error.
}
export async function measuredRead(root, label, enabled, fn) {
  if (!enabled || !label) return fn();
  const at = performance.now();
  let failed = false;
  try {
    return await fn();
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    recordRead(root, label, performance.now() - at, failed);
  }
}
export function operationSummary(root, { now = Date.now() } = {}) {
  const since = now - 86400000,
    groups = {},
    durations = { refresh: [], submit: [] };
  let malformed = 0,
    partial = 0,
    first = null;
  // Every segment is <=10 MB plus one bounded event. Never rewrite logs on status.
  for (const suffix of [".5", ".4", ".3", ".2", ".1", ""]) {
    const p = path.join(root, "host/logs/chelm.jsonl" + suffix);
    let content;
    try {
      const stat = fs.statSync(safe(p));
      if (stat.size > 11 * 1024 * 1024) {
        malformed++;
        continue;
      }
      content = fs.readFileSync(p, "utf8");
    } catch {
      continue;
    }
    const lines = content.split("\n");
    if (lines.at(-1) !== "") {
      partial++;
      lines.pop();
    }
    for (const text of lines) {
      if (!text) continue;
      let event;
      try {
        event = JSON.parse(text);
      } catch {
        malformed++;
        continue;
      }
      const time = Date.parse(event.at);
      if (!Number.isFinite(time)) {
        malformed++;
        continue;
      }
      first = first === null ? time : Math.min(first, time);
      if (time < since || time > now || event.command === "remote-worker")
        continue; // endpoint audit events are separate from operations
      if (
        typeof event.command !== "string" ||
        !commandNames.has(event.command) ||
        typeof event.outcome !== "string" ||
        !safeCode.test(event.outcome)
      )
        continue;
      const key = event.command + "|" + event.outcome;
      groups[key] ??= {
        command: event.command,
        outcome: event.outcome,
        count: 0,
      };
      groups[key].count++;
      const kind =
        event.command === "refresh"
          ? "refresh"
          : ["worker submit", "remote chelm_submit_candidate"].includes(
                event.command,
              )
            ? "submit"
            : null;
      if (kind && Number.isFinite(event.duration_ms) && event.duration_ms >= 0)
        durations[kind].push(event.duration_ms);
    }
  }
  return {
    since: new Date(since).toISOString(),
    until: new Date(now).toISOString(),
    counts: Object.values(groups),
    p95_ms: {
      refresh: percentile(durations.refresh, 0.95),
      submit: percentile(durations.submit, 0.95),
    },
    coverage: {
      first_available_at: first === null ? null : new Date(first).toISOString(),
      full_window: first !== null && first <= since,
      malformed_lines: malformed,
      partial_lines: partial,
    },
  };
}
export const safeCode = /^[a-z][a-z0-9_-]{0,79}$/;
export const commandNames = new Set([
  ...["create","cancel","continue","learning"].map(n=>"task "+n),
  "stale-lock",
  "remote-worker",
  "refresh",
  "submit",
  "index",
  "ask",
  "answer",
  "reset",
  "import-sources",
  "read summary",
  "profile install",
  "profile set",
  "requests set",
  "remote list",
  "remote cancel",
  "worker next",
  "worker validate",
  "worker submit",
  "worker renew",
  "worker abandon",
  "worker propose",
  ...[
    "cognitive_read",
    "request_work",
    "list_work",
    "work_status",
    "list_artifacts",
    "read_artifact",
    "context",
    "renew_work",
    "abandon_work",
    "stage_output",
    "validate_candidate",
    "submit_candidate",
  ].map((n) => "remote chelm_" + n),
]);
