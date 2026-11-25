# StopLocalSession

Read docs/LOCAL_SESSIONS.md;
Stop new claims and settle active work with its normal contract;
Recover any pending submission; checkpoint completed local work that must survive workspace loss;
Call session stop to revoke publishing authority; keep the local copy only when explicitly retained;
Report stopped, selected durable revision, and any local-only/pending work separately;
Never equate releasing a session with a full data reset or physical deletion of detached copies;
