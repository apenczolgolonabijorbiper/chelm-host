# Issue 51 investigation evidence

Tested PR #67 head `38bf2d79d4fdf55303f186341f2960b4abdf604d`, merge
`145f4c1d3f563c94d07c7e0f27db49a7f2d187c5`, based on master `efda249`.
The runtime implementation is unchanged by the subsequent evidence-only commit.
Published reference Harness 0.13.0 manifest SHA-256:
`fa8ae35da38a1f64e82336ef99c46fdce35a502c2ff5ebf197e618f10e76e17b`.

## Observed Windows comparisons

[Investigation run 45896467652](https://github.com/apenczolgolonabijorbiper/chelm-host/actions/runs/45896467652)
used Windows Server 2022 build 20348 and the locked MCP SDK 1.32.2.

| Node | Standalone: 10 processes, two cases each | Before idle deadline: 10 cases | After idle deadline: 10 cases | Source suite load |
| --- | --- | --- | --- | --- |
| 24.14.0 | 20/20 pass | 10/10 pass | 10/10 pass | Both MCP cases pass; whole attempt fails at 600 seconds with `operation_timeout` (124) |
| 24.22.3 | 20/20 pass | 10/10 pass | 10/10 pass | Both MCP cases pass; whole attempt fails at 600 seconds and reports `tree_cleanup_failed` (125) |

These are thirty independent targeted process invocations per Node version,
without a retry wrapper discarding failed attempts. Each standalone invocation
includes the normal reconnect/idempotency case and deliberate response loss after
commit. The two full-source comparisons remain failures. Their zero aggregate
counts mean termination prevented the final TAP summary, not that no tests ran;
partial logs contain 149 and 141 passing case lines respectively.

All 84 retained Windows MCP traces have zero dropped events. Each Node version
has eleven expected failed submit calls from deliberately dropped responses
(ten standalone and one under suite load), with `UND_ERR_SOCKET`; reconnect
recovers the committed receipt and repeated submit preserves one result. There
are no unexpected failed client phases in these traces. No `socket_timeout`
event was observed. The fetch pool may retire a socket before the server's
deadline, so the idle passes do not diagnose a server keep-alive race. Neither
the historical `read ECONNRESET` cause nor the original Windows 10 environment
was reproduced. The outer-suite cleanup failure is retained separately and does
not establish an MCP transport leak or its absence.

## Linux control and retained setup failure

Ubuntu / Node 24.14.0 passed all three ten-attempt sets (40 targeted cases) and
the full source-suite attempt: 170 passing cases, seven explicit unstaged-source
skips, no failures. Its 42 MCP traces have zero dropped events or unexpected
failed client phases. The first Linux job stopped before testing because the
published Harness download returned HTTP 403; its individual job rerun passed.
That setup failure remains in attempt 1. Retrying setup did not rerun or replace
the failed Windows load comparisons.

## Broader validation and development package

[Ordinary validation run 45896467587](https://github.com/apenczolgolonabijorbiper/chelm-host/actions/runs/45896467587)
passed all jobs: staged 177/177 host tests on Linux Node 22.12.0/24.22.3 and
macOS Node 22.12.0, Windows Node 22.12.0 smoke (1/1), Windows Node 24.22.3 focused
checks (36/36), full-IIS file/provider and IIS Express provider probes. The fresh
local Linux Node 24.22.3 staged build also passed 177/177 host tests, 11/11
adapter cases and 9/9 Python checks. Local before/after idle cases each passed.

The separate extended Windows comparison
[run 45896467513](https://github.com/apenczolgolonabijorbiper/chelm-host/actions/runs/45896467513)
was still running at this checkpoint. Its 750-second staged attempts and later
serial/per-file diagnostics are not claimed as observed passes here.

[The machine-readable summary](summary.json) retains artifact digests,
individual attempt outcomes, report/log/trace hashes and package identities.

The downloaded development ZIP matches its checksum, exact 472-entry inventory
and every one of its 471 file hashes; there are no `node_modules` entries.
Archive SHA-256: `79c819100ad80a6f777bda65f9fc57070d327da701b00422085b1d1825279297`.
Manifest SHA-256: `1c3b78cfd5be8cbc0da295d946dcc34a5f95ce1c66cc14a2092b982348c7fc7c`.
This is an unpublished development package, not the published 1.4.0 asset.

Supported Harness 0.12.0 and 0.14.0 qualification initially failed during
package-download timeouts; their individual reruns passed. Earlier failed
reports remain retained. Below-0.11 candidate failures are outside the supported
scope; the separate approval/policy work in PR #65 is not changed here.

## Closure boundary

The historical Windows 10 reset cause remains unconfirmed. Issue #51 must not
be marked fixed solely from these passes. Capture labelled traces on the original
Windows 10 / Node 24.14.0 machine, or a demonstrably equivalent failing setup,
using [the reproduction commands](../../MCP_RESET_INVESTIGATION.md). Distinguish
the intentional response-loss case from an unexpected reset. The complete
Windows staged-suite gate and source-load diagnostics must also retain their
actual outcomes; no timeout failure is converted into a pass. Live HTTPS/client
acceptance remains tracked separately in #7/#11.
