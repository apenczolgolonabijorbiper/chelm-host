# Hosted actual-agent acceptance and independent-session handoff

Historical handoff: a later independent Work conversation completed this recipe,
saved revision 2 and performed hosted reset. The generation-1 checkpoint is now
purged; the steps below are the retained original handoff, not a currently
resumable checkpoint. See [the independent-session evidence](../local-sessions-independent-2026-11-25/README.md).

Observed on 2026-11-25 in the issue #45 finalization conversation. This is a new
conversation relative to the implementing agent, but it **cannot resume that
agent's checkpoint**: its test reset deleted the original checkpoint and store
objects. No fresh-conversation resume is claimed here.

The private synthetic acceptance Site is
https://chelm-session-acceptance-nov25.candid-duck-7995.chatgpt.site
(project `appgprj_6b06751d9c3481918405dc0facdee07e`). Its source commit is
`5fb83af71c09d3fadd7db6674d1553bd6bc4bb09`. The native deployment succeeded,
provisioned DB/BUCKET, and applied the schema-only D1 migration. The Sites
read-only database overview independently returned DB / chelm_sessions.
`deployed-worker.mjs`, `site-manifest.json` and `site-schema.sql` retain the
application-owned binding. Imported modules are the unchanged PR #57 modules;
the runtime package identities are in `hosted.json`.

The Work executor authenticated over real HTTPS, persisted the cognitive
question before task creation, read both sources through the production
cognitive contract, and authored `response.json`. Memory setup used explicitly
scripted synthetic assertions without a model. `accepted.json` retains the
host validation and committed receipt. The answer correctly distinguishes the
unapproved 26 November proposal from the approved 28 November replacement;
that is the author's review of one synthetic case, not independent semantic
certification. Provider model ID, reasoning settings, tokens and cost are unknown.

The answer was saved through the D1/R2 coordinator as generation 1, revision 1.
Both original and restored local workspaces were deleted. Before deletion, a
new directory restore preserved the exact answer, authoritative receipt, Git
snapshot and both complete citation bytes. A follow-up input was queued durably
for the next independent conversation. The selected checkpoint is intentionally
retained; no active publishing session remains. This is real hosted persistence
and same-conversation restore, not an independent-conversation observation.

Environment revision 2 binds CHELM_AGENT_TOKEN to the existing owner-private
Site service credential, enabling the owner to reconnect through get_site
without a secret in a prompt, file, GitHub, checkpoint or source bundle. The
client supplies it as both Authorization and OAI-Sites-Authorization. Incorrect
application credentials and missing platform credentials both returned HTTP
401; authenticated status retained the same selected checkpoint. This shared
credential mapping is specific to this owner-private synthetic acceptance
fixture, not multi-user application authentication. A service credential rotation
requires explicit matching secret configuration and redeployment.

Local-copy registrations are retained until generation reset; all recorded
local copies were physically deleted (including both handoff rehearsal attempts). After reset, their generation-1 cleanup
acknowledgements can be sent because their deletion is observed. No live reset
is claimed in this evidence; the independent-session acceptance should finish
with it. Earlier loopback/deterministic reset evidence remains separate.

## Next independent Work conversation

1. Read issue #45, PR #57, AGENTS.md, LOCAL_SESSIONS.md, and this directory.
   Use the exact PR code and integrity-checked published Harness 0.13.0.
2. Read the Site through get_site using the exact project ID above. Verify that
   access remains owner-only. Retain the returned existing
   siwc_bypass_bearer_token only in execution memory; do not print it or use the
   token-generation action. Preserve Site access. If the token is unavailable,
   report the missing authenticated connection rather than changing the audience.
3. Run `node resume.mjs EXACT_HARNESS FRESH_PRIVATE_RUNTIME` from this directory,
   passing one JSON line `{ "token": "<existing credential>" }` over hidden
   stdin. The script verifies the selected checkpoint, exact receipt and
   citations, restores into a nonexistent target, and submits the durable
   follow-up input through the public host API. It never writes a credential.
   Confirm this is actually a new conversation separately: the script cannot
   certify that property. Use a unique target path for each attempt.
4. Follow the actual file-worker contract to analyze the queued source, including
   its normal age gate, journal, validation and committed receipt. Record the
   agent's real inference rather than substituting fixture analysis. Save a
   checkpoint acknowledging only `new-evidence-for-next-conversation`; retain
   its durable revision-2 receipt and re-read the earlier task citation.
5. Exercise full hosted reset while an old binding is detached. Retain the
   generation-changed refusal and empty selected head, sweep R2 inventory, and
   acknowledge only local copies whose removal is observed. The prior
   session IDs are in `hosted.json`; the original/restored copies and both
   handoff rehearsal copies were removed as observed. Do not claim removal of any other
   detached copy without evidence.
6. Retain the new request/response, receipts, exact identities, semantic verdict
   and independent-conversation provenance. Reconcile #45/#48 and the PR only
   after that observation and supported platform qualification pass. Publishing
   a new Chelm version remains a separate release action.
