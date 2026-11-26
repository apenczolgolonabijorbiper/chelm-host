# Harness compatibility qualification

`harness-compatibility.json` is the production approval catalog. An entry approves
specific release bytes and specific features. A matching version string alone
grants no support. `compatibility.json` and `provider-compatibility.json` retain
the published **0.13.0 reference** for deterministic release builds; the provider
file describes that reference, rather than restricting all runtime selections.

## Contract and feature boundaries

| Feature | Host surface | Required Harness contracts | Qualification |
| --- | --- | --- | --- |
| File worker | Config 2, worker 2, application/read-model 1 | Graph 2, hypotheses 1, adapter 1; candidate validation, purpose guidance 2, profile installation and core policies 2 | Application/worker CLI tests, actual lease/validate/submit, public adapter conformance, populated reopen/upgrade |
| Cognitive tasks and learning | Task 1, local/remote cognitive worker | Task/context/result 1, learning hypotheses 1, unknown-confidence support | Complete cognition conformance including authorized learning publication |
| Memory provider | Config 3, memory worker 3 | Provider 1, logical storage 2, host API 2; record reads, paged evidence, semantic changes, candidate isolation, portable export | Provider CLI/MCP/HTTP cycles, snapshot retention, validation/submit/recovery and audit |
| Checkpoints | Checkpoint 1, durable session 1 | Exact host version/code hash and Harness manifest hash | Separate identity checks; no cross-package restore approval |

`verify --runtime RUNTIME` (or `verify --harness PACKAGE`) reports the selected
version, origin, archive/manifest digests, required and detected contracts and
capabilities, and each feature's status. Integrity is checked before importing
package modules and on every subsequent guarded call. Discovery uses a disposable
instance, never application data. Missing contracts/capabilities yield
`unsupported`; production operations refuse unapproved features. The archive is
checked during preparation; runtime verification checks the trusted manifest and
every extracted file, including missing, additional and linked files.

## Test and promote

The separate Ubuntu workflow runs on contract-sensitive PRs, manual dispatch and
daily at 06:27 UTC. It selects the reference, every approved release, two available
unapproved older neighbors and the latest unapproved newer stable release.
Manual dispatch also accepts a specific published prerelease or a Harness Actions
artifact ID plus candidate version and expected inner-ZIP SHA-256. Artifact jobs
require read access to upstream Actions. Candidate failures retain failed steps,
reports, logs and summaries; approved-feature regressions fail the workflow.
Windows release validation still consumes the Linux-built host ZIP immediately
after its package job, with the focused #60 policy unchanged.

Run locally from a source checkout:

```sh
python tools/qualify-harness.py --version 0.14.0 --output dist/qualification
# A prerelease/build artifact can be tested without production approval:
python tools/qualify-harness.py --version 0.15.0-rc.1 --archive /tmp/candidate.zip --sha256 EXPECTED_SHA256 --output dist/qualification
```

The runner verifies archive/inventory/file hashes and stages a disposable host
copy. Only that copy temporarily permits the candidate's detected feature set;
the installed host and source catalog remain unchanged. All feature tests and
reference-to-candidate upgrade tests use disposable data. Reports record package
origin and digests, required/detected contracts, per-feature pass/fail/unsupported,
exact test commands/counts and retained logs. Unsupported features are explicit;
they are never reported as passing unexecuted tests. These are deterministic
software conformance results, not a new LLM semantic acceptance claim.

For promotion, review the full report/logs, copy them into
`docs/evidence/harness-compatibility/`, then run:

```sh
python tools/promote-harness.py --evidence docs/evidence/harness-compatibility/VERSION.json
```

Promotion independently verifies the official published asset again, requires
matching archive/manifest digests, current requirements and passing checks with
no skipped tests, and updates the catalog and version declarations. An unpublished
build can supply early evidence but cannot become an approved official release.
Review and commit the result through a PR; scheduled/manual qualification never
promotes automatically. Rerun qualification whenever requirements change.

## Existing runtimes and package upgrades

```sh
python tools/prepare-harness.py --version APPROVED_VERSION --destination /vendor/new-harness
node bin/chelm.mjs harness upgrade --runtime /private/runtime --harness /vendor/new-harness
node bin/chelm.mjs harness upgrade --runtime /private/runtime --harness /vendor/new-harness --apply
```

Pause executors, drain leases and assignments, settle recovery and commit or
preserve drafts first. The explicit upgrade checks both packages, validates the
existing instance with the target, records an audit entry and changes the selected
path without rewriting knowledge or provider selection. The empty untracked
`.golem-indexer.lock` introduced in Harness 0.13.1 is operational state: it is
kept in place, excluded from draft checks and never copied into checkpoints.
Tracked, linked or nonempty lock files are refused; other draft files still block. Config-3 selection itself
remains the separate `memory upgrade` operation. Active local leases and remote
file, cognitive and semantic-provider assignments retain exact package identities;
changing the configured path cannot make old work portable across identities.

Checkpoints restore only with their original exact host code and Harness identity.
After upgrading a runtime, create a new checkpoint and explicitly bind any durable
coordinator to its exact new package identities. The compatibility matrix does
not authorize changing a live coordinator's expected identities or reinterpreting
old provider snapshots under active work.

## Tested release matrix

The machine-readable catalog and linked retained reports are authoritative.
Only explicitly listed versions are supported. No semver interval is inferred
from the endpoint versions; releases in gaps remain unapproved until qualified.

| Harness | File worker | Cognition / learning | Memory provider | Passed cases | Evidence |
| --- | --- | --- | --- | --- | --- |
| 0.11.0 | pass | unsupported | unsupported | 29 | [report](evidence/harness-compatibility/0.11.0.json) |
| 0.12.0 | pass | pass | unsupported | 41 | [report](evidence/harness-compatibility/0.12.0.json) |
| 0.13.0 | pass | pass | pass | 75 | [report](evidence/harness-compatibility/0.13.0.json) |
| 0.13.1 | pass | pass | pass | 76 | [report](evidence/harness-compatibility/0.13.1.json) |
| 0.13.2 | pass | pass | pass | 76 | [report](evidence/harness-compatibility/0.13.2.json) |
| 0.13.3 | pass | pass | pass | 76 | [report](evidence/harness-compatibility/0.13.3.json) |
| 0.14.0 | pass | pass | pass | 76 | [report](evidence/harness-compatibility/0.14.0.json) |

All advertised rows passed without failed, cancelled or skipped cases. The tested
feature floors are 0.11.0 for file workers, 0.12.0 for cognition/learning and
0.13.0 for providers. These are the observed floors among the tested releases,
not a claim that all earlier versions are incompatible. The reference remains
0.13.0. See the evidence directory README for retained failures and corrections.
