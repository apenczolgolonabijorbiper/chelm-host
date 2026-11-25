# Observed platform acceptance — plan #53 / reviewed 2026-11-25

The cumulative implementation in PR #56 passed all five jobs in
[run 45468016957](https://github.com/apenczolgolonabijorbiper/chelm-host/actions/runs/45468016957).
These are observed results, superseding the pending platform status in the
historical implementation notes below. The tested PR head is `ca149ae320948cac3972572c4356e4abd0ad45b1`;
Actions checked out merge `da7127bc6d1e5369e20835a864302a3a9487314f`,
tree `49ff9bca3542b6339b8852cf1421f974acc0c844`. Later evidence-only edits
do not change that tested identity. Both runtime modes use published Harness
0.13.0 with the unchanged archive/manifest pins.

| Platform | Node | Complete staged suite | Adapter conformance | Additional observed gates |
| --- | --- | --- | --- | --- |
| Windows Server 2022, build 20348 | 22.12.0 | Three consecutive 136/136 passes, concurrency 2 | 11/11 | Concurrency-4 comparison 136/136; full IIS file/provider and IIS Express provider probes |
| Windows Server 2022, build 20348 | 24.22.3 | Three consecutive 136/136 passes, concurrency 2 | 11/11 | Concurrency-4 comparison 136/136; ten standalone MCP passes; same three IIS probes |
| Linux, kernel 7.0.0-1020-azure | 22.12.0 | 136/136, concurrency 4 | 11/11 | File-worker/provider package paths and transport controls |
| Linux, kernel 7.0.0-1020-azure | 24.22.3 | 136/136, concurrency 4 | 11/11 | File-worker/provider package paths and transport controls |
| macOS, Darwin 25.6.0 | 22.12.0 | 136/136, concurrency 4 | 11/11 | Full staged control suite |

Every full-suite and standalone attempt above has zero failures, cancellations
or skips. Forced timeout, abrupt caller death, success/error descendant and
listening-socket cleanup, sentinel preservation, finite stdin EOF, injected
scenario hang, response-loss reconciliation and schema-1/2/3 migration guidance
regressions passed within those full suites. No mutation retry wrapper was used.
The six hosted IIS probes passed with their recorded identities; hosted Server
2022 Datacenter is not the consumer's Windows 11/Server 2022 Standard deployment.

[Retained CI summary](evidence/reliability-2026-11-24/ci-summary.json) records
artifact/report hashes, exact platform manifests, every attempt and elapsed time,
job links and limitations. Its five downloaded platform artifacts were verified
against their advertised SHA-256 digests. The Linux Node 24 development ZIP was
independently extracted: all **228 entries** and the archive checksum matched,
with zero node_modules. It is an unpublished development build labelled 1.3.0,
not a replacement for the immutable published 1.3.0 release.

The earlier #55 Windows Node 22 job passed its complete repeated suites and
adapter checks, then failed to connect at the full-IIS provider probe. Its cause
is unconfirmed and the failed job remains failed; the cumulative #56 run passed
that gate. The initial failed concurrency-1 policy also remains retained. The
historical consumer orphan/reset root causes and original VI-023 raw failures
remain unconfirmed. Windows full attempts took 557–580 seconds; the entire
multi-attempt qualification sequence took 37–39 minutes, and does not satisfy
the historical aggregate `tst9_under_10_minutes` field. Windows capacity runs
also miss the separate 3-second regeneration target. Correctness passes do not
establish those performance targets.

Implementation and synthetic platform verification are available for maintainer
review in order **#54 → #55 → #56**. Retarget each successor to master after its
predecessor merges. Manual review/merge, version selection/publication and live
HTTPS/ARR/inference-client gates #7/#10/#11 remain separate. No consumer runtime
was reset, migrated or upgraded. Specification parity obligations #38–#41 remain
as stated in [WINDOWS_RELIABILITY.md](WINDOWS_RELIABILITY.md).

---

# Revised scenario/file policy — plan #53 / 2026-11-24

The corrected policy passed **136/136 staged Linux host tests and 11/11 adapter
cases**, with no skips, against the same verified published Harness 0.13.0.
The additional case injects a hanging async scenario and verifies its own finite
deadline. Owned-process tests now check descendant listening-socket cleanup after
timeout, normal exit, thrown error and abrupt caller death, preserving a sentinel.
The full staged validation took 91 seconds on Linux Node 24.22.3. Every entry in
the extracted 227-entry development ZIP matched its manifest, with no node_modules.

The initial Windows concurrency-1 policy failed at the 600-second suite bound;
Node 22 additionally exposed the 180-second CLI timeout bounding a whole file.
Those failed attempts remain retained in run 45462787753. Windows now schedules
two files, with separate 180-second scenario and 600-second aggregate file/suite
bounds. A 90-minute CI job allowance accommodates the complete repeat sequence;
operation and suite deadlines were not raised. This is a correction to the
implementation's test policy, not proof of the historical consumer timeout cause.

[Revised Linux evidence](evidence/reliability-2026-11-24/linux-revised-policy.json)
retains exact tested identity/hashes and the failed development/Windows controls.
The earlier positive Linux control below remains historical. Revised Windows
repetitions, standalone MCP and platform/IIS gates remain pending until observed.
Manual review/merge, publication and actual client HTTPS gates remain separate.

---

# Reliability follow-up — plan #53 / 2026-11-24

Observed locally on Linux 6.18.57 / Node 24.22.3 / Python 3.12.14 with the verified
published Harness 0.13.0: **135/135 staged host tests and 11/11 adapter conformance
cases passed**, with no skips. The final staged suite took 72 seconds (complete
build validation 84 seconds). Extracted development ZIP integrity passed for all
225 entries, with zero node_modules entries. Both file-worker and provider
service probes completed memory publication and a read-only cognitive task.

Forced timeout and abrupt caller termination removed synthetic owned descendants;
success/error cleanup preserved exits/output and an unrelated sentinel remained
alive. Empty/malformed stdin reached structured CLI usage errors. Labelled HTTP
response-loss recovery retained one committed receipt/result. Reconstructed
v0.2.0 config fixtures passed migration guidance, explicit apply and byte-preserving
preflight checks; quoted POSIX commands were executed. Operational preflight
lock/log writes are intentional. No historical private runtime was migrated.

[Retained Linux summary](evidence/reliability-2026-11-24/linux-summary.json) records
tested source/tree, exact package manifests, counts, timings and development ZIP
hash. Later evidence/documentation additions do not change the recorded tested
source identity. Raw per-platform logs/phase reports are CI artifacts. See
[scope and limitations](WINDOWS_RELIABILITY.md) and [test policy](TEST_POLICY.md).

Windows Node 24 ten-attempt MCP acceptance and three supported-policy staged
runs plus concurrency comparison are configured CI gates and remain pending
until observed. Historical Windows ECONNRESET root cause and orphan waiting
point are unconfirmed; passing Linux checks do not resolve them. Live IIS HTTPS,
physical-client acceptance, maintainer review/merge and publication remain
separate. No new package version is published by this change.

---

# Pending-issue acceptance follow-up — 1.0.2 / 2026-11-22

The follow-up maps **177 declared design IDs**, including PAR-1 through PAR-23,
to behavioral suites, explicit external checks, superseded rules or deferred
scope. See REQUIREMENT_COVERAGE.md and requirement-coverage.json. Mapping is
machine checked; it does not assert that every design clause has an individual
passing test. Retired mailbox requirements are superseded by remote worker v2.

Observed locally on Linux / Node 24.22.3 / Python 3.12.14 / Git 2.56.1:

- **66/66 staged host tests and 11/11 harness adapter conformance cases passed**
  with no skips. The staged suite including dependency setup took about 45 seconds.
- Nine successful local MCP scenarios exercise all seven current local tools,
  including a real synthetic publication. Remote fixtures use the locked official
  MCP SDK 1.32.2.
- Two independent client processes use an HTTP proxy; service kill/restart,
  idempotent assignment and durable receipt recovery pass. Publication fixture
  processes are terminated immediately before and after CAS; reconciliation is
  idempotent and preserves unrelated drafts. Full validated submissions are also
  killed at both CAS checkpoints; retries yield one ledger row and current app
  views. Recovery retains its marker until those views are durable. These tests do not exercise every
  possible power-loss or filesystem interruption window.
- Upload tests cover UTF-8 byte offsets, supplementary Unicode, incomplete uploads,
  conflicting/concurrent retries, size/quota refusal, revocation and executor
  spoofing. Integration tests force another publication and a policy change while
  review is pending; stale attempts/drafts cannot publish.
- Static parity memory retains a superseded relation and committed chat answer.
  Fixed boundary expectations cover lease states, inspection and lookup limits,
  administrative baseline and guarded hard reset. Protocol fixtures additionally
  assert exact note/chunk/key bytes, a single indexing pass, retrieval grouping,
  open-answer headers, source-only export, request/claim bounds, archive naming
  and actual sandbox recreation. All PAR-1 through PAR-23 have mapped fixtures. Installer upgrade and malformed
  AGENTS/MCP conflict checks pass without partial mutation.
- Full harness capacity: 10,000 sources, 5,000 entities, 20,000 claims; 10,000
  subjects and 100,000 conversation turns. Three regeneration samples were
  **1591 / 1047 / 982 ms**; deep refresh **5736 / 5426 / 5510 ms**, with validation
  and statistics reported separately. This Linux machine meets the 3-second
  regeneration target; reference Windows acceptance is still external.
- Exact 64 MiB logical trees are accepted and larger trees refused before blob
  loading, including repeated/deduplicated Git objects. This corrects both an
  oversized logical-tree loophole and Git framing overhead at the exact limit.

Reports are emitted to dist/: benchmark-*, capacity-*, remote-phases-* and
 test-timing-*. Remote phase reports separate tools and payload sizes; submit
includes its mandatory fresh validation/merge/publication. Inference time, provider
token counts and cost remain null, because no LLM was invoked.

Current CI will repeat platform suites, capacity measurements and the real IIS
identity probe. Until observed, this paragraph is configuration, not passing
platform evidence. E-1 through E-4 in EXTERNAL_ACCEPTANCE.md explicitly retain the
actual IIS HTTPS/ARR target, reference Windows machine, two physical machines
with the selected inference client, and consumer migration/HTTP smoke checks.
The read-only remote probe records actual server/SDK discovery without assigning
work. No live application, runtime or inference provider was modified.

---

# Packaging follow-up — 1.0.1

Observed locally on Linux / Node 24.22.3: **51/51 host tests and 11/11 harness
adapter conformance tests passed**, with no skips in the staged release suite.
The generated ZIP contains 110 files with zero node_modules entries.

The thin release builder restores dependencies from the staged package lockfile
before running the complete host suite and harness adapter conformance checks.
Added coverage checks managed-directory integrity, legacy bundled verification,
locked receipts/idempotence, missing-dependency guidance, local-only installation
and failed upgrade rollback. Platform CI and IIS evidence for 1.0.0 below remains
historical until 1.0.1 checks are observed. External two-machine inference acceptance
remains pending; this packaging change does not establish it.

# Implementation and verification status — 1.0.0

The owner-hosted remote MCP replacement is implemented on the development branch.
It targets exact harness **0.10.0**, manifest SHA-256
`0c4ba9f35e24df0887ceb27457d118b5e4829acef401242cb6818a3034f95031`.
Worker/runtime configuration contracts are v2; application/read-model remain v1.

Observed on Linux / Node 24 / Python 3.12 during implementation:

- The staged release build passed all **47 Chelm checks** and all **11 harness
  backend conformance cases**, including purpose-guidance-v2 and profile-install-v1.
- The staged package includes locked runtime dependencies and passed installer
  integrity/idempotence/deferred-registration and service-identity smoke checks.
- Remote tests cover official SDK Streamable HTTP operation, an independent Node
  stdio bridge process, principal/runtime authorization, JWT signature/issuer/
  audience/scope/expiry checks, source/policy drift, finalized upload revisions,
  no-filesystem client cognition fixture, concurrent disjoint analysis, remote
  integration review, post-CAS receipt recovery, named record-conflict refusal, raw CRLF guidance snapshots with Git attributes and legacy cutover.
- Prompts are checked against actual tool names; generic unattended runner prompt
  delivery is tested with a deterministic external Node process.
- Local NFR-4 medians from the first successful 1.0 staged build: submit 113 ms,
  ask 187 ms, status 78 ms. This is an empty-memory synthetic local benchmark,
  with the documented validator/indexer exclusions, not remote inference speed.

Additional adversarial tests and any later per-build timing are authoritative in
CI output. No language model was invoked in these synthetic fixtures; model and
provider quality/latency are not established by them.

External acceptance still required:

- Windows/macOS and Node 22.12 platform results from this branch's CI.
- Actual Windows Server 2022 IIS HTTPS/ARR proxy deployment of the new MCP service
  (the existing app-pool subprocess probe is a different check).
- Two physical machines and your selected IDE/agent CLI with live inference,
  credentials, issuer/client registration and unattended approval policy.
- Capacity-scale remote payload, context/token cost and inference measurements.

Configuration and prompts are shipped in docs/REMOTE_WORKERS.md and prompts/.
No consuming application, private runtime or live server was modified by this work.
The old records below are historical evidence, not 1.0 platform verification.

---

# Implementation and verification status — 0.2.0

## VF alignment evidence

- Harness support: **0.9.1 only**, canonical graph v2 / hypotheses v1 / vocabulary
  v2; byte-exact RELEASE.json SHA-256
  3471d0bf0f83b4d3756a8aefcbc45a314c372e52bc28d39265d16a1ad2cd7150.
- The backend is re-derived from the 0.9.1 reference; all nine applicable CLI
  conformance cases pass locally. A regression test bounds metadata/index Git
  calls with twelve additional outputs and checks optional safe timing reports.
- Static TST-5 fixture: tests/parity/instance, host and expected.json cover multiple
  subjects/kinds, retained corrections, relation claims, hypotheses, open/closed
  questions, chat events, conversation, requests and journal/subject statistics.
- Profile mirrors preserve raw config/core/sections/vocabulary bytes (including
  CRLF and Unicode); tests cover drift/status, enforced no-claim, reserved-path
  refusal and idempotent installation.
- Adoption tests cover explicit subjects, generic-filename preflight and jobs.
  Installer tests cover deferred agent integration and relative MCP hints.
  Windows retry tests inject EPERM/EACCES/EBUSY and test bounded exhaustion.

## Windows results and latency qualification

| Evidence | Result | Interpretation |
|---|---|---|
| Consumer-reported Windows, Chelm 0.1.0 / harness 0.7.0 | **27/27 in 11.9 minutes** | Above TST-9's under-10-minute target. Machine/load were not supplied; do not replace this with hosted-runner timing. |
| 0.2.0 Windows Server 2022 hosted CI, harness 0.9.1, alignment run 44913373114 | 34/34 Chelm tests plus 9/9 harness conformance cases in **103.2 seconds**; NFR-4 median submit **378 ms**, ask **517 ms**, status **89 ms** (three samples; maxima 379/518/90 ms) | This runner met the suite/latency targets. The first real IIS probe then exposed libuv identity lookup failing with an unloaded app-pool profile; fixed by the OS SID fallback and covered by a regression test. Final IIS evidence is published separately. Does not certify the consumer's machine. |
| Local Linux, Node 24, harness 0.9.1, three synthetic NFR-4 samples | Submit median 106 ms (max 112); ask median 191 ms (max 273); status median 70 ms (max 71) | Observed during alignment development. Includes CLI startup; measured indexer/validator children excluded, retrieval included. Small fresh runtime, not capacity-scale. Current per-build samples are authoritative for that build. |

The release builder runs independent test modules with four child processes, then
the harness CLI conformance suite. It emits suite duration and the TST-9 target
comparison. Benchmarks publish all raw samples, environment and exclusion method;
unmet targets are reported rather than hidden or converted into passing tests.
Hosted Windows timing does not prove the 11.9-minute consumer run is resolved on
that machine. Re-run the shipped benchmark there to compare like for like.

## IIS identity verification (NFR-1)

The default target case is full IIS on Windows Server 2022, ApplicationPoolIdentity,
LoadUserProfile=false, without ASP.NET impersonation. The Windows CI probe runs
through an actual loopback-only IIS .ashx handler, starts Node under the pool
identity, and verifies package/harness access, Python and Git child processes,
intake/indexing, owned claim/validate/commit and committed reads/conversation.
Evidence records the actual identity, OS caption and LoadUserProfile setting.
When libuv cannot resolve an unloaded Windows profile, actor ownership uses the
actual Windows SID obtained from whoami.exe; USERNAME/USERDOMAIN are never used
as an authorization fallback. Ordinary loaded-profile actor names are retained.
The test uses a temporary site/pool and removes them afterward.

This verifies the generic IIS identity case when CI reports success. IIS Express
development runs as the developer's Windows identity and can use the same Node
service probe. Target-server verification still requires running
tools/Test-IisIdentity.ps1 there; no access to that server was supplied.
See IIS_VERIFICATION.md for execution and filesystem permissions.

## Remaining boundaries

Exhaustive per-requirement coverage and capacity/reference-machine benchmarks
remain tracked in issues #2 and #3. The real consuming application's HTTP/export
acceptance and its Windows Server 2022 Standard configuration are outside these
synthetic checks. Identity crosswalk, model clients, UI and internal schedulers
remain outside the release.

---

## Historical 0.1.0 acceptance record

# Implementation and verification status

Version 0.1.0 implements design draft 0.2 against the byte-exact harness 0.7.0
release (RELEASE.json SHA-256
2154ea76f5184afdb76e73f7c15f324bef2a51e2afccd645c231cb75dbdecb80).
This is an initial implementation, not a claim that every requirement has a
separate exhaustive test or that the reference consumer has been migrated.

## Automated evidence

The release builder executes all Chelm tests against a clean staged package and
all nine applicable CLI conformance tests from the supported harness. A failure
prevents archive creation. Factory fault-injection tests additionally exercise
interrupted publications and a HEAD movement between validation and CAS.

| Area | Implementation | Automated checks |
|---|---|---|
| Packaging and installation (PKG/INS) | Versioned ZIP, exhaustive integrity manifest, preflight conflicts, idempotence, MCP/rules/AGENTS preservation | Staged installer reruns, edited-rule refusal, integrity verification |
| Runtime (RT) | Init, adopt, schema checks, archive reset, guarded hard reset, profile set, no-op migration | Canonical initialization, incompatible graph refusal, in-place adoption, missing keys, orphan stores, busy reset |
| Intake (APP-10..16/PAR-1..4) | Atomic notes, content keys, receipts, chunking, one indexer pass | Exact note bytes, repeat skips, receipt conflict, whole-input preflight, oversize behavior |
| Conversation (APP-20..24) | Ask/retrieval/pending, open-question answers, append-only turns, bounded tail | Empty/overlong refusals, pending reply, conversation linkage, 100,000-turn UTF-8 tail |
| Read model (APP-30..36/RM) | Committed snapshots, nine views, metrics timestamps, inspections, context and lookups | View schemas, all inspection names, counts, draft isolation, per-subject records, journal source-assertion count |
| Transfer (APP-40/41) | Original inbox/evidence only; duplicate byte protection; unresolved question links | Export/import repeat, pending destination, no ledger/graph import |
| Requests (APP-50..52) | Kind allowlist, reason bound, proposal limit, duplicate suppression, explicit transitions | Kind refusal, duplicates, truncation, accepted/fulfilled/refused transitions |
| Workers/backend (WRK/HAR) | Selectors, leases, guidance, candidate validation, CAS, safe release and recovery | Harness CLI conformance; subject selection, ownership, renew, missing outputs, restore-on-error, policy re-claim, CAS/fault injection |
| MCP | All nine tools, JSON-RPC stdio, negotiation and notifications | Initialize/list and one request/response for every tool, successful no-work/context and structured refusals |
| Delegation (DST) | Reservations, participant access, bundles, hashes, return validation, fast-forward/keyed merge, integration handoff | Offer/take/return/adopt, idempotent adoption, concurrent local work, both independent analyses retained, tamper/cancel refusal |
| Security/concurrency (SEC/NFR) | Strict paths, symlink refusal, non-shell children, bounded output, operation mutex, safe reasons | Path/drive/Git/link checks, lock contention, unrelated drafts retained, untrusted source changes refused |

## Decisions for this release

Host state uses atomic files plus reset archives, rather than another Git
repository. Inspection tables remain in the host. MCP transport is stdio only.
The backend is an attributed, independently maintained adaptation of the harness
reference backend, with source selectors and policy checks. Producer receipts
ship now. No automatic historical-instance conversion or identity crosswalk.

Profile-directory initialization supports default.md, optional vocabulary.json,
and optional profile.json containing explicit sections [{id,path,kinds}]; it never
infers selectors from section filenames or prose. profile set accepts section text
in JSON. Integrate work units return the executor identity and output list that
must be passed back on validate/submit.

## Limits and acceptance still requiring external evidence

- The test suite groups requirements into behavior tests. TST-1's literal goal of
  a separate test for every requirement ID is not yet met. CLI schemas cover the
  distributed outputs; MCP round trips include refusal paths, not nine successful
  end-to-end scenarios.
- Linux tests are observed during the build. The workflow additionally runs
  Windows and macOS, Node 22.12 and Node 24; those results are recorded by Actions.
  No claim is made about Windows Server under a service identity without a profile.
- Reference-workstation latency targets and capacity-limit benchmarks (RM-6,
  NFR-4/5, TST-9) require measurements on that machine. This release batches raw
  Git reads and bounds subprocess output but has not certified those targets.
- Real consumer migration and unchanged HTTP/export smoke tests (TST-10) require
  work in the consuming application and are outside this repository's checks.
- More adversarial tests remain useful for executor-assisted summary integration,
  expired bundles, simultaneous adopters, and read-only/no-delete shared folders.
  Shared package files remain in place after adoption; Chelm does not delete other
  participants' data. Owners must apply their own retention policy.
- The operation lock protects Chelm callers. Direct edits or raw adapters outside
  the host require an explicit refresh. The backend still uses immutable snapshot
  validation and expected-head publication to guard against competing commits.
- Intake and conversation involve several files; atomic individual writes and
  preflight checks do not provide a multi-file filesystem transaction across a
  sudden power failure. Retrying a complete submission is content-idempotent.



## VP-021 / VI-021 validation

The observability implementation adds tests/telemetry.test.mjs for operation
identity/phase/privacy behavior, nullable usage, concurrent independent-process
read counters, bounded windows, read-only status, failure isolation, log rotation
and remote usage retry fencing. Run the package builder to observe staged tests
and harness conformance; configured tests/CI alone do not establish platform
acceptance. Retained-shard counters are bounded, not unbounded lifetime totals;
reads.json is a materialization and status reads authoritative shards. See
OBSERVABILITY.md for crash/I/O and saturation limits.

Final acceptance coverage for harness tracker #60 lives in
`tests/telemetry-acceptance.test.mjs`. It checks enabled refresh/submit/failure
phases, disabled fields and overlapping operation-context isolation. Independent
processes deterministically pause before summary replacement, publish in reverse
order, and are killed before shard persistence or after stale summary publication.
Restarted processes retain persisted counts and repair the cached summary; lost
unpersisted samples are not invented. Retention, malformed shards, the actual
10,000-shard cap and the 1,000-sample window are exercised without hardware timing
assertions. These tests supplement, rather than replace, the existing 16-process
read test and protocol/remote recovery suites.

The release builder runs `tools/benchmark-telemetry.mjs` and emits
`dist/telemetry-<platform>.json` with alternating warmed read-metrics off/on
measurements, raw timings, disk bytes, RSS/heap and isolated aggregation scenarios.
See `OBSERVABILITY.md` for measured scale limitations. A CI run passes only after
these measurements complete; reports remain evidence, not latency guarantees.

## VI-020 / VI-021 completion checks

Read CONTRACT_WORKER WRK-13 to classify its examples A and B. The journal may
precede validation and remain unchanged: completed local checks plus a resolvable
durable completion pointer suffice. A transient submit response must be retained;
remote receipts alone do not imply retention of all warning diagnostics. Generated
owner-publication journals and the shipped local/remote prompts follow this rule.

`tests/telemetry.test.mjs` exercises exact baseline log keys on scratch-runtime
submit, duplicate intake, refresh, invalid input and reset; held-lock read exclusion;
local/remote no-work executor identity; owned remote reads and cross-owner refusal;
stale-lock recovery; committed-result/error preservation with unwritable logs;
actual 10 MiB rotation and independent-process JSONL appends.
`tests/conformance/remote-boundaries.test.mjs` also checks authenticated HTTP
success/read/failure events, one endpoint event per invocation, descriptive
executor provenance and absence of another owner's metadata on refusal.
Run the full staged builder against the pinned extracted harness 0.10.0 release
before recording results. Platform CI and a consuming application's upgraded
runtime acceptance are separate from local package verification.

Observed on 2026-11-22, Linux / Node 24.22.3 / Python 3.12.14: the staged
builder passed **74 host tests and 11 harness 0.10.0 conformance cases**, with
zero failures/skips, plus package verification and the small-fixture benchmark.
The targeted telemetry/remote-boundaries run passed 12 tests. These results do
not establish Windows/macOS CI, live IIS or downstream upgraded-runtime acceptance.


## Coordinated 1.1.0 / harness 0.11.0 release

The supported engine is the published golem14-harness 0.11.0 ZIP with exact pinned
archive and RELEASE.json hashes in compatibility.json. CI downloads/verifies that
artifact via tools/prepare-harness.py --version 0.11.0. Source reconstruction is
not release evidence. Existing canonical Chelm 1.0.2/harness 0.10.0 runtimes need
no data migration or reset; pause processing, settle assignments/drain leases,
replace the verified pair, verify and refresh before resuming. Older releases'
measurements above remain historical evidence, not new-version validation.

## #25 cognitive tasks — 1.2.0 / Harness 0.12.0

See [COGNITIVE_ACCEPTANCE.md](COGNITIVE_ACCEPTANCE.md) for the current published-pair,
model and platform evidence. Historical 1.1.0/0.11.0 measurements above remain
historical. The current production loader and all cognition tests use the exact
published 0.12.0 package; the development source dependency has been removed.

## Provider architecture Phase A (#32–#34)

See [MEMORY_PROVIDER_ACCEPTANCE.md](MEMORY_PROVIDER_ACCEPTANCE.md) for separate
observed results, exact unpublished Harness identity, package/platform gates and
capacity limits. Existing checks above describe config-2 behavior and do not
prove provider-mode IIS or published-pair acceptance.

## #32 / #34 published provider pair — 1.3.0 / Harness 0.13.0

Current release qualification uses one exact published Harness archive across
config-2 and config-3, downloaded and integrity-checked on every platform. The
full staged builder retains host, provider and backend conformance results;
capacity reports preserve the explicit >100 MB refusal. Windows release gating
adds real config-3 full-IIS/ApplicationPoolIdentity and IIS Express/interactive
processes, semantic memory publication and receipt recovery, read-only cognition
and C# view-reader recovery. Each mode retains separate JSON and package hashes.

See MEMORY_PROVIDER_ACCEPTANCE.md and the finalization PR/checks for observed
runs. Older sections record historical implementation evidence. Hosted IIS
Express runs use Server 2022; actual consumer Windows 11/Standard server checks
are separate. Optional SQLite #35 and migration #36 remain open and disabled;
no consumer instance was reset, migrated or upgraded by this release work.
