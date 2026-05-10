# Builderforce.ai

> **The professional enterprise platform for AI-powered software delivery** — build, train, and deploy AI coding agents from a browser-native IDE backed by Cloudflare's edge infrastructure.

[![Deploy Status](https://img.shields.io/badge/deploy-Cloudflare%20Pages-orange)](https://builderforce.ai)
[![Worker](https://img.shields.io/badge/api-Cloudflare%20Workers-blue)](https://workers.cloudflare.com)
[![DB](https://img.shields.io/badge/db-Neon%20Postgres-green)](https://neon.tech)

---

## What is Builderforce.ai?

Builderforce.ai is where ideas become software and software becomes agents. It combines a full in-browser IDE with an AI training pipeline, a Workforce Registry for specialist agents, and an orchestration portal for self-hosted [CoderClaw](https://coderclaw.ai) agent meshes.

**One platform. Three roles:**

| Role | What it does |
|---|---|
| **Enterprise IDE** | Full Node.js runtime in the browser (WebContainers + Monaco + xterm.js); real-time collaboration; AI pair programming |
| **AI Training Studio** | In-browser LoRA fine-tuning on instruction datasets; WebGPU-accelerated; models up to 2B parameters; no cloud GPU required |
| **Orchestration Portal** | CoderClaw fleet management; task assignment; heartbeat monitoring; claw-to-claw mesh relay; approval gates |

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
- **Hire and deploy** — one click to register an agent in your [CoderClaw](https://coderclaw.ai) mesh; PowerShell install script for local deployment
- **Iterative improvement** — `training_sessions` table tracks dataset → training → evaluation → re-training loops for continuous agent quality improvement

### Local LLM Inference Pipeline (Phase 3)
- **Per-agent inference endpoint** — `POST /api/ide/agents/:id/chat` routes inference through OpenRouter with the agent's persona injected into the system prompt; `X-Inference-Mode: lora | hybrid | base | fallback-base` header signals which path ran
- **Mamba state injection** — v2.0 agents carry a `MambaStateSnapshot`; each inference call prepends `[Memory: step=N signal=X context="..."]` to the system prompt, giving the agent persistent conversational memory without re-training
- **Mamba state sync** — `PUT /api/ide/agents/:id/mamba-state` accepts a `MambaStateSnapshot` from CoderClaw after each session; upgrades the agent package to v2.0 and recomputes `inference_mode`; `GET /api/ide/agents/:id/mamba-state` retrieves the stored snapshot
- **Package versioning** — agent packages are v1.0 (LoRA only) or v2.0 (LoRA + Mamba state); `GET /api/ide/agents/:id/package` returns the correct format and increments `request_count`
- **Workforce routing in chat** — `POST /api/ai/chat` with `model: "coderclawllm/workforce-<agentId>"` auto-routes to the agent inference endpoint; no client-side changes required
- **Inference logging** — `agent_inference_logs` table captures model ref, latency, token counts, status, and inference mode per request for observability and billing

### CoderClaw Orchestration Portal
Builderforce.ai is the cloud-side control plane for [CoderClaw](https://coderclaw.ai) self-hosted agents:

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

## Integration with CoderClaw

```
Developer workstation
  └─ CoderClaw (self-hosted, MIT)
       ├─ 7-role agent DAG (Code, Review, Test, Debug, Refactor, Document, Architect)
       ├─ Staged diff review (accept/reject before writing to disk)
       ├─ Claw-to-claw mesh (remote:<id>, remote:auto[caps], HMAC-signed dispatch)
       ├─ Workflow telemetry → .coderClaw/telemetry/ + portal timeline
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

**Required secrets:** `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `NEON_DATABASE_URL`, `JWT_SECRET`, `OPENROUTER_API_KEY`, `NPM_TOKEN` (for SDK publishing — see below)

**SDK publishing:** the [release.yml](.github/workflows/release.yml) `publish-sdk` job runs `node scripts/publish-if-new.mjs` on every push to `main`. It checks whether `sdk/package.json` `version` is already on npm; if not, it publishes with `--provenance --access public`. Bump the version in `sdk/package.json`, push to `main`, the new version lands on npm. Re-runs are idempotent (skip if version unchanged). Requires repo secret **`NPM_TOKEN`** — generate via `npm token create --type=automation`, then add at *Settings → Secrets and variables → Actions → New repository secret*.

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

- **`model` is a hint, not a hard pin — diverges from the consumer's contract draft.** The SDK consumer's gap analysis explicitly asked for "no 'best available' substitution by gateway. Gateway routes by string." [LlmProxyService.complete()](api/src/application/llm/LlmProxyService.ts) implements the opposite: caller's `model` heads the candidate chain, gateway substitutes on cooldown / vendor failure / plan mismatch, the actual model surfaces via `_builderforce.resolvedModel`. The consumer's `tryProfileChain` will still work — they advance their chain when `resolvedModel !== requestedModel` indicates substitution. If a strict-pin mode is needed (for evaluations, reproducibility), expose it as a separate `?strict=true` query param or a `_builderforce: { strict: true }` request hint that disables the gateway's failover for that single call. Fixing (deciding whether to add strict mode) unblocks: deterministic eval runs against a specific model.
- **Migrate npm publish from `NPM_TOKEN` to Trusted Publishing (OIDC).** [release.yml](.github/workflows/release.yml) currently authenticates via the long-lived `NPM_TOKEN` automation secret (npm flagged this as having "security risks for automation/CI/CD uses"). The workflow already has `permissions: id-token: write` and uses `npm publish --provenance`, so the migration is a npmjs.com-side config: package → *Publishing access* → *Add trusted publisher* → GitHub Actions / `SeanHogg` / `Builderforce.ai` / `release.yml`. Once configured, delete the `NPM_TOKEN` secret. [publish-if-new.mjs](sdk/scripts/publish-if-new.mjs) already detects either auth path. Fixing unblocks: rotating-secret hygiene, no long-lived credentials in repo settings.
- **`ClawRepository.updateStatus` and `clawService.deactivate` don't invalidate the auth cache.** Three top-level claw routes (`DELETE /api/claws/:id`, `PATCH /:id/status`, `PATCH /:id/limits`) now call [invalidateKeyCache](api/src/infrastructure/auth/keyResolutionCache.ts) on mutation, so the long-TTL `clk_*` cache stays consistent through those entry points. Two deeper paths still bypass the cache invalidation: [ClawRepository.updateStatus](api/src/infrastructure/repositories/ClawRepository.ts) and [clawService.deactivate](api/src/application/claw/ClawService.ts) (called from the WebSocket close handler in `clawRoutes.ts:1259`). If a claw is deactivated through either path, the cache will continue to serve "active" for up to a year. Fixing (push the invalidation down into the repository / service layer) unblocks: removing the foot-gun for any future caller of those abstractions.
- **JWT auth path is not cached.** [requireTenantAccess](api/src/presentation/routes/llmRoutes.ts) caches `bfk_*` and `clk_*` lookups in KV but the JWT branch still hits Neon for `tenants` + `tenant_members` on every request. JWT calls are typically lower-volume than `bfk_*` (browser sessions vs server-to-server), so this is a smaller wins/effort ratio — but worth caching with the same TTL once volume warrants. Fixing unblocks: faster auth for browser-side calls.
- **`Idempotency-Key` MVP returns 409, doesn't replay the original response body.** The gateway now refuses to re-dispatch when `(tenant_id, idempotency_key)` was used in the last 10 min ([llmRoutes.ts](api/src/presentation/routes/llmRoutes.ts) — `code: 'idempotent_replay'`), preventing double-charge on cron retries. **What's still missing:** caching + replaying the original 200 response body, which requires a Cloudflare Workers KV namespace (provisioned via `wrangler kv:namespace create` and added to `wrangler.toml`). Until that lands, retried cron jobs see a 409 instead of the original answer. Fixing unblocks: transparent cron retries that get the cached output.
- **Gateway-side strict-pin mode for `model` is not implemented.** The gateway treats `model` as a hint and may substitute on cooldown / failure ([LlmProxyService.complete()](api/src/application/llm/LlmProxyService.ts)). Workaround documented in [SCENARIOS.md](sdk/docs/SCENARIOS.md) — caller reads `_builderforce.resolvedModel` and rejects when it differs from the request. Adding a server-side `body.strict: true` flag (or `?strict=true` query) that skips substitution + 503s when the named model is unavailable would let eval / reproducibility runs reject without the round-trip. Fixing unblocks: deterministic A/B evaluations against a specific model.
- **Streaming tool-call deltas don't have name restoration.** The bidirectional tool-name sanitizer ([toolNameSanitizer.ts](api/src/application/llm/toolNameSanitizer.ts)) restores dotted names in non-streaming responses, but streaming `ToolCallDelta` chunks carry the sanitized form because the name arrives in fragments and stitching across deltas is brittle. Consumers using streaming + tool calls today must call `restoreToolName()` themselves on the stitched delta. Fixing (a delta-aware restore that buffers name fragments per tool-call index) unblocks: streaming + tool-calling consumers.
- **Per-user sub-ledger from `metadata.userId` is not implemented.** The gateway debits the tenant's daily plan budget; if the SDK's `metadata.userId` is set, the gateway could maintain a per-user sub-ledger and enforce per-user caps. Tenant apps continue to enforce per-user budgets locally. Needs a product decision (per-user cap UX in the portal) plus a `tenant_user_token_caps` table and a query in the chat route. Fixing unblocks deletion of tenant-side `tokenLedger.charge` plumbing.
- **`json_schema` conformance retry uses minimal validation.** [LlmProxyService.checkResponseFormatConformance](api/src/application/llm/LlmProxyService.ts) catches the two most common failure modes (content doesn't parse; top-level required field missing) but does not validate nested types, enums, or `additionalProperties: false`. Sufficient for `strict: true` schemas with a flat required-field gate; insufficient for deeply-nested contracts. Fixing (add a small JSON Schema validator — `ajv` is too heavy, but a hand-rolled subset of draft-07 covering type/required/enum/properties is ~200 LOC) unblocks deletion of tenant-side schema-retry loops for complex schemas.
- **Embeddings is single-vendor (OpenRouter only).** [callOpenRouterEmbeddings](api/src/application/llm/vendors/openrouter.ts) is the only implementation. No failover yet — if OpenRouter's embeddings endpoint is down, embeddings calls fail. Lift the function into an `EmbeddingsVendorModule` shape mirroring chat vendors and add at least one alternate (Cohere or Voyage). Fixing unblocks single-vendor outage resilience for vector workflows.
- **72 React-hooks ergonomics warnings demoted from error to warn.** [frontend/eslint.config.js](frontend/eslint.config.js) downgrades `react-hooks/set-state-in-effect`, `react-hooks/refs`, `react-hooks/purity`, `react-hooks/immutability`, and `react-hooks/preserve-manual-memoization` because `eslint-plugin-react-hooks` v6 + the React Compiler plugin started flagging dozens of legitimate pre-existing patterns (fetch-on-mount, ref-mirror, manual `useCallback`) as errors and broke the deploy. Patterns themselves are not bugs — ergonomics suggestions. Fixing (refactor each warning to the React-Compiler-blessed shape, then re-promote to error) unblocks: catching genuinely-unsafe state mutations during review.
- **`requireTenantAccess` unit test uses a hand-rolled Drizzle chain mock.** [api/src/presentation/routes/llmRoutes.test.ts](api/src/presentation/routes/llmRoutes.test.ts) `mockDb()` synthesizes `select().from().where().limit()` chains with canned `[row]` returns. If the auth path grows another link (e.g. `.orderBy`, `.innerJoin`), the mock returns `undefined` and the test still passes while production breaks. Fixing (shared test helper or a real in-memory pg) unblocks: confidence that gateway-auth refactors are caught by tests, not prod.
- **Schema-drift allowlist contains 106 pre-existing drift items.** [api/scripts/.schema-drift-allowlist.txt](api/scripts/.schema-drift-allowlist.txt) grandfathers 106 columns/tables that exist in [schema.ts](api/src/infrastructure/database/schema.ts) without a tracked migration — they were likely created via `drizzle-kit push` rather than a versioned migration. The CI guard now catches *new* drift (#4 fixed); reducing the allowlist to zero is a separate cleanup that needs each pre-existing table backfilled with a CREATE-TABLE migration, then removed from the allowlist line-by-line. Fixing unblocks: reproducible-from-zero database setup.

---

## License

MIT — see [LICENSE](LICENSE).
