---
title: Architecture
description: Four-layer DDD API, Lit 3 SPA, ClawRelayDO Durable Object, and how the pieces connect
---

# Builderforce — Technical Architecture

This document describes the system design of Builderforce: the four-layer DDD API, the Lit 3 SPA, the Cloudflare Durable Object relay, and how all the pieces connect.

---

## 1. High-Level System Map

```
Browser (builderforce.ai)
  │  Lit 3 SPA — Vite build, served by Cloudflare static asset Worker
  │
  │  REST + WebSocket
  ▼
Cloudflare Worker (api.builderforce.ai)  ──  Hono 4 router
  │
  ├─── Durable Object: ClawRelayDO  ──►  WebSocket ──►  coderClaw runtime (local machine)
  │         (one DO per Claw)
  │
  ├─── Cloudflare Hyperdrive  ──►  Postgres (Neon / Supabase / self-managed)
  │
  └─── (optional) LLM Proxy  ──►  Anthropic / OpenAI / Gemini / Ollama / …
```

All traffic runs on **Cloudflare's edge network** — no cold starts, globally distributed. The only stateful service is your Postgres database.

---

## 2. API — Four-Layer DDD

The API (`api/src/`) follows **Domain-Driven Design** with a strict four-layer dependency rule: outer layers depend inward, never the reverse.

### Layer 1 — Domain

`api/src/domain/`

Pure business logic — no framework, no database imports.

| Subdirectory | Contents |
|---|---|
| `shared/` | `types.ts` (enums, value objects), `errors.ts` (domain error classes) |
| `user/` | `User` entity, `IUserRepository` port |
| `tenant/` | `Tenant` aggregate, `ITenantRepository` port, member + role management |
| `project/` | `Project` aggregate, `IProjectRepository` port |
| `task/` | `Task` entity, `ITaskRepository` port, status/priority transitions |
| `agent/` | `Agent` entity, `IAgentRepository` port |
| `skill/` | `Skill` entity, `ISkillRepository` port |
| `execution/` | `Execution` aggregate with formal state machine, `IExecutionRepository` |
| `audit/` | `AuditEvent`, `IAuditRepository` |

**State machine (Execution):**
```
PENDING ──► SUBMITTED ──► RUNNING ──► COMPLETED
                                  └──► FAILED
PENDING / SUBMITTED / RUNNING ──► CANCELLED
```

### Layer 2 — Application

`api/src/application/`

Use-case services. Depend on domain ports (interfaces), never on concrete implementations.

| Service | Responsibility |
|---|---|
| `AuthService` | User registration, API-key issuance, JWT sign/verify |
| `ProjectService` | CRUD + scaffold |
| `TaskService` | CRUD + status transitions |
| `TenantService` | Tenant CRUD, member management, subscription |
| `AgentService` | Agent + skill registration, discovery |
| `RuntimeService` | Execution submission, state callbacks, streaming |
| `AuditService` | Event recording |
| `LlmProxyService` | Model pool routing, failover, usage tracking |

### Layer 3 — Infrastructure

`api/src/infrastructure/`

Concrete adapters — depend on application ports.

| Subdirectory | Contents |
|---|---|
| `auth/` | `JwtService` (HMAC-SHA-256, Web Crypto), `HashService` (PBKDF2 passwords, bcrypt-compatible API keys), `MfaService` (TOTP — AES-GCM encrypted secrets, recovery codes) |
| `database/` | Drizzle ORM schema, Cloudflare Hyperdrive connection factory |
| `relay/` | `ClawRelayDO` — Durable Object WebSocket broker |
| `repositories/` | Drizzle/Postgres implementations of all domain ports |

### Layer 4 — Presentation

`api/src/presentation/`

Hono routes + middleware. Depends on application services.

| Route file | Path prefix | Notes |
|---|---|---|
| `authRoutes.ts` | `/api/auth` | Public registration + token exchange |
| `projectRoutes.ts` | `/api/projects` | CRUD + scaffold + insights |
| `taskRoutes.ts` | `/api/tasks` | CRUD + status |
| `tenantRoutes.ts` | `/api/tenants` | Tenant + member + subscription management |
| `clawRoutes.ts` | `/api/claws` | Claw CRUD, directories, file browser, relay forward |
| `agentRoutes.ts` | `/api/agents` | Agent + skill CRUD |
| `runtimeRoutes.ts` | `/api/runtime` | Execution lifecycle + WebSocket stream |
| `specRoutes.ts` | `/api/specs` | Planning document CRUD |
| `workflowRoutes.ts` | `/api/workflows` | Workflow DAG CRUD |
| `approvalRoutes.ts` | `/api/approvals` | Human-in-the-loop gates |
| `auditRoutes.ts` | `/api/audit` | Immutable event log |
| `chatRoutes.ts` | `/api/chats`, `/api/claws/:id/messages` | Chat session persistence |
| `skillAssignmentRoutes.ts` | `/api/skill-assignments` | Tenant + claw skill assignments |
| `llmRoutes.ts` | `/llm/v1` | OpenAI-compatible LLM proxy |
| `marketplaceRoutes.ts` | `/marketplace` | Public skills registry + auth |
| `adminRoutes.ts` | `/api/admin` | Superadmin panel |

**Middleware:**
- `cors.ts` — configurable origin allowlist (`CORS_ORIGINS` secret)
- `errorHandler.ts` — structured error responses, logs to `apiErrorLog` table
- `authMiddleware.ts` — verifies JWT, injects `userId` + `tenantId` into context
- `superAdminMiddleware.ts` — verifies `sa: true` claim in JWT

---

## 3. Frontend — Lit 3 SPA

`app/src/`

The SPA is built with **Lit 3** (web components) and **Vite**, served by a minimal Cloudflare static asset Worker.

### Key files

| File | Description |
|------|-------------|
| `app.ts` | Root `<ccl-app>` — auth state machine + client-side routing |
| `api.ts` | Typed fetch wrapper — manages JWT refresh, dispatches `ccl:unauthorized` event |
| `gateway.ts` | `ClawGateway` — WebSocket client for the relay DO |
| `main.ts` | Entry point — registers all custom elements |
| `styles.css` | Design system — CSS custom properties, zero utility framework dependency |

### Views

| View file | Route | Description |
|-----------|-------|-------------|
| `dashboard.ts` | `/` | Overview — projects, tasks, claw status |
| `projects.ts` | `/projects` | Project list + CRUD |
| `tasks.ts` | `/tasks` | Task board + CRUD |
| `claws.ts` | `/claws` | Claw registry |
| `agents.ts` | `/agents` | Agent + skill management |
| `workspace.ts` | `/workspace` | Multi-claw workspace |
| `brain.ts` | `/brain` | AI project assistant (conversational UI) |
| `logs.ts` | `/logs` | Execution logs (raw list + visual timeline) |
| `execution-timeline.ts` | shared component | Visual timeline/list/graph debugger (see [Visual Debugging](/link/visual-debugging/)) |
| `code-editor.ts` | `/code-editor` | Browser-based file browser / editor |
| `skills.ts` | `/skills` | Marketplace skill browser |
| `admin.ts` | `/admin` | Superadmin panel |
| `auth.ts` | `/login`, `/register` | Auth forms |
| `quickstart.ts` | `/quickstart` | Interactive install wizard |
| `content.ts` | `/content` | Markdown content viewer |
| `debug.ts` | `/debug` | Dev diagnostics |

---

## 4. Real-Time Relay — Durable Objects

The `ClawRelayDO` is a Cloudflare **Durable Object** — a stateful serverless primitive that maintains a persistent WebSocket connection per Claw.

```
coderClaw runtime
  │  wss://api.builderforce.ai/api/relay/:clawId?key=<apiKey>
  ▼
ClawRelayDO (one instance per Claw ID)
  │  Fanout to all connected browser clients
  ▼
Browser (portal)  ──  ClawGateway WebSocket client
```

**How it works:**
1. The coderClaw runtime opens a WebSocket to `/api/relay/:clawId?key=<apiKey>`.
2. The DO authenticates the claw API key, then keeps the connection alive.
3. Browser clients connect to the same DO endpoint (with a user JWT).
4. The DO fans out inbound frames (from the claw) to all connected browser clients.
5. The portal can push frames back to the claw (approvals, remote.task forwards).

**Persistence:** The DO persists chat messages (`POST /api/claws/:id/messages`), usage snapshots, and tool audit events to Postgres via REST callbacks on the API Worker.

---

## 5. Database Schema Overview

All tables use Postgres via Cloudflare Hyperdrive. Migrations are in `api/migrations/` and tracked in `_migrations`.

| Table | Purpose |
|-------|---------|
| `users` | Platform user accounts (email, password hash, username, MFA) |
| `auth_tokens` | One-time API keys issued at registration |
| `tenants` | Tenant organisations |
| `tenant_members` | User ↔ Tenant membership + role |
| `coderclaw_instances` | Registered Claw instances (API key hash) |
| `projects` | Project metadata |
| `tasks` | Task entities with status + priority |
| `agents` | Agent role definitions |
| `skills` | Agent skill registrations |
| `executions` | Task execution lifecycle records |
| `specs` | Planning documents (PRD + arch + tasks) |
| `workflows` | Multi-step execution DAGs |
| `approvals` | Human-in-the-loop approval records |
| `audit_events` | Immutable audit trail |
| `chat_sessions` | Chat session metadata per Claw |
| `chat_messages` | Individual messages (role, content, seq) |
| `marketplace_skills` | Published skills in the public registry |
| … | (see repo for full list) |

---

## 6. Authentication & Security

### Three auth schemes

| Scheme | Used by | Mechanism |
|--------|---------|-----------|
| User JWT | Browser portal | HMAC-SHA-256 signed, 24h expiry, carries `userId`, `tenantId`, `role` |
| Claw API key | Agent runtime | PBKDF2-hashed key stored in `coderclaw_instances.api_key_hash` |
| Marketplace JWT | Marketplace users | HMAC-SHA-256, 24h expiry, carries `sub`, `tid: 0` (no tenant scope) |

All cryptography uses the **Web Crypto API** — no third-party auth libraries in the critical path.

### RBAC enforcement

`authMiddleware` injects `role` into the Hono context. Route handlers call `requireRole(TenantRole.MANAGER)` as a middleware guard.

---

## 7. Repository Layout

```
Builderforce/
├── api/                              # Cloudflare Worker – api.builderforce.ai
│   ├── src/
│   │   ├── domain/                   # Layer 1 – pure business logic
│   │   ├── application/              # Layer 2 – use-case services
│   │   ├── infrastructure/            # Layer 3 – concrete adapters
│   │   ├── presentation/             # Layer 4 – Hono routes + middleware
│   │   ├── env.ts
│   │   └── index.ts
│   ├── migrations/
│   └── wrangler.toml
├── app/                              # Cloudflare Worker – builderforce.ai
│   ├── src/
│   ├── static/
│   └── wrangler.toml
├── Dockerfile
├── docker-compose.yml
└── package.json
```

---

## 8. Design Principles

- **Domain-Driven Design (DDD)** — Rich aggregates, port interfaces, dependency injection.
- **SOLID** — One concern per file; services depend on interfaces.
- **N-Layer rule** — Outer layers depend inward; inner layers never import from outer ones.
- **Zero-framework auth** — Web Crypto API only; no jsonwebtoken/bcrypt in critical path.

---

## 9. Data Flow Examples

See [API Reference](/link/api-reference/) and [Multi-Agent Orchestration](/link/multi-agent-orchestration/) for execution lifecycle, approval flow, and marketplace skill install flows.
