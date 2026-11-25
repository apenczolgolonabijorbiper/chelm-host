# Portable local runtime sessions — contract 1

Implements the local-session design in #45, #46, #47 and #48. Applications keep
their source repository, private runtime and durable storage in separate roots.
The local agent runs Chelm, the exact supported Harness, Python, Node and Git.
Inference remains external and uses the existing worker/cognitive contracts.
Neither a GitHub memory remote/token nor a permanent server or distributed MCP
is required. The hosted control plane only authenticates, queues inputs,
coordinates sessions and stores checkpoints/results.

The current upstream pair remains Chelm 1.3.0 / published Harness 0.13.0.
These additions are unreleased until a new version is qualified and published.
Checkpoint v1 requires the **exact host code identity** and Harness manifest
identity that created it. A new compatible reader requires explicit versioned
implementation/testing; there is no implicit migration or downgrade fallback.
See [LOCAL_SESSION_ACCEPTANCE.md](LOCAL_SESSION_ACCEPTANCE.md) for observed
checks and the remaining external acceptance requirements.

## Complete-runtime inventory (LCS-1)

| Component | Checkpoint policy |
| --- | --- |
| Canonical instance and pending inbox/evidence | Exact working bytes; require committed files unchanged and index clean. Pending intake may remain untracked. |
| All attached local Git branches/tags and reachable history | Complete SHA-1 bundle v2; retain every historical provider snapshot used by a completed answer on a branch/tag. No pruning of reachable history. |
| Purpose, selected profiles, vocabulary, graph, processed ledger, questions, hypotheses, journals, events, learning and provider-state.json | Allowlisted paths, exact bytes/history; validate with public Harness logic. Unknown instance files/history paths refuse. |
| Intake registry, conversations and collection requests | Exact host files; preserve IDs and completion deduplication. |
| Tasks and all terminal assignment records | Preserve results, accepted bytes, authoritative receipts, learning decisions and citation bindings. Replace task owner with a restore placeholder and assignment principal with inert `checkpoint:retained`. |
| Retained config-2 citation source snapshots | Exact per-answer source bytes, checked against trusted source hashes. Config-3 resolves the retained provider snapshot from Git history. |
| Historical file-worker metadata | Retain under host/checkpoint/workers.json with actor/host authorization removed. New host/workers.json starts empty. |
| Runtime settings/provider selection | Allowlisted logical settings and runtime ID. Reconstruct instance/archive paths and Git identity; bind executables/Harness path from trusted local CLI options. |
| External expected profile source | Preserve enforcement requirement; require explicit `--source` rebinding and compare installed guidance when enforcement is enabled. |
| Read models/stats | Regenerate before activation; bind the summary's absolute path to the final root. |
| Worker artifact downloads, drafts/uploads, sandbox clones | Terminal records and citation bytes are authoritative; these caches are omitted. Historical worker credentials cannot be reused to run/renew/submit. |
| Credentials, remote auth, session authority, sockets, PIDs, locks, vendor packages, dependencies, Git remotes/helpers/config/hooks | Omit. Restore creates safe fresh Git metadata from the bundle, without checkout filters/hooks. |
| Logs, metrics, old reset archives, provider-upgrade audit marker | Omit: historical administration/telemetry outside the live runtime. Active provider metadata remains in config and provider-state.json. |
| Adoption/cutover/publication recovery, adapter mutexes, active or expired unresolved assignments/processing leases | Refuse. The host never cancels or edits protocol state to make an export succeed. |

Checkpoint creation serializes Chelm writers with the normal operation lock.
All runtime writes must go through Chelm; independently editing files or running
the reference adapter concurrently bypasses the host contract. Release such
writers before checkpointing. Unreachable Git objects/reflogs are not inventory:
retain required snapshots on local branches/tags first. Runtime instance/archive
roots must be exactly `instance` and `archive` inside the private runtime.

## Create, inspect, restore (LCS-2)

```text
node bin/chelm.mjs checkpoint create --runtime PRIVATE --output OUTSIDE/checkpoint.json
node bin/chelm.mjs checkpoint inspect --runtime PRIVATE --checkpoint OUTSIDE/checkpoint.json
node bin/chelm.mjs checkpoint restore --runtime FRESH --checkpoint OUTSIDE/checkpoint.json --sha256 TRUSTED_DIGEST --harness EXACT_HARNESS --apply
```

`inspect` is read-only and needs no existing runtime. `restore --apply` is the
trusted local decision to give the current authenticated OS account ownership
of restored tasks. An archive never selects an OS account/executable or grants
worker authority based on a saved executor description. The digest must come
from a trusted checkpoint receipt or an independently authenticated handoff.
Use `--python`, `--git` and `--source` only as trusted environment bindings.

The public envelope is [runtime-checkpoint.schema.json](../schemas/runtime-checkpoint.schema.json).
Entries are base64 bytes in exactly manifest order; each has a decoded size and
SHA-256. `checkpoint_id` hashes pretty-printed manifest JSON with a final newline;
`sha256` hashes the complete archive. The schema describes structure; path,
package, hash, Git and logical checks in the implementation are authoritative.
Identical settled content/binding produces identical bytes. Creation uses a
private temporary file and exclusive link publication; an existing different
output refuses. Interrupted staging never replaces the previous checkpoint.

Limits: 140 MiB envelope, 96 MiB decoded components, 20,000 entries, 2,000
reachable commits, 100 branches/tags, 64 MiB per expanded Git object and 512 MiB
expanded bundle/history. The Git pack scanner bounds compressed expansion
before import. Portable paths, regular files, no hardlinks/symlinks, no executable
Git tree modes, canonical base64 and exact hashes are required. Arbitrary local
config/remotes/hooks are never restored. Source Git history containing unknown
paths (including secret files) refuses; runtime evidence itself remains private
content and must be treated as such by the application.

Restore requires a nonexistent target, stages beside it with private permissions,
verifies exact package identities, bundle refs/objects/history, working bytes,
citations and Harness validation/provider audit, then atomically renames the
validated root. Failures leave the source and durable checkpoint untouched.
Fresh process ownership and paths are reconciled explicitly. No active worker,
lease or publishing-session credential survives restore. Completed task
deadlines, budgets and IDs remain unchanged; queued work gets a new assignment
through the ordinary contract. Expired task deadlines remain expired.

## Durable coordinator/object store (LCS-3)

`lib/durable-session.mjs` is storage-neutral. Construct `DurableSessions` from
trusted application identity `{runtime_id, principal, expected}`. `expected`
contains the exact host version/code hash and Harness version/manifest hash from
the deployed package's checkpoint identity. Never trust these bindings from a
browser request. Authorization must happen before store/namespace selection.

| Required store method | Atomicity/semantics |
| --- | --- |
| readState(runtime_id) | Persistent consistent state or null; version is monotonic. |
| compareAndSwap(runtime_id, expected_version_or_null, next) | Linearizable single transaction, across independent processes/requests; return true only if committed. Never emulate with read-then-unconditional-write. |
| putImmutable(key, bytes) | Atomic whole-object create; exact repeat permitted, different bytes refuse. Object keys/versions never overwritten. Ambiguous failures remain registered upload attempts. |
| getObject(key) | Strongly consistent whole bytes or null. |
| deleteObject(key) | Strongly consistent idempotent deletion of the key and all adapter-controlled staging/versions associated with it. |

Applications implementing object versioning must inventory/delete every controlled
version. A local mutex is only appropriate for the standalone filesystem fixture;
it is not a distributed fence. The optional D1/R2 adapter performs SQL version
CAS in D1 and uses conditional immutable puts in R2. Provider-operated backups
and physical storage retention are separate from controlled live-object purge.

Sessions bind owner, runtime, reset generation, session ID, fencing counter,
expiry and exact base revision. Default authority is one publishing session.
Acquisition/renewal uses coordinator time (1s–15min TTL; 8h maximum lifetime).
Use a unique session ID for each workspace and a new ID after reset; old IDs
remain in the local-copy cleanup inventory.
Every publication checks the fence at the **actual CAS selecting head**, after
immutable upload/readback validation. Checkpoints uploaded for publication must
have `manifest.durable_binding = {generation, base_revision}`; offline archives
without this binding cannot silently become a new generation's current head.

Call `acquire`, `renew`, `release`, `intake`, `progress`, `upload`, `publish`,
`recover`, `download`, `reset`, `sweep`, `discardUpload`, or `localCleanup` via the
public JS API. JSON binding uses `/chelm-session` and the operation allowlist in
`integration/local-session/transport.mjs`. There are no arbitrary filesystem paths,
model calls or general remote command execution in that binding.

`publish(binding, {submission_id, request_ids, projection})` atomically selects
the head and app-visible projection and acknowledges only the explicitly listed
checkpoint-pending requests. Original immutable receipts remain recoverable by
stable generation/submission ID after response loss. An exact publish retry
returns its original receipt while authority is valid, without advancing head;
after expiry use authenticated `recover`. A changed retry refuses. Concurrent
same-base competing publications cannot both select head. Historical checkpoints
are retained until full reset, including versions required by live citations.
Unselected verified uploads may be discarded explicitly; uncertain/in-flight
writes refuse discard and remain inventoried.

## Intake, publication failures and replay (LCS-4)

Persist every input/evidence payload in application durable intake before local
execution. Request IDs remain stable on replay. The coordinator keeps that queue
independent of checkpoint/projection replacement, so input arriving during work
cannot be lost. Use Chelm intake content deduplication and task idempotency keys;
reconcile unknown external collection effects separately before repeating them.
Request payloads are bounded to 256 KiB and must be chunked by the application
when larger. Generic coordinator state is bounded to 4 MiB; the serverless
template uses 1 MiB. Exceeding a bound refuses, without false completion.

| Observed boundary | Required visible state / recovery |
| --- | --- |
| Input persisted, agent absent | queued |
| Local Git/task commit only | local-committed; still pending in durable intake |
| Upload or head outcome unknown | checkpoint-pending; recover same submission before a new save |
| Object uploaded but head not selected | Staging/verified immutable object; no durable completion |
| Head CAS completed, response lost | Recover original receipt; do not re-execute/ack twice |
| Verified head plus matching acknowledgement | durably-saved |
| Storage unavailable | Keep pending; never fall back to unfenced head or report saved |

The local wrapper retains a pending publication marker before upload. Normal
Chelm mutations refuse while it is pending. `session save` recovers/retries the
same immutable checkpoint, updates its base revision after receipt recovery,
and removes the local checkpoint temporary copy after durable acknowledgement.
If the original workspace disappears, restore only the coordinator's selected
head and replay durable pending inputs. The consuming app must not show a raw
local worker receipt as confirmation that its durable store has saved the work.

## Reset and cleanup (LCS-5)

Reset first revokes the session/fence and increments generation atomically,
clears authoritative head, inputs, projections and receipts, and inventories
all checkpoint/upload keys before deletion. Late old-session uploads/results,
renewals, reads-as-current, imports and publications refuse. Reset IDs are
idempotent. New generation startup is explicit; it never restores an old head.

`sweep` prunes retired keys repeatedly. Every concurrent upload attempt is
tracked separately. An unknown storage operation can still finish later, so its
tombstone remains `cleanup_pending` until its write completion is observed or
the trusted storage adapter definitively reconciles it through
`settleRetiredUpload`. Timeouts, expiry and a 404 alone do not prove settlement.
That administrative method is deliberately absent from the remote JSON API.

The agent reset wrapper deletes its reachable owned runtime and tracked
checkpoint files after fencing. Other registered local copies remain
`pending-unreachable` until their cleanup acknowledgements arrive. A detached
temporary environment cannot be physically erased by a remote coordinator;
report this limit instead of claiming all copies are immediately gone.
Ordinary `reset --scope instance` refuses while a durable session is bound;
use `session reset --apply` for the full generation/cleanup operation.

## Agent setup and authenticated transport (LCS-6)

1. Install the exact supported pair outside the private runtime. Use local CLI
   workers/cognition; MCP remains optional. Run `verify` and package checks.
2. Initialize the first local runtime with `init --runtime PRIVATE --harness EXACT_HARNESS`.
   Read its runtime ID and checkpoint package identities. Provision a private
   application store with those trusted bindings; never copy runtime data into
   the source repository. A Git memory remote is unnecessary.
3. Configure an authenticated narrow binding. For an independent local fixture,
   run `node tools/session-store-server.mjs` with environment-only
   `CHELM_SESSION_STORE`, `CHELM_SESSION_TOKEN` (>=32 random characters),
   `CHELM_SESSION_RUNTIME`, `CHELM_SESSION_OWNER`, `CHELM_SESSION_PACKAGES`.
   It binds only loopback and prints its URL, never the token. This fixture is
   for tests; the primary hosted path uses application storage directly.
4. Set agent environment `CHELM_SESSION_URL` and `CHELM_SESSION_TOKEN` through
   the application's authenticated handoff. Do not put tokens in prompts, source,
   runtime config or checkpoint objects. HTTP requires HTTPS except loopback,
   rejects redirects, bounds bodies and times out; writes require explicit
   same-ID recovery after uncertain responses.
5. Call `session initialize` once, then `session connect --input CONNECT.json`.
   CONNECT contains `{"session_id":"stable-session-id"}`. For a fresh directory
   with a selected checkpoint add `--apply --harness EXACT_HARNESS` (and any
   trusted environment rebinding). Connection downloads/verifies/restores then
   acquires the exact selected base; a race with a moved head refuses.
6. Persist intake via `session intake --input INPUT.json`, run existing workers
   or cognitive tasks, then `session save --input SAVE.json`, where SAVE is
   `{"submission_id":"stable-save-id","request_ids":["input-id"],"projection":{}}`.
   Renew before expiry; save only at a settled boundary. Use `session status`
   for authoritative head/pending state. `session stop` releases publishing
   authority while retaining the local runtime and inert storage binding. It
   can reconnect in place under a new session ID if its durable base has not
   moved, or perform full reset after stop. `session reset --apply --input
   RESET.json` uses `{"reset_id":"stable-reset-id"}`.

All session CLI commands take `--runtime PRIVATE`. See the six
`prompts/local-session-*.sudo.md` prompts and the normative portable algorithm
in [LOCAL_SESSION_SPEC.sudo.md](LOCAL_SESSION_SPEC.sudo.md).

The fixture's file-store CAS mutex deliberately does not guess whether a dead
writer has released authority. A crash holding `.cas` requires offline operator
inspection before removing the lock and resuming. Interrupted state temporaries
are cleaned only while that CAS mutex is exclusively held.

## Optional Sites D1 + R2 recipe (LCS-7)

Current Sites capabilities were checked on 2026-11-25: Worker ES modules,
logical D1/R2 bindings and optional Site MCP are supported. Workers have a
128 MiB isolate limit and do not run this local Python/Git runtime. This is a
template. A private synthetic Site was subsequently deployed and authenticated
from the Work executor; see the dated hosted evidence linked from
[LOCAL_SESSION_ACCEPTANCE.md](LOCAL_SESSION_ACCEPTANCE.md). This does not
qualify an arbitrary consumer Site or independent-conversation resume.

Use the application's existing Site identity/auth/UI. Bind `DB` and `BUCKET`
in `.openai/hosting.json` (keep existing project ID and binding names), apply
`integration/local-session/0001_sessions.sql` through the Site's migration
pipeline, and bundle `createSessionWorker(authenticate)` with its imports into
the application's Worker server. No DDL runs during request handling. The
authentication callback maps the caller to an owned runtime/principal and exact
pins; never forward request JSON as that identity. The adapter uses a
fresh `first-primary` D1 session for each read and conditional SQL update.
This also makes the post-download reset/head recheck use primary data.

The adapter APIs follow the official [D1 database reference](https://developers.cloudflare.com/d1/worker-api/d1-database/)
and [R2 Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/),
checked on 2026-11-25. Hosted deployment, D1/R2 and executor HTTPS were observed
separately from deterministic adapter tests in the dated hosted evidence.
Independent-conversation resume and hosted reset remain explicit observations.

The sample transport supports 8 MiB checkpoints, 12 MiB JSON bodies and a 1 MiB
coordinator row. These explicit smaller limits fit a bounded synthetic runtime
within the Worker memory limit; the generic local archive limit is larger.
Larger applications need a separately tested streaming/object binding, not an
unbounded increase in request size. Keep request evidence and UI records
separate from the checkpoint head; acknowledge only the covered request IDs.

Work tools are not an implicit authenticated client for arbitrary Site routes.
First demonstrate an actual authorized handoff: either expose these operations
through an application-owned Site MCP server and verify its tools are callable,
or provision/test the narrow HTTP credential/endpoint used by SessionClient.
An existing browser login or a successful Sites deploy is insufficient evidence
of agent route access. Manual download/upload is a separately labelled offline
path and does not qualify unattended/live integration. Keep the Site private;
source/deployment configuration never contains Persona1 history or runtime data.
