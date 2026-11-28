# Issue #3: reference-machine measurements

Use `tools/reference-acceptance.mjs` to retain an evidence directory for
[issue #3](https://github.com/apenczolgolonabijorbiper/chelm-host/issues/3).
The tool exercises disposable synthetic runtimes. It accepts no production runtime
path and refuses an existing output directory or one inside either package.
Run sequentially on the machine being measured; avoid other benchmarks during the
run. Describe actual background work in `--load-note`, including antivirus scans,
other builds and storage conditions where known. The label/load note are operator
statements, not automatically verified hardware provenance.

## Reference Windows workstation

Use the verified Chelm candidate/release, its locked dependencies, Node >=22.12,
Python >=3.12 and Git. Keep both packages outside the web root. Use the published
reference Harness 0.13.0 for this deterministic build measurement; this is a
benchmark fixture selection, not a restriction of deployment compatibility.
Other approved Harness versions remain supported by their qualified features.

```powershell
$Pkg = 'C:/GolemAcceptance/chelm-host'
$Harness = 'C:/GolemAcceptance/golem-harness'
python "$Pkg/tools/prepare-harness.py" --version 0.13.0 --destination $Harness
node "$Pkg/integration/install-dependencies.mjs"
# Select the same Python executable for all phases, including the benchmarks.
$env:GOLEM_PYTHON = (Get-Command python).Source
node "$Pkg/tools/reference-acceptance.mjs" performance --harness $Harness --output C:/GolemEvidence/reference-001 --context reference-workstation --machine-label 'Windows 11 reference workstation' --load-note 'Idle before run; describe actual background load here' --samples 5 --suite-repeat 1
```

The runner verifies package/harness bytes and records their identities. Git source
runs record HEAD and a digest of source inputs, then use the existing clean staged
release builder. Raw `latency.json` retains Node startup, submit of ten groups,
ask including retrieval, status and indexer/validator exclusions. Raw
`capacity.json` retains actual Harness limits, 10,000 subjects / 100,000 turns,
regeneration, deep refresh, validator/statistics separately and exact/over 64 MiB
committed-tree checks. Targets use every sample, not only the median.

Each `build-N` directory contains the staged builder's reports and archive. Its
`test-timing-*.json` measures setup, complete host tests and adapter conformance
before the post-suite benchmarks. On Windows the builder currently runs three
supported suite attempts plus diagnostics/standalone MCP checks according to
TEST_POLICY.md. The aggregate duration is retained against the ten-minute TST-9
comparison, even when individual attempts pass. `--suite-repeat` (1–3) repeats
that entire build; each repetition has its own directory. `--samples` (1–20)
controls latency/capacity samples; use at least three for reference evidence.
These bounds do not increase any per-command, scenario, file or suite deadline.

A target miss is recorded as `unmet`, with all samples retained; a complete
measurement can exit zero while missing a latency target. A failed phase,
missing report or incomplete samples exits nonzero. Later phases still run and
all failures remain visible. A new run needs a new output directory. Do not turn
a later successful attempt into a replacement for an earlier failure.

On Linux/macOS or during development, use `--context local`; in hosted CI use
`--context hosted-runner`. Reference/target contexts require Windows and refuse
detected CI. A Windows platform or operator-selected context alone does not
prove this is the owner's reference machine.

## Actual consuming Windows service identity

The generic temporary IIS pool test (`Test-IisIdentity.ps1`) remains useful, but
it does not use the consuming app's existing account. Have the actual consuming
service launch the following command through its existing administrator-controlled
execution mechanism, with fixed paths and arguments. Do not add a public endpoint
or accept caller-supplied commands. The service needs read/execute access to both
packages, modify access to its temporary directory and a fresh evidence parent.
No pool settings, production ACLs or runtime files are changed by this collector.

```powershell
node C:/GolemAcceptance/chelm-host/tools/reference-acceptance.mjs service --harness C:/GolemAcceptance/golem-harness --output C:/GolemEvidence/service-001 --context target-server --machine-label 'Windows Server 2022 Standard consumer server' --load-note 'Describe actual server load' --expected-identity 'IIS APPPOOL\YourActualPool' --launch-context 'Started by the consuming application worker; pool YourActualPool; LoadUserProfile=false'
```

Replace the account with the actual consuming account, or its SID. The tool
resolves the account and SID through Windows `whoami`, compares them with the
expected value, and refuses a mismatch before creating its synthetic runtime.
The existing service probe exercises Python/Git children, initialization,
verification, intake, indexing, owned validation/publication, committed reads,
conversation and read-only cognitive work. Its result and package hashes are
retained. This measures config-2/file-worker operation; config-3 verification
remains the separate provider IIS check documented in IIS_VERIFICATION.md.

Retain the service's execution record/configuration showing which application
launched the command, app-pool identity and LoadUserProfile. `--launch-context`
is an operator statement: a matching account alone does not prove invocation
by that service. Running this from an administrator console will refuse the
pool identity comparison. The report does not certify HTTPS/ARR, a second
machine, live inference or the consuming application's HTTP/export acceptance.

## Return and review

Return both complete evidence directories: `report.json`, `SHA256.json`, all raw
JSON/TAP/stdout/stderr logs and `build-N` reports. The optional build archives can
be transferred separately with their existing hashes. SHA256.json inventories
all files except itself; keep the original directory intact to verify it.
Reports contain machine/account labels and tool/file paths; review those before
posting publicly. They contain synthetic observations, not production inputs.

Review `complete`, every phase exit, `performance.checks`, `unmet_targets`, machine
and package identities, and the service launch record. `complete` means requested
measurements finished, not that all performance targets passed or issue #3 may be
closed. If RM-6 remains above 3 seconds, preserve the miss and make an explicit
acceptance/performance decision. No reference-machine or actual-service result is
claimed until these commands run there and their evidence is reviewed.
