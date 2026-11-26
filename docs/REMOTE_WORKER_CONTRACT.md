Provider runtimes (config 3): use `chelm_memory_*` MCP tools or `chelm memory-worker`, worker contract 3 and `prompts/memory-worker-once.sudo.md`. Stage only semantic `changes.json`; no graph editing. See docs/MEMORY_PROVIDERS.md. The legacy file-worker procedure below applies only to config-2 runtimes.

# Remote worker contract v2

Chelm owns the authoritative runtime, source reservations, immutable snapshots,
staging, validation and publication. A remote MCP client supplies cognition using
its own inference. No server filesystem or remote agent callback is required.
Local CLI/stdio worker operations remain available to local agents; their seven
filesystem-based tools are separate from the eleven remote tools.

The remote service uses the official MCP SDK 1.32.2 and its negotiated supported
protocol revisions (2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05 and 2024-10-07), over stateless Streamable HTTP. Work state survives MCP
connection and service process lifetimes. Authentication identifies a principal;
executor ID/model/host are declared provenance, never authorization credentials.
Use a separate principal per independently running worker.

| Tool | Input and result |
|---|---|
| `chelm_request_work` | `request_id`, `executor:{id,kind,model,host}`, optional `max` (1..20), `subject_id`, `kinds`; returns assignment or `no-work` with retry delay |
| `chelm_list_work` | No arguments; list this principal's durable work and receipts |
| `chelm_work_status` | `work_id`, `attempt`; status including completed/expired work |
| `chelm_list_artifacts` | Work identity, optional `path_prefix`, `observation_id`, `offset`, `limit`; paged artifact manifest |
| `chelm_read_artifact` | Work identity, `artifact_id`, optional `offset`; text page and `next_offset` |
| `chelm_context` | Work identity and optional `filters`; retrieval against assignment input snapshot |
| `chelm_renew_work` | Work identity; extend expiry up to maximum lifetime |
| `chelm_abandon_work` | Work identity; mark abandoned, release reservation |
| `chelm_stage_output` | Work identity, `slot_id`, `revision` (1..100), optional byte `offset`, `text`, optional `final`; server returns next offset and final SHA-256 |
| `chelm_validate_candidate` | Work identity, `outputs:[{slot_id,revision}]`; validation and exact candidate digest |
| `chelm_submit_candidate` | Same outputs, returned `candidate_digest`, stable `submission_id`; committed receipt or integration work unit |

The endpoint selects one configured runtime (`/mcp/<runtime-key>`). Omitting the
key selects the first configured runtime. Principal allowlists are enforced for
every HTTP request. There is no client-supplied runtime path.

## Reading and writing

Assignments bind committed HEAD, purpose/profile policy, exact harness manifest,
selected sources and guidance v2. Each artifact has an opaque ID, relative role
name, size and SHA-256. Read pages use UTF-16 code-unit offsets; always follow
`next_offset` rather than calculate the next offset. Uploaded text is encoded by
the server; upload offsets are UTF-8 bytes and the returned `next_offset` is the
correct value. This distinction avoids splitting Unicode during reads or making
an agent calculate byte counts. `final:true` makes a revision immutable. An
identical retry is allowed; any changed bytes require a higher revision. Candidate
manifests refer to finalized revisions. The host computes all cryptographic hashes.

Each input snapshot and total upload storage are bounded to 64 MiB. Tool text
chunks are bounded to 32768 bytes; artifact reads are at most 8192 UTF-16 units.
Output slots restrict graph, hypotheses, summaries, question queues, the assigned
journal and applicable chat events. No arbitrary paths or uploads to policy,
observations, evidence, leases, ledger or vendor files are allowed. Required
journals have exact Started/guidance identity lines and actual declared model.
The host creates ledger entries and retained guidance snapshots itself.
Journal verification follows [CONTRACT_WORKER.md WRK-13](CONTRACT_WORKER.md):
record completed local checks, mark host checks pending and name a durable report
keyed by runtime/work/attempt/submission. Retain actual validation diagnostics,
returned warnings and the committed receipt there. An unchanged pre-validation
journal conforms; its own final tree hash belongs outside the candidate.

`chelm_context.filters` uses harness CLI names: query, entity, source, predicate,
type, kind, status, hops, expansion_budget, current, valid_at, limit, external_id,
scheme, namespace. `external_id` is a string paired with scheme and namespace.
Read the cited source artifact in full before using it.

## Ownership, retries and publication

A principal owns its work through the persisted work ID and attempt. Renew before
expiry. HTTP disconnect does not abandon work. A repeated request ID returns the
same work; a new batch needs a new request ID. Reconnect with list/status. Submit
retries must use the same submission ID and exact validated digest. A conflicting
retry refuses. A committed receipt includes HEAD and survives response loss.

Assignments default to 30 minutes, maximum lifetime 8 hours. No live instance
processing lease is held during inference. Final publication uses a short owner
lease, validates fresh source/ledger/policy state and CAS against current HEAD.
Live application intake and committed reads continue during remote inference.
Local workers exclude remotely reserved sources. Expired sources return to the
pool; old attempts cannot submit. An operator may cancel active work through the
local admin CLI. Terminal artifacts can be pruned after seven days; receipts stay.

If HEAD advanced, the supported harness merges completed candidate/base/current
snapshots. Record conflicts refuse without publishing. `requires_review` produces
an integration assignment with a new attempt and restricted summary/journal slots.
Review takes place without a long live lease; another HEAD change is rechecked on
submission. Sources remain reserved until integration completes/cancels/expires.

Useful error codes: work_not_owned, stale_attempt, work_inactive, policy_changed,
source_changed, already_processed, upload_conflict, digest_mismatch, bad_outputs,
validation_failed, busy, merge_conflict, recovery_required. Treat all other errors
as diagnostic failures, not no-work. Never report committed based only on upload
or successful validation.

SudoLang prompts are agent instructions, not an executable scheduler. No chain of
thought or complete inference transcript is required; journals record concise
source-grounded decisions, uncertainty and checks.

MCP prompts/get exposes chelm_remote_once, chelm_remote_loop and chelm_remote_integration; each includes the complete base procedure.


## Local observability additions (VP-021 / VI-021)

See [OBSERVABILITY.md](OBSERVABILITY.md) for the exact operation-log envelope,
executor/principal/OS identity distinction, optional runtime observability flags,
lock-free bounded read counters and read-only status.observability summary.
Worker submit accepts optional nullable numeric usage (model_ms, input_tokens,
output_tokens, cached_input_tokens). Omitted fields remain unknown/null. Remote
submission retries must retain normalized usage as well as digest/submission ID.
Existing runtime configurations remain valid; no instance migration is needed.

## Cognitive task binding v1

Use `chelm_request_work` with `work_kind:cognitive`, then the existing ownership,
artifact, upload, renew, status and submit tools. `chelm_cognitive_read` adds
idempotent round/context/source/receipt operations with host-retained delivery
receipts. Full schemas/defaults and local aliases: COGNITIVE_TASKS.md. Remote MCP
publishes `chelm_cognitive_once`, `chelm_cognitive_resume`, `chelm_cognitive_loop`
SudoLang prompts. Runtime/principal remain endpoint/authentication properties,
not fields in tool arguments. Existing observation request defaults are retained.
# Optional dispatch routing

Unreleased `cognizer-routing-v1` adds authenticated registration, finite readiness,
prefer/require policy, explicit fallback and scoped `deferred`/`busy` diagnostics.
It applies to new observation and cognitive assignments across all bindings;
existing owners and exact retries retain their original work/receipts.
See [routing contract](COGNIZER_ROUTING.md). Executor provenance cannot grant
priority or identify a trusted implementation. Absent/disabled policy preserves
the contract below. No worker tool exposes routing administration.
