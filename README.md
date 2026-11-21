# Chelm-host

Chelm-host is where the Golem lives: a dependency-free local host for
[Golem XIV Harness](https://github.com/apenczolgolonabijorbiper/golem14-harness).
Version **0.1.0** implements app, worker, read-model, runtime and delegation
contracts at version 1, against **harness 0.7.0 exactly**.

It supplies intake, conversation records, committed memory views, transactional
Git processing, worker CLI/MCP, shared-folder delegation, source transfer, request
approval records and runtime administration. It never invokes a language model
or runs a background scheduler. Executors perform the analysis.

## Requirements

Node >=22.12, Python >=3.12, Git. No npm/pip installation. Windows, Linux and macOS
are CI targets. Use the same OS identity for a lease owner across worker calls.

## Install and initialize

Download chelm-host-0.1.0.zip and its adjacent checksum from Releases. Check the
checksum before extraction. Install from the clean extracted chelm-host folder:

```sh
node integration/install.mjs --repo /path/to/application --runtime-hint /private/runtime --register-mcp
node /path/to/application/vendor/chelm-host/bin/chelm.mjs verify --harness /path/to/golem-harness
node /path/to/application/vendor/chelm-host/bin/chelm.mjs init --runtime /private/runtime --harness /path/to/golem-harness
```

On Windows use quoted paths, for example `"C:/Private/Golem runtime"`; the Python
launcher `py` is the default. Use `--python <executable>` at init to override it.
Keep runtimes outside both vendor packages and outside public version control.
Sandbox initialization requires `--sandbox` and a `sandbox` path segment.

## App calls

Complex inputs are JSON objects, passed by file or stdin (`--input -`). Every CLI
call emits one UTF-8 JSON object; successful results have ok:true and messages[].
Refusals exit 1, usage errors 2, internal failures 3.

```sh
node bin/chelm.mjs submit --runtime /private/runtime --input observations.json
node bin/chelm.mjs read summary --runtime /private/runtime
node bin/chelm.mjs ask --runtime /private/runtime --input question.json
node bin/chelm.mjs worker next --runtime /private/runtime --input executor.json
```

observations.json:

```json
{"subject_id":"REC-123","groups":[{"kind":"record","lines":["Synthetic record is ready."]}]}
```

executor.json:

```json
{"executor":{"id":"my-session","kind":"agent","model":"actual-model-name","host":"my-host"},"max":20}
```

New notes have a 60-second minimum age. Read views are plain files under
`host/read-model/`; protocol memory comes from committed HEAD, so analysis drafts
never appear there. Each view records its HEAD and generation time. Warnings and
capacity have a separate metrics timestamp and refresh after commits or refresh.
Call refresh explicitly after out-of-band instance changes.

## Workers and delegation

Read [AGENTS.md](AGENTS.md) and [worker contract](docs/CONTRACT_WORKER.md).
MCP stdio: `node bin/chelm-mcp.mjs --runtime /private/runtime`.

Delegation is opt-in in chelm.runtime.json: set delegation.enabled, share_root and
participants (allowed OS user names). Restrict share ACLs to those participants:
every offer contains the runtime's full committed memory. Offer up to 20 ready
observations, take on the executor's machine, process in the returned sandbox,
return, then adopt on the original runtime. Packages are immutable files and local
Git bundles, never live shared repositories. A moved head is merged by record ID;
conflicting summaries need an explicit local integrate work unit.

## Administration

Use adopt for an existing canonical instance; older layouts/graph schemas must be
archived and initialized fresh. reset --scope instance archives state and preserves
valid guidance. Held leases block administrative changes. Upgrade with installer
--upgrade after pausing executors, then verify. No runtime migration is needed for
this first release. Later harness versions are refused until explicitly tested.

See [app contract](docs/CONTRACT_APP.md), [runtime layout](docs/RUNTIME.md),
[read views](docs/READ_MODEL.md), [delegation](docs/DELEGATION.md),
[harness integration](docs/HARNESS_INTEGRATION.md), [design](docs/CHELM_HOST_DESIGN.md),
[acceptance status](docs/ACCEPTANCE.md) and [release notes](docs/RELEASE_NOTES.md).

## Develop and build

```sh
# Point this variable to a clean, extracted harness 0.7.0 release.
export CHELM_HARNESS_ROOT=/path/to/golem-harness
node --test tests/
python3 tools/build-release.py --harness /path/to/golem-harness
```

The builder runs all Chelm tests and applicable harness backend conformance before
creating dist/chelm-host-0.1.0.zip and its .sha256. Releases have one chelm-host/
folder and an exhaustive RELEASE.json. GitHub Actions performs the same checks
on Windows, Linux and macOS; a v* tag publishes the validated ZIP and checksum.

Apache-2.0; see [NOTICE](NOTICE) for the backend's harness ancestry.
