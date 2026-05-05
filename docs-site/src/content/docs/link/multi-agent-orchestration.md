---
title: Multi-Agent Orchestration
description: Register claws, route tasks, delegate between agents, and use human-in-the-loop approvals
---

# Multi-Agent Orchestration with coderClaw.ai

This guide explains how to design, register, and coordinate multiple AI agents (Claws) using Builderforce. It covers agent registration, skill assignment, execution routing, claw-to-claw delegation, and the human-in-the-loop approval workflow.

---

## 1. What is a Claw?

A **Claw** is a registered instance of the [coderClaw](https://github.com/SeanHogg/coderClaw) agent runtime. Each Claw:

- Belongs to exactly one tenant
- Has a unique API key for authentication
- Declares **capabilities** (e.g. `["typescript", "testing", "refactor"]`)
- Exposes a **persistent WebSocket connection** to the Builderforce relay
- Can be assigned **marketplace skills** at the tenant level or claw level

Multiple Claws in the same tenant form a **mesh** — they can discover each other and delegate tasks bidirectionally.

---

## 2. Agent Roles

coderClaw supports seven built-in agent roles that map to common software engineering activities:

| Role | Responsibility |
|------|---------------|
| **Code Creator** | Generates new files, modules, and features from specs |
| **Code Reviewer** | Analyses PRs and changed files, posts structured feedback |
| **Test Generator** | Writes unit, integration, and e2e tests for changed code |
| **Bug Analyzer** | Diagnoses failures, reads stack traces, proposes fixes |
| **Refactor Agent** | Improves code structure without changing behaviour |
| **Documentation Agent** | Writes JSDoc, README, and architecture docs |
| **Architecture Advisor** | Evaluates design decisions, suggests structural improvements |

Custom roles can be created with arbitrary names and capability sets.

---

## 3. Registering Claws

### Via the portal

1. Navigate to **Claws** in the sidebar
2. Click **Register claw**
3. Enter a name (e.g. `prod-claw-01`) and confirm
4. Copy the generated API key — store it securely, it is shown once

### Via the API

```http
POST /api/claws
Authorization: Bearer <user-jwt>
Content-Type: application/json

{
  "name": "prod-claw-01",
  "tenantId": 42
}
```

**Response:**
```json
{
  "claw": {
    "id": 7,
    "name": "prod-claw-01",
    "apiKey": "clw_abc...xyz",
    "tenantId": 42
  }
}
```

### Connecting the coderClaw runtime

In your coderClaw project:

```bash
coderclaw config set portal.url https://api.builderforce.ai
coderclaw config set portal.clawId 7
coderclaw config set portal.apiKey clw_abc...xyz
```

The runtime opens a WebSocket to `wss://api.builderforce.ai/api/relay/7?key=clw_abc...xyz` and announces itself as online.

---

## 4. Skill Assignment and Capability Routing

### Installing skills

Install a skill from the marketplace at the tenant level (all claws inherit):

```http
POST /api/skill-assignments/tenant
Authorization: Bearer <user-jwt>

{ "slug": "ts-linter" }
```

Or scope it to one claw:

```http
POST /api/skill-assignments/claws/7
Authorization: Bearer <user-jwt>

{ "slug": "pr-reviewer" }
```

### Declaring capabilities

Claws declare capabilities as a JSON array. The fleet router uses these to match incoming tasks:

```http
PATCH /api/claws/7/capabilities
Authorization: Bearer <user-jwt>

{ "capabilities": ["typescript", "eslint", "pr-review", "react"] }
```

### Capability-based routing

When you need a claw with specific capabilities — without knowing which claw that is:

```http
GET /api/claws/fleet/route?requires=typescript,pr-review
Authorization: Bearer <user-jwt>
```

**Response:**
```json
{
  "claw": { "id": 7, "name": "prod-claw-01", "capabilities": ["typescript", "eslint", "pr-review", "react"] }
}
```

The runtime also uses this endpoint via the `claw_fleet` tool to route remote task delegations.

---

## 5. Submitting Tasks for Execution

An **execution** binds a task to a claw and tracks the full lifecycle.

```http
POST /api/runtime/executions
Authorization: Bearer <user-jwt>
Content-Type: application/json

{
  "taskId": "task_abc123",
  "clawId": 7
}
```

**Response:**
```json
{
  "execution": {
    "id": "exec_xyz",
    "taskId": "task_abc123",
    "clawId": 7,
    "status": "submitted",
    "createdAt": "2026-03-04T13:21:43Z"
  }
}
```

Builderforce forwards a relay frame to the target claw over its WebSocket connection. The claw begins processing the task immediately.

---

## 6. Execution Lifecycle

```
PENDING
  │
  ▼  (execution submitted, claw notified)
SUBMITTED
  │
  ▼  (claw acknowledges, begins work)
RUNNING
  │
  ├──▶ COMPLETED  (claw calls PATCH /state with status: "completed")
  │
  └──▶ FAILED     (claw calls PATCH /state with status: "failed")

Any state ──▶ CANCELLED  (user calls POST /cancel)
```

### Claw state callback

When a claw finishes a task it calls:

```http
PATCH /api/runtime/executions/exec_xyz/state
X-Claw-Id: 7
X-Claw-Key: clw_abc...xyz
Content-Type: application/json

{
  "status": "completed",
  "codeChanges": {
    "filesChanged": ["src/auth.ts", "src/auth.test.ts"],
    "linesAdded": 120,
    "linesRemoved": 18,
    "summary": "Added JWT refresh token rotation"
  }
}
```

The `codeChanges` object is stored in the execution record and surfaced in **Project Insights**.

---

## 7. Real-Time Streaming

Poll the execution state:
```http
GET /api/runtime/executions/exec_xyz
```

Or upgrade to WebSocket for zero-latency updates:
```
GET wss://api.builderforce.ai/api/runtime/executions/exec_xyz/stream
Authorization: Bearer <user-jwt>
```

Frame types:
```json
{ "type": "status_change", "status": "running" }
{ "type": "status_change", "status": "completed" }
{ "type": "done", "execution": { ...full execution... } }
```

The connection closes automatically when the execution reaches `completed`, `failed`, or `cancelled`.

---

## 8. Claw-to-Claw Delegation

Claws can delegate subtasks to other claws in the same tenant. This is how parallel multi-agent pipelines work.

### From within a claw (using the `claw_fleet` tool)

The coderClaw runtime's `claw_fleet` tool calls:

```http
GET /api/claws/fleet?from=7&key=clw_abc...xyz
```

This returns all claws in the tenant. The source claw picks the best match and sends:

```http
POST /api/claws/9/forward?key=clw_abc...xyz
Content-Type: application/json

{
  "type": "remote.task",
  "correlationId": "corr_uuid_here",
  "task": "Run ESLint on src/auth.ts and return the findings as JSON"
}
```

**Response:**
```json
{ "ok": true, "delivered": true, "correlationId": "corr_uuid_here" }
```

### Result delivery

When claw 9 finishes the remote task it POSTs:

```http
POST /api/claws/9/relay-result?key=<claw9-key>
Content-Type: application/json

{
  "type": "remote.result",
  "taskCorrelationId": "corr_uuid_here",
  "fromClawId": 9,
  "result": "[{\"rule\":\"no-unused-vars\",\"line\":42}]",
  "status": "completed"
}
```

Builderforce routes the `remote.result` frame back to claw 7 via its relay WebSocket. Claw 7 unblocks and continues the workflow with the lint findings.

---

## 9. Spec-Driven Workflows

The `/spec` TUI command in coderClaw generates a full planning document and pushes it to the portal. The spec is visible under **Specs**. A manager reviews and approves it (`PATCH /api/specs/:id { status: "approved" }`), then the claw registers an execution workflow. Workflow tasks are added and per-task states updated as the claw works through the plan. The portal shows the live DAG status.

---

## 10. Human-in-the-Loop Approvals

Before any destructive action (deleting files, running migrations, pushing to main), a claw requests human approval:

```http
POST /api/claws/7/approval-request?key=clw_abc...xyz
Content-Type: application/json

{
  "actionType": "file_delete",
  "description": "Delete legacy auth middleware at src/middleware/legacyAuth.ts",
  "riskLevel": "high"
}
```

Builderforce creates a pending approval record and fires an `approval.request` relay frame to all connected portal clients. A MANAGER-role user sees the notification, reviews the action, and responds:

```http
PATCH /api/approvals/appr_xyz
Authorization: Bearer <user-jwt>

{ "status": "approved", "reviewNote": "Confirmed redundant after auth refactor" }
```

Builderforce fires an `approval.decision` relay frame back to claw 7. The claw receives the decision and either proceeds or aborts.

---

## 11. Fleet Discovery and Capability-Based Routing

The full fleet discovery endpoint returns all claws in the tenant along with their capabilities, connection status, and project associations:

```http
GET /api/claws/fleet?from=7&key=clw_abc...xyz
```

This is the same endpoint used by the `claw_fleet` agent tool. The fleet router (`GET /api/claws/fleet/route?requires=jest,coverage`) returns the single best-matching claw using a capability intersection score.

---

## 12. Example: Full Multi-Agent Pipeline

A complete pipeline: PR opened → code review claw reviews → test claw generates tests → human approves → deploy claw deploys. All execution states, approval decisions, and code-change telemetry are recorded in the portal's immutable audit trail. The portal's real-time dashboard shows live status for every step.

For full API details see [API Reference](/link/api-reference/) and [Visual Debugging](/link/visual-debugging/) for timeline/list/graph views.
