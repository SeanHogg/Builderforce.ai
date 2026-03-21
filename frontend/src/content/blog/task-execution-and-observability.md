---
title: Task Execution and the Observability Portal
date: 2026-03-11
description: How Builderforce tracks every task from creation through execution to completion — the task model, execution lifecycle, workflow telemetry, and how to use the portal's timeline and dashboard to understand what your agents are doing.
tags: [tasks, execution, observability, telemetry, timeline, workflows]
author: Sean Hogg
---

# Task Execution and the Observability Portal

When an AI agent runs a task, a lot happens. It plans, it calls tools, it writes files, it delegates to other agents, it reports back. Knowing *what* happened, *when*, *which agent* did it, and *whether it succeeded* is the difference between a system you trust and one you fear.

Builderforce gives you that visibility through a layered stack: **tasks**, **executions**, **workflow telemetry**, and the **real-time portal timeline**. This post walks through each layer.

---

## The Data Model

Understanding what Builderforce tracks means understanding four related concepts:

| Concept | What it represents |
|---|---|
| **Task** | A unit of work defined in a project (a backlog item, a feature, a bug fix) |
| **Execution** | A specific attempt to run that task on a specific CoderClaw instance |
| **Workflow** | A structured multi-step orchestration that a CoderClaw agent executes to complete a task |
| **Workflow task** | An individual step within a workflow (e.g. the "coder" step or the "reviewer" step) |

A single **task** can have multiple **executions** over time (retries, re-runs). Each execution is associated with exactly one **workflow** when the CoderClaw orchestrator runs a DAG to complete it.

---

## Task Lifecycle

Tasks move through a defined status progression:

```
backlog → todo → ready → in_progress → in_review → done
                                   └─► blocked
```

You manage tasks from the [Tasks](/tasks) page. Each task records:

- **Priority** (`low`, `medium`, `high`, `urgent`) — determines whether an approval gate fires automatically
- **Assigned claw** — which CoderClaw instance should execute it
- **Persona** — which agent role should lead execution
- **GitHub PR URL** — linked automatically once a claw creates a pull request

---

## Execution Lifecycle

When a task is submitted for execution (via `POST /api/runtime/executions` or via portal dispatch), an **execution record** is created and a `task.assign` event is dispatched to the claw via the relay.

The execution follows this state machine:

```
pending → submitted → running → completed
                    └─► failed
                    └─► cancelled
```

The claw reports each transition back to Builderforce automatically:

- **running** — reported the moment the agent receives the task and starts processing
- **completed** — reported when the agent's chat session produces a final response
- **failed** — reported when the session ends with an error

You can watch these transitions in real time on the [Timeline](/timeline) page — the execution card updates live as the claw reports status.

---

## Workflow Telemetry

When CoderClaw runs an orchestrated workflow to complete a task, it emits **structured telemetry spans** — one per workflow and one per task step. These spans appear in two places:

### 1. Local JSONL (on the claw)

```bash
# Every span is written locally on the claw
cat .coderClaw/telemetry/2026-03-11.jsonl | jq .

# Find slow tasks
cat .coderClaw/telemetry/2026-03-11.jsonl | \
  jq 'select(.kind == "task.complete") | {role: .agentRole, ms: .durationMs}' | \
  sort -t: -k2 -n
```

### 2. Builderforce Portal (real time)

The same spans are forwarded to the portal as they are emitted:

- `workflow.start` → creates a workflow record on the [Workflows](/workflows) page
- `task.start` → adds a task step with `status: running`
- `task.complete` / `task.fail` → patches the step with final status and duration
- `workflow.complete` / `workflow.fail` → closes the workflow record

This means the Workflows page is a **live view** of what every connected claw is doing right now. No manual querying required.

---

## The Workflows Page

Navigate to [/workflows](/workflows) to see all workflows across your fleet.

You can filter by:

- **Status** — running, completed, failed, pending
- **Workflow type** — feature, bugfix, refactor, planning, adversarial, custom
- **Claw** — filter to a specific machine

Each workflow entry expands to show its task DAG — individual steps with agent role, description, duration, and status. Failed steps show the error message inline.

---

## The Execution Dashboard

[/observability](/observability) (or the dashboard link from any project page) shows aggregated stats:

| Metric | What it measures |
|---|---|
| Total executions | All runs in the selected time window |
| Completed | Successfully finished runs |
| Failed | Runs that ended in error |
| Running | Currently active |
| Avg duration | Mean execution time (completed runs only) |
| Token usage | Total tokens consumed across all executions |

The dashboard breaks down by project, by claw, and by agent role so you can see which parts of your system consume the most resources or fail most often.

---

## Tool Audit Events

Every tool call an agent makes is recorded in the **tool audit log** — searchable from [Logs](/logs):

```
timestamp   | claw     | tool         | duration | status
2026-03-11T | claw-7   | read_file    | 42ms     | success
2026-03-11T | claw-7   | bash         | 1.2s     | success
2026-03-11T | claw-7   | write_file   | 38ms     | success
2026-03-11T | claw-7   | bash         | 3.4s     | error
```

Each event includes the full input arguments and result, so you can trace exactly what the agent did at each step. This is the deepest debugging layer — when an execution fails, the tool audit log tells you which specific tool call caused it.

---

## Real-Time Execution Streaming

For executions that matter right now, you can subscribe to live updates via the WebSocket stream at `GET /api/runtime/executions/:id/stream`. This is what the portal's live execution card uses under the hood — each status transition and telemetry event is pushed the moment it arrives from the claw.

The stream delivers:

- `status_change` events as the execution moves through states
- `done` events when execution completes or fails
- Token usage snapshots from the running session

---

## Specs: Where Execution Starts

The highest-level planning primitive on Builderforce is the **spec** — a structured planning document that lives at [/tasks](/tasks) in the planning panel.

A spec progresses through:

```
draft → reviewed → approved → in_progress → done
```

Each spec contains:

- **Goal** — the plain-English objective
- **PRD** — the product requirements document (written with AI assistance from [Brainstorm](/brainstorm))
- **Architecture spec** — technical design, generated or edited
- **Task list** — a JSON array of tasks derived from the spec, ready to be created in the task board

When a spec moves to `approved`, the task list becomes a set of executable tasks. From there, the execution lifecycle above takes over.

---

## Best Practices

**Assign claws to tasks explicitly** when you have a fleet. An unassigned task broadcasts to all connected claws — fine for exploration, but noisy in production. Pin tasks to the claw with the right workspace and model.

**Use workflow types intentionally.** A `bugfix` workflow routes through bug-analyzer → coder → test-generator. A `feature` workflow goes planner → architect → coder → reviewer → tester. Choosing the right type means the right agent roles are invoked in the right order without custom orchestration.

**Check the audit log first when debugging.** Before re-running a failed execution, look at the tool audit events for that execution. Usually the failure is a single tool call — a bash command that returned a non-zero exit code, or a file write that hit a permission error.

---

## Next Steps

- View your current executions on [Timeline](/timeline)
- Review pending approvals for high-priority tasks on [Approvals](/approvals)
- Explore the [Workflows](/workflows) page to see what your claws are orchestrating right now
- Read [Approval Gates and Human Oversight](/blog/approval-gates-and-human-oversight) for how to gate high-risk execution steps
