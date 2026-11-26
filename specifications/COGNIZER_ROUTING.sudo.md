# Cognizer routing v1 — executable reference behavior

Reference: lib/routing.mjs and schemas/cognizer-routing.schema.json.
Bindings: lib/worker.mjs, lib/provider-worker.mjs, lib/cognitive.mjs,
lib/remote.mjs, bin/chelm-mcp.mjs. Fixture: tests/routing.test.mjs.
This specification covers routing only; the broader local-core portability
specifications tracked by #38 are not claimed complete or published here.

Contract CognizerRoutingV1 {
  capability = "cognizer-routing-v1"
  trust = authenticated remote principal OR OS actor + OS hostname
  executor_metadata = descriptive_only
  local_admin_authority = existing runtime filesystem/OS administrative boundary
  host_contracts = [file-worker-v1, remote-worker-v2,
                    memory-worker-v3, cognitive-worker-v2]
  transport_args cannot supply identity, cognizer, clock, expiry, or revision
}

validateRoutingPolicy(policy) {
  absentOrNull => {schema_version: 1, mode: disabled}
  validate schemas/cognizer-routing.schema.json
  disabled => reject fields other than schema_version, mode
  enabled => require cognizer_id, work_kinds, grace_seconds, fallback,
             readiness_ttl_seconds, workers
  reject duplicate scopes, fallback IDs, binding IDs, authenticated identities
  require local hostname; forbid remote hostname
  require a configured binding for preferred and each fallback cognizer
  forbid preferred in fallback; require mode forbids any fallback
}

load(runtime) {
  validate config seed; never infer a Shem default
  if persisted: require same runtime_id and seed digest; validate state/policy
  else: revision=0, effective_policy=seed, registrations={}, pending={}, history=[]
  mutations use atomic replacement under the runtime operation mutex
}

routingAdmin(preview|apply, expected_revision, preferred_cognizer) {
  require local runtime admin authority; never expose via worker MCP
  hold runtime operation mutex
  compare expected_revision with persisted revision; stale => routing_revision_conflict
  validate complete proposed policy
  preview => no writes
  apply => persist previous policy/OS actor/time in history (last 20 revisions)
           increment revision; retain pending clocks
           retain readiness only for unchanged authenticated bindings
  rollback = apply prior complete policy with current expected_revision
  never edit memory, source identities, HEAD, guidance, leases or assignments
}

routingWorker(register|heartbeat|status, identity) {
  require existing runtime authorization before routing binding lookup
  resolve administrator-provisioned identity -> binding -> logical cognizer
  missing binding => routing_identity_unregistered
  register => persist declared exact Harness manifest digest, host contracts,
              capabilities, binding digest, host timestamps and finite expiry
  heartbeat => require registration matching binding digest; refresh finite expiry
  status => expose only caller binding and readiness, plus required contracts/digest
  readiness declarations are not binary/model qualification or runtime authority
  compatibility requires current verified Harness digest, exact path contract,
    cognizer-routing-v1 and work-kind capabilities
  expiry = min(record expiry, heartbeat + effective policy TTL)
  no readiness request touches pending clocks or owned work
}

routeCandidates(identity, scope, contract, ordered_candidates) {
  caller holds SAME mutex as new claim/source reservation
  recover exact authorized request-ID retries / pending integration BEFORE routing
  enforce existing quota / lease / recovery guards
  absent|disabled policy OR scope outside explicit work_kinds => original behavior
  empty candidates => no-work
  for each candidate:
    key = observation ID + source digest OR task ID + task revision
    pending[key].eligible_at ??= host current time
  persist clocks BEFORE any preference refusal or selection
  // eligibility event = first scan by host that finds this unowned work ready
  // clock is independent of poll, worker, request ID and policy revision
  authenticate binding and check finite readiness + negotiated capabilities
  eligible preferred => selected in original queue order
  require + other cognizer => deferred(preferred_required)
  prefer + nonallowlisted cognizer => deferred(fallback_not_allowed)
  prefer + allowlisted cognizer => select only candidates with elapsed >= grace
  no eligible selection => deferred(scoped reason, retry 1..30 seconds)
  capacity/lease blocked under enabled scoped policy => busy, retry 30 seconds
  attach policy revision, scope, mode, selected cog/binding, authenticated identity,
    trusted selected_at to original durable owner and response
}

Recovery {
  policy revision changes affect NEW assignments only
  preserve integration/review owner, work/run/task ID, attempt, sources and receipt
  renew/status/submit/abandon continue under original ownership contract
  claiming|submitting|submitted with unknown outcome stay reserved past expiry
  reconcile unknown publication before cancellation/requeue; never rerun by fallback
  restart => reload clocks, policy, registrations and assignments
  settled checkpoint => retain seed/effective policy/history/clocks; clear readiness
  restored local accounts are NOT silently rebound; admin applies explicit bindings
}

Parity {
  tests/routing.test.mjs: deterministic time, trust, bounded grace, scope,
    CAS/recovery, two independent authenticated HTTP clients, CLI/stdio,
    provider v3, no-inbox cognition, integration/review, checkpoint, diagnostics
  changes to routing MUST update this spec, schemas and those fixtures together
  no routing fixture claims actual LLM cognition or Shem reference promotion
}
