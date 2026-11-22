# Local observability

This is local runtime state. Logs and metrics are never automatically exported.
Configured inbound remote MCP traffic and its replies remain supported. No metric
changes analysis, authorization, scheduling, eligibility or publication decisions.

## Runtime configuration

Existing schema-2 runtimes keep working with no migration. Optional configuration:

```json
"observability": {"operation_phases": false, "read_metrics": false}
```

Both switches default off. State lives under host/, never instance commits.
Baseline operation logs remain enabled regardless of these flags.

## Operation events

host/logs/chelm.jsonl keeps the 10 MB / five-rotated-file policy. New records contain
at, command, runtime_id, actor, outcome, duration_ms, ids, counts, executor, run_id,
work_id and subject_id. IDs/counts use empty objects when unavailable; executor
and unavailable top-level IDs are null. Historical records are not rewritten.

| Field | Meaning |
|---|---|
| actor | Actual OS security identity; not the executor |
| executor | Validated descriptive id, kind, model, host; never authentication |
| principal | Authenticated remote worker identity, where applicable |
| ids | Allowlisted run/work/subject/request/question/observation identifiers; single-line, bounded |
| counts | Available actual result counts: written, skipped_groups, indexed, added, present, evidence_added, pending, processed, claimed |
| outcome | ok or a safe fixed error code; never exception text |
| phases, git | Present only with operation_phases; numeric report from operationMetrics |
| usage | Present on worker submission: model_ms, input_tokens, output_tokens, cached_input_tokens, each nullable |

Counts describe actual results, not attempted success. Refresh/reset have empty
counts when their response supplies no relevant count. Generated worker run IDs
and intake observation IDs come from results. Failed operations retain only known,
validated metadata; an ownership refusal never exposes another owner's executor.

Lock-wrapped mutations record success/refusal; local worker next/validate/submit/
renew/abandon/propose carry validated executor metadata. Remote endpoint audit
records use command=remote-worker with principal/tool/work_id and safe failures;
these are separate from the owner operation events. Remote read tools retain their
existing short recovery/expiry operation lock and operation events; metrics add
no lock. Removing that pre-existing lock would change crash-recovery semantics.
Local read/status/conversation/subject/requests/context and direct file reads do
not create operation-log lines. Administrative lifecycle operations outside the
mutation dispatcher (init/adopt/verify/migrate) retain their existing coverage;
this log is not a complete filesystem or security audit trail.

Submission run_id is captured before lease release. Remote publication records
use the actual publication lease run; the assignment's analysis journal may have
a different ID. Answer intake has no run until analysis, so run_id is null.

With operation_phases enabled, operation covers elapsed locked work up to log
creation; child stages include indexer/validator/retrieval/statistics/other.
Adapter stages use adapter_ prefixes and include actual Git calls. Stages nest
and overlap; their durations MUST NOT be added. Timings exclude process startup.
Instrumentation/log write failures are best-effort and preserve operation errors
and committed results. An OS/process crash can prevent a final log line.

## Executor usage

Local worker submit (CLI/stdio) and remote chelm_submit_candidate accept optional
usage. Missing object/fields normalize to null. Values are finite nonnegative
numbers <= Number.MAX_SAFE_INTEGER; token counts must be integers. Unknown fields
are refused. The host never fills unknown values or trusts usage for decisions.
Local usage is retained in host/workers.json; remote usage is fixed with the
submission record. Remote retries require the same submission ID, digest and
normalized usage. Different usage refuses with idempotency_conflict; retry never
repeats a committed publication. Raw log counts include retry calls, not unique
model executions; do not sum per-call usage to invoice a model provider.

## Read counters and concurrency

Instrumented CLI/stdio app reads and remote snapshot read tools record numeric
latency/error samples only when read_metrics=true. Labels are fixed names; an
unknown read view is grouped as read other. Direct app reads of published JSON
cannot be observed. Status and internal telemetry reads exclude themselves.

Each process atomically replaces only its own randomly named shard under
host/metrics/read-shards/. Independent processes never overwrite one another's
counters. Each shard keeps per-view calls/errors and its last 1,000 latency
samples. Aggregation selects the latest 1,000 completed samples per view across
retained shards (completion milliseconds, then random-ID tie break). p50/p95 use
nearest rank; an empty window returns null. Calls/errors cover retained process
shards; window_samples covers only the bounded percentile window.

Retention is seven days of inactive shards, capped at 10,000 process shards.
These are retained counters, not unbounded lifetime totals. Long-lived active
processes retain their counters; purging an inactive process removes its counts.
At the cap new process sampling is skipped until cleanup frees a slot; counters
may under-report and complete=false at saturation. This bound is deliberate:
exact lifetime totals with bounded disk and lock-free independent CLI writers
would require a different durable aggregation service. No daemon is required.

host/metrics/reads.json is an atomically replaced materialized summary. Publishers
recheck shard versions after replacement and retry boundedly. During activity or
if a publisher crashes immediately after replacement, it can lag authoritative
shards; the next sample repairs it. chelm status computes from shards without
writing, so it sees persisted samples rather than trusting the materialization.
Metrics acquire no operation lock; app pure reads stay lock-free and remote tools
retain their pre-existing recovery lock. Metrics I/O failure never changes the original
read result/error; lost samples on failed I/O or process kill are not fabricated.

## Status summary

chelm status adds observability.operations and, when enabled, observability.reads.
The operation summary scans the current log and five available rotations, at most
11 MB each. It returns rolling UTC 24-hour counts by canonical command/outcome,
plus refresh and worker-submission duration p95. Endpoint audit events are
excluded to avoid counting both an endpoint call and its internal mutation.
Counts are calls, including retries; p95 covers matching log durations, not the
read-sample window. Malformed/trailing partial lines and available history are
reported under coverage. A shortened log history is not a complete 24-hour audit.
Status never writes, rotates, repairs counters or observes itself.

## Child-process diagnostics

CHELM_TIMINGS_FILE optionally appends JSONL {kind, elapsed_ms} for child execution.
Kinds: indexer, validator, retrieval, statistics, other. It excludes parent work
and process startup before the host begins. It is used by benchmark-host.mjs;
it is separate from operation phases and the same nested work may appear in both.
Use a private writable local destination. Failed diagnostic writes are ignored.

The previous HTTP privacy test excluded a declared executor host altogether.
VI-021 explicitly adds that descriptive field, so the updated test verifies it
while ensuring the authenticated principal/OS actor are never replaced by it.
Credentials and observation content remain excluded.
