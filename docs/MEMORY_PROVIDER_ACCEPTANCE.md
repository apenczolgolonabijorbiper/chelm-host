# Memory provider Phase A acceptance (#32–#34)

The architecture implementation is prepared for review. Published-pair/platform
acceptance remains open: the merged provider API has not yet been published as a
Harness release. No SQLite, migration, consumer upgrade or new release is claimed.

## Exact package identities

- Published baseline: Harness 0.12.0, archive SHA-256
  `9bc17e21d0528e7359006b5bda6c17cce99df3021294e15e2d217d7330627522`.
- Provider development source: Harness commit
  `00aba14b49641c3deb9d17d7cc327f6f8578f503`, merged PR #85.
- Reference local provider development archive SHA-256 (compression can vary):
  `ee91183e23db3905483d101deb05efa645a13f62cda0027cd877c403f0ce9274`.
- Provider development RELEASE.json SHA-256:
  `ba571725ebf082e0cc50530505c588e2ed1d8f6b0f4f1a98bdbf36ee3ebd1e5f`.
- This build still carries upstream VERSION 0.12.0 but differs from the published
  archive. Separate explicit configuration and pins prevent substitution.

## Observed vendor results on Linux, 2026-11-24

| Check | Observation |
|---|---|
| Exact source/package preparation | Harness builder passed JS, Python and installer checks; source/package hashes retained in the development pin |
| Existing JSON runtime upgrade | Existing graph, source bytes, queues, journals, history and Git HEAD unchanged at provider selection; unsupported providers/contracts refused |
| Host store provider conformance | All 20 unmodified vendor cases passed against Chelm's own JSON/Git transaction, including complete corrections/hypotheses/questions/events/journal/verification/receipts and two-snapshot transfer |
| Local worker CLI and stdio MCP | Semantic cycle and exact source reads completed without supplying or rewriting graph files; drafts remained outside committed views |
| Authenticated Streamable HTTP MCP | Official client completed the semantic cycle, paged protocols and sources, and used the same shipped schemas |
| Fences and recovery | Bad quotes, changed source/policy, lease expiry, stale base, altered candidate seals, forged writes and interruptions refused; lost publication receipt recovered without processing twice |
| Cognition | Provider snapshot context/source reads operated without creating a graph workspace; existing task lifecycle remains independently scoped |
| Actual Work-generated extraction | One synthetic extraction authored in this Work session, saved before host validation, then committed/read back; separate same-assistant semantic verdict, original response hashes and unknown model/settings retained under `evidence/provider-work-2026-11-24/` |
| Capacity | `tools/benchmark-provider.mjs` measured small and 1,000-source/1,000-entity/4,000-claim JSON cases separately by phase; a 101 MiB graph was refused |
| Existing published-package regressions | Staged host suite: 125 passed, no failures/skips; published Harness backend suite: 11 passed; final targeted provider suite: 30 passed. Retained logs distinguish source and packaged checks |

The Work extraction was not a separate model API call, blind trial, independent
review or general cognition benchmark. It preserves source assertions and future
plans as different claims and retains uncertainty. It does not imply measured
model tokens, cost or calibration. Deterministic conformance remains separately
labelled synthetic/scripted evidence.

`validation/provider-benchmark-linux.json` retains the observed context/output,
prepare/validate, publication, refresh and cumulative host RSS measurements.
Timings overlap and are not additive. The cumulative RSS peak is not per-phase
allocation or combined parent/child RSS. JSON costs remain whole-store costs.
The graph over 100 MB is outside the supported envelope; it is not a successful
capacity test.

## Remaining acceptance gates

1. PR platform jobs must pass on Windows 2022, macOS and supported Linux/Node
   baselines using the exact development package. Configured jobs are not an
   observed result; link their completed runs when available.
2. Publish the provider-enabled Harness, then pin the new published version,
   archive and manifest hashes in host compatibility, downloader, CI and runtime
   negotiation. Rerun the packaged pair. Do not silently replace the published
   0.12.0 bytes or claim that version number alone proves this API exists.
3. Retain provider-mode default full-IIS and IIS Express deployment observations.
   Existing config-2 identity checks do not prove provider-mode acceptance.
4. Close #34 / Phase A only when those remaining gates have supporting evidence.
   The optional SQLite and verified migration issues #35/#36 remain separately
   scoped and disabled. No live provider switch or migration is implied.

The implementation may be reviewed/merged independently of authorizing a new
release. CI refuses to publish a new host version while the provider package is
marked unpublished. Consumer-server execution is not available in this session;
no server identity or deployment result has been invented.
