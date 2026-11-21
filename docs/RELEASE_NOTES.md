# Chelm-host 0.2.0 — 2026-11-21

Implements consumer alignment VF-1 through VF-7. Supported harness versions:
**0.9.1 only** (`harness_supported: =0.9.1`).

| Supported harness | Runtime requirements (PKG-14) |
|---|---|
| 0.9.1 | Canonical graph v2, hypotheses v1, vocabulary v2. Existing canonical runtimes created under harness 0.7.0/0.8.x/0.9.x retain memory and host state: pause executors, cancel outstanding offers, replace both vendor packages, update harness.root if needed, verify and refresh. No memory migration or reset. Historical layouts/graph v1 require a fresh runtime and original-source import. |

0.2.0 does not run with harness 0.7.0: upgrade the installed harness before using
this host. Chelm-host 0.1.0 remains the old release for harness 0.7.0. Old delegation
packages are bound to their original harness release hash and must be completed
before upgrade or cancelled and offered again. Runtime config remains schema 1;
new optional fields do not require host-state conversion.

- Git backend re-derived from the 0.9.1 reference: cached tree metadata, batched
  index updates/recovery checks and safe optional operation timings, retaining
  Chelm source selectors, policy identity, strict output scope and recovery.
- Moved-head integration uses harness memory-tool merge and advertises
  harness-merge; flagged summaries return an integration work unit for review.
- Adoption supports explicit subject/store mappings and the consumer jobs wrapper;
  generic filenames cannot silently become subjects.
- Byte-exact mirrored profile installation, per-file comparison/status and an
  optional expected-profile drift guard on worker next.
- Installer can defer all agent integration, preserve agent files untouched and
  resolve repository-relative runtime hints independently of the MCP client cwd.
- Windows atomic rename retries are bounded; reader sharing guidance is published.
- Static synthetic parity fixture, NFR-4 benchmark evidence, actual full IIS
  app-pool identity probe in Windows Server 2022 CI, and documented host ownership/
  adoption-recovery state. ZIP, checksum and platform evidence accompany release.

The supplied consumer Windows 0.1.0 result was **27/27 in 11.9 minutes on harness
0.7.0**, exceeding the TST-9 target. See ACCEPTANCE.md for the qualification of
that result, the current CI evidence and remaining machine-specific checks.

---

# Chelm-host 0.1.0 — 2026-11-21

First implementation of design draft 0.2, with app/worker/read-model/runtime/
delegation contracts at version 1. Supports golem14-harness **0.7.0 exactly**.
Existing canonical 0.7.0 instances can be adopted in place; no memory migration is
performed. Historical layouts, graph schema 1 and other harness versions are
refused. Start a fresh instance and import original sources when incompatible.

- Dependency-free JSON CLI and nine stdio MCP worker tools.
- Canonical runtime initialization/adoption, explicit profile changes, verification,
  archives, guarded sandbox reset and administration statistics.
- Atomic intake, content keys, producer receipts, line chunking and observation
  indexing through the harness. Conversation and question-answer records, request
  proposals and explicit approval transitions, source-only export/import.
- Published committed read views, warning/capacity snapshots, context retrieval,
  inspections and safe item/journal/observation lookup.
- Transactional Git backend with source selectors, age gates, owned leases,
  candidate capture, guidance identity, committed-policy checks and CAS recovery.
- Shared-folder offer/take/return/adopt with full-memory bundles, reservations,
  participant checks, hash verification, local validation, fast-forward and keyed
  merge. Conflicting Markdown summaries produce an explicit integration work unit.
- Integrity-checked installer, schemas, contract documentation, deterministic ZIP
  and checksum, cross-platform CI and automatic release after validation.

The backend and profile snapshot implementation derive from the Apache-2.0 harness
reference implementation; see NOTICE. Harness validation, indexing, retrieval and
statistics are external CLI calls; vendor directories are never modified.

See ACCEPTANCE.md for verification scope and known limitations. Identity crosswalk,
model clients, background scheduling and UI are outside this release.
