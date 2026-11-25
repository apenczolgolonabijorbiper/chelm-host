# Independent Work resume, inference and hosted reset

Observed 2026-11-25 in a new user-started ChatGPT Work conversation after PR
#57's retained checkpoint and independent-session handoff were committed at
`02ca017a0f95f6767a5b52ccbe94915ccfe00c1b`. This conversation did not create
the generation-1/revision-1 checkpoint. It used the unchanged `resume.mjs`
from the preceding evidence directory, an exact published Harness 0.13.0,
a fresh nonexistent private runtime path, and authenticated executor HTTPS to
the existing owner-private Site. Shared scratch supplied read-only packages and
instructions; the runtime was downloaded from the selected D1/R2 head.
No GitHub memory repository, permanent agent server or MCP server was used.

## Observations

| Boundary | Retained evidence |
| --- | --- |
| Independent conversation, exact original answer, task receipt, Git snapshot, completed source IDs and both exact citation bytes/hashes | `resume.json`; unchanged preceding `resume.mjs` assertions passed |
| Durable queued follow-up intake; normal age gate returned no-work before readiness | `resume.json`, `claim.json`; source recording time was never rewritten |
| Full protocol/guidance/source reads and exact entity/predicate retrieval; actual active LLM interpretation | `semantic-response.json` and journal text; Python only serialized the LLM-authored decision |
| Host candidate validation, one newly processed source, committed snapshot and persisted-state readback | `validation.json`, `submission.json`, `completion.json` keyed by runtime/run |
| Generation 1 / revision 2 publication, acknowledgment of only the queued follow-up, no pending inputs; earlier task and citations read again | `saved.json` |
| Hosted full reset to generation 2 / revision 0, empty head/session/intake, controlled R2 inventory swept and local runtime deleted | `reset.json` |
| Detached old binding cannot upload, publish, renew, acquire, download old head, recover old receipt or submit late intake | Seven actual HTTPS `generation_changed` refusals in `reset.json` |
| Independent view of persistent D1 state | Native Sites database viewer output in `database-after-reset.json`: objects/receipts/requests empty, retired inventory empty, all five registered copies confirmed removed |

The original checkpoint digest was
`447bf8b174c996a0ad44164ca05f110abf0da8ae1450f59a3483416996d83fff`.
Package identities match the preceding `hosted.json`; only acceptance documentation
was added after this run. The published pair remains Chelm 1.3.0 / Harness 0.13.0;
the portable-session additions are source changes pending a separate release.

## Semantic verdict and limits

PASS for this synthetic follow-up: the note requests a dry run on 27 November
before the approved 28 November freeze. A request is not evidence of dry-run
approval or completion and does not replace the freeze decision. The actual
LLM added one source assertion with that uncertainty and new opaque IDs,
preserved all retained graph records, and left the empty question/hypothesis
collections unchanged. The original unapproved 26 November proposal and approved
28 November replacement remain in history and in the earlier accepted answer.
This is the author's source-grounded review, not blinded semantic certification.
The exact served model, reasoning settings, tokens and cost are unknown.

The live observation covers ChatGPT Work. Fresh Cursor/Codex UI conversations
were not run and are not claimed. Supported OS/Node clean-package qualification
is separate: see the matrix attached to PR #57 and
[LOCAL_SESSION_ACCEPTANCE.md](../../LOCAL_SESSION_ACCEPTANCE.md).
Failed, cancelled and in-progress jobs are not passes.

Cleanup acknowledges this conversation's observed runtime deletion and the four
previous copies whose deletion the committed handoff explicitly recorded. The
reset sweeper operates on adapter-controlled checkpoint/upload keys; underlying
provider backups and physical retention are outside that assertion. In D1,
`last_reset.cleanup_pending` is the original immutable reset receipt; current
cleanup is determined by the empty `retired` inventory and final status.

The earlier handoff is now historical: its checkpoint was intentionally consumed
and reset in this run. Do not attempt to resume generation 1 again. No consumer
runtime, Site audience, application secret or package pin was changed.
