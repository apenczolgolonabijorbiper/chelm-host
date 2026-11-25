# RunLocalSession

Read AGENTS.md, docs/LOCAL_SESSIONS.md;
Require authenticated durable intake persisted before processing any request/evidence;
Read session status; acquire/renew one authorized generation/base/fence;
Choose existing memory-worker contract 3 for config-3, worker for config-2,
  or cognitive-worker for a task; follow that contract and bounded full-source reads;
Use the actual available language model for semantic work; record requested/observed model and unknown settings honestly;
Never substitute a deterministic fixture for observed model acceptance;
Use stable input/task IDs on replay; reconcile uncertain external collection before repeating effects;
After local receipts, mark local-committed; never acknowledge durable completion until checkpoint receipt;
Run the checkpoint prompt at a settled boundary; renew before expiry;
On fence/reset/expired authority stop publishing, retain uncertainty, reconnect explicitly;
