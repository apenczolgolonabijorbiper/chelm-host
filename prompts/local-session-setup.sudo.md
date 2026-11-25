# SetupLocalSession

Inputs { privateRuntime; exactChelmPackage; exactHarnessPackage; appStoreBinding; sessionId; }
Read AGENTS.md, docs/LOCAL_SESSIONS.md, docs/LOCAL_SESSION_SPEC.sudo.md;
Verify exact packages and Node/Python/Git; keep packages and application source outside privateRuntime;
Require actual authenticated appStoreBinding available through a tested narrow HTTP/file tool or Site MCP;
Never infer route access from a browser login or deployment; never print/save credentials in source/checkpoints;
Initialize first runtime with CLI init; bind trusted runtime ID and exact package identities in the application store;
Call session initialize then session connect with stable session_id;
For an existing durable head use the reconnect prompt instead of initializing blank knowledge;
Report ready only after authoritative base/session acquisition; report unavailable bindings honestly;
Keep inference external; do not require a GitHub memory remote/token, permanent owner service or distributed MCP;
