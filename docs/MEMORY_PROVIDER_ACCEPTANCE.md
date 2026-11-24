# Memory provider Phase A acceptance (#32–#34)

Chelm 1.3.0 pairs with published Harness 0.13.0. The exact archive and manifest
identities are in `compatibility.json` and `provider-compatibility.json`; both
runtime modes consume identical release bytes on every platform. The staged
builder runs all host regressions, the unmodified vendor provider suite against
Chelm's own store and the reference backend conformance suite.

Release validation retains platform JSON artifacts and separate config-2 full-IIS,
config-3 full-IIS and config-3 IIS Express observations, including package hashes,
Windows principal, provider receipt and completed read-only cognition. Publication
is gated on the whole successful matrix. These are synthetic vendor tests on
hosted Server 2022; no consumer Windows 11 or Standard server run is implied.
See the finalization PR and its checks for observed results, and the release
assets for retained platform/deployment JSON reports.

SQLite, migration and live consumer upgrade are not part of Phase A. The Work
extraction below remains its original immutable response and separate semantic
verdict; subsequent deterministic checks do not count as further LLM trials.

## Historical implementation evidence

The following observations and development pin document PR #43 before the
provider contract had a published version. They are retained as provenance and
are superseded for runtime/CI selection by the published 0.13.0 pins above.

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

The Windows builder has a separately pinned manifest
`a6920ddae1200556c5717cbe47f547867eef4592960de46f1f9e8490043f411d`.
Its only file-hash difference is the generated architecture explorer; all runtime,
contract and validator bytes match the default package exactly. A regression
check proves that the two pinned manifests differ only in that presentation file.

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

## Published-pair acceptance procedure

1. Download the exact published 0.13.0 archive; check archive, manifest, inventory
   and all payload hashes before use. No source build substitutes for the ZIP.
2. Run the staged package builder, all host/provider/backend conformance cases
   and synthetic capacity benchmarks on Windows 2022, macOS and Linux with the
   supported Node baselines. Keep per-platform reports.
3. Run `Test-IisIdentity.ps1` once in config-2/full IIS, once with
   `-MemoryProvider`, and once with `-MemoryProvider -Mode IisExpress`. Retain
   each identity and receipt independently. Require semantic-only memory changes,
   committed readback, audit success, read-only cognition and C# reader recovery.
4. Accept Phase A / #34 / #32 only after the observed runs pass. Optional SQLite
   #35 and migration #36 remain open and disabled, with independent future gates.

The earlier merged implementation at `3d98ee0359497cd1b5edf998d04e9887fe949bb0`
already passed [platform run 45405713235](https://github.com/apenczolgolonabijorbiper/chelm-host/actions/runs/45405713235)
and [config-2 full-IIS run 45405713271](https://github.com/apenczolgolonabijorbiper/chelm-host/actions/runs/45405713271).
Those observations do not substitute for the new published-pair/provider-mode
checks. Timings and RSS retain the limitations documented above.
