---
title: API Reference
description: Complete REST + WebSocket endpoint reference for api.builderforce.ai
---

# Builderforce — Complete API Reference

> Base URL: `https://api.builderforce.ai`
> All protected routes require `Authorization: Bearer <jwt>` unless noted.

---

## Table of Contents

- [Authentication](#authentication)
- [Projects](#projects)
- [Tasks](#tasks)
- [Tenants & Members](#tenants--members)
- [Claws (AI Agent Instances)](#claws-ai-agent-instances)
- [Agents & Skills](#agents--skills)
- [Runtime — Execution Lifecycle](#runtime--execution-lifecycle)
- [Specs (Planning)](#specs-planning)
- [Workflows](#workflows)
- [Approvals (Human-in-the-Loop)](#approvals-human-in-the-loop)
- [Audit Log](#audit-log)
- [Chat Persistence](#chat-persistence)
- [Skill Assignments](#skill-assignments)
- [coderClawLLM Proxy](#coderclawllm-proxy)
- [Marketplace](#marketplace)
- [Fleet Capability Management](#fleet-capability-management)
- [Claw Telemetry](#claw-telemetry)
- [Admin (Superadmin only)](#admin-superadmin-only)
- [RBAC Reference](#rbac-reference)
- [WebSocket Relay Frames](#websocket-relay-frames)

---

## Authentication

These routes are public (no JWT required).

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/register` | Create user + receive one-time API key |
| `POST` | `/api/auth/token` | Exchange API key for JWT (24h expiry) |

### Register

```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "you@example.com",
  "password": "your-password"
}
```

**Response 201:**
```json
{ "apiKey": "<one-time key>", "userId": "<uuid>" }
```

### Token

```http
POST /api/auth/token
Content-Type: application/json

{ "apiKey": "<one-time key>" }
```

**Response 200:**
```json
{ "token": "<jwt>", "expiresAt": "2026-03-05T13:00:00Z" }
```

---

## Projects

| Method | Path | Min Role | Description |
|--------|------|----------|-------------|
| `GET` | `/api/projects` | VIEWER | List projects for tenant |
| `POST` | `/api/projects` | DEVELOPER | Create project |
| `POST` | `/api/projects/scaffold` | DEVELOPER | Scaffold project from a natural-language prompt |
| `GET` | `/api/projects/:id` | VIEWER | Get project |
| `PATCH` | `/api/projects/:id` | DEVELOPER | Update project |
| `DELETE` | `/api/projects/:id` | MANAGER | Delete project |
| `POST` | `/api/projects/:id/insights/code-changes` | DEVELOPER | Record agent code-change telemetry |

**Scaffold body:**
```json
{
  "prompt": "A REST API for managing blog posts",
  "rootWorkingDirectory": "/home/user/projects/blog-api"
}
```

---

## Tasks

| Method | Path | Min Role | Description |
|--------|------|----------|-------------|
| `GET` | `/api/tasks?project_id=` | VIEWER | List tasks (filter by project) |
| `POST` | `/api/tasks` | DEVELOPER | Create task |
| `GET` | `/api/tasks/:id` | VIEWER | Get task |
| `PATCH` | `/api/tasks/:id` | DEVELOPER | Update task |
| `DELETE` | `/api/tasks/:id` | DEVELOPER | Delete task |
| `POST` | `/api/tasks/next` | DEVELOPER | Claim next ready task (priority queue) |

**Task statuses:** `backlog` → `todo` → `ready` → `in_progress` → `in_review` → `done` · `blocked` · `cancelled`

**Task priorities:** `low` · `medium` · `high` · `urgent`

---

## Tenants & Members

| Method | Path | Min Role | Description |
|--------|------|----------|-------------|
| `GET` | `/api/tenants` | — | List tenants the caller belongs to |
| `POST` | `/api/tenants` | — | Create tenant |
| `GET` | `/api/tenants/:id` | VIEWER | Get tenant |
| `DELETE` | `/api/tenants/:id` | OWNER | Delete tenant |
| `POST` | `/api/tenants/:id/members` | OWNER | Add member |
| `DELETE` | `/api/tenants/:id/members/:userId` | OWNER | Remove member |
| `GET` | `/api/tenants/:id/default-claw` | VIEWER | Get tenant default claw |
| `PUT` | `/api/tenants/:id/default-claw` | MANAGER | Set or clear default claw |
| `GET` | `/api/tenants/:id/subscription` | VIEWER | Current plan + usage metrics |
| `POST` | `/api/tenants/:id/subscription/checkout` | MANAGER | Initiate Pro upgrade — returns `checkoutUrl` (redirect) or `null` (manual) |
| `POST` | `/api/tenants/:id/subscription/pro` | MANAGER | Legacy: direct upgrade (manual provider only; new code use `/checkout`) |
| `POST` | `/api/tenants/:id/subscription/free` | MANAGER | Downgrade to Free; cancels active subscription with provider |
| `POST` | `/api/webhooks/payment` | — | Payment provider webhook (raw body; HMAC-verified; no JWT) |
| `GET` | `/api/tenants/:id/insights?days=30` | VIEWER | Code-change insights (all plans) |

---

## Claws (AI Agent Instances)

A **Claw** is a registered CoderClaw runtime connected to a Builderforce tenant. Claws authenticate with their own API key (not a user JWT).

### Portal endpoints (JWT auth)

| Method | Path | Min Role | Description |
|--------|------|----------|-------------|
| `GET` | `/api/claws` | VIEWER | List claws for tenant |
| `POST` | `/api/claws` | MANAGER | Register new claw |
| `GET` | `/api/claws/:id` | VIEWER | Get claw |
| `PATCH` | `/api/claws/:id` | MANAGER | Update claw name/config |
| `DELETE` | `/api/claws/:id` | MANAGER | Deactivate claw |
| `POST` | `/api/claws/:id/forward` | MANAGER | Forward relay frame to claw WebSocket |
| `GET` | `/api/claws/:id/directories` | VIEWER | List synced directories |
| `GET` | `/api/claws/:id/directories/:dirId/files` | VIEWER | List files in directory |
| `GET` | `/api/claws/:id/directories/:dirId/files/:fileId/content` | VIEWER | Get file content |
| `GET` | `/api/claws/:id/sync-history` | VIEWER | Directory sync history |
| `GET` | `/api/claws/:id/usage-snapshots` | VIEWER | Context window usage history |
| `GET` | `/api/claws/:id/tool-audit` | MANAGER | Tool call audit log (query params: `runId`, `sessionKey`, `limit` ≤ 500) |
| `PATCH` | `/api/claws/:id/capabilities` | MANAGER | Update declared capabilities |

### Claw-to-claw endpoints (claw API key auth)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/claws/fleet?from=&key=` | Discover all claws in same tenant (for peer routing) |
| `GET` | `/api/claws/fleet/route?requires=<cap1,cap2>` | Best-matching claw for required capabilities |
| `GET` | `/api/claws/:id/skills` | Fetch merged skill list (tenant + claw assignments) for this claw |
| `GET` | `/api/claws/:id/cron` | Fetch portal-managed cron jobs for this claw |
| `PATCH` | `/api/claws/:id/cron/:jobId` | Update lastRunAt / lastStatus after a cron job fires |
| `PATCH` | `/api/claws/:id/executions/:eid/state` | Report execution state change (`running`, `completed`, `failed`) |

### WebSocket relay

#### Browser client (portal)

```
GET wss://api.builderforce.ai/api/claws/:clawId/ws?token=<jwt>
```

- The portal uses the tenant JWT (`token=`) to authenticate.
- The server validates the JWT and ensures it belongs to the same tenant as the claw.

#### CoderClaw runtime (upstream)

```
GET wss://api.builderforce.ai/api/claws/:clawId/upstream?key=<clawApiKey>
```

- The Claw authenticates using its API key (query param `key=`).

Bi-directional real-time channel between the portal and the coderClaw runtime. See [WebSocket Relay Frames](#websocket-relay-frames).

---

## Agents & Skills

Agents are logical role definitions; Skills are capabilities registered against an agent.

| Method | Path | Min Role | Description |
|--------|------|----------|-------------|
| `GET` | `/api/agents` | VIEWER | List agents for tenant |
| `POST` | `/api/agents` | MANAGER | Register agent |
| `GET` | `/api/agents/:id` | VIEWER | Get agent |
| `DELETE` | `/api/agents/:id` | MANAGER | Deactivate agent |
| `GET` | `/api/agents/:id/skills` | VIEWER | List agent skills |
| `POST` | `/api/agents/:id/skills` | MANAGER | Register skill on agent |
| `GET` | `/api/skills` | VIEWER | All skills across all agents (discovery) |

---

## Runtime — Execution Lifecycle

```
PENDING → SUBMITTED → RUNNING → COMPLETED
                              └→ FAILED
PENDING / SUBMITTED / RUNNING → CANCELLED
```

> **Legacy compatibility:** Older builderforce.ai transport adapter paths (`/api/runtime/sessions`, `/api/runtime/tasks/submit`, etc.) are supported for backward compatibility.

**Legacy endpoints (ClawLink compatibility)**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/runtime/sessions` | Create a session (returns `sessionId`) |
| `POST` | `/api/runtime/tasks/submit` | Submit a task for execution (same body as `/api/runtime/executions`) |
| `GET` | `/api/runtime/tasks/:id/state` | Get execution state (alias for `/api/runtime/executions/:id`) |
| `POST` | `/api/runtime/tasks/:id/cancel` | Cancel execution (alias for `/api/runtime/executions/:id/cancel`) |

---

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/runtime/executions` | Submit task for execution |
| `GET` | `/api/runtime/executions` | List executions for tenant |
| `GET` | `/api/runtime/executions/:id` | Get execution state (REST polling) |
| `GET` | `/api/runtime/executions/:id/stream` | **WebSocket** — stream `ExecutionEvent` frames until terminal state |
| `POST` | `/api/runtime/executions/:id/cancel` | Cancel execution |
| `PATCH` | `/api/runtime/executions/:id/state` | Agent callback: update state (`completed` supports optional `codeChanges`) |
| `GET` | `/api/runtime/tasks/:taskId/executions` | Execution history for a task |

### WebSocket execution stream

Upgrade to WebSocket at `GET /api/runtime/executions/:id/stream`.

Frame types received:
```json
{ "type": "status_change", "status": "running" | "completed" | "failed" }
{ "type": "done", "execution": { ...full execution object... } }
{ "type": "error", "message": "execution_not_found" }
```

The connection closes automatically when the execution reaches a terminal state.

---

## Specs (Planning)

Specs are structured planning documents produced by the coderClaw `/spec` command.

**Statuses:** `draft` → `reviewed` → `approved` → `in_progress` → `done`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/specs` | JWT or claw key | Create / upsert a spec |
| `GET` | `/api/specs` | JWT | List specs (`?projectId=&status=`) |
| `GET` | `/api/specs/:id` | JWT | Get spec detail |
| `PATCH` | `/api/specs/:id` | JWT | Update status / content |
| `DELETE` | `/api/specs/:id` | JWT | Delete spec |
| `GET` | `/api/specs/:id/workflows` | JWT | List workflows linked to spec |
| `POST` | `/api/specs/:id/workflows` | JWT | Link existing workflow to spec |

**Claw-key auth:** append `?clawId=<id>&key=<apiKey>` to any spec write endpoint.

---

## Workflows

Workflows track the full execution DAG for a multi-step plan.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/workflows` | JWT or claw key | Register a workflow |
| `GET` | `/api/workflows` | JWT | List workflows (`?status=&workflowType=&clawId=`) |
| `GET` | `/api/workflows/:id` | JWT | Get workflow + tasks |
| `PATCH` | `/api/workflows/:id` | JWT | Update status / description |
| `GET` | `/api/workflows/:id/tasks` | JWT | List tasks for workflow |
| `POST` | `/api/workflows/:id/tasks` | JWT | Add task to workflow |
| `PATCH` | `/api/workflows/:id/tasks/:tid` | JWT | Update individual task state |

---

## Approvals (Human-in-the-Loop)

Agents request human approval before executing destructive or high-risk actions.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/approvals` | JWT or claw key | Create pending approval |
| `GET` | `/api/approvals` | JWT | List approvals (`?status=&clawId=`) |
| `GET` | `/api/approvals/:id` | JWT | Get approval detail |
| `PATCH` | `/api/approvals/:id` | JWT, MANAGER+ | Approve or reject |

**Decision body:**
```json
{ "status": "approved" | "rejected", "reviewNote": "optional comment" }
```

---

## Audit Log

All state changes are recorded in an immutable audit trail.

| Method | Path | Min Role | Description |
|--------|------|----------|-------------|
| `GET` | `/api/audit/events` | MANAGER | Tenant-wide event log |
| `GET` | `/api/audit/users/:userId/activity` | MANAGER | Per-user activity log |

---

## Chat Persistence

Persistent session chat history for all Claw interactions.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/claws/:clawId/messages?key=` | Claw API key | Bulk-insert session messages (upserts session row) |
| `GET` | `/api/chats` | JWT | List all chat sessions for tenant |
| `GET` | `/api/chats/:sessionId/messages` | JWT | Get messages for a session |
| `GET` | `/api/claws/:clawId/sessions/:sessionKey/messages` | JWT | Get messages by session key |

**Message body:**
```json
{
  "sessionKey": "sess_abc123",
  "messages": [
    { "role": "user", "content": "Fix the memory leak", "seq": 1 },
    { "role": "assistant", "content": "Analysing...", "seq": 2 }
  ]
}
```

---

## Skill Assignments

Assign marketplace skills at the tenant level (all claws inherit) or scoped to a specific claw.

**Tenant-level** (MANAGER+ required for writes):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/skill-assignments/tenant` | List tenant-level skill assignments |
| `POST` | `/api/skill-assignments/tenant` | Assign skill to tenant (`{ slug }`) |
| `DELETE` | `/api/skill-assignments/tenant/:slug` | Remove tenant-level assignment |

**Claw-level** (MANAGER+ required for writes):

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/skill-assignments/claws/:clawId` | List claw-level skill assignments |
| `POST` | `/api/skill-assignments/claws/:clawId` | Assign skill to claw (`{ slug }`) |
| `DELETE` | `/api/skill-assignments/claws/:clawId/:slug` | Remove claw-level assignment |

---

## Builderforce LLM Proxy

OpenAI-compatible LLM proxy with tenant-aware billing, free/pro model pools, and automatic failover.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/llm/v1/chat/completions` | Chat completions (free or pro pool based on tenant plan) |
| `GET` | `/llm/v1/models` | List available models for caller's plan |
| `GET` | `/llm/v1/usage?days=30` | Tenant + user consumption metrics |
| `GET` | `/llm/v1/health` | LLM proxy health check |

**Usage as OpenAI-compatible client:**
```js
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "https://api.builderforce.ai/llm/v1",
  apiKey: "<your-jwt>",
});

const response = await client.chat.completions.create({
  model: "coderclawllm/auto",  // auto-selects best available model
  messages: [{ role: "user", content: "Review this PR" }],
});
```

---

## Marketplace

The public skills registry. Marketplace auth (email + password) is separate from the orchestration API JWT.

See [Marketplace](/link/marketplace/) for full guide. Quick reference:

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/marketplace/auth/register` | Register marketplace account |
| `POST` | `/marketplace/auth/login` | Login → JWT |
| `GET` | `/marketplace/skills` | List published skills |
| `GET` | `/marketplace/skills/:slug` | Get skill detail |
| `POST` | `/marketplace/skills` | Publish a skill (marketplace JWT required) |
| `PUT` | `/marketplace/skills/:slug` | Update own skill |
| `POST` | `/marketplace/skills/:slug/like` | Toggle like on a skill |

---

## Fleet Capability Management

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/claws/fleet?from=&key=` | Claw API key | Discover all claws in the same tenant |
| `GET` | `/api/claws/fleet/route?requires=<cap1,cap2>` | JWT | Best-matching claw for required capabilities |
| `PATCH` | `/api/claws/:id/capabilities` | JWT, MANAGER+ | Update declared capabilities for a claw |

---

## Claw Telemetry

Claw-authenticated endpoints for pushing telemetry from the agent runtime.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/claws/:id/relay-result?key=` | Route `remote.result` to source claw relay |
| `POST` | `/api/claws/:id/usage-snapshot?key=` | Persist context window / token usage snapshot |
| `POST` | `/api/claws/:id/tool-audit?key=` | Persist tool call audit event |
| `POST` | `/api/claws/:id/approval-request?key=` | Create pending approval from claw |

---

## Payment Provider

Builderforce supports swappable payment providers. The active provider is selected by `PAYMENT_PROVIDER` env var.

| Provider | Value | Status |
|----------|-------|--------|
| Manual (no processor) | `manual` | Default — activates immediately, no redirect |
| Stripe | `stripe` | Full implementation — requires `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_YEARLY` |
| Helcim | `helcim` | Stub ready — requires `HELCIM_API_TOKEN`, `HELCIM_WEBHOOK_SECRET` |

### Checkout flow (hosted providers)

```
POST /api/tenants/:id/subscription/checkout
{ billingCycle: "monthly" | "yearly", billingEmail: "..." }

→ { checkoutUrl: "https://checkout.stripe.com/...", sessionId: "cs_..." }
→ frontend redirects user to checkoutUrl
→ provider fires POST /api/webhooks/payment after payment
→ webhook activates subscription
```

### Manual provider flow

```
POST /api/tenants/:id/subscription/checkout
{ billingCycle: "monthly", billingEmail: "...", billingPaymentBrand: "visa", billingPaymentLast4: "4242" }

→ { checkoutUrl: null, sessionId: "manual-..." }
→ subscription activated immediately
```

### Webhook endpoint

```
POST /api/webhooks/payment
Stripe-Signature: t=...,v1=...    (Stripe)
X-Helcim-Signature: sha256=...    (Helcim)
Body: <raw provider payload>
```

The webhook handler verifies the signature, normalises the event, and updates the tenant's subscription state.

---

## Admin (Superadmin only)

Requires a WebJWT with `sa: true`. Not available on managed cloud to regular users.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/users` | All platform users + tenant membership counts |
| `GET` | `/api/admin/tenants` | All tenants + member/claw counts |
| `GET` | `/api/admin/health` | System health (DB ping, model pool, row counts) |
| `GET` | `/api/admin/errors` | Recent API error log (last 200 entries) |
| `POST` | `/api/admin/impersonate` | Issue a tenant JWT for any user+tenant pair |
| … | (see repo for full list) | Newsletter, legal, privacy requests |

---

## RBAC Reference

Roles (ascending authority): `viewer` → `developer` → `manager` → `owner`

| Permission | Min Role |
|-----------|----------|
| Read all resources | VIEWER |
| Create / update tasks, projects, specs, workflows | DEVELOPER |
| Register / deactivate agents and claws, view audit log, manage skill assignments | MANAGER |
| Manage members, upgrade subscription, full admin | OWNER |

---

## WebSocket Relay Frames

The `ClawRelayDO` Durable Object at `wss://api.builderforce.ai/api/relay/:clawId` brokers all real-time frames between the portal and the claw runtime.

### Outbound (portal → claw)

```jsonc
// Approval decision
{ "type": "approval.decision", "approvalId": "…", "status": "approved" | "rejected", "reviewNote": "…" }

// Remote task forwarded to claw
{ "type": "remote.task", "correlationId": "<uuid>", "task": "…" }
```

### Inbound (claw → portal)

```jsonc
// Execution state change
{ "type": "status_change", "executionId": "…", "status": "running" | "completed" | "failed" }

// Remote task result
{ "type": "remote.result", "taskCorrelationId": "<uuid>", "fromClawId": "<clawId>", "result": "…", "status": "completed" | "failed", "error": "<optional>" }

// Workflow live update
{ "type": "workflow.update", "workflowId": "…", "status": "…", "taskId": "…" }

// Approval requested by claw
{ "type": "approval.request", "approvalId": "…", "actionType": "…", "description": "…" }

// Usage snapshot, tool.audit — see repo for full frame schemas
```
