# Windows MCP reset investigation (#51)

PR #55 already added phase labels, awaited cleanup and post-commit response-loss
reconciliation. Its merged tests passed ten Windows Node 24 attempts. Those
passes did not identify the historical Windows 10 / Node 24.14.0 reset cause.

The `MCP reset investigation` workflow uses the integrity-verified published
reference Harness from compatibility.json (currently 0.13.0), synthetic private
runtimes and the locked MCP SDK. Its scope depends on the trigger:

| Trigger | Platforms | Repetitions per scenario group | Complete suite/load comparison |
| --- | --- | --- | --- |
| Pull request | Windows Server 2022 and Linux, current Node 24 | Two | Covered separately by regular validation; omitted here |
| Manual `workflow_dispatch` | Windows Node 24.14.0 and current Node 24; Linux Node 24.14.0 control | Ten | Included on every matrix entry |

Both modes cover standalone cognition/reconnect and forced response loss, plus
cognition 50 ms before and after the effective idle deadline: the unchanged
5,000 ms keep-alive timeout plus Node's buffer, when available. With a 1,000 ms
buffer these waits are 5,950 and 6,050 ms, twice per cognition case.

Use **Actions → MCP reset investigation → Run workflow** on the desired ref for
the complete historical-version and load investigation. Two PR repetitions are
regression coverage, not the ten-attempt qualification required by issue #51.
Each requested attempt is retained and any failure fails its step; subsequent
comparisons still run. There is no mutation retry wrapper. The existing forced
response-loss case queries status after reconnect before repeating the exact
idempotent submit. Artifacts and labels remain the same in both modes; the JSON
policy and exact Node version identify their scope.

Ordinary release checks retain their existing budgets and do not add idle waits.
The manual source-load comparison uses the runner's default 600-second attempt
bound; the separate supported staged Windows release suite uses its existing
750-second bound. A source comparison timeout remains a failed comparison,
even when its MCP cases completed successfully. No attempt bound was increased.
The runner prints attempt start/completion and a heartbeat every 15 seconds;
TAP output is still retained and printed when each supervised attempt exits.
These waits bracket the server's configured idle deadline; they do not force the
client to reuse that socket. The native fetch pool may retire a connection
earlier. Check socket IDs and `socket_timeout` events before attributing any
failure or pass to the server's keep-alive boundary.

## Reading evidence

Download `mcp-reset-<os>-<node>` from the run. `tests-*.json` records OS release,
exact Node version, Harness manifest identity, attempt counts, exits and durations;
the matching TAP logs retain failure phases and nested fetch cause codes.
`mcp-*.json` contains bounded chronological client and server events, with a
monotonic timestamp, server generation, socket ID and request ID. `dropped`
must be zero for a complete trace. No authorization headers, URL/query strings,
source bodies, tool arguments, arbitrary error messages or result bodies are
recorded. These diagnostics are opt-in callbacks; the production service does
not persist them by default.

`server_listening` records the actual timeout and buffer values used in the run.

For a reset, correlate the failed client phase with the server tool/request on
the same generation and socket. A completed tool followed by an unfinished
response means the caller must reconcile the durable outcome. `shutdown_started`
distinguishes intentional stop/restart; `request_aborted`/`socket_error` describe
peer interruption; `socket_timeout` and its elapsed time identify the idle edge.
An isolated timeout or passing run does not prove the historical cause.

To reproduce locally with a verified Harness and installed dependencies:

```powershell
$env:CHELM_HARNESS_ROOT = (Resolve-Path ../harness-release).Path
$env:CHELM_PROVIDER_HARNESS_ROOT = $env:CHELM_HARNESS_ROOT
$env:CHELM_ACCEPTANCE_REPORT_DIR = "$PWD/dist/mcp-reset"
node tools/run-tests.mjs --file tests/conformance/cognitive.test.mjs --name "Independent authenticated MCP client|MCP response loss after commit" --repeat 10 --concurrency 1 --label standalone
$env:CHELM_MCP_IDLE_EDGE = 'before'
node tools/run-tests.mjs --file tests/conformance/cognitive.test.mjs --name "Independent authenticated MCP client" --repeat 10 --concurrency 1 --label idle-before-expiry
$env:CHELM_MCP_IDLE_EDGE = 'after'
node tools/run-tests.mjs --file tests/conformance/cognitive.test.mjs --name "Independent authenticated MCP client" --repeat 10 --concurrency 1 --label idle-after-expiry
Remove-Item Env:CHELM_MCP_IDLE_EDGE
node tools/run-tests.mjs --label suite-load
```

Use a separate report directory for each Node version. Windows Server CI does
not substitute for the original Windows 10 machine; an unreproduced historical
reset remains unresolved. Live HTTPS/ARR and physical clients remain #7/#11 gates.

Portability (#38–#41): this changes optional HTTP diagnostics and investigation
tests only. CLI, local worker, persistence, routing and public remote contracts
are unchanged; no shipped local SudoLang specification requires a contract change.

## Observed results

See [the retained investigation evidence](evidence/mcp-reset-2026-11-26/README.md)
for exact tested revisions, platform and package identities, passing MCP
repetitions, failed whole-suite comparisons and remaining closure requirements.
