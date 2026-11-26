This file records the pre-release candidate. For the later 1.4.0 platform
qualification and publication gates, see [ACCEPTANCE.md](../../ACCEPTANCE.md)
and [the qualified runtime/job record](platform-qualification-1.4.0.json).

# Issue #59 routing acceptance — 2026-11-26

Observed locally on Linux, Node 24.22.3 and Python 3.12.14. These are deterministic
software/transport tests; no Shem process or LLM was used. The change remains
unreleased. Historical Windows/macOS evidence elsewhere does not certify it.

The final staged reference package passed **174/174 host tests**, **11/11 adapter
checks** and **9/9 Python checks**, with no host skips/failures/cancellations.
The suite/adapter phase took 157.63 seconds; host and telemetry benchmarks also
passed. `staged-build.log`, `staged-host-tests.log` and the benchmark JSON retain
results. `summary.json` binds the candidate archive/manifest, tested runtime
code, test/tool/spec file hashes and retained logs. Final prose/evidence additions
follow the build; all runtime, test, tool and specification bytes match it.
The candidate ZIP is a local test artifact, not a published 1.3.1 replacement.

| Harness | File-worker checks | Cognition checks | Provider checks |
| --- | --- | --- | --- |
| 0.11.0 | 43 passed | Unsupported | Unsupported |
| 0.12.0 | 43 passed | 15 passed | Unsupported |
| 0.13.0 | Full final 174-test reference suite + 11 adapter checks | Included | Included |
| 0.13.1 | 43 passed | 15 passed | 34 passed |
| 0.13.2 | 43 passed | 15 passed | 34 passed |
| 0.13.3 | 43 passed | 15 passed | 34 passed |
| 0.14.0 | 43 passed | 15 passed | 34 passed |

The six non-reference reports total **469 passing checks** and include routing
cases in each supported feature. Their full feature runs precede the final small
local held-lease guard. That final file-worker path was separately checked on
all six releases (`routing-local-lease-*.json/log`), with six passes, and included
in the final complete reference build. Hosted qualification CI runs the full
feature sets again on the final PR revision. Unsupported features are not passes.

The fixtures cover both queues, no-inbox tasks, config 2/3, CLI/stdio/HTTP,
independently authenticated competing clients and restart, trusted local identity,
self-declaration/endpoint/runtime denial, readiness expiry/incompatibility,
nonrenewable per-work grace/fairness, allowlisted fallback, require mode, quotas,
CAS, owner retries, integration/review, lost claim/publication responses,
unknown-outcome retention, checkpoint policy/grace preservation and readiness
clearing. Public schema validation also passed two positive and six negative
cases through the independent Draft202012Validator.

Earlier failures are retained, not discarded: an initial HTTP fixture token
violated the existing minimum length; the first full source suite found four old
MCP tool-count assertions and skipped seven package-only checks; an initial delta
run assumed five nonexistent extracted-cache paths. These setup/assertion issues
were corrected before the final corresponding checks. See `summary.failure_history`
and the `initial-*` / `routing-local-lease-initial-*` files.

Remaining delivery gates: new hosted platform results, publication with aligned
host version metadata, and Shem #17's negotiation/release-qualified switch recipes.
Routing fixtures neither promote Shem nor establish real model cognition quality.
