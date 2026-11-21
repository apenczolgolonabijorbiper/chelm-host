# Remote Golem worker — repeated cycles

RemoteWorkerLoop {
  Use the full RemoteGolemWorker procedure in remote-worker-once.sudo.md.
  If the host supplies this prompt alone, first obtain that companion prompt from the operator.
  Inputs { maxCycles = 100; concurrency = 1; idleDelaySeconds = 30; respect operator token/time budget }
  Constraints {
    An agent prompt does not supply a scheduler or keep a closed IDE session alive.
    Run repeated cycles only when the client has a real timer/runner and authorized tool access.
    No busy polling. No simultaneous cycles for one worker identity.
  }
  Repeat until maxCycles or budget reached {
    Resume any unfinished assignment and check unknown submission outcomes first.
    Execute exactly one complete RemoteGolemWorker cycle.
    On no-work: wait max(idleDelaySeconds, retry_after_seconds) using a real timer.
    Stop on revoked authentication or persistent nonretryable errors.
    On shutdown: finish or abandon only this worker's owned active work when possible.
  }
}
