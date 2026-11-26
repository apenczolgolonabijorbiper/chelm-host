# Preferred cognizer routing v1 (issue #59)

This is an optional host dispatch contract, `cognizer-routing-v1`. It does not
install, run, supervise or qualify a cognizer or a language model. It works with
independent synthetic clients and any conforming implementation. Existing
installations keep unrestricted compatible-worker dispatch when the setting is
absent or disabled; Shem is never selected automatically.

Available from **Chelm 1.4.0**. Published Chelm 1.3.1 does not accept the
setting. Negotiate `version.capabilities` and the routing tool definitions before
using these examples. The deterministic release reference is published Harness
0.13.0. The approval catalog retains file workers from 0.11.0, cognition from
0.12.0 and providers from 0.13.0 for its explicitly listed releases through
0.14.0; routing never widens those feature approvals. Shem must negotiate the published routing capability and supported
contracts before consumer rollout; a host release alone does not implement Shem. See [Harness compatibility](HARNESS_COMPATIBILITY.md).

## Configuration and effective policy

The optional top-level `preferred_cognizer` in `chelm.runtime.json` accepts the
object below in both runtime config 2 and 3. Keep host configuration in the
private runtime, outside vendor packages. The field is a seed for the effective
host policy. After any routing state exists, change policy using preview/apply;
edits to the seed fail closed with `routing_config_changed`. Restore the original
seed and submit the new complete policy through the admin operation.

```json
{
  "schema_version": 1,
  "mode": "prefer",
  "cognizer_id": "shem",
  "work_kinds": ["observation", "cognitive"],
  "grace_seconds": 60,
  "fallback": ["base"],
  "readiness_ttl_seconds": 120,
  "workers": [
    {"binding_id": "shem-one", "transport": "remote", "principal": "shem-worker-1", "cognizer_id": "shem"},
    {"binding_id": "shem-two", "transport": "remote", "principal": "shem-worker-2", "cognizer_id": "shem"},
    {"binding_id": "base-one", "transport": "remote", "principal": "base-worker", "cognizer_id": "base"}
  ]
}
```

| Field | Accepted values / meaning |
| --- | --- |
| schema_version | Exactly 1 |
| mode | `disabled`, `prefer`, `require` |
| cognizer_id | Operator-chosen logical implementation ID, never a command/path/model/URL |
| work_kinds | Explicit nonempty subset of `observation`, `cognitive`; other queue retains its existing behavior |
| grace_seconds | Integer 0–3600; 0 permits immediate configured fallback |
| fallback | Unique allowlist of logical IDs; empty in require mode |
| readiness_ttl_seconds | Integer 5–300; evaluated on requests without a background scheduler |
| workers | 1–64 unique trusted identity bindings; multiple instances may share one cognizer ID |

Logical/binding IDs match `[a-z][a-z0-9_-]{0,63}`. Each preferred/fallback ID must
have a binding. One authenticated identity cannot represent several cognizers.
The complete disabled form is `{"schema_version":1,"mode":"disabled"}`;
no other fields are accepted with that mode. Admin apply also accepts null to
disable. Exact JSON shape: [schema](../schemas/cognizer-routing.schema.json).

## Identity and readiness

Remote principal bindings refer to the administrator's authenticated service
worker configuration, which must separately permit access to the runtime.
Tokens/JWT subjects do not come from work arguments. Remote principals beginning
with `local:` are reserved and refused. A registration cannot grant runtime
access, change its cognizer, or use another principal's assignments.

A local binding uses `transport: "local"`, `principal` equal to the actual OS
account returned by `routing status.local_identity.principal`, and `host` equal to
its actual hostname. Neither comes from environment username variables or
executor JSON. CLI, stdio cognitive workers and provider workers under that OS
identity share the binding. They cannot be distinguished as separate cognizers
under one OS account. Use separate OS accounts with appropriate runtime access,
or separate authenticated remote principals, for separate identities. Unknown
local identities are refused for enforced work; declaring `executor.id=shem`
has no effect. A runtime-writable OS account already has administrative authority
in Chelm; OS ACLs must protect runtime policy, state and source files from
untrusted processes. Routing is not isolation from an OS administrator.

1. Discover `chelm_routing_status` (or local `routing-worker status`), which returns
   this caller's binding, required path contracts/capabilities and exact selected
   Harness manifest digest. Unknown bindings receive `routing_identity_unregistered`.
2. Call `chelm_routing_register` / `routing-worker register` with declarations:

   ```json
   {
     "host_contracts": ["remote-worker-v2", "cognitive-worker-v2"],
     "capabilities": ["cognizer-routing-v1", "purpose-guidance-v2", "cognitive-task-v1", "cognitive-context-v1", "cognitive-result-v1", "learning-hypothesis-v1", "hypothesis-unknown-confidence-v1"],
     "harness_manifest_sha256": "REPLACE_WITH_DISCOVERED_64_HEX_DIGEST"
   }
   ```

3. Send `chelm_routing_heartbeat {}` before expiry while ready. Re-register after
   package or binding changes. The host checks the exact current Harness digest
   and the path's exact host contract before eligibility. File CLI/stdio uses
   `file-worker-v1`; provider CLI/HTTP/stdio uses `memory-worker-v3` and requires
   `memory-provider-v1`; cognition uses `cognitive-worker-v2` on either transport.

These are trusted worker *declarations*. Package/feature qualification remains
separate, as does evidence of model quality or Shem maturity. Old clients remain
accepted with routing disabled; enabled scoped work requires registration.

## Selection, durable grace and recovery

The first locked host scan that finds an unowned source ready, or a queued task
eligible, persists a host-time eligibility event keyed by source ID+digest or
task ID+revision. That event starts the bounded grace. It is not a poll timestamp,
caller timestamp or a heartbeat. A new source/task revision starts a new clock.
Policy changes, repeated polls, renewed readiness and restarts do not reset it.
Existing queue ordering is retained within each eligible set. Processing still
starts only on worker requests; the host has no background dispatcher.

In prefer mode a ready preferred worker may claim immediately. Allowlisted ready
fallback workers may claim after each work item's grace expires, including when
the preferred worker is absent, incompatible, expired, or registered but never
claims. Preferred readiness never extends grace. Require mode leaves work pending
until an eligible preferred worker requests it. There is no automatic fallback.
No pending work identity or other principal's assignments appears in a refusal.

| Result | Meaning |
| --- | --- |
| `no-work` | No eligible pending source/task in the requested existing queue/filter |
| `busy`, reason `capacity` / `lease` | Enabled scope has existing quota/lease pressure; retry 30 seconds |
| `deferred`, `worker_unregistered` / `worker_expired` / `worker_incompatible` | Caller lacks usable binding/readiness/negotiation |
| `deferred`, `preferred_grace` | Ready fallback is waiting on the durable work grace |
| `deferred`, `preferred_required` | Require mode forbids this other implementation |
| `deferred`, `fallback_not_allowed` | This implementation is not an allowed fallback |

Scoped deferrals carry revision/mode/queue and a retry hint of 1–30 seconds.
Local file workers retain existing lease/recovery errors, which are distinct from
an empty queue. Normal status and `doctor` expose effective policy, revision,
registrations, expiry and eligibility per scope. Worker status exposes its own
binding only. Assignment responses/records retain selected cognizer, binding, actual
authenticated principal or local actor, executor provenance and routing revision
alongside work/run/task/attempt identities and receipts. Bounded operation logs
link the selected implementation and identity to the existing work/run IDs.

Routing is evaluated under the existing operation mutex, immediately before
claim/reservation on every binding. Quotas, authorization, reservations and
package checks still apply. Integration/review is an owned continuation of the
original assignment, not a new routing decision. Request-ID retries first return
the original owner's assignment/receipt according to the existing work contract,
even if preference/readiness changed. File-worker contract 1 has no request ID;
its existing OS-owned run/lease recovery remains in force.

Policy changes affect new assignments. Existing owners can status, renew, submit
or abandon under their existing work contract. Uncertain claim/publication states
stay reserved past deadlines until explicitly recovered/cancelled; fallback never
repeats them. Existing source-change/guidance-change/expiry rules still apply.
Settled checkpoints preserve policy/history/grace and discard readiness. Restoring
does not silently rebind local cognizer accounts: an administrator must review
and apply changed account/hostname bindings, then workers register again.

## Preview, switch, drain and rollback

`routing status`, `routing preview` and `routing apply` are local administrative
CLI operations with the same OS/filesystem authority as other runtime admin
operations. They are not exposed by worker MCP/HTTP.

```sh
node bin/chelm.mjs routing status --runtime /private/runtime
node bin/chelm.mjs routing preview --runtime /private/runtime --input policy-change.json
node bin/chelm.mjs routing apply --runtime /private/runtime --input policy-change.json
```

`policy-change.json` contains `expected_revision` from status and the complete
`preferred_cognizer` object above. Preview validates without mutation. Apply
compares the revision under the operation mutex, atomically persists the effective
policy, increments the revision and retains the previous 20 policies for review.
Stale revisions return `routing_revision_conflict`.

To move from base to prefer-Shem, provision authorized Shem and fallback bindings,
apply prefer mode, register both implementations and inspect readiness. To require
Shem, apply require mode with `fallback: []`. That does not revoke existing base
assignments: let them finish or explicitly cancel/requeue with the existing work
admin/recovery operations. Reconcile unknown publication before cancellation.
To roll back, apply the previous full policy with the current expected revision,
or null for unrestricted dispatch. None of these operations changes memory,
provider, source identities, intake, guidance or Git HEAD, or reinitializes state.

The companion [Shem switch guide](https://github.com/apenczolgolonabijorbiper/shem-cognizer/blob/8557d3cca94d3e3009557a9661247f484d7f0ce9/docs/SWITCHING_TO_SHEM.md)
is pinned to the reviewed planning revision. Shem #17/#16 track
transition/reference decisions. This host change neither promotes Shem to
reference nor retires other conforming cognizers.

## Qualification and specification parity

[Routing tests](../tests/routing.test.mjs) use deterministic clients and independent
authenticated MCP connections, both runtime modes, local CLI/stdio, no-inbox
cognition, source reservations, integration review, response-loss recovery,
policy CAS, expiry/grace and checkpoint restart. They do not qualify actual Shem
or LLM reasoning. [The SudoLang specification](../specifications/COGNIZER_ROUTING.sudo.md)
must track code/schema changes in the same change/release; the wider #38 local-core
specification work is still separate. Platform and staged package results for
this candidate belong in [ACCEPTANCE.md](ACCEPTANCE.md), not the historical
published-release evidence.
