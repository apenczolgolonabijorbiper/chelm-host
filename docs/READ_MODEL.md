# Read Model

Chelm-host 1.0.0 retains read-model contract version 1. The following requirements are
from design draft 0.2. See [implementation and verification status](ACCEPTANCE.md)
for measured checks, platform checks awaiting CI, and deviations.

## 10. Read model v1

- `RM-1` Location: `<runtime>/host/read-model/`. Each view is one JSON file written atomically (temporary file in the same folder, then rename). Every view has `schema_version: 1`, `generated_at`, `head` (instance HEAD it was built from) and `runtime_id`. Schemas in `schemas/read-model/*.schema.json`.
- `RM-2` Consistency: protocol state (ledger, lease, graph, queues, hypotheses, journals, events) is read from the committed HEAD, not from the working tree, so drafts of a running cycle never appear. Intake state (inbox notes and evidence not yet committed) is read from the working tree.
- `RM-3` Regeneration: after every state-changing command (intake, conversation, worker submit and abandon, claim, release, adoption, reset, import) and on `chelm refresh`. A refresh after an out-of-band change (for example someone used a raw adapter) is the application's choice (a "deep refresh" button).
- `RM-4` Views and minimum fields:
  - `summary.json`: `instance_path_abs, layout, exists, harness_version, backend {kind, capabilities}, profile {selected, path, vocabulary}, totals {sources, entities, claims, relations, active_claims}, capacity {sources, entities, claims: {used, limit, near_limit}}, warning_summary {total, by_code}, inbox, evidence, processed, pending_analysis, ready, waiting_for_age, malformed[], lease {state, run_id, expires_at, reason}, hypotheses, past_answers (Golem turns in the conversation), open_questions [{id, text}], last_run, graph_updated_at, busy, delegation {offered, taken, returned}`.
  - `observations.json`: `[{id, kind, subject_id, chunk, recorded_at, first_line, state, evidence, run, processed_at}]`; `state` is `waiting_for_age`, `ready`, `reserved`, `claimed`, `processed` or `malformed`.
  - `subjects.json`: `{<subject_id>: {groups: [...], kinds: {...}, sets: {...}}}` as in `APP-34`.
  - `questions.json`: every question queue entry `{id, text, status, at, source_observation_id}`.
  - `answers.json`: `{<observation_id>: {text, at, question_id}}` from committed chat events.
  - `journals.json`: rows as in `APP-36`.
  - `warnings.json`: the committed snapshot's validator warnings and `warning_summary`, as returned by the harness. The validator run that regenerates this view is the one exception to plain-file regeneration (`RM-6`).
  - `requests.json`, `delegations.json`: as in `APP-50` and `APP-61`.
- `RM-5` A missing read-model folder means "not initialized"; applications show that state instead of failing.
- `RM-6` Regeneration of all views except `warnings.json` for an instance at the harness capacity limits MUST stay under 3 seconds on a current Windows workstation (section 12). `warnings.json` and the summary fields `capacity` and `warning_summary` need harness runs (`validate` and `stats`). The harness's own Linux measurements show full CLI validation taking about 3.7 seconds at 10,000 sources (`docs/CAPACITY_BENCHMARKS.md`; no Windows figure is published). They are therefore refreshed only after commits, adoptions, resets, imports and `refresh` (not after intake or conversation), and their `generated_at` and `head` show their age.

---

## Windows file sharing and atomic publication (VF-6)

View writers create a temporary sibling and rename it over the old file; they
never delete the destination to force replacement. On Windows, EPERM, EACCES and
EBUSY trigger at most eight attempts with bounded exponential waits (10, 20, 40,
80, 160, 250, 250 ms). Other errors refuse immediately. Exhausted retries leave
the old view intact and report the original error.

Readers must allow replacement and close handles promptly. In .NET/IIS, use
FileShare.ReadWrite | FileShare.Delete; File.ReadAllText's default sharing may
block replacement while open. For example:

```csharp
using var stream = new FileStream(viewPath, FileMode.Open, FileAccess.Read,
    FileShare.ReadWrite | FileShare.Delete);
using var reader = new StreamReader(stream, Encoding.UTF8, true);
var json = reader.ReadToEnd();
```

An already-open handle sees a complete old file. On Windows, Node's rename backend
can still refuse replacement while that target is open, even with delete-sharing.
Never await refresh/publication while holding a view handle: read and close it
within the request. If sharing retries are exhausted, the old file stays intact;
retry the mutation after readers close. A later open sees the successfully
replaced file.
Compare head/generated_at across independently opened views when a consistent
snapshot matters. Do not retain view handles between requests.

The historical delegations view is empty and summary delegation counts are zero. Use local `remote list` or `status.remote_work` for remote assignment administration.

## Cognitive tasks

`tasks.json` is an additive schema v1 projection of durable task/assignment
records, with runtime_id, generated_at and head. Rows contain state, attempt
history, result, receipt, answered_binding, current_snapshot_id, stale and a
separate learning state. needs_input/failed/cancelled are never completed answers.
`conversation` exposes `cognitive_tasks` separately from legacy messages/answers.
Rows with results refer to the answer's snapshot, not latest evidence. Applications
resolve citations with `task evidence`; missing retention is explicit.

A crash after atomic result publication may leave this cached view behind.
`task get` recovers from authoritative files and reports read_view_refresh_pending;
`refresh` rebuilds projections. Plain reads never refresh, spawn children, validate
or start inference. Concurrent readers see complete individual JSON files; there
is no transactional multi-file view generation guarantee. On Windows/.NET use
FileShare.ReadWrite | FileShare.Delete to permit atomic file replacement.

The IIS acceptance probe deliberately holds a C# reader past the retry window.
It accepts only a structured EPERM/EACCES/EBUSY refusal naming the task-view rename,
checks the old complete result/receipt, closes the handle, retries refresh and
checks the replacement result/receipt. This verifies failure/recovery without a
delete-before-rename gap. See Microsoft's [file move requirements](https://learn.microsoft.com/en-us/windows/win32/fileio/moving-and-replacing-files).
