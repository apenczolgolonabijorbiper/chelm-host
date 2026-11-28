# HTTPS reverse-proxy acceptance

fixture(url, backendPort, verifiedHarness):
  require credential-free HTTPS /mcp URL; explicit unused loopback backend port
  create new disposable sandbox runtime; never accept an existing runtime path
  seed synthetic observation, random token and output canaries
  start production backend in production HTTPS mode, bound only to 127.0.0.1
  trust proxy certificate normally, including hostname; never disable TLS checks
  assert protected-resource discovery and unauthenticated 401 challenge
  assert forwarded user identity cannot authenticate
  assert wrong token, cross-runtime and denied Origin refuse
  assert malformed JSON, >256KiB request and unknown RPC return expected errors
  use pinned official SDK: initialize, worker discovery, tools/call
  claim assignment, read canary observation, upload bounded output
  close connection; reconnect; assert same work/attempt remains staging
  explicitly abandon; never infer abandonment from connection closure
  assert service logs/diagnostics contain actual operations and no private canaries
  report hashes, versions, named checks and synthetic/auth/inference limitations
  finally close clients/backend and remove own fixture

IIS_fixture(packagedHost, verifiedHarness, DisposableServer):
  require administrator and explicit disposable-server selection
  optionally install IIS and authentic Microsoft-signed URL Rewrite/ARR MSIs
  save server-wide ARR settings; enable proxy, preserve Host, timeout 180s
  extract package and restore locked dependencies
  create loopback-only HTTPS site and fresh one-day certificate
  restrict rewrite to /mcp[/...] and protected-resource metadata
  pass backend JSON/errors/challenges through; outer body ceiling 264KiB
  W3C logs: dates, method, stem, status, duration only; no custom fields/tracing
  run fixture with certificate in child NODE_EXTRA_CA_CERTS only
  flush actual IIS access logs; require successful MCP and 401 rows
  refuse log canaries and unsafe field names; retain content-free report
  finally restore ARR settings/environment; remove site/pool/TLS binding/cert/files
  installed prerequisites remain; never run against an existing production site

evidence:
  TLS fixture != observed hosted IIS run != owner's external deployment acceptance
  controlled tokens != actual OAuth issuer/renewal or arbitrary IDE support
