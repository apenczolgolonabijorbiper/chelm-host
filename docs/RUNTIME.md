# Runtime

Chelm-host 0.1.0 implements contract version 1. The following requirements are
from design draft 0.2. See [implementation and verification status](ACCEPTANCE.md)
for measured checks, platform checks awaiting CI, and deviations.

### 4.3 Runtime layout

- `RT-1` A runtime root is a directory chosen by the application, outside both vendor packages and outside public version control. Layout:

```text
<runtime>/
  chelm.runtime.json            configuration (RT-3)
  instance/                     harness instance, own Git repository (path configurable, RT-4)
  host/
    intake/registry.json        subject -> groups (APP-10)
    conversation/turns.jsonl    conversation (APP-20)
    requests/requests.json      follow-up requests (APP-50)
    delegation/                 reservations.json, outgoing and incoming package records
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
  "schema_version": 1,
  "runtime_id": "4b0f1f2e-6a52-4f7e-9d0e-1d2f3a4b5c6d",
  "label": "real",
  "sandbox": {"resettable": false},
  "harness": {"root": "../../vendor/golem-harness", "node": "node", "python": "py", "git": "git"},
  "instance": {"path": "instance", "git_identity": {"name": "chelm-host", "email": "chelm-host@local"}},
  "intake": {"subject_header": "subject_id", "max_observation_chars": 3500, "max_message_chars": 4000, "question_source": "chelm-conversation", "oversize": "truncate", "kind_sets": {}},
  "conversation": {"tail": 200},
  "requests": {"kinds": [], "max_open_proposed_per_subject": 20, "reason_max_chars": 300},
  "delegation": {"enabled": false, "share_root": null, "reservation_hours": 8, "participants": []},
  "archive": {"root": "archive"}
}
```

- `RT-4` `instance.path` MAY point outside the runtime root (adoption of an existing instance in place).
- `RT-5` `harness.python`, `harness.node` and `harness.git` are executables invoked as configured (a launcher such as `py` on Windows is allowed). Chelm-host adds no interpreter flags of its own.

### 4.4 Instantiation by the application

- `RT-10` `chelm init --runtime <dir> --harness <dir> [--label <text>] [--instance-path <rel>] [--sandbox] [--purpose <file>] [--profile <dir>]` creates the runtime directory (refuses a non-empty one) and writes the configuration. It initializes the instance with the harness initializer in the canonical layout (`init-instance.py --root <instance>`, adding `--profile` when `--profile` is given). With `--purpose`, the file's text replaces `instance/purpose.md`. With `--profile <dir>`, the directory's `default.md`, optional section files and optional `vocabulary.json` (vocabulary version 2) replace the initializer's stub under `profiles/`, and `golem.config.json` selects them (configuration wrapper version 1, `docs/APPLICATION_PROFILES.md`). It then runs `memory-tool validate`, `git init -q`, `git add -A` and `git -c user.name=<cfg> -c user.email=<cfg> commit -q -m "init: fresh instance"`, so the purpose, configuration and profile files are committed before the first claim, as the harness requires. Finally it creates the host directories, verifies, and publishes the read model.
- `RT-11` `chelm adopt --runtime <dir> --harness <dir> --instance <existing instance> [--subject-header <key>] [--conversation <jsonl>] [--intake-stores <dir or file list>] [--requests <json>]` attaches an existing instance in place, without modifying it. Steps:
  1. Validate the instance (`memory-tool validate`). It MUST be a canonical instance of a supported harness version (graph schema 2, hypotheses schema 1, `instance/purpose.md`). Otherwise `adopt` refuses with `instance_incompatible` and the first validator line. Older instances are not converted (harness 0.7.0 rule). The application archives them and starts with `init`, and MAY bring the observations over with `import-sources` (inbox and evidence only; they are pending again).
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
- `PKG-14` Harness-release compatibility is decided per harness release, not assumed from semantic versioning: the harness changed instance formats in minor releases (0.6.0 layout, 0.7.0 graph schema 2 without migration). For each supported harness version, the Chelm-host release notes MUST state whether existing runtimes keep working, need `chelm migrate`, or need a fresh instance (archive, `init`, `import-sources`).

---
