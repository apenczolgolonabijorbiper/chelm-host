# Authenticated MCP through an HTTPS reverse proxy

Issue #7 already has an authenticated Streamable HTTP worker endpoint. The
remaining gate is the HTTPS reverse proxy and its logs. There are three distinct
levels of evidence:

| Check | What it establishes |
|---|---|
| `tests/https-proxy.test.mjs` | A real TLS proxy and pinned official SDK exercise the production backend with normal certificate and hostname checks against a fixture CA. Runs in the normal staged suite. |
| `tools/Test-IisHttpsProxy.ps1` | The packaged backend works through real IIS HTTPS, ARR and URL Rewrite on an isolated Windows server; actual W3C access logs are inspected. Runs once in the Node 24 Windows CI job, as soon as the Linux package is available. |
| E-1 in [EXTERNAL_ACCEPTANCE.md](EXTERNAL_ACCEPTANCE.md) | The owner's deployed service, certificate, firewall, DNS and client/issuer registration work from another machine. Requires that deployment. |

The automated fixture uses controlled worker tokens from an in-memory environment
map and a disposable runtime. It tests metadata and the 401 authorization
challenge, ignored forwarded identity headers, wrong credentials, cross-runtime
refusal, allowed/denied origins, malformed JSON, request limits, JSON-RPC errors,
worker tools/prompts discovery, assignment, observation read, output upload,
reconnect with the same durable assignment and explicit abandonment. It does not
perform inference, validate a cognitive candidate or publish a memory change.

Service diagnostics and operation logs must exclude random credential,
observation and uploaded-text canaries. The IIS fixture flushes and checks real
access logs, requires both successful MCP calls and 401 entries, and checks that
private canaries are absent. Its W3C fields omit query strings, headers, cookies,
user agents and referrers. Failed-request tracing and inherited custom log fields
are disabled for the disposable site. Retain that policy for the deployed site;
other proxy/debug/APM tooling needs the same redaction policy.

## Run the IIS check

Use an elevated Windows PowerShell session on a disposable Windows Server 2022
test server with Node >=22.12, Python >=3.12 and Git available. Use the verified
host ZIP and extracted reference Harness 0.13.0 release:

```powershell
./tools/Test-IisHttpsProxy.ps1 -HostZip ./dist/chelm-host-1.4.0.zip `
  -HarnessRoot ../harness-release -Output ./dist/windows/iis-https-proxy.json `
  -InstallPrerequisites -DisposableServer
```

`-InstallPrerequisites` installs IIS and, if missing, the Microsoft-signed x64
URL Rewrite/ARR MSIs linked by the official
[URL Rewrite](https://www.iis.net/downloads/microsoft/url-rewrite) and
[ARR](https://www.iis.net/downloads/microsoft/application-request-routing) pages.
Those prerequisites remain installed. Omit the switch if already provisioned.
The test temporarily changes server-wide ARR settings, so it refuses execution
without `-DisposableServer`; use E-1 for an existing production deployment.
It restores the previous ARR values and removes its site, pool, TLS binding,
certificate, package and synthetic runtime in `finally`.

HTTPS and backend ports bind only to 127.0.0.1. A fresh one-day self-signed
certificate is trusted only by the Node acceptance process through
`NODE_EXTRA_CA_CERTS`; the OS root store and global TLS verification are unchanged.
No worker token is written into service configuration or command arguments.
The backend does not authorize any forwarded user/header identity. An external
issuer still requires independently tested JWT issuance, client registration and
renewal; no arbitrary IDE OAuth support is claimed.

The IIS outer request ceiling is 264 KiB; the backend enforces 256 KiB and each
output chunk is limited to 32 KiB. The small outer margin lets the fixture verify
the backend's 413 response through IIS. ARR preserves Host, Authorization,
Content-Type, Accept, Origin and MCP headers; backend origin/host policy remains
active. The proxy timeout is 180 seconds, with the backend's existing request and
header timeouts unchanged. IIS passes backend errors through without replacing
their JSON or authentication challenge.

The JSON report records Windows/Node versions, tested archive and package
manifest hashes, individual checks and explicit limits of the evidence. No
success report is produced when setup or a check fails. CI uploads this report
with the other Windows evidence. A configured workflow is not observed acceptance;
record the actual run and result before marking the gate complete.

For an already provisioned isolated TLS proxy, the transport fixture can also run
directly (the selected backend port must route to this new test process):

```powershell
node tools/https-proxy-acceptance.mjs --url https://test.example/mcp `
  --backend-port 4317 --harness ../harness-release --output ./dist/https-proxy.json
```

This creates its own new synthetic runtime and never accepts a consuming runtime
path. Use `tools/probe-remote.mjs` for read-only inspection of a live deployment.
