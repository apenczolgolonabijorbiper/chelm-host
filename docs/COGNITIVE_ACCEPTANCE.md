# Cognitive task acceptance (#25)

Implementation scope: #26 lifecycle, #27 execution, #28 result/read views,
#29 reviewed learning/continuation, #30 packaged integration and evidence.
Owner authorized implementation on 2026-11-23. No publication or consuming
runtime upgrade is included. Issues remain open for their outstanding gates.

## Observed versus pending

| Area | Implementation/evidence | Status |
|---|---|---|
| Durable task API, defaults, idempotency, caller scope | lib/cognitive.mjs; conformance/cognitive.test.mjs | source implementation; Linux conformance observed |
| No-inbox answering, ownership, finite attempts/cancellation | same; existing runtime operation lock | deterministic acceptance observed |
| Local and authenticated remote contract | same assignment/output helpers; official independent MCP client reconnect | deterministic acceptance observed |
| Exact source/citation scope, bounded reads, forged quotes | Harness session/validator plus host retained snapshots/audit | deterministic acceptance observed |
| Result/receipt crash boundary and retry | one atomic authoritative completion record; fault after commit before projection | deterministic response-loss recovery observed |
| Strict/current and stale snapshot semantics, concurrent intake/commits | cognitive conformance | deterministic acceptance observed |
| Authorized/rejected/stale learning; bounded linked continuation | Harness public publishLearning; host application authorization | deterministic acceptance observed |
| Ordinary intake/ask/answer/observation workers/read views | full existing conformance/parity/regression suite | recorded validation below |
| Tool/schema/SudoLang alignment | generated local schemas checked against remote Zod tools; prompt tool-name assertions | deterministic checks |
| Actual LLM multi-source and full semantic cases | no inference in deterministic test executors | pending; scripted tests do not count |
| Supported published cognition Harness and exact pair hashes | 0.11.0 remains pinned and feature fails closed | pending authorized upstream publication and reviewed pin update |
| Packaged task execution with published cognition contracts | clean-package tests can exercise only current gated pair + separately injected source | pending published pair |
| Windows/macOS and .NET/IIS task views | CI matrix configured; direct C# file read added to IIS probe with FileShare.Delete | new platform results pending |
| IIS Express Windows 11 / full IIS Server 2022 | deployment guidance retains existing transport/identity procedures | actual cognitive runtime acceptance pending |

Harness source dependency: exact commit in tests/cognitive-source.json. Tests
inject the real public core/session/reference adapter functions through a
function-only seam. No runtime flag, environment bypass, arbitrary executable
configuration or weakened release-integrity check is provided. The source does
not masquerade as published Harness 0.11.0.

## Reproduce source conformance

Prepare the pinned published 0.11.0 package with tools/prepare-harness.py. Check out
the exact source commit from tests/cognitive-source.json separately. Install locked
Node dependencies, then set CHELM_HARNESS_ROOT to the verified package and
CHELM_COGNITIVE_SOURCE to that source checkout. Run:

```
node --test --test-concurrency=4 tests/conformance/cognitive.test.mjs
node --test --test-concurrency=4 tests/
python tools/build-release.py --harness /absolute/path/to/verified-harness
```

Without CHELM_COGNITIVE_SOURCE the candidate-dependent cases explicitly skip;
the published-package capability-refusal and tool-schema checks still run. CI
checks out the exact source SHA and runs these cases across its platform matrix.
This is configured coverage until the corresponding jobs have actually passed.

For full LLM acceptance, first pin a published cognition Harness. Use its
COGNITIVE_CONFORMANCE.md fixtures/rubric and record a separate semantic verdict
for each case, actual requested/observed model identity/configuration, versions,
result/citation receipts and unknown cost/token values as null. Exercise the same
application/worker workflow over CLI/stdio and remote MCP from a clean install,
with no pending inbox. Include multi-source/as-of/conflict/identity/missing-data
cases, rejected/approved learning, observation-backed collection and bounded
continuation. Integrity validation is not entailment or correctness assessment.

Operation logs report queue/snapshot capture, read/context, artifact staging,
validation and publication command durations separately. Result elapsed_ms is
invocation wall time and cannot be advertised as measured inference latency.
There is no unsupported performance/token/cost promise.

## Validation record

A clean staged Linux package build passed 95/95 Chelm tests, 11/11 published
Harness adapter conformance cases and the builder's five preparation tests,
including installer/integrity and existing process-crash recovery. The
validation/conformance stage took approximately 60 seconds (no inference).
The ZIP was built for review only and was not published. See the implementation
PR for final observed results. Focused
Linux development conformance: 11 passed, including independent authenticated
HTTP client reconnection, 2026-11-23. This was deterministic transport/lifecycle
execution; no language model was invoked by those workers. Windows/macOS results,
full model-semantic acceptance and the published cognition pair remain open.
