# SaveLocalSession

Read docs/LOCAL_SESSIONS.md LCS-1..LCS-5;
Require no active/expired unresolved assignments, processing leases, recovery or local committed-file drafts;
Never cancel work or edit protocol files merely to export;
Persist stable submission_id and the exact covered durable request_ids;
Call session save with {submission_id, request_ids, projection};
Require checkpoint generation/base binding, immutable upload validation and fenced head receipt;
On unknown response keep checkpoint-pending; retry same submission or session recover before a different save;
Never claim saved/completed from local Git, a worker receipt or uploaded object alone;
Treat newly arrived input as separately queued; do not replace durable intake with a checkpoint projection;
Report durably-saved only with the original authoritative receipt;
