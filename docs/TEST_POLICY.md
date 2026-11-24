# Vendor test scheduling and bounds

Use `npm test` from source or `node vendor/chelm-host/tools/run-tests.mjs` after
installation. Set CHELM_HARNESS_ROOT and CHELM_PROVIDER_HARNESS_ROOT to the exact
published 0.13.0 package. Relative environment paths are resolved once on entry.
Use a disposable temporary runtime; never point fixtures at consumer state.

The shared runner defaults to one test file at a time on Windows and four on
Linux/macOS. Individual files retain their normal test coverage. Windows is a
conservative resource policy pending measured serial/parallel evidence; it is
not a diagnosis of ECONNRESET or proof that historical deadlocks were absent.
`--concurrency 4` selects the comparison explicitly. Retain every attempt,
including failures; do not wrap mutation tests in a success-only retry loop.

| Layer | Finite budget | Cleanup margin |
| --- | --- | --- |
| CLI operation in test/probe | 60 seconds, matching existing host subprocess bound | 5 seconds |
| Complete service probe | 150 seconds across all commands | Each child uses the smaller remaining/60-second bound |
| Outer packaged probe / individual test | 180 seconds | Supervised subprocess exits before fixture deletion |
| Whole test attempt | 600 seconds | 5 seconds for owned-tree cleanup |

These bounds preserve hang detection; they are not latency targets. Changing a
bound requires retained phase measurements. `owned-process.py` uses the existing
Python prerequisite. Windows establishes a kill-on-close Job Object before any
child starts; ownership setup failure refuses execution. POSIX gives the child
its own session and supervises it from a separate session, watching caller death.
Caller SIGKILL is handled by the surviving supervisor; killing the POSIX supervisor
itself with SIGKILL is outside that guarantee. No process-name/global kill occurs.
The IIS probe uses its explicitly configured Python executable.

JSON input is finite and EOF is delivered to CLI children. Unused stdin closes.
Timeout diagnostics contain phase, owned PID, elapsed/configured time and reason;
they omit arguments and payloads. Cleanup failure is distinct from operation
timeout. Tests require recorded descendant startup before accepting cleanup
evidence and keep an unrelated sentinel alive. Synthetic waits exercise the
cleanup mechanism; they do not identify the historical orphan's waiting point.

Reports go to dist/ or `--report DIRECTORY`: TAP logs retain exact test names and
timings; JSON retains Node/platform/package manifests, every exit/failure, command
phases/bounds and peak concurrent supervised commands. This peak counts owned
CLI commands, not all Git/Python grandchildren. Failed attempts remain failures.
`--repeat N` runs and retains N attempts and fails if any failed; it is not a retry.

The release builder requires three complete staged Windows runs and retains a
separate concurrency-4 comparison, whose failures are diagnostic rather than
the supported release gate. Windows Node 24 additionally requires ten independent
MCP cognition attempts. All selected runs still use finite operation/suite bounds.
Linux/macOS perform the full staged control suite; platform artifacts include
the logs as well as reports. Checks here do not complete live HTTPS/IIS acceptance.

No minimum hardware capacity or historical timeout root cause is established by
the supplied index alone. Compare the retained phases and concurrency before
changing the policy for a consumer. A full staged run has no intentional skips;
unstaged source runs explicitly skip package-only checks.
