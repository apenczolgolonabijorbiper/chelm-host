# Vendor test scheduling and bounds

Use `npm test` from source or `node vendor/chelm-host/tools/run-tests.mjs` after
installation. Set CHELM_HARNESS_ROOT and CHELM_PROVIDER_HARNESS_ROOT to the exact
published 0.13.0 package. Relative environment paths are resolved once on entry.
Use a disposable temporary runtime; never point fixtures at consumer state.

The shared runner defaults to two test files at a time on Windows and four on
Linux/macOS. Individual files retain their normal test coverage. Windows is a
bounded resource policy informed by retained serial/parallel evidence; it is
not a diagnosis of ECONNRESET or proof that historical deadlocks were absent.
`--concurrency 4` selects the comparison explicitly. Retain every attempt,
including failures; do not wrap mutation tests in a success-only retry loop.

| Layer | Finite budget | Cleanup margin |
| --- | --- | --- |
| CLI operation in test/probe | 60 seconds, matching existing host subprocess bound | 5 seconds |
| Complete service probe | 150 seconds across all commands | Each child uses the smaller remaining/60-second bound |
| Outer packaged probe / individual scenario | 180 seconds | Supervised subprocess exits before fixture deletion |
| Aggregate test file | 600 seconds | Individual scenarios retain their separate 180-second timer |
| Whole test attempt | 600 seconds by default, 750 seconds for the supported staged Windows release suite | 5 seconds for owned-tree cleanup |

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

Routine release CI builds and runs the full staged suite on Ubuntu (Node 22.12
and 24) and macOS (Node 22.12). Both Windows jobs verify the Ubuntu Node 24
ZIP and manifest, install dependencies, verify the CLI and exercise an MCP
round trip. Node 24 also covers Windows paths, file sharing, process ownership
and cleanup, response-loss recovery, and full IIS/IIS Express. Publication
requires both Windows jobs.

The Windows reliability comparison workflow builds one tested ZIP on Ubuntu
Node 24, then starts four Windows Node 24 jobs as soon as that ZIP is available.
Each job verifies the checksum/inventory/hashes and tests a disjoint file subset
selected by `--shard INDEX/4` from the sorted complete file list (round robin).
Each subset has three required concurrency-2 attempts, within 600 seconds each,
plus retained concurrency-4/1 diagnostics and a required individual run of each
assigned file. Shard 1 also requires ten standalone MCP attempts, bounded at
180 seconds each, and runs the Windows capacity/provider measurements.

The final coverage job requires all four summaries, the same package/manifest
identity, the complete disjoint test inventory, every supported attempt passing
without skips, every file passing individually and all ten standalone MCP passes.
No failed required attempt can be hidden by a later pass. Comparisons are within
a subset; they are not a new unsharded full-suite concurrency comparison. Routine
release CI still covers Node 22.12 as described above. Use this supplemental
workflow for process supervision, remote transport, benchmark or scheduling
changes, or dispatch it manually. Its configuration is not observed acceptance.

For equivalent local subset runs, invoke `node tools/run-tests.mjs --shard 1/4
--repeat 3 --concurrency 2`, then repeat for 2/4, 3/4 and 4/4 using separate report
directories or labels. Reports include the complete and selected file inventories.
`--file` and `--shard` cannot be combined.

For comparison, master cd14af4's successful Windows Node 22 suite took 277 seconds
at concurrency 4, with 999 seconds of summed per-test elapsed time. Those are
historical CI measurements, not a prediction of serial time or reference-machine
capacity. Superseded/cancelled administrative runs do not count as acceptance.

The initial concurrency-1 attempt on Windows Node 24 reached only 78 tests before
the 600-second suite limit; Node 22 also exposed that CLI --test-timeout=180000
caps an entire multi-case file. Run 45462787753 retains these failed attempts.
They are not discarded or counted as passes. Windows therefore uses two files,
with per-scenario bounds in tests/scenario.mjs and a separate aggregate file bound.

No minimum hardware capacity or historical timeout root cause is established by
the supplied index alone. Compare the retained phases and concurrency before
changing the policy for a consumer. A full staged run has no intentional skips;
unstaged source runs explicitly skip package-only checks.

## Expanded-suite timeout correction — 2026-11-28

The latest failed comparison [run 45960060522](https://github.com/apenczolgolonabijorbiper/chelm-host/actions/runs/45960060522)
and its master control [45959438457](https://github.com/apenczolgolonabijorbiper/chelm-host/actions/runs/45959438457)
ran three unsharded supported attempts per Node version. All hit the 750-second
aggregate bound, with no failed assertions emitted before termination. On the
latest run Node 24 emitted 146 passing cases per attempt and Node 22 emitted
117; buffered TAP after termination is not a complete suite count. In the first
attempt their summed reported case durations were about 1361 and 1434 seconds
respectively, while only two files could run at once. Completed case maxima were
about 41 and 47 seconds. The logs establish aggregate exhaustion with healthy
progress; they do not establish a particular machine bottleneck or rule out an
unreported hang. Some timeout cleanups additionally reported tree_cleanup_failed;
those remain failures, not an MCP reset diagnosis.

The earlier 152-case Windows acceptance remains historical. The expanded suite
now uses the four bounded subsets above; no command, scenario, file or attempt
limit is increased. A new Windows workflow run must pass before claiming observed
acceptance for this scheduling change. The direct Windows release-builder path
retains its older unsharded three-attempt/750-second policy; the supplemental
workflow consumes the Ubuntu-built ZIP and does not invoke that Windows path.

## Observed final-policy measurements

Run 45468016957 exercised the cumulative PR #56 tree on Windows Server 2022
build 20348, published Harness 0.13.0. All attempts below passed 136/136 with
zero skips; values include the shared runner's supervision/reporting overhead.

| Node | Supported concurrency-2 attempts (seconds) | Concurrency-4 comparison (seconds) |
| --- | --- | --- |
| 22.12.0 | 580.279 / 562.670 / 565.012 | 422.254 |
| 24.22.3 | 572.701 / 559.223 / 557.056 | 408.605 |

Concurrency 4 was faster on these runners and passed; concurrency 2 remains the
current conservative supported policy. This is not evidence that higher
concurrency caused the historical failures. The final source was not rerun at
concurrency 1; its failed predecessor measurement remains retained. Supported
Windows attempts have only 20–43 seconds of headroom within 600 seconds, so
these observations do not establish minimum consumer hardware capacity.

Ten standalone Node 24 MCP attempts took 14.689–14.870 seconds each. Linux
Node 22/24 full attempts took 59.715/74.196 seconds; macOS Node 22 took 166.836
seconds. All five adapter suites passed 11/11. The full repeated Windows build
sequence took 2209.328/2321.984 seconds on Node 22/24: the historical aggregate
`tst9_under_10_minutes` field is false for that sequence, while each individual
attempt remained within its 600-second bound. Capacity latency targets are
separate and are not certified by these correctness results.

See [CI summary](evidence/reliability-2026-11-24/ci-summary.json) for the exact
tested tree, platform/report hashes, all attempts and retained failed controls.

The expanded 152-test suite hit the 600-second outer bound twice on Windows
Node 22 in [run 45620958269](https://github.com/apenczolgolonabijorbiper/chelm-host/actions/runs/45620958269/job/139228634025).
The third attempt passed 152/152 in 599.360 seconds of Node test-runner time.
The full staged Windows reliability suite has a 750-second outer bound
for each of its three required attempts. The file (600 seconds), scenario
(180 seconds), standalone MCP (180 seconds) and command (60 seconds) bounds
still apply. Diagnostic comparisons use the default 600-second outer bound.

## Observed final integration comparison — 2026-11-26 review

Run [45646296935](https://github.com/apenczolgolonabijorbiper/chelm-host/actions/runs/45646296935)
on final PR #58 head `26023b3` observed the extended policy on Windows Node
22.12.0 and 24.22.3: three complete 152/152 attempts each, concurrency-4
comparisons, and all 26 files individually (152 total cases each) passed.
Node 24 passed ten standalone MCP attempts. Both concurrency-1 diagnostics
exceeded the unchanged 600-second bound; they remain failed attempts. No final
TAP summary was produced, so their aggregate zero counts are incomplete counts.
See [exact timings and package boundaries](WINDOWS_RELIABILITY.md) and
[retained report/log hashes](evidence/reliability-2026-11-24/published-1.3.1.json).
This supersedes the earlier missing final-tree comparison evidence, without
diagnosing the owner's original timeout/reset failures or changing any budget.

## Optional complete serial comparison

Run the Windows reliability comparison workflow to supplement ordinary
release validation.
`python tools/qualify-windows-reliability.py --package DIST_ZIP --harness HARNESS
--output REPORTS` verifies the ZIP checksum/inventory/hashes, extracts one clean
package and retains concurrency 4/1 plus every individual test file. Serial suite
timeout remains a diagnostic, within the unchanged 600-second attempt bound.
Every individual-file invocation must pass. The owner's four historical file
names are unavailable; this covers all files without asserting their identity.
Its 120-minute job orchestration limit covers the extra sequence; operation and
suite deadlines are unchanged. Configuring this workflow is not observed evidence.
