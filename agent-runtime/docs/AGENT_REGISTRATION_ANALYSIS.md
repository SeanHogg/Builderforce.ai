# Agent Registration — End-to-End Analysis

> Deep-dive across **BuilderForce Agents** and **builderforce.ai** covering registration,
> connection, relay protocol, gaps blocking ROADMAP Phases 2 & 4, and the
> proposed **builderforceLLM** routing API.

---

## 1. Is Registration Implemented in Both Projects?

| Concern                        | builderforce.ai (server)                                                             | BuilderForce Agents (client)                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| **Agent CRUD API**              | ✅ Full — `POST /api/agents`, `GET /api/agents`, `DELETE /api/agents/:id`               | N/A (consumer only)                                                                        |
| **Registration wizard**        | N/A (receives requests)                                                              | ✅ Full — interactive TUI wizard in `builderforce init` (`promptAgentLink`)                    |
| **API key generation**         | ✅ Server generates random key, hashes (bcrypt), stores hash, returns plaintext once | ✅ Client stores plaintext in `~/.builderforce/.env` as `BUILDERFORCE_AGENTS_LINK_API_KEY`              |
| **WebSocket relay (upstream)** | ✅ `GET /api/agents/:id/upstream?key=` — Durable Object relay via `AgentNodeRelayDO`       | ✅ Implemented via `AgentLinkRelayService` (persistent upstream WS + reconnect + heartbeat) |
| **WebSocket relay (browser)**  | ✅ `GET /api/agents/:id/ws?token=` — browser client connects via `AgentGateway` class  | N/A (this is the SPA side)                                                                 |
| **Task execution transport**   | ✅ Runtime routes at `POST /api/runtime/executions`                                  | ✅ `AgentLinkTransportAdapter` calls `/api/runtime/*` over HTTP                             |
| **Connection tracking**        | ✅ `connectedAt`/`lastSeenAt` columns on `builderforce_instances`                       | Reads status indirectly via stored env vars                                                |

**Verdict**: Registration and relay connectivity are **fully wired end-to-end**,
and session-level execution history is now queryable. Remaining gaps are now
around agent domain modeling and agent-scoped skill resolution.

---

## 2. End-to-End Registration Flow

### Step-by-step: `builderforce init`

```
┌───────────────────────────────────────────────────────────────┐
│   User runs:  builderforce init                                  │
│   (TUI wizard — src/commands/builderforce.ts, line ~700)         │
└───────────────────────────────┬───────────────────────────────┘
                                │
         ┌──────────────────────▼──────────────────────────┐
   1     │ Check if already connected                       │
         │   Reads BUILDERFORCE_AGENTS_LINK_API_KEY from              │
         │   ~/.builderforce/.env                              │
         │   → if present, shows "Already connected" note   │
         └──────────────────────┬──────────────────────────┘
                                │ (not connected)
         ┌──────────────────────▼──────────────────────────┐
   2     │ Prompt: "Connect to builderforce.ai?"              │
         │   → No  ⇒ writes BUILDERFORCE_AGENTS_LINK_SKIPPED=1       │
         │   → Yes ⇒ continue                              │
         └──────────────────────┬──────────────────────────┘
                                │
         ┌──────────────────────▼──────────────────────────┐
   3     │ Prompt: Server URL                               │
         │   Default: https://api.builderforce.ai              │
         └──────────────────────┬──────────────────────────┘
                                │
         ┌──────────────────────▼──────────────────────────┐
   4     │ Prompt: Login or Register                        │
         │   → Login:    POST /api/auth/web/login           │
         │   → Register: POST /api/auth/web/register        │
         │   Result: webToken (JWT)                         │
         └──────────────────────┬──────────────────────────┘
                                │
         ┌──────────────────────▼──────────────────────────┐
   5     │ Pick or create tenant                            │
         │   GET  /api/tenants          (Bearer: webToken)  │
         │   → 0 tenants: POST /api/tenants                 │
         │   → 1 tenant:  auto-select                       │
         │   → N tenants: pick from list                    │
         │   Result: tenantId                               │
         └──────────────────────┬──────────────────────────┘
                                │
         ┌──────────────────────▼──────────────────────────┐
   6     │ Get tenant-scoped JWT                            │
         │   POST /api/auth/tenant-token                    │
         │     body: { tenantId }                           │
         │   Result: tenantJwt                              │
         └──────────────────────┬──────────────────────────┘
                                │
         ┌──────────────────────▼──────────────────────────┐
   7     │ Register agent instance                           │
         │   POST /api/agents                                │
         │     Authorization: Bearer <tenantJwt>            │
         │     body: { name: "my-agent" }                    │
         │                                                  │
         │   Server:                                        │
         │     • generates random API key                   │
         │     • hashes it (bcrypt)                         │
         │     • inserts into builderforce_instances table      │
         │     • returns { agent: { id, name, slug }, apiKey }│
         └──────────────────────┬──────────────────────────┘
                                │
         ┌──────────────────────▼──────────────────────────┐
   8     │ Persist credentials                              │
         │   ~/.builderforce/.env:                             │
         │     BUILDERFORCE_AGENTS_LINK_URL=https://api.builderforce.ai  │
         │     BUILDERFORCE_AGENTS_LINK_WEB_TOKEN=<jwt>               │
         │     BUILDERFORCE_AGENTS_LINK_TENANT_ID=<int>               │
         │     BUILDERFORCE_AGENTS_LINK_API_KEY=<plaintext key>       │
         │                                                  │
         │   .builderforce/context.yaml  (project-level):      │
         │     agentNodeLink:                                    │
         │       instanceId: "42"                           │
         │       instanceSlug: "my-agent"                    │
         │       instanceName: "my-agent"                    │
         │       tenantId: 7                                │
         │       url: "https://api.builderforce.ai"            │
         └──────────────────────┘
```

### What Happens After Registration

#### Path A — Task delegation (HTTP transport, WORKS today)

```
BuilderForce Agents                        builderforce.ai
   │                                   │
   │  AgentLinkTransportAdapter         │
   │  ─────────────────────────        │
  │  submitTask({ metadata.taskId })  │
  │  ──POST /api/runtime/executions──▶│  queues execution
  │  ◀──{ id, status: pending }──────│
   │                                   │
  │  streamTaskUpdates(executionId)   │
  │  ──GET /api/runtime/executions/:id▶│  (polling loop)
  │  ◀──{ status: running }──────────│
  │  ◀──{ status: completed }────────│
```

#### Path B — Real-time relay (WebSocket, WORKS today)

```
BuilderForce Agents                  AgentNodeRelayDO              Browser (SPA)
   │                           │                        │
   │  wss://…/agents/:id/      │                        │
   │  upstream?key=<apiKey>    │                        │
   │ ─────────────────────────▶│  attachUpstream()      │
   │                           │◀────────────────────── │  wss://…/agents/:id/ws?token=
   │                           │  attachClient()        │
   │                           │                        │
   │ ──{ gateway message }────▶│ ── broadcast() ──────▶ │
   │                           │                        │
   │ ◀── forward upstream ────│◀──{ user message }──── │
```

---

## 3. Can Users See All Agents in a Tenant?

**Yes.**

- **API**: `GET /api/agents` (authenticated with tenant JWT) returns ALL agents for the caller's tenant — no per-user filtering.  
  Response shape: `[{ id, name, slug, status, registeredBy, lastSeenAt, createdAt }]`

- **SPA**: The `<ccl-agents>` view calls `agentNodesApi.list()` → `GET /api/agents` and renders a table showing:
  - Connected dot (green = `connectedAt` not null, gray = offline)
  - Name, Slug, Status badge (active/suspended/inactive), Last seen
  - Open (slide-out panel with 10 tabs: Chat, Agents, Config, Sessions, Skills, Usage, Cron, Nodes, Channels, Logs)
  - Delete (with confirmation modal)
  - "Register agent" button → modal (name input → POST → shows one-time API key)

- **RBAC**: Role checks happen at the route level (`authMiddleware`), but agent listing is tenant-scoped, not user-scoped. Any authenticated user in the tenant sees every agent.

---

## 4. Architectural Gap Analysis

### GAP 1: Agents ≠ Agents (Critical for Phase 2 & 4)

The schema has **two separate, unlinked entity systems**:

| Entity     | Table                 | Purpose                                                                              |
| ---------- | --------------------- | ------------------------------------------------------------------------------------ |
| **Agents**  | `builderforce_instances` | Physical BuilderForce Agents installations (identified by API key, relay connection)           |
| **Agents** | `agents`              | Abstract LLM agent registrations (type: claude/openai/ollama/http, endpoint, apiKey) |

**Status**: ✅ PARTIALLY RESOLVED.

`executions` now persist optional `agentNodeId` and `sessionId`, and runtime routes
support session-scoped history queries:

- `GET /api/runtime/executions?sessionId=<id>`
- `GET /api/runtime/sessions/:sessionId/executions`

Remaining part of this gap: deeper agent/agent capability binding and routing
policy still rely on route logic rather than a dedicated domain model.

### GAP 2: Upstream WebSocket Client in BuilderForce Agents

**Status**: ✅ RESOLVED.

`AgentLinkRelayService` now opens and maintains the upstream relay WebSocket,
bridges gateway chat events bidirectionally, auto-reconnects with exponential
backoff, and sends periodic heartbeat updates.

### GAP 3: AgentLink Transport Adapter Endpoint Alignment

**Status**: ✅ RESOLVED.

`AgentLinkTransportAdapter` now targets the implemented runtime contract:

- `POST /api/runtime/executions`
- `GET /api/runtime/executions/:id`
- `POST /api/runtime/executions/:id/cancel`

and discovery routes:

- `GET /api/agents`
- `GET /api/skills`

The adapter now supports authenticated calls via optional `authToken` in
`AgentLinkConfig`.

### GAP 4: No Agent Domain Entity in builderforce.ai

`builderforce.ai/api/src/domain/` has: agent, audit, execution, project, shared, skill, task, tenant, user — but **no `agent/` domain**. The agent registration routes directly query the DB with raw Drizzle calls instead of going through proper domain entities and repository abstractions.

**Impact**: Business rules for agent lifecycle (suspension, limits, audit trails) are ad-hoc in the route handlers. Phase 2 approval workflows need a proper agent domain entity.

### GAP 5: Skill Assignment Disconnection

The schema defines both:

- `tenant_skill_assignments` — all agents in a tenant inherit these
- `agentNode_skill_assignments` — per-agent overrides

But the BuilderForce Agents side has **no mechanism to query its own effective skill assignments** from builderforce.ai. While discovery now uses `GET /api/skills`, this is tenant-global and not agent-scoped effective policy.

### GAP 6: Session execution visibility

**Status**: ✅ RESOLVED.

Execution records now carry `sessionId`, and the runtime API exposes full
session execution timelines so operators can inspect complete run history for a
single session without manual correlation.

---

## 5. Summary of What Works vs. What's Missing

```
✅ WORKS TODAY
  ├── Registration wizard (BuilderForce Agents init → POST /api/agents)
  ├── API key generation + hashing + storage
  ├── Credential persistence (global ~/.builderforce/.env + project context.yaml)
  ├── SPA agent management (list, register, delete, status badges)
  ├── Durable Object relay infrastructure (AgentNodeRelayDO)
  ├── Browser WebSocket client (AgentGateway) → relay → agent
  ├── Transport adapter concept (AgentLinkTransportAdapter)
  ├── Connection tracking (connectedAt/lastSeenAt DB columns)
  └── Tenant-scoped visibility (all users see all agents)

❌ MISSING / BROKEN
  ├── Agent domain entity in builderforce.ai (routes use raw DB queries)
  └── Effective agent-scoped skill sync (agent can't query merged tenant+agent assignments)
```

---

## 6. builderforceLLM API Concept (OpenRouter-style)

### Vision

An LLM routing API that **BuilderForce Agents instances call instead of directly calling
provider APIs**. Like OpenRouter, but private to the builderforce.ai mesh.

```
┌────────────┐       ┌──────────────────┐       ┌──────────────────┐
│  BuilderForce Agents  │──────▶│   builderforceLLM   │──────▶│  LLM Providers   │
│  instance   │ HTTP  │  (routing proxy)  │ HTTP  │  • Anthropic     │
│             │◀──────│                  │◀──────│  • OpenAI        │
└────────────┘       │  Tenant-scoped   │       │  • Ollama (local)│
                     │  Rate-limited    │       │  • llama.cpp     │
                     │  Budget-tracked  │       │  • Google        │
                     │  Approval-gated  │       │  • Mistral       │
                     └──────────────────┘       └──────────────────┘
```

### API Surface

**Base URL**: `https://llm.builderforce.ai` (or `https://api.builderforce.ai/v1`)

The API is **OpenAI-compatible** so BuilderForce Agents can use it as a drop-in provider.

```
POST   /v1/chat/completions          – standard chat completion (streaming supported)
POST   /v1/completions               – legacy completion
GET    /v1/models                    – list available models for this tenant
POST   /v1/embeddings                – embedding generation

# builderforceLLM-specific extensions
GET    /v1/routing/policies           – tenant routing rules
PUT    /v1/routing/policies           – update routing rules
GET    /v1/usage                     – usage/cost breakdown by model, agent, agent
GET    /v1/budget                    – remaining budget for tenant/agent
POST   /v1/approval/request          – request HITL approval for expensive operation
GET    /v1/approval/:id              – poll approval status
```

### Authentication

```
Authorization: Bearer <BUILDERFORCE_AGENTS_LINK_API_KEY>
X-Agent-Id: <instanceId>
X-Tenant-Id: <tenantId>
```

Using the **same API key** the agent already has from registration. No new credentials needed.

### Routing Engine

```typescript
type RoutingPolicy = {
  /** Tenant-level default provider */
  defaultProvider: "anthropic" | "openai" | "ollama" | "llamacpp" | "google" | "mistral";

  /** Model aliasing: BuilderForce Agents requests "fast" → router resolves to actual model */
  aliases: Record<string, { provider: string; model: string }>;

  /** Priority chain for failover */
  fallbackChain: Array<{ provider: string; model: string }>;

  /** Cost controls */
  budget: {
    /** Monthly budget in USD */
    monthlyLimitUsd: number;
    /** Per-request cost ceiling — requests exceeding this require approval */
    approvalThresholdUsd: number;
    /** Alert threshold (% of monthly budget) */
    alertAtPercent: number;
  };

  /** Local-first: prefer local models when capable */
  localFirst: boolean;

  /** Rate limiting per agent */
  rateLimits: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };
};
```

### Routing Flow

```
1.  BuilderForce Agents sends:  POST /v1/chat/completions
      model: "claude-sonnet-4-20250514"  (or alias like "fast" / "smart" / "local")
      messages: [...]

2.  builderforceLLM resolves model:
      → Check aliases table  (e.g. "fast" → gpt-4o-mini)
      → Check localFirst     (if Ollama/llama.cpp agent is online, prefer it)
      → Check budget          (if over limit → 402 or → approval request)
      → Check rate limits     (if over → 429)

3.  builderforceLLM forwards to provider:
      → If approval required (cost > threshold):
          POST /v1/approval/request → returns { approvalId, status: "pending" }
          BuilderForce Agents polls GET /v1/approval/:id
          Manager approves in SPA → status: "approved"
          builderforceLLM proceeds with the actual LLM call

      → If approved or no approval needed:
          Forward to provider API (Anthropic, OpenAI, etc.)
          Stream response back to BuilderForce Agents
          Log: tokens, cost, latency, model, agentNodeId, tenantId

4.  Emit OpenTelemetry span:
      service.name: "builderforceLLM"
      llm.model, llm.provider, llm.tokens.input, llm.tokens.output
      llm.cost_usd, tenant.id, agent.id
```

### How This Enables Phase 2 (Approval Workflows)

The LLM proxy is the natural **chokepoint** for approval. Instead of
modifying every agent in BuilderForce Agents, the proxy intercepts expensive requests:

```
BuilderForce Agents agent                 builderforceLLM                  SPA Dashboard
    │                               │                              │
    │ POST /v1/chat/completions     │                              │
    │ (estimated: $0.50)            │                              │
    │ ─────────────────────────────▶│                              │
    │                               │ cost > $0.10 threshold       │
    │                               │ → create approval            │
    │ ◀── 202 { approvalId } ──────│                              │
    │                               │ ── push notification ──────▶ │
    │ GET /v1/approval/:id          │                              │
    │ ─────────────────────────────▶│                              │
    │ ◀── { status: "pending" } ───│          Manager sees:        │
    │                               │          "Agent my-agent wants │
    │                               │           to run claude-opus │
    │                               │           est. $0.50"        │
    │                               │                              │
    │                               │ ◀── PATCH approve ────────── │
    │ GET /v1/approval/:id          │                              │
    │ ─────────────────────────────▶│                              │
    │ ◀── { status: "approved" } ──│                              │
    │                               │                              │
    │ POST /v1/chat/completions     │                              │
    │ (retry with approvalId)       │                              │
    │ ─────────────────────────────▶│ → forward to Anthropic       │
    │ ◀── streaming response ──────│                              │
```

### How This Enables Phase 4 (Orchestration)

`builderforceLLM` becomes the **model registry** that orchestration depends on:

- The orchestrator knows which models are available (via `GET /v1/models`)
- Task routing can consider cost (cheap tasks → `gpt-4o-mini`, complex → `claude-opus`)
- Local LLM agents (`llama.cpp` / `ollama`) register as models in the same pool
- Budget allocation per workflow becomes natural (each workflow has a budget, the proxy enforces it)

### Implementation Plan

| Step | What                                             | Where                                                                                                            |
| ---- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 1    | Create `/v1/chat/completions` proxy route        | `builderforce.ai/api/src/presentation/routes/llmRoutes.ts`                                                       |
| 2    | Add `llm_requests` table (log every call)        | `schema.ts`: agentNodeId, tenantId, model, provider, inputTokens, outputTokens, costUsd, latencyMs, approvalId        |
| 3    | Build routing engine (aliases, fallback, budget) | `builderforce.ai/api/src/application/llm/RoutingEngine.ts`                                                       |
| 4    | Add `routing_policies` table                     | schema: tenantId, policy JSON, monthlyBudgetUsd, alertPercent                                                    |
| 5    | Wire approval workflow                           | Reuse execution approval from Phase 2; add `status: 'awaiting_approval'` to LLM request lifecycle                |
| 6    | Configure BuilderForce Agents to use it                    | New provider in `src/providers/builderforcellm.ts` that points at `BUILDERFORCE_AGENTS_LINK_URL + /v1` using existing API key |
| 7    | Add `/v1/models` endpoint                        | Aggregates provider models + local models from connected agents                                                   |
| 8    | OTel metrics                                     | Extend `diagnostics-otel` with `llm.proxy.*` metrics                                                             |

### BuilderForce Agents Provider Integration

```typescript
// src/providers/builderforcellm.ts  (sketch)
import { readSharedEnvVar } from "../builderforce/env.js";

export function createBuilderForce AgentsLLMProvider() {
  const baseUrl = readSharedEnvVar("BUILDERFORCE_AGENTS_LINK_URL") ?? "https://api.builderforce.ai";
  const apiKey = readSharedEnvVar("BUILDERFORCE_AGENTS_LINK_API_KEY");
  const agentNodeId = readSharedEnvVar("BUILDERFORCE_AGENTS_LINK_AGENT_NODE_ID"); // from context.yaml

  return {
    name: "builderforceLLM",
    baseUrl: `${baseUrl}/v1`,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "X-Agent-Id": agentNodeId,
    },
    // OpenAI-compatible — works with existing chat/completion handlers
    type: "openai-compatible" as const,
  };
}
```

---

## 7. Recommended Implementation Order

```
Phase 0 — Fix Foundation (prerequisite for everything)
  ├── 0a. Create agent domain entity in builderforce.ai
  └── 0b. Add effective agent-skill endpoint + client sync path

Phase 2 — Approval Workflows (from ROADMAP.md)
  ├── 2a. Add AWAITING_APPROVAL status to executions
  ├── 2b. Build builderforceLLM proxy (POST /v1/chat/completions)
  ├── 2c. Routing engine + budget enforcement
  ├── 2d. Approval request/poll/approve API
  └── 2e. SPA approval queue view

Phase 4 — Orchestration (from ROADMAP.md)
  ├── 4a. /v1/models aggregation (provider + local + agent-hosted)
  ├── 4b. Workflow templates with model selection
  ├── 4c. Fan-out with per-subtask budget
  └── 4d. Agent fleet routing (pick best agent for a task)
```
