# Issue 53 implementation and evidence boundaries

Tracks VI-024 (#49), VI-023 (#50), VI-022 (#51) and VI-018 (#52).
Published Harness 0.13.0 stays pinned; no consumer runtime is modified.

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
recovered and the final source was not rerun at concurrency 1. The historical
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

Finalization results and actual published asset verification are pending until
observed. Historical root causes and live-client external gates remain separate.
