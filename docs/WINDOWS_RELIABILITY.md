# Issue 53 implementation and evidence boundaries

Tracks VI-024 (#49), VI-023 (#50), VI-022 (#51) and VI-018 (#52).
The published 1.3.1 delivery uses Harness 0.13.0; no consumer runtime is modified.

## Published delivery verified — 2026-11-26

PR #58 integrated the complete stack into master at `1b7072d`. Release
[1.3.1](https://github.com/apenczolgolonabijorbiper/chelm-host/releases/tag/v1.3.1)
was published by successful [run 45706395650](https://github.com/apenczolgolonabijorbiper/chelm-host/actions/runs/45706395650).
The downloaded published ZIP matches its checksum and GitHub asset digest:
`37389d4f7cee7db44898423de8e2303b11e232b1e84b96778e3b1dd6c9e48807`.
All 285 entries match the exact manifest inventory and all 284 file hashes;
there are no node_modules entries. The manifest SHA-256 is
`c8560031da4ef356509b54f62950d3abcab2fea34b9d019d711f714f7dbb9fa0`.

The final pre-merge [Windows comparison run 45646296935](https://github.com/apenczolgolonabijorbiper/chelm-host/actions/runs/45646296935)
used head `26023b3`, Windows Server 2022 build 20348 and published Harness 0.13.0:

| Node | Three supported concurrency-2 attempts | Concurrency-4 qualification | Serial diagnostic | Individual files |
| --- | --- | --- | --- | --- |
| 22.12.0 | 152/152 each; 487.324 / 470.478 / 477.296 seconds | 152/152; 338.241 seconds | Timeout after 600.222 seconds | 26/26 files; 152 passing cases total |
| 24.22.3 | 152/152 each; 604.549 / 589.575 / 590.526 seconds | 152/152; 400.053 seconds | Timeout after 600.241 seconds | 26/26 files; 152 passing cases total |

Node 24 also passed ten standalone MCP attempts. Serial attempts remain failed
diagnostics. Their zero aggregate counts mean that no final TAP summary was
emitted before termination; they do not mean no tests executed. The owner's
four historical filenames remain unavailable; the individual checks cover all
26 files. These measurements establish the comparison, not the historical cause.

The comparison ZIP (`34eba840…`) is a separate pre-merge artifact, not the
published ZIP. Published release reports independently bind to the published
manifest: Linux Node 22/24 and macOS Node 22 each passed 152/152; Windows Node 22
passed its smoke check and Node 24 passed the focused profile (31 reported
passes, including all nine required named cases). Full IIS file/provider and
IIS Express provider probes passed on Node 24 against the published ZIP.
Routine Windows coverage follows the focused policy in TEST_POLICY.md.

[Retained delivery evidence](evidence/reliability-2026-11-24/published-1.3.1.json)
records artifact/report/log hashes, individual filenames, all attempts, package
identities and the two serial failures. Historical causes, live-client gates
#7/#10/#11 and consumer-machine performance remain unconfirmed. Child #49/#51
forensic items remain open; publication does not resolve them. The post-release
compatibility change #61 has separate evidence: master `ad32d5f` run 45771977587
failed one macOS provider semantic-cycle test with Git ETIMEDOUT. This delivery
record does not certify that newer tree's platform status.

## Observed cumulative acceptance, reviewed 2026-11-25

[CI summary](evidence/reliability-2026-11-24/ci-summary.json) retains observed
results from run 45468016957, tested merge `da7127bc6d1e5369e20835a864302a3a9487314f`.
Windows Server 2022 build 20348 on Node 22.12.0 and 24.22.3 each passed three
consecutive complete 136-test staged suites at concurrency 2, plus a complete
concurrency-4 comparison. Node 24 additionally passed ten consecutive standalone
MCP attempts without masking retries. Linux on both Node versions and macOS on
22.12.0 passed all 136 tests; every platform passed 11 adapter cases, with zero
skips. Synthetic descendant/socket/EOF/hang, transport recovery and legacy
migration controls are included. Full IIS file/provider and IIS Express provider
probes passed on both Windows jobs. See ACCEPTANCE.md for exact scope and hashes.

The earlier #55 Windows Node 22 job failed to connect to the IIS provider probe
after all its suites/adapter checks passed; it remains a failed historical run,
with unconfirmed startup cause. The final cumulative run passing does not explain
that failure or the owner's intermittent ECONNRESET. No original VI-023 logs were
recovered and that cumulative source was not rerun at concurrency 1. The historical
failed serial policy remains in linux-revised-policy.json. These evidence limits
are preserved rather than converting a passing test into a root-cause claim.

## Owned process lifetime and test scheduling

The confirmed source defect was equal 180-second inner-command and outer-probe
timeouts without cleanup headroom or descendant ownership. Supervised commands,
aggregate probe deadlines and parent-death monitoring address that defect.
Synthetic delayed descendants exercise timeout and abrupt caller death; neither
reproduces the original Windows orphan's internal waiting point. The original
orphan report does not prove that stdin was open. EOF regressions check the
actual CLI separately. See TEST_POLICY.md for supported scheduling and bounds.

The historical seven failures and serial 34/34 result came from the owner's
index. Detailed VI-023 raw logs were not supplied. Current reports retain exact
tests/phases and concurrent supervised-command counts instead of assigning a
resource-starvation root cause without evidence.

## Remote MCP lifecycle

The independent test already used fresh clients on reconnect. It now registers
cleanup before connect, labels each tool/connection/shutdown phase and retains
sanitized nested cause codes plus bounded server lifecycle events. Cleanup is
idempotent, attempts both client and server closure and waits for transport cleanup.
Server response cleanup registers before connect and closes the owning MCP
server once. An explicit bounded stop helper is available to probes/embedders.

A network regression drops the response after the durable cognitive commit.
The caller gets a labelled error; reconnect/status recovers the receipt and exact
resubmission returns that receipt with one result history entry. No blind retry
of a mutation is introduced. No speculative keep-alive/HTTP-timeout increase or
SDK replacement is used. The historical intermittent Windows reset's exact root
cause remains unconfirmed until the labelled Windows attempts reproduce it or
provide sufficient evidence. Ten clean attempts alone do not identify a cause.
Remote HTTPS and actual clients remain external gates in #7/#10/#11.

## Recognized legacy runtime guidance

schemas/legacy/runtime-config-v1.schema.json is byte-identical to v0.2.0 commit
2739a4ef34a037a8d0bec2be5c8f95ca3b6f96fc. Fixtures reconstruct those config
defaults around disposable current canonical memory and tool paths. They are
not an untouched old runtime or a test against historical binaries.

Config loading recognizes that version/shape before applying current schema
validation. It reports migration_required with detected/supported versions and
both runnable argv and safely single-quoted POSIX/PowerShell preflight commands.
Unknown, malformed and corrupt configs remain errors. Installers only inspect
the explicit/resolved runtime hint in both integration modes. Installation
success is separate from readiness; current schema 2 is never forced into 3.

Explicit migrate preflight preserves config/memory bytes with changed=false;
its operational lock and host log entry remain intentional side effects.
Existing settle/cancel, busy and recovery guards remain in the cutover suite.
Only explicit apply archives/replaces legacy metadata. Installer guidance never
calls init/apply/cancel/reset or touches memory.

## Portability and release scope

Issues #38–#41 remain the specification workstream. No shipped alternative local
implementation/specification exists for these helpers to update in this change.
Future parity must include version-first migration errors, read-only readiness,
EOF, budgets, owned-tree cancellation and phase diagnostics; optional MCP remains
outside local-core translation scope. Existing VI-016 chunk boundaries and
VI-020/021 verification-pointer/observability regressions remain in the full suite.

## Final integration and release preparation — 2026-11-25

PR #54 merged into master, but #55 and #56 merged into their predecessor feature
branches. The finalization branch merges the cumulative #56 tree into current
master so that both MCP lifecycle and migration diagnostics reach production.
Chelm 1.3.1 is the next patch version; Harness 0.13.0 pins remain unchanged.

The optional Windows reliability comparison workflow runs the normal staged
release gates, then verifies that ZIP's checksum and every manifest member before
extracting a separate qualification copy. It retains concurrency-4 and
concurrency-1 attempts with the same 600-second budget and runs every test file
individually. The owner's index supplies no four-file names, so all files are
covered rather than inventing that mapping. A serial suite timeout is retained
as a diagnostic result; every individual-file run must pass. Reports retain
package/report hashes and all failures. This optional qualification does not add
work to ordinary future CI unless its workflow/tool changes or it is dispatched.

Finalization and published asset verification are observed in the delivery record
above. These preparation notes retain the earlier package identities. Historical
root causes and live-client external gates remain separate.
