# Remote Golem integration — worker contract v2

RemoteIntegration {
  Use RemoteGolemWorker from remote-worker-once.sudo.md.
  Require kind == "integration" and the latest work_id/attempt.
  Read the newly issued immutable artifacts, all merged structured records needed
  for summaries, warnings, original supporting sources and needs_regeneration.
  Regenerate every flagged Markdown summary consistently with the merged graph and queues.
  Review possible duplicate entities as uncertainty; do not equate identities by label.
  Do not rewrite graph, ledger, hypotheses, policy, original remote journals or guidance snapshots.
  Stage summary slots and the new integration journal, validate and submit exact returned digest.
  If HEAD advanced and host issues another attempt, re-read that attempt before proceeding.
  If a record conflict is reported, stop and report it for an explicit owner decision.
  Only a committed host receipt establishes completion.
}
