<!-- chelm-host:begin -->
Read vendor/chelm-host/AGENTS.md before Golem operations.
Use local CLI/stdio workers or the authenticated remote MCP worker contract v2.
Remote setup and SudoLang prompts: vendor/chelm-host/docs/REMOTE_WORKERS.md. Keep runtime data outside version control.
<!-- chelm-host:end -->

For explicit memory-backed cognitive tasks, use Chelm's task API and the
cognitive-worker contract (docs/COGNITIVE_TASKS.md). Preserve retrieval-only ask
semantics. Check capability availability; supported Harness 0.11.0 cannot execute
these tasks. Never approve a model's learning/collection proposal merely because
it was generated. Existing application policy may authorize reviewed learning.
