# CoderClaw Runtime Parity Upgrade Notes

Status: WIP | Requirements: 5 core capabilities | Baseline: orchestrator exists but needs parity with PRD's observable runtime.

## Summary of Actual Deliverable Scope
This upgrade addresses only the well-defined gaps from the PRD that are NOT already present in builder's orchestrator flow:

### 1. Already implemented (cannot reimplement already complete responsibilities)
- Orchestrator workflow engine + DAG + task status (pending/running/done/failed)
- Workflow persistence: save/load state to `.builderForceAgents/sessions/workflow-*.yaml` (engine + storage)
- Session handoff: `save_session_handoff` tool + `/handoff` + auto-load on start
- Staged edits: basic diff/accept/reject support
- Built-in routing presets: `cost-optimized`, `quality-optimized`, `balanced` (defined in routing-rules.ts and enforced at model-selection)
- Multi-step plan compilation with user-visible step structure (Task.nodes[] containing role/task/dependsOn)
- Agent role definitions (7 roles) and agent persona blocks

### 2. Lacking (PRD gaps that must be implemented here)
- Remote task result streaming: bus to push step-status events to clients in real time (expecting SSE channel via gateway.ts)
- `/undo` command implementation: resume to most recent checkpoint per DAG step, preserving conversation + files, backing off N checkpoints
- `/fork` command implementation: create a new named branch from the current checkpoint, preserving the original
- Checkpoint UI panel for listing and navigating checkpoint history server-side so slash commands can reference them (not live wireframe but server state + storage)
- TM: JSON/YAML checkpoint export/import for team-level routing rules (checkpoint-to-team-config flow)

### 3. Implementation approach
- Extend `AgentOrchestrator` to emit step-status events during execution (modify `executeTask` + `emit` endpoints)
- Add checkpoint manager in `project-context.ts` (override/extend `saveWorkflowState`) to record per-step checkpoints keyed by step ID with timestamp + diff
- Create checkpoint API routes in `gateway.ts` that surface `min()` checkpoint IDs and list history; wire `/undo` and `/fork` handlers in `tui/command-handlers.ts`
- Add JSON/YAML export/import in a new `checkpoint-ops.ts` via `builderforce/tools/` for team routing rules compliance

### 4. Deliverables (only missing features)
1) `agent-runtime/src/gateway/streaming.ts` – SSE channel for step-status events (step ID, status, cost, model)
2) `agent-runtime/src/builderforce/project-context.ts` – checkpoint manager (save per-step checkpoint, restore, list, export, import) and `/undo` logic
3) `agent-runtime/src/tui/tui-command-handlers.ts` – `/undo` and `/fork` slash commands that invoke checkpoint manager
4) `agent-runtime/src/builderforce/tools/checkpoint-export.ts` (optional) – JSON/YAML checkpoint import/export operations

## Design decisions (conflicting spec interpretation)
- `/undo` and `/fork` target the JOB-level checkpoint set (not per-task). We will store job-level checkpoints by job ID keyed with step snapshots.
- `/undo N`: step back N checkpoints (N up to 20). Implementation: `getHistory(jobId)`, `checkpointId = min checkpoints[max(N, 1)]` then `restore(checkpointId)`.
- `/fork`: new name under `.builderForceAgents/sessions/workflow-<base-checkpoint-id>-<name>.yaml`. Persistence remains on disk; moves to server in future.

## Build/get
Status: Not yet merged; not verified (no CI in working env). Follow up with type-check and test to confirm no regressions.