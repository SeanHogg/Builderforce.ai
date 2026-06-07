# Builderforce.ai

> **The professional enterprise platform for AI-powered software delivery** — build, train, and deploy AI coding agents from a browser-native IDE backed by Cloudflare's edge infrastructure.

[![Deploy Status](https://img.shields.io/badge/deploy-Cloudflare%20Pages-orange)](https://builderforce.ai)
[![Worker](https://img.shields.io/badge/api-Cloudflare%20Workers-blue)](https://workers.cloudflare.com)
[![DB](https://img.shields.io/badge/db-Neon%20Postgres-green)](https://neon.tech)

---

## What is Builderforce.ai?

Builderforce.ai is where ideas become software and software becomes agents. It combines a full in-browser IDE with an AI training pipeline, a Workforce Registry for specialist agents, and an orchestration portal for self-hosted [BuilderForce Agents](https://builderforce.ai/agents) meshes.

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
- **In-browser LoRA fine-tuning** — uses [@seanhogg/ssmjs](https://www.npmjs.com/package/@seanhogg/ssmjs) / Transformers.js with WebGPU; trains Mamba-1/2/3 and GPT-style models up to 2B parameters entirely client-side
- **Hybrid Local Brain** — Mamba State Engine (`mamba-engine.ts`) runs an O(n) selective scan alongside transformer inference; agent state persists to IndexedDB as a compact Float32 state vector and is embedded in exported `AgentPackage` JSON
- **Dataset generation** — LLM-assisted JSONL instruction dataset creation with SSE streaming progress
- **AI evaluation** — independent judge scores model outputs on code correctness, reasoning quality, and hallucination rate (0.0–1.0)
- **WebGPU fallback** — CPU software path via `forceFallbackAdapter: true`; platform reports `gpuMode: 'cpu-fallback'` transparently

### Workforce Registry
- **Publish specialist agents** — bundle a LoRA adapter, capability profile, and `MambaStateSnapshot` into a portable `AgentPackage` JSON artifact
- **Skill-based discovery** — agents are searchable by skills, evaluation score, and hire count
- **Hire and deploy** — one click to register an agent in your [BuilderForce Agents](https://builderforce.ai/agents) mesh; PowerShell install script for local deployment
- **Iterative improvement** — `training_sessions` table tracks dataset → training → evaluation → re-training loops for continuous agent quality improvement

### Local LLM Inference Pipeline (Phase 3)
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

### Dev Analytics & Team Intelligence (Phase 6)
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

Builderforce.ai is built on the open-source MambaCode.js / SSM.js stack for on-device AI:

```
MambaCode.js (@seanhogg/mambacode.js)
  └─ WebGPU WGSL kernels: Mamba-1 (S6), Mamba-2 (SSD), Mamba-3 (complex MIMO+ET), causal attention
        ↓
SSM.js (@seanhogg/ssmjs)
  └─ MambaSession.create() — one-call GPU init, tokenizer, model, checkpoint, persistence
  └─ Inference routing · distillation · semantic memory · SSMAgent
        ↓
Builderforce.ai IDE
  └─ mamba-engine.ts  — Hybrid Local Brain (SSM state + IndexedDB)
  └─ agent-runtime.ts — step() → inference → confidence scoring → cloud escalation
  └─ webgpu-trainer.ts — LoRA fine-tuning pipeline (Transformers.js + WebGPU)
```

The on-device AI layer runs in O(n) time (vs O(n²) for attention), making it suitable for continuous low-latency state updates and fine-tuning entirely in the browser.

> The engine + runtime were consolidated and renamed to `@builderforce/memory-engine` (was `@seanhogg/mambacode.js`) and `@builderforce/memory` (was `@seanhogg/ssmjs`). The diagram above keeps the historical names; new code should import the `@builderforce/*` scope.

### Cross-surface semantic cache (token savings)

The biggest cost lever in the stack is an **embedding-keyed semantic cache** that reuses a prior answer when a new prompt is a *paraphrase* of one already answered — so the frontier model is never called for semantically-repeated work. It is two-tier and shared across surfaces:

- **L1 (local, free):** in-process cosine match using on-device SSM embeddings — runs in the browser IDE and in each agent.
- **L2 (shared):** the gateway's `POST /v1/semantic-cache/{lookup,store}` (tenant-scoped, KV-backed). A paraphrase answered in the **web app** is reusable by an **agent**, and vice-versa.

The same portable [`SemanticCache`](https://github.com/SeanHogg/builderforce-memory) from `@builderforce/memory` powers both surfaces — the embedder (on-device SSM) and the L2 backend are injected, so there is no browser/Node fork. On-device embeddings make L1 free; the gateway L2 turns one tenant's cache hits into platform-wide savings.

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

## Self-Bootstrapping: Using CoderClaw to Build CoderClaw

> A step-by-step walkthrough of using coderClaw's own agent features to execute
> its platform roadmap. This is both a practical guide and a case study in
> recursive self-improvement — an AI coding agent improving its own source code.

### Overview

CoderClaw has multi-agent orchestration, 7 specialized roles, session handoff,
and a project knowledge system. The idea: instead of a human writing every line
of code on the roadmap, **coderClaw executes the roadmap items itself**, with the
human acting as manager — reviewing, approving, and steering.

There's a catch: several key features are **facades** (code exists but is never
called). This guide shows how to fix those gaps first, then progressively unlock
more sophisticated self-improvement capabilities.

### Prerequisites

- coderClaw installed and working (`coderclaw` TUI launches successfully)
- Access to an LLM provider (Anthropic, OpenAI, etc.)
- Both repos cloned: `coderClaw/` and `builderforce.ai/`

### Phase Map

```
┌─────────────────────────────────────────────────┐
│  Phase -1: Fix the engine                       │
│  (single-agent, manual sequencing)              │
│                                                 │
│  -1.1 Wire executeWorkflow()                    │
│  -1.2 Wire agent roles                          │
│  -1.3 Wire session handoff         ◄── unlock   │
│  -1.4 Workflow persistence              auto-   │
│  -1.5 Knowledge loop                   resume   │
│  -1.6 Mesh plumbing                             │
├─────────────────────────────────────────────────┤
│  Phase 0-5: Build the platform                  │
│  (multi-agent orchestrated workflows)           │
│                                                 │
│  After -1.1 + -1.2: orchestrate tool works      │
│  After -1.3: sessions resume automatically      │
│  After -1.5: knowledge stays current            │
│  After -1.6: claws collaborate across machines  │
└─────────────────────────────────────────────────┘
```

### Step 1: Initialize Project Context

```bash
cd coderClaw
coderclaw init
```

This creates `.coderClaw/` with:

- `context.yaml` — project metadata (languages, frameworks, architecture)
- `architecture.md` — module graph skeleton
- `rules.yaml` — coding conventions (TypeScript ESM, Vitest, Oxlint, etc.)
- `agents/` — custom agent role definitions (YAML)
- `skills/` — project-specific skills
- `memory/` — persistent knowledge
- `sessions/` — session handoff documents

**Also initialize for builderforce.ai** if you'll work on both repos:

```bash
cd ../builderforce.ai
coderclaw init
```

### Step 2: Add Planning Knowledge

Copy the roadmap and analysis docs into the `.coderClaw/planning/` directory:

```bash
cd coderClaw
mkdir -p .coderClaw/planning
```

The planning directory should contain:

- `CAPABILITY_GAPS.md` — the 6 gaps audit (what's real vs. facade)
- `BOOTSTRAP_PROMPT.md` — the seed prompt for coderClaw
- `README.md` — index with cross-references to workspace-root ROADMAP.md

### Step 3: Understand the Gaps

Before running any prompt, understand what **doesn't work**:

| #   | Gap                                                | Effect                               |
| --- | -------------------------------------------------- | ------------------------------------ |
| 1   | `orchestrate` tool never calls `executeWorkflow()` | Multi-agent workflows are inert      |
| 2   | Agent roles defined but never applied              | All agents behave identically        |
| 3   | Session handoff never saved/loaded                 | Zero cross-session continuity        |
| 4   | Workflow state is in-memory only                   | Process restart = state loss         |
| 5   | No post-task knowledge update                      | `.coderClaw/` goes stale immediately |
| 6   | Mesh is branding, not code                         | Claws can't collaborate              |

**Gaps 1-4 are blocking.** You cannot use multi-agent workflows until Gap 1 is
fixed. You cannot get role-specific behavior until Gap 2 is fixed. Sessions
won't resume until Gap 3 is fixed.

### Step 4: Run the Bootstrap Prompt

Open the coderClaw TUI and paste the bootstrap prompt from
`.coderClaw/planning/BOOTSTRAP_PROMPT.md`:

```bash
cd coderClaw
coderclaw
```

Then paste the prompt from the "The Prompt" section of BOOTSTRAP_PROMPT.md.
This gives coderClaw full awareness of:

- Its own architecture and conventions
- The 6 capability gaps
- The roadmap priority order
- The manual execution strategy for single-agent mode

### Step 5: Execute Phase -1.1 (Wire executeWorkflow)

This is the most important item. coderClaw will:

1. **Plan**: Read `orchestrate-tool.ts` and `orchestrator.ts`, produce a PRD
   and architecture spec
2. **Review**: Critique its own spec for edge cases
3. **Implement**: Add the `executeWorkflow()` call, wire `planning` and
   `adversarial` workflow types, add streaming progress
4. **Test**: Write vitest tests for the wired orchestrator
5. **Review**: Check AGENTS.md compliance
6. **Commit**: via `scripts/committer`

**Your role as manager**: Review output between each step. Provide feedback.
Approve or reject.

### Step 6: Execute Phase -1.2 (Wire Agent Roles)

Start a new session:

```
Resume the coderClaw self-improvement initiative. The previous session
completed Phase -1.1 (wire executeWorkflow into the orchestrate tool).
Read .coderClaw/planning/CAPABILITY_GAPS.md to see current gap status.
The next item is Phase -1.2: Bridge agent-roles.ts into the agent runtime.
Read the ROADMAP.md Phase -1.2 section and begin planning.
```

After this is done, the orchestrate tool should spawn subagents that actually
behave differently based on their role (code-reviewer can't create files,
architecture-advisor has high thinking, etc.).

**Verification**: Run `orchestrate feature "add a hello world function"` and
observe that each spawned agent uses its role-specific system prompt and tools.

### Step 7: Transition to Multi-Agent Mode

Once Phase -1.1 and -1.2 are complete, you can switch from manual sequencing
to the orchestrate tool:

```
Use the orchestrate tool to create a planning workflow for:
"Phase -1.3 — Wire session handoff save/load. See CAPABILITY_GAPS.md Gap 3."
```

Review the planning output, then:

```
Use the orchestrate tool to create an adversarial review for:
"The architecture spec for Phase -1.3 session handoff wiring"
```

Review and approve, then:

```
Use the orchestrate tool to create a feature workflow for:
"[specific sub-task from the planning output]"
```

**This is the inflection point**: coderClaw is now using the features it just
built to build more features.

### Step 8: Continue Through the Roadmap

Each subsequent phase follows the same pattern:

1. Start session (manual prompt or auto-resume via handoff after Phase -1.3)
2. Plan (planning workflow or manual)
3. Adversarial review (for complex items)
4. Implement (feature/bugfix/refactor workflow)
5. Test and review
6. Commit
7. Update knowledge (manual until Phase -1.5 automates it)

### Phase progression and what each unlocks

| After completing... | You unlock...                                                              |
| ------------------- | -------------------------------------------------------------------------- |
| Phase -1.1          | Multi-agent workflows actually execute                                     |
| Phase -1.2          | Agents have role-specific behavior                                         |
| Phase -1.1 + -1.2   | Full orchestrate tool (planning, adversarial, feature, refactor workflows) |
| Phase -1.3          | Sessions resume automatically — no more re-explaining context              |
| Phase -1.4          | Workflows survive process restarts                                         |
| Phase -1.5          | Knowledge stays current — agents always have fresh context                 |
| Phase -1.6          | Claws can delegate to other claws (mesh)                                   |
| Phase 0             | Claw ↔ Builderforce connection works end-to-end                            |
| Phase 1             | Full observability — you see cost/duration/success per task                |
| Phase 2             | LLM proxy with budget gating + approval workflows                          |
| Phase 3             | Local model execution for cheap drafts                                     |
| Phase 4 ✅          | Visual DAG UI, cross-claw context + memory mesh, shared OpenAPI contract   |
| Phase 5             | Production-scale fleet with audit trail                                    |

### The Feedback Loop

```
Fix orchestrator  →  Workflows actually run
      ↓
Fix roles        →  Agents behave correctly per workflow step
      ↓
Fix handoff      →  Sessions resume — multi-session roadmap work
      ↓
Fix knowledge    →  Agents see updated codebase after changes
      ↓
Fix mesh         →  Multiple claws collaborate on complex tasks
      ↓
Build platform   →  CoderClaw is a production AI coding mesh
```

### Tips for Human Managers

1. **Review every plan before approving implementation.** The adversarial
   review catches most issues, but you know the product vision.

2. **Scope sessions tightly.** One roadmap item per session until session
   handoff works (Phase -1.3). After that, multi-session work flows naturally.

3. **Check test output.** Run `pnpm vitest --run` on affected files before
   approving commits.

4. **Track cost.** Use the `model-usage` skill to see token spend. Once
   Phase 1 (observability) is done, the dashboard shows this automatically.

5. **Don't fix coderClaw with something other than coderClaw.** The whole
   point is to validate the platform by using it. If you find yourself
   reaching for a separate tool, that's a signal coderClaw needs another
   feature — add it to the roadmap.

6. **Update the gap checklist.** After each Phase -1 item, update
   `.coderClaw/planning/CAPABILITY_GAPS.md` to mark the gap as resolved
   and verify against the checklist.

### Cross-Repo Work

Some roadmap items touch both `coderClaw/` and `builderforce.ai/`. Run separate
sessions in each repo:

```bash
# Session 1: coderClaw side
cd coderClaw
coderclaw
> [implement the claw-side changes]

# Session 2: builderforce.ai side
cd builderforce.ai
coderclaw
> [implement the Link-side changes]
```

Each session uses its repo's `.coderClaw/context.yaml` — the agent understands
the local codebase automatically.

### Troubleshooting

**"Workflow created" but nothing happens** — Phase -1.1 isn't complete. The orchestrate tool creates workflows but doesn't execute them. Use the manual single-agent sequence instead.

**Agents all behave the same regardless of role** — Phase -1.2 isn't complete. Role definitions exist but aren't applied. Manually prompt "You are acting as code-reviewer" etc.

**Session starts with no context from previous work** — Phase -1.3 isn't complete. Session handoff is dead code. Manually include prior session context in your prompt.

**`.coderClaw/architecture.md` is outdated** — Phase -1.5 isn't complete. Manually run `/knowledge update` or regenerate by re-running `coderclaw init`.

**Can't delegate work to another claw** — Phase -1.6 isn't complete. Mesh is not implemented. All work happens on the local claw.

---

## PHASE 4 — Multi-Agent Orchestration at Scale [Q3 2026]

These items completed the platform's multi-claw coordination layer. All five are shipped.

### P1 — Visual Task Dependency Graph

- [x] **Backend** — `GET /api/workflows/:id/graph` endpoint (`workflowRoutes.ts`): merges `workflowTasks` dependency edges with live telemetry spans into a DAG response (`nodes` + `edges`)
- [x] **Frontend** — `WorkflowDagView.tsx`: pure-SVG topological layout (Kahn's algorithm), status-colored nodes, cubic-bezier edges, duration/cost annotations
- [x] **Frontend** — Tasks/Graph tab switcher in `WorkflowsContent.tsx` — detail view fetches graph lazily on first tab open

### P1 — Cross-Claw Context Sharing

- [x] **Backend** — `GET /api/claws/:id/context-bundle` endpoint (`clawRoutes.ts`): returns the last-synced `.coderClaw/` files as a JSON bundle (`{ files: [{ path, content, sha256 }] }`)
- [x] **Relay** — `builderforce-relay.ts` fetches the context bundle from the origin claw before forwarding a `remote.task` frame; SHA-256 deduplicates unchanged files
- [x] **Schema** — `ContextBundleResponse` type in `openapi/schema.ts` and `api-contract.ts`

### P1 — Streaming Result Aggregation

- [x] **Backpressure** — `remote-result-broker.ts`: max 5 concurrent remote tasks, FIFO wait queue, 600 s default timeout
- [x] **Retries** — `remote-subagent.ts`: 3-attempt exponential backoff (500 ms → 1 s → 2 s) on network errors and 5xx responses; emits `task.retry` telemetry spans
- [x] **Mesh UX** — `FleetMeshContent.tsx`: SVG fleet graph (hub + claw nodes), real-time online/offline indicators, remote dispatch panel with preset payloads; rendered on the Workforce page when ≥2 claws are registered

### P2 — Shared OpenAPI Contract

- [x] **Builderforce** — `src/openapi/schema.ts`: TypeScript interfaces for every CoderClaw ↔ Builderforce endpoint (registration, heartbeat, forward, context-bundle, telemetry, workflows, team memory)
- [x] **CoderClaw** — `src/infra/api-contract.ts`: mirror declarations so the claw has zero runtime dependency on the server package
- [x] **Endpoint** — `GET /api/openapi.json` (in `index.ts`): OpenAPI 3.1 document served from production at `https://api.builderforce.ai/api/openapi.json`

### P2 — Cross-Claw Memory Sharing (Team Memory Mesh)

- [x] **Backend** — `POST /api/teams/memory` + `GET /api/teams/memory` (`teamMemoryRoutes.ts`): claw-key or tenant-JWT auth, `#private` tag support, newest-first pagination
- [x] **Client** — `KnowledgeLoopService.pushMemoryToMesh()` in `knowledge-loop.ts`: fires after every completed agent run, pushes activity summary + tags to the mesh; `pullTeamMemory()` caches entries in `.coderClaw/memory/team-memory.json` (5 min TTL)
- [x] **Schema** — `TeamMemoryEntry` type in `openapi/schema.ts` and `api-contract.ts`

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

### Implementation Checklist

#### Phase 1 — Authentication & Package v2.0 (P0)

- [ ] Schema migration — `cli_api_keys` table
- [ ] Schema migration — Add columns to `agents` table (`package_version`, `mamba_state`, `inference_mode`, `request_count`, `last_used_at`)
- [ ] `POST /api/auth/cli-key` — issue API key, return raw key once
- [ ] `GET /api/agents/:id/package` — v2.0 response when `mamba_state` is set
- [ ] `POST /api/agents` — accept `mamba_state` and `package_version` fields
- [ ] Frontend: Publish panel — Mamba state checkbox and CLI install command
- [ ] CoderClaw CLI — `coderclaw init` calls `POST /api/auth/cli-key` and saves key

#### Phase 2 — Inference Routing (P0)

- [ ] `POST /api/ai/chat` — detect `workforce-<id>` model prefix, delegate
- [ ] `POST /api/agents/:id/chat` — full inference endpoint with auth + logging
- [ ] `runAgentInference()` with fallback chain
- [ ] Schema migration — `agent_inference_logs` table
- [ ] Rate limiting — enforce per-key daily request quota

#### Phase 3 — Inference Service (P1)

- [ ] Deploy inference microservice — Cloudflare WASM or GPU worker
- [ ] LoRA adapter caching — LRU in-memory / KV store
- [ ] `X-Inference-Mode` header — signal whether adapter was applied
- [ ] `PUT /api/agents/:id/mamba-state` — sync from CLI

#### Phase 4 — Observability & UX (P2)

- [ ] `GET /api/agents/:id/mamba-state` — read stored state
- [ ] Frontend: Agent State Viewer — `AgentStateViewer.tsx` component
- [ ] Frontend: Training panel — inference mode indicator on completed jobs
- [ ] Usage dashboard — per-agent request counts, latency percentiles
- [ ] `coderclaw agent list` — CLI command to browse Workforce Registry

---


---

## Consolidated Gap Register

Roadmap entries that remain after this pass. Items closed in this pass have been removed (rather than marked done) — `git log` is the audit trail.

- **Cloudflare account API token was leaked to chat transcript on 2026-05-23.** A real `cfut_*` Workers AI token was pasted as part of a curl example and is now in conversation history (cacheable / loggable on any party that handled the message). The key was never committed to the repo (read from `env.CLOUDFLARE_AI_API_TOKEN` set via `wrangler secret put`), but the leaked token still grants Workers AI quota until rotated on the Cloudflare dashboard (My Profile → API Tokens → roll the existing token). Fixing (rotate the token in the Cloudflare dashboard and `npm run secrets:from-env` after updating `api/.env`) unblocks: confidence that the leaked credential is dead. Mirrors the existing NVIDIA-API-key-leak entry from 2026-05-10 — same playbook.
- **Newly added catalog model ids (openrouter free + paid + Cloudflare `@cf/...`) are unverified.** This pass added ~15 new entries to [api/src/application/llm/vendors/openrouter.ts](api/src/application/llm/vendors/openrouter.ts) (`openrouter/owl-alpha`, `deepseek/deepseek-v4-flash:free`, `arcee-ai/trinity-large-thinking:free`, `openai/gpt-oss-20b:free`, `meta-llama/llama-3-8b-instruct`, `google/gemma-3-4b-it`, `microsoft/phi-4`, `qwen/qwen3.5-9b`, `z-ai/glm-4-32b`, `openai/gpt-5-nano`, `openai/o4-mini`, `alibaba/qwen3.5-397b-a17b`) and one entry to [api/src/application/llm/vendors/cloudflare.ts](api/src/application/llm/vendors/cloudflare.ts) (`@cf/meta/llama-3-8b-instruct`). Operator gave the ids by hand without an `/v1/models` cross-check; wrong ids will surface as `404` from the upstream and the cascade will skip them (vendor cooldown drops them after 3 misses in 60s). Same drift risk as the existing NVIDIA NIM entry below. Fixing (curl `https://openrouter.ai/api/v1/models` with the OpenRouter key and `https://api.cloudflare.com/client/v4/accounts/<id>/ai/models/search` with the Cloudflare token, reconcile each vendor's catalog against live ids — remove or correct any 404'ing entries) unblocks: clean cascade ordering with no wasted attempts on phantom models.
- **`classifyFailure` lumps `400` request-validation errors into `transient` and trips vendor cooldown on them.** [cooldownStore.ts `classifyFailure`](api/src/infrastructure/auth/cooldownStore.ts) classifies anything that isn't `401`/`403`/`embedded:*` as `transient`, which means a 400 (e.g. Cerebras rejecting a `response_format: { type: 'json_schema', json_schema: { schema: {...} } }` with `"Unsupported JSON schema fields in schema with keys: dict_keys([])"` — Python repr leaking from their validator) cools the model *and* contributes to the vendor's transient-failure ring buffer, eventually tripping vendor cooldown. The 400 is about the *caller's request*, not vendor saturation; cooling Cerebras for unrelated future requests is wrong. Observed in production (`llm-b9a3db1b-...` correlation id, 2026-05-23): five of six caller-side attempts received Cerebras 400 echoes because Cerebras kept landing at the head of the cascade and 400ing the same malformed schema. Fixing (introduce a `request_error` cooldown class for `400`/`422`, write neither model nor vendor cooldown for it, surface the error as fatal once every candidate has 400'd so the caller gets a usable diagnostic instead of a generic 429 cascade-exhausted) unblocks: vendors stop being penalised for caller-side schema bugs, AND callers get a 4xx that actually tells them the schema is invalid instead of a misleading 429.
- **NVIDIA NIM catalog model ids are wrong in production — 404s observed live.** Re-confirms the existing entry below: in the 2026-05-23 `llm-b9a3db1b-...` trace, both `mistralai/mistral-large-3-675b-instruct-2512` (returned `408` after our timeout) and `nvidia/mistral-nemotron` (`404`) appeared in the cascade for a caller-pinned `anthropic/claude-3-haiku` request — burning two attempts on doomed model ids. Compounds the "paid failover" bug closed in this pass because NVIDIA is the only non-OpenRouter vendor in the paid pool, so when the cascade falls through, it lands on the broken ids. Fixing (curl `https://integrate.api.nvidia.com/v1/models` with the API key, reconcile against [api/src/application/llm/vendors/nvidia.ts](api/src/application/llm/vendors/nvidia.ts) — verified-id allowlist only, drop the inferred org-prefix entries) unblocks: paid cascade tail actually reaches working models when OpenRouter is saturated.
- **`model` is a hint, not a hard pin — diverges from the consumer's contract draft.** The SDK consumer's gap analysis explicitly asked for "no 'best available' substitution by gateway. Gateway routes by string." [LlmProxyService.complete()](api/src/application/llm/LlmProxyService.ts) implements the opposite: caller's `model` heads the candidate chain, gateway substitutes on cooldown / vendor failure / plan mismatch, the actual model surfaces via `_builderforce.resolvedModel`. The consumer's `tryProfileChain` will still work — they advance their chain when `resolvedModel !== requestedModel` indicates substitution. If a strict-pin mode is needed (for evaluations, reproducibility), expose it as a separate `?strict=true` query param or a `_builderforce: { strict: true }` request hint that disables the gateway's failover for that single call. Fixing (deciding whether to add strict mode) unblocks: deterministic eval runs against a specific model.
- **`ClawRepository.updateStatus` / `clawService.deactivate` cache-invalidation is fixed at every route path; not yet pushed into the abstraction.** All four claw mutation routes — `DELETE /api/claws/:id`, `PATCH /:id/status`, `PATCH /:id/limits`, and now `DELETE /api/claws/:id/nodes/:nodeId` (the deactivation path that previously bypassed it) — call [invalidateKeyCache](api/src/infrastructure/auth/keyResolutionCache.ts). Remaining foot-gun: [ClawRepository.updateStatus](api/src/infrastructure/repositories/ClawRepository.ts) + [clawService.deactivate](api/src/application/claw/ClawService.ts) still don't self-invalidate, so a *new* future caller without a route-level invalidate would leave a stale "active" `clk_*` cache for up to a year. Fixing (thread `env`/KV into the repo/service so invalidation lives with the mutation) unblocks: invalidation new callers can't forget. Lower priority now that all current paths invalidate.
- **Cooldown TTL is fixed-by-classification (5 min transient / 30 min auth) — no automatic recovery probing.** [cooldownStore.ts](api/src/infrastructure/auth/cooldownStore.ts) keeps a model cooled for the full TTL even when the vendor recovers earlier. A real outage that lasts 1 minute pulls the model from the chain for 5 min total (4 min of unnecessary skipping). Fixing (background health probe that lifts the cooldown early when a HEAD request returns 200) unblocks: tighter recovery from short-lived vendor blips.
- **Per-vendor-call timeout: tenant-level override landed, per-call body override still open.** [vendors/types.ts](api/src/application/llm/vendors/types.ts) `DEFAULT_VENDOR_CALL_TIMEOUT_MS = 25_000` is now overridable per call via `VendorCallParams.timeoutMs`, and the premium-routing path ([LlmProxyService.PREMIUM_VENDOR_CALL_TIMEOUT_MS](api/src/application/llm/LlmProxyService.ts) = 60_000) drives it for tenants flagged with `premium_override`. **Still missing:** a per-request override (`body._builderforce: { vendorTimeoutMs }` or per-`useCase` profile) so a *non-premium* tenant can opt one long call into the extended budget. Fixing unblocks: long-form workloads on plan-default tenants that occasionally need >25s/vendor without flipping the whole tenant to premium.
- **JWT auth path is not cached.** [requireTenantAccess](api/src/presentation/routes/llmRoutes.ts) caches `bfk_*` and `clk_*` lookups in KV but the JWT branch still hits Neon for `tenants` + `tenant_members` on every request. JWT calls are typically lower-volume than `bfk_*` (browser sessions vs server-to-server), so this is a smaller wins/effort ratio — but worth caching with the same TTL once volume warrants. Fixing unblocks: faster auth for browser-side calls.
- **`Idempotency-Key` MVP returns 409, doesn't replay the original response body.** The gateway now refuses to re-dispatch when `(tenant_id, idempotency_key)` was used in the last 10 min ([llmRoutes.ts](api/src/presentation/routes/llmRoutes.ts) — `code: 'idempotent_replay'`), preventing double-charge on cron retries. **What's still missing:** caching + replaying the original 200 response body, which requires a Cloudflare Workers KV namespace (provisioned via `wrangler kv:namespace create` and added to `wrangler.toml`). Until that lands, retried cron jobs see a 409 instead of the original answer. Fixing unblocks: transparent cron retries that get the cached output.
- **Gateway-side strict-pin mode for `model` is not implemented.** The gateway treats `model` as a hint and may substitute on cooldown / failure ([LlmProxyService.complete()](api/src/application/llm/LlmProxyService.ts)). Workaround documented in [SCENARIOS.md](sdk/docs/SCENARIOS.md) — caller reads `_builderforce.resolvedModel` and rejects when it differs from the request. Adding a server-side `body.strict: true` flag (or `?strict=true` query) that skips substitution + 503s when the named model is unavailable would let eval / reproducibility runs reject without the round-trip. Fixing unblocks: deterministic A/B evaluations against a specific model.
- **Streaming tool-call deltas don't have name restoration.** The bidirectional tool-name sanitizer ([toolNameSanitizer.ts](api/src/application/llm/toolNameSanitizer.ts)) restores dotted names in non-streaming responses, but streaming `ToolCallDelta` chunks carry the sanitized form because the name arrives in fragments and stitching across deltas is brittle. Consumers using streaming + tool calls today must call `restoreToolName()` themselves on the stitched delta. Fixing (a delta-aware restore that buffers name fragments per tool-call index) unblocks: streaming + tool-calling consumers.
- **Per-user sub-ledger from `metadata.userId` is not implemented.** The gateway debits the tenant's daily plan budget; if the SDK's `metadata.userId` is set, the gateway could maintain a per-user sub-ledger and enforce per-user caps. Tenant apps continue to enforce per-user budgets locally. Needs a product decision (per-user cap UX in the portal) plus a `tenant_user_token_caps` table and a query in the chat route. Fixing unblocks deletion of tenant-side `tokenLedger.charge` plumbing.
- **Gateway-side strict-mode validation only fires when consumers send `response_format: { type: 'json_schema', strict: true }`.** Today consumers like hired.video do their own client-side Zod validation after the fact and never set `response_format` on the outbound request, so the gateway can't help them retry the chain on schema mismatches — even though [jsonSchemaValidator.ts](api/src/application/llm/jsonSchemaValidator.ts) now supports it fully. Fixing (consumer-side migration: send `response_format: { type: 'json_schema', json_schema: { strict: true, schema } }` instead of post-call Zod) unblocks: cross-vendor retry on strict-schema failures, deletion of tenant-side retry loops, less wasted budget burning models that can't conform.
- **Embeddings is single-vendor (OpenRouter only).** [callOpenRouterEmbeddings](api/src/application/llm/vendors/openrouter.ts) is the only implementation. No failover yet — if OpenRouter's embeddings endpoint is down, embeddings calls fail. Lift the function into an `EmbeddingsVendorModule` shape mirroring chat vendors and add at least one alternate (Cohere or Voyage). Fixing unblocks single-vendor outage resilience for vector workflows.
- **Project deletion still cascade-deletes *archived* tasks even when the user moves the open ones.** The new [DeleteProjectDialog](frontend/src/components/DeleteProjectDialog.tsx) prompts to move *open* (non-archived) tasks to another board before deleting, but archived tasks on the board are silently removed by the DB cascade ([tasks.projectId `onDelete: 'cascade'`](api/src/infrastructure/database/schema.ts)). The dialog's "N open tasks" wording matches what it moves, so the loss is bounded to archived items. Fixing (either also move archived tasks, or surface a separate "M archived tasks will be deleted" line in the dialog) unblocks: zero silent data loss on project delete. Lower priority — archived tasks are already hidden/closed.
- **`builderforce.ai/docs/*` mount needs deploy + post-deploy verification.** Root cause of the live `404 /docs/agents-vs-alternatives` (and *all* docs paths): the apex `builderforce.ai` is a Pages custom domain bound to the Next frontend worker ([frontend/wrangler.toml](frontend/wrangler.toml)), which answered `/docs/*` with its own 404 because nothing forwarded those requests to the separate `builderforce-docs` Pages project. Fixed in this pass by a same-origin reverse-proxy rewrite in [frontend/next.config.js](frontend/next.config.js) (`/docs` + `/docs/:path*` → `https://builderforce-docs.pages.dev/docs/...`). Two follow-ups remain: (1) **the currently-live `builderforce-docs` artifact is stale — it serves the docs at root (`/`) instead of `/docs/`, i.e. it was built before Astro `base: '/docs'` was added** ([docs-site/astro.config.mjs](docs-site/astro.config.mjs)); the rewrite targets `/docs/*`, so the docs project MUST be redeployed via the `deploy-docs` job ([.github/workflows/release.yml](.github/workflows/release.yml)) for links to resolve — both deploys happen automatically on the next push to `main`. (2) **Verify post-deploy that `@cloudflare/next-on-pages@^1.13.16` actually *proxies* the external rewrite via `fetch` rather than 301-redirecting to `builderforce-docs.pages.dev`** — some next-on-pages versions mishandle absolute-URL `dest`. If it redirects (URL bar changes / cross-origin), fall back to a Cloudflare Workers Route `builderforce.ai/docs/*` → a tiny proxy worker, or bind the docs Pages project to `docs.builderforce.ai` and rewrite to that host. Fixing unblocks: every `/docs/*` link across the marketing site (FeatureCard, integrations page) resolving same-origin.
- **72 React-hooks ergonomics warnings demoted from error to warn.** [frontend/eslint.config.js](frontend/eslint.config.js) downgrades `react-hooks/set-state-in-effect`, `react-hooks/refs`, `react-hooks/purity`, `react-hooks/immutability`, and `react-hooks/preserve-manual-memoization` because `eslint-plugin-react-hooks` v6 + the React Compiler plugin started flagging dozens of legitimate pre-existing patterns (fetch-on-mount, ref-mirror, manual `useCallback`) as errors and broke the deploy. Patterns themselves are not bugs — ergonomics suggestions. Fixing (refactor each warning to the React-Compiler-blessed shape, then re-promote to error) unblocks: catching genuinely-unsafe state mutations during review.
- **Agent discovery tags ("Tags / Labels") aren't surfaced to crawlers server-side.** The agent `skills` field (relabeled "Tags / Labels" on the Workforce Details tab in [CloudAgentFormFields.tsx](frontend/src/components/workforce/CloudAgentFormFields.tsx)) now powers marketplace client-side search ([marketplace/page.tsx](frontend/src/app/marketplace/page.tsx) filters on `agent.skills`) and renders as crawlable chips, but the marketplace page is `'use client'` and fetches agents via `listAgents()` after hydration — so there's no server-rendered per-agent JSON-LD (`ItemList`/`SoftwareApplication`) nor agent keywords in the route metadata ([marketplace/layout.tsx](frontend/src/app/marketplace/layout.tsx) is static). To make the tags count for SEO/GEO, fetch published agents server-side (RSC or generateMetadata) and emit an agent structured-data block via [structured-data.ts](frontend/src/lib/structured-data.ts) with the tags as `keywords`. Fixing unblocks: search-engine/LLM discovery of published workforce agents by their tags.
- **`eslint-config-next` is a major version ahead of `next` (16.1.6 vs 15.5.2) — the root cause of the React-Compiler hook-rule wall above.** [frontend/package.json](frontend/package.json) pins `eslint-config-next@16.1.6` against `next@15.5.2`; the v16 config is what enables the React-Compiler-era `react-hooks` rules. The ergonomics rules are demoted to `warn` in [frontend/eslint.config.js](frontend/eslint.config.js), but `react-hooks/rules-of-hooks` correctly stays at error — and that stricter ruleset broke the deploy build a second time via a *false positive*: a plain async event handler named `usePrompt` in [frontend/src/app/prompts/page.tsx](frontend/src/app/prompts/page.tsx) was misclassified as a Hook purely because of its `use` prefix and flagged for being called inside a callback (fixed this pass by renaming to `applyPrompt`). Until the versions are aligned, every future `use`-prefixed non-hook helper will re-trip the same error-level break. Fixing (pin `eslint-config-next` to `15.x` to match `next@15.5.2`, OR deliberately upgrade `next` to 16 and budget the hook-rule refactor) unblocks: a lint ruleset that matches the framework version, and no more naming-driven false-positive build breaks.
- **`requireTenantAccess` unit test uses a hand-rolled Drizzle chain mock.** [api/src/presentation/routes/llmRoutes.test.ts](api/src/presentation/routes/llmRoutes.test.ts) `mockDb()` synthesizes `select().from().where().limit()` chains with canned `[row]` returns. If the auth path grows another link (e.g. `.orderBy`, `.innerJoin`), the mock returns `undefined` and the test still passes while production breaks. Fixing (shared test helper or a real in-memory pg) unblocks: confidence that gateway-auth refactors are caught by tests, not prod.
- **Superadmin `tokenDailyLimitOverride` AND `premiumOverride` mutations are not audit-logged.** [PATCH /api/admin/tenants/:id/token-limit-override](api/src/presentation/routes/adminRoutes.ts) and [PATCH /api/admin/tenants/:id/premium-override](api/src/presentation/routes/adminRoutes.ts) both write the change directly without inserting a row into `admin_audit_log`. Other superadmin mutations (impersonation, role changes, module assignments) record actor + before/after in [adminAuditLog](api/src/infrastructure/database/schema.ts) — these two do not. Fixing (insert an `admin_audit_log` row keyed by actor user id + tenant id + before/after value, shared helper used by both PATCH endpoints) unblocks: forensic trail for "who flipped tenant X to premium / removed the cap and when."
- **NVIDIA NIM catalog model ids are partially unverified.** [api/src/application/llm/vendors/nvidia.ts](api/src/application/llm/vendors/nvidia.ts) registers 11 free models against `https://integrate.api.nvidia.com/v1/chat/completions`. Confidently mapped: `mistralai/mistral-large-3-675b-instruct-2512`, `nvidia/mistral-nemotron`, `nvidia/nemotron-mini-4b-instruct`, `qwen/qwen3-coder-480b-a35b-instruct`, `google/gemma-2-2b-it`, `google/gemma-3n-e4b-it`, `microsoft/phi-4-multimodal-instruct`. Inferred org prefixes (need verification against NIM's `/v1/models` listing): `minimax/minimax-m2.7`, `stepfun-ai/step-3.5-flash`, `bytedance/seed-oss-36b-instruct`, `abacusai/dracarys-llama-3_1-70b-instruct`. Wrong ids will surface as 404s and the cascade will skip them, but they pollute the pool until corrected. Fixing (curl `https://integrate.api.nvidia.com/v1/models` with the API key, reconcile against the catalog) unblocks: clean cascade ordering, no wasted 404 attempts.
- **LLM diagnostic traces (`llm_traces`) have no retention purge — table grows unbounded.** Per the operator's explicit choice this pass, every gateway + IDE-chat call writes a full trace row (request body, response body, per-attempt detail) to [llm_traces](api/src/infrastructure/database/schema.ts) with no TTL or cleanup job. At production call volume this table will dominate DB storage within weeks. Fixing (a `scheduled()` cron in [api/src/index.ts](api/src/index.ts) that `DELETE FROM llm_traces WHERE created_at < now() - interval '30 days'`, mirroring the vendor-health cron pattern — plus a configurable window) unblocks: bounded storage cost without losing the live-incident diagnostic window.
- **Card/List `ViewToggle` rollout skipped a few non-tabular / delegated surfaces.** This pass added the shared [ViewToggle](frontend/src/components/ViewToggle.tsx) + [dataTableStyles](frontend/src/components/dataTableStyles.ts) to all primary data-list pages (projects, dashboard, content-manager, prompts, workforce, members, api-keys, logs, approvals, admin users/tenants, llm-traces, marketplace, skills, personas, contributors, shoutouts, showcase, integrations, agent skills). **Not converted:** (a) [chats/page.tsx](frontend/src/app/chats/page.tsx) — the conversation sidebar is a messaging UI, not a tabular record set, so a List view was judged inapplicable; (b) [settings/page.tsx](frontend/src/app/settings/page.tsx) Connected Accounts / Active Sessions / Admin Access sections — still card-only with no toggle; (c) the **assigned** tab on skills/personas, which delegates to `SkillAssignmentsContent` / `PersonaAssignmentsContent` — the `ViewToggle` is hidden there and those child components have no table view; (d) [TaskMgmtContent](frontend/src/components/TaskMgmtContent.tsx) keeps its own **Board/List** switch (not relabeled to Card/List) since it already offers dual views. Fixing (decide whether settings sections + the assigned tabs warrant a list view, and whether TaskMgmt's Board/List should be unified under the shared `ViewToggle` vocabulary) unblocks: fully uniform view-switching vocabulary across every surface.
- **Production gateway worker is running stale code (deploy artifact dated Mar 8) — months behind `main`.** The on-disk bundle [api/.wrangler/tmp/deploy-rfNsY3/index.js](api/.wrangler/tmp/) predates the FREE-attempt cap, the Gemini premium fallback, and the current catalog. The 2026-06-07 hired.video tailor failure (`llm-71b468dd-...`) shows behavior — 4 free attempts, `anthropic/claude-3-haiku`/`cerebras/llama3.1-8b`/`nvidia/*` in the cascade — that exists in **none** of the current source ([LlmProxyService.ts](api/src/application/llm/LlmProxyService.ts) caps free at 2 and falls back to Gemini). So the live endpoint never received the reliability work already merged, *including* the guaranteed paid backstop added this pass. Fixing (redeploy the gateway worker from `main` via the release workflow, then re-run the failing tailor request and confirm `_builderforce.resolvedModel` lands on `google/gemini-2.5-flash-lite`) unblocks: every AI-endpoint reliability fix since March actually taking effect in prod — the single highest-leverage action for hired.video's tailor.
- **No `GOOGLE_API_KEY` (nor `NVIDIA`/`CEREBRAS`/`OLLAMA`/`CLOUDFLARE` keys) bound in production — the cascade is OpenRouter-only.** [wrangler.toml](api/wrangler.toml) documents only `OPENROUTER_API_KEY` + `_PRO` as secrets. Consequence: the two `googleai/*` entries in [`PREMIUM_FALLBACK_MODELS`](api/src/application/llm/LlmProxyService.ts) are always skipped (key-unbound), every non-OpenRouter free model in the pool is dead weight, and the *only* paid safety net is OpenRouter-routed Gemini — a single upstream with no vendor diversity. The new guaranteed backstop (`GUARANTEED_BACKSTOP_MODEL`, this pass) leans entirely on `OPENROUTER_API_KEY_PRO` having credit; if that key lacks paid balance the backstop 402s and the request still hard-fails. Fixing (`wrangler secret put GOOGLE_API_KEY` so direct Gemini becomes a vendor-diverse backstop, confirm `OPENROUTER_API_KEY_PRO` is a credited key, and document the optional free-vendor keys) unblocks: real multi-vendor failover instead of a single-upstream dependency, and a backstop that can't 402.
- **hired.video's tailor worker runs its own client-side 6-model cascade against the gateway, using a deprecated model id.** The 2026-06-07 trace (`handleTailor`, `worker.js`) shows hired.video looping its *own* model list — `qwen3-next:free`, `qwen3-coder:free`, `gemma-4-31b:free`, `hermes-3-405b:free`, `cerebras/llama3.1-8b`, and `anthropic/claude-3-haiku` (retired on the first-party Anthropic API) — one builderforce call each, duplicating the gateway's failover and pinning models that no longer exist. The tailor's plan (free vs pro) is also unconfirmed; with the backstop added this pass, builderforce now *funds* the paid fallback for free-plan calls (~$0.0001/call by design). The hired.video repo is not in this workspace. Fixing (in hired.video: drop the client-side cascade — send one request with no `model` hint and let the gateway route; remove the `claude-3-haiku` pin) and confirming the intended billing posture for tailor unblocks: no wasted duplicate attempts, no doomed deprecated-model pins, and clarity on who pays for the free-tier backstop.
- **LLM trace capture is wired for the gateway chat route and IDE chat, but not brain / dataset-gen / agent-inference callers.** [traceLogger.logTrace](api/src/application/llm/traceLogger.ts) is invoked from [llmRoutes.ts](api/src/presentation/routes/llmRoutes.ts) (`/v1/chat/completions`) and [ideAiRoutes.ts](api/src/presentation/routes/ideAiRoutes.ts) (`/api/ai/chat`). Other internal `ideProxy(...).complete()` callers — [BrainService](api/src/application/brain/BrainService.ts), the workforce agent inference endpoint, dataset generation, and `/v1/images/generations` in [llmRoutes.ts](api/src/presentation/routes/llmRoutes.ts) — still pass through the proxy (so a `traceId` is minted and the cooldown/failover path runs) but never call `logTrace`, so those calls are invisible in the superadmin trace view. Fixing (thread `newTraceId()` + `logTrace` through each remaining caller with the right `surface` label — `brain` / `agent` / `dataset-gen` / `image`) unblocks: full-surface diagnostic coverage, not just the public gateway.
- **Streaming traces don't capture the completion body or token usage.** For `stream: true` calls, [llmRoutes.ts](api/src/presentation/routes/llmRoutes.ts) and [ideAiRoutes.ts](api/src/presentation/routes/ideAiRoutes.ts) call `logTrace` with `responseBody: null` because the body is piped straight to the client; token usage is captured separately into `llm_usage_log` via the SSE-tail interceptor but is not back-filled into the trace row. So a streamed trace shows identity/timing/attempts/chain but a blank response body and zero tokens. Fixing (tee the stream into a buffer and `UPDATE llm_traces SET response_body=…, total_tokens=… WHERE trace_id=…` from the same `onUsage` callback that already feeds `logUsage`) unblocks: complete diagnostics for streamed calls, which are the majority of IDE traffic.
- **`llm_usage_log` and `llm_traces` are now overlapping ledgers with no shared key.** Both tables get one row per call (usage accounting vs full diagnostics) but the trace's `traceId` is not written onto the matching `llm_usage_log` row, so a superadmin can't pivot from the usage/billing view to the diagnostic trace. Fixing (add a nullable `trace_id` column to `llm_usage_log` and pass it through `logUsage`, or fold usage columns into `llm_traces` and drop the duplication) unblocks: one-click jump from a billing anomaly to its full trace, and eventually deletion of one of the two write paths.
- **Superadmin LLM trace reads are not audit-logged.** [GET /api/admin/llm/traces and /llm/traces/:traceId](api/src/presentation/routes/adminRoutes.ts) expose full customer request/response bodies (which, per the operator's "full bodies" choice, can include end-user PII) to any superadmin with no `admin_audit_log` entry recording who viewed which trace. Mirrors the existing gap on `tokenDailyLimitOverride`/`premiumOverride` mutations not being audited. Fixing (insert an `admin_audit_log` row keyed by actor + traceId on each single-trace fetch) unblocks: forensic trail for access to sensitive captured prompt data.
- **Per-agent (cloud-agent) skills/personas resolve on demand but aren't injected at cloud-runtime dispatch yet.** This pass made workforce cloud agents assignable: [migration 0076](api/migrations/0076_agent_identity_project_independent.sql) makes `project_agents.project_id` nullable so a project-less *canonical identity* row exists per agent; [`POST /api/workforce/agents/:id/bridge`](api/src/presentation/routes/workforceRoutes.ts) ensures it; the [CloudAgentSlideOutPanel](frontend/src/components/workforce/CloudAgentSlideOutPanel.tsx) assigns skills/personas to it via `scope='agent'`; and [resolveArtifacts](api/src/application/artifact/resolveArtifacts.ts) now folds those in when given `cloudAgentRef` (exposed on `GET /api/artifact-assignments/resolve?cloudAgentRef=…`). **What's still missing:** the cloud-agent *execution* dispatch paths ([runtimeRoutes.ts](api/src/presentation/routes/runtimeRoutes.ts) `resolveArtifacts` calls at the task-submit endpoints, and any builderforce-hosted cloud inference path) only pass `taskId`/`agentHostId` — never `cloudAgentRef` — so an agent's per-agent skills/personas are queryable and shown in the panel but not yet injected into its system prompt at cloud run time. The agentHost (self-hosted) path already receives the resolved `artifacts` bundle over dispatch; the cloud path needs the same. Fixing (thread the executing cloud agent's `ide_agents.id` into the `resolveArtifacts` call at each cloud-execution seam, then merge the resulting personas/skills into the agent's system prompt the same way [subagent-spawn.ts](agent-runtime/src/agents/subagent-spawn.ts) injects `buildPersonaSystemBlock`) unblocks: assigned personas/skills actually shaping cloud-agent behavior end-to-end, not just on self-hosted agentHosts.
- **No unit test locks the "trace id leaks to caller but full detail does not" invariant.** This pass added [traceLogger.ts](api/src/application/llm/traceLogger.ts) + the `_builderforce.traceId` / `x-builderforce-trace-id` / `error.details.correlationId` echo in [llmRoutes.ts](api/src/presentation/routes/llmRoutes.ts), but there's no test asserting that (a) the response envelope contains the trace id and (b) it does NOT contain `attempts[].error`, `requestBody`, or `responseBody`. Per the repo's regression-test rule this invariant should be locked so a future refactor can't accidentally serialize the builder-side detail back to the caller. Fixing (a route-level test that inspects the JSON envelope + headers) unblocks: confidence the server-side/caller-side boundary holds.
- **No CI step runs `db:migrate` against an ephemeral DB before deploy — missing-`CREATE` schema drift only surfaces in production.** This pass fixed a hard production-deploy crash (`relation "contributors" does not exist`) caused by the entire contributor/team/report/team-memory subsystem (schema sections 6b–6f) being defined in [schema.ts](api/src/infrastructure/database/schema.ts) and wired into routes ([analyticsRoutes](api/src/presentation/routes/analyticsRoutes.ts), [contributorRoutes](api/src/presentation/routes/contributorRoutes.ts), the P4-5 team-memory mesh) but never given a `CREATE TABLE` migration — the tables only ever existed locally via `drizzle-kit push`. Migration 0056's `to_regclass()` guards silently no-op'd against the absent tables, masking the drift until 0069 ALTERed `contributors` unguarded. New migration [0068a_create_contributor_team_subsystem.sql](api/migrations/0068a_create_contributor_team_subsystem.sql) backfills the creates (idempotent, post-0056/pre-0069 shape, also creates the `activity_event_type`/`report_type`/`report_schedule` enums that were likewise never created). The remaining gap: the `db:migrate` job in [.github/workflows](.github/workflows) applies migrations straight to the production Neon branch with no prior dry-run, and [check-schema-drift.mjs](api/scripts/check-schema-drift.mjs) is not gated in CI to catch a schema-table that has no creating migration. Fixing (a CI job that spins a throwaway Neon branch or local Postgres, runs `db:migrate` from empty + then `check-schema-drift.mjs`, and fails the build on either error before the deploy job runs) unblocks: missing-migration / drift bugs caught in PR instead of as a prod deploy crash. NOTE: `team_memory` (the cross-claw mesh) was among the silently-uncreated tables, so that feature was non-functional in any push-free environment until 0068a.
- **The `pgTable`-block regex in [check-schema-drift.mjs](api/scripts/check-schema-drift.mjs) was merging adjacent tables — now fixed, but exposed `claw_skill_assignments` as a push-only table.** The drift checker's table-capture regex (`...\n\}\)`) could not close a `}, (t) => [ ... ]` constraints block, so it ran past the closing brace and swallowed the *next* table's declaration under the first table's name — fabricating ~96 phantom column entries in [.schema-drift-allowlist.txt](api/scripts/.schema-drift-allowlist.txt) (e.g. `dev_team_members.report_type`/`.delivery_hour`/`.recipients`, which are really `report_schedules` columns; `report_subscriptions.claw_id`/`.summary`, which are `team_memory` columns). This pass fixed the regex (`\n\}\s*[,)]` — close on `}` followed by `)` or `,`) and rebuilt the allowlist down to the 110 genuinely-grandfathered push-only entries (parsed-table coverage rose to all 142). The fix un-hid [clawSkillAssignments](api/src/infrastructure/database/schema.ts) — the claw-scoped sibling of `tenant_skill_assignments` — which, like its sibling and the whole base cluster (`tenants`, `users`, `coderclaw_instances`, `marketplace_skills`, `projects`, `tasks`, `executions`), has **no `CREATE TABLE` migration** yet is queried unguarded at runtime ([skillAssignmentRoutes.ts](api/src/presentation/routes/skillAssignmentRoutes.ts), [clawRoutes.ts](api/src/presentation/routes/clawRoutes.ts)) — the same `relation "X" does not exist` prod-crash class 0068a fixed for the contributor cluster. It was grandfathered (matching its sibling) rather than migrated, since converting it alone while leaving its push-only FK targets (`coderclaw_instances`, `marketplace_skills`) un-migrated would be inconsistent. Fixing (a `0073`-style idempotent `CREATE TABLE IF NOT EXISTS` migration that converts the whole push-only baseline cluster — base tables + both skill-assignment tables — to tracked migrations, then dropping their allowlist entries) unblocks: skill assignment + base CRUD working in any push-free environment, and shrinking the grandfather list toward zero.
- **Configured-quickstart popover emits `BUILDERFORCE_TOKEN`/`BUILDERFORCE_WORKSPACE` env vars the installer scripts don't yet read.** The new caret on the Workforce "Add agent" split button ([ConfiguredQuickstartPopover](frontend/src/components/workforce/ConfiguredQuickstartPopover.tsx)) renders the install one-liner pre-configured for the selected workgroup by prefixing `BUILDERFORCE_TOKEN="<tenantToken>"` and `BUILDERFORCE_WORKSPACE="<slug>"`. But [install.ps1](frontend/public/install.ps1) (and the `install.sh` it references) never read those env vars — so today the command installs the agent but does NOT auto-register it into the workgroup; the user still onboards manually. Fixing (have install.ps1/install.sh read `$env:BUILDERFORCE_TOKEN`/`$env:BUILDERFORCE_WORKSPACE`, and pass them into `builderforce onboard` non-interactively to register the agentHost against that workgroup) unblocks: the popover's "installs and registers straight into this workgroup" promise actually holding end-to-end. Note the same script also still hard-codes legacy `coderclaw.ai` URLs + `$env:USERPROFILE\.builderforce` defaults in its `.SYNOPSIS`/params — reconcile to `builderforce.ai` in the same pass.
- **Project Calendar/Gantt views are read-only and derive deadlines from tasks — no in-view editing and no project-level date column.** This pass added Calendar + Gantt view modes to the projects page ([ProjectCalendar](frontend/src/components/ProjectCalendar.tsx), [ProjectGantt](frontend/src/components/ProjectGantt.tsx), shared [projectSchedule.ts](frontend/src/lib/projectSchedule.ts)/[ScheduleLegend](frontend/src/components/ScheduleLegend.tsx)), wired through the now-generic [ViewToggle](frontend/src/components/ViewToggle.tsx). A project has no date column of its own, so [GET /api/projects](api/src/presentation/routes/projectRoutes.ts) derives `startDate` (min task start, falling back to min due) and `dueDate` (max task due) by aggregating non-archived `tasks` rows. **Scope cuts:** (a) the views are display-only — there's no drag-to-reschedule or click-to-set-deadline, so changing a timeline still means editing individual task dates in the task UI; (b) the derived range recomputes on every list fetch with a `min/max ... group by project_id` aggregate that is NOT run through the read-through cache (`getOrSetCached`) the perf rule mandates — at high project/task counts this is an uncached fan-over-tasks scan on the hot `/api/projects` path; (c) the Calendar plots only the deadline (`dueDate`) as a single-day pill and does not render multi-day spans across the grid the way the Gantt does. Fixing (cache the per-project date aggregate keyed by a tenant task-version token invalidated on task write; add an editable mode that PATCHes task dates from the timeline; optionally a true project-level milestone/deadline column) unblocks: cached timeline reads, in-place rescheduling, and a project-owned deadline independent of task data. The View-Toggle vocabulary note (TaskMgmt's Board/List) in the rollout entry above also now applies to these two new modes.
- **Agent-host liveness depends on the 5-min heartbeat; the relay DO / WS path does not refresh `lastSeenAt` on its own.** The online-status fix ([onlineStatus.ts](api/src/domain/agentHost/onlineStatus.ts)) treats a host with a stale `lastSeenAt` (>15 min) as OFFLINE even while its socket is up, so liveness now hinges entirely on the periodic HTTP heartbeat landing. This pass found the agent-runtime relay ([builderforce-relay.ts](agent-runtime/src/infra/builderforce-relay.ts)) targets `/api/agentNodes/:id/{upstream,heartbeat,assignment-context}`, a path the worker never mounted (only `/api/agent-hosts` + the `/api/claws` alias) — so the heartbeat was 404ing and `lastSeenAt` only moved on (re)connect. Mitigated this pass by adding an `/api/agentNodes` back-compat route mount in [index.ts](api/src/index.ts) so heartbeats now land. **Still open:** (a) the runtime/worker naming is now triplicated (`claws`/`agent-hosts`/`agentNodes`) and should converge on one — repoint the runtime to `/api/agent-hosts` and drop both aliases; (b) the WS `/upstream` handler ([agentHostRoutes.ts](api/src/presentation/routes/agentHostRoutes.ts)) sets `lastSeenAt` only at connect, and the [AgentHostRelayDO](api/src/infrastructure/relay/AgentHostRelayDO.ts) never bumps it — add a periodic `lastSeenAt` touch on the live socket as defense-in-depth so a host stays ONLINE even if the HTTP heartbeat is blocked. Fixing unblocks: liveness that doesn't silently depend on one easily-misrouted heartbeat call.
- **Gateway + agent-runtime prompt-cache TTL is fixed at 5-minute ephemeral — no 1-hour opt-in.** This pass wired Anthropic prompt-cache breakpoints into the gateway request path ([promptCaching.ts](api/src/application/llm/promptCaching.ts) → injected in [openrouter.ts `buildBody`](api/src/application/llm/vendors/openrouter.ts)) and into agent-runtime's OpenRouter/Anthropic system prompt ([extra-params.ts `addAnthropicSystemCacheControl`](agent-runtime/src/agents/pi-embedded-runner/extra-params.ts)), completing the caching+metering pair the gateway already read via [`pickUsage`](api/src/application/llm/vendors/types.ts) (`cache_read_tokens`/`cache_creation_tokens`). Both always emit `cache_control: { type: 'ephemeral' }` (5-min TTL). For bursty tenants with a large stable prefix and gaps >5 min between calls, a 1-hour TTL (`{ type: 'ephemeral', ttl: '1h' }`, ~2x write cost) would keep the prefix warm across idle gaps — pi-ai already supports this for *direct* Anthropic via `cacheRetention: 'long'`, but the gateway/OpenRouter path doesn't expose it. Fixing (a per-request `_builderforce: { cacheTtl: '1h' }` hint / per-`useCase` profile that flips the marker, in both surfaces) unblocks: cache hits across multi-minute idle gaps for high-prefix tenants.
- **The `/models` catalog is shown verbatim and isn't annotated with which models the gateway actually routes.** The public Models page ([frontend/src/app/models/](frontend/src/app/models/)) sources its list from our gateway — [`GET /llm/v1/catalog`](api/src/presentation/routes/llmRoutes.ts) → [modelCatalog.ts `getCatalogCached`](api/src/application/llm/modelCatalog.ts), read-through cached (L1 Map + L2 KV) + edge `s-maxage`, so the browser never calls OpenRouter directly. **Residual gaps:** (a) the returned list is OpenRouter's full catalog with their pricing passed through verbatim — it is NOT cross-referenced against the ids the Free/Pro cascade actually serves ([openrouter.ts `CATALOG`](api/src/application/llm/vendors/openrouter.ts)), so a visitor can see a model that our cascade won't route; (b) the per-token→per-1M pricing is point-in-time with no effective-rate/markup context; (c) the cache has no invalidate-on-write hook — the catalog is upstream-owned, so it only ages out on the 1h KV TTL (acceptable, but a manual `invalidateCached(env, 'openrouter-catalog:v1')` admin action would let us force-refresh after an OpenRouter pricing change). Fixing (annotate each `CatalogModel` with a `routable` / `pool: 'free' | 'pro'` flag computed from the vendor catalog, surface it as a badge + filter, and add an admin invalidate button) unblocks: an honest "routable on Builderforce" signal and instant pricing refresh.
- **Gateway prompt caching covers the Anthropic family only — Gemini relies on implicit caching, no explicit breakpoints.** [promptCaching.ts `modelSupportsExplicitCaching`](api/src/application/llm/promptCaching.ts) deliberately gates to `anthropic/*` / `claude` ids (the only OpenRouter upstreams that *require* an explicit marker and are known to honour it without a 400). `google/*` (via OpenRouter) and the direct `googleai` vendor cache implicitly above the model minimum, so they get *some* caching for free — but explicit breakpoints would give tunable placement and a higher hit rate on long stable prefixes. Held back to avoid 400s on providers that reject the unknown `cache_control` field. Fixing (extend the gate + a per-vendor allowlist once Gemini-via-OpenRouter explicit-cache behaviour is confirmed against a live call) unblocks: tunable Gemini prompt caching, not just whatever the provider caches implicitly.
- **Cloud Worker agent toolset is minimal (write_file/finish) and V1 self-hosted (pi) tool events may still be relay-only.** This pass made both cloud engines genuinely *execute tools*: [runCloudExecution](api/src/presentation/routes/runtimeRoutes.ts) now runs a real tool loop ([runCloudToolLoop](api/src/presentation/routes/runtimeRoutes.ts), up to 6 steps) where the model calls provider-API-backed tools — `write_file` commits to the ticket branch as a pending change ([commitFileAsPendingChange.ts](api/src/application/repos/commitFileAsPendingChange.ts) → opens a PR) and `finish` ends the run — emitting an `llm.complete` + per-tool event each step (migration 0092 columns). V2's agent-runtime SDK loop now *persists* its tool calls too: [builderforce-relay.ts `persistToolAudit`](agent-runtime/src/infra/builderforce-relay.ts) POSTs each `onToolUse` to the agent-host tool-audit ingest (Bearer agent-host key) instead of live-relay-only. **Residual:** (a) the Worker toolset has only `write_file`/`finish` — no `read_file`/`search`/`run_tests`/`apply_patch`, so the cloud Worker agent can write but not inspect the repo or self-verify; richer tools need a read path through the provider contents API. (b) The V1 self-hosted **pi** coding loop's tool calls are not confirmed to flow through `persistToolAudit`/the ingest — only V2's `onToolUse` was wired this pass; verify whether pi emits `tool.audit` only over the relay (live, non-durable) and wire it the same way if so. Fixing unblocks: cloud agents that can read+verify their own work, and durable timelines for V1 self-hosted runs.
- **Cloud-agents directory list (`GET /api/runtime/cloud-agents`) has no time window — distinct refs accumulate for the tenant's lifetime.** The Observability directory is now driven by `SELECT DISTINCT cloud_agent_ref` over `tool_audit_events` ([runtimeRoutes.ts](api/src/presentation/routes/runtimeRoutes.ts)) so every cloud run — including the `__default__` (gateway-default) bucket — is attributable to a chip, fixing the "ran but nothing on the timeline" bug for default-target runs (their telemetry had `cloud_agent_ref = NULL`). It's intentionally uncached (a low-QPS debug surface that must reflect a run instantly; caching would force a KV version-bump on the hot per-tool-call insert). But it returns *every* ref ever seen, so a long-lived busy tenant accrues an ever-growing chip list with no "active in last N days" filter. Fixing (add a `ts > now() - interval '30 days'` predicate, or join to recent executions, and/or sort by most-recent activity) unblocks: a directory that stays scannable at scale. Lower priority — bounded by an index and a small distinct set for now.
- **Cloud log view is polled, not streamed.** Cloud agents have no live relay socket, so the unified Log view derives cloud log lines from polled tool-audit telemetry with a manual "Refresh cloud" button ([ObservabilityContent.tsx](frontend/src/components/ObservabilityContent.tsx)) rather than a live tail. Self-hosted hosts still stream live over the relay WS. Fixing (a per-execution cloud log stream — the cloud equivalent of `logs.subscribe`, e.g. an SSE/WS tail of the execution's events) unblocks: live cloud logs without a refresh button. (Note: `/timeline` now renders the D3 [ExecutionTimelineChart](frontend/src/components/ExecutionTimelineChart.tsx) via `ObservabilityContent` and is the intended timeline visual; the sidebar links `/observability`, which holds the same chart behind the Log/Timeline toggle.)
- **builderforce-memory's `CachingBridge`/`ResponseCache` (response-level cache) is still unused by the gateway and agent-runtime — separate mechanism from this pass's prompt caching.** This pass added Anthropic *prompt* caching (provider-side prefix reuse, billed at ~0.1x). It does **not** touch [builderforce-memory's CachingBridge / ResponseCache](../builderforce-memory/packages/memory/src/bridges/CachingBridge.ts) (an SSM-embedding-keyed response cache that returns a stored completion without an upstream call at all). The two are complementary: prompt caching discounts the input of calls that still happen; response caching elides the call entirely on a semantic hit. Fixing (wire `CachingBridge`/`ResponseCache` into the gateway read path for idempotent/low-temperature `useCase`s, with the same version-token invalidation the project's read-through cache uses) unblocks: zero-cost responses on repeated/near-duplicate prompts, on top of the per-call prompt-cache discount.
- **`tenant_skill_assignments` and `claw_skill_assignments` each declare two primary keys in [schema.ts](api/src/infrastructure/database/schema.ts).** Both have a column-level `id: serial('id').primaryKey()` AND a composite `primaryKey({ columns: [...] })` in the second-arg constraints callback. Postgres permits only one primary key per table, so `drizzle-kit push` resolves this ambiguously (whichever it emits last wins) and the intended uniqueness guarantee on `(tenant_id, skill_slug)` / `(claw_id, skill_slug)` may not be enforced. Fixing (keep `id` as the PK and demote the composite to a `unique(...)` constraint, or drop the `id` PK in favour of the composite) unblocks: a deterministic, enforced uniqueness contract — and a clean `CREATE TABLE` for the migration above.
- **Workflow trigger config is collected by the builder but never acted on by the orchestrator — every trigger is effectively `manual`.** This pass fixed the builder bug where selecting a trigger type showed no type-specific options: [nodeKinds.ts](frontend/src/components/workflow-builder/nodeKinds.ts) now declares `visibleWhen`-gated fields (cron+timezone for `schedule`, path+secret for `webhook`, feed URL for `rss`, inbox for `inbound-email`, etc.) and [NodeConfigPanel.tsx](frontend/src/components/workflow-builder/NodeConfigPanel.tsx) filters fields via the new `isFieldVisible` predicate. **Still open:** the runtime treats the trigger node as a passive start marker only — [orchestrator.ts](../agent-runtime/src/builderforce/orchestrator.ts) just emits `[trigger:<type>] workflow started` and [workflowGraph.ts](api/src/domain/workflowGraph.ts) uses `triggerType` solely for a human-readable label. Nothing consumes `cron` (no scheduled run is registered), `webhookPath`/`secret` (no inbound endpoint is created), `feedUrl`/`pollMinutes` (no poller), or `inbox` (no inbound-email route). So a saved `schedule`/`webhook`/`rss` workflow only ever runs when manually triggered via `POST .../run`. Fixing (register a Cloudflare cron / Durable Object alarm per `schedule` trigger keyed on its `cron`+`timezone`; mint a signed inbound webhook endpoint per `webhook` trigger; add an RSS poller and an inbound-email route) unblocks: trigger types other than `manual` actually starting workflows on their own — the whole point of the trigger picker.
- **Deployed Cloudflare Pages output drifted ~2.5 months stale, silently shipping the pre-COOP/COEP `_headers` and pre-fix IDE bundle.** Observed 2026-06-05: `.vercel/output/static/_headers` was dated 2026-03-16 (containing only the next-on-pages autogenerated immutable-cache block, **no `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy`**) while `public/_headers` + the IDE components were dated 2026-06-02. Result on the live site: `/ide` is not cross-origin isolated → `self.crossOriginIsolated === false` → WebContainer "Run" fails to boot ("WC error"), **and** the stale JS bundle predates the June-2 Designer editor fixes (file-click not switching content, `package.json` getting CSS written into it). Root process gap: nothing guarantees a `cf-build` + redeploy after `public/_headers` or IDE source changes — the deploy artifact can lag source indefinitely with no alarm. Fixing (a CI deploy job that always rebuilds from source on merge to main, plus a post-build assertion that `.vercel/output/static/_headers` contains both COOP `same-origin` and COEP `credentialless` before publishing) unblocks: the live `/ide` matching source, and WebContainer Run never silently dying on a header regression. Immediate remediation for this incident: run `npm run cf-build` and redeploy.
- **Brain actions `apply_code_to_active_file` and `create_file` overwrite files with zero content/extension validation — the likely origin of CSS-in-`package.json`.** [IDENew.tsx](frontend/src/components/IDENew.tsx) `applyCodeToActiveFile` blindly writes the LLM-supplied string to whatever file is currently active, and `createProjectFile` writes any path/content pair, both persisting via `saveFile`. If the agent is asked to "add some styling" while `package.json` (or any non-matching file) is the active tab, it can replace JSON with CSS, which then breaks Run with `Invalid package.json: Unexpected token 'b', "body {`. No guard checks that the written content is plausibly valid for the target extension (e.g. `*.json` must `JSON.parse`). Fixing (validate by extension before write — reject/parse-check JSON files, warn on obvious language mismatch — and prefer `create_file` with an explicit path over silently retargeting the active tab) unblocks: the agent can't corrupt structural project files, and Run stops failing on agent-written content. Note: the Run-time handler now surfaces this case with recoverable guidance (matches `Invalid package.json`), but the write itself is still unguarded.
- **agent-runtime SSM hippocampus is install-decoupled — the `@builderforce/memory` hard dep was removed so the build no longer needs that (unpublished) npm package.** Earlier the consumer ([agent-runtime/src/infra/ssm-memory-service.ts](agent-runtime/src/infra/ssm-memory-service.ts)) was rewired to a hard `@builderforce/memory@^2026.5.31` dependency that `npm view` 404s (the `@builderforce/*` scope was never published), which hard-blocked `pnpm install --frozen-lockfile` and therefore the Docker build / cloud deploy. Fixed this pass by dropping the dep from [agent-runtime/package.json](agent-runtime/package.json) and regenerating the lockfile (now 0 refs to `@builderforce/memory`/`@seanhogg/ssmjs`/`mambakit`/`mambacode.js`; `pnpm install --frozen-lockfile` passes). The import was already a guarded dynamic `new Function("m","return import(m)")` in try/catch, so the runtime degrades to memory-only (SSM inference disabled) when the package is absent — and the cloud coding loop does not use it. **Still open (enhancement, no longer a blocker):** to actually load the SSM hippocampus in production, publish `@builderforce/memory-engine` + `@builderforce/memory` to npm and re-add the dep as an `optionalDependencies` entry (so a 404 still doesn't break install). Fixing unblocks: the on-device SSM memory layer, without ever re-coupling it to the build.
- **frontend still consumes the engine via the `mambacode.js` git URL, not the new `@builderforce/memory-engine` npm package.** [frontend/package.json](frontend/package.json) pins `"mambacode.js": "git+https://github.com/SeanHogg/Mamba.git"` and [frontend/src/lib/model-provider.ts](frontend/src/lib/model-provider.ts) / [frontend/global.d.ts](frontend/global.d.ts) import from `'mambacode.js'`. The consolidation renamed that engine to `@builderforce/memory-engine`; the browser consumer was left on the old git specifier this pass (scope was the agent-runtime SSM consumer). Fixing (once `@builderforce/memory-engine` is on npm: swap the dep + the `import 'mambacode.js'` sites + the `declare module` in `global.d.ts` to `@builderforce/memory-engine`, verify the WebGPU `MambaModel`/`MambaTrainer`/`BPETokenizer` exports still resolve) unblocks: the browser training path also riding the canonical npm package instead of a moving git HEAD.
- **Fully configurable boards rely on free-form `tasks.status` strings keyed to swimlanes — no referential integrity links a task's status to a lane.** `tasks.status` is now a `varchar` (migration [0076](api/migrations/0076_task_status_freeform.sql), [schema.ts](api/src/infrastructure/database/schema.ts)) and the board columns are the project's swimlanes ([boardColumns](frontend/src/components/TaskMgmtContent.tsx) + [LanesTab](frontend/src/components/board/BoardConfigPanel.tsx)), seeded from [defaultSwimlanes.ts](api/src/application/swimlane/defaultSwimlanes.ts). The coupling is now by string convention only (`task.status === swimlane.key`), with no FK: (a) **deleting/renaming a lane key orphans tasks** holding the old key — they surface in an auto-appended fallback column (`boardColumns` orphan pass) but there's no migration to move them onto a surviving lane; (b) the same status string can mean different columns in different projects, and there's no per-project uniqueness enforcement on `swimlane.key`; (c) automation still keys off the canonical strings (`RuntimeService` sets `in_progress`/`in_review`/`done`; auto-submit fires on `todo`/`in_progress`), so a board that renames/removes those lane keys silently loses that automation. Fixing (a real `swimlane_id` FK on `tasks` with `ON DELETE SET NULL` + a lane-merge/reassign flow on delete, and moving automation triggers onto a per-lane flag instead of hard-coded status strings) unblocks: referential safety for configurable boards and automation that follows user-defined lanes instead of the canonical seven.
- **Schema-drift checker is blind to enum-typed columns — every `pgEnum`-backed column is silently unchecked.** [check-schema-drift.mjs](api/scripts/check-schema-drift.mjs) `colRe` matches only the built-in builders (`integer|varchar|text|boolean|timestamp|serial|uuid|json|jsonb|customType|pgEnum`), but the schema declares enum columns with their *named* builder (`taskStatusEnum('status')`, `taskPriorityEnum('priority')`, `agentTypeEnum(...)`, `tenantStatusEnum(...)`, etc.), not literal `pgEnum(...)`. So those columns never enter the `drizzleTables` cols set and are never compared against migrations. This is why `tasks.status` passed CI for its whole life as an enum and only got flagged once this pass converted it to `varchar` (now grandfathered in [.schema-drift-allowlist.txt](api/scripts/.schema-drift-allowlist.txt) alongside the other baseline `tasks` columns). The blind spot hides the same missing-migration prod-crash class (`relation/column does not exist`) for every enum column across the schema. Fixing (extend `colRe` to match any `<ident>Enum(` builder, or resolve column builders by reading the `pgEnum` export names, then rebuild the allowlist for the newly-visible enum columns) unblocks: drift coverage for enum columns instead of a silent gap.
- **Board agent-status chips are a load-time snapshot, not live.** The running-agent chip on each task card/row ([TaskMgmtContent.tsx](frontend/src/components/TaskMgmtContent.tsx) `latestExecByTask`, fed by `runtimeApi.listRecent()`) is fetched once in `load()` and only refreshes on a full board reload (status change, task CRUD). A task whose agent transitions running→completed while the board sits open keeps showing the stale status until the next reload. The drawer's Agent tab is live per-execution, but the board overview is not. **The new swimlane dispatch-status chips on lane headers share this limitation:** `latestDispatchByAssignment` (fed by `boardsApi.dispatches(boardId)`) is fetched once per board-view mount with no polling, so a dispatch transitioning pending→running→completed while the board sits open shows stale status until a remount. Fixing (poll both `runtimeApi.listRecent()` and `boardsApi.dispatches()` on an interval while any task/dispatch is active, or subscribe to the existing `/api/runtime/executions/:id/stream` SSE plus a new dispatch-status stream for visible active lanes) unblocks: accurate at-a-glance agent status without manually reloading.
- **Swimlane agent assignments still write to `swimlane_agent_assignments`, not the canonical `agent_assignments` (0082).** This pass made the assign-agent form pick a registered/workforce agent from the project registry ([projectAgents.list](frontend/src/lib/builderforceApi.ts) → [AgentList](frontend/src/components/board/BoardConfigPanel.tsx)), resolving its runtime/host/model at write time via [resolveAssignedAgent.ts](api/src/application/swimlane/resolveAssignedAgent.ts) and storing `agent_kind`/`agent_ref` alongside the resolved `role/runtime/target/model` on `swimlane_agent_assignments` (migration [0084](api/migrations/0084_swimlane_actions.sql)). The canonical [agent_assignments](api/migrations/0082_agent_assignments.sql) table (`scope='swimlane'`), explicitly built to *replace* this per-lane assignment model, is still unused for swimlanes — so there are now two assignment stores. Fixing (migrate the swimlane dispatch pipeline — [compileStage](api/src/application/swimlane/compileStage.ts) + [DrizzleCoordinatorStore.listAssignments](api/src/application/swimlane/DrizzleCoordinatorStore.ts) — onto `agent_assignments`, backfill, and drop `swimlane_agent_assignments`) unblocks: one assignment model across project/workflow/swimlane.
- **Swimlane `failure_policy` (`retry`/`skip`) is still unimplemented — only `needs_attention` is honored.** A failed/unmet-quorum stage always routes to `needs_attention` ([SwimlaneCoordinator.onStageComplete](api/src/application/swimlane/SwimlaneCoordinator.ts) via [mapWorkflowStatusToTicketEvent](api/src/application/swimlane/transitions.ts)); the lane's `failure_policy` column ([schema.ts](api/src/infrastructure/database/schema.ts)) is read by nothing. The new success-side counterpart (`success_policy` all/any/n_of_m, added this pass and fully wired into [aggregateStageOutcome](api/src/application/swimlane/stageScheduling.ts)) only decides whether the action *fires* — it does not implement auto-retry or skip on failure. Fixing (honor `retry` = re-run the stage up to N times before needs_attention; `skip` = advance past the failed lane) unblocks: lanes that self-recover or tolerate failure without human intervention.
- **`boards.autonomous` column is now inert.** The Board-settings Autonomous checkbox was removed this pass ([BoardConfigPanel SettingsTab](frontend/src/components/board/BoardConfigPanel.tsx)) and the coordinator no longer reads `board.autonomous` — autonomy is implicit (a successful stage advances unless the lane gate is `human`; see [resolveStageAction](api/src/application/swimlane/transitions.ts)). The `boards.autonomous` column ([schema.ts](api/src/infrastructure/database/schema.ts)) is left in place (defaulted `true`, board-create forces `true`) to avoid a destructive migration, but nothing reads it. Fixing (drop the column + its `BoardLite.autonomous` field + the `getBoard` mapping once confirmed no reader remains) unblocks: dead-column cleanup.
- **`run_workflow` lane action fires the workflow but does not block ticket advancement on its completion.** When a lane's action is `run_workflow`, [SwimlaneCoordinator.onStageComplete](api/src/application/swimlane/SwimlaneCoordinator.ts) calls [DrizzleStageWorkflowRunner](api/src/application/swimlane/stageWorkflowRunner.ts) → [instantiateWorkflowRun](api/src/application/workflow/instantiateRun.ts) as a fire-and-forget side-effect, then advances the ticket immediately — it does not wait for the spawned workflow to reach `completed`/`failed` before moving the ticket on (nor surface that workflow's failure back onto the ticket). A definition deleted since assignment is also silently skipped. Fixing (a back-edge that parks the ticket until the spawned workflow settles and maps its status onto the ticket lifecycle, plus surfacing a missing-definition error instead of a silent no-op) unblocks: lane actions that genuinely gate on a downstream workflow's outcome.
- **`telemetry_spans` had no `CREATE TABLE` migration — fixed in 0073; `agents` + `approval_rules` remain push-only.** Same drift class as 0068a (contributor cluster) and the `0073`-style note above: [telemetrySpans](api/src/infrastructure/database/schema.ts) was declared in schema.ts and queried unguarded by [GET /api/analytics/activity-calendar](api/src/presentation/routes/analyticsRoutes.ts), but only ever existed via the `drizzle-kit push` baseline — no tracked migration created it, and 0056's `to_regclass()` guard silently no-op'd its `segment_id` block against the absent table. Production (migration-only provisioning) 500'd with `relation "telemetry_spans" does not exist`. Closed this pass by [0073_telemetry_spans_table.sql](api/migrations/0073_telemetry_spans_table.sql) (idempotent `CREATE TABLE IF NOT EXISTS` matching schema.ts, replaying 0056's `segment_id` column + default-fill trigger + `NOT NULL` + index since 0056 runs first and skipped it) and dropping the `telemetry_spans.*` rows from [.schema-drift-allowlist.txt](api/scripts/.schema-drift-allowlist.txt). **Still latent:** `agents` and `approval_rules` are the last two schema.ts tables still grandfathered as push-only (no `CREATE TABLE` migration) — they have not 500'd yet (likely present in the original baseline) but carry the identical prod-crash risk the moment a migration-only environment queries them. Fixing (fold both into a `CREATE TABLE IF NOT EXISTS` migration alongside the base-table cluster from the entry above, drop their allowlist rows) plus gating [check-schema-drift.mjs](api/scripts/check-schema-drift.mjs) in CI (still open per the 0068a entry) unblocks: zero remaining untracked-table drift and PR-time detection instead of prod-time crashes.
- **Legal documents render with chat-message typography.** The new shared [LegalDocPreview](frontend/src/components/admin/LegalDocPreview.tsx) control (used by the admin legal tab, the editor drawer preview, and the public footer modal) renders Markdown through [ChatMessageContent](frontend/src/components/ChatMessageContent.tsx) — a renderer tuned for chat bubbles (0.82rem body text, uppercase code-fence chrome with a "Copy" button). The three previews are now consistent with each other and with the live footer modal, but the typography is sub-optimal for long-form legal prose. Fixing (give `LegalDocPreview` its own document-scale Markdown component map — larger body/heading sizes, prose line-length — instead of delegating to the chat renderer) unblocks: legal docs that read like documents rather than chat transcripts, without re-diverging the three call sites.
- **Legal-doc content is stored raw (LLM chatter + fenced wrapper); only sanitized at render.** Published legal docs pasted in from an LLM chat arrive as a conversational preamble plus the real document wrapped in a ```` ```PRIVACY_POLICY.md … ``` ```` fence, and that exact string is what `publishLegal`/`amendLegal` persist ([LegalEditorDrawer.tsx](frontend/src/components/admin/LegalEditorDrawer.tsx) → [adminApi](frontend/src/lib/adminApi.ts)). This pass added [unwrapLegalMarkdown](frontend/src/lib/utils.ts) and applied it in the shared [LegalDocPreview](frontend/src/components/admin/LegalDocPreview.tsx), so every *render* surface (footer modal, admin cards, editor preview, the terms-acceptance gate in [OnboardingGate.tsx](frontend/src/components/OnboardingGate.tsx)) now shows clean formatted prose. **Still raw at rest:** the DB column, the modal's "Copy" affordance on the unsanitized source, and any non-frontend consumer (API responses, exports) still see the chatter + fence. Fixing (normalize on write — run the same `unwrapLegalMarkdown` in `LegalEditorDrawer.handleSave` before `publishLegal`/`amendLegal`, or server-side in the legal-doc route — and optionally a one-off backfill of existing rows) unblocks: clean stored data for every consumer, not just the React render path, and lets the render-time unwrap eventually be retired.
- **Marketplace / prompt detail views are client-side overlays with no per-entity route — individual agents, skills, personas, and prompts are unindexable and have no rich link previews.** Both [marketplace/page.tsx](frontend/src/app/marketplace/page.tsx) and [prompts/page.tsx](frontend/src/app/prompts/page.tsx) open detail in an in-page modal/drawer, so there is no `/marketplace/{slug}` or `/prompts/{slug}` URL. The listing pages now have per-page metadata + a dynamic OG image (added this pass via [seo.ts](frontend/src/lib/seo.ts) + [og.tsx](frontend/src/lib/og.tsx)), but an individual published agent/skill/prompt has no crawlable page, no per-entity `<title>`/description/JSON-LD, and no per-entity OG card. Fixing (add server `…/[slug]/page.tsx` routes with `generateMetadata` driven by a shared `buildEntitySeo(kind, record)` adapter + a per-entity `opengraph-image.tsx`, and emit them into [sitemap.ts](frontend/src/app/sitemap.ts) from the live API — cached read-through, verified/public-only, thin-entity gated) unblocks: indexable long-tail marketplace/prompt pages and correct Slack/LinkedIn/X previews when a specific agent or prompt is shared. This is the SPA-style "UGC detail" surface the marketing-presence review flagged.
- **`/skills/[slug]` and `/personas/[slug]` carry edge-runtime + OG-image scaffolding yet are crawler-blocked and absent from the sitemap.** Both routes ([skills/[slug]/page.tsx](frontend/src/app/skills/%5Bslug%5D/page.tsx), [personas/[slug]/page.tsx](frontend/src/app/personas/%5Bslug%5D/page.tsx)) run on the edge and look intended for public sharing, but `/skills` and `/personas` are `Disallow`-ed in [robots.txt](frontend/public/robots.txt) (they double as authenticated app surfaces) and neither appears in [sitemap.ts](frontend/src/app/sitemap.ts). So if these detail pages are meant to be the public, shareable face of a published skill/persona, they are currently invisible to search + AI crawlers; if they are purely in-app, the per-route edge runtime is dead ceremony. Fixing (decide public-vs-app: either split a public `/workforce/skills/{slug}` surface with metadata + sitemap + a robots `Allow`, or drop the edge runtime and treat them as app-only) unblocks: a coherent public/app boundary and, if public, skill/persona SEO. Related to the marketplace-detail entry above — same "Workforce content has no public, indexable home" root cause.
- **Landing + product + compare pages now render two stacked footers.** With marketing/browse routes moved into the new auth-aware [PublicShell](frontend/src/components/PublicShell.tsx) (which renders the global [AppFooter](frontend/src/components/AppFooter.tsx) legal strip), [page.tsx](frontend/src/app/page.tsx)'s rich `.lp-footer`, [product/page.tsx](frontend/src/app/product/page.tsx)'s `.pp-footer`, and now [compare/page.tsx](frontend/src/app/compare/page.tsx)'s `.cmp-footer` (added this pass, mirroring the product-page pattern) sit directly above AppFooter — a rich site-links footer + a legal strip. Not broken (a common pattern) but redundant. Fixing (fold the site-links into AppFooter via FOOTER_LINKS and drop the per-page footers) unblocks: one canonical footer. Low priority.
- **`/agents/*` marketing pages lost their `.cc-shell` background wrapper.** [agents/layout.tsx](frontend/src/app/agents/layout.tsx) was simplified to a pass-through now that PublicShell provides the chrome; the old layout set `background: var(--bg-deep)` on a `.cc-shell` wrapper. The agents pages now inherit the global shell background. Verify the agents showcase/integrations/skills/shoutouts pages still read correctly; if any relied on `.cc-*` ambient styling (from the deleted MarketingNav style block), restyle them. Fixing unblocks: confirmed visual parity for the /agents cluster.
- **The `agent-runtime` sub-app still carries lobster mascot artwork/copy.** The mascot retirement this pass covered the Builderforce.ai frontend; not yet swept: [agent-runtime/ui/public/favicon.svg](agent-runtime/ui/public/favicon.svg) (a hand-drawn lobster with a `lobster-gradient` + "Left/Right Claw" paths) and the "Welcome to the lobster tank! 🦞" line in [agent-runtime/docs/CONTRIBUTING.md](agent-runtime/docs/CONTRIBUTING.md). These are a separate deployable's brand assets and need an actual SVG/logo redraw, so deferred. NOTE: the `lobster` entries in [agent-runtime/extensions/lobster](agent-runtime/extensions/lobster) + CHANGELOG/labeler are the real external **Lobster workflow tool**, NOT the mascot — leave them. Fixing (redraw favicon.svg as the agentHost logo; reword the CONTRIBUTING line) unblocks: consistent brand with no crab anywhere user-facing.
- **MobileBottomNav is auth-aware + superadmin-aware but not per-tenant-role aware.** [MobileBottomNav.tsx](frontend/src/components/MobileBottomNav.tsx) picks its 5 items by logged-out / logged-in / superadmin, but unlike the reference (which varies the bar by job_seeker/employer/recruiter), it does not vary by the tenant role (`owner`/`manager`/`developer`/`viewer`) from `getStoredTenant()`. So an owner and a viewer see the same bottom bar (the role-gated destinations like Members/API-keys are reachable via the drawer, which IS role-aware). Fixing (thread the tenant role into `itemsFor()` and pick role-appropriate destinations, e.g. owners get Members) unblocks: a bottom bar tuned to each role's high-traffic actions. Note: the active-link inconsistency the reference flagged is already avoided here — both the Sidebar and the bottom bar use the shared `isNavItemActive` from [nav.ts](frontend/src/lib/nav.ts).
- **Per-route marketing teasers for authed routes are not indexable (SEO opportunity).** Logged-out visitors hitting an authed route now get a feature teaser + login/CTA via [RouteMarketing](frontend/src/components/RouteMarketing.tsx) + [routeMarketing.ts](frontend/src/lib/routeMarketing.ts) (gated in [ConditionalAppShell](frontend/src/components/ConditionalAppShell.tsx); middleware no longer redirects them to /login). But those routes stay `Disallow`-ed in [robots.txt](frontend/public/robots.txt) and the authed pages are client components with no `generateMetadata`, so the teasers render the root default `<title>` and aren't crawlable. They could become real per-feature SEO landing pages (e.g. `/ide` → "In-browser IDE for AI agents"). Fixing (allow select feature routes in robots, add `generateMetadata` per route — or canonicalize them to `/product#<section>` — and emit to the sitemap) unblocks: a feature-landing-page long-tail without building separate marketing URLs. `/debug` intentionally uses the generic default teaser (internal route, no marketing copy needed).
- **IDE/project full-bleed pages don't reserve clearance for the mobile bottom bar.** [globals.css](frontend/src/app/globals.css) `.content:has(.ide-full-height)` sets `padding: 0`, which overrides the mobile `.content` bottom padding that keeps content clear of the fixed `.mobile-bottom-nav`. On a phone, the bottom ~56px of an IDE/project page sits under the bottom bar. Mobile IDE use is rare, so deferred. Fixing (add `padding-bottom: calc(56px + safe-area)` to the full-bleed content case under the 767px breakpoint, or hide the bottom bar on `/ide/*` and `/projects/:id`) unblocks: usable full-bleed pages on mobile.
- **No programmatic SEO surface for integrations or competitor comparisons.** The new [/product](frontend/src/app/product/page.tsx) page (added this pass) is the capability *hub*, and [agents/integrations](frontend/src/app/agents/integrations/page.tsx) lists integrations, but there are no per-integration (`/integrations/{tool}`) or per-comparison (`/compare/{competitor}`) leaf pages to capture long-tail search intent — the bounded-generation play the marketing-presence review recommended in place of the (irrelevant for a B2B gateway) geo/local-SEO pattern. Fixing (a bounded set of statically-generated leaf pages driven by a data table in [content.ts](frontend/src/lib/content.ts), each with `generateMetadata` + JSON-LD + sitemap entries) unblocks: search capture for "Builderforce + {tool}" and "{competitor} alternative" queries without thin-page bloat.
- **Token-cost pass (2026-06-04) — closed this pass (kept here only as the verification record; remove on next edit):** (1) gateway PREMIUM Anthropic model was the retired `anthropic/claude-3.7-sonnet` → now `anthropic/claude-sonnet-4.6` + added `anthropic/claude-haiku-4.5` STANDARD ([openrouter.ts](api/src/application/llm/vendors/openrouter.ts)); (2) gateway prompt-cache token accounting — `VendorUsage`/`pickUsage` now capture `cache_read_input_tokens` / `cache_creation_input_tokens` (and the OpenAI `prompt_tokens_details.cached_tokens` shape), threaded through `LlmUsage` → `logUsage` → new `cache_read_tokens` / `cache_creation_tokens` columns ([migration 0079](api/migrations/0079_llm_usage_cache_tokens.sql)); (3) per-plan `max_tokens` ceiling ([PlanLimits.maxTokensPerRequest](api/src/domain/tenant/PlanLimits.ts) Free 4K / Pro 16K / Teams 64K, clamped in [llmRoutes.ts](api/src/presentation/routes/llmRoutes.ts), superadmin + `-1` override exempt).
- **Token-cost pass — VERIFIED NOT BUGS (do not re-audit):** Two claims from the first-pass review were refuted on direct inspection. (a) *agent-runtime "doesn't enable Anthropic caching"* — false: [config/defaults.ts](agent-runtime/src/config/defaults.ts) force-defaults `cacheRetention: "short"` on every Anthropic model (and the primary) under `api_key` auth, which flows through `applyExtraParamsToAgent` → `resolveCacheRetention` → pi-ai `streamSimple`'s `cacheRetention` stream option (which applies the `cache_control` breakpoint). Caching is ON by default. (b) *gateway "strips `cache_control`"* — false: messages are forwarded verbatim ([LlmProxyService.dispatch](api/src/application/llm/LlmProxyService.ts) casts `messages` through and [openrouter buildBody](api/src/application/llm/vendors/openrouter.ts) passes them untouched; [sanitizeRequestToolNames](api/src/application/llm/toolNameSanitizer.ts) spreads `{...m}` preserving `content`). `cache_control` is nested in `messages[].content[]`, not a top-level field, so `stripStandardFields` never touches it. Tenant-set caching survives the proxy today.
- **Token-cost follow-up: cache-read tokens are captured but the daily-cap ledger still charges them at full weight.** Migration 0079 + `pickUsage` now persist `cache_read_tokens` / `cache_creation_tokens`, but the plan daily-limit gate ([llmRoutes.ts](api/src/presentation/routes/llmRoutes.ts) sums `llmUsageLog.totalTokens`) and any per-token billing still count cached reads at 1×. Applying the ~0.1× cache-read / ~1.25× cache-creation weighting to the metered total (and to tenant billing) is a billing-policy change left out of the capture pass. Fixing unblocks: tenants actually paying the cached-input discount, not just seeing it logged.
- **Token-cost follow-up: gateway still has no LLM response cache.** The idempotency-key guard detects replays but explicitly does not cache/replay the response body, and `getOrSetCached` ([readThroughCache.ts](api/src/infrastructure/cache/readThroughCache.ts)) is used for auth/workflow lookups but not for LLM completions; deterministic re-runs re-bill the vendor. Fixing (KV-store `{response, usage, status}` keyed by `(tenantId, idempotencyKey)` with a short TTL and replay on hit) unblocks: dedup of identical completions.
- **Token-cost enhancement: agent-runtime has the SSM hippocampus wired but no InferenceRouter offload.** [agent-runtime/src/infra/ssm-memory-service.ts](agent-runtime/src/infra/ssm-memory-service.ts) loads `@builderforce/memory` and exposes `recallSimilar()`/`learn()`, and the local amygdala (Qwen3-0.6B) already does simple/complex triage ([builderforcellm-local-stream.ts](agent-runtime/src/agents/builderforcellm-local-stream.ts)) — so this is an *enhancement*, not a bug. The library's `InferenceRouter` (perplexity/length/complexity → SSM-vs-cortex) could short-circuit cheap/repeated queries to the local SSM before paying the cortex, on top of the existing triage. Unblocks: further cortex-call avoidance.
- **Token-cost enhancement: agent-runtime compaction is reactive, not proactive.** [agent-runtime/src/agents/compaction.ts](agent-runtime/src/agents/compaction.ts) has the machinery (`estimateMessagesTokens`, `chunkMessagesByMaxTokens`, `stripToolResultDetails`) but it only fires on context overflow; the tool loop in [builderforcellm-local-stream.ts](agent-runtime/src/agents/builderforcellm-local-stream.ts) resends the full growing message list every round. Summarizing completed sub-tasks after N tool rounds (using the hippocampus to distill) rather than waiting for window overflow would cut ~20–30% per-turn on long tool-heavy runs.
- **Native client apps were migrated into [apps/](apps/) as raw source but are not branded or CI-wired.** This pass consolidated the Android/iOS/macOS/shared clients (627 tracked files) out of the now-archived `SeanHogg/BuilderForceAgents` repo (the renamed-and-deprecated `coderClaw` repo) into [apps/](apps/), closing the "native apps have no home in Builderforce.ai" gap. **Still deferred:** (a) ~445 of those files still carry `coderclaw` branding, including the Android package namespace `ai.coderclaw.android` ([apps/android/app/build.gradle.kts](apps/android/app/build.gradle.kts), [AndroidManifest.xml](apps/android/app/src/main/AndroidManifest.xml) and the whole `java/ai/coderclaw/android/**` tree), iOS/macos bundle ids, and in-app copy — none rewritten to the BuilderForce brand; (b) the apps are standalone gradle/xcode projects with no entry in any Builderforce.ai build/CI pipeline (the repo has no root `pnpm-workspace.yaml`/`package.json`), so they are parked source that nothing builds, tests, or releases; (c) `apps/ios/fastlane/.env.example` had to be force-added past the root `.gitignore` `.env.*` rule — fine for a template, but the fastlane signing/release flow it documents is not connected to any pipeline here. Fixing (rename the `ai.coderclaw.*` namespaces + bundle ids to the BuilderForce brand via a one-shot codemod, then add a native-build CI job — gradle assemble + xcodebuild — and decide the release/appcast path now that [appcast.xml](appcast.xml) for the macOS app no longer lives beside the runtime) unblocks: shippable, brand-consistent native clients instead of archived-repo source parked in-tree. Related to the agent-runtime lobster/brand-sweep entry above — same "consolidated deployable still wears the old brand" root cause.
- **Semantic cache (2026-06-06): the agent cortex call is not yet wrapped, so the agent isn't saving tokens yet.** The `@builderforce/memory` `SemanticCache` (L1 on-device SSM embeddings + L2 gateway) is fully built and wired into [`SsmMemoryService`](agent-runtime/src/infra/ssm-memory-service.ts) (public `semanticCache` field + `getCachedOrGenerate`, 3 tests green), and the shared L2 endpoint ships at [`/v1/semantic-cache`](api/src/presentation/routes/semanticCacheRoutes.ts) (6 tests green). **Not yet done:** the cortex seam [`callExecutionLlm`](agent-runtime/src/agents/builderforcellm-local-stream.ts) (called at the code/fix/direct passes) does not consult the cache. Wiring it needs the cache threaded down — `runBuilderForceAgentsLlmLocalRequest(request)` takes only `request`, so add `semanticCache?` to `BuilderForceAgentsLlmLocalRunRequest` and populate it from the `SsmMemoryService`-owning caller — plus nullable-result handling (do **lookup-first / store-only-on-non-null** via `service.semanticCache.lookup`/`.store`, not `getOrGenerate`, since the provider loop can return `null`) and a query derived from the last user message. Needs live agent verification. Fixing turns the built capability into actual agent-side token savings.
- **Semantic cache: the web app cannot use it yet — frontend is still on the old raw engine, not `@builderforce/memory`.** [frontend/src/lib/model-provider.ts](frontend/src/lib/model-provider.ts) imports `MambaModel` from the `mambacode.js` git dep and never constructs the memory runtime/`SemanticCache`. To deliver the cross-surface win (a web cache hit saving agent tokens and vice-versa), the frontend must: (a) add `@builderforce/memory`(+`-engine`) deps and swap the `mambacode.js` git specifier (see the existing "frontend still consumes the engine via the mambacode.js git URL" entry — same root cause, bundle once), (b) construct a browser `SemanticCache` with `embed = (t) => session.embed(t)` (WebGPU SSM, free L1) + `FetchSemanticCacheBackend({ baseUrl, apiKey: tenant token })` for L2, and (c) wrap the cloud-inference path in `model-provider.ts` with `cache.getOrGenerate`. Needs live browser-bundle verification (WebGPU + COOP/COEP). Fixing makes the marketed "Semantic Response Cache" feature real on the web surface.
- **Gateway semantic-cache L2 is KV brute-force, not a vector index.** [`semanticCache.ts`](api/src/application/llm/semanticCache.ts) keeps a bounded (200-entry) per-tenant+namespace list in `SEMANTIC_CACHE_KV` and brute-forces cosine on lookup — fine at that bound, but it caps recall and won't scale to large tenants. Upgrade path: a Cloudflare **Vectorize** index keyed per tenant/namespace (ANN lookup, no 200-entry cap), keeping the same `/v1/semantic-cache` wire contract so clients don't change. Also: `SEMANTIC_CACHE_KV` must be provisioned + bound in `wrangler.toml` (unbound today → the endpoint degrades to miss/no-op and clients run L1-only). Fixing unblocks production-scale shared caching.
- **Agent API-key prefix migration `clk_`→`bfa_` is half-done (dual-accept live; legacy keys not yet rotated/dropped).** New BuilderForce Agents are now minted as `bfa_*` ([agentHostRoutes.ts](api/src/presentation/routes/agentHostRoutes.ts) `generateApiKey('bfa')`) and auth accepts BOTH `bfa_`/`clk_` ([llmRoutes.ts](api/src/presentation/routes/llmRoutes.ts)), so no new credential carries the retired "claw" brand and existing `clk_` keys keep working. **Remaining:** (a) rotate already-issued `clk_*` keys to `bfa_*`, then delete the `clk_` acceptance branch + the `'clk'` cache-namespace string ([keyResolutionCache.ts](api/src/infrastructure/auth/keyResolutionCache.ts)) once none remain; (b) the **`clu_`** legacy user-bootstrap key ([HashService.ts](api/src/infrastructure/auth/HashService.ts), minted in [AuthService.ts](api/src/application/auth/AuthService.ts)) is also a `cl*` brand remnant — rename under the same dual-accept playbook if still in use. Fixing unblocks: zero "claw" in any credential prefix.
- **Marketing feature copy lives in three unconnected lists (pre-existing DRY gap).** The new auto-assign / agents-ship-code capabilities were placed on the [/agents page](frontend/src/app/agents/page.tsx) (the agent marketing surface that renders its full hardcoded list). Separately, the landing page ([page.tsx](frontend/src/app/page.tsx)) has its own inline feature list, and [content.ts `FEATURES`](frontend/src/lib/content.ts) is consumed ONLY by [RegisterPageClient.tsx](frontend/src/app/register/RegisterPageClient.tsx) as `FEATURES.slice(0, 6)`. Three sources, no shared component. Fixing (one `Feature`-shaped source in content.ts — icons included — consumed by all three surfaces, dropping the per-page arrays and the register slice) unblocks: a single source of truth so a new capability appears everywhere at once.
- **Per-agent cron is now storable + scoped in the UI, but the cron poller doesn't route a fired job to that agent yet.** This pass added `cron_jobs.project_agent_id` ([migration 0081](api/migrations/0081_cron_per_project_agent.sql) + [schema.ts](api/src/infrastructure/database/schema.ts)), threaded it through the cron GET/POST ([agentHostRoutes.ts](api/src/presentation/routes/agentHostRoutes.ts) — `projectAgentId` numeric=agent, `none`=project-wide/NULL), `cronApi` ([builderforceApi.ts](frontend/src/lib/builderforceApi.ts)), and `CronJobsContent` → so the Agent/Capabilities tab shows project-wide schedules under "Project-wide" and per-agent schedules under each selected agent. **Still open:** the cron executor still fires on the project's `assignedAgentHostId` and the poller ignores `project_agent_id` when dispatching — so a per-agent schedule is correctly *stored/scoped* but the fired run is not yet directed to that specific agent's duty/runtime. Fixing (have the cron poller pass `project_agent_id` into the dispatched task → resolve that agent's runtime/assignment) unblocks: a per-agent schedule actually executing *as* that agent.
- **CANONICAL AGENT MODEL (stated 2026-06-06) — foundation + assignment UI built; runtime-consumption + legacy migration remain.** Target: an agent registered ONCE (tenant-scoped) is *assigned* to platform aspects — Project, Workflows (execute under a project OR globally), Architecture analysis, Security, Swimlanes, AI Brain (switch to a chosen Agent **or** Persona); cron per-project AND per-agent. **BUILT this pass:** the single polymorphic store — [migration 0082](api/migrations/0082_agent_assignments.sql) + `agentAssignments` ([schema.ts](api/src/infrastructure/database/schema.ts)) keyed by `(agentKind, agentRef, scope ∈ project|workflow|architecture|security|swimlane|brain|global, scopeId, executionScope ∈ project|global)`; [AgentAssignmentService](api/src/application/agent/AgentAssignmentService.ts) (read-through cached, invalidate-on-write) + cached routes [/api/agent-assignments](api/src/presentation/routes/agentAssignmentRoutes.ts); one shared frontend [agentAssignmentsApi](frontend/src/lib/builderforceApi.ts) + reusable [AgentAssignmentPanel](frontend/src/components/AgentAssignmentPanel.tsx) over a shared [agentPool](frontend/src/lib/agentPool.ts) loader (DRY — AgentCapabilitiesContent now uses it too); the panel is wired into **Architecture analysis** ([architect/page.tsx](frontend/src/app/architect/page.tsx)) and **Security** ([security/page.tsx](frontend/src/app/security/page.tsx)), and the **Brain** has an Agent/Persona switcher ([BrainPanel.tsx](frontend/src/components/brain/BrainPanel.tsx)) that overrides the conversation system prompt from `scope='brain'` assignments + built-in modalities. **RUNTIME CONSUMPTION — done where a run-path exists:** the architecture-analysis run now executes AS its assigned agent — [AnalysisRunnerDO.resolveArchitectAgentModel](api/src/infrastructure/relay/AnalysisRunnerDO.ts) reads `agent_assignments` (scope='architecture') and resolves the agent's real `base_model` via the shared [resolveAssignedAgent](api/src/application/swimlane/resolveAssignedAgent.ts), passing it into [ArchitectAnalysisService](api/src/application/repoanalysis/ArchitectAnalysisService.ts) → the gateway `complete({ model })` (a gateway-resolvable model — the earlier `workforce-<id>` string was NOT resolvable by the gateway); the cron poller now runs a per-project-agent schedule in that agent's own session ([cron-poller.ts](agent-runtime/src/infra/cron-poller.ts) `projectAgentId` → `project-agent-<id>` session). **NOW CONSUMED (this pass):** (a) **Brain model** — DONE: the embedded package gained a per-conversation `model` option ([brain-embedded useBrainConversation](brain-embedded/src/useBrainConversation.ts) + `streamChatCompletion`, dist rebuilt), and [BrainPanel](frontend/src/components/brain/BrainPanel.tsx) routes a selected workforce agent to its real `base_model` from the shared [agentPool](frontend/src/lib/agentPool.ts) (the Brain streams to the gateway, which resolves real model ids; persona/registered → default). (a2) **Security** — DONE: a real run-path now consumes the assignment — [SecurityReviewService](api/src/application/security/SecurityReviewService.ts) + `POST /api/security/review` ([securityReviewRoutes](api/src/presentation/routes/securityReviewRoutes.ts)) reviews supplied code/diff AS the agent assigned to security (`scope='security'` → its model). **CORRECT BY DESIGN (not a gap):** (a3) **registered** agents are external endpoint-based (`agents.endpoint`), so they have no gateway model — architecture/security consumption resolves their model to null → default cascade (workforce agents route fully to their `base_model` via `resolveAssignedAgent`). Truly executing AS a registered agent means forwarding to its endpoint (the `/api/agents/:id/forward` dispatch path), a separate integration from gateway model-routing. **STILL OPEN:** (b) **Workflow** execution-scope (project vs global) is now BUILT — `workflow_definitions.execution_scope` ([migration 0083](api/migrations/0083_workflow_execution_scope.sql) + [schema.ts](api/src/infrastructure/database/schema.ts)), persisted via the definition create/update routes ([workflowDefinitionRoutes.ts](api/src/presentation/routes/workflowDefinitionRoutes.ts)) and a "Runs under project / Runs globally" selector in the builder toolbar ([WorkflowBuilder.tsx](frontend/src/components/workflow-builder/WorkflowBuilder.tsx)); STILL OPEN there: the orchestrator/run path doesn't yet branch behaviour on `executionScope` (it's stored + inherited but not differently executed); (c) **legacy concepts coexist (mostly by design, not duplication)** — `agent_assignments` is the canonical *surface-assignment* model; `swimlaneAgentAssignments` is being unified onto the same agent-resolution path by the concurrent lane-action refactor (shared `resolveAssignedAgent`); `project_agents` remains the project *capability-attachment* surface (it carries governance + is the `scopeId` for `artifact_assignments` scope='agent', a distinct concern); and `project.assignedAgentHostId` is the executor *host* (not an agent), also distinct. So the only genuine overlap (swimlane target) is being collapsed by the active refactor; no risky big-bang `project_agents` data migration is warranted. Fixing (optionally fold `project_agents` attachment into `agent_assignments` scope='project' if a single attachment store is later desired) unblocks: one literal table for every attachment — currently unnecessary since the concerns differ.- **The cron executor (`project.assignedAgentHost`) is decoupled from the agents attached in the Agent/Capabilities tab.** That tab attaches `project_agents` (workforce/registered refs), but cron executes on the project's `assignedAgentHostId` (a runtime agentHost). So a user can attach an agent yet still see "Assign an agent host… to schedule cron runs" because no executor host is set — two different "assign an agent" notions ([project_agents] vs [assignedAgentHost] vs swimlane `swimlaneAgentAssignments.target`). Fixing (when an On-Premise/Cloud agent is attached, set/derive the project's executor `assignedAgentHostId`; unify the three agent-attachment concepts behind one model) unblocks: cron + autonomous execution sharing one coherent "agent assigned to project" concept.
- **README architecture/integration sections still document STALE pre-rename code artifacts.** Top-of-file marketing prose is now rebranded, but deeper sections (the orchestration-portal route list ~58–63, the self-bootstrap walkthrough ~522–805, the architecture diagram ~410–447) still name `/api/claws`, `ClawRelayDO`, `.coderClaw/`, `X-Claw-Signature`, and the `coderclawllm/workforce-*` model id — identifiers that were renamed in code (`/api/agent-hosts`, `AgentHostRelayDO`, `.builderforce/`, `X-AgentHost-Signature`) per the rebrand section below. These are code-accuracy fixes (not just prose) and belong to that tracked rebrand effort. Fixing (reconcile each documented identifier against current code names) unblocks: README that matches the shipped API.
- **Agent-picker consistency sweep (2026-06-07): unified pickers now include cloud agents; two host-only EXECUTION pickers remain (need a host-less cloud executor).** Every "assign/select an agent" surface now draws from the shared [loadAgentPool](frontend/src/lib/agentPool.ts) (owned + purchased + registered): project Agent/Capabilities, swimlane lanes, architecture, security, Brain, Observability's cloud list, and the **task "Run this task" picker** ([RunAgentControl](frontend/src/components/task/RunAgentControl.tsx) — now offers Auto + Cloud agents + Self-hosted; picking a cloud agent runs the task AS its `base_model` with an auto/fleet executor). **STILL host-only:** the OLDER workflow-create picker ([WorkflowsContent](frontend/src/components/WorkflowsContent.tsx) "Select agentHost…", which pushes a workflow to a specific relay host) — the newer [WorkflowBuilder](frontend/src/components/workflow-builder/WorkflowBuilder.tsx) already lists cloud run-targets via `/run-targets`. **Server-side cloud execution now exists (2026-06-07): executions no longer hang in `pending`.** When no online agentHost takes a task dispatch, [runtimeRoutes](api/src/presentation/routes/runtimeRoutes.ts) `runCloudExecution` runs the task server-side via the gateway (`ideProxy.complete` with the chosen agent's `base_model`) and transitions the execution pending→running→completed with the result (task syncs to in_review). So a cloud/Auto run produces a deliverable instead of stalling. **Residual:** (a) this is a single-completion executor — it produces text deliverables (audits, plans, copy) but does NOT clone a repo / run tools / open a PR; coding tasks that need a real workspace still require an agentHost (the headless cloud-coding loop) or browser worker. (b) the OLDER workflow-create picker ([WorkflowsContent](frontend/src/components/WorkflowsContent.tsx)) is still host-only (the newer WorkflowBuilder lists cloud run-targets). Fixing (route coding/tool tasks through the full agent loop server-side, and add cloud agents to the workflow-create picker) unblocks: cloud agents doing full tool-using work with no self-hosted runtime.
- **Cloud agents have no observability stream — Observability is relay/agentHost-only.** [ObservabilityContent](frontend/src/components/ObservabilityContent.tsx) streams live logs over the agentHost relay WS and fetches timeline telemetry per `agent_host_id` ([telemetry_spans](api/src/infrastructure/database/schema.ts) + [executions](api/src/infrastructure/database/schema.ts) are both keyed by `agent_host_id`). Cloud agents (`ide_agents`) run server-side via the gateway and emit NO relay logs and NO agent-keyed telemetry, so they can't be streamed here. This pass (a) folded Observability INTO the project **Agent / Capabilities** tab and removed the standalone Observability tab ([ProjectDetailsPanel](frontend/src/components/ProjectDetailsPanel.tsx) → [AgentCapabilitiesContent](frontend/src/components/AgentCapabilitiesContent.tsx) renders `ObservabilityContent`), since observability is agent-scoped; and (b) renamed "Active Agents" → "Self-hosted agents" with real ONLINE/OFFLINE status per host + a read-only "Cloud agents" list. **Cloud-run debugging now exists via the execution record (2026-06-07):** a cloud/Auto execution shows its **status + output + error** in the Task → Agent tab execution detail ([TaskAgentTab](frontend/src/components/task/TaskAgentTab.tsx) now renders `errorMessage`), and [runCloudExecution](api/src/presentation/routes/runtimeRoutes.ts) stamps the run with `[ran as <model> · trace <id>]` so the full LLM request/response is inspectable in the gateway `llm_traces` view. **Residual:** the execution doesn't deep-LINK to its `llm_trace` row, model/tokens aren't structured fields on the detail (only in the debug string), and there's no live token stream (a cloud run is a single server-side completion — no process to stream). Fixing (store `trace_id`/`model`/tokens as execution columns + a "view trace" link, plus a per-agent `telemetry_spans` trail + project-scoped Observability query) unblocks: full cloud-agent observability in the same tab.
- **`ArtifactAssigner` has no 'agent' scope — a skill/persona/content can't be assigned directly to a cloud agent from its own page.** [ArtifactAssigner](frontend/src/components/ArtifactAssigner.tsx) offers `scope ∈ host | project | task` only, so from a skill's page you can attach it to an agentHost/project/task but not to a specific cloud agent. The per-agent path DOES exist via the project **Agent / Capabilities** tab ([CapabilitiesContent](frontend/src/components/CapabilitiesContent.tsx) scope='agent' on the project_agent bridge), so this is a missing shortcut, not a missing capability. Fixing (add an 'agent' scope to ArtifactAssigner sourced from the shared `loadAgentPool`, writing `artifact_assignments` scope='agent' against the agent's bridge id) unblocks: assigning a skill/persona to a cloud agent from anywhere, consistently.
- **Skills/Personas pages gate install UI on `agentHosts.length > 0`, ignoring cloud agents.** [skills/page.tsx](frontend/src/app/skills/page.tsx) (and personas) set `hasAgentHosts` from `agentHosts.list()` only, so a tenant whose only agent is a Cloud agent sees the "register a self-hosted agent" gate even though it has an assignable agent. Fixing (compute the gate from the shared `loadAgentPool` — any agent of any kind — not just relay hosts) unblocks: cloud-only tenants using the skills/personas install flow.
- **`cosineSimilarity` is duplicated in the gateway (can't import the WebGPU library into a Worker).** [`api/src/application/llm/semanticCache.ts`](api/src/application/llm/semanticCache.ts) carries a local copy of the cosine maths that also lives in `@builderforce/memory`'s `similarity` module, because importing the memory package would drag the WebGPU engine into the Worker bundle. The two must stay in sync by hand. Fixing (extract a zero-dep `@builderforce/similarity` micro-package both can import, or a shared `vector-math` source file) removes the drift risk.
- **Cloud-coding end-to-end (2026-06-06): browser PR-open closed; headless agentHost execution + deploy still open.** This pass made the cloud coding loop real on the **browser** path and built the **server contracts** for the headless path. CLOSED this pass: (1) the browser worker now opens a PR after pushing — new [createPullRequest.ts](api/src/application/repos/createPullRequest.ts) (GitHub REST, idempotent on 422) + shared [openDispatchPullRequest.ts](api/src/application/repos/openDispatchPullRequest.ts), driven from `POST /api/agent-runtime/:dispatchId/pull-request` and wired through the browser stack ([transport.ts](frontend/src/lib/browserRuntime/transport.ts)/[coding.ts](frontend/src/lib/browserRuntime/coding.ts)/[factory.ts](frontend/src/lib/browserRuntime/factory.ts)/[AgentWorker.tsx](frontend/src/app/agent-worker/AgentWorker.tsx)), recording the PR in `pull_requests` and writing `tasks.githubPrUrl/PrNumber` back; (2) host-authed result writeback `POST /api/agent-hosts/:id/dispatch-result` → `SwimlaneCoordinator.reportDispatchResult` (the headless analogue of the browser's tenant-JWT `/result`); (3) host-authed dispatch detail `GET /api/agent-hosts/:id/dispatch/:dispatchId` (returns repo coords + the host git-proxy path) and a host-authed git-proxy `(/info/refs|/git-upload-pack|/git-receive-pack)` so a headless host clones/pushes with the token injected SERVER-SIDE (never on the relay); (4) DRY extractions: [agentHostAuth.ts](api/src/infrastructure/auth/agentHostAuth.ts), [resolveRepoCredential.ts](api/src/application/repos/resolveRepoCredential.ts), [resolveDefaultRepo.ts](api/src/application/repos/resolveDefaultRepo.ts), `executeGitProxy` in [gitProxy.ts](api/src/application/repos/gitProxy.ts) (shared by both proxies); (5) confirmed COOP/COEP already cover `/agent-worker` site-wide so the WebContainer build gate boots (the old "worker route needs COOP/COEP" note is stale). The **runtime handler is now built + unit-tested** (CLOSED): the relay ([agent-runtime/src/infra/builderforce-relay.ts](agent-runtime/src/infra/builderforce-relay.ts)) has an `agent_dispatch` case → [builderforce-coding-dispatch.ts](agent-runtime/src/infra/builderforce-coding-dispatch.ts) (+ [adapters](agent-runtime/src/infra/builderforce-coding-dispatch-adapters.ts) + [coding-session-broker.ts](agent-runtime/src/infra/coding-session-broker.ts)) that calls `GET /api/agent-hosts/:id/dispatch/:dispatchId`, clones via the host git-proxy (`git -c http.extraHeader='Authorization: Bearer <agent-key>'`), runs the embedded agent session, commits/pushes, calls the host PR endpoint, and reports via `POST /api/agent-hosts/:id/dispatch-result`. Deploy artifacts added: [fly.toml](agent-runtime/fly.toml) + [docs/CLOUD_DEPLOY.md](agent-runtime/docs/CLOUD_DEPLOY.md). The Docker build is now unblocked (the `@builderforce/memory` hard dep was removed + lockfile resynced — see that entry; `pnpm install --frozen-lockfile` passes). **STILL OPEN (live verification only):** no live cloud run has executed the loop yet — the full chain is typecheck- + unit-verified AND covered by an end-to-end integration test ([builderforce-coding-dispatch.integration.test.ts](agent-runtime/src/infra/builderforce-coding-dispatch.integration.test.ts), which drives the real runtime handler + real git/http adapters over a REAL local bare git repo + a fake host API server), but the clone→agent→push→PR→advance round-trip has not been smoke-tested against a *deployed* Cloud agent + a *real* GitHub repo (that needs a cloud account, a Neon DB, a tenant JWT, and a repo credential — external inputs). Fixing unblocks: confirmed production round-trip. NOTE: a swimlane assignment of ANY agent type (Cloud or On-Premise) now routes correctly — assignments fall back to the tenant default agent when no explicit target is set ([SwimlaneCoordinator.launchStage](api/src/application/swimlane/SwimlaneCoordinator.ts) + `getDefaultAgentHostId`), and the lane config UI ([BoardConfigPanel.tsx](frontend/src/components/board/BoardConfigPanel.tsx)) now offers an agent target picker.
- **Cloud-coding follow-ups.** (a) **Changed-files are text-only** — the dispatch `output` now includes the changed-files list + PR link, and `GET /api/agent-runtime/:dispatchId` exposes it, but there is no structured diff/changed-files *viewer* on the kanban card (the card shows the PR URL via `tasks.githubPrUrl`; the PR itself is the real diff). Fixing (a card diff affordance reading the dispatch output) unblocks: an in-board diff without opening the PR. (b) **PR-open is GitHub-only** — `createPullRequest` returns `unsupported` for bitbucket/gitlab (branch still pushes); the agent degrades to "branch pushed, open PR manually". (c) **Caching note (perf rule):** the host `GET /dispatch/:dispatchId`, the tenant `GET /api/agent-runtime/:dispatchId`, and the git-proxy reads are deliberately NOT run through `getOrSetCached` — git smart-HTTP is dynamic; the dispatch reads are live status (flip pending→running→completed mid-execution) and the credential read resolves a decrypted token (caching a token in KV is a security non-starter), one-shot per dispatch — so there is no read-amplification to cache; the repo *metadata* portion could be cached keyed by repoId if it ever becomes hot.

This pass renamed the project panel's **Capabilities** tab to **Agent / Capabilities** ([AgentCapabilitiesContent](frontend/src/components/AgentCapabilitiesContent.tsx) + [ProjectDetailsPanel](frontend/src/components/ProjectDetailsPanel.tsx)) — listing/adding both workforce and registered agents and letting skills/personas/content/governance be assigned project-wide **or** per agent — and consolidated the **Brain** + **Chat** tabs into one **Brain Chat** tab that embeds the docked [BrainPanel](frontend/src/components/brain/BrainPanel.tsx) pinned to the project. Per-agent scoping is real end-to-end: a new `project_agents` table (migration [0075](api/migrations/0075_project_agents_and_agent_scope.sql)) gives each attached agent a numeric id, and `artifact_assignments` gained an `agent` scope keyed on it. Remaining roadmap items:

- **Per-agent capabilities are stored & editable but not yet consumed at execution time.** [resolveArtifacts](api/src/application/artifact/resolveArtifacts.ts) accepts an optional `agentAssignmentId` (and `/api/artifact-assignments/resolve?agentId=` is wired), but no runtime/dispatch caller maps a running execution back to a `project_agents.id`, so `scope='agent'` skills/personas/content do not yet flow into agent runs. Fixing (thread the project-agent id through the swimlane/agent-runtime dispatch path into `resolveArtifacts`) unblocks: per-agent skills/personas actually shaping that agent's behaviour, not just being editable in the UI.
- **Per-agent governance is captured but not surfaced to runtime.** `project_agents.governance` is editable via [GovernanceContent](frontend/src/components/GovernanceContent.tsx) (agent mode) + `PUT /api/project-agents/:id/governance`, but governance text is not part of `resolveArtifacts` (it's separate project-level prose consumed elsewhere), so the per-agent governance never reaches an execution. Fixing (include the agent's governance in the resolved execution context alongside the project governance) unblocks: agent-specific guardrails at run time.
- **Agent pool scoping is asymmetric.** The Add-agent picker lists *all* tenant registered agents but only workforce agents whose `project_id` matches the current project ([AgentCapabilitiesContent.loadPool](frontend/src/components/AgentCapabilitiesContent.tsx)); a workforce agent published under a different project cannot be attached here even though `project_agents` could hold it. `project_agents` is the source of truth for "on this project" (registered agents have no native project link). Fixing (decide whether cross-project workforce agents should be attachable — if so, broaden the pool query) unblocks: reusing a custom agent across projects.

### Cloud Agent Boards (added 2026-06-01 — migrations 0064–0068; swimlanes / board-sync / PRD / repos / agent dispatch)

Execution + autonomous advancement + in-browser coding are now wired and tested (migration 0068 `agent_dispatches`): `SwimlaneCoordinator.startTicket` compiles the lane's agents into dispatches and routes them (claw push via `ClawStageDispatcher`/`CLAW_RELAY`, or browser PULL); `reportDispatchResult` aggregates the stage and autonomously advances the ticket (or routes to needs_attention — never a silent advance). The user-facing worker tab ([frontend/src/app/agent-worker/page.tsx](frontend/src/app/agent-worker/page.tsx)) claims `browser` dispatches; for a repo-targeted task it CODES in-browser — the agent's model proposes file edits, which are applied and pushed through the server-side git-proxy via isomorphic-git (`frontend/src/lib/browserRuntime/{gitClient,coding,factory}.ts`), with an optional WebContainer build/test gate that blocks a push on failure. Backed by `POST /api/agent-runtime/claim` + `/result` and `POST /api/git-proxy/:repoId/...`. Orchestration is unit/render-tested; the live WebContainer boot + isomorphic-git↔git-proxy round-trip are integration-validated in a real tab only. Remaining roadmap items:

- **The worker route needs COOP/COEP headers for the WebContainer build gate to boot.** The in-browser clone/edit/push path works without a WebContainer; the optional build/test gate ([frontend/src/lib/browserRuntime/webcontainer.ts](frontend/src/lib/browserRuntime/webcontainer.ts) + `factory.bootWebContainer`) requires cross-origin isolation, so the `/agent-worker` route must be served with `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` (a Next.js header config). Until then `createCodingDeps` is called without a `buildCommand` and agents push without the local build gate. Fixing (add the COOP/COEP headers for that route and pass the project's build command) unblocks: pre-push build/test validation in the browser.

### Agentic Workflow Builder (added 2026-06-02 — migration 0060; visual IPAAS-style workflow authoring + LLM-logic nodes)

A drag-and-drop builder ([WorkflowBuilder](frontend/src/components/workflow-builder/WorkflowBuilder.tsx) on `@xyflow/react`, route `/workflows/builder`) lets tenants compose workflow graphs from a node palette that includes LLM-logic nodes — **memory** (recall/write), **knowledge base** (query/ingest), **train** — plus **agent-run** and ETL/trigger/output nodes. Graphs persist as reusable `workflow_definitions` (migration [0060](api/migrations/0060_workflow_definitions.sql), [schema.ts](api/src/infrastructure/database/schema.ts), [workflowDefinitionRoutes.ts](api/src/presentation/routes/workflowDefinitionRoutes.ts)) and compile through the shared contract ([domain/workflowGraph.ts](api/src/domain/workflowGraph.ts)) into orchestrator steps; CoderClaw's [orchestrator](../coderClaw/product/src/coderclaw/orchestrator.ts) now executes the LLM-logic/ETL node kinds in-process via dedicated handlers. The shape mirrors the existing execution-record + telemetry-graph surfaces, so a definition run appears in the monitoring UI for free.

The six original roadmap items were closed in a follow-up pass: **portal→host execution** (host-authed `POST /api/workflows/claim` + `/:id/host-result` in [workflowRoutes.ts](api/src/presentation/routes/workflowRoutes.ts), a [WorkflowPollerService](../coderClaw/product/src/infra/workflow-poller.ts) wired in [server-startup.ts](../coderClaw/product/src/gateway/server-startup.ts), and `orchestrator.createWorkflowFromTasks`); **memory-write / KB-ingest / train** (real delegates on [SsmMemoryAdapter](../coderClaw/product/src/infra/orchestrator-ports-adapter.ts) → `remember`/`learn`/`distillAndSave`, plus a `train` port); **ETL evaluation** ([node-eval.ts](../coderClaw/product/src/coderclaw/node-eval.ts) — safe, eval-free predicate/transform); **YAML isomorphism** (`definitionToYaml`/`yamlToDefinition` + `/:id/export` + `/import`); and **caching** (canonical [getOrSetCached](api/src/infrastructure/cache/readThroughCache.ts) L1+L2 on the definitions list). Residual items:

- **Branch nodes annotate but don't prune downstream edges.** [executeNode](../coderClaw/product/src/coderclaw/orchestrator.ts) evaluates a branch condition and tags the payload `[branch:true|false]`, but `executeWorkflow` still runs *all* dependents regardless of the result — there is no conditional edge pruning, so a `false` branch's downstream nodes execute anyway. Fixing (have the executor skip the dependents of the untaken branch by marking them cancelled) unblocks: true conditional routing rather than annotate-and-continue.
- **Transform nodes are `{{var}}` template-substitution only.** [applyTransform](../coderClaw/product/src/coderclaw/node-eval.ts) interpolates context variables but cannot map/reshape structured payloads (no JSONata-style engine). Sufficient for simple shaping; richer transforms need a fuller (still-sandboxed) expression runtime. Fixing unblocks: structural payload transforms, not just string interpolation.
- **The claim→execute→report loop is typecheck-verified, not integration-tested.** [WorkflowPollerService](../coderClaw/product/src/infra/workflow-poller.ts) + the host-authed claim/host-result endpoints compile and are unit-reasoned, but the live host round-trip (claim → orchestrator run → result writeback) has no end-to-end test. Fixing (an integration test that stands up a fake host against the claim/result endpoints) unblocks: confidence the portal→host loop survives refactors.
- **train / memory-write / KB-ingest are no-ops on GPU-less hosts.** The handlers delegate to [SsmMemoryService](../coderClaw/product/src/infra/ssm-memory-service.ts), whose `learn`/`distillAndSave` guard on `gpuAvailable`; on a CPU-only host these nodes complete but persist/adapt nothing (`remember` still works for memory-write). Environmental, not a code defect — operators running training/ingest nodes need a WebGPU-capable host.
- **`claw`→`agentHost` rename left 3 columns without a creating migration — `check:schema` is red.** `cron_jobs.agent_host_id`, `contributors.agent_host_id`, and `team_memory.agent_host_id` are declared in [schema.ts](api/src/infrastructure/database/schema.ts) but no migration creates/renames them, so `npm run check:schema` fails. This is collateral of the in-progress agentHost rename, **not** the workflow builder (whose `workflow_definitions` migration [0060](api/migrations/0060_workflow_definitions.sql) passes). Fixing (a rename/add migration for the three columns, mirroring the 0068a backfill pattern, or allowlist entries) unblocks: green schema-drift CI.
- **MCP / SaaS integration nodes (`mcp`) record intent — no transport is wired.** The builder palette now exposes 50+ MCP servers + SaaS integrations (see [integrations.ts](frontend/src/components/workflow-builder/integrations.ts)); they persist, compile, and the orchestrator calls an `IMcpService` ([ports.ts](agent-runtime/src/builderforce/ports.ts), [runMcpNode](agent-runtime/src/builderforce/orchestrator.ts)) — but no adapter is injected, so an `mcp` node returns `no MCP transport wired — recorded intent`. Fixing (an `McpService` adapter that resolves the integration to a tenant MCP extension — [mcpExtensionRoutes](api/src/presentation/routes/mcpExtensionRoutes.ts), serverUrl+secret — or proxies through the gateway, then `invoke({integration, operation, params})`) unblocks: actually executing GitHub/Slack/Postgres/HubSpot/… tool calls from a workflow.
- **No per-integration credential capture in the builder.** `mcp`/`llm` nodes reference integrations whose `auth` is `api-key`/`oauth`/`connection-string`, but the canvas collects no secret — execution relies on the tenant's gateway key (LLM) or MCP-extension secret (MCP), and OAuth integrations have no connect flow. Fixing (a per-node "Connection" picker bound to tenant MCP extensions / an OAuth connect step) unblocks: auth'd integration calls beyond keyless/local servers.
- **Inbound data-collection ingest endpoint is not implemented — marketing triggers can't actually fire.** Data-collection trigger types (form-submit, webhook, page-view, signup, purchase, email-open/click, rss, inbound-email) and trigger integrations (Typeform, Stripe, Segment, …) are configurable + persist + compile, but there is no public HTTP endpoint that RECEIVES an inbound payload and starts a run. Needs a per-definition ingest token (column on `workflow_definitions` + migration), a default agent-host for the run, and a public `POST /api/ingest/:token` route that seeds the trigger node's output with the posted body and instantiates a run (reusing the `/run` compile path). Fixing unblocks: workflows that genuinely fire from collected marketing data (the "marketing platform with triggers" use case).
- **`llm` nodes call the gateway with the host API key, which may not be gateway-authorized.** [GatewayLlmService](agent-runtime/src/infra/gateway-llm-service.ts) POSTs to `/v1/chat/completions` with the agent-host `apiKey` as Bearer; the OpenAI-compatible gateway may require a tenant `bfk_*` key rather than the host (`clk_*`-style) key, in which case the call 401s and the node returns the error string. Fixing (confirm the gateway accepts the host key, or resolve/mint a gateway-scoped credential for the host) unblocks: real LLM-platform calls from `llm` nodes.
- **`/api/agent-runtime` claim/result and `/api/git-proxy` are tenant-JWT auth only.** A claw posting its dispatch result (or a headless cloud worker) would need a claw-API-key auth branch mirroring [specRoutes.ts `verifyClawApiKey`](api/src/presentation/routes/specRoutes.ts). Today claw-runtime dispatches are pushed via `CLAW_RELAY` but their terminal result must come back through `/result` under a tenant token. Fixing unblocks: non-browser executors closing the loop without a user JWT.
- **"Train your own LLM" (custom SSM) is the separate brain/MambaKit subsystem, not these slices.** An agent's "own LLM" here is the model string carried on the swimlane assignment → dispatch → browser runner (routed through the gateway). Training a bespoke on-device SSM model is the `brain-embedded` / MambaKit path and is tracked separately.
- **No scheduled poller drives external board sync; outbox writeback is not triggered.** [SyncEngine.syncConnection](api/src/application/boardsync/SyncEngine.ts) + `drainOutbox` are implemented and unit-tested but only run via `POST /api/board-connections/:id/sync`. No `scheduled()` cron/queue iterates active `board_connections` to poll on their `poll_interval_sec`, and nothing periodically drains `board_sync_outbox`. Fixing (a Cloudflare `scheduled()` handler in [index.ts](api/src/index.ts) — mirroring `runVendorHealthCron` — that calls `syncConnection` + `drainOutbox` per active connection using `drizzleStore` + `createBoardProvider`) unblocks: hands-off inbound polling + reliable reverse-sync.
- **`external_ticket_links` does not persist the normalized field bag.** [drizzleStore.ts](api/src/application/boardsync/drizzleStore.ts) `getLink` returns `fields:null`; reconciliation still works (it keys on `content_hash`/`external_version`), but field-level three-way merge is impossible. Fixing (add a JSON `fields` column to `external_ticket_links` or derive fields from the linked task) unblocks: field-level conflict merge instead of whole-record LWW.
- **PRD routes mount under `/api/prd`, so effective paths are `/api/prd/specs/:id/...`.** [prdRoutes.ts](api/src/presentation/routes/prdRoutes.ts) is registered at `/api/prd` in [index.ts](api/src/index.ts). If the intended public surface is `/api/specs/:id/versions` directly (siblings of the existing specRoutes), mount with `app.route('/api', createPrdRoutes(db))` instead. Fixing (confirm + adjust the mount base) unblocks: a consistent spec/PRD URL namespace.
- **`project_repositories` duplicate insert surfaces as a raw DB error, not a 409.** [RepoService.addRepo](api/src/application/repos/RepoService.ts) does not pre-check the `UNIQUE (project_id, provider, owner, repo)` constraint (migration 0067). Fixing (an `onConflict` guard or a friendly pre-check returning 409) unblocks: clean API behavior on re-adding a repo.
- **PR dispatch resolves the repo from task description only (no labels / explicit repoId).** [repoRoutes.ts](api/src/presentation/routes/repoRoutes.ts) `POST /tasks/:taskId/pull-request` calls `resolveRepoForTask` with description text only, because `tasks` has no labels column; the pure resolver already supports labels + `explicitRepoId`. Also the repo `credential_id` is stored but not decrypted/attached to the dispatch message. Fixing (thread an optional `repoId`/labels from the request body, and resolve+decrypt `integration_credentials` into the claw dispatch payload) unblocks: accurate multi-repo targeting + the claw actually receiving git credentials.
- **`POST /pull-requests/:id/result` is tenant-JWT auth only — claws can't call it with an API key.** [repoRoutes.ts](api/src/presentation/routes/repoRoutes.ts) uses `authMiddleware`; a claw posting PR results would need a claw-API-key branch mirroring [specRoutes.ts `verifyClawApiKey`](api/src/presentation/routes/specRoutes.ts). Fixing unblocks: claws reporting PR number/url/status back without a user JWT.
- **Agent-produced PR is recorded in `pull_requests` but never surfaced on the kanban card or anywhere in the frontend.** [RepoService.recordPrResult](api/src/application/repos/RepoService.ts) updates the `pull_requests` row (number/url/status) but does NOT write the resulting URL back onto `tasks.githubPrUrl`, and the frontend never calls the `GET /api/repos/projects/:projectId/pull-requests` list endpoint ([repoRoutes.ts](api/src/presentation/routes/repoRoutes.ts)) — `builderforceApi.ts` has no repos/PR client. The only PR link shown on a card ([TaskMgmtContent.tsx:634](frontend/src/components/TaskMgmtContent.tsx) / drawer :1215) comes from the manually-typed `githubPrUrl` form field, so an autonomously-created PR is invisible until a human pastes the link. Fixing (write `githubPrUrl` back onto the task in `recordPrResult`, OR add a repos/PR client + a "PRs / changes" tab that reads the pull-requests list) unblocks: closing the agent→visible-change loop without manual copy-paste. This is the "code changes are tracked and you can see what the cloud agent changed" requirement — backend records it, frontend does not display it.
- **No diff / changed-files view for agent changes — only free-text `output` is shown.** Agent results land in `agent_dispatches.output` (text) and are previewed in [WorkflowsContent.tsx](frontend/src/components/WorkflowsContent.tsx), but there is no per-dispatch diff viewer, changed-file list, or commit drill-down, and no `GET /api/agent-runtime/:dispatchId` retrieval endpoint. Fixing (persist the agent's proposed `files[]`/commit metadata from `runCodingDispatch` and render a diff) unblocks: reviewing *what* changed, not just a prose summary.
- **No portal UI for GitHub-credential entry or for board/swimlane/agent assignment — both are API-only.** The backend is complete (`POST /api/integrations` with AES-256-GCM encryption; `POST /api/boards/.../swimlanes/:laneId/agents`) but there is no frontend form for either, so a tenant cannot connect a GitHub PAT or assign an agent to a swimlane without calling the API directly (curl/SDK). Fixing (a Settings → Integrations panel mirroring the API-keys panel, and a board-config UI for swimlanes + agent assignments) unblocks: self-service of the two steps that gate the entire autonomous-execution flow.
- **Schema-drift checker mis-merges any table that uses the `}, (t) => [ … ]` second-arg form, hiding real drift and emitting false positives.** [check-schema-drift.mjs](api/scripts/check-schema-drift.mjs) parses Drizzle tables with `pgTable\(\s*'([^']+)'\s*,\s*\{([\s\S]*?)\n\}\)/` — which only closes on `\n})`. Tables declared with a constraints/indexes callback (`}, (t) => [ unique(...), index(...) ])`) never close there, so the regex swallows everything up to the *next* table's `\n})`, merging two tables' columns under the first table's name and dropping the second table from the check entirely. Concretely: `integration_sync_logs` columns get attributed to `integration_credentials` (forcing the `credential_id`/`status`/`items_*` grandfather lines in [.schema-drift-allowlist.txt](api/scripts/.schema-drift-allowlist.txt)), and `integration_sync_logs` itself is never validated; likewise the new `prompt_library_entries`/`prompt_library_versions` columns from [0069_activity_calendar_and_prompt_library.sql](api/migrations/0069_activity_calendar_and_prompt_library.sql) surface as `report_subscriptions.*` drift, currently reding `npm run check:schema`. Fixing (close the columns block on `\n\}\s*[,)]` instead of `\n\}\)`, then prune the now-stale merged-column allowlist entries) unblocks: real per-table drift detection, removal of the false-positive grandfather hack, and a green `check:schema` for the prompt-library + board-sync schemas. NOTE: this is a broad-blast-radius change to the checker — it may surface real drift currently masked by the merges, so it was deferred out of the deploy-unblock pass (0064_integration_credentials.sql) that only needed the `integration_provider` enum + `integration_credentials`/`integration_sync_logs` tables created.
- **`tenant_mcp_extensions` migration is authored but not applied to any live DB.** This pass added the table to [schema.ts](api/src/infrastructure/database/schema.ts) + [migrations/0055_tenant_mcp_extensions.sql](api/migrations/0055_tenant_mcp_extensions.sql) and the drift check passes, but no `npm run db:migrate` was run (headless env, no DB connection). Until applied, `GET/POST /llm/v1/mcp/*` and the `/api/tenants/:id/mcp-extensions` routes will 500 at runtime with "relation does not exist." Fixing (run `npm run db:migrate` against each environment's Neon DB) unblocks: server-side MCP extensions actually working in prod.
- **Brain embeddable package is the headless core only — `BrainPanel`/`FloatingBrain` still live in the host.** Per the approved plan's "cleaner first cut," [brain-embedded](brain-embedded/) ships the streaming client, contexts, MCP action registry, and conversation/chat hooks, parameterized via `BrainProvider`. The drop-in React UI ([BrainPanel.tsx](frontend/src/components/brain/BrainPanel.tsx), [FloatingBrain.tsx](frontend/src/components/brain/FloatingBrain.tsx)) was NOT moved — moving it cleanly requires injecting `ChatInput`, a `LinkComponent`, the message-actions slot, and a projects adapter (it pulls in `next/link`, `react-markdown`, `@/lib/api`, `ChatProjectActions`). Until then an external consumer wires their own UI on top of the package hooks rather than getting a `<BrainPanel>` drop-in like `<StudioPanel>`. Fixing (move BrainPanel + presentational deps into the package behind injection props) unblocks: a true one-component embed.
- **MCP relay has minimal SSRF protection.** [mcpExtensionService.ts](api/src/application/llm/mcpExtensionService.ts) `assertSafeServerUrl` only requires `https://` — it does NOT block loopback/private-IP/link-local ranges or metadata endpoints (169.254.169.254). A tenant owner could register an internal URL and have the gateway fetch it server-side with stored credentials. Risk is bounded (owner-only, the gateway is multi-tenant but the call is per-tenant), but a malicious/compromised owner could probe internal infra. Fixing (resolve the host and reject private/reserved IP ranges, or pin to an allowlist of public hosts) unblocks: safe arbitrary-URL relay.
- **MCP `listToolsForTenant` re-fetches every enabled extension's `/tools` on each Brain session with no caching.** [mcpExtensionService.ts](api/src/application/llm/mcpExtensionService.ts) calls each MCP server's `/tools` endpoint every time the client `useMcpExtensions` hook mounts. With several extensions this adds latency to every Brain open and can rate-limit the customer's MCP server. Fixing (cache the merged tool list per tenant in `AUTH_CACHE_KV` with a short TTL, mirroring the `bfk_*`/`clk_*` key cache) unblocks: fast Brain startup independent of extension count.
- **No portal UI for managing MCP extensions or viewing/minting embed-session tokens.** The backend routes exist (`/api/tenants/:id/mcp-extensions` CRUD; `/llm/v1/embed-session`), but there's no Settings page to register an MCP server or document the relay token flow — owners must call the API directly. Fixing (a Settings → Brain Extensions panel mirroring the API-keys panel) unblocks: self-service extension management.
- **embed-session tokens have no dedicated rate limit beyond plan-level caps.** [llmRoutes.ts](api/src/presentation/routes/llmRoutes.ts) `/v1/embed-session` mints a 10-min tenant-scoped JWT per server-to-server call; an embedder's relay could mint unbounded tokens (each still bounded by the tenant's daily token budget downstream, but token *minting* itself is unthrottled). Fixing (per-`bfk_*`-key mint rate limit via the existing `TENANT_RATE_LIMITER` DO) unblocks: abuse resistance on the relay endpoint.
- **Phase-1 Brain visibility was verified by unit tests, not a live browser smoke.** The CTA-vs-panel gating + pending-prompt guard are locked by [FloatingBrain.test.tsx](frontend/src/components/brain/FloatingBrain.test.tsx), but the "🧠 appears on marketing/blog pages, opens a sign-in CTA logged-out, full panel logged-in" flow wasn't visually confirmed (headless env). Fixing (manual `npm run dev` smoke or a Playwright e2e across `/`, `/blog`, an app route) unblocks: confidence the visible deliverable renders correctly across all route groups.
- **NVIDIA NIM TTS / audio models are not wired.** The NIM catalog includes audio models (e.g. `magpie-tts-zeroshot`) that use a separate API surface from `/v1/chat/completions` — they don't fit the OpenAI-compatible chat shape that `VendorModule.call` assumes. Adding them would require a parallel `VendorAudioModule` interface or a `/v1/audio/speech`-style endpoint in [LlmProxyService](api/src/application/llm/LlmProxyService.ts). Fixing unblocks: text-to-speech use cases routed through the gateway with budget tracking.
- **NVIDIA API key was leaked into chat transcript on 2026-05-10.** A real `nvapi-...` key was pasted as part of a code-snippet request and is now in conversation/transcript history. The key was never committed to the repo (gateway reads from `env.NVIDIA_API_KEY` set via `wrangler secret put`), but the leaked key still grants quota until rotated on build.nvidia.com. Fixing (rotate the key in the NVIDIA developer portal and `npm run secrets:from-env` after updating `api/.env`) unblocks: confidence that the leaked credential is dead.

### BurnRateOS embed / identity-federation spec (doc 05) — security review 2026-05-31

Reviewed [specs/builderforce/05-integration-embed-and-identity.md](specs/builderforce/05-integration-embed-and-identity.md) against the implementation. The embed *transport* (postMessage token handoff, origin checks both ways, sandboxed iframe, `frame-ancestors` CSP, default-OFF enablement, `resolveSegment()` as the sole `(tenantId, segmentId)` entry, per-segment data scoping) was already solid. **Closed this pass (removed from the register — see git log):** embed `consentVersion` + consent modal; per-scope service tokens (`scopes` on `tenant_api_keys` + scope-check S2S middleware, migration 0070); `DELETE /api/segments/:id` DSR cascade; `resolveSegment` cache bound + invalidation; the copy-paste install snippet in Settings → Embedded Integration; and the channel-3 seams (`POST /v1/ingest/feedback`, `GET /api/bi/burn-rate` pull with graceful fallback, and HMAC+replay-nonce outbound webhooks `sprint.completed` / `roadmap.published`, migration 0071). The federation gap was accepted by design. Remaining roadmap items:

- **[ACCEPTED BY DESIGN 2026-05-31] Identity federation uses a shared-secret HS256 token, not OIDC issuer verification (spec §2.1 + §7 item 1).** [JwtService.verifyJwt](api/src/infrastructure/auth/JwtService.ts) verifies an HMAC-SHA-256 signature against a single shared `JWT_SECRET`; the federation token carries no `iss` claim and [authMiddleware](api/src/presentation/middleware/authMiddleware.ts) does no issuer/`tenants.idp_issuer` check. The spec's wording (BurnRateOS as an OIDC IdP verified by asymmetric issuer + signature) is **intentionally not implemented**: BurnRateOS and BuilderForce are first-party apps with a co-managed secret, so the symmetric model is accepted. Residual risk acknowledged (a secret leak lets either side forge the other's tokens; no cryptographic IdP boundary; `persona`/`plan` claims absent, so plan-based gating falls back to `role` + the segment's `plan`). Revisit only if a non-first-party host ever federates in — then move to RS256/JWKS keyed by the already-present `tenants.idp_issuer` column. No code change this pass.
- **`workitem.released` is a declared webhook event with no emit wiring.** The webhook infra ([webhookService.ts](api/src/application/seams/webhookService.ts)) declares three events; `sprint.completed` and `roadmap.published` are wired via the tracker factory's `emit` hook ([segmentTrackerRoutes.ts](api/src/presentation/routes/segmentTrackerRoutes.ts)), but `workitem.released` has no producer — tasks (the backlog/kanban work items) flow through [TaskService](api/src/application/task/TaskService.ts), not the tracker factory, so nothing emits when a task is released. Fixing (call `emitWebhookEvent` from the task status-transition path when a task reaches a released/done state) unblocks: the Investor board / Changelog feed the spec §4.3 promises.
- **No portal UI for the host BI config — `read:bi.burn` token is unmanaged.** [burnRateService.ts](api/src/application/seams/burnRateService.ts) reads `tenants.settings.hostBi = { baseUrl, token }` to pull burn/runway, but there is no Settings panel to set/rotate it — an owner must write the raw `settings` JSON. The host-issued `read:bi.burn` token therefore has no rotation/audit surface on the BuilderForce side. Fixing (a Settings → Integration "Host BI" panel mirroring the API-keys panel, secret stored encrypted like `tenant_mcp_extensions.secret_enc`) unblocks: self-serve, rotatable cost-aware-agile wiring.
- **Failed webhook deliveries are best-effort with no retry/backoff.** [emitWebhookEvent](api/src/application/seams/webhookService.ts) attempts each delivery once and records `failed`/`pending` rows in `webhook_deliveries`, but nothing redelivers them. A transient receiver outage drops the event permanently. Fixing (a `scheduled()` cron — mirroring the vendor-health cron in [index.ts](api/src/index.ts) — that re-signs and retries `failed`/`pending` deliveries with capped exponential backoff) unblocks: at-least-once delivery semantics.
- **Ingested feedback has no triage UI, and `GET /v1/validation/engagements` proxy is not built.** `POST /v1/ingest/feedback` stores rows in `customer_feedback` (status `new`), but there is no "Voice of customer" inbox to triage them into the backlog (spec §4.2), and the validation-engagements proxy (spec §4.2, PM-4) that lists the host's feedback widgets/cohorts is not implemented. Fixing (a VoC inbox surface reading `customer_feedback` + a `new→triaged` action that spawns a backlog `WorkItem`, plus the proxy route) unblocks: the catalog's promised feedback→backlog flow end-to-end.
- **Migrations 0070 + 0071 are authored but not applied to any live DB.** Added `tenant_api_keys.scopes` (0070) and the `customer_feedback` / `webhook_subscriptions` / `webhook_deliveries` tables (0071) to [schema.ts](api/src/infrastructure/database/schema.ts) + SQL, but no `npm run db:migrate` ran (headless env, no DB connection). Until applied, the seam routes 500 with "relation/column does not exist." Same caveat as the existing `tenant_mcp_extensions` entry. Fixing (run `npm run db:migrate` per environment) unblocks: the seams working in prod.
- **No copy-paste embed snippet matched the spec's "embed snippet rail" wording (now resolved on the impl side; doc divergence remains).** Settings → Embedded Integration now shows a copyable `npm install` + `<BuilderForceEmbed>` block ([EmbedInstallSnippet.tsx](frontend/src/components/settings/EmbedInstallSnippet.tsx)) derived from the enabled capabilities, so a host developer obtains the integration there. The remaining divergence is documentation-only: spec §5.1 still describes riding BurnRateOS's `<script>` embed-snippet rail (a `SystemFeature` row `embed_builderforce`, a snippet subsystem block on `EmbedBurnRateOSPage.tsx`), which was superseded by the npm React-component rail. Fixing (update doc 05 §5.1 to describe the React-component rail as the real contract) unblocks: spec/impl agreement.
- **CoderClaw marketing nav (`.cc-nav`) was NOT migrated to the shared responsive `MarketingHeader`.** This pass extracted [MarketingHeader.tsx](frontend/src/components/MarketingHeader.tsx) (hamburger + slide-out menu, CTA pinned in the header on mobile) and adopted it on the landing page + both blog views, but [coderclaw/MarketingNav.tsx](frontend/src/app/coderclaw/MarketingNav.tsx) was left as-is. It uses a different brand (CoderClaw logo, no "Get Started Free" CTA, GitHub/Docs links) and currently degrades on mobile only via `flex-wrap` + hiding the subtitle at 720px — links wrap to a second row rather than collapsing into a slide-out. It's a separate component because its link set/brand diverge from the Builderforce marketing nav, so it can't take `MarketingHeader` as-is without a `brand`/`logo` prop. Fixing (generalize `MarketingHeader` to accept an optional logo/brand + optional CTA, then drive both navs from it) unblocks: one responsive header for every marketing surface and deletion of the bespoke `.cc-nav` styles.
- **Marketing/mobile responsive changes verified by typecheck + lint + 200-compile only, not a live browser.** This batch — the landing/blog `MarketingHeader` swap, the homepage hero mascot-to-right-column restructure ([page.tsx](frontend/src/app/page.tsx)), the Brain drawer going full-screen on mobile ([FloatingBrain.tsx](frontend/src/components/brain/FloatingBrain.tsx)), the `html { overflow-x: clip }` root guard ([globals.css](frontend/src/app/globals.css)), and hiding the auth-page mascot on mobile ([LoginPageClient.tsx](frontend/src/app/login/LoginPageClient.tsx) / [RegisterPageClient.tsx](frontend/src/app/register/RegisterPageClient.tsx)) — passes `tsc` + `eslint` and every route compiles 200, but client content streams behind a Suspense boundary so the rendered breakpoints were not visually confirmed (no Playwright in this env). In particular the Brain-drawer "cut off / can't close on mobile" fix was diagnosed as horizontal overflow from the off-canvas `.mh-menu` (parked at `translateX(100%)`) not being clipped at the root; the `overflow-x: clip` fix is sound in theory but unconfirmed against a real device. Fixing (a manual `npm run dev` pass at 375/768/1280px or a Playwright snapshot across `/`, `/login`, `/register`, `/blog` with the Brain open) unblocks: confidence the slide-out menu, mascot reflow, and full-screen Brain drawer all behave on-device.
- **No LEARNED (RIFE/FILM) interpolation backend — the classical motion backend is the shipping path; learned flow is a deferred optional upgrade.** Interpolation has two real backends ([GenerateOptions.interpolationBackend](studio/src/types.ts)): `latent-slerp` ([frame-interpolator.ts](studio/src/engine/frame-interpolator.ts)) and `motion` ([motion-interpolator.ts](studio/src/engine/motion-interpolator.ts)), the latter now a COARSE-TO-FINE block optical-flow estimator with SUB-PIXEL parabolic refinement (recovers large motion a single-level search misses; emits fractional vectors for smooth warps). A *learned* flow model (RIFE/FILM) behind the same `estimateBlockMotion`/`interpolateFrames` seam would beat block matching on occlusion/large motion, but needs an external ONNX export + I/O contract that can't be verified without the weights — explicitly deferred (operator decision, 2026-05-31) rather than shipped as speculative fallback-only glue. Fixing (add a `RifeInterpolator` ONNX backend with init-time contract verification + graceful fallback to `motion`, once a target export is pinned) unblocks: best-in-class interpolation on hard motion. Low priority — the motion backend covers the common cases.
- **`dispatchVendor` and `dispatchVendorStream` are structural near-duplicates.** Both functions in [registry.ts](api/src/application/llm/vendors/registry.ts) walk the model chain, resolve vendor+key, try the call, classify `VendorRetryableError`, and throw `CascadeExhaustedError` on exhaustion. The only differences are the call shape (`mod.call` vs `mod.callStream`), an extra "no callStream" skip set, and the result type. A shared `dispatchInternal<R>(invoke, supportsCheck, kind)` helper would compress ~50 lines and keep the two surfaces aligned when classification rules evolve. Not consolidated this pass to keep the cooldown bug fix focused. Fixing unblocks: single-source-of-truth cascade ordering, less drift between streaming and JSON dispatch.
- **`llm_failover_log` row code is the *gateway-observed* upstream status, not the consumer's request outcome.** With the recent fix to surface real `attempts[]` codes from `CascadeExhaustedError`, the per-model "429 hits" panel in [/admin?tab=usage](frontend/src/app/admin/page.tsx) now reflects actual upstream rate-limits. But there's still no row that ties one *consumer request* to its full attempt list — each attempt becomes its own row with no correlation id. Adding a `request_id` column (UUID) and grouping by it on the dashboard would let SuperAdmin click "this consumer call" and see the full chain instead of inferring it. The AI Analyze button on the same admin page works around this by zero-ing out per-model `failureRate` whenever it detects a uniform-cascade-walk artifact (`runUsageAiAnalysis` in [admin/page.tsx](frontend/src/app/admin/page.tsx)) — that workaround forbids the AI from proposing catalog reorders or removals when the entire pool was walked uniformly, even though *some* of those models really are bad. Fixing unblocks: (a) cleaner SuperAdmin debugging when filing rate-limit reports with upstream vendors; (b) a real per-model failure rate for AI Analyze that survives uniform-cascade-exhaustion traffic patterns, enabling REORDER and REMOVE recommendations on data where they're currently forbidden.
- **Cooldown is filter-only — dispatcher will still attempt a cooled model if the chain composer's fallback path puts it in the chain.** Fixed (this pass) the most common case: when everything in the primary pool is cooled, [buildCandidateChain](api/src/application/llm/LlmProxyService.ts) no longer falls back to `[...seed]` (which re-fired the same 429-ing models). It now uses cross-vendor fallbacks only, and returns a clean 503 if those are also cooled. But the *dispatcher* itself ([dispatchVendor](api/src/application/llm/vendors/registry.ts)) doesn't double-check cooldown before each attempt — it trusts the chain. If a future caller bypasses `composeChain` and hands `dispatchVendor` an unfiltered chain, cooled models would be attempted. Defense-in-depth fix: make `dispatchVendor` consult the cooldown store and skip cooled entries with a `skippedCooled` accumulator. Fixing unblocks: stronger guarantee that no caller path can re-fire cooled models.
- **`applyCooldowns` is now awaited — adds 50–200ms latency on the failure path.** Necessary trade-off: prior fire-and-forget `void recordFailure(...)` was being aborted when the Worker request lifecycle ended, leaving cooldowns unwritten and producing the symptom that "the same model gets hammered repeatedly across requests." Awaited write parallelizes via `Promise.all`, so the additional latency is one parallel KV round-trip, not N. If this latency budget proves problematic, the alternative is `ctx.waitUntil(applyCooldowns(...))` plumbed through from the Hono route handler — that keeps the writes durable without blocking the response. Fixing unblocks: no failure-path latency cost for cooldown durability.
- **Streaming responses don't surface `failovers[]` to consumers.** Non-streaming success path now emits `_builderforce.failovers: FailoverEvent[]` and cascade-exhausted errors emit `error.details.failovers` ([LlmProxyService.ts](api/src/application/llm/LlmProxyService.ts), [llmRoutes.ts](api/src/presentation/routes/llmRoutes.ts) — both shipped this pass, typed in the SDK). The streaming path only emits `x-builderforce-retries` count via headers — no per-attempt breakdown, no vendor labels. Consumers using `client.chat.completions.create({ stream: true })` can't detect single-vendor concentration on streamed calls. Fixing (emit a final SSE `event: builderforce` chunk containing the failover breakdown before `[DONE]`, parse in the SDK's `ChatCompletionStream`) unblocks: parity between streaming and non-streaming diagnostics, and same vendor-concentration alarms in streaming code paths.
- **Unidentified `scoreWithLenientLLMOrFallback` / `LLM_UNAVAILABLE` error path.** Customers reported a `worker.js:171074` stack frame raising `{ code: "LLM_UNAVAILABLE", message: "Resume analysis is temporarily unavailable…" }`, but neither the function name, the error code, nor the message string exists anywhere in this repo (api, worker, frontend, sdk, dist, `.wrangler` bundles all grep clean). Likely sources: a sibling service that fronts resume scoring, a stale Cloudflare Worker deploy whose source has since been removed, or a renamed/tree-shaken bundle. The proxy-side fix in this pass (always-on `PAID_LAST_RESORT_MODEL`) closes the symptom *if* that worker calls through `LlmProxyService`, but if it has its own LLM client the customer-facing error will keep firing. Fixing (locate the worker — check `pages.cloudflare.com` deployments, sibling repos owned by the same workspace, or `wrangler deployments list` against the `builderforce-*` workers) unblocks: confirming the production error is actually addressed rather than just papered over here.
- **No per-tenant cap on the always-on premium fallback chain.** [LlmProxyService.PREMIUM_FALLBACK_MODELS](api/src/application/llm/LlmProxyService.ts) is appended to every non-strict candidate chain (Free plan included) — when the (now 2-attempt-capped) free section is exhausted, the proxy falls through to `googleai/gemini-2.5-flash` → `googleai/gemini-2.5-flash-lite` → OpenRouter `google/gemini-2.5-flash-lite` so callers never see a cascade-exhausted 429. The residual risk: a Free-plan tenant in a tight retry loop can drive arbitrary spend against the Builderforce `GOOGLE_API_KEY` / `OPENROUTER_API_KEY` because there's no per-tenant overflow cap or daily budget on the premium-fallback path, and the new 2-free-cap means the cascade reaches paid endpoints *faster* than the previous design. Fixing (track premium-fallback hits in `llm_usage_log` against a per-tenant `paid_overflow_daily_cap`, default ~$0.50/day, and surface the cap in the superadmin tenants page) unblocks: hard ceiling on overflow cost while preserving the "zero `LLM_UNAVAILABLE` escapes" guarantee.
- **`reorderPoolByShape` capability sets are OpenRouter-centric — non-OpenRouter capable models are excluded from the scoring.** [LlmProxyService.ts](api/src/application/llm/LlmProxyService.ts) defines `TOOL_CAPABLE_MODELS`, `STRUCTURED_OUTPUT_MODELS`, `VISION_MODELS`, `OCR_MODELS` with model IDs that today are all OpenRouter format. Now that FREE_MODEL_POOL contains Cerebras / NVIDIA / Ollama models, shape-driven reorder won't promote (for example) NVIDIA's `microsoft/phi-4-multimodal-instruct` for vision requests even though it's a vision model in the catalog. Fixing (drive the capability scoring from a per-catalog-entry `capabilities` field on `VendorModelEntry` instead of literal-id sets) unblocks: shape-aware routing across every vendor, not just OpenRouter.
- **Streaming dispatch does not detect empty-but-200 responses.** [dispatchVendor](api/src/application/llm/vendors/registry.ts) now treats `200 OK + empty content + no tool_calls` as a retryable failure (status 502, `embedded` cooldown class — fixed this pass for non-streaming). [dispatchVendorStream](api/src/application/llm/vendors/registry.ts) has no equivalent check: a stream that completes with zero content chunks is delivered to the consumer as a successful empty response. Detection is harder mid-stream than mid-JSON because by the time you know the stream produced nothing, the response headers have already shipped to the client. Two fix shapes: (a) buffer the entire stream before forwarding (defeats streaming latency benefit), or (b) deliver the empty stream as-is but record a post-stream cooldown so subsequent calls skip the model. Fixing (option b is the practical pick) unblocks: consistent cooldown coverage for empty-responding models regardless of streaming flag, which currently lets streaming consumers stay hung up on broken upstreams long after non-streaming traffic has cooled them off.
- **Backend `/api/projects/:id/chats*` chat endpoints are now frontend-orphaned (dual-route duplication over `ideProjectChats`).** The global Brain consolidation pass moved all frontend chat traffic onto the `brain` client (`/api/brain/chats*`, served by the DDD [BrainService](api/src/application/brain/BrainService.ts)). The parallel chat CRUD endpoints inlined in [projectRoutes.ts](api/src/presentation/routes/projectRoutes.ts) (`GET/POST /api/projects/:id/chats`, `GET/PATCH /api/projects/:id/chats/:chatId`) read/write the **same** `ideProjectChats`/`ideProjectChatMessages` tables but no longer have any caller (the frontend `listProjectChats`/`getProjectChat`/`createProjectChat`/`appendProjectChatMessages` helpers were deleted this pass). Fixing (delete the `projectRoutes` chat handlers + their tests; `BrainService` is canonical) unblocks: one chat-persistence surface, no drift between two hand-rolled query paths over one table. NOTE: `POST /api/ai/chat` ([ideAiRoutes.ts](api/src/presentation/routes/ideAiRoutes.ts)) is **still live** — `sendAIMessage` in [frontend/src/lib/api.ts](frontend/src/lib/api.ts) uses it for on-device/agent-runtime fallback (`model-provider.ts`, `agent-runtime.ts`); it is NOT part of this orphaning.
- **Brain tool-turn messages (`assistant.tool_calls` / `role:'tool'`) are not persisted.** The Brain's agent loop ([useBrainConversation.ts](frontend/src/lib/brain/useBrainConversation.ts)) keeps intermediate tool-call turns and tool results in-memory only — the `ideProjectChatMessages` table has no tool columns, so only the user message and final assistant text are saved. On reload, a conversation that drove several page actions shows the question and the answer but not which tools ran. Fixing (add `tool_calls` JSON + `tool_call_id` columns to `ideProjectChatMessages`, persist the full turn sequence, and render a compact "ran create_file …" affordance) unblocks: full replay/audit of agentic Brain sessions and post-hoc debugging of tool usage.
- **The Brain's `generate_prd` / `generate_tasks` tools auto-save without the review modal.** When the user clicks the **Generate PRD / Generate Tasks** message-action buttons ([ChatProjectActions.tsx](frontend/src/components/ChatProjectActions.tsx)) they get a preview modal before saving. When the Brain calls the equivalent `generate_prd` / `generate_tasks` tools registered by the IDE ([IDENew.tsx](frontend/src/components/IDENew.tsx)), it saves directly via the shared [projectArtifacts.ts](frontend/src/lib/brain/projectArtifacts.ts) `savePrd`/`saveTasks` — no human confirmation step. Acceptable for an agentic "do it for me" flow, but inconsistent with the button path. Fixing (route tool-driven artifact creation through a confirm affordance in the drawer, or add an undo) unblocks: consistent review-before-save UX across manual and AI-driven artifact generation.
- **On-device Mamba inference + per-chat memory toggle were dropped from the shared Brain.** The retired IDE `AIChat` component carried a memory-on/off toggle (lazy `MambaEngine`) and a cloud/hybrid/local inference switch (`MambaModelProvider`), both already gated to cloud-only ("·soon"). The unified Brain ([useBrainConversation.ts](frontend/src/lib/brain/useBrainConversation.ts)) ships cloud streaming only and does not surface those controls. The underlying libs (`mamba-engine.ts`, `model-provider.ts`) are untouched and still used elsewhere. Fixing (re-add the memory + inference-mode controls to `BrainPanel`, wired to the same engines, behind the existing gating) unblocks: on-device/hybrid Brain inference once the WGSL kernel + R2 weights land — see the Mamba gating note earlier in this register.
- **LLM vendor health probe has no retention policy.** [api/migrations/0050_llm_health_probes.sql](api/migrations/0050_llm_health_probes.sql) gets one row per (vendor × cron run) plus one row per manual button click. At 4 vendors × 1 daily cron + occasional manual probes, growth is bounded but unbounded — no `DELETE FROM llm_health_probes WHERE created_at < NOW() - INTERVAL '180 days'` cleanup job exists. The admin `GET /api/admin/llm-health` query uses `DISTINCT ON (vendor) ORDER BY vendor, created_at DESC` so latency is fine for many years, but the table will accumulate forever. Fixing (add a row-aging job to the same `scheduled()` handler that runs the probe) unblocks: bounded storage.
- **A runtime "Insufficient GPU memory" diffusion error string exists that is not in this repo.** A user-reported Studio error read `Insufficient GPU memory for sd-turbo: device reports ~2.0 GB available, model needs at least ~4.0 GB. Try a lighter model (e.g. sd-turbo) or close other GPU-heavy tabs.` — but grep across `studio/`, `frontend/`, `worker/`, `api/` finds no `Insufficient GPU memory` literal and no `e.g. sd-turbo` substring; the only memory-shortage message is [checkMemoryForModel](studio/src/engine/diffusion-engine.ts) which now says "Insufficient memory" (no "GPU") and — as of this pass — can no longer name the failing model or a heavier one. So the pasted message originates from a stale deployed Studio bundle, a sibling/forked build, or a UI-layer string not in source control. The source-side self-defeating-hint bug it illustrated is fixed + regression-tested here, but the *runtime* surface that emitted it is unconfirmed. Fixing (locate the deployed Studio build — `wrangler deployments list` / Pages deployment for the studio app — and confirm it ships the corrected `lighterModelHint`, or find the out-of-repo string source) unblocks: certainty the user-facing recommendation is actually corrected in production rather than only in this repo.
- **Two cron patterns coexist now.** [/api/approvals/escalate](api/src/presentation/routes/approvalRoutes.ts) is HTTP-triggered with a `CRON_SECRET` query param (requires an external scheduler to hit the URL), while [vendor health probe](api/src/index.ts) uses the native Cloudflare `scheduled()` handler + `[triggers] crons` block in [api/wrangler.toml](api/wrangler.toml). The native handler is the right pattern on Workers — it has no public surface to abuse and doesn't depend on an external scheduler. Fixing (migrate `escalate` into `scheduled()` alongside the vendor probe, drop the `CRON_SECRET` route) unblocks: single cron pattern, one less public endpoint.
- **Manual `POST /api/admin/llm-health/:vendor` has no rate limit and probes the full catalog.** Each click triggers N chat completions (where N = vendor catalog size — for OpenRouter free this is double-digits). Only superadmins can hit the route, but a determined click can burn meaningful free-tier quota. The cron-side runner is rate-limited by the cron schedule (once daily); the manual side is not. Fixing (per-vendor in-memory cooldown — at most one probe per vendor per minute regardless of how many superadmins click) unblocks: quota safety even if the button is misused.
- **`llm_health_probes.models_json` is `text` in Drizzle but `JSONB` in the migration — same drift pattern as `platform_modules.permissions`.** [api/src/infrastructure/database/schema.ts](api/src/infrastructure/database/schema.ts) declares `modelsJson: text(...)` to dodge the Drizzle JSONB-mapping inconsistency; the migration creates `JSONB`. Handled in code by `coerceProbeModels` (mirroring the existing `coercePermissions`). Fixing (settle on one or the other across the schema) unblocks: removal of both coerce helpers.
- **Legal tab has no version history view.** The admin Legal tab ([frontend/src/app/admin/page.tsx](frontend/src/app/admin/page.tsx)) offers Edit (in-place amend via `PATCH /api/admin/legal/:docType`) and New-version (via `POST /api/admin/legal/:docType/publish`) through a slide-out ([LegalEditorDrawer](frontend/src/components/admin/LegalEditorDrawer.tsx)) for both terms and privacy, with live Markdown preview. But there is still no `GET /legal/history` endpoint or UI: superseded versions (rows where `isActive=false` in `legalDocuments`) are only inspectable via raw DB. Fixing (a history list keyed by `documentType` with per-version view/restore) unblocks: auditing and rolling back prior legal versions from the portal.
- **`TenantTokenLimitOverrideEditor` and `TenantPremiumOverrideEditor` share radio-mode + save-button + error-row scaffold.** [frontend/src/components/admin/](frontend/src/components/admin/) — two files with ~80% identical layout. Not extracted in this pass because their *mode shapes* differ (3-mode tri-state vs 2-mode boolean) and a shared `<TenantOverrideEditor>` primitive that supports both gracefully would need a per-mode renderer prop, which is more complex than the duplication today. Fixing (shared scaffold accepting `modes: Array<{ key; label; value }>` + a render-as-needed input slot for the custom-int mode) unblocks: adding a third override editor (e.g. seat-cap, vendor-pinning) without copy-paste.
- **Schema-drift allowlist contains 106 pre-existing drift items.** [api/scripts/.schema-drift-allowlist.txt](api/scripts/.schema-drift-allowlist.txt) grandfathers 106 columns/tables that exist in [schema.ts](api/src/infrastructure/database/schema.ts) without a tracked migration — they were likely created via `drizzle-kit push` rather than a versioned migration. The CI guard now catches *new* drift (#4 fixed); reducing the allowlist to zero is a separate cleanup that needs each pre-existing table backfilled with a CREATE-TABLE migration, then removed from the allowlist line-by-line. Fixing unblocks: reproducible-from-zero database setup.
- **Pro plan's free-tier section is now also capped at 2 attempts.** [LlmProxyService.FREE_ATTEMPT_BUDGET](api/src/application/llm/LlmProxyService.ts) (= 2) is applied universally in `buildCandidateChain`, so Pro tenants' cascade is `[2 free, ...PRO_PAID_MODEL_POOL, ...PREMIUM_FALLBACK_MODELS]` instead of the previous "walk all free + all paid + cross-vendor" chain. Net effect is positive (Pro tenants reach their paid premium models faster) but the design is uniform with Free plan — there is no Pro-specific carve-out that, say, lets Pro tenants try 5 free models before paying. If Pro customers report missing free-tier breadth, the fix is to take `FREE_ATTEMPT_BUDGET` from a plan-aware lookup instead of a single constant. Fixing unblocks: plan-tier-differentiated cascade depth.
- **Google AI catalog model ids are unverified against the Generative Language API.** [api/src/application/llm/vendors/googleai.ts](api/src/application/llm/vendors/googleai.ts) registers `gemini-2.5-flash`, `gemini-2.5-flash-lite`, and `gemini-2.5-pro` against `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`. Same drift risk as the NVIDIA NIM entry: wrong ids will surface as 404s and the cascade will skip them, but they pollute the pool until corrected. Fixing (curl `https://generativelanguage.googleapis.com/v1beta/openai/models` with the `GOOGLE_API_KEY`, reconcile against the catalog) unblocks: clean premium fallback ordering with no wasted 404 attempts.
- **`PREMIUM_FALLBACK_MODELS` is not visible in the admin model-pool dashboard.** [LlmProxyService.PREMIUM_FALLBACK_MODELS](api/src/application/llm/LlmProxyService.ts) is appended to every chain but the entries aren't included in `FREE_MODEL_POOL` / `PRO_PAID_MODEL_POOL`, so [adminRoutes.ts poolStatus](api/src/presentation/routes/adminRoutes.ts) doesn't show their cooldown state. Superadmins debugging "why did the premium fallback fail" have to grep code. Fixing (surface PREMIUM_FALLBACK_MODELS as a third pool row in the admin status payload with cooldown + key-bound annotations) unblocks: end-to-end visibility into the cascade tail.
- **Image-gen cascade has no persistent cooldown — every retry re-fires a recently-failed model.** [ImageProxyService.buildCandidateChain](api/src/application/llm/ImageProxyService.ts) only filters by `vendorKeyBound`; it does not consult [cooldownStore](api/src/infrastructure/auth/cooldownStore.ts) the way chat does ([LlmProxyService.complete](api/src/application/llm/LlmProxyService.ts) pre-fetches both per-model and per-vendor cooldowns). When Together rate-limits, the next image request will still try the same Together model first and waste 1–2s before falling through. Fixing (extend cooldownStore to namespace `image:<vendor>/<model>` keys, plumb the same `loadCooldowns` / `recordFailure` calls into ImageProxyService) unblocks: same recovery behaviour for image gen as for chat, no wasted RTT against rate-limited vendors.
- **Image gen shares the chat per-tenant daily token budget at a flat 1000-tok/image rate.** [llmRoutes.ts POST /v1/images/generations](api/src/presentation/routes/llmRoutes.ts) charges `images_returned * 1000` against `llm_usage_log.total_tokens`, so heavy image usage can exhaust the chat-text budget and vice versa. Two-budget separation (chat tokens vs image credits) would let tenants buy/cap each independently. Fixing (add `image_credits_daily_limit` column to `tenants`, log image rows with a new `llm_product` value and check them against the new cap instead of the token cap) unblocks: independent image-only quotas and pricing.
- **FluxAPI async-poll variant is not implemented.** [fluxapi.ts](api/src/application/llm/imageVendors/fluxapi.ts) extracts the image URL from the sync response shape (`data.url` / `data.imageUrl` / `data.result.url`). When FluxAPI returns a `taskId` instead (long-running prompts), the vendor throws `embedded: code=<n>: no image url` and the cascade falls through prematurely instead of polling. Fixing (detect the `data.taskId` shape, poll `GET /api/v1/flux/kontext/task/<id>` with backoff until the image is ready or the per-vendor timeout fires) unblocks: long-running Flux Kontext prompts that would otherwise always fail over to a cheaper model.
- **No vendor-prefix support in `FREE_IMAGE_MODEL_POOL` / `PAID_IMAGE_MODEL_POOL`.** [ImageProxyService](api/src/application/llm/ImageProxyService.ts) builds its pools from `imageModelsByTier()`, which returns bare ids. Image dispatcher resolves bare ids via catalog lookup, which works today only because there's no model-id collision between vendors. If a future vendor registers the same id (`flux-schnell` on both Together and another paid vendor), catalog lookup picks one arbitrarily. Fixing (store `<vendor>/<modelId>` in the pool definitions and let the dispatcher use the prefix when present) unblocks: safe registry growth without id-clash surprises.

### Segment tier (tenant → segment → entity isolation for multi-tenant integrators)

Tenancy is two-tier today (tenant → entity); customers who are themselves multi-tenant (e.g. BurnRateOS as one tenant, serving their own end-clients) have no way to isolate their end-clients. Target model: a **segment** = (account, company) of the integrator's client, sitting between tenant and entity. **Segmentation is opt-in per tenant (not all customers are multi-tenant), but when a tenant is segmented, isolation is a HARD, non-bypassable rule** — a forgotten filter is a breach, not a bug. The following gaps were identified in the 2026-05-31 evaluation pass and are unbuilt:

- **Segment tier foundation + write-isolation + provisioning — LANDED ([0054](api/migrations/0054_segment_tier.sql), [0056](api/migrations/0056_segment_id_propagation.sql), [segmentResolver](api/src/infrastructure/auth/segmentResolver.ts), [segmentRoutes](api/src/presentation/routes/segmentRoutes.ts)).** Shipped + applied + verified: the `segments` table + tenant `kind`/`idp_issuer`/`isolation_mode`/`settings` columns + one default segment per tenant (0054); `segment_id` (NOT NULL in DB, optional in TS) on 34 business tables + `tasks` via project, backfilled to each tenant's default (0056); a DB-level default-fill trigger that auto-stamps the default segment for `single` tenants and RAISEs for `segmented` tenants (the no-bleed hard rule enforced at the DB — verified: single fills, segmented rejects); `resolveSegment()` chokepoint (default for single, lazy-create from account/company claims for segmented, cached) wired into [authMiddleware](api/src/presentation/middleware/authMiddleware.ts) setting `c.get('segmentId')`; and `GET/POST/PATCH /api/segments` provisioning. Unit + full suite green (108 tests). **Still open** — see the four bullets below.
- **Segmented-mode write-threading cutover is NOT done — flipping a tenant to `isolation_mode='segmented'` today would break its writes.** The default-fill trigger RAISEs when a `segmented` tenant's insert omits `segment_id`, but no existing route threads `c.get('segmentId')` into its inserts yet (they rely on the single-mode auto-fill). So provisioning works and the resolver runs, but a tenant cannot actually be switched to segmented until every business write passes `segmentId` explicitly. Fixing (thread `c.get('segmentId')` into the ~35 insert sites — repos take it as a param, routes read it from context — then add an owner-only `PATCH /api/tenants/:id` to flip `isolation_mode`) unblocks: onboarding a real multi-tenant integrator (BurnRateOS) end-to-end.
- **The no-bleed invariants have no repeatable DB-backed test — only the resolver + provisioning logic are unit-tested.** Covered by unit tests: [resolveSegment](api/src/infrastructure/auth/segmentResolver.test.ts) (tenant-scoped default/federated/cache) and [segmentRoutes](api/src/presentation/routes/segmentRoutes.test.ts) (tenant-stamped provisioning, no `isolation_mode` escalation, default/cross-tenant PATCH guard). NOT covered: the 0056 default-fill **trigger** (single auto-fills default; segmented RAISEs) and the cross-segment isolation guarantee (doc 05 §7: "Segment A token cannot read Segment B") — both need a live DB, and the `api` vitest suite runs without one (114 tests, ~2.5s, all mocked). They were verified once by hand at migration time but nothing locks them. Fixing (a DB-backed integration test — ephemeral Postgres or a gated Neon test branch — that inserts for a single tenant and asserts the fill, flips a throwaway tenant to `segmented` and asserts the insert is rejected, and once RLS lands asserts a Segment-A context cannot SELECT Segment-B rows) unblocks: regression-proofing the core hard rule instead of relying on a one-time manual check.
- **Read isolation still relies on app-level `eq(tenantId)` — segment reads are not yet enforced (RLS pending).** 0056's trigger covers the WRITE path (no row lands in the wrong segment); the READ path still filters by `tenant_id` in each repo and does not yet filter by `segment_id`, and there is no RLS backstop. Fixing: **Postgres RLS on Neon as the enforced floor** (session sets `tenant_id` + `segment_id` GUCs; policies refuse cross-segment rows even if a query forgets the filter), app still passes both IDs for defense in depth. Note the Neon HTTP driver is stateless per-query, so RLS needs `SET LOCAL` inside an explicit transaction (or the pooled `Client`) — a driver-level change. Unblocks: cross-segment reads impossible by construction (doc 05 §2.2), the hard rule on the read side.
- **No `segment_members` / per-segment roles + no `seg` token claim.** `tenant_members(tenantId, userId, role)` grants a tenant-wide role; a user who should only touch one end-client cannot be scoped, and the JWT carries no segment claim (the resolver derives it from `acct`/`co` claims that token issuance does not yet set). Fixing (add `segment_members`; have tenant-token issuance stamp `acct`/`co` for segmented users; add a `seg` claim) unblocks: per-end-client access control within an integrator's tenant.
- **Twelve business tables are absent from the database (legacy `drizzle-kit push` debt) so 0056 skipped them.** `activity_events`, `approval_rules`, `contributor_daily_metrics`, `contributor_identities`, `contributors`, `dev_teams`, `integration_credentials`, `integration_sync_logs`, `report_schedules`, `report_subscriptions`, `team_memory`, `telemetry_spans` are declared in [schema.ts](api/src/infrastructure/database/schema.ts) and grandfathered in [.schema-drift-allowlist.txt](api/scripts/.schema-drift-allowlist.txt) but have no `CREATE TABLE` migration and do not exist in this DB; 0056's `to_regclass` guard skipped them, so their `segment_id` (+ trigger) is unapplied where they don't exist and their features are already non-functional in this environment. Fixing (backfill tracked `CREATE TABLE` migrations for the 12 — mirroring the existing "reduce the 106→0 allowlist" gap — which then picks up `segment_id` via a re-run of 0056's guarded blocks) unblocks: those Phase-6/approval features actually working, and segment isolation covering them.
- **The migration runner is not transactional per file — a mid-file failure leaves a partial apply.** [scripts/migrate.mjs](api/scripts/migrate.mjs) executes statements one-by-one and only records the migration in `_migrations` after all succeed; a failure midway (e.g. 0056's first attempt hit a missing table after 15 tables were already altered) leaves the DB half-migrated with the file un-recorded. 0056 was made idempotent + guarded so re-running converges, but not every migration is written that way. Fixing (wrap each migration file's statements in a single `BEGIN/COMMIT` so a failure rolls the whole file back) unblocks: no half-applied schema states, safe to author non-idempotent migrations.
- **The root (frontend/studio/brain) test suite has 28 failing tests — pre-existing, unrelated to the API.** Running `npx vitest run` from the repo root (vs `api/`) reports 28 failures across [frontend/src/lib/api.test.ts](frontend/src/lib/api.test.ts) + [auth.test.ts](frontend/src/lib/auth.test.ts) (`window is not defined` — jsdom environment not set for those files), and `studio-embedded` / `brain-embedded` `*.test.tsx` (`RolldownError: Parse failure` on TSX). The `api/` suite is fully green (108/108); these failing files were not touched by the segment work (likely surfaced by the mid-session "Brain and Segments" commit `91878e3`). Fixing (set `environment: 'jsdom'` for the frontend tests and a JSX/TSX transform for the embedded-package vitest configs) unblocks: a green root `npm test`, so CI catches real regressions instead of being red by default.
- **Gateway keys, usage metering, and rate limiting are tenant-only — no segment dimension.** `tenantApiKeys` and claw keys map to a tenant; `llm_usage_log` and `TenantRateLimiterDO` meter/limit per tenant. An integrator calling the gateway/SDK can't say which end-client a call is for. Fixing (add `segment_id` to keys + usage log + a segment header on `/v1/*`, namespace the rate-limiter DO by `tenant:segment`) unblocks: per-segment metering, quotas, and chargeback for integrators reselling the platform.
- **Tenant-wide aggregation surfaces silently merge all segments.** `teamMemory` (tenant-wide cross-claw mesh), chat/project memory consolidation, contributor/dev-analytics rollups, and the executive/standup reports all aggregate across the whole tenant — blending end-clients in one view. Fixing (segment-scope these reads + the memory mesh, not just add a column) unblocks: aggregates and AI memory that don't cross-contaminate end-clients.
- **Uniqueness namespaces are tenant-scoped, not segment-scoped.** `projects.key` UNIQUE (and similar) would collide or leak across segments. Fixing (make the composite keys include `segment_id`) unblocks: collision-free per-end-client namespaces. Recommended build order: `segments` + membership → `segment_id` columns + backfill → enforce both dimensions in one shared place → thread `seg` through token + key authz → segment-scope aggregation last.

#### Embed rail — re-embedding BuilderForce into BurnRateOS ([builderforce-embedded](builderforce-embedded/), [frontend/src/app/embed](frontend/src/app/embed/))

The host-side embed component + the frame-side transport LANDED this pass (built, type-checked, 11 tests green): `@seanhogg/builderforce-embedded` exports the single DRY `<BuilderForceEmbed view=… token=… />` (sandboxed iframe, secure postMessage JWT handoff — token never in the URL, auto-resize, deep-link sync); the BuilderForce frontend serves the iframe half at `/embed/[view]` ([useEmbedFrame](frontend/src/lib/embed/useEmbedFrame.ts) imports the protocol from the package so the two ends can't drift); and `middleware.ts` sets `frame-ancestors` for `/embed/*`. BurnRateOS can start swapping its `/product/*`,`/agile/*`,`/governance/*` pages to `<BuilderForceEmbed>` now. **Still open:**
- **First embedded widgets are LIVE end-to-end; the rest of the resurface-able set is unwired.** Shipped this pass (build + 118 api / 13 pkg tests green, frontend tsc clean): the SuperAdmin enablement flow ([embedRoutes](api/src/presentation/routes/embedRoutes.ts) `GET/PUT /api/embed/config` → `tenants.settings.embed`, [EmbedIntegrationSettings](frontend/src/components/settings/EmbedIntegrationSettings.tsx) self-gating toggle on `/settings`); the token bridge ([auth.ts `setEmbedAuth`](frontend/src/lib/auth.ts) — embed-mode token + embed-aware 401, one auth path); registry reconciled to the authoritative BurnRateOS→BuilderForce extraction inventory (`available` flag + `capabilityForView` in [views.ts](builderforce-embedded/src/views.ts) — 28 functional views across Product/Agile/Governance-posture); and the frame self-gates on the host's enabled capabilities then RESURFACES existing components. **Four widgets now wired** (frontend tsc clean): `backlog`/`kanban` → [TaskMgmtContent](frontend/src/components/TaskMgmtContent.tsx), `ideas` → [BrainPanel](frontend/src/components/brain/BrainPanel.tsx) (`variant="page"`), `prd` → [EmbedPrdSurface](frontend/src/components/embed/EmbedPrdSurface.tsx) (PRDsContent behind a project picker). **Still open:** the other 26 views are scaffolds — NOT-built features needing new schema + the `/v1` API (mvp, validation, roadmap, release-planning, changelog, feature-flags, feature-roi, business-value, poker, retros, sprints, velocity, capacity, cost, feature-scoring, soc2…vuln-scans/dsr/suppression). NOTE on governance scope (decided): BuilderForce provides the full security TOOLSET except identity — the ONLY exclusions are RBAC + centralized authentication (sessions `security`, approval workflows `approvals`, MFA/account-security, identity/login audit), which stay in BurnRateOS. The 11 governance views include the 7 posture trackers + access-reviews + vuln-scans + DSR + suppression. Fixing (build each feature's schema + `/v1` route + surface component, wire into `renderSurface`) unblocks: the remaining widgets.
- **The 4 wired embed surfaces (TaskMgmtContent, BrainPanel, PRDsContent, all in-frame) have not been runtime-validated.** They type-check and their providers are present in the layout, but the app can't be run headless here to confirm they render + call the API correctly inside the iframe (BrainPanel especially is provider-heavy). Fixing (run the app + a host harness that posts a token to `/embed/<view>`, or the `verify` skill) unblocks: confidence the resurfaced widgets actually work, not just compile.
- **Governance/Security pillar COMPLETE for the ported toolset — 9 surfaces live end-to-end.** Shipped + verified (api 130 tests, drift 75 tables, all tsc 0): schema [0057](api/migrations/0057_governance_compliance.sql) + [0058](api/migrations/0058_governance_trackers.sql) (SOC2 controls/evidence, vendors, incidents, PII inventory, DPAs, trainings, compliance events, DSR, suppression — all `(tenant_id, segment_id)`-scoped with the 0056 trigger); the **fully Segment-THREADED** [governanceRoutes](api/src/presentation/routes/governanceRoutes.ts) (`/api/governance/soc2/*` bespoke + a DRY `createTrackerRoutes` factory mounted for the 8 trackers — every read+write scoped by `(tenantId, segmentId)` from context, 12 tests); frontend [Soc2Content](frontend/src/components/governance/Soc2Content.tsx) + ONE generic [TrackerSurface](frontend/src/components/governance/TrackerSurface.tsx) driven by [trackerConfigs](frontend/src/components/governance/trackerConfigs.ts), all wired (`available:true`). **13 embed views now live** (Product: ideas/prd/backlog; Agile: kanban; Security: soc2 + 8 trackers). **Still open in Security:** (a) DevSecOps surfaces `access-reviews` + `vuln-scans` (doc 07 SEC-8/9) — deferred, they need Repo connection + scan/agent integration, not simple CRUD; (b) `security_audit_log` writes on every governance mutation (doc 07 §3/§4); (c) SOC 2 evidence-attach UI + JSON export (API exists). Also: the wired surfaces type-check but are NOT runtime-validated in-frame (same caveat as all 13).
- **ALL 30 embed views are LIVE.** Verified (api 143 tests across 16 files, drift 96 tables, package + frontend + api all tsc 0). Shape: a shared [segmentTrackerRoutes](api/src/presentation/routes/segmentTrackerRoutes.ts) factory (DRY) powers 23 flat CRUD surfaces across governance/product/agile ([governanceRoutes](api/src/presentation/routes/governanceRoutes.ts) 11 + [productRoutes](api/src/presentation/routes/productRoutes.ts) 8 + [agileRoutes](api/src/presentation/routes/agileRoutes.ts) 5), all segment-threaded; bespoke surfaces for SOC 2 ([Soc2Content](frontend/src/components/governance/Soc2Content.tsx)), planning poker + retros ([pokerRetroRoutes](api/src/presentation/routes/pokerRetroRoutes.ts) + [PokerSurface](frontend/src/components/agile/PokerSurface.tsx)/[RetroSurface](frontend/src/components/agile/RetroSurface.tsx)); and 4 resurfaced existing components (tasks/Brain/PRDs). Migrations 0054–0062. One generic [TrackerSurface](frontend/src/components/governance/TrackerSurface.tsx) + [trackerConfigs](frontend/src/components/governance/trackerConfigs.ts) drives every tracker. **Poker/retros are now real-time over WebSocket** — [SessionRoomDO](api/src/infrastructure/relay/SessionRoomDO.ts) (bound in [wrangler.toml](api/wrangler.toml) as `SESSION_ROOM`, migration tag v2) fans out a `changed` push after each mutation; clients hold a socket via the `/ws` routes and re-fetch on push (shared [useRealtimeRoom](frontend/src/lib/embed/useRealtimeRoom.ts) hook; `setInterval` polling removed). The REST routes stay the segment-scoped source of truth, so no domain data flows through the DO. **Remaining caveats (logged, not blockers):** (a) `vuln-scans` + `access-reviews` records are CRUD — the AUTOMATED scanning (run scanners on agent PRs) + repo-access auto-population (doc 07 §5 DevSecOps agents) are not built; (b) the trackers are standalone CRUD, NOT yet linked to the **`work_items` unified spine** (locked decision) — no backlog→kanban→sprint→score item graph yet; (c) AI enrichment (roadmap sequencing, validation insights, doc 02) is manual CRUD; (d) NONE of the 30 surfaces are runtime-validated in-frame (no headless app run here). Fixing (a)–(c) unblocks: automated DevSecOps, cross-feature item linkage, and the AI value-adds.
- **The poker/retro WebSocket relay is push-invalidate-then-refetch, and the `SessionRoomDO` migration needs a deploy.** [SessionRoomDO](api/src/infrastructure/relay/SessionRoomDO.ts) broadcasts a contentless `{type:'changed'}` frame (clients re-fetch the segment-scoped detail) rather than pushing the state delta directly — correct + leak-proof, but one extra fetch per change. It doesn't track presence ("who's online / who has voted") or use the WebSocket Hibernation API (the DO stays in memory while clients are connected — fine at poker/retro volume). The new DO class needs the Cloudflare migration applied on deploy (`wrangler deploy` picks up the `[[migrations]] tag = "v2"` block). Fixing (push state deltas + presence + hibernatable sockets) unblocks: zero-refetch live updates, live participant lists, lower idle DO cost.
- **The Product/Agile trackers are standalone CRUD, not yet linked to the `work_items` spine or to each other.** E.g. a `sprint` row and `feature-scoring` row don't reference shared work items; `mvp`/`roadmap`/`release` aren't linked. This is functional (each surface offers its feature) but flat. Fixing (build the `work_items` spine, then add FK/linkage columns + cross-surface references per doc 01 §9) unblocks: backlog→kanban→sprint flow, RICE on real items, roadmap↔release linkage. Also: the 26 wired surfaces are type-checked but NOT runtime-validated in-frame (no headless app run here).
- **Doc 07 governance scope confirmed (supersedes the extraction inventory's narrower "posture-only" read), but the per-Segment DSR coexistence still needs implementing.** Decision (user, 2026-05-31): BuilderForce provides every security tool except RBAC + centralized auth — so per-Segment DSR + suppression + Access Reviews + Vulnerability Scans ARE in scope (matching [doc 07](specs/builderforce/07-prd-security-compliance-phase2.md), not the extraction inventory which listed `DsrPage`/`SuppressionListPage` as "stays"). The embed registry now reflects this (11 governance views). **Still open per doc 07 §1 ⚠️:** BuilderForce's per-Segment DSR governs only the Segment's data and must be added ALONGSIDE BurnRateOS keeping its platform-global shared-contact-graph DSR — implement deliberately so neither erasure path has a compliance gap. None of this is built (needs the doc-07 Phase-2 schema + `/v1/governance/*` API).
- **The frontend's `@seanhogg/builderforce-embedded` must be a real junction, not a copy — and the embed package must be pre-built.** On this Windows/MSYS host `ln -s` COPIED the package dir into `frontend/node_modules/@seanhogg/builderforce-embedded`, so a package rebuild didn't propagate and the frontend type-checked against stale types until the copy was replaced with a `mklink /J` junction. A clean checkout / CI must (a) run the workspace install so the `link:` dep becomes a proper junction, and (b) `cd builderforce-embedded && npm run build` before `next build`, since the frontend imports the built `dist`. Fixing (a root install+build step that links + builds the embedded packages, mirroring studio/brain) unblocks: reproducible builds where embed-package changes are actually seen by the frontend.
- **Embed theme is received but not applied to resurfaced components.** [useEmbedFrame](frontend/src/lib/embed/useEmbedFrame.ts) captures the host's `theme` and the embed page sets a `data-theme` wrapper, but the app's `ThemeProvider` / `var(--*)` tokens aren't driven by it, so a resurfaced `TaskMgmtContent` renders in the default (light) palette regardless of the host theme. Fixing (drive the app theme class from the embed `theme` in the frame, so resurfaced components honor the host's light/dark) unblocks: visually consistent embeds.
- **No automated test that the embed page resurfaces the real component when enabled.** The gating/bridge logic is covered at the unit layer (`embedRoutes.test.ts`, `segmentResolver`, package `messageHandler`), but there's no test asserting `/embed/kanban` renders `TaskMgmtContent` when the capability is enabled and the scaffold/denied state otherwise — the frontend test suite runs in the root vitest project which has the pre-existing jsdom/parse failures. Fixing (a component test for the embed page with a mocked `embedApi.getConfig`) unblocks: regression-proofing the resurface + self-gating path.
- **`NEXT_PUBLIC_EMBED_ALLOWED_HOST_ORIGINS` must be set in prod, and the frame's postMessage trust currently defaults OPEN when it is unset.** The single allowlist drives both the `/embed/*` `frame-ancestors` CSP (middleware) and the client-side auth-origin check ([useEmbedFrame](frontend/src/lib/embed/useEmbedFrame.ts)). Unset → CSP is `frame-ancestors 'self'` (no host can frame it, safe) BUT the frame accepts an `auth` postMessage from ANY origin (dev convenience). Since the CSP blocks foreign framing when unset, this is not exploitable in prod-with-CSP, but it's a foot-gun. Fixing (set the env to the BurnRateOS origins in every environment, AND make the frame default-closed — reject auth when the allowlist is empty — so the two layers fail the same way) unblocks: safe-by-default embedding.
- **The fresh `builderforce-embedded` link dep needs `install` to materialize in other environments.** [frontend/package.json](frontend/package.json) now has `"@seanhogg/builderforce-embedded": "link:../builderforce-embedded"`; the local `node_modules/@seanhogg` symlink + the package `dist` were created this pass, but a clean checkout / CI must run the workspace install (and the package must be built — `cd builderforce-embedded && npm run build`) before `next build` resolves the import. Fixing (add the package to the root install/build pipeline + CI) unblocks: reproducible frontend builds that include the embed rail.
- **The Phase-2 Governance domain (doc 07) is not in the schema.** `SocControl`/`SocEvidence`/`SecurityVendor`/`SecurityIncident`/`PiiDataAsset`/`SecurityDpa`/`SecurityTraining`/`ComplianceEvent`/`DataSubjectRequest`/`DataSuppressionList`/`AccessReview`/`VulnerabilityScan`/`VulnerabilityFinding`/`SecurityAuditLog` (all `(tenantId, segmentId)`-scoped) and the `dev.security_review`/`gov.*` use cases are specced ([07-prd](specs/builderforce/07-prd-security-compliance-phase2.md)) but unbuilt — the `governance` embed views (`soc2`, `vendors`, …) are registered + scaffolded but have no backing tables/API. Phase 2, after the PM/Agile port. Fixing unblocks: the CISO surfaces. NOTE the doc-07 ⚠️: per-Segment DSR/suppression in BuilderForce must be added ALONGSIDE BurnRateOS keeping its own platform-global shared-contact-graph DSR — implement deliberately to avoid a compliance gap.

#### Spec alignment — BurnRateOS PM/Agile extraction ([specs/builderforce/](specs/builderforce/))

The `specs/builderforce/` PRD set (docs 00–06) designs extracting BurnRateOS's Product-Management + Agile-Survival domains into BuilderForce as the system of record, re-embedded back via SSO + the embed rail. The tenancy design in the spec (Tenant→Segment→Entity, `resolveSegment` chokepoint, `(tenantId, segmentId)` on every entity) MATCHES the segment-tier plan above and is sound. But the spec is written greenfield (Prisma/uuid, BuilderForce-owns-nothing-identity) and collides with the platform that already exists. Reviewed 2026-05-31; the following alignment gaps are unbuilt:

- **Identity model is contradictory — spec assumes BuilderForce federates an external OIDC IdP; the platform IS its own IdP.** Doc 01 §2 / doc 05 §2 say BuilderForce owns no users/teams/companies and trusts BurnRateOS as the OIDC issuer (`Tenant.idpIssuer`, verify inbound signed JWT, hydrate `IdentityCache`). Reality: BuilderForce has a `users` table, PBKDF2 + OAuth + magic-link auth, local `tenant_members`, and issues its own JWTs ([AuthService](api/src/application/auth/AuthService.ts)) — it does OAuth *outbound* as a client and has NO inbound-OIDC-trust path (grep: no `idpIssuer`/`createRemoteJWKSet`/`verifyIdToken`/`resolveSegment` anywhere). Fixing (add an inbound-OIDC verifier keyed by a new `tenants.idp_issuer` + `tenants.kind EMBEDDED|DIRECT` column, build `resolveSegment(jwt)` to accept BOTH the federated-claim shape and the platform's own tenant-token, add `IdentityCache` for `EMBEDDED` tenants) unblocks: BurnRateOS-as-IdP without breaking the existing local-auth (`DIRECT`) tenants and users.
- **ID-type collision: spec uses `uuid String` PKs + a fresh `Tenant` model; platform `tenants.id`/`projects.id`/`tenant_members` are integer `serial`.** ([schema.ts](api/src/infrastructure/database/schema.ts)). Two `tenants` tables can't coexist. Fixing (fold the spec's `Tenant` fields — `kind`, `idpIssuer`, `slug`, `settings` — into the existing `tenants` table as added columns; add `segments(tenant_id integer FK)`; new PM/Agile tables carry `tenant_id integer` + `segment_id uuid` and may be uuid internally) unblocks: the spec's domain model landing on the real tenant root instead of a parallel one.
- **Spec's agentic layer (`Repo`, `AgentRun`, `AgentRunStep`, `AgentOrchestration`, `CodeReviewFinding`, `dev.*` use cases) duplicates the existing CoderClaw stack.** BuilderForce already has `coderclawInstances` (mesh), `tasks`, `executions`, `workflows`/`workflowTasks`, `agents`, `approvals`/`approvalRules`, the Workforce Registry, and **`sourceControlIntegrations`** (which doc 01 §7 `Repo` overlaps directly). Building doc 04 verbatim forks a second orchestration stack (DRY violation). Fixing (map `AgentRun`→`executions`, `AgentOrchestration`→`workflows`, `Repo`→`sourceControlIntegrations`, `CodeReviewFinding`→existing review-agent output; extend these with `segment_id` rather than create parallel tables) unblocks: one agent runtime, no drift between two execution models.
- **Spec's PM spine (`WorkItem`, `ProductIdea`, `Sprint`) overlaps the existing `projects`/`tasks`/`specs` model.** BuilderForce already has `projects` (modality designer|video|llm), `tasks` (backlog/todo/in_progress/done), and `specs` (PRD/arch/taskList). Doc 01 §4 `WorkItem` is a second backlog. Fixing (decide coexist-vs-unify: either `WorkItem` becomes the unified spine that existing `tasks`/`specs` map onto, or the two systems are explicitly partitioned by domain) unblocks: a single task/backlog surface instead of two competing ones. NEEDS A PRODUCT DECISION before either path is built.
- **Spec assumes a per-Segment credit ledger + `viewer` projection + `AI_USE_CASES`/`callAiAndCharge` facade that does not exist in BuilderForce.** Doc 01 §8 / doc 05 §6 lean on BurnRateOS's AI facade; the BuilderForce gateway meters per *tenant* via `llm_usage_log` + plan token limits with no `AI_USE_CASES` registry, no `viewer`, no segment dimension (grep: no `AI_USE_CASES`/`callAiAndCharge`). Extends the per-segment-metering gap above. Fixing (port the use-case registry + per-segment credit ledger + viewer-projection into BuilderForce, or map them onto the existing gateway primitives with a `segment_id` added to usage) unblocks: the `dev.*` + `pm.*`/`agile.*` use cases billing per end-client as the spec requires.
- **Embed + S2S surface assumed by the spec is not present; align to the existing `studio-embedded` pattern.** Doc 05 §5 reuses BurnRateOS's embed rail (`routes/embed.ts`, `SystemFeature`) — that rail is host-side; on the BuilderForce side the spec's `<BuilderForceEmbed view=...>` should follow the existing [studio-embedded](studio-embedded/src/components/StudioPanel.tsx) pattern (authToken prop, host-owned mount) not a third mechanism. Separately the spec needs scoped/rotatable S2S tokens (`ingest:feedback`, `read:bi.burn`) and subscribable outbound HMAC webhooks (`workitem.released`, `sprint.completed`, `roadmap.published`); BuilderForce has `tenantApiKeys` (unscoped) + claw HMAC dispatch but neither a token-scope model nor a tenant webhook system. Fixing (one parameterized `<BuilderForceEmbed>` over the studio-embedded mount; add a `scopes` column to `tenantApiKeys`; add a `tenant_webhooks` + outbound-delivery table) unblocks: the doc-05 cross-domain contract on real infrastructure.
- **`applyCooldowns` issues 2N parallel KV writes per failed cascade — still amplifies subrequest cost.** Closed this pass: the pre-flight cooldown *read* path is now bounded by [COOLDOWN_PREFETCH_LIMIT](api/src/application/llm/LlmProxyService.ts) (= 12 entries, down from ~50). The remaining amplifier is the write path: every dispatched attempt that fails goes through [recordFailure](api/src/infrastructure/auth/cooldownStore.ts), which issues a per-model `put` *and* either a vendor-ring `put` or a vendor-cooldown `put` — so 5 failed attempts = 10 KV `put`s on the trailing edge of a doomed cascade. The `WorkerSubrequestExhaustedError` short-circuit added this pass skips cooldown writes entirely, but ordinary cascade-exhausted paths still pay the 10-write tax. Fixing (collapse the per-model + vendor-failure-ring + vendor-cooldown state into a single composite-key blob, written once per cascade) unblocks: deterministic O(1) KV subrequest cost regardless of cascade depth, headroom for raising `FREE_ATTEMPT_BUDGET` above 2 without re-hitting the cap.
- **Vendor schema-dialect compatibility is a static deny-list, not metadata-driven.** [jsonSchemaSanitize.ts](api/src/application/llm/jsonSchemaSanitize.ts) hard-codes the keywords Cerebras rejects (`maxLength`/`minLength`/`format`/`pattern`/`minimum`/etc.) and applies them to both `cerebras` and `openrouter` (since OpenRouter routes most `:free` ids to Cerebras as upstream). If a future vendor lands with a different strict-mode deny-list (e.g. Anthropic's `tool_choice` rejecting `additionalProperties: false`, or a Groq-routed model rejecting `oneOf`), the fix requires editing the helper rather than reading a per-vendor `schemaDialect` field on `VendorModelEntry`. Fixing (move the keyword list onto each `VendorModule` so the strip set is composed at call time from the resolved upstream) unblocks: vendor catalogue growth without touching the sanitizer.
- **`VendorFatalError` (400) collapses the cascade instead of advancing to the next vendor.** [dispatchVendor](api/src/application/llm/vendors/registry.ts) re-throws non-retryable errors verbatim, then [LlmProxyService.dispatchJson](api/src/application/llm/LlmProxyService.ts) catches them and wraps the 400 as a `rate_limit_error 429` envelope via [exhaustedResponse](api/src/application/llm/LlmProxyService.ts). Two problems: (a) the caller sees a misleading 429 when the real issue is a schema bug the gateway just fixed (closed this pass for the Cerebras case, but the wrapping persists for any future 400-emitting vendor), and (b) when one upstream rejects a payload but another would accept it, the cascade never advances. Fixing (treat 400 as `request_error` per the existing gap register entry, advance the cascade on `request_error` so other vendors can try, but stop the cascade *and* surface a real 400 envelope once every candidate has fatal-400'd) unblocks: useful diagnostics for caller-side schema bugs AND graceful cross-vendor recovery when only one upstream is strict.
- **Image-gen has no health probe alongside chat vendors.** [vendorHealthCron.ts](api/src/application/llm/vendorHealthCron.ts) iterates `getAllVendorIds()` (chat-only) for the daily probe. Image vendors (Together, FluxAPI) are never probed, so a quiet outage on Together would show up only when a customer triggers an image gen and it 502s. Fixing (extend the probe registry to include image vendors with a tiny "1x1 image, throw away result" call or a `/v1/models` HEAD request) unblocks: superadmin email alerts when an image-gen upstream goes down.
- **No CI-level e2e covers the studio's actual in-browser ONNX execution — nine invariants are unit-tested, the rest needs a real GPU browser.** Nine layers locked by unit tests in [studio/src/engine/](studio/src/engine/): (1) ORT WASM/JS version match; (2) per-model UNet input names; (3) per-input dtypes (LCM `timestep`=float32, SD-Turbo=int64); (4) `reportProgress` fans out (silent-hang UX); (5) `buildOrtSessionOptions` pins `graphOptimizationLevel: 'basic'`; (6) `checkMemoryForModel` reports when probed memory < minimum (inert for WebGPU — `null` is honest); (7) `explainOrtError` translates std::bad_alloc, graph-fusion AND `DXGI_ERROR_DEVICE_HUNG` / `Device is lost` (Windows TDR) into actionable diagnostics; (8) `lighterModelHint` never suggests the failing model, and only suggests models that fit available memory; (9) `runSession` wrapper routes every `session.run` through the same translator (catches device-loss at runtime, not just at session create). Plus init-time `assertSessionMatchesSpec` + a `device.lost`-promise listener that emits a clear progress message when the GPU device is reset. Still needing a real WebGPU browser: (a) UNet output name (we pick first Float32); (b) `timestep_cond` embedding values match LCM training; (c) CLIP-L pad-id holds for SD-Turbo; (d) actual VRAM fit; (e) progress timeline end-to-end. Need a Playwright job on a GPU runner.
- **WebGPU doesn't expose actual VRAM — `approxMemoryMb` is `null` for the WebGPU device path, so the pre-flight memory check is effectively inert there.** [studio/src/engine/device-router.ts](studio/src/engine/device-router.ts) previously derived "memory" from `adapter.limits.maxBufferSize`, which is a SPEC LIMIT (2 GB default) — not memory. That falsely blocked 16GB GPUs as "insufficient." Honest fix in this pass: return `null`. The post-hoc `explainSessionCreateError` still translates a real `std::bad_alloc` into an actionable message, so the OOM case is still well-handled — just at the failure point, not predictively. A real predictive check would need a tiny calibration probe (allocate progressively larger GPUBuffers until one fails) at engine init — non-trivial and out of scope for this pass. Fixing (add the calibration probe behind a `prepFlight` option) unblocks: honest pre-download "you don't have enough" rather than a 5-minute download → OOM cycle.
- **Real-time collaboration WS is opt-in via `NEXT_PUBLIC_COLLAB_WS_URL` — no default, no spam, but also no collab in stacks without the worker.** [frontend/src/hooks/useCollaboration.ts](frontend/src/hooks/useCollaboration.ts) used to fall back to `${NEXT_PUBLIC_WORKER_URL}/api/collab` → `localhost:8787` (the api worker, no collab route) → infinite reconnect loop spamming the console. Hook now returns inert refs when the env var isn't set and logs once. Cost: developers who *do* want collab in dev must (a) deploy the `worker/` package's `CollaborationRoom` Durable Object, and (b) set `NEXT_PUBLIC_COLLAB_WS_URL=ws://localhost:PORT/api/collab`. Fixing (document the env var in [README.md Quick Start](README.md), add to `docker-compose.yml`, or wire a sensible default once the collab worker ships in dev compose) unblocks: collab works out of the box.
- **`studio/src/engine/mamba-coherence.ts` `advanceState()` is a CPU Float32 placeholder, not the WGSL selective-scan kernel from `mambacode.js`.** [studio/src/engine/mamba-coherence.ts](studio/src/engine/mamba-coherence.ts) — runs a simple `h_{t+1} = decay * h_t + B * pooled_input` recurrence in JS. The mambacode.js peerDep is declared but not yet called. Fixing (replace the inner loop body with a `mambacode.js` selective-scan call, keep the same input pooling + output shape so the projection layer doesn't change) unblocks: real SSM dynamics for temporal coherence, GPU-accelerated state evolution, parity with the existing `frontend/src/lib/mamba-engine.ts` runtime.
- **No `/api/studio/weights/*` route on the api worker yet — `r2-proxy` source will 404.** [studio/src/engine/weight-cache.ts](studio/src/engine/weight-cache.ts) fetches from `https://api.builderforce.ai/api/studio/weights/<cacheKey>` as its preferred source. The route doesn't exist in [api/src/presentation/routes/](api/src/presentation/routes/) — every weight load will fall through to the HuggingFace CDN fallback until the route lands. Functionally OK for v0 since HF is the secondary source, but adds 300-800ms cold-start latency per model file and exposes our usage pattern to HF rate limits. Fixing (add a new `studioWeightRoutes.ts` that streams from R2 with `Cache-Control: public, max-age=31536000, immutable`, gated by the `studio` platform_module entitlement) unblocks: deterministic cold-start latency, HF rate-limit isolation, ability to ship custom-fine-tuned model variants without re-uploading to HF.
- **Project modality entitlement gate is partial — the `comingSoon` flag gates the LLM modality, but the Pro+ paid gate for Video can't be enforced client-side because the frontend `Tenant` type carries no plan/tier field.** [frontend/src/components/IDENew.tsx](frontend/src/components/IDENew.tsx) disables `comingSoon` modalities in the switcher (config-driven from [frontend/src/lib/modality.ts](frontend/src/lib/modality.ts)), so the mechanism exists. But [frontend/src/lib/types.ts](frontend/src/lib/types.ts) `Tenant` exposes only `{ id, name, slug, role }` — no plan — so the agreed Pro+ gate on the heavy Video modality has no data source to read. Fixing (surface the tenant plan/tier on the `Tenant` object via the auth/tenant token claim or a `/api/tenants/:id` fetch, add a `requiresPaidPlan` flag to the Video `ModalityDef`, and gate the switcher on it) unblocks: revenue protection on the 6GB-VRAM modality.
- **Studio `/api/studio/weights/*` route is mounted but no weights have been uploaded to R2 yet — every weight fetch will 404 and fall through to the HF CDN.** [api/src/presentation/routes/studioWeightRoutes.ts](api/src/presentation/routes/studioWeightRoutes.ts) streams from R2 key `studio-weights/<model>/<file>`. No upload script exists. The package falls back to HuggingFace CDN automatically (configured in [studio/src/engine/weight-cache.ts](studio/src/engine/weight-cache.ts)), so functionality is unaffected for v0 — but every cold load hits HF. Fixing (write `scripts/upload-studio-weights.ts` that wraps `wrangler r2 object put` for the canonical model files, document the operator workflow in studio/README.md) unblocks: deterministic latency, HF rate-limit isolation, ability to ship our own fine-tunes.
- **Two studio packages need (re)publishing + npm auth setup: engine `@seanhogg/builderforce-studio@0.2.0` (breaking — React layer removed) and the brand-new `@seanhogg/builderforce-studio-embedded@0.1.0`.** The engine was split: `0.1.x` carried `StudioPanel`; `0.2.0` is engine-only and the React layer moved to the new `-embedded` package. Both are built locally but unpublished — the publishing environment's `~/.npmrc` token is dead (a `404 PUT` on publish), so they need either a fresh `NPM_TOKEN` repo secret or OIDC trusted publishers. Operator steps: (1) Publish `@seanhogg/builderforce-studio@0.2.0` (`cd studio && npm publish --access public` from a logged-in machine, or set `NPM_TOKEN` and push to main — the `publish-studio` workflow handles it). (2) Publish `@seanhogg/builderforce-studio-embedded@0.1.0` likewise; the `publish-studio-embedded` CI job (`needs: publish-studio`) is wired in [release.yml](.github/workflows/release.yml). (3) For zero-secret CI thereafter, add trusted publishers at `https://www.npmjs.com/package/<name>/access` for each. Until (1)+(2), external `npm install @seanhogg/builderforce-studio` still resolves the old `0.1.x` (with the now-removed React exports) — the in-app IDE is unaffected since it consumes both via local `link:`.
- **`docker compose up` requires `NEON_DATABASE_URL` in `api/.dev.vars` — the stack cannot bundle Postgres because the api uses `@neondatabase/serverless` HTTP transport.** [api/src/infrastructure/database/connection.ts](api/src/infrastructure/database/connection.ts) calls `neon(url)` which speaks Neon's HTTP `/sql` endpoint, not raw PG protocol. A bundled `postgres:16` service won't accept Neon HTTP queries; bridging requires a community proxy like `ghcr.io/timowilhelm/local-neon-http-proxy` plus a runtime `neonConfig` override to point the driver at it. Out of scope for v0 docker (free Neon signup is 30 seconds and gives the same shape as production). Fixing (add the proxy service + `neonConfig.fetchEndpoint` override gated on a `LOCAL_NEON=1` env var) unblocks: truly zero-prereq `docker compose up`, contributor onboarding without a Neon account.
- **`mp4-muxer` is the only path to MP4 — Safari without WebCodecs MP4 encode hits `throw` in `webcodecs-muxer.ts`.** [studio/src/engine/webcodecs-muxer.ts](studio/src/engine/webcodecs-muxer.ts) hard-throws when `VideoEncoder` is undefined and uses `avc1.42E01F` which Safari has historically been picky about. The README claims "WebGPU 113+" so Chrome-first is intentional, but graceful degradation to WebM (VP9) would let Firefox users at least preview output. Fixing (detect codec support via `VideoEncoder.isConfigSupported`, fall through to `vp09.00.10.08` + `webm-muxer` when avc fails) unblocks: Firefox preview for users who can't run Chrome.
- **README references `@seanhogg/ssmjs` as an installed dependency in two places, but it is not in `frontend/package.json`.** [README.md "AI Training Studio" bullet at line 35](README.md) claims `uses @seanhogg/ssmjs / Transformers.js with WebGPU` and the [On-Device AI Stack diagram at line 359-377](README.md) shows `SSM.js (@seanhogg/ssmjs)` as a layer over `mambacode.js`. [frontend/package.json](frontend/package.json) only ships `mambacode.js: github:SeanHogg/Mamba` and `@huggingface/transformers ^3.8.1` — the actual integration is `MambaModelProvider` in [frontend/src/lib/model-provider.ts](frontend/src/lib/model-provider.ts) and the in-tree [mamba-engine.ts](frontend/src/lib/mamba-engine.ts). The `ssmjs` and `mambakit` references are aspirational. Fixing (either publish `@seanhogg/ssmjs` and `add` it, or rewrite both README sections to reflect that `MambaModelProvider` + `mamba-engine.ts` is the actual orchestration layer) unblocks: documentation matches shipped code, prevents new contributors chasing imports that don't exist.

- **Brain "Create file" depends on the LLM emitting a clean path as the code-fence language tag — datasets often arrive as plain ```json with no filename.** [ChatMessageContent.tsx](frontend/src/components/ChatMessageContent.tsx) only shows the "Create file" button when the fence tag passes `isFilePathLike` (e.g. ```dataset.jsonl) and writes that tag verbatim as the file path. When the Brain returns ```json (no name) no button appears, so the user can't capture the dataset; when it emits an odd tag the path can be malformed. The `llm` `brainSystemPrompt` in [modality.ts](frontend/src/lib/modality.ts) doesn't instruct the model to fence datasets with a `*.jsonl` path tag. Fixing (tighten the `llm` system prompt to always wrap generated datasets in a ```datasets/<name>.jsonl fence, and/or add a "Save as dataset" affordance for un-tagged ```json blocks in the LLM modality) unblocks: reliable one-click dataset capture from the Brain. Mitigated this pass — the blank-name tree bug is fixed ([utils.ts](frontend/src/lib/utils.ts) drops empty path segments, [FileExplorer.tsx](frontend/src/components/FileExplorer.tsx) falls back to the basename), the created file now shows in LLM step 1 and opens in a shared code view ([CodePane.tsx](frontend/src/components/CodePane.tsx)) — but the capture step itself is still LLM-formatting-dependent.
- **Dataset files captured into the project file store are not registered with the dataset/training API.** [LlmStudioPanel.tsx](frontend/src/components/LlmStudioPanel.tsx) now surfaces `.json`/`.jsonl` project files in step 1 and lets the user open them, but a Brain-written file is a raw file — it has no `Dataset` row (`example_count`, `status`, `r2_key`), so the Train tab's dataset dropdown ([AITrainingPanel.tsx](frontend/src/components/AITrainingPanel.tsx), fed by `listDatasets`) still won't list it. Fixing (an "Import as dataset" action that POSTs the file content to the dataset API, or teaching the training flow to accept a raw project-file path) unblocks: training directly on Brain-authored datasets without re-generating them through the dataset endpoint.
- **No test renders the IDE to confirm the `llm` modality shows `LlmStudioPanel` (only the unit invariant is locked).** [frontend/src/lib/modality.test.ts](frontend/src/lib/modality.test.ts) locks that the `llm` modality stays enabled (not `comingSoon`), but nothing renders [IDENew.tsx](frontend/src/components/IDENew.tsx) to assert that selecting `llm` mounts [LlmStudioPanel.tsx](frontend/src/components/LlmStudioPanel.tsx) rather than the Designer preview/code view (and `video` → `StudioPanel`). IDENew pulls in WebContainer/collab hooks that make a jsdom render heavy. Fixing (a React Testing Library test that mounts IDENew with those hooks mocked and asserts the center panel per modality) unblocks: regression coverage for the center-panel modality switch, not just the registry flag.

- **Img2img recursion drifts/blurs after ~30 frames; no zoom and no AnimateDiff-style trained motion module are shipped yet.** [studio/src/engine/video-engine.ts](studio/src/engine/video-engine.ts) now supports two video-continuity paths: (1) shared-anchor + per-frame noise blend (`motionAmount`, default 0.15 — locks colors + composition but no scene progression), and (2) img2img recursion (`imgToImgStrength`, opt-in — frame N+1 starts from frame N's clean latent re-noised partway through the schedule, optionally translated via `cameraMotion: {dx, dy}` to simulate camera pan). Path (2) closes the user-reported "each picture is a unique interpretation of the prompt" bug AND delivers actual scene progression for clips < 30 frames. Remaining gaps: (a) recursion drift — small VAE-encode-then-denoise errors accumulate, so frames 30+ get progressively blurrier / lose detail; an "anchor refresh every K frames" knob would bound it; (b) no zoom — only translation is implemented in [`shiftLatent`](studio/src/engine/mamba-coherence.ts), so "walking forward into the scene" (radial scale) needs a separate `cameraZoom` parameter + bilinear resampling; (c) no real motion module — AnimateDiff would give true temporal awareness but needs a trained motion-LoRA and a custom ONNX export (no browser-runnable export exists today). Fixing (a) is the cheapest follow-up (small refactor in `VideoEngine.generate` to call `sampleInitialLatent` every K frames), (b) is one helper + one slider, (c) is a multi-week research/export task. Unblocks: clips longer than 30 frames without quality decay, "dolly in" camera moves, and ultimately scene-grammar-aware video.
- **`latent-residual` Mamba bias is now auto-skipped under img2img recursion — no noise-level-scaled bias formula exists to let them coexist.** [studio/src/engine/mamba-coherence.ts `shouldApplyLatentResidualBias`](studio/src/engine/mamba-coherence.ts) gates the bias and returns `false` whenever `useImg2Img` is on (the bug it fixes: `applyToLatent` adds a per-channel broadcast constant designed for unit-variance noise, which catastrophically disfigures partially-denoised img2img latents and compounds frame-to-frame). The conservative fix means a user picking `latent-residual` + `imgToImgStrength > 0` gets the same temporal coherence behaviour as `prompt-bias` + img2img (i.e. zero latent-side Mamba bias). A proper fix would scale the bias by the schedule noise level — at timestep `t` the latent is `sqrt(α)·clean + sqrt(1-α)·noise`, so scaling the broadcast bias by `sqrt(1-α)` would perturb only the noise portion and leave the signal intact, letting both mechanisms compose. Fixing (one parameter on `applyToLatent`, one call site, one test) unblocks: stacking trained-state coherence on top of img2img for the longer-clip "scene-aware walking" use case.
- **Studio video binaries are IndexedDB-only — cross-device sync of generated MP4s is not wired.** [frontend/src/hooks/useVideoVersions.ts](frontend/src/hooks/useVideoVersions.ts) persists each generated MP4 to IndexedDB under `${projectId}:videos/v<n>.mp4` and the metadata sidecar JSON to the project file API (`videos/v<n>.json`). The sidecar syncs cross-device via the existing worker, but the blob does not — so opening the same project on a second device shows the version in the file tree and the panel's version list, but `onLoadVersion(id)` throws "MP4 blob not in IndexedDB on this device." Fixing (mirror each `onSaveVersion` to an R2 upload through a new `/api/studio/videos/<projectId>/<version>` route + lazy fetch in `onLoadVersion` when IDB misses) unblocks: cross-device version playback, sharing a project's videos with collaborators, recovery after browser storage clear.
- **Studio MODEL_REGISTRY only carries three entries (lcm-tiny-sd, sd-turbo, lcm-dreamshaper-v7) — the [quality-tier two-pass chain](studio-embedded/src/components/QualityTierPicker.tsx) now gives "high quality" without picker bloat, so the remaining need is *style diversity* (anime, realistic, illustration), not more general-purpose models.** [studio/src/engine/diffusion-engine.ts MODEL_REGISTRY](studio/src/engine/diffusion-engine.ts) is the only gate; any browser-runnable ONNX SD/LCM export plugs in as a registry entry. Candidates worth verifying (each needs an in-browser smoke test — input-name match, dtype match, VRAM fit, output shape — since a wrong declaration surfaces as opaque OrtRun errors only at first denoise): `Lykon/DreamShaper-V8-LCM` (if a clean ONNX export lands — realistic style), `SG161222/Realistic_Vision_V5.1_noVAE` (community ONNX exports exist — photorealistic), `Linaqruf/animagine-xl-lcm` (anime — SDXL family, see SSD-1B caveat below), `OFA-Sys/small-stable-diffusion-v0` (~0.5 GB, even lighter than lcm-tiny-sd), `segmind/SSD-1B` (~4.5 GB SDXL distill — requires registry refactor for SDXL's dual-text-encoder + 2048 cross-attention dim). Fixing (one PR per model: smoke-test in browser, add the registry entry, optionally extend QUALITY_TIERS to surface as a style preset) unblocks: anime / photorealistic / illustration style choices without exposing model-id implementation detail.
- **Quality-tier "Refined" is hardcoded to lcm-tiny-sd → lcm-dreamshaper-v7 — no way to pick a different refinement pair.** [studio-embedded/src/components/QualityTierPicker.tsx QUALITY_TIERS](studio-embedded/src/components/QualityTierPicker.tsx) declares the chain as a static literal. A power user wanting "draft with sd-turbo (composition) → refine with lcm-dreamshaper (LCM detail)" has to drop to Advanced and manually pick a single model (loses the two-pass). Fixing (extend the tier shape to accept user-overridable `(primary, refinement)` via a small "Custom chain" form when Advanced is on) unblocks: arbitrary draft/refine pairings as new SD-family entries land.
- **Advanced model picker silently overrides the Quality tier.** When the user opens Advanced and picks a specific model, the engine uses *that* model and skips the refinement pass even if Quality is set to "Refined" ([StudioPanel.tsx](studio-embedded/src/components/StudioPanel.tsx) — the `showAdvanced ? model : tier.primary` ternary). The current Quality picker doesn't visually indicate it was overridden, so a user with Advanced open + Refined selected sees both controls active and the tier description (lying about "two-pass chain") while only single-pass runs. Fixing (either grey out the Quality picker when Advanced model is set, or grey out the Advanced model picker when Quality !== "fast/balanced/refined", with a single resolved-state badge showing the effective model chain) unblocks: no silent contradiction between the two control surfaces.
- **ControlNet conditioning (depth / canny / pose) is not wired — the single biggest "edit on top of a generated video" unlock.** Today the only structural-preservation mechanism is img2img recursion, which carries v1's latent forward but can't independently constrain "keep the composition, swap the character." ControlNet adds a second ONNX session (the ControlNet branch) whose per-block outputs feed into the UNet via two new feeds (`down_block_additional_residuals` and `mid_block_additional_residual`). To land: (1) extend [`ModelDescriptor`](studio/src/types.ts) with optional `controlnetFiles: { depth?: OnnxFile; canny?: OnnxFile }`; (2) add a depth extractor session (`onnx-community/depth-anything-v2-small` or MiDaS-small, ~30 MB) called once on the prior frame to produce the conditioning input; (3) extend `UNET_INPUT_BUILDERS` with the two residual feeds (gated on a new "controlnet" mode); (4) add a "ControlNet: depth / canny / off" radio in the panel. Reference exports: `lllyasviel/sd-controlnet-depth` and `sd-controlnet-canny` have ONNX-community ports. Per-extra-net VRAM is ~700 MB–1.5 GB. Fixing unblocks: "same forest path but in winter", "same character pose with a different background", and the entire user-facing "edit the video" flow that today depends on prompt-rewording.
- **Inpainting UNet is not wired — "add a dog to this scene" or "remove this object" has no implementation today.** Inpainting needs a *different* UNet checkpoint (9-channel input: 4 latent + 4 masked-latent + 1 mask, vs the standard 4-channel input) and a region mask. To land: (1) add an `inpainting` boolean (or a new modality) to `ModelDescriptor` so MODEL_REGISTRY can carry inpainting-specific entries (`runwayml/stable-diffusion-inpainting` has an ONNX-community export); (2) add the 9-channel input shape to `UNET_INPUT_BUILDERS` and route it via a new builder when `inpainting: true`; (3) ship a mask painter UI (canvas overlay on the preview) — or, much better, integrate **SAM-tiny** (`Xenova/slimsam-77-uniform`, ~40 MB) so the user clicks an object and gets a perfect mask. Without inpainting, the only path to "change a region" is regenerating the whole frame, which loses everything outside the intended region. Fixing unblocks: targeted edits within a generated video, the natural pair to ControlNet for the full "generate → review → tweak this part" loop.
- **ORT-web 1.26 only exposes `inputNames` on `InferenceSession` — per-input dtype metadata is unavailable for an init-time check.** [studio/src/engine/diffusion-engine.ts `assertSessionMatchesSpec`](studio/src/engine/diffusion-engine.ts) compares registry-declared `unetInputs` names against `session.inputNames`, but ORT's `ValueMetadata` interface in [onnxruntime-common/dist/esm/inference-session.d.ts](frontend/node_modules/onnxruntime-common/dist/esm/inference-session.d.ts) is an empty stub (line 361) and the runtime exposes nothing equivalent to `_OrtGetInputOutputMetadata` on the public surface. Consequence: a registry/model **dtype** drift (e.g. declaring `timestep: int64` for an LCM export that actually wants float32) can't be caught at init — it surfaces only at the first `denoise()` call as opaque `OrtRun() ERROR_CODE 2: "Unexpected input data type. Actual: (tensor(int64)), expected: (tensor(float))"`. The id-prefix-based LCM-family test in [diffusion-engine.test.ts](studio/src/engine/diffusion-engine.test.ts) locks the *registry* against per-family drift, but cannot catch cases where the actual export disagrees with our declaration. Fixing (track upstream `onnxruntime-web` for `inputMetadata`/`getMetadata()` accessor — there's an [open issue](https://github.com/microsoft/onnxruntime/issues) for this; once it lands, extend `assertSessionMatchesSpec` to compare both names AND dtypes) unblocks: registry/model drift caught at session init (in milliseconds) instead of first denoise (after a full 1.7 GB download).
- **Two-pass "Refined" still shows a rainbow chroma band in the lower frame region — root cause not fully confirmed.** This pass FIXED the highest-confidence contributor: the LCM `timestep_cond` guidance embedding was feeding `defaultGuidance - 1 = 0` (the runtime CFG mix scale) instead of the distillation scale, so `lcm-dreamshaper-v7` ran under-conditioned ([diffusion-engine.ts `lcmGuidanceCondEmbedding` + `lcmGuidanceScale: 8.5`](studio/src/engine/diffusion-engine.ts), locked by a non-degenerate-embedding test). Two lower-confidence suspects remain and need a real WebGPU browser to confirm/deny against a captured frame: (1) **conditioning mismatch** — draft keyframes are denoised with Mamba prompt-bias applied (last CLIP token replaced), but [`refinementPass`](studio/src/engine/video-engine.ts) re-embeds the prompt CLEAN and denoises the draft latent with it, so the refinement's conditioning disagrees with the latent it's refining; (2) **draft artifact preservation** — `lcm-tiny-sd` (BK-SDM Tiny) is low fidelity and its bottom rows may already be off; at `refinementStrength` 0.4 the refinement only rewrites ~40 % of the schedule and preserves the draft's bad region instead of redrawing it. Fixing (capture draft-vs-refined frame pairs on a GPU runner after the embedding fix ships; if the band persists, try applying the same prompt-bias in the refinement embed AND/OR raising `refinementStrength` toward 0.6 for the tiny→dreamshaper pair) unblocks: a Refined tier whose second pass is unambiguously cleaner than the draft.
- **Debug snapshot doesn't capture the effective model chain — it logs the stale Advanced `model`, hiding which tier actually ran.** [DebugCopyButton](studio-embedded/src/components/DebugCopyButton.tsx) receives `model={model}` (the Advanced picker state, default `lcm-tiny-sd`) from [StudioPanel](studio-embedded/src/components/StudioPanel.tsx), not the resolved `(tier.primary, tier.refinement)` pair, nor `quality`, nor `interpolationFactor`. A two-pass "Refined" capture therefore reads `Model: lcm-tiny-sd` with no sign a refinement model ran — which made the two-pass distortion above harder to triage. Fixing (pass `quality`, the resolved `model`/`refinementModel`, and `interpolationFactor` through to the snapshot and render them under Configuration) unblocks: a debug paste that unambiguously states the model chain + temporal density that produced the frames.
- **Anchor-walk gives smooth flicker-free drift but not true per-object motion (legs galloping, content flowing).** This pass replaced the i.i.d.-per-frame noise with a great-circle latent walk ([mamba-coherence.ts `anchorWalkLatent`](studio/src/engine/mamba-coherence.ts)) so consecutive frames are adjacent — the sequence reads as continuous evolution instead of jitter, and raising the frame count now genuinely smooths it. What it still can't do: animate a subject through poses (a horse's stride, a person walking) — the anchor locks composition, so the walk is a gentle global morph, not articulated motion. The two existing levers for real progression are img2img recursion (`imgToImgStrength` > 0, advanced-only today) and the logged-but-unbuilt optical-flow (RIFE/FILM) interpolation backend. Fixing (default a modest `imgToImgStrength` for a "smooth motion" simple-mode preset, and/or land the optical-flow tween backend) unblocks: subject-level animation rather than scene-level drift.
- **Landing-page prompt → Brain handoff routes into the internal tool/action registry only — no real MCP (Model Context Protocol) backend.** The home-page prompt input ([frontend/src/app/page.tsx](frontend/src/app/page.tsx)) saves the visitor's prompt and the global Brain replays it after auth ([pendingPrompt.ts](frontend/src/lib/brain/pendingPrompt.ts) + [FloatingBrain.tsx](frontend/src/components/brain/FloatingBrain.tsx) → [BrainPanel.tsx](frontend/src/components/brain/BrainPanel.tsx) `initialPrompt`). "MCP-ing" the request currently means the Brain acts via its existing in-app action registry ([BrainActionsContext.tsx](frontend/src/lib/brain/BrainActionsContext.tsx)) — there is no MCP client/connector that calls external MCP servers (Gmail, Drive, Calendar, etc.). Fixing (a real MCP connector layer: server registry, OAuth, tool discovery, and a bridge from `BrainActionsContext` tool specs to MCP `tools/call`) unblocks: the Brain acting on external systems over the actual protocol, not just registered page actions.
- **Pending-prompt capture is `localStorage`-only — single browser, not cross-device.** [savePendingPrompt/takePendingPrompt](frontend/src/lib/brain/pendingPrompt.ts) stash the landing prompt in `localStorage`, so a visitor who types on their phone then signs up on their laptop loses the prompt. Per the product decision (2026-05-31) this pass deliberately skipped a server-side anonymous record. Fixing (a public `POST /api/pending-prompts` keyed by an anonymous session id + a `pending_prompts` table with TTL/expiry, associated to the user on first authenticated request) unblocks: cross-device prompt continuity and analytics on abandoned prompts.
- **Prompt replay only fires on the docked Brain path, not on `/brainstorm`.** [FloatingBrain.tsx](frontend/src/components/brain/FloatingBrain.tsx) consumes the pending prompt and returns null on `/brainstorm` (where the full-page Brain renders instead), so a user who lands directly on `/brainstorm` after auth won't get an auto-send. The common post-register landing is `/dashboard` (docked Brain present), so the mainline flow is covered. Fixing (have the `/brainstorm` page — [frontend/src/app/brainstorm/page.tsx](frontend/src/app/brainstorm/page.tsx) — also call `takePendingPrompt()` and pass `initialPrompt` to its `BrainPanel variant="page"`, and add the same one-shot auto-send to the page path) unblocks: prompt replay regardless of which authenticated route the user lands on.

### Agentic QA (added 2026-05-31)

The Agentic QA pipeline (capture → aggregate → AI-generate → run authenticated Playwright → report) landed this pass across [api/migrations/0063_agentic_qa.sql](api/migrations/0063_agentic_qa.sql), [api/src/presentation/routes/qaRoutes.ts](api/src/presentation/routes/qaRoutes.ts), [api/src/application/qa/](api/src/application/qa/), the frontend capture client ([frontend/src/lib/qa/telemetry.ts](frontend/src/lib/qa/telemetry.ts)) + Observability ▸ Agentic QA tab ([frontend/src/components/QaContent.tsx](frontend/src/components/QaContent.tsx)), the [qa-e2e/](qa-e2e/) harness, and [.github/workflows/qa.yml](.github/workflows/qa.yml). Deferred items:

- **`0063_agentic_qa.sql` is authored but not applied to any live DB.** Drift check passes and types compile, but `npm run db:migrate` was not run (headless env, no DB connection). Until applied, every `/api/qa/*` route 500s with "relation does not exist." Fixing (run `npm run db:migrate` against each environment's Neon DB) unblocks: the QA endpoints actually working in prod. Mirrors the existing `0055_tenant_mcp_extensions` entry.
- **The whole QA pipeline was verified by typecheck + schema-drift only — never run end-to-end.** No live DB, no deployed app, and no Playwright browser in this env, so capture → aggregate → generate → run → report has not been exercised once. The generator's LLM-output parsing, the storageState auth injection (localStorage + cookie key names `bf_web_token`/`bf_tenant_token` were taken from a code read, not a live login), and the Playwright JSON→`/api/qa/runs` mapping in [qa-e2e/src/report.ts](qa-e2e/src/report.ts) are all unproven against real shapes. Fixing (seed a QA tenant, run `qa-e2e` against a preview deploy, confirm a green run lands in Observability ▸ Agentic QA) unblocks: confidence the pipeline works, not just compiles.
- **Generated specs are executed verbatim from the DB in CI — no sandboxing or validation of LLM output.** [qa-e2e/src/pull-tests.ts](qa-e2e/src/pull-tests.ts) writes `qa_tests.spec` straight to disk and `playwright test` runs it. A poisoned/hallucinated spec (or a compromised QA-tenant token) could run arbitrary code in the CI runner. The generator prompt forbids network assertions and the runner has only the QA session, but there's no AST allowlist or static check that the spec only drives the browser. Fixing (lint generated specs against an allowlist of `page.*`/`expect` calls before writing, or run them in a network-restricted container) unblocks: safe execution of model-authored tests.
- **QA run screenshots live only as GitHub artifacts — not stored in R2 or shown in the UI.** `qa_runs.screenshot_keys` + `qa_run_steps.screenshot_key` columns exist and the API accepts them, but the harness never uploads failure screenshots/traces anywhere durable; [qa.yml](.github/workflows/qa.yml) only `upload-artifact`s the `playwright-report`. The Observability QA tab therefore shows pass/fail + error text but no visual. Fixing (have [report.ts](qa-e2e/src/report.ts) PUT screenshots to the `UPLOADS` R2 bucket via a new `POST /api/qa/runs/:id/artifacts` endpoint and store the keys, then render them in [QaContent.tsx](frontend/src/components/QaContent.tsx)) unblocks: visual failure triage in-app.
- **`qa_journey_events` has no retention/pruning job — table grows unbounded.** Every authenticated click/route-change/input from every captured session inserts a row ([qaRoutes.ts](api/src/presentation/routes/qaRoutes.ts) `POST /events`) with no TTL or cleanup cron. At real traffic this dominates DB storage. Fixing (a `scheduled()` cron in [api/src/index.ts](api/src/index.ts) that `DELETE FROM qa_journey_events WHERE ts < now() - interval '90 days'`, mirroring the vendor-health cron) unblocks: bounded capture storage. Same shape as the `llm_traces` retention gap.
- **The crawl route list is hardcoded in the frontend, not derived from the app's route manifest.** [QaContent.tsx](frontend/src/components/QaContent.tsx) `SMOKE_ROUTES` is a static array of ~11 nav paths; it drifts from the real Next.js App Router tree as routes are added/removed. Fixing (generate the route list from the `src/app/**/page.tsx` manifest at build time, or expose it from an endpoint, and feed `POST /api/qa/flows/crawl`) unblocks: crawl coverage that tracks the actual app surface.
- **Flow aggregation loads up to 20k journey events into one Worker invocation with no pagination.** [QaFlowService.aggregate](api/src/application/qa/QaFlowService.ts) does a single `select ... limit 20000` and groups in JS. Fine for early volume; at scale it will blow the Worker memory/time budget and silently truncate (the 20k cap drops the oldest-in-window events with no log). Fixing (windowed/streamed aggregation, or precompute signatures incrementally on ingest) unblocks: aggregation that doesn't cap silently. Note: the silent 20k truncation should at minimum `log()` what was dropped.
- **No nav entry for QA — only reachable via Observability ▸ Agentic QA tab.** Intentional for v1 (keeps it under the existing analytics surface), but there's no [Sidebar.tsx](frontend/src/components/Sidebar.tsx) link, so discoverability is low. Fixing (add a SYSTEM-section link if the feature graduates from internal-only) unblocks: direct access.
### Agentic QA — per-project suite (added 2026-05-31)

The per-project QA automation suite landed: `qa_targets` + `qa_credentials` (encrypted personas) tables + `project_id`/`credential_id`/`persona_role` on flows/tests/runs ([migration 0068](api/migrations/0068_qa_targets_credentials.sql)), targets/credentials/runner-bundle routes + AES-GCM encryption + persona resolution in [qaRoutes.ts](api/src/presentation/routes/qaRoutes.ts), the project-scoped config UI ([QaContent.tsx](frontend/src/components/QaContent.tsx)), and harness login-as-persona ([qa-e2e/src/persona-login.ts](qa-e2e/src/persona-login.ts), [pull-tests.ts](qa-e2e/src/pull-tests.ts)). Residual deferred items:

- **Multi-actor-in-one-scenario is not implemented (phased — operator chose "both, phased" 2026-05-31).** The schema + harness support exactly one persona per generated scenario (`qa_tests.credential_id`, one `test.use({ storageState })` per spec). A scenario that switches actors mid-flow (admin creates a record → viewer verifies they can't edit it, in the *same* test) is not yet possible. Fixing (let a flow carry an ordered list of personas; the generator emits multiple `browser.newContext()` / re-login steps; store the extra persona refs in a `qa_test_personas` join table) unblocks: cross-actor authorization assertions in a single scenario, the strongest form of role-based QA.
- **Persona login uses broad form heuristics — custom/SSO login pages will fail silently into a skipped test.** [persona-login.ts](qa-e2e/src/persona-login.ts) fills `input[type=email]`/`input[type=password]`/submit by heuristic (overridable by `qa_credentials.login_selectors`), but there's no UI to set those selectors, no support for multi-step (email-then-password) or SSO/OAuth logins, and a failed login just skips that persona's tests with a console warning (no `qa_runs` row recording the auth failure). Fixing (a "test this login" button in the credentials UI that returns the captured storageState or the failure, a selectors editor, and a recorded `error` run on login failure) unblocks: reliable auth against real-world login forms, not just the happy path.
- **Project-mode crawl seeds only the site root `/` — no external route discovery.** [QaContent.tsx](frontend/src/components/QaContent.tsx) `crawlRoutes` falls back to `['/']` for a project because we can't read an external app's route manifest (unlike the Builderforce self-test, which uses the App Router tree). So an AI crawl of a customer site only smoke-tests the landing page until flows are added manually. Fixing (a shallow authenticated crawler that visits `/`, harvests in-app links, and feeds the discovered routes to `POST /api/qa/flows/crawl`) unblocks: real auto-discovery of a customer site's surface.
- **`GET /api/qa/credentials/:id/secret` returns a decrypted password and is not audit-logged.** [qaRoutes.ts](api/src/presentation/routes/qaRoutes.ts) gates it to DEVELOPER+, but any such caller (or a leaked QA tenant token) can read every stored site password, and there's no `audit_events`/`admin_audit_log` row recording who fetched which secret. Mirrors the existing `tokenDailyLimitOverride`/LLM-trace-read audit gaps. Fixing (insert an audit row on each secret fetch keyed by actor + credentialId; consider a short-lived scoped token for the harness instead of raw-password delivery) unblocks: forensic trail + least-privilege for the most sensitive endpoint in the system.
- **Stored site passwords are necessarily recoverable plaintext to the harness.** By design, driving an arbitrary site's login form requires the real password, so `secret_enc` is encrypted at rest but decrypted and delivered to the CI runner. There is no support for safer alternatives (a dedicated test account the customer provisions, a magic-link/token login, or per-run ephemeral credentials). Fixing (offer a token/cookie persona type and a "bring your own test account" flow so production passwords needn't be held) unblocks: customers who can't store prod passwords with us.
- **None of the per-project suite has been run end-to-end.** Typecheck (api + frontend + qa-e2e) + schema-drift pass, but migration 0068 isn't applied to any DB, the encryption round-trip / persona form-login / runner-bundle flow have never executed, and the storageState-injection + per-spec `test.use` path is unproven against a real Playwright run. Fixing (apply 0068, configure a project with a target + persona, run `BF_PROJECT_ID=… npm run ci` against a real site) unblocks: confidence the suite works, not just compiles.

### Team Intelligence — activity calendar + Prompt Library (added 2026-05-31 — migration 0069)

This pass shipped the unified contributor activity calendar (humans + AI agents on one heatmap) and the public Prompt Library, both fully typechecked (api + frontend) with schema-drift passing. The three sibling capabilities the operator asked for — **agentic governance/security/audit against rules**, a **FACTS library**, and the prompt **Analyzer** — were scoped out of this pass and remain roadmap items:

- **Governance/security/audit AGENTS that check repos against rules are not built.** The operator chose the "DB policy packs + in-repo overrides" model. What's needed: a `governance_policy_packs` + `governance_rules` schema (tenant/project-scoped, PM-editable in the portal) that an audit agent reads alongside optional in-repo `.builderforce/policies/*.yaml`; a `governance-auditor` agent role + `governance_audit` tool in [coderClaw/product/src/coderclaw/tools/](../coderClaw/product/src/coderclaw/tools/) (extending the existing `createSecurityAuditWorkflow` in `orchestrator.ts`, which today self-audits the claw config, not repo-against-policy); and a `governance_audit_runs` + `governance_findings` table surfaced under the existing `/api/governance` route (SOC2 lives there). Fixing unblocks: the differentiating "agents enforce the rules" capability.
- **FACTS library does not exist.** No `facts` table, no FactsService. coderClaw's [knowledge-loop.ts](../coderClaw/product/src/infra/knowledge-loop.ts) captures per-session memory to `.coderClaw/memory/YYYY-MM-DD.md` and syncs free-text summaries to `team_memory`, but there is no structured, queryable fact store (subject/predicate/object or claim+evidence+confidence) that governance/analyzer agents can assert against. Fixing (a `facts` table keyed by tenant + a `facts` AgentTool with remember/recall, synced via the knowledge loop) unblocks: agents reasoning over durable, structured project truth instead of prose memory.
- **Prompt "Analyzer" (AI prompt optimization from telemetry) is not built.** The Prompt Library stores versions and counts `usage_count`, but nothing correlates a prompt/agent-role to its downstream telemetry (`telemetry_spans` success/duration/cost, `tool_audit_events`) and proposes an improved version. Fixing (an `analyzer_runs` + `analyzer_recommendations` schema, a job that joins prompt usage to span outcomes per role, and an LLM pass that drafts a new `prompt_library_versions` row for human approval) unblocks: the closed-loop "AI tunes the agents' prompts" feature. Depends on prompts actually being wired into agent execution first.
- **Agent vs human activity intensity is not normalized on the merged calendar.** [analyticsRoutes.ts](api/src/presentation/routes/analyticsRoutes.ts) `activity-calendar` colours human cells by the weighted `activityScore` (commits×1 + PRs×3 + …) but agent cells by a raw count of task spans + tool-audit events. The two scales differ by an order of magnitude, so on the merged team heatmap agents can wash out humans (or vice-versa). Fixing (normalize each contributor's daily value to a per-contributor percentile, or define an agent activity-score weighting comparable to the human one) unblocks: a visually honest blended calendar.
- **`sync-agents` has no `(tenant_id, claw_id)` unique constraint — relies on select-then-insert.** [analyticsRoutes.ts](api/src/presentation/routes/analyticsRoutes.ts) `POST /sync-agents` checks for an existing agent contributor then inserts, so two concurrent syncs could create duplicate agent contributors for one claw. Fixing (add a partial unique index `WHERE kind='agent'` on `(tenant_id, claw_id)` in a follow-up migration and switch to `onConflictDoUpdate`) unblocks: idempotent agent import under concurrency.
- **Prompt version history and diffing have no UI.** The API exposes all versions (`GET /api/prompts/:id`) and lets you add versions (`POST /:id/versions`), but [frontend/src/app/prompts/page.tsx](frontend/src/app/prompts/page.tsx) only renders the current version's body. Fixing (a version dropdown + side-by-side diff in the detail drawer) unblocks: reviewing prompt evolution, which is also the Analyzer's surface.
- **Migration 0069 has not been applied to any DB and the calendar/library flows have never run end-to-end.** Typecheck (api + frontend) and schema-drift pass, but no DB has the new columns/tables, so the activity-calendar query, agent sync, and prompt publish/use/star paths are unproven against live data. Fixing (apply 0069, sync agents on a tenant with active claws + ingested git activity, publish and use a public prompt) unblocks: confidence the features work, not just compile.

### Digital-Transformation / Architect repo-analysis tool (added 2026-06-01 — migration 0072; cloud-only)

The Architect tool ships: 3 new tables ([migrations/0072_repo_analysis.sql](api/migrations/0072_repo_analysis.sql) + schema.ts), provider read-clients for GitHub/Bitbucket/GitLab ([api/src/application/repos/sources/](api/src/application/repos/sources/)) with `selectEvidence`, `ArchitectAnalysisService` (6 LLM artifacts), the `AnalysisRunnerDO` alarm-driven pipeline, `/api/repo-analysis` routes, the `/architect` page + sidebar entry, the `MermaidDiagram` component wired into `ChatMessageContent`, and unit tests (8). API type-check + 350 vitest tests + schema-drift all green; frontend type-check green. Remaining roadmap items:

- **Migration 0072 has not been applied to any DB; the pipeline has never run end-to-end against live data.** Type-check (api + frontend), schema-drift, and unit tests pass, but no DB has the `repo_analysis_*` tables and no real repo has been analyzed, so the DO alarm progression (`fetching → analyzing:* → writing_back → completed`), the provider API calls against real GitHub/Bitbucket/GitLab, the project-details write-back, and the `project_memories` seed are unproven live. The `ANALYSIS_RUNNER` DO migration tag `v3` in [wrangler.toml](api/wrangler.toml) is also unapplied. Fixing (apply 0072 + `wrangler deploy` to register the DO, map a repo with a stored credential, run an analysis on a Pro and a Free tenant) unblocks: confidence the feature works, not just compiles.
- **No `ProjectDetailsPanel` "Architecture" tab — the plan included one, only the standalone `/architect` page + nav shipped.** Artifacts are viewable at `/architect` (project picker → tabbed viewer) but not inside the per-project detail drawer ([frontend/src/components/ProjectDetailsPanel.tsx](frontend/src/components/ProjectDetailsPanel.tsx)), which has a tabbed surface (prds/brain/…) where the latest run's artifacts would fit. Fixing (add an 'architecture' tab that lists the latest run's artifacts via the same api helpers) unblocks: in-context access without leaving the project drawer.
- **`POST /runs/:id/retry` (re-run only failed/skipped artifacts) is not implemented.** A run that finishes `partial` (some artifacts `failed`) or a Free run with `skipped` artifacts has no targeted re-run — the only path is a full fresh analysis. Fixing (a retry endpoint that re-arms the DO for a subset of kinds, reusing the existing evidence rows) unblocks: cheap recovery from a single flaky LLM artifact and per-section Pro upgrades.
- **Free tier is capped to diagnostic + recommendation by design; Pro multi-repo/large-repo evidence trimming is still coarse.** `planConfig` in [AnalysisRunnerDO.ts](api/src/infrastructure/relay/AnalysisRunnerDO.ts) gives Free 2 artifacts / ~9k tokens and Pro all 6 / ~120k, with `selectEvidence` sized per-repo. Very large or many-repo Pro projects can still overflow a single artifact's prompt budget (no cross-repo prioritization, no per-artifact evidence subsetting). Fixing (rank repos by relevance, subset evidence per artifact kind, summarize-then-analyze for huge trees) unblocks: reliable full analysis on monorepos / large estates.
- **GitHub truncated trees are accepted, not paged.** [GitHubRepoSource.getTree](api/src/application/repos/sources/GitHubRepoSource.ts) uses `git/trees/{ref}?recursive=1` and records `truncated` in `tree_summary` but does not fall back to per-subtree Git Trees paging, so very large repos sample from a partial file list. Bitbucket/GitLab use a bounded page cap (20) and likewise mark `truncated`. Fixing (per-subtree recursion when `truncated`) unblocks: complete file-tree coverage on large repos.
- **Bitbucket has no languages API, so its language weighting is empty.** [BitbucketRepoSource.getLanguages](api/src/application/repos/sources/BitbucketRepoSource.ts) returns `{}` (the diagnostic infers languages from sampled files instead). Fixing (derive a `{ext: bytes}` distribution from the tree as a proxy) unblocks: parity with GitHub/GitLab language signals in the evidence bundle.
- **Trigger is manual-only; auto-run on repo map + commit-webhook incremental re-analysis is deferred (v2).** Per the approved plan, v1 ships a manual "Run Architecture Analysis" button. Auto-running on first repo map and re-analyzing on push (diff-aware "what changed since last analysis") are not built. Fixing (an auto-run on `RepoService.addRepo` for the first repo, and a GitHub/GitLab/Bitbucket webhook → incremental DO run) unblocks: the "improve the repo from Day 1, continuously" promise.
- **The diagnostic write-back seeds `project_memories` only, not `chat_memories`.** The plan mentioned tagging a `chat_memories` row `source='repo_analysis'`, but that table has no `source` column and requires a `chat_id`/`claw_session_id`; [AnalysisRunnerDO.tickWritingBack](api/src/infrastructure/relay/AnalysisRunnerDO.ts) upserts the consolidated summary into `project_memories` (unique on `project_id`) instead, which is sufficient for Brain context. Fixing (add a provenance column to `chat_memories` if per-source memory rows are wanted) unblocks: finer-grained Brain memory provenance.
- **Generation uses `response_format: json_object`, not strict `json_schema`.** For reliability across the free model pool (mirroring `QaGeneratorService`), [ArchitectAnalysisService](api/src/application/repoanalysis/ArchitectAnalysisService.ts) spells the JSON shape in the prompt and parses defensively rather than enforcing a strict server-validated schema. Fixing (switch to `json_schema` strict once the pool's conformance is confirmed, falling back to json_object) unblocks: stronger structured-output guarantees for the `data_json` agents consume.
- **App-shell chrome is gated by a hand-maintained allow-list, so new authenticated routes silently render with no nav/footer.** [`useShowAppShell`](frontend/src/components/ConditionalAppShell.tsx) is a ~25-entry `pathname.startsWith(...)` allow-list; any authenticated workspace page not added to it falls through to `return false` and loses the TopBar/sidebar/footer. This already bit `/architect`, `/agent-worker`, and `/workflows` (added to the list this pass as the immediate fix). Fixing properly — invert to a deny-list (default authenticated routes to the shell; explicitly exclude marketing `/`, `/blog`, auth-only `/login` `/register`, and self-layout sections like `/coderclaw`) — unblocks: new pages get correct chrome by default and this class of "missing menu/footer" bug can't recur.

### Source-control keys, project Integrations, repo config, board-config & task Agent/PRD tabs (added 2026-06-02 — migration 0074)

Shipped the frontend for the existing-but-unsurfaced credential/repo/board/board-sync backends: workspace-global + **project-scoped** integration keys (migration 0074 adds `integration_credentials.project_id` + `gitlab` to the provider enum), a project **Source control** tab (repo CRUD + credential picker), an **Integrations** tab (keys + external-board connections with test/save/delete + on-create sync kickoff), a Task-Mgmt **COG** board-config slide-out (swimlanes + autonomous-agent assignments + external-board link, reusing `SlideOutPanel`), and a redesigned **task details panel** (1.5× width, Details/Agent/PRD tabs; Agent tab shows executions + tool-call trace + files touched + an agent chat; PRD tab renders markdown with expand-to-fullscreen; "Send to Claw" replaced by an Agent | LLM-model | Run button group). New API clients (`integrationsApi`/`reposApi`/`boardConnectionsApi`/`boardsApi`/`runtimeApi` reads) added to [builderforceApi.ts](frontend/src/lib/builderforceApi.ts). Verified by `tsc` (api + frontend) + `check:schema`. Remaining roadmap items:

- **Migration 0074 is authored but not applied to any live DB.** `integration_credentials.project_id` + the `gitlab` enum value exist in [schema.ts](api/src/infrastructure/database/schema.ts) + [0074_integration_project_scope.sql](api/migrations/0074_integration_project_scope.sql) and `check:schema` passes, but no `npm run db:migrate` ran (headless env). Until applied, project-scoped key creation and GitLab credentials 500 at runtime. Fixing (run `db:migrate` per environment) unblocks: the feature working in prod. Same caveat as the 0070/0071/0072 entries.
- **Recurring external-board sync still has no scheduled poller — only the on-create + "Sync now" manual triggers fire.** The new `BoardConnectionsManager` calls `POST /api/board-connections/:id/sync` once on create and on demand, but nothing drains `board_sync_outbox` / re-polls on `poll_interval_sec` (already logged under the Cloud Agent Boards section — "No scheduled poller drives external board sync"). The new UI makes the gap user-visible: a user sets a poll interval that is never honored automatically. Fixing (the `scheduled()` handler from that entry) unblocks: hands-off inbound sync matching the configured interval.
- **Selected LLM model is forwarded to the agent via the execution `payload` (`{model}`), but the claw/gateway honoring it is unverified.** [RunAgentControl](frontend/src/components/task/RunAgentControl.tsx) sets `payload: JSON.stringify({ model })` and [runtimeRoutes POST /executions](api/src/presentation/routes/runtimeRoutes.ts) forwards `payload` verbatim to the claw dispatch message — but whether the claw runtime actually routes inference to that model (vs. its own default) is out of this repo's control and untested. Fixing (define a typed `executionOptions.model` contract end-to-end and assert the claw honors it) unblocks: reliable per-run model selection.
- **Task Agent tab "files created/modified" is best-effort parsed, not a real diff/files API.** [TaskAgentTab](frontend/src/components/task/TaskAgentTab.tsx) derives file paths from the execution `result` JSON (`files[]`/`changedFiles`) + tool-call `args` heuristics; there is no endpoint returning the authoritative changed-file set or a diff (compounds the already-logged "No diff / changed-files view for agent changes"). Fixing (persist the agent's `files[]`/diff and expose `GET /executions/:id/files`) unblocks: an accurate, non-heuristic changed-files view.
- **Task Agent chat is claw-WebSocket only (`ClawChatContent`), so it appears only when the task has an assigned, connected claw.** Browser-runtime / cloud-dispatch executions don't surface a per-task live chat; tool-call visibility for those relies on the execution trace `toolEvents`, which requires the agent to emit tool-audit events. Fixing (a runtime-agnostic per-task message/event stream) unblocks: directing any agent regardless of runtime.
- **Designer left-panel Brain and the global floating Brain are two independent `<BrainPanel>` instances pinned to the same project, so their local state can diverge.** Per the "keep both" product decision, [IDENew.tsx](frontend/src/components/IDENew.tsx) now renders `<BrainPanel variant="docked">` in the Designer left panel while [FloatingBrain](frontend/src/components/brain/FloatingBrain.tsx) still mounts its own. Both share the same backend chats, but `useBrainChats`/`useBrainConversation` keep per-instance React state — creating/renaming/selecting a chat in one won't reflect in the other until a refetch. Fixing (hoist the active-chat selection into shared `BrainContext`, or suppress the floating instance on `/ide` and reuse one) unblocks: a single coherent conversation across both entry points.
- **Editing while the old shared Monaco model bug was live corrupted existing projects' files to empty in R2; the code fix does not heal already-blanked files.** Before this pass [CodeEditor.tsx](frontend/src/components/CodeEditor.tsx) rendered Monaco with no `path`, so every file shared one model at `Uri("")` — switching files showed the prior file's content and per-keystroke saves wrote the wrong/blank content back to the active path. Fixed by namespacing the model per project+file (`path={modelNamespace}/{filePath}`) and switching models by path instead of a `key` remount. But projects edited under the old bug (e.g. the demo project whose `index.html`/`src/main.jsx`/`src/index.css`/`vite.config.js` show empty in the Run log while `package.json` survived) still hold empty R2 objects. Fixing (a one-off "reset to template for empty files" action, or re-generating via Brain) unblocks: recovery of pre-existing blanked files — new edits now persist correctly.
- **Yjs collab seeding can double-insert if the websocket sync lands after the local seed.** [CodeEditor.tsx](frontend/src/components/CodeEditor.tsx) now seeds an empty `ydoc.getText(filePath)` from the persisted file content on (re)bind so the binding never blanks a file. When `NEXT_PUBLIC_COLLAB_WS_URL` is set, the y-websocket provider may sync authoritative remote content *after* this local seed, producing duplicated text. Inert today (collab is opt-in and unset in prod). Fixing (gate the seed on `provider.synced`/`once('sync')`, or only seed when the room is known-empty) unblocks: safe content seeding once real-time collaboration is enabled.
- **COOP/COEP cross-origin-isolation headers are declared in two places that must be kept in sync by hand.** [next.config.js](frontend/next.config.js) `headers()` covers `next dev`, and the new [public/_headers](frontend/public/_headers) covers the Cloudflare Workers-Assets deploy (next-on-pages doesn't reliably emit `headers()`). Drift between them would silently break WebContainer Run in one environment but not the other. Fixing (generate `public/_headers` from a shared constant at build time, or assert parity in a test) unblocks: one source of truth for isolation headers.
- **`brain-embedded` is a `link:` dep but is NOT built in CI's "link: dep prerequisites" step like its siblings (`sdk`/`studio`/`studio-embedded`).** [ci.yml](.github/workflows/ci.yml) only runs `npm install` (→ `prepare` build) for those three before `pnpm install`. The Vitest `react` resolution failure was fixed in this pass via [vitest.config.ts](frontend/vitest.config.ts) `resolve.dedupe: ['react','react-dom','react/jsx-runtime']` (forces the frontend's single React copy instead of reaching into `brain-embedded/node_modules`, which the frontend-only CI job never installs). This works today **only because `brain-embedded/dist` is committed to git** (unlike `sdk/dist`/`studio/dist`/`worker/dist`, which are gitignored). If brain-embedded's `dist` is ever added to `.gitignore` to match the sibling convention, CI will break again because no build step regenerates it. Fixing (add `(cd brain-embedded && npm install --no-audit --no-fund)` to the prerequisite step so the package is built+installed consistently with its siblings, then `dist` can be safely gitignored) unblocks: a uniform link-dep build story with no committed build artifacts.

### Cloud agents on /workforce (added 2026-06-02 — migration 0075)

Shipped: create a cloud agent on [/workforce](frontend/src/app/workforce/page.tsx) ([WorkforceAgents](frontend/src/components/workforce/WorkforceAgents.tsx)), declare runtime support (cloud / claw / both + best-experience hint), publish to the marketplace with a price (flat-fee or consumption), and manage (edit / unpublish / delete). Cloud agents and remote agentHosts are now unified into one grid (a "Cloud" / "Remote" type pill distinguishes them) behind a single "+ Add agent" dialog with a Cloud/Remote toggle. Backed by tenant-scoped CRUD in [workforceRoutes.ts](api/src/presentation/routes/workforceRoutes.ts) + columns on `ide_agents` (migration 0075: nullable `project_id`, `tenant_id`, `price_cents`/`pricing_model`/`price_unit`, `runtime_support`/`preferred_runtime`, `published`). Verified by `tsc` (api + frontend) + `check:schema`. Remaining roadmap items:

- **Migration 0075 is authored but not applied to any live DB.** `ide_agents` gains nullable `project_id` + `tenant_id`/pricing/runtime/`published` columns and the `gitlab`-style additions, but no `npm run db:migrate` ran (headless env). Until applied, `POST /api/workforce/agents` + `/mine` 500 with "column does not exist". Fixing (run `db:migrate` per environment) unblocks: cloud-agent create/publish working in prod. Same caveat as 0070–0074.
- **Publishing an agent sets `published`+price but agents are NOT yet a marketplace artifact type, so there is no purchase/payout path.** The marketplace artifact enum is `skill | persona | content` ([schema.ts](api/src/infrastructure/database/schema.ts)); `marketplace_purchases` + the Stripe-intent purchase route ([marketplaceRoutes.ts](api/src/presentation/routes/marketplaceRoutes.ts)) don't know about agents. So a published agent's price is stored + displayed but cannot actually be transacted, and "revenue" isn't collected/paid out. Fixing (add `'agent'` to `artifactTypeEnum`, surface published agents in the marketplace listing/detail, and wire the purchase + payout path for agents) unblocks: real agent monetization end-to-end.
- **"Hire" is still only a counter — it does not provision/deploy the agent.** [POST /api/ide/agents/:id/hire](api/src/presentation/routes/ideRoutes.ts) increments `hire_count`; there's no instantiation of the hired agent into the hirer's workspace (no claw bind / cloud-runtime registration). Fixing (on hire, create a tenant-scoped agent instance or bind to a runtime per the agent's `runtime_support`) unblocks: hiring that actually puts an agent to work.
- **`runtime_support` / `preferred_runtime` are declared metadata but not enforced at execution dispatch.** An agent can say it supports only `claw`, yet nothing in the runtime/swimlane dispatch path ([runtimeRoutes.ts](api/src/presentation/routes/runtimeRoutes.ts), [SwimlaneCoordinator](api/src/application/swimlane/SwimlaneCoordinator.ts)) reads these fields to route to the right runtime or reject an unsupported one. Fixing (validate the chosen runtime against `runtime_support` and default to `preferred_runtime`) unblocks: honoring an agent's declared best/only experience.

---

### CoderClaw → BuilderForce Agents rebrand (branch `rebrand/builderforce-agents`, 2026-06-02 → 2026-06-03)

Status: **all 8 phases done in-environment** — api/frontend/docs-site/cross-repo rebranded + verified
(`tsc` clean, 350 api tests pass), DB migration `0078` **applied + verified live**, the product
deep-renamed + **folded into `agent-runtime/`** (install + `tsgo` + `build` green), and the GitHub
repo renamed. The only items NOT done are external/credentialed ops (npm publish — `npm whoami` 401;
DNS) and cosmetic polish (mascot/`pnpm format`). Details below.

The "CoderClaw"/"Claw" brand is being retired in favour of **BuilderForce Agents**. The live
runtime-host entity `Claw` was renamed to **`AgentHost`** (NOT `Agent` — that persona entity
already exists; NOT `AgentRuntime` — that route surface already exists). Done + verified: DB rename
migration [0078](api/migrations/0078_rename_claw_to_agent_host.sql) (+ [rollback](api/scripts/rollback-0078-claw-rename.sql)),
full `api/src` rename (`Claw*`→`AgentHost*`, table `coderclaw_instances`→`agent_hosts`, routes
`/api/agent-hosts`, DO `ClawRelayDO`→`AgentHostRelayDO` + wrangler `v4` migration) — `tsc` clean,
350 tests pass. Remaining roadmap items:

- **Broken image assets from the rename are now FIXED (frontend).** Root cause: the file sweep
  excluded binary extensions, so `.png` *references* got rebranded but the *files* didn't —
  `/claw.png`→`/agentHost.png` (11 refs) and `coderclaw.png`→`/agents.png` (2 refs on `/agents`)
  pointed at non-existent files (404 in prod; the report showed a `522` on `/agentHost.png`, but that
  `522` is Cloudflare-can't-reach-origin — a **deploy/infra** issue, separate from the missing file).
  Fix: renamed `public/claw.png`→`agentHost.png`, restored `coderclaw.png` as `public/agents.png`,
  fixed `public/sw.js` precache + bumped its cache `v1`→`v2`. All `src` asset refs now resolve;
  docs-site + agent-runtime/ui were checked and have no `claw`/`agent*` image-ref breakage. CAUTION
  for future asset sweeps: an image is only "dead" if NO reference (including its *renamed* form)
  resolves to it — I briefly mis-deleted `coderclaw.png` before realising `/agents.png` was its
  orphaned reference, and recovered it from `git show HEAD:`.
- **`frontend/public/install.ps1` crash + stale URLs FIXED; deeper connect-agent flow mismatch LOGGED.**
  Root cause (again): the rename sweep covered `frontend/src` but **not `frontend/public/`**, so
  `install.ps1` still had `worker.coderclaw.ai` (dead) as its default `$ApiUrl` and `coderclaw.ai`
  in docs. Worse, it called `exit` on failure — and the Workforce "Connect a new agent" one-liner
  runs it via `iwr | iex` (in-process), where `exit` **terminates the user's PowerShell session**
  (the reported "crash"). Fixed: URLs → `api.builderforce.ai`/`builderforce.ai`, and every `exit N`
  → `return` so a failure ends the script without killing the host shell.
- **Connect-a-new-agent flow REWRITTEN end-to-end (was: install.ps1 ignored the token).** `install.ps1`
  was a *marketplace-agent registry browser* — it ignored `$env:BUILDERFORCE_TOKEN` /
  `$env:BUILDERFORCE_WORKSPACE` and never registered the machine. Rewrote it to: preflight Node/npm →
  `npm i -g @seanhogg/builderforce-agents` → `builderforce connect` → `builderforce gateway`. Added a
  **new headless `builderforce connect`** command ([builderforce-connect.ts](agent-runtime/src/commands/builderforce-connect.ts),
  [register.connect.ts](agent-runtime/src/cli/program/register.connect.ts)) that reads the token from
  env, `POST`s `/api/agent-hosts`, writes the link key to `~/.builderforce/.env`
  (`BUILDERFORCE_API_KEY`/`URL`) and the host id into project context (which the gateway reads to
  connect). tsgo clean. **Prerequisite to actually run:** `@seanhogg/builderforce-agents` must be
  **published to npm** (still blocked — `npm whoami` 401); until then step 2 of install.ps1 404s
  (handled gracefully).
- **Runtime↔server WIRE CONTRACT was split by the rebrand and is now realigned (the real flow break).**
  The product rename used `claw`→`agentNode` but the API uses `claw`→`agent_host`, so the two halves
  of the SAME wire contract diverged. Fixed in `agent-runtime/src`: **API paths** `/api/agentNodes…`
  → `/api/agent-hosts…` (35 occurrences, 20 files — registration/heartbeat/forward/sync/relay/cron/
  skills/personas all were 404ing); **headers** `X-AgentNode-*` → `X-AgentHost-*` (9, matches the
  server's `X-AgentHost-From/Id/Signature`); **registration response** `res.agentNode` →
  `res.agentHost` (server returns `{agentHost, apiKey}`). tsgo clean. **REMAINING audit (logged):**
  other JSON body fields still carry runtime-side names — `fromAgentNodeId`/`callbackAgentNodeId`
  (forward), assignment-context, etc. in [api-contract.ts](agent-runtime/src/infra/api-contract.ts) —
  each must be verified against its server endpoint's field names; not swept blindly to avoid new
  mismatches. Also `workforce-agent.ts` reads `BUILDERFORCE_AGENTS_LINK_API_KEY` while the rest of the
  runtime uses `BUILDERFORCE_API_KEY` — align to one.
- **The "coderclaw" still visible on `/workforce` was DATA, not code** — the tenant/workgroup row
  (`tenants.id=1`) was literally named/slugged `coderclaw`. `frontend/src` has **0** `coderclaw`
  refs; the page interpolates the workgroup name. Renamed the tenant → `name='BuilderForce'`,
  `slug='builderforce'` (0 `agent_hosts` referenced it, so the slug change was safe) and added a
  `(workspace)` indicator next to the name in `TopBar.tsx`. Remaining `coderclaw` in `api/src` (7)
  are comments + intentional back-compat (GitHub dispatch label, `coderclawllm/` model-id prefix).
- **Two CI failures from the rebrand are now FIXED + verified** (root cause: `tsc`/`tsgo` were used
  as the local gate, but they don't run the checks CI does). (1) **Frontend** — `blogData.ts`
  imported `@/content/blog/agents-and-agent-integration.md` while the renamed file is
  `builderforce-agents-and-agent-integration.md`; `tsc` can't resolve vite's markdown-alias imports
  so it slipped through. Fixed the import; full `vitest run` now green (17 files / 153 tests).
  (2) **API `npm run check:schema`** — `check-schema-drift.mjs` statically parsed only `CREATE TABLE`
  / `ADD COLUMN`, so it couldn't follow migration 0078's dynamic `DO`-block `claw`→`agent_host`
  renames and flagged 21 `agent_host_*` columns/tables as "uncreated". My first instinct (grandfather
  the 21) was WRONG — that masks drift instead of proving schema.ts matches the migrations. **Proper
  fix shipped:** made the checker **rename-aware** — it now follows explicit `ALTER … RENAME TO` /
  `RENAME COLUMN` statements AND declarative `-- @schema-drift-rename-table` /
  `-- @schema-drift-rename-replace` directives (added to 0078, comments only — execution unchanged,
  since the dynamic loop is more complete than any explicit list). The 16 migration-created `claw_id`
  columns + 4 workspace tables now **resolve through the rename (NOT grandfathered)**; only the genuine
  baseline-push (`drizzle-kit push`) items remain grandfathered (93, down from the masking 106). `npm
  test` green (schema check + 350 tests). **Lesson:** the real gates are `npm test` (api),
  `pnpm test`/`vitest run` (frontend), `pnpm build` (agent-runtime) — not just type checks.
- **Migration 0078 is APPLIED + verified live** (`npm run db:migrate`, 2026-06-03): the configured
  Neon DB now has `agent_hosts` (+ all `agent_host_*` tables), `assignment_scope` = `{agent, host,
  project, task, tenant}`, and **0 columns still containing "claw"**. It is metadata-only renames in
  one atomic, idempotent `DO` block (rollback script in `api/scripts/`). NOTE: deploy the renamed
  `api` in lockstep — any still-running pre-rebrand worker against this DB now needs the new code
  (the `/api/claws` alias covers in-flight field agents).
- **Back-compat alias routes `/api/claws` + `/api/managed-claws` were added** ([index.ts](api/src/index.ts))
  so already-deployed field agents (pre-rebrand) keep working. They forward to the new
  `/api/agent-hosts` handlers. Removing them once the deployed agent fleet has upgraded unblocks a
  clean route surface; leaving them indefinitely is harmless but is brand debt.
- **Kebab route `/agentHost-sessions/:id/summarize` is camelCase-inconsistent** ([brainRoutes.ts](api/src/presentation/routes/brainRoutes.ts))
  — the old `/claw-sessions` path was mechanically renamed and should be `/agent-host-sessions`.
  Frontend callers (if any) must change in the same pass. Low priority, cosmetic.
- **Backwards-compat brand strings intentionally left intact**: the GitHub dispatch label
  `'coderclaw'` ([githubWebhookRoutes.ts](api/src/presentation/routes/githubWebhookRoutes.ts)) and
  the `coderclawllm/workforce-*` model-id prefix ([ideAiRoutes.ts](api/src/presentation/routes/ideAiRoutes.ts))
  still accept the old token for existing integrations. Adding the new `builderforce`/`agent` token
  (keeping both) and later dropping the old one unblocks full brand removal without breaking callers.
- **Frontend (`frontend/src`) is now rebranded + verified** (`tsc` clean): `Claw*`→`AgentHost*`
  components, API client, the marketing route moved `app/coderclaw`→`app/agents` with a
  `/coderclaw`→`/agents` redirect ([next.config.js](frontend/next.config.js)), WS event names
  aligned to the API. The `runtime_support` value `'claw'`→`'host'`. Intentionally preserved: the
  separate **OpenClaw** upstream refs and the external malware IOC `ClawdAuthenticatorTool` in
  `data/agents/threats.yaml`.
- **Docs-site + cross-repo prose are now rebranded** (Phases 5–6): `docs-site` `coderclaw-*.md`
  → `agents-*.md` (609 docs reworded, Astro + `_redirects` slug redirects added, logo + GitHub
  URL updated); root `README.md`, `mambacodejs/README.md`, `SSMjs/README.md`, `ide-architecture`
  reworded. **Follow-up:** the docs-site still has ~90 **code-example identifiers** (`clawId`,
  `ClawRelayDO`, `claw_fleet`, `CLAWHUB_*`, `ClawLink*`) left from before the product rename. They
  now need reconciling with the final code, minding the split: **platform** concepts use the
  `AgentHost` family (e.g. `ClawRelayDO`→`AgentHostRelayDO`, `/api/claws`→`/api/agent-hosts`) while
  **product/runtime** concepts use the `AgentNode`/`AgentHub`/`agent_fleet` family. Left unswept to
  avoid a wrong blind rename across the two namespaces.
- **The CoderClaw product is now fully renamed AND folded into this monorepo at `agent-runtime/`
  (Phase 4 complete).** The whole product (`@seanhogg/builderforce-agents`, CLI `builderforce`,
  binary `builderforce.mjs`) was deep-renamed: `CoderClaw*`→`BuilderForceAgents*`, bare
  `Claw`→`AgentNode`, `ClawLink`→`AgentLink`, `ClawHub`→`AgentHub`, the runtime workspace dir
  `.coderClaw/`→`.builderforce/`, `CODERCLAW_*`→`BUILDERFORCE_AGENTS_*` env, and the 40
  `coderclaw.plugin.json` manifests → `builderforce.plugin.json` (files + discovery code). The
  product's `tsgo` typecheck passed **0 errors**, then it was moved to `agent-runtime/` and
  **`pnpm install` + `tsgo` + `pnpm build` all pass green** (build: 287 bundles, plugin-sdk dts
  compiled, exit 0), and the full **`pnpm test` suite ran (6435 tests)**. The initial run surfaced
  two failure classes, both now resolved: (a) **rename-induced test-data inconsistencies** —
  `CoderClaw`→`BuilderForceAgents` (no space) vs `coderclaw`→`builderforce` made brand strings in 4
  test files diverge (discord slug `friends-of-builderforce` vs normalized `…agents`, an
  `\bbuilderforce\b` pattern vs `BUILDERFORCE_AGENTS` input, a stale `.toSorted()` order, and a
  `Dockerfile`/`.swift`/dotfile category my extension-scoped sweep had MISSED) — **all fixed +
  verified passing**; and (b) **environmental flakiness** (`gateway-lock.test.ts` etc. pass in
  isolation, flake only under the heavily-parallel runner). A **final all-file-types sweep** then
  cleaned `.swift` (Swabble), Dockerfiles, `.env.example`/`.gitignore`, and `*.dev.md`; the only
  residual `claw` is the **`Clawd` mascot family** (`Clawd`/`Clawdbot`/`Clawdock`/`ClawdAuth`),
  intentionally preserved. **Final full-suite re-run after the fixes: 755 files passed / 10 skipped
  / 0 failed.** A rename artifact was also fixed
  along the way: two extension `peerDependencies` pointed at unscoped `builderforce` (404) →
  repointed to `@seanhogg/builderforce-agents`. Only follow-up: `pnpm format`/`oxlint` polish
  (cosmetic — the mass renames changed line contents so `pnpm format` will reflow the diff).
- **The lobster/crab (🦀) mascot has been retired in the Builderforce.ai frontend** (owner
  decision). The 🦀 emoji used as a brand/Workforce icon was swept to the real logo via the shared
  [MascotIcon](frontend/src/components/MascotIcon.tsx) (`/agentHost.png`) in the Sidebar, mobile
  bottom bar, and dashboard empty-state; data-file emojis that can't hold JSX were swapped to
  topical non-crab emoji (`🕸️` Workforce Mesh in [content.ts](frontend/src/lib/content.ts), `🤖`
  Agent Run node in [nodeKinds.ts](frontend/src/components/workflow-builder/nodeKinds.ts)); the
  three "lobster" testimonial quotes were reworded. **Intentionally NOT touched:** the `lobster`
  *workflow tool* under `agent-runtime/extensions/lobster` (a real external product named Lobster,
  unrelated to the mascot). Still pending: the `agent-runtime/ui/public/favicon.svg` lobster artwork
  + the CONTRIBUTING "lobster tank" copy (see Gap Register).
- **Repo renamed: `SeanHogg/coderClaw` → `SeanHogg/BuilderForceAgents`** (done via `gh`; old URLs
  redirect; local remote updated). The product content now lives in this Builderforce.ai monorepo;
  the renamed repo retains the mobile `apps/` + brand assets (fold those next if desired).
- **Blocked — external ops that need credentials/access this environment does not have:**
  (1) **npm: `npm deprecate @seanhogg/coderclaw` (exists @ 2026.3.21) + publish
  `@seanhogg/builderforce-agents` (404, unpublished)** — BLOCKED: `npm whoami` returns **401**, no
  valid publish token here. The package now builds, so this is a one-command release once
  authenticated. (2) **`coderclaw.ai`→`builderforce.ai` DNS/301** + the install-script endpoint +
  Discord handle — need registrar/Cloudflare DNS access (app-level `_redirects` + Astro redirects
  are already in place). (3) The generated `docs-site/src/assets/install-script.svg` + the
  `credits.md` "CLAW + TARDIS" easter-egg still say "claw" — cosmetic, regenerate/reword when the
  mascot decision lands.
- The Gap Register entries further above that mention "claw" (cloud-agents / runtime_support) are
  historical context and were intentionally left as-is.
- **Visual workflow *definitions* are not project-scoped — only workflow execution records are.** This
  pass added `workflows.project_id` (migration 0086) so execution records ([workflowRoutes.ts](api/src/presentation/routes/workflowRoutes.ts))
  can be associated with a project, surface project+agent on the [Workflows cards](frontend/src/components/WorkflowsContent.tsx),
  and drive the Projects-page "N workflows" badge + "View workflows" filter. The `workflow_definitions`
  table (the builder templates rendered by `SavedDefinitionsSection`) has no `project_id`, so the
  "Visual workflows" section still shows *all* tenant definitions even when the Workflows page is
  filtered to one project — mildly inconsistent with the filtered execution list below it. Fixing
  (add `project_id` to `workflow_definitions`, a project picker in the builder, and filter
  `SavedDefinitionsSection` by the active `projectId`) unblocks: a fully project-scoped Workflows page.
- **Cloud execution does not clone/analyze the repo or write `PRD.md` into it — only the DB PRD step runs.**
  `runCloudExecution` ([runtimeRoutes.ts](api/src/presentation/routes/runtimeRoutes.ts)) is now PRD-first and
  rules-aware: it `ensureProjectPrd()`s (generates a WIP PRD if the project has none, persists it to `specs`
  so it shows in the **PRD tab**, emits it as the first `file_change`), then produces the deliverable honoring
  the PRD + `projects.governance` with a no-placeholder instruction. **Still missing the rest of the standard
  flow:** it does not pull the repo, analyze the code, run tools, or write `PRD.md`/changes into the actual
  repository (the Worker has no FS/subprocess). That requires a connected runtime (V2 Claude Agent SDK or a
  self-hosted agentHost). Fixing (route cloud runs to a builderforce-operated agent-runtime that clones the
  repo, drafts `PRD.md` from code analysis, and commits it) unblocks: the full repo-aware flow the user expects.
- **PRD-first is cloud-path-only; runtime "Run task" executes a single agent turn, not the PRD-first flow.**
  `ensureProjectPrd` runs inside `runCloudExecution`, so a self-hosted / V2 run of a single task does NOT
  guarantee a PRD is drafted + persisted first (the orchestrator's planning workflow does PRD→arch→tasks, but
  a one-off "Run" dispatches a single `chat.send`/V2 run). Fixing (hoist the PRD-first step into
  `dispatchAndQueue` for all runs, or have the runtime write `PRD.md` + POST it back to `specs`) unblocks:
  a uniform PRD-first flow regardless of which engine executes, with the PRD always landing in the PRD tab.
- **PRD WIP file is full-replace by the PRD-owner task only; downstream agents can't edit it.** The new
  [prd-wip.ts](agent-runtime/src/builderforce/prd-wip.ts) writes `PRD.md` at the repo root (and `git add`s it
  as a pending commit) when an `architecture-advisor` task whose description names a PRD completes, and the
  [orchestrator](agent-runtime/src/builderforce/orchestrator.ts) injects the file into every downstream
  task's context. Gaps: detection is heuristic (`isPrdTask` regex, not an explicit `producesPrd` step flag);
  downstream agents receive the PRD read-only (no append/section-edit tool), so "used across all agents that
  execute on the task" is read-shared but not write-shared; and staging is best-effort `git add` with no
  commit/branch (intentional — pending review). Fixing (explicit `producesPrd` flag on the planning step + a
  `prd_edit`/section-merge tool agents can call) unblocks: collaborative PRD authoring across the swimlane.

- **PRD multi-agent UPDATE flow + agent task-mutation tools are not built.** The PRD is now task-scoped
  (`tasks.spec_id`), carries an attribution header naming the drafting agent, is recorded as an attributed
  `PRD.md` change, and is **committed to the ticket git branch as a pending change** (branch + PR) via the
  provider API ([commitFileToRepo.ts](api/src/application/repos/commitFileToRepo.ts) +
  [commitPrdToRepo.ts](api/src/application/repos/commitPrdToRepo.ts), works on the no-runtime cloud path). The
  runtime path commits **all** workspace files to the branch per run (`commitAndPushTicketBranch`). The branch
  is surfaced on the ticket Details as a hyperlink to the PR (`tasks.git_branch`, migration 0091); the agent
  self-assigns (`tasks.assigned_agent_ref`, migration 0090) and both now flow through `Task` →
  frontend. **Still missing:** (1) downstream agents can't *append* attributed updates to an existing PRD — only
  the first draft is written (the header invites updates but there's no `prd_update` flow appending a signed
  section + re-commit); (2) agents can't update the ticket description/status via a tool (no agent-facing
  task-mutation tool / agent-user identity); (3) the assigned agent isn't rendered as a name/AgentChip on the
  card (the `assigned_agent_ref` id reaches the frontend but isn't resolved to the agent's name/avatar);
  (4) Auto/default runs have no `cloudAgentRef`, so no agent identity to assign. Fixing unblocks: collaborative,
  attributed PRD authoring + agents visibly owning and editing their tickets.
- **`commitFileToRepo`/`commitPrdToRepo`/`createPullRequest` are GitHub-only.** Bitbucket/GitLab return a typed
  `unsupported` result, so the PRD-as-pending-change + PR flow only lands on GitHub repos; other providers keep
  the PRD in the DB (PRD tab) with no branch. Fixing (implement the branch+commit+PR REST calls per provider)
  unblocks: the git pending-change flow on non-GitHub repos.
- **`/llm/v1/messages` does not enforce the plan daily-token cap.** The endpoint now defaults to OUR model pool
  (Messages⇄OpenAI translation via [anthropicMessagesBridge.ts](api/src/application/llm/anthropicMessagesBridge.ts),
  reusing `llmProxyForPlan`) when no tenant Anthropic key is set, and passes through to api.anthropic.com when a
  BYO key exists. Unlike [`/v1/chat/completions`](api/src/presentation/routes/llmRoutes.ts) it skips the
- **`/llm/v1/messages` does not enforce the plan daily-token cap.** The endpoint now defaults to OUR model pool
  (Messages⇄OpenAI translation via [anthropicMessagesBridge.ts](api/src/application/llm/anthropicMessagesBridge.ts),
  reusing `llmProxyForPlan`) when no tenant Anthropic key is set, and passes through to api.anthropic.com when a
  BYO key exists. Unlike [`/v1/chat/completions`](api/src/presentation/routes/llmRoutes.ts) it skips the
  `llmUsageLog`-SUM daily-cap gate — now more relevant since the our-models path bills US, not the tenant.
  Fixing (reuse the same daily-cap gate on the our-models branch) unblocks: budget enforcement for V2 on our pool.
- **The Anthropic⇄OpenAI streaming translation needs live validation against the Claude Agent SDK.** The bridge's
  `createAnthropicStreamEncoder`/`pipeOpenAiSseToAnthropic` map OpenAI SSE deltas → Anthropic Messages events
  (text + tool_use), unit-tested for the common sequences — but interleaved/parallel tool-call streaming and
  partial-JSON edge cases haven't been exercised by a real SDK run (no live model available here). Fixing
  (run the V2 SDK against `/llm/v1/messages` and reconcile any tool_use streaming gaps) unblocks: confidence the
  default (no-BYO-key) V2 path drives the agent loop correctly.
- **Live execution stream is per-isolate; assistant-text deltas aren't pushed mid-run.** The
  `/executions/:id/stream` WS subscriber map ([runtimeRoutes.ts](api/src/presentation/routes/runtimeRoutes.ts))
  lives in one Worker isolate, and self-hosted mid-run frames arrive at the relay DO (a different object), so
  assistant token deltas don't reach the execution panel live — the [AgentExecutionPanel](frontend/src/components/agent/AgentExecutionPanel.tsx)
  now re-polls the `trace` every 4s while running to surface live tool-calls/file-changes (Changes/Tools),
  but the Output thread only fills from the terminal result or the cloud path's single assistant event.
  Fixing (host execution streaming in a Durable Object, or have the relay DO forward `chat.message` deltas to
  an execution-events channel) unblocks: true token-streaming Output for self-hosted runs.
- **The per-execution `trace` endpoint returns the empty fallback for panel-submitted runs — `execution.sessionId`
  is never linked to the agent's `"main"` session.** [RunAgentControl](frontend/src/components/task/RunAgentControl.tsx)
  submits with no `sessionId`, so [RuntimeService.submit](api/src/application/runtime/RuntimeService.ts) stores
  `sessionId: null`, but the agent always runs/persists telemetry under sessionKey `"main"`
  ([builderforce-relay.ts](agent-runtime/src/infra/builderforce-relay.ts) runV1/runV2/steering + the V2 sinks).
  The [`/executions/:id/trace`](api/src/presentation/routes/runtimeRoutes.ts) handler guards on `!plain.sessionId`
  and returns `{usageSnapshots:[], toolEvents:[]}`, and even past the guard it joins
  `toolAuditEvents.sessionKey === execution.sessionId` — so the Agent Tab's **Tools** sub-tab (and any
  per-execution usage/output read) is always empty for self-hosted runs, despite the agent persisting the data
  under `"main"` (which is why the per-agentHost **Observability** page, which does NOT filter by session, shows it
  fine). This contradicts the entry above (the 4s trace re-poll surfaces *file-changes* via the separate taskId-keyed
  `taskFileChanges`, not tool-calls). Fixing (thread a per-execution `sessionId` — e.g. `exec-<id>` — through the
  dispatch contract → agent-runtime sessionKey + telemetry sinks + steering injection, then drop the `!sessionId`
  fallback; OR map `execution.sessionId` to the agent's session at submit) unblocks: correct per-execution Tools /
  usage / output in the ticket panel, and removes cross-execution telemetry bleed when an agentHost runs more than
  one task in session `"main"`. NOTE this pass shipped the minimal Agent-Tab fixes only: the steering directive now
  renders optimistically (the per-isolate stream echo was being dropped) and the panel links out to Observability
  for full diagnostics — by design the ticket tab stays minimal and the full firehose lives on Observability.
- **The new IDE dashboard exposes a "New Video project" create path with no Pro+ entitlement gate.** [/ide/dashboard](frontend/src/app/ide/dashboard/page.tsx) renders a project-type chooser (Designer / Video / LLM) driven by [modality.ts](frontend/src/lib/modality.ts) and calls `createProject({ modality })` directly — so a free-plan tenant can now create a `video` project and open the heavy (6 GB-VRAM) Video modality from the launcher, not just via the in-IDE switcher. This is the same root gap already logged above ("Project modality entitlement gate is partial … the frontend `Tenant` type carries no plan/tier field"): the chooser only honors `comingSoon`, and Video isn't `comingSoon`. Fixing (surface tenant plan/tier on the `Tenant` object, add a `requiresPaidPlan` flag to the Video `ModalityDef`, and gate both the dashboard chooser card AND the IDE switcher on it — one shared check) unblocks: revenue protection on the Video modality across every create surface. Bundle with the existing partial-gate entry — same fix closes both.
- **OAuth/login callback can't auto-select a single workspace when a terms re-acceptance is pending — user is bounced through `/tenants`.** This pass fixed the hard "Sign-in failed" lockout that hit every returning user after a terms version bump (1.0.0→1.0.1): the terms gate in [webAuthMiddleware.ts](api/src/presentation/middleware/webAuthMiddleware.ts) 428'd `/api/auth/me`, which the [/auth/callback](frontend/src/app/auth/callback/page.tsx) page needs to persist the session before [OnboardingGate](frontend/src/components/OnboardingGate.tsx) can render the existing `TermsAcceptanceScreen` — a chicken-and-egg. Fixed by exempting the read-only `/api/auth/me` from the terms gate (symmetric to the existing `/api/auth/legal/*` exemption; action/tenant endpoints stay gated). **Residual:** during that callback, [resolveAndSelectTenant](frontend/src/lib/auth.ts) still calls the terms-gated `/api/auth/my-tenants`, which 428s → caught → returns null, so even a single-workspace user lands on the tenant selector after accepting terms instead of auto-selecting and going straight to `/dashboard`. Fixing (after `acceptTerms()` succeeds in [onboarding.ts](frontend/src/lib/onboarding.ts), re-run `resolveAndSelectTenant` so the now-ungated `/my-tenants` can auto-select; or also exempt `/api/auth/my-tenants` as another read-only identity endpoint) unblocks: returning single-workspace users skipping the redundant tenant-pick step after a terms bump.

---

## License

MIT — see [LICENSE](LICENSE).
