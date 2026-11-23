# Resume a cognitive assignment after reconnect

ResumeCognitiveWorker(executor, retainedSubmission) {
  page = chelm_list_work({});
  Follow next_offset; select your kind:"cognitive" assignment;
  work = chelm_work_status({work_id, attempt});
  if work.receipt != null { report the durable receipt; stop; }
  if inactive(work) { stop; request a fresh assignment with a new request_id; }
  Read bound protocol/schema artifacts and immutable guidance;
  Reuse stable chelm_cognitive_read request_id values for unknown read outcomes;
  Never supply or amend a trusted evidence receipt;
  if retainedSubmission exists {
    retry chelm_submit_candidate(retainedSubmission); // Same ID, digest and outputs.
  } else {
    Continue the once procedure within remaining budgets;
  }
  On policy_changed or stale_snapshot: abandon; request fresh work;
  Never auto-renew a total task/continuation budget;
  Only the application can supply user replies, authorize collection or publish learning;
}
