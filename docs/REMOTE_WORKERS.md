# Configure remote cognitive workers

Machine A hosts the application, Chelm 1.1 and verified harness **0.11.0**. Machine
B needs an MCP-capable agent and inference access. Native HTTP clients need no
Chelm, harness, Python, Git, SMB share or access to files on A. The optional stdio
bridge needs Node and this package's shipped dependencies on B, but no harness.

This guide describes the new interface. Old offer/take/return/adopt commands are
removed. Memory is published automatically after host validation and any required
integration review. Local application commands and committed read views continue
as before. The app-contract-v1 delegations read view is retained as an empty view.

## 1. Prepare the owner

For an existing 0.2 runtime, first finish or abandon every held processing lease
using 0.2. Finish returned delegation results with 0.2 if you want to retain their
analysis. Pause old workers. Replace the installed packages with verified releases.
Keep the runtime and existing canonical instance. **Do not run init over it.**

```powershell
node C:/Golem/chelm-host/bin/chelm.mjs migrate --runtime C:/GolemData/MyApp
# Inspect the preflight. Apply once old packages have been settled:
node C:/Golem/chelm-host/bin/chelm.mjs migrate --runtime C:/GolemData/MyApp --apply
# Alternative: explicitly discard outstanding old analyses and requeue their sources:
node C:/Golem/chelm-host/bin/chelm.mjs migrate --runtime C:/GolemData/MyApp --apply --cancel-legacy
```

The last two commands are alternatives. Cutover archives old local host metadata
and configuration, never deletes share contents, and leaves memory commits intact.
It writes runtime configuration schema 2 with remote worker defaults. Update
`harness.root` to the verified 0.11.0 folder. Then:

```powershell
node C:/Golem/chelm-host/bin/chelm.mjs verify --runtime C:/GolemData/MyApp
node C:/Golem/chelm-host/bin/chelm.mjs refresh --runtime C:/GolemData/MyApp
```

For a genuinely new runtime use `init --runtime <new-path> --harness <release>`.
The host needs Node >=22.12, Python >=3.12 and Git. Release ZIPs omit node_modules. Run `node integration/install-dependencies.mjs`
in an extracted package (also on a stdio bridge machine), or use the application
installer, which restores locked dependencies automatically. npm needs registry
access or a populated cache. See README.md for offline setup and repair.
Source checkouts require `npm ci --omit=dev --ignore-scripts`.
Harness graph v2/hypotheses v1/vocabulary v2 remain unchanged. In-flight old
guidance leases cannot carry across an upgrade. Purpose-only instances now
receive immutable guidance too. Application source mirrors may include purpose.md;
`profile install --source <reviewed-source>` uses native transactional lifecycle.

## 2. Configure the service on A

Simple mode for controlled worker clients uses a different random bearer secret
for each worker. Generate at least 32 random bytes with your credential tooling.
Set `CHELM_WORKER_B_TOKEN` in the service account's environment/credential setup.
Set the same secret in B's MCP client environment. Do not put it in the JSON below,
a repository, a prompt, an observation or a journal.

Save this as an operator-owned private service.json:

```json
{
  "listen": "127.0.0.1",
  "port": 4317,
  "public_url": "https://golem.example/mcp",
  "runtimes": {"myapp": "C:/GolemData/MyApp"},
  "auth": {
    "mode": "worker-tokens",
    "workers": [{"principal":"worker-b", "runtimes":["myapp"], "token_env":"CHELM_WORKER_B_TOKEN"}]
  }
}
```

Start the persistent Node process:

```powershell
node C:/Golem/chelm-host/bin/chelm-serve.mjs --config C:/GolemConfig/service.json
```

The process reports its loopback listener on stderr. It never launches inference.
Use your existing service supervisor to run it under a dedicated account, restart
on failure and stop cleanly on shutdown. That account needs package read access,
read/write runtime access and permission to launch the configured Python/Git/Node
executables. Avoid changing its OS identity while local leases are active.

Full IIS on Windows Server 2022: terminate HTTPS at IIS and reverse proxy
`/mcp`, `/mcp/*` and `/.well-known/oauth-protected-resource*` to
`http://127.0.0.1:4317`, preserving Host, Authorization, Content-Type, Accept and
MCP headers. Enable ARR proxying and URL Rewrite if that is your chosen proxy.
Keep the backend loopback-only. Service authentication uses its own bearer token;
forwarded user headers do not grant authorization. Allow POSTs up to 256 KiB and
allow enough response time for validation. Tool uploads themselves are limited to
32 KiB text bytes. The service returns JSON responses rather than requiring an
open SSE stream for work to continue. No per-request CLI process launches.

IIS Express development: run Node separately. For loopback testing change
public_url to `http://127.0.0.1:4317/mcp` and set `development:true`. Plain HTTP is
accepted only with explicit development mode and a loopback public hostname.
For remote B testing use an HTTPS proxy reachable by B.

For browser-based MCP clients, add their exact Origin to `allowed_origins` and
configure the reverse proxy's CORS/preflight behavior. Non-browser agent clients
usually omit Origin. Do not set wildcard origins.

## 3. Connect B

Native remote MCP client settings:

| Setting | Value |
|---|---|
| Transport | Streamable HTTP |
| URL | `https://golem.example/mcp/myapp` |
| Authorization | Bearer secret from B's credential configuration |
| Inference | B's own model/provider configuration |

Use a client supporting custom authorization headers for worker-token mode. This
is a controlled credential mode, not a claim that an arbitrary OAuth-only client
can use static tokens. If the client cannot connect natively, the optional stdio
bridge works with a conventional MCP process configuration:

```json
{
  "mcpServers": {
    "chelm": {
      "command": "node",
      "args": ["C:/GolemClient/chelm-host/bin/chelm-remote-mcp.mjs", "--url", "https://golem.example/mcp/myapp", "--token-env", "CHELM_WORKER_B_TOKEN"]
    }
  }
}
```

Launch the agent from an environment that contains the credential. The bridge
reads it from the environment and connects to A. It writes only MCP JSON to stdout.
The exact config file location belongs to your client; do not replace unrelated
MCP definitions. Native client versions and external inference smoke tests require
operator verification; automated tests use the pinned official SDK client.

OAuth/JWT mode integrates with an existing issuer:

```json
"auth": {
  "mode":"oauth-jwt",
  "issuer":"https://identity.example/",
  "jwks_url":"https://identity.example/.well-known/jwks.json",
  "audience":"https://golem.example/mcp",
  "workers":[{"principal":"worker-subject-id", "runtimes":["myapp"]}]
}
```

The issuer must issue access JWTs for this audience with exp/sub/iat and
`chelm:worker` scope. Issuer/JWKS must use HTTPS. Supported signature algorithms
are RS256, ES256 and EdDSA. Chelm advertises protected-resource metadata and
WWW-Authenticate discovery; it is not an authorization server. Configure the
client registration/grant with your issuer. Opaque token introspection is not
implemented. Existing issuer revocation/token lifetime policy applies; restart
with an updated allowlist to revoke a worker. Static-token mode can rotate the
service environment secret and restart without losing assignment ownership.

## 4. Run one cycle, then automate

The MCP endpoint also exposes prompts `chelm_remote_once`, `chelm_remote_loop` and
`chelm_remote_integration`. Select one in a client that supports MCP prompts; loop
and integration prompts include the complete base procedure. Alternatively paste [remote-worker-once.sudo.md](../prompts/remote-worker-once.sudo.md) into B's
agent session. It discovers tools, requests work, reads the complete protocol and
sources, performs cognition, stages allowed outputs, validates and submits. A
successful receipt says committed and includes HEAD. no-work is normal until an
observation passes the 60-second age gate.

Verify on A:

```powershell
node C:/Golem/chelm-host/bin/chelm.mjs remote list --runtime C:/GolemData/MyApp
node C:/Golem/chelm-host/bin/chelm.mjs read summary --runtime C:/GolemData/MyApp
```

For continuous work use the single-cycle prompt together with
[remote-worker-loop.sudo.md](../prompts/remote-worker-loop.sudo.md). An IDE session
must remain running and permit tool calls. Prompts cannot create timers or bypass
client tool approvals. The [integration prompt](../prompts/remote-integration.sudo.md)
explains the restricted review when another worker advanced memory.

For an agent CLI that accepts a prompt on stdin, configure the CLI's MCP connection
first, then use the shipped external-process runner:

```json
{
  "command":"C:/Tools/your-agent-cli.exe",
  "args":["<your CLI's documented noninteractive stdin mode>"],
  "cwd":"C:/GolemWorker",
  "max_cycles":100,
  "interval_seconds":30,
  "cycle_timeout_seconds":1800
}
```

```powershell
node C:/Golem/chelm-host/tools/run-remote-agent.mjs --config C:/GolemConfig/worker.json
```

Replace the executable/args with your installed agent's documented values; the
example is not a universal CLI syntax. The runner passes the one-cycle prompt to
stdin, inherits local inference/MCP credentials, limits each cycle and stops after
three failed cycles. It uses no shell interpolation. Generic process execution is
tested; unattended operation of your chosen agent/provider must be smoke-tested
with its actual version and approval policy before scheduling it as a service.

To add workers, authorize a distinct principal and connect another agent. Default
runtime `remote.max_active_work` is 1. After the first cycle succeeds, raise it
(e.g. 2) in chelm.runtime.json to analyze disjoint batches concurrently. Publication
remains serialized. Integration review is assigned through the same MCP tools.

## Operations and troubleshooting

- 401: credential missing/expired, short secret, wrong JWT issuer/audience/scope.
- 403: principal lacks runtime permission, or Origin is not explicitly allowed.
- busy: local processing/publication owns the runtime; retry after a delay.
- policy_changed/profile_mismatch: install reviewed guidance, stop the stale draft
  and request fresh analysis; never relabel an old result with a new policy hash.
- unknown submission outcome: list/status first; reuse the same submission ID and
  candidate digest only for an identical retry.
- merge_conflict: inspect named conflicting records and decide explicitly; do not
  invent a resolution in a summary. Cancel/requeue the affected work if needed.
- recovery_required: preserve unrelated local edits and resolve the reported
  publication/index issue; do not reset the entire working tree.

Local administration:

```powershell
node C:/Golem/chelm-host/bin/chelm.mjs remote cancel --runtime C:/GolemData/MyApp --id <work-id>
node C:/Golem/chelm-host/bin/chelm.mjs remote prune --runtime C:/GolemData/MyApp
```

Prune removes terminal artifacts older than seven days while retaining receipts.
Service restart preserves snapshots/uploads/attempts/receipts. Restart with the
same runtime and worker principal. Work expires naturally if no agent renews.
Do not serve private runtime directories as static IIS content.

## Acceptance evidence

See [EXTERNAL_ACCEPTANCE.md](EXTERNAL_ACCEPTANCE.md) for the target IIS proxy,
reference workstation, two-machine inference and consumer checks. Run the
read-only `tools/probe-remote.mjs` from a worker machine to capture actual
connectivity, discovery and SDK/server versions before using a cognition prompt.
The probe does not request assignments or invoke inference.

CI runs two independent SDK client processes through an HTTP proxy and restarts
the owner service between requests. It also kills publication fixture processes
immediately before and after Git CAS. `remote-phases-<platform>.json` records
per-tool wall times and JSON payload sizes; inference time, provider token use
and cost are explicitly unknown. These are deterministic fixtures on one machine.
They do not certify an IDE/provider, TLS deployment or unattended approval policy.
