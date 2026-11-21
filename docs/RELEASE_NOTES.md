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
