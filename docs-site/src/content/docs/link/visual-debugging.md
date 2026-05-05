---
title: Visual Debugging
description: Timeline, list, and graph views for execution debugging
---

# Visual Debugging & Execution Timeline

builderforce.ai provides a multi-view **visual debugger** that lets you see exactly what a claw (and any sub-agents it delegates to) did during an execution — without reading raw log output.

## Overview

Three complementary views are available wherever execution history is shown:

| View | Description |
|------|-------------|
| **⏱ Timeline** | Horizontal swimlane chart showing each tool call and workflow task on a shared time axis |
| **☰ List** | Flat, chronological list of every recorded event with timestamps and durations |
| **🔗 Graph** | Dependency graph of workflow tasks — shows which sub-agent depended on which |

You can access these views in three places:

1. **Logs → Visual Timeline tab** — tenant-wide view across all claws
2. **Project workspace → Timeline tab** — scoped to the project's assigned claw(s)
3. **Task drawer → Timeline tab** — scoped to the claw assigned to that specific task

---

## Timeline view

The timeline view renders an SVG swimlane chart:

```
Tool/Task label  |──────────────────────────────────────| time axis
bash_command     |▓▓▓▓                                  | 120ms
read_file        |    ▓▓                                 | 40ms
write_file       |      ▓▓▓▓▓▓                           | 200ms
sub-agent: plan  |            ▓▓▓▓▓▓▓▓▓▓                 | 800ms (running)
```

- Each **bar** represents a single tool call or workflow task
- **Colour** encodes status: green = completed, blue = running, red = failed, purple = tool call
- **Hovering** over a bar shows the full tool name, start/end time, duration, and argument preview
- The time axis is labelled in wall-clock time (HH:MM:SS)

---

## List view

The list view provides a scannable, flat log of events:

```
● bash_command     12:01:04 → 12:01:04 (120ms)   {"command":"npm install"}
● read_file        12:01:05 → 12:01:05 (40ms)    {"path":"/app/package.json"}
● write_file       12:01:06 → 12:01:07 (200ms)   {"path":"/app/README.md"}
```

Use the **List** tab for quick copy-pasteable output or when scripting audit checks.

---

## Graph view

The graph view renders workflow tasks as **nodes** with directed edges showing `dependsOn` relationships between sub-agents.

- Nodes are coloured by task status
- Edge arrows show execution order / dependency direction
- Useful for understanding multi-agent orchestrations registered via the `/api/workflows` endpoint

---

## Data sources

Visual debugging is powered by two data sources:

### Tool audit events

Every tool call a claw makes is optionally posted to the API:

```http
POST /api/claws/:id/tool-audit?key=<clawApiKey>
Content-Type: application/json

{
  "toolName": "bash_command",
  "runId": "run-abc123",
  "sessionKey": "sess-xyz",
  "args": { "command": "npm install" },
  "durationMs": 120,
  "ts": "2026-03-01T12:01:04Z"
}
```

The portal fetches them back via:

```http
GET /api/claws/:id/tool-audit?runId=run-abc123&limit=200
```

See [API Reference](/link/api-reference/) for full parameter documentation.

### Workflows & workflow tasks

For structured multi-step plans, claws register a workflow and then push task updates:

```http
POST /api/workflows            # register a workflow
PATCH /api/workflows/:id/tasks/:tid  # update task state (running, completed, failed)
```

See [Multi-Agent Orchestration](/link/multi-agent-orchestration/) for details on multi-agent workflow patterns.

---

## Gap analysis & future work

The current implementation covers:

- ✅ Timeline view for tool calls (requires claw to push tool-audit events)
- ✅ Dependency graph for workflow tasks
- ✅ Flat chronological list view
- ✅ Project-level and task-level scoping

Known gaps that require claw-side implementation:

- **Correlation IDs**: claws should attach a `runId` matching the execution ID so timeline events are automatically scoped per execution run
- **Streaming updates**: the timeline currently requires a manual refresh; real-time push via the WebSocket gateway would allow the timeline to update live while a claw runs
- **Sub-agent correlation**: when a claw delegates to another claw, the delegated claw's tool events should carry the parent `runId` for a unified view

---

## Related documentation

- [Architecture](/link/architecture/) — system design overview
- [API Reference](/link/api-reference/) — full endpoint list
- [Multi-Agent Orchestration](/link/multi-agent-orchestration/) — workflow patterns
