# Contract App

Chelm-host 0.2.0 implements contract version 1. The following requirements are
from design draft 0.2. See [implementation and verification status](ACCEPTANCE.md)
for measured checks, platform checks awaiting CI, and deviations.

## 5. Conventions for both contracts

- `CON-1` CLI form: `node bin/chelm.mjs <command> [subcommand] --runtime <dir> [--input -] [--name value ...]`. Complex input is one JSON object on standard input (`--input -`) or in a file (`--input <path>`), never on the command line. This avoids Windows quoting problems.
- `CON-2` Output: exactly one JSON object on standard output, UTF-8 without BOM. Success: `{"ok": true, ...}`, exit 0. Refusal: `{"ok": false, "error": {"code": "<stable_code>", "message": "<text>", "details": {...}}}`, exit 1. Usage error: exit 2. Internal failure: exit 3 with the same error shape.
- `CON-3` Error codes are stable strings documented in the contracts (for example `instance_missing`, `instance_incompatible`, `lease_held`, `question_not_open`, `message_too_long`, `subject_unknown`, `malformed_sources`, `validation_failed`, `head_moved`, `policy_changed`, `capability_missing`, `capacity_exceeded`, `receipt_conflict`, `record_too_long`, `busy`, `package_invalid`, `harness_unsupported`).
- `CON-4` Every result includes `messages[]`: short, user-presentable lines describing notable steps (the consumer shows them as a request log), without observation text.
- `CON-5` Times are UTC ISO 8601 with milliseconds and `Z`. IDs: observation IDs are lowercase UUIDs; run IDs are lowercase UUIDs; request IDs are 32 lowercase hex characters; package IDs are lowercase UUIDs.
- `CON-6` Paths in results are forward-slash, instance-relative unless named `*_abs`.
- `CON-7` Read commands never write instance files. Commands that only read the read model never start child processes (`NFR-3`).

---

## 6. App contract v1

Each command lists input, output and refusals. Field lists are minimums; implementations may add fields.

### 6.1 Lifecycle and administration

- `APP-1` `version`, `verify`, `init`, `adopt`, `migrate`: see section 4.
- `APP-2` `status`: `{runtime_id, label, sandbox, instance_path_abs, exists, layout: {purpose_path, hypotheses_path}, head, harness_version, lease: {state, run_id, expires_at, reason}, counts: {inbox, ready, waiting_for_age, malformed, processed}, recovery_required, backend: {kind: "chelm-git"|"reference-git", contract_version, capabilities[]}, profile: {selected, path, vocabulary}, busy, busy_reasons[], read_model: {generated_at, head}}`. `busy` is true when a lease is held, a worker operation holds the operation lock, or an adoption is in progress.
- `APP-3` `reset --scope instance [--hard]`: refuses with `busy` while busy (same rule as today: a held lease blocks; an expired lease does not). Without `--hard`: moves the instance directory, the intake registry, the conversation log and the requests file into `<archive>/instance-<UTC yyyyMMdd-HHmmss>/`, initializes a fresh canonical instance as in `RT-10`, copying the previous `instance/purpose.md`, `golem.config.json` and the selected profile files when they exist and still validate (otherwise the initializer defaults, with a message), creates empty host files and republishes. Returns `{archived_to, head}`. Nothing is deleted. `--hard` (sandbox only): deletes and recreates the runtime.
- `APP-4` `admin-stats`: rows `{label, value}` for: observations sent (inbox), observations processed (ledger rows), sources, entities, claims, questions, evidence files, subjects with intake records, conversation messages, instance commits since the baseline; plus `files` (instance files changed or added since the baseline) and `latest` (latest write time among them). The baseline is the latest commit whose subject starts with `init:`; without one, all commits and all files count.

### 6.2 Intake

- `APP-10` `submit`: input `{subject_id?, groups: [{kind, chunks?: [text], lines?: [text], max_chars?: n, oversize?: "truncate"|"refuse", extra_headers?: {key: value}, receipt?: {namespace, record, revision}}], index?: true}`. Exactly one of `chunks` or `lines` per group. With `lines`, Chelm-host chunks them with the algorithm in `APP-11`. For each group it computes the content key (`APP-12`); if the subject already has that key, the group is skipped; otherwise each chunk is written as one inbox note (`APP-13`), the group is recorded in the registry `{key: "<kind>:<content_key>", kind, content_key, ids, created_at}`, and finally the harness indexer runs once when anything was written and `index` is not false. Output: `{written, skipped_groups, indexed, groups: [{kind, content_key, status: "written"|"skipped", observation_ids}]}`.
- `APP-11` Chunking: lines are appended with a trailing LF; a new chunk starts when adding the next line plus its LF would exceed `max_chars` and the current chunk is not empty. `max_chars` defaults to `intake.max_observation_chars`. A line longer than `max_chars` is handled by `oversize` (default `intake.oversize`): `truncate` (the consumer's current behaviour, required for parity) cuts it to `max_chars - 4` characters plus `" ..."`; `refuse` refuses the whole submission with `record_too_long` and writes nothing. `refuse` follows the harness producer recipe, which refuses an oversized record instead of cutting it mid-revision (`docs/INTAKE_PROVENANCE.md`).
- `APP-12` Content key: SHA-256 (lowercase hex) of the UTF-8 bytes of `kind + U+001F + join(U+001F + LF, bodies)`, where each body is the chunk text with CRLF replaced by LF and trimmed. The collection time is not part of the key. For registry entries without a stored key (adoption), the key is computed from the bodies of their notes; if any note is missing, the entry has no key and never matches.
- `APP-13` Inbox note format (byte-exact, UTF-8 without BOM, LF only), written atomically (temporary file in `inbox/` with a non-`.md` suffix, then rename):

```text
---
id: <lowercase uuid>
recorded_at: <UTC ISO with ms and Z>
kind: <kind>
<subject_header>: <subject_id>          (only when subject_id is given)
chunk: <i>/<n>                          (for every group chunk, including 1/1)
<extra header>: <value>                 (each extra, in input order)
---

<body, CRLF to LF, trimmed>
```

  Header keys MUST match `^[a-z_]+$`; values MUST be single-line; values that need quoting are written as JSON strings (harness rule). Reserved keys (`id`, `recorded_at`, `kind`, `chunk`, the subject header, `question_id`, `question_text`, `question_source`) cannot be passed as extras. The headers `event_date` and `origin_ref`, which the harness parser accepts as upstream context, MAY be passed as extras. They are data and carry no readiness or independence meaning (`docs/INTAKE_PROVENANCE.md`).
- `APP-14` `index`: runs the harness indexer explicitly and returns `{indexed}` (number of output lines starting with `Indexed:`).
- `APP-15` Intake without a subject (conversation messages) is not deduplicated.
- `APP-16` Producer receipts (optional, capability `producer-receipts-v1`). The receipt follows the harness producer recipe in `docs/INTAKE_PROVENANCE.md`: upstream namespace, record and revision identify one receipt. A group with a `receipt` is checked against the receipts in the intake registry before anything is written:
  - same receipt and same content key: the group is skipped;
  - same receipt and a different content key: the whole submission is refused with `receipt_conflict` (the recipe refuses a changed payload for a retained revision);
  - new receipt: the group is written.

  The receipt is recorded together with the registry group in the same host-state write. On any failure no receipt is recorded, and nothing is recorded for a partially written submission (written notes are listed in the error so the application can see them). Receipts are separate from the processed ledger: new observations stay pending until a normal analysis. Groups without a receipt use the content key only (`APP-12`), as the consumer does today.

### 6.3 Conversation

- `APP-20` `ask`: input `{text}`. Refuses empty text and text longer than `intake.max_message_chars` (default 4000). Writes a `user_question` observation, runs the indexer, appends a user turn `{at, role: "user", text, observation_id, question_id: ""}`, then runs harness retrieval (`context --query <text> --limit 5`; an optional input `retrieval: {...}` with the filters of `APP-33` is added to that call, for example an external ID the application recognized in the message). With at least one claim: mode `retrieval`; matches are grouped by `(classification, first source quote)`, keeping the order of first appearance and the distinct predicates of each group; the first three groups are returned. Without claims: mode `pending`. Appends a Golem turn `{at, role: "golem", text, observation_id, mode, matches}`. Output `{mode, observation_id, indexed, matches: [{classification, predicates[], quote}], text}`. `text` is the neutral default wording in `APP-24`.
- `APP-21` `answer`: input `{question_id, text}`. Refuses with `question_not_open` unless the question exists in the committed question queue with status `open`. Writes a `question_answer` observation with headers `question_id`, `question_text` (the question text as a JSON string) and `question_source` (`intake.question_source`), runs the indexer, appends the user turn (with `question_id`) and a Golem turn with mode `queued`. Output `{mode: "queued", observation_id, indexed, text}`.
- `APP-22` `conversation`: output `{messages: [last conversation.tail turns], answers: {<observation_id>: {text, at}}, open_questions: [{id, text}], questions: [{id, text, status, at, source_observation_id}]}`. `answers` come from committed `memory/events/chat/<observation_id>.json` (`answer`, `answered_at`) for observation IDs present in the turns. `questions` is every entry of the committed question queue; `at` is its `created_at`.
- `APP-23` The conversation log is append-only. Each line is one JSON object (Appendix A.10).
- `APP-24` Default texts (English, neutral; applications may render their own from the structured fields): retrieval: `"Retrieval, not analysis: <n> matching claim(s) in analyzed memory."` followed by one line per group `"- [<classification>] <predicates joined by ', '>: <quote>"`; pending: `"No analyzed memory matches this yet. Your message is queued as observation <id> for the next analysis cycle (<k> indexed)."`; queued: `"Queued as answer to <question_id> (observation <id>). The analysis cycle will review it; the answer appears here when analysis writes it."`

### 6.4 Reading

- `APP-30` `read <view>` returns the current content of a read-model view (section 10) and is equivalent to reading the file. `read summary --deep` additionally runs `memory-tool validate` and `memory-tool stats` on the committed snapshot and returns `validate: {ok, message, layout, warning_summary}`, the validator `warnings` (as returned, at most 1,000), and from `stats` the `capacity`, `totals` (0.9.1: `observations, processed, pending, entities, claims, relations, active_claims, open_questions`), `timeline`, `definitions` and `graph_updated_at`, all unchanged. Totals the harness adds later are passed through.
- `APP-31` `inspect <metric> [--subject <id>]` returns a table `{title, source, fetched_at, note, columns[], rows[][], total, truncated, text}` with at most 500 rows and at most 400 characters per cell (`truncated` set when cut). Metrics and columns:
  - `inbox`, `pending`: `observation_id, kind, recorded_at, subject_id, processed, first_line` (newest by file write time, at most 500; `first_line` is the first non-empty body line, at most 160 characters; `pending` lists those without a processed ledger row).
  - `evidence`: `observation_id, analyzed, size_kb, written_utc, top_level_keys` (newest first, at most 500; first eight keys).
  - `processed`: ledger rows as stored.
  - `entities`, `claims`: graph records as stored.
  - `relations`: claims whose `object.entity_id` is non-empty, including superseded and retracted ones; columns `id, subject, predicate, object, classification, status`.
  - `hypotheses`: records from `memory/hypotheses.json` (the path reported in `layout.hypotheses_path`); columns `id, statement, status, confidence, support, refutation, updated_at, model` (hypotheses schema 1; arrays joined with `, `).
  - `warnings` (new; not shown by the consumer today): the validator warnings of the committed snapshot, columns `code, object_id, message`, plus `warning_summary` in `note`. The 0.9.1 codes include `capacity_near_limit`, `multiple_active_values`, `duplicate_external_id`, `dependency_changed`, `duplicate_corroboration`, `unknown_kind`, `unknown_predicate`, `unknown_external_id_scheme` and `unused_entity`. Warnings prompt review and decide nothing (harness rule); the default `text` says so.
  - `open-questions`: open entries of the question queue.
  - `lease`: rows `field, value` starting with `state` (`held`, `expired` or `idle`, `APP-35`), then each lease field; `note` explains the state.
  - `journals`: one row per journal, newest first (`APP-36`).
  - `last-cycle`: `text` is the newest journal (at most 20000 characters).
  - `validation`: `text` is the harness validator output for the committed snapshot.
  - `conversation`: `at, role, text (400 chars), observation_id, mode_or_question`, newest first.
- `APP-32` `get item <id>`: one graph record by ID; the ID MUST match `^(clm|ent)-<uuid>$`. `get journal <run>.md`: the run name MUST match `^<uuid>\.md$`; returns text (at most 20000 characters). `get observation <uuid> [--subject <id>]`: returns the inbox note, the evidence file and the chat event if present (each at most 60000 characters), whether it is analysed, and, with a subject, the registry group it belongs to (kind, created_at).
- `APP-33` `context`: input `{query?, entity?, source?, limit?: 20, predicate?, type?, kind?, status?: "active"|"all", hops?: 1..3, expansion_budget?: 1..20000, current?: bool, valid_at?: <UTC ISO>, external_id?: {value, scheme, namespace}}`. It maps one to one to the 0.9.1 `memory-tool context` options (`--query`, `--entity`, `--source`, `--limit`, `--predicate`, `--type`, `--kind`, `--status`, `--hops`, `--expansion-budget`, `--current`, `--valid-at`, `--external-id --scheme --namespace`) and returns the harness result unchanged, including `limits`, `truncated`, `method`, `source_excerpts`, `current_selection`, `current_ties` and `hidden`. `limit` is 1 to 100. Chelm-host checks only shapes and ranges; meaning is the harness's. An empty result does not mean absence (pending or uncollected inputs); the default `text` says so.
- `APP-34` `subject <id>`: `{groups: [...], kinds: {<kind>: {observed, indexed, analyzed}}, sets: {<name>: {observed, indexed, analyzed}}}`, where `observed` counts the observation IDs in the subject's groups, `indexed` those with an evidence file, `analyzed` those with a processed ledger row. `sets` are named kind sets declared by the application in the runtime configuration (`intake.kind_sets`, for example `{"records": ["profile", "children_digest"], "changes": ["change_digest", "file_digest"]}`). `subject <id> rows --kinds a,b --filter all|indexed|analyzed`: rows `observation_id, kind, sent_at, evidence, analyzed`.
- `APP-35` Lease state rule: `held` when `status` is `processing` and `expires_at` is later than now; `expired` when `status` is `processing` and `expires_at` has passed; `idle` otherwise. Only `held` makes the runtime busy.
- `APP-36` Journal row statistics (for each `memory/runs/<run>.md`): `observations` = ledger rows whose `run` equals `memory/runs/<run>.md`; `committed` = the latest `processed_at` among them; `started` = the value after `Started:` in the journal text (blank if absent); `ended` = the journal's commit time in the instance history (today the consumer uses the file's last write time; the commit time is preferred because the read model works from committed state); `duration` = ended minus started; `observation_kinds` = counts of `kind` from the evidence files of those observations; `entities`, `claims`, `relations`, `source_assertions` = graph items citing those observations (entities by `source_ids`, claims by `sources[].observation_id`; `source_assertions` are claims classified `source_assertion`, the consumer's current rule on graph schema 2; it replaced the earlier count of `user_declaration`); `questions_opened` = queue entries whose `source_observation_id` is one of them; `unresolved` = those still open.

### 6.5 Source transfer

- `APP-40` `export-sources --subject <id>`: `{subject_id, registry_groups[], observations: [{id, inbox, evidence}], observation_count, missing_notes, analysed}`; `inbox` is the full note text; `evidence` the parsed evidence object or null; IDs whose note is missing are counted in `missing_notes` and left out.
- `APP-41` `import-sources`: input as exported plus `replace_registry?: false`. Validates every ID (lowercase UUID) and note (starts with `---` and contains `id: <id>`); any failure refuses the whole import. Writes each missing note (byte-exact) and each missing evidence file, runs the indexer when a note was added (an indexer failure is reported, not fatal), and merges the registry groups for the subject (or replaces them with `replace_registry`). Never writes the ledger, graph, queues, events, hypotheses or conversation. Output `{added, present, evidence_added, pending, index_error, unresolved_question_links: [{observation_id, question_id}]}`. `unresolved_question_links` lists imported `question_answer` notes whose `question_id` is not in the destination's committed question queue. `docs/PROCESSING.md` ("Moving observations to another instance") requires the question record to be restored, or the dependency resolved, before such a note is processed. Chelm-host reports the gap and does not write question records itself.

### 6.6 Requests from cognition to the application

- `APP-50` A request is `{id, kind, subject_id, reason, status, created_at, created_by, updated_at, note}`. `status` is `proposed`, `accepted`, `rejected`, `fulfilled` or `cancelled`. `kind` MUST be one of `requests.kinds` in the runtime configuration; `reason` is cut to `requests.reason_max_chars`.
- `APP-51` Creation (worker `propose`, section 7) refuses when the subject already has `requests.max_open_proposed_per_subject` requests in `proposed`, and returns `{duplicate: true, request}` when an open request (`proposed` or `accepted`) for the same subject and kind exists.
- `APP-52` `requests list [--subject] [--status]` and `requests set --id <id> --status accepted|rejected|fulfilled|cancelled [--note]` (allowed transitions: proposed to accepted, rejected or cancelled; accepted to fulfilled or cancelled). The application maps accepted requests to its own jobs; Chelm-host never runs them.

### 6.7 Delegation (application view)

- `APP-60` `delegate offer`: input `{observation_ids?: [], subject_id?: "", expires_hours?: n, note?: ""}` (at least one selector). Allowed only with `delegation.enabled`. Selects pending, unclaimed, unreserved sources, reserves them (section 9), writes a package (section 9.3) and returns `{package_id, observation_ids, expires_at}`.
- `APP-61` `delegate list`: packages with `{package_id, status, observation_ids, created_at, expires_at, taken_by, taken_at, returned_at, adopted_at, refusal}`; status `offered`, `taken`, `returned`, `adopted`, `refused`, `expired`, `cancelled`.
- `APP-62` `delegate adopt [--package <id> | --all-ready]`: integrates returned results (section 9.4). Safe to call concurrently from several callers (for example a page button and an agent loop): one succeeds, the others report `already_adopted` or `busy`.
- `APP-63` `delegate cancel --package <id>`: releases the reservation; a later result for it is refused.

---

## New additive operations

- profile install --source MIRROR: byte-exact mirrored guidance installation.
- profile check|status --source MIRROR: compare selected configuration/files.
- status.profile.expected: optional expected-profile comparison.
- adopt --input JSON: intake_stores [{path,subject_id}] mappings; consumer request
  imports accept {jobs:[...]}. See RUNTIME.md for relative-path semantics.
- New refusals: subject_required, subject_conflict, profile_invalid, profile_dirty,
  profile_mismatch. Missing expected profiles produce matches:false in checks and
  profile_mismatch in an enforced worker next.

Explicit `chunks` preserve their boundaries. Each chunk is subject to the same configured or per-group `max_chars` and `oversize` as a line: `refuse` rejects the whole submission before writes; `truncate` retains the first `max_chars - 4` UTF-16 code units followed by `" ..."`. CRLF is normalized before measuring. Option values are validated for both input forms.


## Local observability additions (VP-021 / VI-021)

See [OBSERVABILITY.md](OBSERVABILITY.md) for the exact operation-log envelope,
executor/principal/OS identity distinction, optional runtime observability flags,
lock-free bounded read counters and read-only status.observability summary.
Worker submit accepts optional nullable numeric usage (model_ms, input_tokens,
output_tokens, cached_input_tokens). Omitted fields remain unknown/null. Remote
submission retries must retain normalized usage as well as digest/submission ID.
Existing runtime configurations remain valid; no instance migration is needed.
