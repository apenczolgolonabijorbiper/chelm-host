# Delegation

Chelm-host 0.1.0 implements contract version 1. The following requirements are
from design draft 0.2. See [implementation and verification status](ACCEPTANCE.md)
for measured checks, platform checks awaiting CI, and deviations.

## 9. Distribution and integration

### 9.1 Dispatcher

- `DST-1` Default policy: local. All pending sources are available to `next` on the runtime. Delegation is opt-in per runtime (`delegation.enabled`) and per offer.
- `DST-2` A reservation `{package_id, observation_ids, created_at, expires_at}` excludes its sources from `next` until the package is adopted, cancelled or expired. Expiry returns the sources to the local pool. Reservations live in host state, not in the instance.
- `DST-3` The processed ledger and the compare-and-swap commit remain the only guard against double processing: a result whose sources already have ledger rows is refused (`already_processed`).

### 9.2 Share mailbox principles

- `DST-10` The shared folder holds only write-once files. No live Git repository and no file that two machines modify is placed on it.
- `DST-11` Every package file is written to a temporary name in the package folder and renamed when complete. A package is complete only when its `manifest.json` (or `result.json`) exists; readers ignore folders without it.
- `DST-12` Taking a package uses exclusive file creation of `taken.json` (`{taken_by, host, taken_at}`); creation failure means someone else took it.
- `DST-13` Chelm-host never deletes another participant's files. After adoption it moves its own package folder to the runtime archive (copy then delete its own files), or leaves it when the share does not allow deletion, and records that.

### 9.3 Package formats

- `DST-20` Offer, written to `<share_root>/delegations/<package_id>/`: `instance.bundle` (a Git bundle of the committed HEAD, the base `H`), `inbox/<id>.md` and `evidence/<id>.json` for the reserved sources (byte-exact), and `manifest.json`: `{schema_version: 1, package_id, runtime_id, base_head, observations: [{id, sha256, kind, recorded_at}], harness_version, harness_release_sha256, chelm_version, offered_by, created_at, expires_at, note, files: {<path>: sha256}}`.
- `DST-21` Taking verifies `files` hashes, the bundle (`git bundle verify`), the source hashes against the notes, and that the local harness release hash equals `harness_release_sha256`; any mismatch refuses with `package_invalid` and writes nothing outside a scratch folder.
- `DST-22` Result, written to the same package folder: `result.bundle` (`git bundle create` of `H..HEAD` of the sandbox instance) and `result.json`: `{schema_version: 1, package_id, base_head, tip, runs: [{run_id, journal, observation_ids, model, executor}], processed: [ids], validator: {valid, warnings}, returned_by, returned_at, files: {<path>: sha256}}`.

### 9.4 Adoption

- `DST-30` Checks before any write: result files hashes; `git bundle verify`; `base_head` is an ancestor of `tip`; every commit between them changes only allowed paths (graph, `memory/index.md`, question queue files, `memory/hypotheses.json`, `memory/runs/*` including guidance snapshots, `memory/events/**`, the ledger, the lease, and `inbox/<id>.md` and `evidence/<id>.json` only for the package's sources, with note bytes equal to the manifest hashes); the ledger after `tip` adds rows only for the package's sources and changes no existing row; profile, vocabulary, configuration, purpose and other host-input files are unchanged, so the remote runs used the same policy as the base (otherwise refuse with `policy_changed`); the local profile, vocabulary and configuration have not changed since `base_head` either (a committed policy change after the offer refuses adoption, as for a local lease); the package is not cancelled or expired; none of its sources has a ledger row in the local HEAD.
- `DST-31` Fast-forward (local HEAD equals `base_head`): fetch the bundle into `refs/chelm/delegations/<package_id>`, validate the tip tree against the base graph with the local harness, update the branch with an expected-old-value ref update from `base_head` to `tip`, update the working tree for the changed paths (raw bytes, no filters), release the reservation, publish.
- `DST-32` Moved head (local HEAD is a descendant of `base_head` with other commits): build a keyed three-way merge of base, local HEAD and tip. Use the harness merge command when the harness reports it (capability `harness-merge`); otherwise use Chelm-host's keyed merge with the same semantics. Per collection:
  - Graph `sources`, `entities` and `claims` merge by `id`, taken from the side that added or changed them. It is a conflict when both sides changed the same record differently, or when one side removed it.
  - Retained claims may differ from the base only in `status` (graph schema 2 rule). Two different status changes are a conflict.
  - Entity `external_ids` and `source_ids` are append-only. Additions from both sides are united, without duplicates, when the rest of the entity is unchanged.
  - The graph's `updated_at` is the later of the two.
  - Ledger rows merge by observation ID; the same ID on both sides is a conflict.
  - Question queue entries merge by `id`.
  - `memory/hypotheses.json` (hypotheses schema 1, keyed) merges records by `id` like graph records. The collection's `updated_at` is the later of the two, never earlier than any record's `updated_at`.
  - Journals, guidance snapshots and events are taken from both sides.
  - `memory/index.md` and `questions/queue.md` are not merged.

  On any conflict, refuse with `merge_conflict` and the list of conflicting records; nothing is written. Merge results that pass the merge but produce `duplicate_external_id` or `multiple_active_values` warnings are not conflicts. The warnings are listed for the integration run (`DST-33`).
- `DST-33` A conflict-free merge is committed through an integration run: Chelm-host claims exactly the package's sources (`claim --ids`), writes the merged files into the workspace, keeps the remote journals as declared outputs, and then either (a) when neither Markdown summary changed on both sides, writes a mechanical integration journal (stating that no model was used, naming the package, the remote runs and their models) and submits; or (b) creates a local work unit of type `integrate` for an executor, whose task is to regenerate `memory/index.md` and `questions/queue.md` consistently with the merged JSON and review possible duplicate entities (warning list from the merge), then submit. Validation against the current HEAD graph is mandatory in both cases.
- `DST-34` Every adoption outcome is recorded in the package record and in the log; refusals keep the reservation until cancelled or expired, so the owner can decide.

### 9.5 Privacy

- `DST-40` A package contains the full committed memory of the runtime (the remote executor needs the graph for retrieval). `delegate offer` MUST state this in its result `messages` the first time per runtime, and `delegation.participants` (OS user names) MUST be non-empty for an offer. File permissions of the share are the application owner's responsibility; Chelm-host documents the required access (participants read and write, nobody else).

---
