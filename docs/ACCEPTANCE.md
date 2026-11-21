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
| 0.2.0 Windows Server 2022 hosted CI | Test timing, NFR-4 samples and actual IIS identity result are published as release JSON evidence | Independent environment; does not certify the consumer's Windows Server 2022 Standard installation or reference-workstation performance. |
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
