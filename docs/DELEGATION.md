# Shared-folder delegation retired in Chelm 1.0

The offer/take/return/adopt interface and shared-folder package transport are removed.
Use [remote MCP workers](REMOTE_WORKERS.md) and [worker contract v2](REMOTE_WORKER_CONTRACT.md).

Settle old results with Chelm 0.2 or explicitly cancel/archive them during cutover.
The new host does not import legacy packages through its network tools.
The old design specification is historical background, not current setup instructions.
