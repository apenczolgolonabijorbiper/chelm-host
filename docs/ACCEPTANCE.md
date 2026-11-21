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
