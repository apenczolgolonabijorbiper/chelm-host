# Issue #11: operator test and return package

Use this runbook for the external part of [issue #11](https://github.com/apenczolgolonabijorbiper/chelm-host/issues/11).
The vendor has tested protocol recovery, authentication, concurrency, migration,
platforms and the IIS identity case. The remaining evidence is the actual IIS
HTTPS/ARR deployment and a real agent on a second machine. Keep these separate
from the automated fixtures. Do not upgrade an application for this check.

## Files and machines

- **A**: Windows Server 2022, full IIS, URL Rewrite + ARR, Node >=22.12, Python
  >=3.12, Git. Use a dedicated test hostname with a certificate trusted by B.
- **B**: your Windows 11 workstation with Node and an MCP-capable inference
  client (for example Codex). B needs no harness, Python, server paths or share.
- Use the published **1.3.0** release or its successful CI artifact
  **chelm-release**. Verify `chelm-host-1.3.0.zip` against its adjacent `.sha256`
  before extraction. Record the release target or artifact CI revision.
- After unpacking `chelm-release.zip` into Downloads/chelm-release, on A:

```powershell
$Archive = 'C:/Users/YOUR_USER/Downloads/chelm-release/chelm-host-1.3.0.zip'
$Expected = ((Get-Content "$Archive.sha256" -Raw).Trim() -split '\s+')[0]
if ((Get-FileHash $Archive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Expected) { throw 'ZIP checksum mismatch' }
if (Test-Path C:/GolemAcceptance/chelm-host) { throw 'Choose a fresh test folder' }
Expand-Archive -LiteralPath $Archive -DestinationPath C:/GolemAcceptance
```

- Install the exact published harness 0.13.0 on A. With Python available:

```powershell
$Pkg = 'C:/GolemAcceptance/chelm-host'
python "$Pkg/tools/prepare-harness.py" --version 0.13.0 --destination C:/GolemAcceptance/golem-harness
node "$Pkg/integration/install-dependencies.mjs"
```

Copy only the verified Chelm candidate package to B and run its dependency
installer there too. No credentials belong in these folders or ZIPs.

## 1. A: create the disposable fixture

Use a new directory with a `sandbox` path segment. The tool refuses an existing
directory and creates only synthetic data; it does not reinitialize a runtime.
Set your hostname before running the command:

```powershell
$Pkg = 'C:/GolemAcceptance/chelm-host'
$Runtime = 'C:/GolemAcceptance/sandbox/issue11'
$Public = 'https://golem-test.example.org/mcp' # replace with your test hostname
node "$Pkg/tools/issue11-acceptance.mjs" prepare --runtime $Runtime --harness C:/GolemAcceptance/golem-harness --public-url $Public
```

Expected: `ok:true`, two observation IDs, and
`C:/GolemAcceptance/sandbox/issue11/operator/service.json`. Purpose/profile policy
is delivered by the ordinary harness contract. Operation phases are enabled only
for this fixture. Two concurrent assignments are allowed.

Generate two secrets in this PowerShell session:

```powershell
$env:ISSUE11_WORKER_TOKEN = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
$env:ISSUE11_DENIED_TOKEN = node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
node "$Pkg/bin/chelm-serve.mjs" --config "$Runtime/operator/service.json"
```

Expected on stderr: `Chelm remote MCP listening on ... 127.0.0.1 ... 4317`.
Keep this terminal open. Transfer the two secrets to B using your password manager
or another private channel. Do not send them to the issue or ChatGPT. Keep the
same secrets when restarting the service. New notes need **60 seconds** before
assignment; preparing IIS and B normally covers that interval.

## 2. A: configure the test IIS HTTPS reverse proxy

Use a dedicated IIS site, outside both the package and private runtime. Bind your
test hostname on HTTPS/443 with its valid certificate. Enable Anonymous
Authentication; the Node service checks its own bearer credential. The test
hostname must resolve to A from B. Keep Node bound to loopback.

Check prerequisites from elevated Windows PowerShell:

```powershell
Import-Module WebAdministration
Get-WebGlobalModule | Where-Object Name -Match 'Rewrite|Routing'
& "$env:windir/system32/inetsrv/appcmd.exe" list config -section:system.webServer/proxy
```

Expected: Rewrite and Application Request Routing modules installed, proxy
`enabled="true"`, `preserveHostHeader="true"`. Install URL Rewrite/ARR using
your server's approved provisioning if absent. In IIS Manager, select the server,
Application Request Routing Cache -> Server Proxy Settings -> Enable proxy.
Changing ARR proxy settings is server-wide; use a test server or review the effect
on existing sites. Do not disable certificate validation on B.

On the dedicated test server, these explicit commands set those proxy options
(they apply server-wide):

```powershell
& "$env:windir/system32/inetsrv/appcmd.exe" set config -section:system.webServer/proxy /enabled:true /preserveHostHeader:true /commit:apphost
```

Put this `web.config` in the dedicated test site's web root:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    <security><requestFiltering><requestLimits maxAllowedContentLength="262144" /></requestFiltering></security>
    <rewrite><rules>
      <rule name="ChelmAcceptance" stopProcessing="true">
        <match url="^(mcp(?:/.*)?|\.well-known/oauth-protected-resource(?:/.*)?)$" />
        <action type="Rewrite" url="http://127.0.0.1:4317/{R:1}" appendQueryString="true" />
      </rule>
    </rules></rewrite>
  </system.webServer>
</configuration>
```

Preserve Authorization, Host, Content-Type, Accept and MCP headers. Allow at least
180 seconds proxy response time for validation; no SSE buffering assumption is
needed. This test uses non-browser clients, so no CORS origin needs to be allowed.

From IIS Manager record site binding/certificate and proxy configuration in a
short `deployment.txt` (no secret values): Windows edition/build, hostname,
certificate issuer/expiry, ARR/Rewrite versions, backend/service OS identity and
how you started/restarted it. Record that this was a foreground service smoke;
it does not verify unattended service-supervisor recovery. Do not claim that case
unless you actually configure and test the supervisor.

If the actual target's pool-identity check has not been run, use the same
checksum-verified candidate ZIP for this independent probe in elevated PowerShell:

```powershell
& "$Pkg/tools/Test-IisIdentity.ps1" -HostZip $Archive -HarnessRoot C:/GolemAcceptance/golem-harness -Output C:/GolemAcceptance/results/iis-identity.json
```

This creates/removes its own temporary site/pool and private synthetic instance.
It is distinct from the HTTPS reverse-proxy check. Expected: probe.passed=true,
identity_type=ApplicationPoolIdentity, load_user_profile=false.

## 3. B: verify HTTPS and authorization

In PowerShell on B, enter the secrets without putting them in command history:

```powershell
$Pkg = 'C:/GolemAcceptance/chelm-host'
$Url = 'https://golem-test.example.org/mcp/app' # same hostname as A, /app suffix
$secret = Read-Host 'Worker secret from A' -AsSecureString
$env:ISSUE11_WORKER_TOKEN = ([pscredential]::new('token', $secret)).GetNetworkCredential().Password
$secret = Read-Host 'Denied secret from A' -AsSecureString
$env:ISSUE11_DENIED_TOKEN = ([pscredential]::new('token', $secret)).GetNetworkCredential().Password
node "$Pkg/tools/issue11-acceptance.mjs" probe --url $Url --token-env ISSUE11_WORKER_TOKEN --denied-token-env ISSUE11_DENIED_TOKEN --output C:/GolemAcceptance/results/connectivity-B.json
```

Expected: `ok:true`; invalid_token=401, denied_runtime=403, denied_origin=403,
discovery and authorized_read pass (at least 11 tools and three prompts). The tool
does not assign work. It records a hashed machine identifier, no token or content.
If it fails, keep its JSON: 502 suggests backend/proxy, certificate failures mean
trust/hostname problems, 401 a secret mismatch, 403 runtime/origin settings.

## 4. B: configure the real agent and capture tool timings

Use your client's existing inference login/configuration. Register the measured
stdio bridge, which forwards calls to A unchanged and records only tool names,
durations, outcome and JSON byte counts. For a Codex CLI exposing `mcp add`:

```powershell
codex --version
codex mcp add chelm-issue11 -- node "$Pkg/tools/acceptance-mcp.mjs" --url $Url --token-env ISSUE11_WORKER_TOKEN --report C:/GolemAcceptance/results/worker-tools.jsonl
```

This syntax was checked against local `codex mcp add --help` (0.172.0-alpha.2);
record your actual version. For another client use the equivalent stdio command
and args array. Credentials stay in the client process environment. Start the
client from this same PowerShell session so it inherits the worker token; verify
with discovery before work. If your client strips inherited environment variables,
configure its documented secret/environment mechanism, never paste a token into
the prompt or record it in the report. Native HTTP also works, but then collect
equivalent content-free timing/byte metadata from that client.

For a private certificate authority, set NODE_EXTRA_CA_CERTS on B to its public
PEM CA certificate before starting Node/the client. Never disable TLS verification.

Paste both `prompts/remote-worker-once.sudo.md` and
`prompts/issue11-acceptance.sudo.md` into the agent. Start with `cycle`, then
`validation_repair`, `service_restart`, `concurrent/integration`, `policy_change`,
and `bounded_loop`. The agent reports exactly what it observed; it does not tick
untested scenarios. The two initial notes describe missing integration evidence;
a correct result must not claim INT-11 passed or equate unit tests with integration.

### Scenarios and exact operator actions

| Scenario | What you do | Passing evidence |
|---|---|---|
| cycle + no_work | Ask agent to process the two synthetic notes, then request work again | Committed receipt, matching owner read view; then no-work/retry delay |
| validation_repair | Seed another source with --case validation_repair and wait 60 s. Agent stages a deliberately incorrect quote once; then corrects it using a higher output revision | Actual validation failure, corrected validation and committed receipt; no invented pass |
| service_restart | Seed a new source on A (below), wait 60 s, ask agent to claim/read then pause. Stop A's foreground service with Ctrl+C, restart the same command/environment, ask agent to resume | Same assignment/work identity or recovered receipt; no duplicate processing |
| lost_reply | After a successful submit, ask a fresh agent session to treat its outcome as unknown and obtain status before retrying exact submission | Same receipt/HEAD and one processed source. Label this **manual unknown-outcome replay**, not an actual dropped network packet; deterministic dropped-reply/process recovery is already vendor-tested |
| concurrent + integration | Seed two additional records, wait 60 s, request two max=1 assignments before either submits, using different request IDs. Finish one, then the second | Disjoint sources; second result may require integration. Read new attempt and regenerate every flagged summary before submitting; both analyses retained |
| policy_change | Seed a source, wait 60 s, claim/read/pause. On A commit the reviewed purpose change shown below. Ask agent to continue the old candidate | policy_changed/stale refusal; fresh analysis uses new guidance; stale draft never publishes |
| bounded_loop | Seed another source, wait 60 s, run at most two cycles and ten minutes | A completed cycle then no-work/clean stop; renewal if necessary, no busy polling |
| revocation | After work is settled, stop A, replace ISSUE11_WORKER_TOKEN with a new random secret, restart. B retains its old token and retries discovery | 401/refusal, no work or publication. Run this **last**, after other reports are saved |

Additional source command on A (do not shorten the ordinary age gate):

```powershell
node "$Pkg/tools/issue11-acceptance.mjs" seed --runtime $Runtime --case service_restart
# Other permitted cases: validation_repair, concurrent, policy_change, bounded_loop.
# Run concurrent twice before asking for the two assignments.
```

For the paused policy-change scenario, in a second terminal on A:

```powershell
'{"purpose":"ISSUE11 synthetic policy revision 2: retain exact source attribution and distinguish missing integration evidence."}' | Set-Content C:/GolemAcceptance/policy.json -Encoding Ascii
node "$Pkg/bin/chelm.mjs" profile set --runtime $Runtime --input C:/GolemAcceptance/policy.json
```

Fill `agent-report.json` using the template created on A under operator/ (copy the
template, not service.json or credentials, to B). Record actual client/model,
scenario pass/fail/not_run with work_id/attempt/receipt HEAD and
finding_review=pass/fail. For machine, use B's platform/OS/Node and the host_id
from connectivity-B.json. Provider model_ms/tokens/billed_cost/currency come only
from actual provider/client usage; leave unavailable values null. Wall time for
the whole session is not model inference time. Do not share chain-of-thought or
raw client transcripts. A failure/not_run report is useful and is not a pass.

## 5. A: collect owner evidence; return these files

After the agent has finished:

```powershell
node "$Pkg/tools/issue11-acceptance.mjs" collect --runtime $Runtime --output C:/GolemAcceptance/results/owner-A.json
```

Expected: processed count increases, committed receipts and corresponding HEAD,
recovery_required=false. The report includes numeric host phases and receipts;
it excludes input text, tokens, raw errors, server paths and staged candidates.
The `publication` phase is owner tree assembly through successful Git CAS,
excluding post-CAS receipt/read-view reconciliation. It is absent, not zero, when
no successful publication happened. Tool wall times include transport/server work;
do not add nested stages or equate them with inference.

Send these files back in this ChatGPT conversation (or attach one ZIP containing
only these files):

1. `connectivity-B.json` (also a post-restart probe if you ran it).
2. `owner-A.json`.
3. `worker-tools.jsonl` from B.
4. `agent-report.json`, with every scenario explicitly classified.
5. `deployment.txt` and, if run, `iis-identity.json`.

Do **not** include service.json, tokens, the runtime folder, provider credentials
or raw inference transcripts. I will check identity/version correspondence,
receipts/read views, negative authorization results, phase coverage, actual-model
results and explicit unknowns. Only then can the external acceptance boxes close.
Reference-workstation capacity issue #3 and consumer application acceptance E-4
are separate; neither is required just to test this isolated remote fixture.
