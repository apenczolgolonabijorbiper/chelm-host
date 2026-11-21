# Chelm-host

Chelm-host is where the Golem lives: a local and remote-worker host for
[Golem XIV Harness](https://github.com/apenczolgolonabijorbiper/golem14-harness).
Version **1.0.0** supports **harness 0.10.0 exactly**. App/read-model contracts
remain v1; worker and runtime configuration contracts are v2.

It supplies intake, conversation records, committed memory views, transactional
Git processing, local worker CLI/MCP, owner-hosted remote MCP workers, source transfer, request
approval records and runtime administration. It never invokes a language model
or runs a background scheduler. Executors perform the analysis.

## Requirements

Node >=22.12, Python >=3.12, Git. Release ZIPs include locked Node dependencies. Source checkouts use `npm ci --ignore-scripts`; no pip installation. Windows, Linux and macOS
are CI targets. Use the same OS identity for a lease owner across worker calls.

## Install and initialize

Download chelm-host-1.0.0.zip and its adjacent checksum from Releases. Check the
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

## Local and remote workers

Local agents use the CLI or stdio MCP server and the [local worker contract](docs/CONTRACT_WORKER.md).
Remote agents connect to Machine A's authenticated Streamable HTTP MCP endpoint,
request work, retrieve content, run their own inference and return candidates.
Chelm validates and publishes on the owner; a shared folder and manual adoption
are not needed. Remote machines need only MCP and inference access.

Start the owner service with `node bin/chelm-serve.mjs --config service.json`.
Follow [remote setup](docs/REMOTE_WORKERS.md) for configuration, IIS reverse proxy,
client credentials, the optional stdio bridge and unattended execution. Use the
[single-cycle SudoLang prompt](prompts/remote-worker-once.sudo.md),
[loop prompt](prompts/remote-worker-loop.sudo.md) and
[integration prompt](prompts/remote-integration.sudo.md).

The old shared-folder delegation operations are removed in 1.0. See the setup
guide's cutover preflight before replacing 0.2 installations. No harness instance
reset is required for canonical supported memory.

## Administration

Use adopt for an existing canonical instance; older layouts/graph schemas must be
archived and initialized fresh. reset --scope instance archives state and preserves
valid guidance. Held leases block administrative changes. Upgrade with installer
--upgrade after pausing executors, then verify. No runtime migration is needed for
this first release. Other harness releases are refused until explicitly tested.

For 0.2 -> 1.0, run the explicit cutover preflight/apply described in the remote
setup guide before runtime verification. Keep canonical memory intact.

See [app contract](docs/CONTRACT_APP.md), [runtime layout](docs/RUNTIME.md),
[read views](docs/READ_MODEL.md), [remote worker contract](docs/REMOTE_WORKER_CONTRACT.md),
[harness integration](docs/HARNESS_INTEGRATION.md), [design](docs/CHELM_HOST_DESIGN.md),
[acceptance status](docs/ACCEPTANCE.md) and [release notes](docs/RELEASE_NOTES.md).

## Develop and build

```sh
# Point this variable to a clean, extracted harness 0.9.1 release.
export CHELM_HARNESS_ROOT=/path/to/golem-harness
node --test tests/
python3 tools/build-release.py --harness /path/to/golem-harness
```

The builder runs all Chelm tests and applicable harness backend conformance before
creating dist/chelm-host-1.0.0.zip and its .sha256. Releases have one chelm-host/
folder and an exhaustive RELEASE.json. GitHub Actions performs the same checks
on Windows, Linux and macOS; a v* tag publishes the validated ZIP and checksum.

Apache-2.0; see [NOTICE](NOTICE) for the backend's harness ancestry.

## Prior consumer alignment (0.2.0 history)

This release switches to harness 0.9.1 and its optimized reference Git backend
and native merge. See [compatibility.json](compatibility.json) and the release
notes before upgrading a runtime. New features include explicit adoption store
subjects, `{jobs:[...]}` imports, exact profile mirrors/checks and optional drift
guards, deferred agent integration and Windows sharing retries.

Install the package alone using `--skip-agent-integration` (or
`--defer-agent-integration`). AGENTS.md, Cursor rules and MCP stay untouched. Rerun
without that flag to activate integration later. `--runtime-hint App_Data/golem`
is repository-relative; MCP receives the resolved absolute runtime path, so it
does not depend on a client working directory.

Performance evidence is generated by `tools/benchmark-host.mjs` and attached to
the release per platform. It measures CLI startup, submit of 10 groups, ask
including retrieval, and plain-file status, explicitly subtracting measured
indexer/validator time where NFR-4 permits. It does not certify capacity targets.

For the default IIS Express development / full IIS Windows Server 2022 deployment
case, see [IIS verification](docs/IIS_VERIFICATION.md). Windows CI exercises an
actual ApplicationPoolIdentity with LoadUserProfile=false and a synthetic
claim/validate/commit cycle; it does not claim to test the consumer's server.
