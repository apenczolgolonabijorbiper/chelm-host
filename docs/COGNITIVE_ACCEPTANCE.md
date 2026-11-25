Current supported pair: Chelm 1.3.1 / published Harness 0.13.0. The full
cognition suite is rerun by the provider-pair release checks; current package
pins and deployment evidence are described in MEMORY_PROVIDER_ACCEPTANCE.md.
The 1.2.0 / 0.12.0 observations below remain historical, including the original
actual-Work response and its immutable hashes.

# Cognitive task acceptance (#25) — Chelm 1.2.0 / Harness 0.12.0

Scope: #26 lifecycle, #27 execution, #28 read views, #29 learning/continuation,
#30 packaged vendor acceptance. No consuming application/runtime is upgraded.

## Published pair

Production and the full cognition suite use published Harness 0.12.0 from
compatibility.json. Archive SHA-256:
`9bc17e21d0528e7359006b5bda6c17cce99df3021294e15e2d217d7330627522`.
Manifest SHA-256:
`52c4fa98a06993bfa4f2504df58a82504e4303a20fd465a09c19140b8d3cfda6`.
No source checkout, engine-injection test setting or skipped cognition cases.
The published Harness also retains its own [18-case vendor acceptance](https://github.com/apenczolgolonabijorbiper/golem14-harness/tree/v0.12.0/cognition/conformance/chatgpt-work/fresh-2026-11-23),
including per-case semantic verdicts. The six host cases supplement that portable
coverage with actual Chelm lifecycle and transport execution; they do not replace it.
The published evaluator was rerun against all 18 retained inputs/outputs with zero
integrity errors; [provenance](evidence/published-harness-cognition-provenance.json)
records raw file hashes and distinguishes reuse from new inference. The release
builder repeats this shared-fixture check as well as the six host integrity checks.

## Observed versus pending

| Area | Evidence | Status |
|---|---|---|
| Task lifecycle, idempotency, ownership, cancellation, expiry | cognitive.test.mjs | 11/11 Linux cognition cases pass against published package |
| Results, receipts, restart/reconnect, exact source reads, scoping | same, including independent authenticated HTTP MCP client | deterministic acceptance passed |
| Concurrent intake, strict/stale snapshots and guidance changes | same | deterministic acceptance passed |
| Read-only, rejected/stale/approved learning and finite continuation | same | deterministic acceptance passed |
| Upgrade from original 1.1.0 / published 0.11.0 | [disposable Linux upgrade record](evidence/cognitive-upgrade-linux.json) | original HEAD/claims preserved; cognitive context works without reset/migration |
| Full clean-package regression | staged release builder | 95/95 host tests, 11/11 Harness backend conformance, 5 preparation checks passed; zero skips |
| Actual external LLM through CLI and HTTP MCP | [six retained responses and semantic verdicts](evidence/cognition-2026-11-24/README.md) | 6/6 pass; exact original response hashes, committed receipts, resolved citations, rejected/approved learning and observation-backed resume |
| Linux/macOS/Windows matrix | [current PR checks](https://github.com/apenczolgolonabijorbiper/chelm-host/pull/42/checks) | required before merge; Linux Node 22.12/24, macOS Node 22.12, Windows Server 2022 Node 22.12 |
| IIS identity, completed task/result file read, bounded sharing refusal and post-close C# reader recovery | [retained Windows result](evidence/cognitive-iis-windows-2022.json) | passed in [focused CI](https://github.com/apenczolgolonabijorbiper/chelm-host/actions/runs/45334865794) at bfb66e3, including ApplicationPoolIdentity / LoadUserProfile=false |
| IIS Express on Windows 11 and consumer's full IIS Server 2022 Standard deployment | existing deployment procedures and issue #11 | external deployment validation remains separate; not claimed by hosted CI |

## Reproduce deterministic acceptance

```
python tools/prepare-harness.py --version 0.12.0 --destination ../harness-release
npm ci --ignore-scripts
# Set CHELM_HARNESS_ROOT to the absolute verified package directory.
node --test --test-concurrency=4 tests/conformance/cognitive.test.mjs
python tools/build-release.py --harness ../harness-release
```

The final clean Linux package validation/conformance stage took 52.4 seconds on
Node 24.22.3 / Python 3.12.14; benchmarks and ZIP creation are additional.
Scripted tests and the IIS service probe do not invoke a language model.
Model semantic acceptance is independent of schema/digest/citation integrity.

## Model evidence and measurement limits

The actual Work executor receives bounded task/context/source artifacts through
Chelm's public CLI or an independently authenticated official MCP HTTP client.
Retain original response bytes before validation/review, exact inputs, hashes,
result/citation receipts, model/configuration unknowns and a separate semantic
verdict/reason for each case. Test fixtures are synthetic; observation seeding
is deterministic and is not counted as model inference. The same Work agent
subsequently reviews its responses; no independent model review is claimed.

Operation logs retain queue/snapshot, context/source, staging, validation and
publication durations separately. Result elapsed_ms includes executor wall time;
it is not measured inference latency. Actual inference tokens, cost and model
settings unavailable to Work remain null, never inferred from prose or synthetic
counters. No performance promise follows from these fixtures.
