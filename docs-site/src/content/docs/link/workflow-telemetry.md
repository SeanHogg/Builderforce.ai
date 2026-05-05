---
title: Workflow Telemetry
description: How CoderClaw records and forwards workflow spans — locally as JSONL and live to the Builderforce portal
---

# Workflow Telemetry

CoderClaw records structured telemetry for every workflow execution. Spans are written locally as JSONL and, when a Builderforce connection is configured, forwarded to the portal in real time so you can monitor workflows without touching the machine running the agent.

---

## Local JSONL files

Spans are appended to daily files under `.coderClaw/telemetry/`:

```
.coderClaw/
  telemetry/
    2026-03-21.jsonl
    2026-03-20.jsonl
```

Each line is a complete JSON span object. Files rotate at midnight (local time) and are never auto-deleted — prune them manually if disk space is a concern.

### Span schema

```json
{
  "spanId": "wf_a1b2c3",
  "workflowId": "orchestration-20260321-095412",
  "kind": "workflow.start",
  "timestamp": "2026-03-21T09:54:12.000Z",
  "data": {
    "workflowType": "planning",
    "stepCount": 4,
    "projectRoot": "/home/sean/projects/builderforce"
  }
}
```

### Span kinds

| Kind | When emitted | Key `data` fields |
|------|-------------|-------------------|
| `workflow.start` | Orchestration begins | `workflowType`, `stepCount`, `projectRoot` |
| `workflow.complete` | All steps finished successfully | `stepCount`, `durationMs` |
| `workflow.fail` | Orchestration aborted due to error | `error`, `failedStep` |
| `task.start` | An individual workflow step begins | `role`, `description`, `stepIndex` |
| `task.complete` | A step finishes successfully | `role`, `durationMs`, `tokenUsage` |
| `task.fail` | A step errors or is rejected | `role`, `error` |

---

## Querying spans locally

Because each line is valid JSON, standard Unix tools work:

```bash
# All failed tasks today
jq 'select(.kind == "task.fail")' .coderClaw/telemetry/$(date +%Y-%m-%d).jsonl

# Workflow durations (completed workflows only)
jq 'select(.kind == "workflow.complete") | {id: .workflowId, ms: .data.durationMs}' \
  .coderClaw/telemetry/*.jsonl

# Count spans by kind
jq -r '.kind' .coderClaw/telemetry/*.jsonl | sort | uniq -c | sort -rn
```

---

## Builderforce portal sync

When CoderClaw starts with a Builderforce connection configured (`CODERCLAW_LINK_URL` + `CODERCLAW_LINK_API_KEY`), telemetry is forwarded live to the portal:

| Span kind | Portal action |
|-----------|---------------|
| `workflow.start` | Creates a new workflow record (`POST /api/workflows`) |
| `workflow.complete` / `workflow.fail` | Updates workflow status (`PATCH /api/workflows/:id`) |
| `task.start` | Adds a task row to the workflow (`POST /api/workflows/:id/tasks` with `status: "running"`) |
| `task.complete` / `task.fail` | Updates the task row status |

Sync is **fire-and-forget** — a network failure does not block the running workflow. The local JSONL file is always the authoritative record.

### Viewing telemetry in the portal

Navigate to [Workflows](/link/multi-agent-orchestration/) in the Builderforce portal to see live and historical workflow runs. Each workflow shows:

- Status and duration
- Per-step status, role, and timing
- Any error message from a failed step

The tool audit log (separate from workflow telemetry) records every individual tool call made by an agent. Find it under the claw detail panel → **Tool Audit** tab.

---

## Configuration

No extra configuration is needed beyond the standard Builderforce connection:

```bash
export CODERCLAW_LINK_URL=https://api.builderforce.ai
export CODERCLAW_LINK_API_KEY=<your-claw-api-key>
coderclaw start
```

To disable local JSONL writing (not recommended — it is the ground truth):

```bash
export CODERCLAW_TELEMETRY_DISABLED=1
```

---

## Troubleshooting

**Spans appear in JSONL but not in the portal**

- Check that `CODERCLAW_LINK_URL` and `CODERCLAW_LINK_API_KEY` are set and correct.
- The claw must be registered in the portal before telemetry is accepted. Register at [Dashboard](/link/getting-started/) → Add Claw.
- Network errors are logged at `warn` level — check `coderclaw logs` for `[telemetry]` entries.

**Workflow shows as `in_progress` in the portal but the claw is done**

- A `workflow.complete` or `workflow.fail` span may have failed to sync. Re-running the workflow will create a new record; the stale one can be manually closed via `PATCH /api/workflows/:id`.
