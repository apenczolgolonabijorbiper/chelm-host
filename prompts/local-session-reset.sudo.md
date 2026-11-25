# ResetLocalSession

Require explicit user/application full-reset authorization; read docs/LOCAL_SESSIONS.md LCS-5;
Call session reset --apply with a stable reset_id;
Fence/cancel publishing authority and increment generation before deleting content;
Clear durable head/intake/projections/receipts; sweep every controlled checkpoint/upload version;
Delete reachable owned local runtime/checkpoint copies, acknowledge their cleanup;
Report unknown uploads as cleanup_pending until definitively settled;
Report detached copies pending-unreachable until confirmed; never claim physical erasure of inaccessible environments;
Verify late worker publication/renewal/import from the old generation refuses;
Initialize the new generation explicitly; never resurrect an old checkpoint automatically;
