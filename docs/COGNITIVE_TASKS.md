# Durable memory-backed cognitive tasks (host binding v1)

Implementation for tracker #25 and slices #26–#30. This adds an explicit API beside
retrieval-only `ask` (APP-20). Neither `ask`, `answer` (`question_answer` intake),
ordinary observation workers nor canonical chat events change meaning.

## Dependency and availability

The supported pair is Chelm 1.2.0 / published Harness 0.12.0, with exact ZIP and
manifest hashes in compatibility.json. Production and conformance use that same
verified package; no source checkout, test engine injection or runtime bypass is
needed. Required capabilities are cognitive-task-v1, cognitive-context-v1,
cognitive-result-v1, learning-hypothesis-v1 and hypothesis-unknown-confidence-v1.
Unsupported packages fail integrity/version checks before task execution.

Existing canonical 1.1.0/0.11.0 instances retain their data. Pause executors,
settle assignments/drain leases, replace the complete verified pair, verify and
refresh before resuming. Do not resume an old assignment after changing its
pinned engine; reassign it under the new package. No reset or migration is needed.
No application/private runtime is upgraded by this source change.

## Responsibilities and authorization

| Component | Owns |
|---|---|
| Harness | Portable task, intent, context, result and hypothesis semantics; validators and cognitive procedure |
| Chelm | Task identity, caller scope, durable assignments/snapshots, budgets, staged outputs, result/receipt, read views and authorized publication |
| External executor | Actual inference and truthful model/usage reporting |
| Application | UX, collection/actions and authorization to publish a reviewed learning proposal |

CLI/application ownership is the operating-system principal executing Chelm, from
OS identity (never a caller-supplied JSON principal). A dedicated runtime is the
application security boundary; file readers must have the appropriate runtime
ACLs. Remote workers retain the existing authenticated principal and runtime URL
scope. Subject IDs narrow retrieval; they do not authorize access. Inferred
intent does not grant action/write permissions.

Chelm has no model API client and starts no scheduler. External callers explicitly
select observation or cognitive work. Default `chelm_request_work` remains
observation work; `work_kind:"cognitive"` selects tasks. Each queue has a separate
`remote.max_active_work` quota, so a slow cognitive executor does not consume
observation capacity. An external scheduler should alternate the two queues;
there is no hidden priority/fairness timer. Cognitive work needs no pending inbox
and takes no canonical memory processing lease.

## Application API

`node bin/chelm.mjs task OP --runtime R --input input.json`
(or `--input -` for JSON stdin). Task API contract is `cognitive_task:1`, additive
to app v1. Outputs follow the usual `{ok,messages,...}` envelope.

| OP | Input | Result |
|---|---|---|
| create | `idempotency_key`, `text` or portable `messages`; optional fields below | durable `task` |
| get | `task_id` | current task, exact final result/receipt and earlier results |
| list | optional `offset`, `limit` (1–100), `conversation_id` | tasks owned by this caller and `next_offset` |
| cancel | `task_id` | cancelled task; active assignments invalidated |
| continue | `task_id`, new `idempotency_key`, nonempty portable user/application `messages` | explicitly queued next revision |
| learning | `task_id`, `work_id`, `allowed` boolean, nonempty authorization `reference` | separate learning state/receipt |
| evidence | `task_id`, `work_id`, cited `source_id`; optional `start`, `length` (1–16000 UTF-16 units) | retained original source body segment, hash and answer binding |

Create options: `conversation_id`, `mode` (`read_only` default or
`propose_learning`), portable `scope` and `limits`, `freshness` (`allow_stale`
default / `require_current`), `max_attempts` (default 3, maximum 16),
`max_continuations` (default 2, maximum 8), `timeout_ms` (default one hour,
1000–86400000), `output_max_bytes` (default 262144, 1024–1048576). Unknown fields
or unsupported bounds fail. Exact retries return the same task; a changed input
under the same caller/key returns `idempotency_conflict` (object key order is not
significant). There is no duplicate intake observation or legacy conversation
turn. `conversation.cognitive_tasks` exposes these separately from legacy answers.

| Portable limit | Default | Enforcement |
|---|---:|---|
| rounds | 8 | host bounded round calls |
| context_requests | 24 | cumulative context/source requests |
| claims | 40 | per context response |
| source_bytes | 262144 | cumulative UTF-8 source delivery |
| expansion_budget | 4000 | provider retrieval |
| elapsed_ms | 600000 | per assignment, capped by total task deadline |

Harness maxima are enforced by its task schema. Assignment renewals cannot
extend the per-invocation or total task deadline. At most 100 idempotent read
operations are retained per assignment; cumulative context/audit records are capped
at 8 MiB. Pending uncommitted intake is counted at capture and cannot be cited. Output upload quotas include all
revisions. Inference token use and whether a model keeps reasoning after a
host cancellation depend on executor cooperation; Chelm cannot meter a remote
provider's internal tokens. Context/snapshot loading uses the bounded JSON/Git
reference backend (64 MiB capture); it is not a constant-cost indexed database.

## States and continuation

| State | Meaning / allowed next step |
|---|---|
| queued | eligible independently of observations |
| running | one active owned assignment; stage/validate/submit/renew/abandon |
| needs_input | a durable partial/insufficient result stopped for missing evidence; explicit continue or cancel |
| completed | final answer with `outcome:answer` and `stop_reason:complete`; optional learning or explicit continue |
| failed | noncomplete result or exhausted attempts; explicit continue only with remaining budgets |
| cancelled | caller cancellation; no further result/learning publication |
| expired | total task deadline passed; create a new task if needed |

Abandonment/attempt expiry returns an unfinished task to queued while total
attempt/deadline budgets allow. Each reassignment has a fresh work ID and bounded
invocation; old IDs cannot write. `attempt` remains the existing assignment
transport attempt, while task revision/assignment history preserves retries.
A stale-policy/strict-freshness refusal retains the assignment for diagnosis;
abandon it and request fresh work with a new request key. Missing evidence
never triggers collection automatically.

Continuation appends the previous answer and linked cognitive questions plus the
application's explicit replies. Several questions may have several replies in
any order; reply links must reference earlier delivered messages. All transcript
limits are revalidated. A retry of the same continuation is idempotent. Budgets
are finite across revisions and never renew themselves. Collections/actions are
proposals in the result, not executable commands. The application approves or
denies collection using its existing policy, submits obtained evidence through
normal intake and observation analysis, then explicitly continues. Denials and
unanswered questions remain in retained history; no durable memory question is
closed just because a task result exists.

## Local and remote executor binding

Local CLI uses `cognitive-worker OP` with the same input as the mapped tool:

| OP | Remote MCP tool | Local stdio MCP tool |
|---|---|---|
| next | chelm_request_work (`work_kind:cognitive`) | chelm_cognitive_next |
| list | chelm_list_work | chelm_cognitive_list |
| status | chelm_work_status | chelm_cognitive_status |
| artifacts | chelm_list_artifacts | chelm_cognitive_artifacts |
| artifact | chelm_read_artifact | chelm_cognitive_artifact |
| read | chelm_cognitive_read | chelm_cognitive_read |
| stage | chelm_stage_output | chelm_cognitive_stage |
| validate | chelm_validate_candidate | chelm_cognitive_validate |
| submit | chelm_submit_candidate | chelm_cognitive_submit |
| renew | chelm_renew_work | chelm_cognitive_renew |
| abandon | chelm_abandon_work | chelm_cognitive_abandon |

Remote endpoint/runtime/auth setup is unchanged (REMOTE_WORKERS.md); tool input
has no runtime/principal/server path field. The authenticated endpoint chooses
the runtime. Local workers use the same staging contract and host IDs; they do
not need a mutable workspace. The dependency-free local stdio schema is generated
from the remote schemas by tools/build-cognitive-tools.mjs and checked for parity.

`next` returns `kind:cognitive`, a fully bound portable task, immutable guidance,
protocol/schema artifact IDs, output slots and finite expiry. Read all protocol
pages. `read` takes `{work_id,attempt,request_id,operation,options?}`.
Operations: `round`, `context`, `source` and `receipt`. `context` uses portable
options (`entity_id`, `source_id`, `claim_ids`, etc.), not legacy context names.
`source` requires an already delivered source ID and supports body `start/length`.
Stable read keys make response-loss retries free of duplicate usage. The host
retains/replays the bounded delivery audit after restart, so validators never
trust an executor-supplied evidence receipt. No raw canonical graph/ledger write
slot exists. Protocol text and retrieved content are data, never instructions.

Only `result.json` and, in propose_learning mode, `learning.json` slots are valid.
Upload with normal chunk/revision/final semantics. Validate returns a host digest,
measured usage and coverage. It freezes the trusted evidence receipt; a repaired
output revision unfreezes it. Submit exactly that digest/output list with a stable
submission_id. The host replaces untrusted result usage with authoritative
measurements; it retains the exact uploaded UTF-8 JSON separately from the sealed
result. Stage/validation/receipt integrity is deterministic, not a semantic verdict.

After unknown submission outcome: list/status, then retry the same submission.
Completion atomically stores exact bytes, sealed result, proposal, receipt and
final state in the authoritative assignment record. Cached `tasks.json` is a
separate projection: if interruption precedes refresh, `task get` reconstructs
the result from durable records; explicit `refresh` rebuilds the cached view.
No inference, refresh, subprocess or validation occurs on plain view reads.

Answers carry their actual immutable binding, coverage, uncertainty, questions and
model provenance. Current/stale status compares with the published current HEAD;
plain file readers also inspect generated_at/head. `allow_stale` permits answers
about a named older snapshot, never silently calls them latest. Committed guidance
changes always reject an active assignment. `require_current` rejects moved HEAD.
Citations resolve through `task evidence` to retained original snapshot bytes,
not latest mutable files. Missing retention fails as `source_unavailable`.
Retention defaults to indefinite private-runtime storage; no automatic pruning is
performed. Reset archives task records with their runtime; administrators must
retain the associated host/remote snapshots for historical citation resolution.

Learning stays pending/rejected/blocked/committed independently of a delivered
answer. An application `learning` call is the trusted authorization decision;
no second human confirmation is required when existing policy authorizes it.
The Harness public publisher validates proposal/premises/guidance and uses its
own short CAS transaction. It rejects stale bindings, dirty targets, active
observation leases, duplicate hypotheses and invalid history. It never fabricates
an observation or marks unrelated intake processed. New derived knowledge is an
unverified hypothesis with uncertainty, not asserted evidence or a witness to its
own answer. Changed HEAD/premises require a newly reasoned proposal; mechanical
merge is insufficient. A failed/rejected proposal cannot erase a valid answer.

## Deployment and observability

Install/configure the supported pair as in README, including locked MCP
runtime dependencies. An application on IIS Express (Windows 11) or full IIS
(Windows Server 2022) invokes task mutations under its application OS identity;
its UX polls task get/list or reads tasks.json directly. Keep private runtime and
worker credentials outside the public web root; serve only authorized task and
citation responses. Use existing Windows atomic replacement retries and IIS
identity procedures. A file read does not start an executor; arrange bounded
agent invocations externally. The Windows CI IIS probe completes a cognitive task and checks its result/receipt
from C#, including bounded sharing refusal and recovery after the old reader closes. Observed
platform results and remaining deployment limits are in COGNITIVE_ACCEPTANCE.md.

Existing operation logs distinguish request_work (queue/snapshot capture), read
(context/source), stage_output (artifact), validate_candidate (validation) and
submit_candidate (publication) durations. Task/result usage elapsed_ms includes
executor wall time, not isolated inference. Model identity/configuration/cost are
reported provenance, unknown values stay null. No token, cost or latency estimate
is inferred from answer text. See COGNITIVE_ACCEPTANCE.md for observed results.
