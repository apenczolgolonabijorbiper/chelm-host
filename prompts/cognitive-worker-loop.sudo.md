# Externally bounded cognitive worker loop

CognitiveLoop(executor, maximumTasks, absoluteDeadline) {
  require finite(maximumTasks) && maximumTasks > 0;
  require finite(absoluteDeadline);
  for i in 1..maximumTasks while now < absoluteDeadline {
    Apply cognitive-worker-once.sudo.md with a stable new assignment request_id;
    stop on no-work, cancellation, expired authorization or unresolved failure;
    Do not self-trigger collection or continuation;
  }
  // An external scheduler alternates with observation work for fairness.
  // There is no host inference client or autonomous background scheduler.
}
