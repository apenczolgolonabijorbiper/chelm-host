# Issue 53 implementation and evidence boundaries

Tracks VI-024 (#49), VI-023 (#50), VI-022 (#51) and VI-018 (#52).
Published Harness 0.13.0 stays pinned; no consumer runtime is modified.

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

No version bump, publication or external acceptance claim is made here. Retain
platform reports and package hash checks, review/merge first, and select the next
version against master only when publication is authorized.
