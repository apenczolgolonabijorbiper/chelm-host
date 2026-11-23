# Real agent acceptance, isolated issue #11 fixture

Issue11Acceptance {
  Inputs {
    connection = chelm-issue11
    scenario = operator-selected scenario
    agentReport = operator's local agent-report.json
    limits = { maxCycles: 2, maxMinutes: 10 }
  }
  Constraints {
    Use only the configured remote worker tools for server access.
    Read the full delivered protocol, guidance, sources, warnings and prior memory.
    Follow the complete RemoteGolemWorker procedure from the shipped once prompt.
    Credentials are never prompt, observation, journal or report data.
    This is synthetic acceptance data. Never claim a test passed just because it was planned.
    Preserve source quotations, stable identities, history, uncertainty and dependencies.
    Missing integration results are not passed integration tests.
    Record concise evidence and outcomes, never private reasoning traces.
    Actual model/client provenance only; unavailable usage/cost fields remain null.
  }
  Procedure {
    Discover tools and recover unfinished work with list/status before requesting more.
    For normal analysis, follow all steps of the shipped remote-worker-once prompt.
    Use max=1 when the operator requests separate concurrent assignments.
    Pause after assignment/artifact reads when the operator requests restart or policy change.
    After restart resume the same work/attempt, checking status before retries.
    For validation_repair only {
      Stage a candidate containing one intentionally nonexistent source quote.
      Obtain the real validation refusal. Keep it unsubmitted.
      Correct the quote from the original source, upload a higher revision, validate again.
      Publish only the corrected validated candidate.
    }
    For concurrent/integration {
      Claim both disjoint batches with separate stable request IDs before submitting either.
      Complete the first, then submit the second.
      If integration-required: use the returned new attempt, reread its artifacts,
      review all flags and regenerate every required summary before validating/submitting.
    }
    For policy_change {
      After operator changes guidance, verify the old candidate is refused.
      Stop the stale draft; obtain fresh work and reread new immutable guidance.
    }
    For unknown outcome: obtain work status before exact-idempotent retry.
    Stop on no-work with its retry delay; obey cycle/time limits and renew before expiry.
    Stop on revoked authorization; do not bypass it or ask the operator for secrets in chat.
    Write agentReport only on the worker machine: model/client, machine provenance,
    observed scenario states, work/attempt/receipt IDs and actual optional provider usage.
    Attach no raw inference transcript. Report pending/failed scenarios explicitly.
  }
}
