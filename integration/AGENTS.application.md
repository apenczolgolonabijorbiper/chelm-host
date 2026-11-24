<!-- chelm-host:begin -->
Read vendor/chelm-host/AGENTS.md before Golem operations.
Use local CLI/stdio workers or the authenticated remote MCP worker contract v2.
Remote setup and SudoLang prompts: vendor/chelm-host/docs/REMOTE_WORKERS.md. Keep runtime data outside version control.
<!-- chelm-host:end -->

For explicit memory-backed cognitive tasks, use Chelm's task API and the
cognitive-worker contract (docs/COGNITIVE_TASKS.md). Preserve retrieval-only ask
semantics. Negotiate capabilities against the supported Harness 0.12.0 package. Never approve a model's learning/collection proposal merely because
it was generated. Existing application policy may authorize reviewed learning.
