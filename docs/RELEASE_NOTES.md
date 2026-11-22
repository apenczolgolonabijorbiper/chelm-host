# Unreleased — VI-020 and VI-021

- Define WRK-13 verification pointers, minimum durable completion evidence and
  snapshot identity. Align local/remote instructions and mechanical journals;
  journal verdict text and a self-referential final tree hash are not required.
- Complete the merged observability baseline with validated executor identity
  on remote no-work/refusal paths, exact event shapes, count units and coverage.
- Add scratch-runtime regressions for intake/duplicates/reset, unlogged reads,
  executor ownership, stale locks and log I/O failure isolation.

No runtime migration or harness-engine change. Existing historical log records
are preserved. These source changes do not publish a new release; consumers
resolve vendor reports after upgrading and checking the resulting package.

# Chelm-host 1.0.2 — pending-issue acceptance follow-up

- Enforce the 64 MiB committed-tree limit on logical bytes, including duplicate
  Git objects; allow bounded Git framing at the exact limit.
- Recover committed app read views before clearing the durable publication
  marker, including when the service dies after Git CAS.
- Refuse reversed or duplicate managed AGENTS markers before installer mutation.
- Add process restart/CAS recovery, Unicode upload, stale integration, successful
  MCP lifecycle, parity and installer-upgrade conformance coverage.
- Map every declared requirement and retire obsolete mailbox acceptance scope.
- Ship host capacity and read-only remote deployment probes, platform capacity
  reporting and explicit live/reference-machine acceptance procedures.

This follow-up keeps public contracts and exact harness 0.10.0 compatibility.
Live IIS proxy, selected agent/provider and consuming application acceptance
remain external; deterministic fixtures do not establish inference performance.

# Chelm-host 1.0.1

Thin ZIP: node_modules is replaced by package.json/package-lock.json. Installation
and upgrade restore locked production dependencies with npm ci --omit=dev
--ignore-scripts before activation; restoration failure retains the previous package.
Use --skip-dependencies for offline/local-only installations, and
integration/install-dependencies.mjs for later remote MCP setup or --force repair.
Remote entry points explain the setup command when dependencies are missing.

Harness support remains **0.10.0 exactly**, with canonical graph v2/hypotheses v1/
vocabulary v2, runtime configuration v2 and worker v2. No runtime migration is
needed from Chelm-host 1.0.0. npm/registry access or a populated cache is now needed
for remote dependencies; local CLI/stdio operations need only Node/Python/Git.
The published 1.0.0 ZIP is unchanged. See README.md for integrity and offline details.

# Chelm-host 1.0.0

Replace shared-folder delegation with owner-hosted remote MCP workers. Remote agents
request work, read immutable snapshots, run their own inference and upload candidates.
Chelm validates, integrates concurrent candidates with the native harness merge and
publishes atomically. Assignment IDs and receipts survive reconnects/restarts.

- HTTPS Streamable HTTP MCP service, worker-token and external OAuth/JWT authorization,
  runtime allowlists, bounded text uploads and server-calculated hashes/offsets.
- Concurrent disjoint analysis, remote integration work units, local worker coordination,
  cancellation/pruning and explicit cutover/archive of old delegation state.
- Server/IIS/client configuration guide, stdio bridge and SudoLang one-cycle/loop/integration
  prompts. External-process runner passes prompts to an operator-configured agent CLI.
- VI-016: explicit intake chunks enforce max_chars/oversize; refusal preflights all groups.
- Exact harness **0.10.0** support: purpose-guidance-v2, purpose-only run snapshots and
  transactional application profile/purpose source installation.

Breaking changes: worker contract v2 and runtime configuration schema 2; offer/take/
return/adopt shared-folder delegation removed. App and read-model contracts remain v1,
including an empty historical delegations view. Run migrate preflight then explicit
apply; settle or explicitly cancel old offers and drain processing leases first.
Canonical graph v2/hypotheses v1/vocabulary v2 memory is retained, with no reset or
harness schema migration. Older unsupported instance formats still require a fresh
instance and original-source import. No consuming application is upgraded automatically.

Network support adds locked Node runtime dependencies, included in release ZIPs.
Source builders must run npm ci --ignore-scripts. Inference, private credentials,
background agent permissions and the chosen CLI/provider remain worker responsibilities.
See docs/ACCEPTANCE.md for observed checks and outstanding external validation.

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
