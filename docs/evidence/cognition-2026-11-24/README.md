# Actual ChatGPT Work host acceptance — 24 November 2026 (Warsaw)

Six original responses were authored by ChatGPT Work from Chelm-delivered
artifacts and committed through public production CLI / authenticated HTTP MCP.
Observation seeding and transport/JSON assembly are mechanical scaffolding;
these responses are actual assistant inference, not deterministic test answers.
No provider API call or second model session was required.

| Case | Transport | Result | Semantic review |
|---|---|---|---|
| local-current | CLI | Latest revised date, seven-day change; actual dispatch unknown | pass |
| remote-current | official authenticated HTTP MCP client | Same grounded conclusions and snapshot contract | pass |
| local-asof | CLI | 10 May valid-time query returns 10 June plan | pass |
| remote-identity | HTTP MCP | Separate employee IDs; linked clarification; needs_input | pass |
| remote-missing | HTTP MCP | Actual dispatch unknown; collection proposal; learning rejected | pass |
| remote-resumed | HTTP MCP | New observation -> 18 June actual -> one day late; reviewed learning committed | pass |

Each directory contains request.json (bound task, protocol pages, context, exact
original source reads and delivery receipt), original response.json and
completion.json (validation, committed receipt, recovered result and citation
reads). Learning cases also retain the original separate proposal and the
application authorization/publication receipt. Original response files were
created once and were never revised after validation or review.

semantic-review.json records a separate reason/verdict for every response.
hashes.json covers retained files. configuration.json identifies the exact
host ZIP/manifest, Harness ZIP/manifest, runtime source commit and limitations.
collection.json and recovery.json retain the application-controlled follow-up,
normal observation-processing receipts, two-answer history, restart/retry receipts
and the published canonical hypothesis with its original claim premises.
phase-timings.json contains public-command wall times; host-chelm.jsonl retains
separate host operation phases. Unknown inference duration, model ID/settings,
actual token usage and cost remain null. Host elapsed time is not inference time.

## Recheck retained integrity

```
node tools/check-cognitive-evidence.mjs docs/evidence/cognition-2026-11-24 /absolute/verified/harness
```

The release builder runs this check against the same published Harness used by
production. It checks hashes, schema, binding, delivery usage, claims, exact
citation text and retained receipts; it does not automatically grade meaning.
The supplied semantic verdicts are subsequent same-agent review.

## Reproduce a new run

Build/extract the clean host ZIP, verify the exact published Harness and restore
the extracted host's locked dependencies. From this checkout create a JSON state
file outside both packages with absolute package_root, harness_root, runtime
(a new nonexistent disposable directory), and evidence (a new output directory).
Run `node tools/cognitive-acceptance.mjs OP /absolute/state.json [CASE]`:

1. init seeds the four synthetic observations through normal intake/worker submit.
2. prepare CASE captures the task, all protocol pages and bounded source/context.
3. Have an external agent read those artifacts and write its original portable
   response.json; in propose_learning mode optionally write learning.json.
4. complete CASE validates/stages/submits exact bytes and resolves citations.
5. Repeat sequentially for local-current, remote-current, local-asof,
   remote-identity and remote-missing. The default runtime permits one active
   cognitive assignment, so complete each case before preparing the next.
6. learning remote-missing rejects learning; collect approves the synthetic
   dispatch record, submits/processes it and explicitly continues the task.
7. prepare remote-resumed, have the agent author its original answer/proposal,
   complete remote-resumed, then learning remote-resumed authorizes publication.
8. verify checks all original hashes and replays remote status/submission after
   fresh server/client sessions, retaining canonical learning and phase evidence.
9. Record independent semantic reasons/verdicts and a new hash manifest separately.

The runner deliberately contains no answer generator or model scoring rubric.
It must never be directed at a consuming/private runtime.

## Limits

This is one synthetic integration run with six responses and same-agent later
review. Fixture/test content was visible; no blind benchmark or independent
reviewer is claimed. Both HTTP endpoints and CLI ran on one Linux executor;
this is genuine authenticated MCP transport and server restart evidence, not a
second physical machine or a Windows/IIS model execution. Remote-current reused
the identical-evidence findings from local-current with its own authored answer.
The original runtime package predates evidence/checker-only additions; final CI
must validate the complete source/package as well. Live IIS Express Windows 11
and the consumer's Server 2022 Standard deployment remain independent external
acceptance tracked in issue #11.
