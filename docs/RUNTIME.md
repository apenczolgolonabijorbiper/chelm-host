For remote service configuration and cutover from schema 1 see [REMOTE_WORKERS.md](REMOTE_WORKERS.md).

# Runtime

Chelm-host 1.0.0 uses runtime configuration schema 2. Remote workers use contract v2. The following requirements are
from design draft 0.2. See [implementation and verification status](ACCEPTANCE.md)
for measured checks, platform checks awaiting CI, and deviations.

### 4.3 Runtime layout

- `RT-1` A runtime root is a directory chosen by the application, outside both vendor packages and outside public version control. Layout:

```text
<runtime>/
  chelm.runtime.json            configuration (RT-3)
  instance/                     harness instance, own Git repository (path configurable, RT-4)
  host/
    workers.json                 OS/executor ownership, source and output restore inventory
    adoption-pending.json        optional CAS recovery record; absent after reconciliation
    intake/registry.json        subject -> groups (APP-10)
    conversation/turns.jsonl    conversation (APP-20)
    requests/requests.json      follow-up requests (APP-50)
    remote/work/                durable assignments, snapshots, staging and receipts
    read-model/                 published views (section 10)
    state/verify.json           cached verify result (BND-1)
    locks/operation.lock        cross-process operation lock (NFR-6)
    logs/chelm.jsonl            operation log (NFR-12)
  archive/                      reset and replace archives (path configurable)
```

- `RT-2` Host state is outside the instance repository. Chelm-host MUST NOT add files to instance commits other than those the harness protocol and the storage backend define.
- `RT-3` `chelm.runtime.json` (schema `schemas/runtime-config.schema.json`, `schema_version: 1`; unknown keys and versions are refused; paths are relative to the runtime root unless absolute; no secrets):

```json
{
  "schema_version": 2,
  "runtime_id": "4b0f1f2e-6a52-4f7e-9d0e-1d2f3a4b5c6d",
  "label": "real",
  "sandbox": {"resettable": false},
  "harness": {"root": "../../vendor/golem-harness", "node": "node", "python": "py", "git": "git"},
  "instance": {"path": "instance", "git_identity": {"name": "chelm-host", "email": "chelm-host@local"}},
  "intake": {"subject_header": "subject_id", "max_observation_chars": 3500, "max_message_chars": 4000, "question_source": "chelm-conversation", "oversize": "truncate", "kind_sets": {}},
  "conversation": {"tail": 200},
  "requests": {"kinds": [], "max_open_proposed_per_subject": 20, "reason_max_chars": 300},
  "remote": {"max_active_work": 1, "assignment_minutes": 30, "max_lifetime_minutes": 480},
  "archive": {"root": "archive"}
}
```

- `RT-4` `instance.path` MAY point outside the runtime root (adoption of an existing instance in place).
- `RT-5` `harness.python`, `harness.node` and `harness.git` are executables invoked as configured (a launcher such as `py` on Windows is allowed). Chelm-host adds no interpreter flags of its own.

### 4.4 Instantiation by the application

- `RT-10` `chelm init --runtime <dir> --harness <dir> [--label <text>] [--instance-path <rel>] [--sandbox] [--purpose <file>] [--profile <dir>]` creates the runtime directory (refuses a non-empty one) and writes the configuration. It initializes the instance with the harness initializer in the canonical layout (`init-instance.py --root <instance>`, adding `--profile` when `--profile` is given). With `--purpose`, the file's text replaces `instance/purpose.md`. With `--profile <dir>`, the directory's `default.md`, optional section files and optional `vocabulary.json` (vocabulary version 2) replace the initializer's stub under `profiles/`, and `golem.config.json` selects them (configuration wrapper version 1, `docs/APPLICATION_PROFILES.md`). It then runs `memory-tool validate`, `git init -q`, `git add -A` and `git -c user.name=<cfg> -c user.email=<cfg> commit -q -m "init: fresh instance"`, so the purpose, configuration and profile files are committed before the first claim, as the harness requires. Finally it creates the host directories, verifies, and publishes the read model.
- `RT-11` `chelm adopt --runtime <dir> --harness <dir> --instance <existing instance> [--subject-header <key>] [--conversation <jsonl>] [--intake-stores <dir or file list>] [--requests <json>]` attaches an existing instance in place, without modifying it. Steps:
  1. Validate the instance (`memory-tool validate`). It MUST be a canonical instance of a supported harness version (graph schema 2, hypotheses schema 1, `instance/purpose.md`). Otherwise `adopt` refuses with `instance_incompatible` and the first validator line. Older instances are not converted (harness 0.9.1 rule). The application archives them and starts with `init`, and MAY bring the observations over with `import-sources` (inbox and evidence only; they are pending again).
  2. Require a clean protocol state: `recovery_required` false and no held lease.
  3. Import the existing conversation log, per-subject observation stores and request records into host state (formats in Appendix A.9 to A.11).
  4. Recompute missing content keys from the notes (`APP-12`). Registry groups whose notes are not in the instance, for example because the instance was re-created after the store was written, are imported as `orphaned`. They never match a new submission, so the content is sent again, and they are counted in the result (`orphaned_groups`).
  5. Publish the read model.

  The original files are left in place for the application to archive.
- `RT-12` `--sandbox` marks a runtime resettable: `chelm reset --hard` then deletes and recreates it. A non-sandbox runtime MUST refuse `--hard`. A sandbox runtime root MUST contain the configured guard segment (default `sandbox`) in its absolute path, otherwise `init --sandbox` is refused. This replaces the consumer's current demo path guard.
- `RT-13` The application chooses its own configuration keys for the package path and the runtime roots (for example `chelm.root`, `chelm.runtime`, `chelm.sandboxRuntime`), and calls `node <package>/bin/chelm.mjs <command> --runtime <runtime> --input -`.

### 4.5 Upgrades and compatibility

- `PKG-10` Semantic versioning. A minor release may add commands, fields, views and capabilities. A change that removes or changes the meaning of a field, command or file is a major release and increments the affected contract version.
- `PKG-11` Upgrade: pause executors, verify the new release, replace `vendor/chelm-host` entirely (`install.mjs --upgrade`), run `chelm verify`, then `chelm migrate --runtime <dir>` only when the release notes say a runtime migration exists. A migration MUST create an archive copy of the host state first, MUST be explicit (never on read) and MUST NOT modify instance memory.
- `PKG-12` A harness upgrade is supported only when the installed Chelm-host lists the new version in `harness_supported`. `verify` refuses otherwise.
- `PKG-13` `chelm version` (no runtime) prints `{package_version, contracts, harness_supported, capabilities}`. `capabilities` lists optional features (for example `delegation-v1`, `keyed-merge-v1`, `harness-merge`, `profile-guidance-v1`, `core-policies-v2`, `producer-receipts-v1`, `mcp-worker-v1`).
- `PKG-14` Harness-release compatibility is decided per harness release, not assumed from semantic versioning: the harness changed instance formats in minor releases (0.6.0 layout, 0.9.1 graph schema 2 without migration). For each supported harness version, the Chelm-host release notes MUST state whether existing runtimes keep working, need `chelm migrate`, or need a fresh instance (archive, `init`, `import-sources`).

---

## Alignment additions (VF-3, VF-4; runtime config schema 1)

`adopt --input stores.json` accepts an explicit list with a subject for each store:

```json
{"intake_stores":[{"path":"C:/App_Data/record-123/observations.json","subject_id":"REC-123"},{"path":"C:/App_Data/record-456/observations.json","subject_id":"REC-456"}]}
```

Each store contains `entries` or `groups`. Paths from stdin are relative to the
caller's working directory. `--intake-stores mappings.json` also accepts an array
or `{ "stores": [...] }`, resolving mapping paths relative to that JSON file.
The prior single-file/directory form remains available: an embedded subject_id or
a specific semantic filename supplies the subject. Generic names such as
observations.json, store.json or registry.json require an explicit subject; refusal
occurs before runtime creation. Conflicting explicit/embedded subjects refuse.
Several stores for one subject append their groups. Imported source files remain
unchanged. `--requests jobs.json` accepts an array, `{requests:[...]}` or the
consumer's `{jobs:[...]}`. Only Golem-requested jobs become host requests.

`profile install --source <mirror>` installs raw bytes from a directory containing
golem.config.json and every file it selects, at the same relative paths. It
validates through the installed harness and commits only the selected profile
files and configuration. Runtime protocol paths and pre-existing drafts refuse.
`init --profile <mirror>` accepts the same mirrored layout. The older default.md
and optional profile.json directory format remains supported at initialization.

`profile check --source <mirror>` (alias `profile status`) returns matches and
per-file expected/installed SHA-256 values without changing anything. Optional
runtime configuration activates a persistent comparison:

```json
"profile_expectation": {"source":"../application-profile", "enforce":true}
```

The source is relative to the runtime root unless absolute. `status.profile.expected`
reports the comparison. With enforce:true, worker next refuses profile_mismatch
before claiming when expected bytes differ or the source is unreadable. Profile
checks can run during a lease; installing requires an idle runtime.

`host/workers.json` maps run IDs to actual OS actor/host, executor metadata,
claimed_at, sources, declared outputs and pre-existing events. It supports owned
renewal/submission and scoped restoration. Treat it as private host state.
`host/adoption-pending.json` exists only during fast-forward adoption and stores
old/new HEAD plus changed paths and before/after digests. On the next mutation,
reconciliation verifies HEAD and captured bytes before replacing only those paths
and index entries; unrelated edits refuse recovery. Neither file belongs in the
read model, a source export or a shared delegation manifest.
