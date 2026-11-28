# Deployment and live acceptance

Use this checklist after the automated suites. These checks require the owner's
server, reference workstation, consuming application or inference credentials.
A passing synthetic process fixture does not complete this checklist.

For copyable A/B commands, a disposable fixture, measured MCP bridge and the exact
files to return, use [the issue #11 operator runbook](ISSUE_11_ACCEPTANCE.md).

## E-1: Windows/IIS HTTPS service

Follow REMOTE_WORKERS.md to install the persistent loopback service and IIS ARR
HTTPS proxy. Run tools/Test-IisIdentity.ps1 on the Windows Server 2022 target;
retain its JSON output. Record Windows edition/build, Node/Python/Git versions,
service identity, app-pool identity and LoadUserProfile setting. Hosted CI is
separate evidence from this target-server run.

From a second machine, run:

```powershell
$env:CHELM_WORKER_TOKEN = '<credential from your secret store>'
node tools/probe-remote.mjs --url https://golem.example/mcp --token-env CHELM_WORKER_TOKEN --output remote-probe.json
```

Expected: JSON `ok: true`, compatible schemas for all 11 file-worker operations,
the three file-worker prompts matching the probe's package, and successful read-only
work listing. Additional tools/prompts are allowed. Use the same verified package
on both machines. The report records the installed SDK version and server identity,
without tokens, work contents or server paths. A wrong token must give HTTP 401;
a principal without runtime permission must give HTTP 403. Confirm the origin
allowlist and inspect server/proxy logs for secret or observation leakage.
TLS/certificate or 502 failures indicate proxy/backend configuration; 401 points
to credential/issuer/audience/scope; 403 points to runtime permission or origin.

The read-only probe checks connectivity and discovery, not cognition. It makes
no claim about a particular IDE's OAuth flow. In OAuth mode use the actual MCP
client's authorization flow and record issuer/client registration and refresh.
Do not put tokens in service JSON or SudoLang prompts.

## E-2: Reference workstation performance

Use [the issue #3 runbook](ISSUE_3_ACCEPTANCE.md) to collect a fresh, checksummed
bundle with repeated timings, complete staged suite reports, machine/load and
package identities. Its service command can be launched by the actual consuming
service to measure operations under that account. A declared context or matching
account does not by itself prove reference-machine or service invocation provenance.
The individual benchmark commands below remain available for diagnostics.

On the reference Windows workstation, use the exact supported, verified harness 0.13.0:

```powershell
node tools/benchmark-host.mjs --harness C:/Golem/harness --samples 5 --output benchmark-reference.json
node tools/benchmark-capacity.mjs --harness C:/Golem/harness --samples 5 --output capacity-reference.json
python tools/build-release.py --harness C:/Golem/harness
```

Both benchmarks create disposable synthetic runtimes. No production runtime path
is accepted. Record idle/background load and retain every raw sample, CPU, memory,
OS and tool version. benchmark-host includes Node process startup, submit of ten
groups, ask including retrieval, and plain-file status. capacity covers actual
harness source/entity/claim limits, 10,000 subjects, 100,000 turns, regeneration
without validation/statistics, deep refresh with those child costs separately,
and accepted exact/refused over 64 MiB committed trees. Unmet targets remain in
the report and must not be silently converted to pass. Build suite timing is a
separate report; its duration includes staged dependency setup and checks.

## E-3: Two-machine inference and prompts

Use A as the owner service and B as the worker. Record machine/client/agent/model
versions, transport, authentication mode and unattended approval policy. Use the
shipped one-cycle prompt against the actual tools, then the bounded runner recipe
in REMOTE_WORKERS.md. Record unknown model identity as unknown.

Run these scenarios on a disposable runtime with synthetic observations:

| Scenario | Required observable result |
|---|---|
| One-cycle analysis | Valid journal, graph/queues, committed receipt and corresponding app read view |
| No work | `no-work` and retry delay; no busy polling |
| Validation repair | Invalid quote refuses; new corrected revision validates and publishes |
| Connection/service restart | Reuse request ID; query assignment/status; recover same work or receipt |
| Lost submit reply | Query status before retry; exactly one source ledger row/commit |
| Policy change | Old candidate refuses; fresh assignment rereads changed guidance |
| Concurrent batches | Disjoint assignments; both results retained |
| Integration | Agent reviews every flagged summary; stale attempts cannot publish |
| Loop | Bounded cycles/budget; renewal during inference; stop on revoked authorization |

Retain concise decisions and receipts, never private reasoning traces. Report
assignment/context/upload/validation/publication separately from inference time,
request/response bytes, actual provider token counts and billed cost. Missing
provider usage/cost is `null` (unknown), never zero. The deterministic process
fixture in tests/conformance/process-recovery.test.mjs exercises an HTTP proxy and
two independent SDK clients on one machine. It is not physical-machine or LLM
acceptance. CI phase reports are synthetic transport measurements only.

## E-4: Consuming application

On an isolated application branch/runtime, verify application configuration,
status, intake, conversation/answers, subject counts, journals, requests and
source export/import using only the public app contract. Run the consumer's own
HTTP/export smoke suite. Check that private runtimes and vendor files are not
exposed or reinitialized, and capture backup/upgrade/restart behavior. Report
which checks ran under the real consuming service identity.
