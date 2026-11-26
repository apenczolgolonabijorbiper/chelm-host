# Retained Harness qualification evidence

Top-level VERSION.json files are the completed per-feature qualification reports
used for approvals. Their adjacent logs preserve every case/count. Each report
identifies the exact Harness ZIP and manifest digests, required/detected contracts,
staged host manifest identity, test commands and per-feature verdicts. Temporary
paths in commands are recreated by `tools/qualify-harness.py`.

`official-assets.json` retains asset identities and SHA-256 digests retrieved
through the GitHub release API. Locally cached ZIPs used after a runner interruption
were compared against these official digests before approval. A candidate report
can therefore say `local-build-artifact` for transport origin even when the tested
bytes exactly match the official published asset. Production catalog entries
record the official release origin.

Two unsuccessful implementation stages are retained separately:

- `pre-lock-fix/`: 0.13.1, 0.13.2, 0.13.3 and 0.14.0 passed file/cognition checks
  but provider selection rejected the indexer's new empty permanent lock as a
  draft. The host now recognizes only that empty, untracked, regular operational
  file. It never unlinks the live inode or suppresses other drafts.
- `pre-checkpoint-schema-fix/`: deeper upgrade tests on 0.13.1 and 0.13.2 exposed
  the old checkpoint envelope's literal version constraint. The corrected schema
  allows a version string while restore still verifies exact approved manifest,
  host code and selected package identity.

Failures remain failures in these historical reports. Corrected runs have their
own full checks and verdicts; the runner has no successful-retry filter. These
are local Linux deterministic conformance results. Hosted CI and independent LLM
semantic acceptance are separate evidence.
