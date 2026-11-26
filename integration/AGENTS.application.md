Provider runtimes (config 3): use `chelm_memory_*` MCP tools or `chelm memory-worker`, worker contract 3 and `prompts/memory-worker-once.sudo.md`. Stage only semantic `changes.json`; no graph editing. See docs/MEMORY_PROVIDERS.md. The legacy file-worker procedure below applies only to config-2 runtimes.

<!-- chelm-host:begin -->
Read vendor/chelm-host/AGENTS.md before Golem operations.
Use local CLI/stdio workers or the authenticated remote MCP worker contract v2.
Remote setup and SudoLang prompts: vendor/chelm-host/docs/REMOTE_WORKERS.md. Keep runtime data outside version control.
<!-- chelm-host:end -->

For explicit memory-backed cognitive tasks, use Chelm's task API and the
cognitive-worker contract (docs/COGNITIVE_TASKS.md). Preserve retrieval-only ask
semantics. Negotiate capabilities against the selected approved Harness package and its feature scope. Never approve a model's learning/collection proposal merely because
it was generated. Existing application policy may authorize reviewed learning.
