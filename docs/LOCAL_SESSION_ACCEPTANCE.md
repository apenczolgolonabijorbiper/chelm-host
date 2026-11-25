# Local session acceptance — #45–#48

The implementation targets the published Harness 0.13.0 package pinned by
compatibility.json and provider-compatibility.json. Upstream Chelm master at
start: a080fd5 (includes #53 process ownership/test-policy changes); published
Chelm remains 1.3.0. This work does not publish a release or upgrade a consumer.

## Separate evidence categories

| Case | Evidence / present status |
| --- | --- |
| Real settled config-2 checkpoint, moved directory, all history/IDs, queued task, completed source, result, receipt, exact citation | tests/checkpoint.test.mjs; production CLI/Harness integration, synthetic data |
| Config-3 restore and public audit, retained snapshot citation | tests/checkpoint.test.mjs |
| Git remotes/hooks/credential canaries excluded, task ownership explicitly rebound | tests/checkpoint.test.mjs |
| Active work, unresolved publication, changed protocol/drafts, outside roots, tampering/truncation/package mismatch/budgets | tests/checkpoint.test.mjs |
| Independent store persistence, session/base/expiry fences, reset races, stable receipt recovery, input arriving during work, unavailable storage | tests/durable-session.test.mjs |
| Optional D1 SQL CAS / R2 conditional object contract | tests/session-transport.test.mjs; actual SQLite in independent processes and persistent filesystem bucket fixture; **not hosted D1/R2 evidence** |
| Actual authenticated narrow HTTP transport | tests/session-transport.test.mjs; independent loopback server process, missing/wrong token refusal, save, original runtime deletion, fresh directory restore, citation read, new evidence, reset/late-worker refusal |
| Actual inference through this deployment | Observed ChatGPT Work LLM response, real cognitive validation/submission and authenticated HTTP checkpoint/restore; docs/evidence/local-sessions-2026-11-25/ retains exact request/response, accepted receipt and persistence report |
| Fresh independent ChatGPT Work/Codex/Cursor conversation resume | Pending; fresh CLI processes/directories do not establish a new agent conversation |
| Live Sites authentication, D1/R2 and agent handoff | Template/recipe implemented; deployment and authenticated agent route access pending |
| Windows/Linux/macOS clean package | Existing release CI matrix includes new suites; record observed runs before claiming platform acceptance |

The setup/run/checkpoint/reconnect/stop/reset SudoLang prompts and normative
portable specification ship with the code. A Site deploy or browser sign-in
does not prove that an agent can call its routes. Manual export/import is not
substituted for live integration. No private Persona1 data/history is included.

Observed on 2026-11-25: the source suite passed 141 tests, with six package-only
checks skipped in source mode. The full staged builder then passed all 147
host tests (zero failures/skips), 11 Harness backend conformance cases, package
verification, retained cognition integrity checks and synthetic benchmarks;
`docs/evidence/local-sessions-2026-11-25/checks.json` retains the package identities. The actual LLM answer correctly
distinguished an unapproved 26 November proposal from its approved 28 November
replacement. A new Node process restored that accepted answer and exact source
citations after deletion of the original runtime, saved newly submitted evidence
as revision 2, then reset and rejected a late original-session publication with
`generation_changed`. Initial local history was enrolled after the answer;
subsequent evidence was durably queued before local intake. Model/provider ID,
reasoning parameters, tokens and cost were unavailable. The implementing agent
also reviewed this one synthetic case; this is not a blinded/general capability
assessment. A fresh Node process is not a fresh ChatGPT Work conversation.

Persistent stop/reconnect/reset was also verified: stopping retains only an inert
storage association, reconnect acquires a new fence at the same durable base,
and full reset after stop still fences the store. Final actual-agent evidence
was refreshed after this lifecycle fix and matches the current code fingerprint.

## Release/closure gate

Use the full staged builder against the exact published Harness package. Retain
platform results and package identities. Run a real external-model task, save it,
lose its original execution workspace, resume in a fresh agent session, process
new evidence, read the earlier citation, and reset while an old agent is detached.
Observe actual hosted storage/transport separately from model and deterministic
checks. Keep #45/#48 open until those external observations are retained; do not
mark all tracker acceptance merely because the implementation and CI exist.
