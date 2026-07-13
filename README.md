# Builderforce.ai

> **A human-in-the-loop, fully agentic cloud** — train your own AI agents and use them inside your own agent, manage your whole workforce on a Kanban board, and review and approve every action without ever leaving VS Code.

[![Deploy Status](https://img.shields.io/badge/deploy-Cloudflare%20Pages-orange)](https://builderforce.ai)
[![Worker](https://img.shields.io/badge/api-Cloudflare%20Workers-blue)](https://workers.cloudflare.com)
[![DB](https://img.shields.io/badge/db-Neon%20Postgres-green)](https://neon.tech)

---

## What is Builderforce.ai?

Builderforce.ai is a **human-in-the-loop, fully agentic cloud** where ideas become software and software becomes agents. You stay in control of every step while AI agents do the work — train your own specialist agents and put them to work *inside* your own agent, manage the whole workforce from a Kanban board, and review, validate, and approve everything without leaving your editor. It combines a full in-browser IDE with an AI training pipeline, a Workforce Registry for specialist agents, and an orchestration portal for self-hosted [BuilderForce Agents](https://builderforce.ai/agents) meshes.

**Three capabilities at the core:**

| Capability | What it does |
|---|---|
| **🔁 Train agents, use them inside your agent** | Train a custom agent in-browser (WebGPU LoRA + AI evaluation), publish it to the Workforce Registry, then hire it and call it from inside your own agent — your specialists become tools your main agent delegates to. |
| **▦ Kanban board & project management** | Organize work into projects, then plan, assign, and track every task on a live Kanban board (swimlanes per status or per agent, plus table, calendar, and Gantt views). Humans and AI agents share the same board. |
| **🧩 Never leave VS Code** | The BuilderForce VS Code extension runs the whole platform in your editor — chat with agents, assign and run tasks, review and validate their work, and approve human-in-the-loop actions without leaving your code. |

**One platform. Three roles:**

| Role | What it does |
|---|---|
| **Enterprise IDE** | Full Node.js runtime in the browser (WebContainers + Monaco + xterm.js); real-time collaboration; AI pair programming |
| **AI Training Studio** | In-browser LoRA fine-tuning on instruction datasets; WebGPU-accelerated; models up to 2B parameters; no cloud GPU required |
| **Orchestration Portal** | BuilderForce Agent fleet management; task assignment; heartbeat monitoring; agent-to-agent mesh relay; approval gates |

---

## Key Capabilities

### In-Browser IDE
- **Full Node.js runtime** via WebContainers — run `npm install`, Vite dev servers, and interactive shells without leaving the browser
- **Monaco Editor** with syntax highlighting, IntelliSense, multi-file tabs, and real-time collaborative editing via Yjs CRDT
- **xterm.js terminal** connected directly to the WebContainer shell — full PTY, shared across collaborators
- **AI Chat Panel** — streaming AI assistant with full project file context; can apply code changes and create files directly
- **Live Preview** — iFrame running the Vite dev server; updates on save

### AI Training Studio
- **In-browser LoRA fine-tuning** — uses [@seanhogg/builderforce-memory](https://www.npmjs.com/package/@seanhogg/builderforce-memory) / Transformers.js with WebGPU; trains Mamba-1/2/3 and GPT-style models up to 2B parameters entirely client-side
- **Hybrid Local Brain** — Mamba State Engine (`mamba-engine.ts`) runs an O(n) selective scan alongside transformer inference; agent state persists to IndexedDB as a compact Float32 state vector and is embedded in exported `AgentPackage` JSON
- **Dataset generation** — LLM-assisted JSONL instruction dataset creation with SSE streaming progress
- **AI evaluation** — independent judge scores model outputs on code correctness, reasoning quality, and hallucination rate (0.0–1.0)
- **WebGPU fallback** — CPU software path via `forceFallbackAdapter: true`; platform reports `gpuMode: 'cpu-fallback'` transparently

### Workforce Registry
- **Publish specialist agents** — bundle a LoRA adapter, capability profile, and `MambaStateSnapshot` into a portable `AgentPackage` JSON artifact
- **Skill-based discovery** — agents are searchable by skills, evaluation score, and hire count
- **Hire and deploy** — one click to register an agent in your [BuilderForce Agents](https://builderforce.ai/agents) mesh; PowerShell install script for local deployment
- **Iterative improvement** — `training_sessions` table tracks dataset → training → evaluation → re-training loops for continuous agent quality improvement

### Local LLM Inference Pipeline
- **Per-agent inference endpoint** — `POST /api/ide/agents/:id/chat` routes inference through OpenRouter with the agent's persona injected into the system prompt; `X-Inference-Mode: lora | hybrid | base | fallback-base` header signals which path ran
- **Mamba state injection** — v2.0 agents carry a `MambaStateSnapshot`; each inference call prepends `[Memory: step=N signal=X context="..."]` to the system prompt, giving the agent persistent conversational memory without re-training
- **Mamba state sync** — `PUT /api/ide/agents/:id/mamba-state` accepts a `MambaStateSnapshot` from CoderClaw after each session; upgrades the agent package to v2.0 and recomputes `inference_mode`; `GET /api/ide/agents/:id/mamba-state` retrieves the stored snapshot
- **Package versioning** — agent packages are v1.0 (LoRA only) or v2.0 (LoRA + Mamba state); `GET /api/ide/agents/:id/package` returns the correct format and increments `request_count`
- **Workforce routing in chat** — `POST /api/ai/chat` with `model: "coderclawllm/workforce-<agentId>"` auto-routes to the agent inference endpoint; no client-side changes required
- **Inference logging** — `agent_inference_logs` table captures model ref, latency, token counts, status, and inference mode per request for observability and billing

### BuilderForce Agents Orchestration Portal
Builderforce.ai is the cloud-side control plane for [BuilderForce Agents](https://builderforce.ai/agents) self-hosted agents:

- **Fleet registration** — Claws register at `POST /api/claws` with machine profile (IP, workspace dirs, ports, tunnel metadata)
- **Heartbeat + capability sync** — `PATCH /api/claws/:id/heartbeat` keeps capability maps and machine profiles current
- **Assignment context** — `GET /api/claws/:id/assignment-context` delivers assigned project metadata and context hints; CoderClaw syncs to `.coderClaw/context.yaml`
- **Claw-to-claw mesh relay** — `ClawRelayDO` Durable Object proxies WebSocket connections between Claws; `POST /api/runtime/forward` dispatches tasks to remote agents with HMAC-SHA256 payload verification (`X-Claw-Signature`)
- **Approval gates** — human-in-the-loop control for high-impact agent actions; agents request approval before executing; outcomes are audited
- **Task management** — `tasks` and `executions` tables track work assigned to specific Claws; `POST /api/tasks/next` feeds the next task to a waiting agent

### Multi-Tenant Platform
- **JWT auth** with web token (global) + tenant token (workspace-scoped) dual-token model
- **Multi-auth** — email/password, OAuth social login (Google, GitHub, LinkedIn, Microsoft), and magic link sign-in all coexist on the same account
- **Tenant isolation** — all resources (projects, claws, agents, training jobs) are scoped to a tenant; no cross-tenant data access
- **Multi-workspace** — users belong to multiple tenants; `bf_default_tenant_id` auto-selects on login
- **Admin observability** — `/admin` surface for platform admins (superadmin flag); `logs/global-errors.txt` in R2; `/observability` LLM usage metrics

### Billing & Subscriptions (Provider-Agnostic)
- **PaymentProvider abstraction** — `src/infrastructure/payment/PaymentProvider.ts` defines the interface; swap providers by changing one env var
- **ManualProvider** (default) — no external processor; subscription activates immediately; suits manual invoicing or internal deployments
- **StripeProvider** — Stripe Checkout + Billing; hosted payment page; webhook-activated subscriptions
- **HelcimProvider** — Helcim HelcimPay.js; webhook-activated; stub ready for implementation
- **Checkout flow** — `POST /api/tenants/:id/subscription/checkout` returns either a redirect URL (hosted providers) or `null` (manual, activates immediately)
- **Webhook handler** — `POST /api/webhooks/payment` receives provider events; HMAC-verified; activates/cancels subscriptions via normalised `WebhookEvent`
- **Switching providers** — set `PAYMENT_PROVIDER=stripe|helcim|manual` + provider credentials; no application code changes required

### Dev Analytics & Team Intelligence
- **Contributor profiles** — cross-platform developer identity reconciliation (GitHub, Jira, Bitbucket); `GET /api/contributors`
- **Activity ingestion** — `POST /api/contributors/activity` receives PR opened/merged/reviewed, commit, issue events with automatic daily metric aggregation
- **Weighted activity score** — per-contributor daily score (commits×1 + PRs×3 + reviews×2 + issues×1.5); active dev day = ≥1 commit or PR action
- **PR cycle time** — end-to-end hours from `pr_opened` to `pr_merged` events tracked on each activity record
- **Integration credential manager** — AES-256-GCM encrypted platform credentials stored per-tenant; `GET/POST/PUT/DELETE /api/integrations`; per-provider connectivity tests (`POST /api/integrations/:id/test`)
- **Team hierarchy** — nested dev teams with manager–member relationships; `GET/POST/PATCH/DELETE /api/dev-teams`; member add/remove endpoints
- **Standup report** — `GET /api/reports/standup` — daily summary: active contributors, commits, PRs merged, issues resolved; recent PRs and resolved issues
- **Code review report** — `GET /api/reports/code-review` — 14-day window; stale PRs (>7 days old), average cycle time, reviewer activity
- **Executive summary** — `GET /api/reports/executive` — KPIs over configurable date range: contributor counts, total commits, PRs merged, lines added, average activity score, top contributors
- **Report schedules** — `GET/POST/PATCH/DELETE /api/reports/schedules`; cron-style delivery config (daily/weekly) with hour-of-day and recipient list
- **Report subscriptions** — `GET/POST /api/reports/subscriptions`; per-user opt-in/opt-out per report type

### Platform Infrastructure
- **Per-tenant rate limiting** — `TenantRateLimiterDO` Cloudflare Durable Object; sliding window (60 RPM FREE, 300 RPM PRO, 1000 RPM TEAMS); `X-RateLimit-Limit/Remaining/Reset` + `Retry-After` headers
- **Auto-approval rules** — `GET/POST/PATCH/DELETE /api/approval-rules`; rule evaluation on `POST /api/approvals` by actionType, max cost, max files changed; bypasses human gate when conditions match
- **Approval notifications** — Slack webhook + Resend email alerts on new approval requests and decisions; configurable via `SLACK_APPROVAL_WEBHOOK_URL` + `RESEND_API_KEY`
- **Escalation cron** — `GET /api/approvals/escalate?secret=` expires timed-out pending approvals and fires Slack alert; suitable for Cloudflare Cron Triggers
- **OTel telemetry proxy** — `POST /api/telemetry/spans` ingest; `GET /api/telemetry/spans` query; `GET /api/telemetry/traces` list; costs stored as millicent integers; W3C `X-Trace-Id` header forwarded from CoderClaw

---

## Latest Capabilities

The platform has grown from an IDE-plus-training studio into a full **system of record for agentic work**. These are the most recent additions — the enterprise delivery, quality, knowledge, and FinOps surfaces that sit on top of the agent workforce.

### Planning Spine — Portfolio to Task (mig 0213, 0225)
- **One dated, cost-bearing hierarchy** — `portfolio → initiative → epic → task`, with **Objectives and Key Results** attaching as a goal layer at any level. Every level is dated and rendered on a single nested Gantt (`PlanningSpineGantt`).
- **Cost rolls up from the leaf** — LLM spend (priced at write time from `llm_usage_log`) plus human effort (member cost rate × hours) rolls up to every ancestor. No parallel finance system, no backfill.
- **CAPEX / OPEX split** — each node carries a `cost_class` resolved in priority order (explicit → inherited → agent-classified by investment category → GAAP-conservative default). A child class that contradicts its parent is flagged as an **anomaly** for PM reconciliation.
- **Endpoints** — `GET /api/pmo/spine`, `GET /api/pmo/spine/export.csv`, `GET /api/pmo/rollup` (portfolio/initiative/workspace), `PATCH /api/pmo/cost-class`, `POST /api/pmo/cost-class/classify`, initiative `POST/DELETE /api/pmo/dependencies` (cycle-checked) → on-demand critical path. Surface: `/projects?tab=portfolio`, gated by `insights.portfolio` / `insights.pm`.

### Quality — Error Observability + One-Click Agent Fix (mig 0240)
- **Multi-source ingest** — one canonical event shape behind five adapters: **native** (the `@seanhogg/builderforce-quality` browser SDK), **OTLP**, **Sentry**, **PostHog**, **LogRocket** (webhooks HMAC-verified; Sentry connections can backfill).
- **Fingerprint grouping** — events upsert into `error_groups` keyed by `(tenant, project, fingerprint)` — explicit fingerprint or derived from the top stack frame + normalized message; occurrence + exact distinct-user counts; resolved bugs reopen on recurrence.
- **One-click fix loop** — `POST /api/quality/groups/:id/fix` creates a board task (titled + prioritized from the error, briefed with the stack trace) and dispatches a cloud agent that ships a **pull request**. Crash → group → task → PR on one surface.
- **Endpoints** — authenticated `/api/quality/*` (collectors, integrations, rules, groups, fix); public keyed/HMAC ingest `/api/quality-ingest/{events,otlp/v1/logs,otlp/v1/traces,webhooks/:collectorId/:provider}`. Dashboard: `/quality`. Metered as `error_events`.

### Knowledge Management & Compliance (mig 0227)
- **Versioned SOPs, processes & docs** — live editable body plus an **immutable snapshot on every publish** (version number + change note + publisher).
- **Audit-ready acknowledgements** — read-acknowledgements bind to a specific version with a timestamp; per-user state is **acknowledged / pending / overdue**, with manager rollups at `GET /api/knowledge/compliance` — evidence for **SOX, TISAX, ISO 27001**.
- **AI authoring + analysis** — `POST /api/knowledge/ai/draft` streams a Markdown draft; `POST /api/knowledge/documents/:id/analyze` returns structured findings (inefficiency / gap / risk / clarity) + an improved flow. Metered through the LLM gateway.
- **Real-time co-editing** — Yjs CRDT over `NEXT_PUBLIC_COLLAB_WS_URL` with presence awareness; per-document **editor/viewer** collaborators on top of workspace roles; falls back to autosave when collaboration is unconfigured. Surface: `/knowledge`.

### Single-Pane Board Connectors (mig 0221)
- **Two-way sync across 10 systems** — each provider implements `fetchTicketsSince(cursor)` + `pushUpdate(externalId, changeSet)`, normalizing to one ticket shape stamped with its source.
  - **PM / work:** GitHub Issues, Jira, Linear, monday.com, Asana, ClickUp
  - **ITSM:** ServiceNow, Freshservice
  - **Incident:** Sentry, PagerDuty
- **Webhooks where supported** (GitHub, Jira, Linear, monday, Sentry, PagerDuty), polling otherwise. Agents act on a ticket or incident wherever it originates; changes flow back to the system of origin — single pane, no migration.
- **Endpoints** — `GET /api/board-connections/providers` (catalog), CRUD `/api/board-connections`, `POST /api/board-connections/:id/sync`, `GET /api/board-connections/:id/links`.

### Platform Migration & Integration Hub (mig 0256)
Move off a competitor tracker without fear, or just sync data in — a **staged** importer on top of the connector framework. Nothing lands in real projects/tasks/members until you commit.
- **Provider discovery** — `discover()` enumerates external projects, item types, and users for **Jira, monday, Rally, GitLab, Bitbucket, GitHub** (the migration-eligible providers; new Rally/GitLab/Bitbucket adapters added).
- **Staging buffer** — `import_runs` + `import_staged_{projects,items,users}` + `import_type_mappings`; combine several external projects into one BuilderForce project, map item types → task type/status, and invite/map users — all reviewed before import.
- **Migrate / sync / both** — one-time historical import, an ongoing `board_connections` sync, or both. The persistent `board_type_mappings` makes ongoing sync land tasks in the mapped type/status (not a hardcoded backlog). Imported items keep their **assignee** (mapped to a member) and **story points**.
- **Integrations gallery** — `/settings/integrations` is the workspace home: cards by category (PM / SCM / ITSM / incident), per-provider config panel (Credentials · Connections · Activity/diagnostics), and a "Start migration" launcher. GitHub/GitLab/Bitbucket connect **both** issues (migration) **and** repositories (code).
- **Brain-drivable** — the whole flow is in the gateway MCP catalog (`integrations.create_credential`/`test`, `migrations.start`/`set_mappings`/`stage`/`commit`); the Brain (right-docked) opens the migration panel on the **left** via `open_migration_panel`.
- **Endpoints** — `/api/migrations` (start/list/get/`:id/mappings`/`:id/stage`/`:id/commit`, MANAGER+, cached + version-bumped).

### Agentic Tester — Autonomous QA (mig 0063, 0206)
- **Heatmap-ranked exploration** — journey events (`POST /api/qa/events`) rank route-and-element zones by recency-weighted frequency (`GET /api/qa/heatmap`); explorations plan from the hottest zones within a budget.
- **AI-generated Playwright** — `POST /api/qa/generate` turns a flow into an executable spec and resolves a persona credential; a deterministic heatmap-only plan is also available (no model cost).
- **Authenticated container runs** — a harness claims an exploration, logs in as a real persona (encrypted, developer-gated credentials), walks the plan, and captures console/page errors, failed requests, assertion failures, and crashes.
- **Findings → board → fix** — findings dedupe by fingerprint; with auto-routing enabled, any finding at/above the severity threshold becomes a board task in a fix lane, firing the **same lane auto-run a human board drag triggers** → a fix agent opens a PR. Schedules run it on cron. Quality trend (escaped vs caught defects) at `GET /api/qa/quality`.

### Consumption Metering (mig 0218)
- **Meter on consumption, not visibility** — one framework (`/api/consumption`) reports month-to-date usage for `ai_tokens`, `ingestion` (bytes), and `error_events` against the plan allowance, using the **same accountants the gateway and ingestion gate enforce** — so the "% used" a member sees equals the cap that's enforced. Cached 60s, keyed per tenant + calendar month.

---

## Authentication

Builderforce.ai supports three sign-in methods that coexist on the same account. A single user can link multiple OAuth providers, set a password, and use magic links interchangeably.

### Sign-in methods

| Method | How it works |
|---|---|
| **Email + password** | `POST /api/auth/web/login` — PBKDF2 (100k iterations, SHA-256); same generic error for wrong email or wrong password |
| **OAuth social login** | `GET /api/auth/oauth/:provider` → provider consent → `GET /api/auth/oauth/:provider/callback` → JWT issued; browser redirected to `/auth/callback?token=…` |
| **Magic link** | `POST /api/auth/magic-link` sends a 15-minute single-use token by email; `GET /api/auth/magic-link/verify?token=…` issues JWT; always returns 200 (no email enumeration) |

Supported OAuth providers: `google`, `github`, `linkedin`, `microsoft`.

### Auth flow diagram

```
Browser
  │
  ├─ Email/password ──────────────────────────► POST /api/auth/web/login
  │                                              Returns JWT in JSON body
  │
  ├─ OAuth (click button) ────────────────────► GET /api/auth/oauth/:provider
  │                                              302 → provider consent screen
  │                                              Provider → GET /api/auth/oauth/:provider/callback
  │                                              API issues JWT
  │                                              302 → /auth/callback?token=JWT
  │                                              Frontend page writes token to localStorage
  │
  └─ Magic link ──────────────────────────────► POST /api/auth/magic-link
                                                 Email sent with /auth/magic-link?token=…
                                                 Frontend page calls GET /api/auth/magic-link/verify
                                                 Returns JWT in JSON body
```

### JWT strategy

- **Web token** (`localStorage key: bf_web_token`) — 24-hour HMAC-SHA-256 JWT; payload: `{ sub, email, username, amr?, sa?, jti, sid }`
- **Tenant token** (`localStorage key: bf_tenant_token`) — 1-hour workspace-scoped JWT; issued by `POST /api/auth/tenant-token`
- Every issued token is tracked in the `auth_tokens` table (JTI + session ID); `webAuthMiddleware` validates against this table on every request, enabling instant revocation

### Account management endpoints

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/auth/linked-accounts` | Web JWT | List linked OAuth providers + whether account has a password |
| `DELETE /api/auth/unlink/:provider` | Web JWT | Unlink a provider; blocked if it would remove the last sign-in method |
| `POST /api/auth/add-password` | Web JWT | Add a password to an OAuth-only account |

### OAuth security

- **CSRF protection** — OAuth `state` parameter is HMAC-SHA-256 signed (using `JWT_SECRET`) with a nonce and 10-minute expiry; no database required
- **Account linking** — if an OAuth email matches an existing account, the provider is linked automatically; the user controls their email so this is safe
- **Email-only users** — OAuth users who haven't set a password are protected from the unlink endpoint; they must `POST /api/auth/add-password` first

### Enabling OAuth providers

Each provider is activated by supplying its client credentials as Cloudflare Worker secrets. Providers with missing credentials silently return `503` — you only need to configure the providers you want.

```bash
# Google
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET

# GitHub
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

# LinkedIn
wrangler secret put LINKEDIN_CLIENT_ID
wrangler secret put LINKEDIN_CLIENT_SECRET

# Microsoft
wrangler secret put MICROSOFT_CLIENT_ID
wrangler secret put MICROSOFT_CLIENT_SECRET
```

Register the OAuth callback URL in each provider's dashboard:

```
https://api.builderforce.ai/api/auth/oauth/{provider}/callback
```

Replace `{provider}` with the lowercase provider name: `google`, `github`, `linkedin`, `microsoft`.

#### Provider setup

| Provider | Setup time | Manual review? | Key gotcha |
|---|---|---|---|
| Google | ~10 min | No (for `email profile openid`) | Must publish the consent screen before non-test users can sign in |
| LinkedIn | ~10 min | No (auto-approved) | Must add the **"Sign In with LinkedIn using OpenID Connect"** product — without it the `/v2/userinfo` endpoint won't return the email address |
| GitHub | ~5 min | No | Only one callback URL per app — create a second OAuth App for local dev |
| Microsoft | ~10 min | No | Use "Accounts in any organizational directory and personal Microsoft accounts" for broadest coverage |

---

#### Google

1. Go to [console.cloud.google.com](https://console.cloud.google.com), create or select a project
2. **APIs & Services → OAuth consent screen**
   - User Type: **External**
   - App name, support email, add scopes: `email`, `profile`, `openid` (non-sensitive, no review required)
   - Add your email as a test user while in development
3. **APIs & Services → Credentials → Create Credentials → OAuth 2.0 Client ID**
   - Application type: **Web application**
   - Authorized redirect URIs — add both:
     ```
     https://api.builderforce.ai/api/auth/oauth/google/callback
     http://localhost:8787/api/auth/oauth/google/callback
     ```
4. Copy Client ID and Client Secret:
   ```bash
   wrangler secret put GOOGLE_CLIENT_ID
   wrangler secret put GOOGLE_CLIENT_SECRET
   ```

> **Publishing:** While in "Testing" mode only test users can sign in. Click **Publish App** on the consent screen when ready for production — `email/profile/openid` are standard scopes and are typically approved immediately with no manual review.

---

#### LinkedIn

1. Go to [linkedin.com/developers](https://www.linkedin.com/developers) → **Create App**
   - App name, LinkedIn Company Page (required — create one if needed), logo
2. **Auth tab** → Authorized redirect URLs — add both:
   ```
   https://api.builderforce.ai/api/auth/oauth/linkedin/callback
   http://localhost:8787/api/auth/oauth/linkedin/callback
   ```
3. **Products tab** → request **"Sign In with LinkedIn using OpenID Connect"** — click Request access (auto-approved instantly). This unlocks the `openid profile email` scopes used by the code. Without it the `/v2/userinfo` endpoint will not return the email address.
4. Back on the **Auth tab**, copy Client ID and Client Secret:
   ```bash
   wrangler secret put LINKEDIN_CLIENT_ID
   wrangler secret put LINKEDIN_CLIENT_SECRET
   ```

---

#### GitHub

1. GitHub → **Settings → Developer settings → OAuth Apps → New OAuth App**
   - Homepage URL: `https://builderforce.ai`
   - Authorization callback URL:
     ```
     https://api.builderforce.ai/api/auth/oauth/github/callback
     ```
2. Click **Register application**, then **Generate a new client secret**
3. Set secrets:
   ```bash
   wrangler secret put GITHUB_CLIENT_ID
   wrangler secret put GITHUB_CLIENT_SECRET
   ```

> **Local dev:** GitHub allows only one callback URL per app. Create a separate OAuth App (e.g. "builderforce-dev") pointing to `http://localhost:8787/api/auth/oauth/github/callback` and use its credentials in `api/.dev.vars`.

---

#### Microsoft

1. [Azure Portal](https://portal.azure.com/) → **Microsoft Entra ID → App registrations → New registration**
   - Supported account types: **"Accounts in any organizational directory and personal Microsoft accounts"**
   - Redirect URI (Web):
     ```
     https://api.builderforce.ai/api/auth/oauth/microsoft/callback
     ```
2. **Certificates & secrets → New client secret** — copy the value immediately (it's only shown once)
3. Copy the **Application (client) ID** from the Overview page
4. Set secrets:
   ```bash
   wrangler secret put MICROSOFT_CLIENT_ID
   wrangler secret put MICROSOFT_CLIENT_SECRET
   ```

---

#### Local development

For local development, use `api/.dev.vars` — Wrangler loads this file automatically for `wrangler dev`, and it is gitignored:

```ini
# api/.dev.vars
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
LINKEDIN_CLIENT_ID=your_linkedin_client_id
LINKEDIN_CLIENT_SECRET=your_linkedin_client_secret
GITHUB_CLIENT_ID=your_github_dev_app_client_id
GITHUB_CLIENT_SECRET=your_github_dev_app_client_secret
APP_URL=http://localhost:3000
```

The OAuth callback URL is derived from the incoming request's `Origin` header at runtime, so no extra `API_URL` variable is needed — it resolves to `http://localhost:8787` locally and `https://api.builderforce.ai` in production automatically.

### Magic link email

The `sendMagicLinkEmail` function in `api/src/presentation/routes/oauthRoutes.ts` is a placeholder that logs the link to the console. Wire it to your email provider (Resend, SendGrid, Mailgun, etc.) before using magic links in production:

```typescript
// api/src/presentation/routes/oauthRoutes.ts  ~line 253
async function sendMagicLinkEmail(to, name, token, frontendUrl) {
  const magicUrl = `${frontendUrl}/auth/magic-link?token=${encodeURIComponent(token)}`;
  // TODO: call your email provider here
}
```

### Frontend routes added

| Route | File | Purpose |
|---|---|---|
| `/auth/callback` | `frontend/src/app/auth/callback/page.tsx` | Receives `?token=JWT` from OAuth redirect, persists session, navigates |
| `/auth/magic-link` | `frontend/src/app/auth/magic-link/page.tsx` | Calls `/api/auth/magic-link/verify`, persists session, navigates |

---

## Integration with BuilderForce Agents

```
Developer workstation
  └─ BuilderForce Agents (self-hosted, MIT)
       ├─ 7-role agent DAG (Code, Review, Test, Debug, Refactor, Document, Architect)
       ├─ Staged diff review (accept/reject before writing to disk)
       ├─ Agent-to-agent mesh (remote:<id>, remote:auto[caps], HMAC-signed dispatch)
       ├─ Workflow telemetry → .builderforce/telemetry/ + portal timeline
       ├─ Execution lifecycle → running/completed/failed reported to portal
       ├─ Approval gate → blocks on manager decision from portal
       ├─ Skill registry → loads portal-assigned skills at startup
       ├─ Cron scheduler → executes portal-managed jobs on schedule
       └─ BUILDERFORCE_API_KEY → heartbeat → Builderforce.ai
                                                      │  ←task.assign / task.broadcast
                                                      │  ←approval.decision
                                                      │  ←cron jobs / skill assignments
                                              ┌───────▼───────┐
                                              │ Builderforce  │
                                              │  .ai          │
                                              │               │
                                              │ • Fleet view  │
                                              │ • Task assign │
                                              │ • Approvals   │
                                              │ • Audit log   │
                                              │ • AI training │
                                              │ • Registry    │
                                              │ • Cron jobs   │
                                              │ • Skills mkt  │
                                              └───────────────┘
```

**Configure CoderClaw to connect:**
```bash
export BUILDERFORCE_API_KEY=<your-api-key>
export BUILDERFORCE_URL=https://api.builderforce.ai
coderclaw start
```

CoderClaw operates fully standalone without Builderforce. The connection unlocks fleet visibility, task assignment with live execution tracking, enforced approval gates, portal-managed skill assignments, scheduled cron execution, and access to the Workforce Registry.

---

## On-Device AI Stack

Builderforce.ai is built on the open-source `@seanhogg/builderforce-memory` stack for on-device AI:

```
@seanhogg/builderforce-memory-engine  (engine)
  └─ WebGPU WGSL kernels: Mamba-1 (S6), Mamba-2 (SSD), Mamba-3 (complex MIMO+ET), causal attention
        ↓
@seanhogg/builderforce-memory  (runtime)
  └─ MambaSession.create() — one-call GPU init, tokenizer, model, checkpoint, persistence
  └─ Inference routing · distillation · semantic memory · SSMAgent
        ↓
Builderforce.ai IDE
  └─ mamba-engine.ts  — Hybrid Local Brain (SSM state + IndexedDB)
  └─ agent-runtime.ts — step() → inference → confidence scoring → cloud escalation
  └─ webgpu-trainer.ts — LoRA fine-tuning pipeline (Transformers.js + WebGPU)
```

The on-device AI layer runs in O(n) time (vs O(n²) for attention), making it suitable for continuous low-latency state updates and fine-tuning entirely in the browser.

> Both packages are published on npm: `@seanhogg/builderforce-memory-engine` (engine) and `@seanhogg/builderforce-memory` (runtime).

### Cross-surface semantic cache (token savings)

The biggest cost lever in the stack is an **embedding-keyed semantic cache** that reuses a prior answer when a new prompt is a *paraphrase* of one already answered — so the frontier model is never called for semantically-repeated work. It is two-tier and shared across surfaces:

- **L1 (local, free):** in-process cosine match using on-device SSM embeddings — runs in the browser IDE and in each agent.
- **L2 (shared):** the gateway's `POST /v1/semantic-cache/{lookup,store}` (tenant-scoped, KV-backed). A paraphrase answered in the **web app** is reusable by an **agent**, and vice-versa.

The same portable [`SemanticCache`](https://github.com/SeanHogg/builderforce-memory) from `@builderforce/memory` powers both surfaces — the embedder (on-device SSM) and the L2 backend are injected, so there is no browser/Node fork. On-device embeddings make L1 free; the gateway L2 turns one tenant's cache hits into platform-wide savings.

### Hybrid retrieval & answer evaluation

Builderforce.ai implements the full **seven-layer agent stack** — and the two layers most stacks leave conventional-thin (RAG retrieval and evaluation) are built out:

- **Hybrid RAG.** Retrieval fuses **dense** (SSM / OpenAI embeddings, cosine) and **sparse** (Okapi **BM25** keyword) signals with **Reciprocal Rank Fusion**, then reranks with **MMR** for relevance *and* diversity — over documents chunked with a recursive splitter + overlap. Dense search alone misses exact tokens (identifiers, error codes, rare names); the hybrid path catches them. It degrades gracefully (no embedding → BM25-only; no overlap → dense-only). Lives zero-dependency in `@seanhogg/builderforce-memory/retrieval` (`chunkText`, `bm25Search`, `reciprocalRankFusion`, `maximalMarginalRelevance`, `hybridRetrieve`, `MemoryStore.recallHybrid`) and powers the LanceDB long-term-memory extension.
- **Semantic evaluation + drift.** Every cloud run is scored for **faithfulness**, **answer relevance**, and **hallucination rate** — inline and zero-cost (lexical), with an **LLM-as-judge** upgrade on demand at `POST /api/eval` (billed through the metered gateway). Scores persist on the run record; a **drift monitor** (mean-shift z-score + Population Stability Index) compares baseline vs recent windows per *(action-type × model)* and raises an alert when quality regresses — daily on cron and on demand at `GET /api/eval/drift`. A wrong answer no longer hides behind a green dashboard.

See the write-up: [The AI Agent Tech Stack, Built](https://builderforce.ai/blog/agent-tech-stack-all-seven-layers).

---

## Architecture

```
┌─────────────────────────── Browser ──────────────────────────────┐
│                                                                   │
│  Next.js (App Router)           WebContainer                      │
│  ┌─────────────────────┐        ┌──────────────────────────────┐ │
│  │  Monaco Editor      │◄──────►│  Node.js (in-browser)        │ │
│  │  xterm.js Terminal  │        │  npm install                 │ │
│  │  Preview <iframe>   │        │  Vite dev server             │ │
│  │  AI Chat Panel      │        │  File system (OPFS-backed)   │ │
│  │  Train Panel        │        └──────────────────────────────┘ │
│  │  Agent Publish      │                                          │
│  └──────────┬──────────┘                                          │
│             │ HTTP / WebSocket                                     │
└─────────────┼────────────────────────────────────────────────────┘
              │
┌─────────────▼──────────── Cloudflare Edge ──────────────────────┐
│                                                                   │
│  API (api.builderforce.ai — Hono)    Durable Objects             │
│  ┌────────────────────────────┐      ┌──────────────────────┐   │
│  │ /api/auth  /api/tenants    │      │  ClawRelayDO         │   │
│  │ /api/claws /api/tasks      │      │  - claw mesh relay   │   │
│  │ /api/brain /api/projects   │      │  - heartbeat proxy   │   │
│  │ /api/runtime/executions    │      └──────────────────────┘   │
│  └────────────────────────────┘      ┌──────────────────────┐   │
│                                       │  CollaborationRoom   │   │
│  Worker (worker.builderforce.ai)      │  - Yjs CRDT sync     │   │
│  ┌────────────────────────────┐      │  - cursor presence   │   │
│  │ /api/projects (IDE files)  │      │  - terminal relay    │   │
│  │ /api/datasets /api/training│      └──────────────────────┘   │
│  │ /api/agents (Registry)     │                                   │
│  │ /api/ai/chat (streaming)   │      R2 Buckets                  │
│  └────────────────────────────┘      ┌──────────────────────┐   │
│                                       │ project files        │   │
│  Neon Postgres                        │ datasets (.jsonl)    │   │
│  ┌────────────────────────────┐      │ LoRA artifacts       │   │
│  │ users · tenants · projects │      │ agent packages       │   │
│  │ claws · tasks · executions │      └──────────────────────┘   │
│  │ agents · training_jobs     │                                   │
│  │ agent_inference_logs       │                                   │
│  │ contributors · dev_teams   │                                   │
│  │ activity_events · metrics  │                                   │
│  │ integrations · telemetry   │                                   │
│  └────────────────────────────┘                                   │
└───────────────────────────────────────────────────────────────────┘
```

**Two Cloudflare Workers, one platform:**

| | `api` (api.builderforce.ai) | `worker` (worker.builderforce.ai) |
|---|---|---|
| **Purpose** | Auth, tenants, claws, tasks, brain, marketplace, dev analytics | IDE projects, files, datasets, training, collaboration |
| **Auth** | JWT + tenant isolation | CORS (no auth currently) |
| **Durable Objects** | ClawRelayDO (claw mesh relay) | CollaborationRoom (Yjs sync) |
| **Storage** | R2 `UPLOADS` (brain files, claw assets) | R2 `STORAGE` (project files, artifacts, datasets) |

---

## Quick Start

### Local development

```bash
git clone https://github.com/SeanHogg/Builderforce.ai
cd Builderforce.ai

# Install deps
pnpm install          # or npm install in each sub-directory

# Configure
echo "NEXT_PUBLIC_WORKER_URL=http://localhost:8787" > frontend/.env.local
echo "NEON_DATABASE_URL=postgresql://..." > worker/.env

# Run migrations
cd worker && npm run migrate && cd ..

# Start (in separate terminals)
cd worker && npx wrangler dev     # :8787
cd frontend && npm run dev        # :3000
```

Open [http://localhost:3000](http://localhost:3000). WebGPU training requires Chrome 113+.

### Deploy to Cloudflare

```bash
cd api && npm run secrets:from-env && npm run deploy
# Frontend: CI/CD via .github/workflows/deploy-frontend.yml
```

**Required secrets:** `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `NEON_DATABASE_URL`, `JWT_SECRET`, `OPENROUTER_API_KEY`. (SDK publishing uses npm Trusted Publishing OIDC — no `NPM_TOKEN` secret needed; see below.)

**SDK publishing:** the [release.yml](.github/workflows/release.yml) `publish-sdk` job runs `npm publish --provenance --access public` on every push to `main`, guarded by an inline `npm view ...` check so the publish is skipped when `sdk/package.json` `version` matches what's already on npm (re-runs idempotent). Auth is via npm Trusted Publishing OIDC — configure once on the *package* (not the account) at https://www.npmjs.com/package/@seanhogg/builderforce-sdk/access → Publishing access → Add trusted publisher → GitHub Actions / Organization `SeanHogg` / Repository `Builderforce.ai` / Workflow `release.yml`. The workflow grants `id-token: write` so npm CLI 11.15+ mints the OIDC token automatically; no long-lived token in repo secrets. Bump the version in `sdk/package.json`, push to `main`, new version lands on npm.

**Optional OAuth secrets** (add only the providers you want):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`

---

## Browser Requirements

| Feature | Required |
|---|---|
| WebContainers (in-browser Node.js) | Chrome 90+, Edge 90+ (COOP + COEP headers) |
| WebGPU LoRA training | Chrome 113+ |
| Collaborative editing | Any modern browser |
| CPU fallback training | Any browser (via `forceFallbackAdapter`) |

Chrome is the recommended browser. Firefox and Safari do not support WebContainers.

---

## Design System

The UI follows the **CoderClaw deep space** aesthetic — consistent across Builderforce.ai and CoderClaw:

| Token | Dark | Light |
|---|---|---|
| `--bg-deep` | `#050810` | `#fcfeff` |
| `--bg-surface` | `#0a0f1a` | `#ffffff` |
| `--coral-bright` | `#4d9eff` | `#3b82f6` |
| `--cyan-bright` | `#00e5cc` | `#008f87` |
| `--font-display` | Clash Display | Clash Display |
| `--font-body` | Satoshi | Satoshi |

Theme persists to `localStorage('bf-theme')` with an anti-FOUC inline script applied before first paint.

---

## Roadmap & Gap Register

Planned milestones (including **PHASE 4 — Multi-Agent Orchestration at Scale**) and the full **Consolidated Gap Register** — 341 items (53 resolved · 288 open, grouped by revenue impact) plus archived thematic context — now live in **[ROADMAP.md](./ROADMAP.md)**, the single source of truth for planned work and deferred issues. New deferred issues are appended there.

---

## Cloud Agent Types

Builderforce runs agents on two execution **planes** — **On-Prem (Hosted)** and **Cloud**. There is ONE agent engine (the current version), so the Cloud plane is a single **Cloud Agent** that runs on one of **two surfaces**: a **Durable Object** or a **Node/Container**. The routing decision is a single source of truth in [cloudDispatch.ts](api/src/application/runtime/cloudDispatch.ts) (`resolveCloudSurface` / `cloudAgentTypeLabel`) and [runtimeRoutes.ts](api/src/presentation/routes/runtimeRoutes.ts) (`resolveCloudAgent`); the surface column lives on `ide_agents` (`runtime_surface` migration 0105). The engine is never read from the DB — it is always the current version.

> **Cloud vs. On-Prem is a hard boundary.** A cloud agent executes **only** in the cloud (everything is Cloudflare — Worker, Durable Object, or Container). A cloud agent is **never** dispatched to a client machine. An **On-Prem (Hosted)** agent — an *agentHost*, of which many can run on one machine — runs a task only when a host is **explicitly pinned** to it. See the agent taxonomy ([[agent-types-taxonomy]]).

### At a glance

| Cloud Agent surface | Where it runs | Persistent shell? | Best for |
|---|---|---|---|
| **Cloud Agent (Durable Object)** | `durable` — `CloudRunnerDO`, one LLM step per `alarm()` tick. **Default surface.** | No (CI verifies builds) | Most cloud tasks: on-demand, no always-on compute, survives long runs |
| **Cloud Agent (Node/Container)** | `container` — long-lived Cloudflare Container (`AgentContainerDO`) | **Yes** (`run_command`) | Very long / continuous tasks needing a real shell to install deps + run builds/tests/lint |
| *(On-Prem Hosted — for contrast)* | Client machine (agentHost), only when pinned | Yes (the host's own machine) | BYO-machine execution; not a cloud agent |

### Cloud Agent (Durable Object) — surface `durable`

The default. Runs the Claude Agent SDK tool loop fully in the cloud across Durable Object `alarm()` ticks — **one LLM step per tick**, conversation state persisted in DO storage between ticks (`CloudRunnerDO`). Inference routes through the **LLM Gateway** using the tenant's **BYO Anthropic key**.

**Features**
- One step per `alarm()` tick; each tick is a fresh Worker invocation with a fresh CPU/subrequest budget, so a multi-step run **never hits the ~30s `waitUntil` wall** that kills the interim Worker executor.
- A cursor in `state.storage` is the idempotency/resume anchor — the loop resumes exactly where it left off.
- Heartbeats `executions.updated_at` every tick, so the orphan reaper treats an actively-ticking run as alive and only reaps a genuinely silent one.
- The DO surface pins the **same model** for every tick of a run.

**Pros**
- On-demand serverless — no always-on compute, nothing to keep warm.
- Robust to long runs and eviction; the canonical, recommended cloud surface.
- Full Claude Agent SDK loop: per-tool timeline, steering/chat, approval gates.

**Cons**
- **No shell** — it cannot run builds/tests itself; correctness is verified by CI, not by the agent before finishing.
- Per-tick overhead (alarm scheduling, state rehydrate) makes it less efficient for a single very long, chatty session than a persistent process.
- Requires a tenant Anthropic key wired through the Gateway.

> When the `CloudRunnerDO` binding is absent, an **interim Worker executor** (`runCloudExecution`) runs the whole loop inline. It works but dies at the ~30s `waitUntil` wall on long runs — it exists only as a fallback until the DO is deployed.

### Cloud Agent (Node/Container) — surface `container`

The Claude Agent SDK loop running in a **persistent Node process inside a real Cloudflare Container** (`AgentContainerDO`). The container boots a small HTTP server; the DO is the Cloudflare-Containers control plane that starts/stops it and proxies the run. The container drives the loop and calls back into the Worker for every LLM step, repo telemetry, and the final PR — so the Worker stays the single source of truth for the Gateway, usage metering, and PR finalize.

**Features**
- **Real shell** (`run_command`): clone the repo, install deps, run actual builds / tests / lint, and verify before finishing.
- Persistent process — runs continuously for very long tasks without per-tick overhead.
- `enableInternet` for Gateway + GitHub reach from inside the container; stays warm `20m` after the last request, then sleeps to stop billing.
- This is also the surface an **explicitly-pinned host** maps to (a long-lived runtime reached via the relay).

**Pros**
- Genuine end-to-end verification (the agent runs the build/tests itself, not just CI).
- Best fit for long-running, continuous, or shell-heavy work.

**Cons**
- **Container infra is a future build.** Until it lands, a `container` run **falls back to the durable DO** so it still executes in the cloud — so today you do not actually get a persistent shell from this selection.
- Heaviest/most expensive surface (always-on-ish process, warm-keep billing).
- Same Gateway / tenant-Anthropic-key requirement as the durable surface.

### How a type is selected at dispatch

`resolveCloudAgent` reads the agent's `runtime_surface` from `ide_agents` (the engine is always the current version, never read); `resolveCloudSurface(agentSurface, hasExplicitHost)` then picks the surface — an explicitly-pinned host ⇒ `container`, otherwise the agent's chosen surface, defaulting to `durable`. `cloudAgentTypeLabel(surface)` produces the human label used for run attribution (`Cloud Agent (Durable Object)` / `Cloud Agent (Node/Container)`).

---

## LLM Surfaces

Builderforce exposes **three distinct LLM systems** — they are easy to conflate, and each has its own code path. Scope work against the right one:

| # | Surface | What it is | Status | Entry point |
|---|---------|------------|--------|-------------|
| **A** | **LLM Gateway** | Multi-vendor hosted chat proxy (failover, cooldowns, per-tenant budgets). Powers IDE Brain chat and studio prompt-expansion. | ✅ Shipped | [api/src/application/llm/](api/src/application/llm/), [PRD](PRD-builderforce-llm-gateway.md) |
| **B** | **Custom LLM Support** | Serve a user's fine-tuned LoRA agent to the CoderClaw CLI (`POST /api/agents/:id/chat`). | 🟡 Specced — P0 gaps open (see below) | "## Custom LLM Support" section below |
| **C** | **In-IDE `llm` modality** | Build + train a custom model in the browser (dataset → WebGPU LoRA/Mamba → publish), then chat with it. | 🟢 Cloud path live; Local/Hybrid pending | [frontend/src/lib/modality.ts](frontend/src/lib/modality.ts), [LlmStudioPanel.tsx](frontend/src/components/LlmStudioPanel.tsx) |

Cloud inference for the in-IDE modality (C) routes through the Gateway (A). On-device **Local** and **Hybrid** inference for (C) are gated until the Mamba WGSL kernel and R2 weights land — see the Consolidated Gap Register.

---

## Custom LLM Support

> **IDE spec reference:** `ide-architecture (1).md` in the repository root — the Builderforce.ai IDE
> architecture document (v2.0, March 2026).

This section details every change the Builderforce.ai platform (IDE frontend +
Cloudflare Worker backend) must make to fully support custom LLMs built through the IDE —
so that fine-tuned agents can be stored, served, versioned, and consumed by coderClaw CLI
clients in production.

### Current State vs. Required State

#### What exists today

| Component                             | Status | Notes                                            |
| ------------------------------------- | ------ | ------------------------------------------------ |
| In-browser LoRA training (WebGPU)     | ✅     | `frontend/src/lib/webgpu-trainer.ts`             |
| Adapter storage in R2                 | ✅     | `artifacts/{projectId}/{jobId}/adapter.bin`      |
| Workforce Registry (publish / browse) | ✅     | `POST /api/agents`, `GET /api/agents`            |
| Agent package download                | ✅     | `GET /api/agents/:id/package` → v1.0 JSON        |
| AI chat inference                     | ✅     | `POST /api/ai/chat` → Cloudflare AI / OpenRouter |
| Mamba State Engine (in-browser)       | ✅     | `frontend/src/lib/mamba-engine.ts`               |
| Agent Runtime SDK (in-browser)        | ✅     | `frontend/src/lib/agent-runtime.ts`              |

#### What is missing

| Gap                                             | Impact                                            | Priority |
| ----------------------------------------------- | ------------------------------------------------- | -------- |
| **No inference endpoint for custom agents**     | CoderClaw CLI cannot run a trained agent          | P0       |
| **No LoRA adapter loading on inference server** | Training produces `.bin` but nothing serves it    | P0       |
| **No `mamba_state` in DB / package**            | v2.0 agents cannot round-trip their memory        | P0       |
| **No CLI auth token**                           | CLI has no way to call Builderforce inference API | P0       |
| **`POST /api/ai/chat` ignores `model` field**   | Cannot route to `workforce-<id>`                  | P1       |
| **No agent streaming inference**                | CLI needs SSE chunked responses                   | P1       |
| **No rate limiting per API key**                | Inference endpoint open to abuse                  | P1       |
| **No agent package v2.0**                       | Mamba state not shipped with download             | P1       |
| **No usage tracking per agent**                 | Cannot bill or monitor custom model usage         | P2       |
| **No model artifact versioning**                | Cannot distinguish adapter generations            | P2       |

### Database Schema Changes

#### `agents` table — new columns

```sql
ALTER TABLE agents
  ADD COLUMN package_version  TEXT    NOT NULL DEFAULT '1.0',
  ADD COLUMN mamba_state      JSONB,
  ADD COLUMN inference_mode   TEXT    NOT NULL DEFAULT 'base',
  --   'base'    → use base_model directly (no adapter)
  --   'lora'    → load LoRA adapter from r2_artifact_key
  --   'hybrid'  → LoRA + Mamba state injection
  ADD COLUMN request_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_used_at     TIMESTAMPTZ;
```

#### New `cli_api_keys` table

```sql
CREATE TABLE cli_api_keys (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_hash      TEXT NOT NULL UNIQUE,
  label         TEXT,
  scopes        TEXT NOT NULL DEFAULT 'inference:read',
  last_used_at  TIMESTAMPTZ,
  request_count INTEGER NOT NULL DEFAULT 0,
  rate_limit    INTEGER NOT NULL DEFAULT 1000,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX cli_api_keys_user_idx ON cli_api_keys(user_id);
CREATE INDEX cli_api_keys_hash_idx ON cli_api_keys(key_hash);
```

#### New `agent_inference_logs` table

```sql
CREATE TABLE agent_inference_logs (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  cli_key_id      TEXT REFERENCES cli_api_keys(id) ON DELETE SET NULL,
  model_ref       TEXT NOT NULL,
  prompt_tokens   INTEGER,
  completion_tokens INTEGER,
  latency_ms      INTEGER,
  status          TEXT NOT NULL,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX agent_inference_logs_agent_idx ON agent_inference_logs(agent_id);
CREATE INDEX agent_inference_logs_key_idx   ON agent_inference_logs(cli_key_id);
```

### New Worker Routes

#### `POST /api/agents/:id/chat` — Agent Inference

Accepts an OpenAI-compatible chat completion request, resolves the agent's LoRA adapter, runs inference, and streams tokens back.

```typescript
app.post("/api/agents/:id/chat", async (c) => {
  const keyId = await authenticateCliKey(c);
  if (!keyId) return c.json({ error: "Unauthorized" }, 401);

  const agent = await db.query("SELECT * FROM agents WHERE id = $1", [c.req.param("id")]);
  if (!agent) return c.json({ error: "Agent not found" }, 404);

  const body = await c.req.json<ChatRequest>();
  const result = await runAgentInference({ agent, messages: body.messages, stream: body.stream ?? false, env: c.env });

  c.executionCtx.waitUntil(logInference({ agentId: agent.id, keyId, ...result.usage, env: c.env }));
  return result.response;
});
```

#### `GET/PUT /api/agents/:id/mamba-state` — Mamba State Sync

- `GET` — returns the stored Mamba state snapshot (if any)
- `PUT` — accepts an updated state from a CLI session; keeps server-side state in sync with `.coderClaw/memory/mamba-state.json`

#### `POST /api/auth/cli-key` — Issue CLI API Key

Issues a new CLI key scoped to inference. Requires a valid web token. The `rawKey` is returned once and stored only as a SHA-256 hash. The user saves it as `CODERCLAW_LINK_API_KEY`.

#### `DELETE /api/auth/cli-key/:keyId` — Revoke CLI Key

### Updated Worker Routes

#### `POST /api/ai/chat` — Workforce Routing

Detects the `workforce-<agentId>` model prefix and delegates to the agent inference service:

```typescript
const workforceMatch = body.model?.match(/^(?:coderclawllm\/)?workforce-(.+)$/);
if (workforceMatch) {
  return forwardToAgentInference(c, workforceMatch[1], body);
}
return runStandardInference(c, body);
```

CoderClaw CLI can use `model: "coderclawllm/workforce-<agentId>"` with no endpoint change required.

#### `POST /api/agents` — Accept Mamba State on Publish

Accepts `mamba_state` and `package_version` fields. Sets `inference_mode`:
- `"base"` if no `r2_artifact_key`
- `"lora"` if `r2_artifact_key` present but no `mamba_state`
- `"hybrid"` if both are present

### Inference Service Architecture

The Hono Worker selects the inference backend using this priority:

```
1. r2_artifact_key IS NOT NULL AND inference service available
   → Custom inference service (LoRA adapter applied)

2. base_model matches a Cloudflare Workers AI model id
   → Cloudflare Workers AI (base model only)

3. base_model matches an OpenRouter model id
   → OpenRouter (base model only)

4. Fallback
   → Return 503 with { error: "Inference unavailable for this agent" }
```

When the LoRA inference service is unavailable, the system degrades gracefully. The CLI surfaces the `X-Inference-Mode` header (`lora | hybrid | base | fallback-base | unavailable`) in the session banner.

**Inference service call path:**

```
CoderClaw CLI
    │
    ▼  POST /api/agents/:id/chat  (Hono Worker)
Cloudflare Worker (api.builderforce.ai)
    │  pre-sign R2 URL for adapter.bin (1hr TTL)
    ▼  POST https://inference.builderforce.ai/v1/lora-chat
Inference Service (GPU Worker / Durable Object)
    │  LRU-cached adapter loading, base model, LoRA application
    ▼  SSE chunks forwarded back through the Hono Worker
CoderClaw CLI
```

**Recommended tech stack:** Rust/Axum or Python/FastAPI; `candle` or `transformers+PEFT`; SSE streaming; LRU cache for adapter bytes and loaded models.

### CoderClaw CLI Authentication

```
1. coderclaw init  →  promptClawLink wizard
2. POST /api/auth/cli-key  { label: machineName }
3. rawKey saved to ~/.coderclaw/.env as CODERCLAW_LINK_API_KEY
4. Future requests: Authorization: Bearer <rawKey>
```

### IDE Frontend Changes

**Training Panel (`AITrainingPanel.tsx`):**
- Add "Export Mamba state" button after successful hybrid training run
- Show inference mode indicator on completed jobs: `LoRA (r=8) 🧠 +Mamba → Hybrid`

**Publish Panel (`AgentPublishPanel.tsx`):**
- Include Mamba state checkbox in publish payload (v2.0)
- Show `v2.0 🧠` / `v1.0` package version badge
- Show CLI install command: `coderclaw agent install <agentId>`

**Agent State Viewer (`AgentStateViewer.tsx` — new component):**
- Right-panel **🔬 State** tab showing Mamba state summary, channel heatmap, interaction history
- "Sync to server" button calling `PUT /api/agents/:id/mamba-state`

### API Reference — New and Changed Endpoints

| Method   | Path                          | Auth      | Description                                             |
| -------- | ----------------------------- | --------- | ------------------------------------------------------- |
| `POST`   | `/api/agents/:id/chat`        | CLI key   | Run inference on a custom agent (streaming SSE or JSON) |
| `GET`    | `/api/agents/:id/mamba-state` | CLI key   | Fetch the stored Mamba SSM state snapshot               |
| `PUT`    | `/api/agents/:id/mamba-state` | CLI key   | Push an updated Mamba state from CLI session            |
| `POST`   | `/api/auth/cli-key`           | Web token | Issue a new CLI API key                                 |
| `DELETE` | `/api/auth/cli-key/:keyId`    | Web token | Revoke a CLI API key                                    |
| `GET`    | `/api/auth/cli-keys`          | Web token | List all CLI API keys for the current user              |

| Method | Path                      | Change                                                                 |
| ------ | ------------------------- | ---------------------------------------------------------------------- |
| `POST` | `/api/agents`             | Accept `mamba_state`, `package_version` in body; set `inference_mode` |
| `GET`  | `/api/agents/:id/package` | Return v2.0 format when `mamba_state` is present                      |
| `POST` | `/api/ai/chat`            | Detect `workforce-<id>` model prefix → delegate to agent inference     |

### End-to-End Flow: CLI Inference via Custom LLM

```
1. [CLI] Load project context → modelRef = "coderclawllm/workforce-<agentId>"
2. [CLI] Advance Mamba state → memoryContext
3. [CLI] POST https://api.builderforce.ai/api/ai/chat { model, messages, stream: true }
4. [Worker] Detect workforce prefix → agentId
5. [Worker] Authenticate CLI key → check rate limit
6. [Worker] Load agent from Neon → generate pre-signed R2 URL
7. [Worker] POST https://inference.builderforce.ai/v1/lora-chat
8. [Inference] Load/cache adapter → apply LoRA → stream tokens
9. [CLI] Render tokens in TUI
10. [CLI] Persist updated Mamba state → PUT /api/agents/<agentId>/mamba-state
```

---

## Avatar Filter

The Avatar Filter is a user-facing feature that provides visibility into project status across multiple dimensions—primarily through a red-amber-green (RAG) status indicator per project. This feature enables stakeholders to quickly assess project health and prioritize work appropriately.

### Features

| Feature | Description |
|---------|-------------|
| **Project Status Indicators** | Projects display a color-coded status: <br>• 🟢 **Green** – Healthy, on track, or resolved  <br>• 🟡 **Amber** – At risk, delayed, or needs attention  <br>• 🔴 **Red** – Blocked, critical, or requires immediate action |
| **Audit Trail** | Every status change is logged to the `audit_log`, providing transparency into who made changes and when |
| **List View** | Projects can be filtered and sorted by status across list, detail, and portfolio dashboards |
| **Portfolio Integration** | Portfolio widgets aggregate status from underlying initiatives and projects for executive visibility |
| **Notification Support** | Status changes can trigger alerts when projects move into warning or critical states |

### Use Cases

- **Executive Dashboard**: Leaders view portfolio health at a glance — quickly surface projects that require management intervention
- **Project Owners**: Teams monitor their project's status and respond to green–alternative, amber, or red transitions
- **Cross-Project Visibility**: Compare project health across teams and initiatives without drilling into each project's details
- **DORA Metrics**: Status is correlated with deployment success/failure and mean-time-to-resolution (MTTR) when available

### Technical Foundation

The Avatar Filter leverages:

- **Status Fields**: Projects, initiatives, and epics carry a `status` field that resolves to RAG indicators
- **Audit Logging**: The `audit_log` table records status changes with `entity_type`, `entity_id`, `old_status`, `new_status`, `changed_by`, and `timestamp`
- **Portfolio Rollup**: `/api/pmo/rollup?kind=portfolio` aggregates status from child items via recursive queries
- **Notification Backend**: Slack/Resend hooks trigger on status changes (configurable via `SLACK_APPROVAL_WEBHOOK_URL` and `RESEND_API_KEY`)

### Integration Notes

- Status changes can originate from board workflows, portfolio management, or manual updates
- The avatar filter cascades through the portfolio hierarchy: a child's RAG color influences its parent's aggregated status
- Current focus: core RAG indicator implementation; advanced filtering (by status + metadata) and custom status transitions are future enhancements

### Reference

Refer to [`ROADMAP.md`](./ROADMAP.md) for the latest backlog items, including planned feature refinements and priority key intents.

---

## License

MIT — see [LICENSE](LICENSE).
