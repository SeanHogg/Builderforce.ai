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
- **In-browser LoRA fine-tuning** — uses [MambaKit](https://www.npmjs.com/package/@seanhogg/mambakit) / Transformers.js with WebGPU; trains Mamba-1/2/3 and GPT-style models up to 2B parameters entirely client-side
- **Hybrid Local Brain** — Mamba State Engine (`mamba-engine.ts`) runs an O(n) selective scan alongside transformer inference; agent state persists to IndexedDB as a compact Float32 state vector and is embedded in exported `AgentPackage` JSON
- **Dataset generation** — LLM-assisted JSONL instruction dataset creation with SSE streaming progress
- **AI evaluation** — independent judge scores model outputs on code correctness, reasoning quality, and hallucination rate (0.0–1.0)
- **WebGPU fallback** — CPU software path via `forceFallbackAdapter: true`; platform reports `gpuMode: 'cpu-fallback'` transparently

### Workforce Registry
- **Publish specialist agents** — bundle a LoRA adapter, capability profile, and `MambaStateSnapshot` into a portable `AgentPackage` JSON artifact
- **Skill-based discovery** — agents are searchable by skills, evaluation score, and hire count
- **Hire and deploy** — one click to register an agent in your [CoderClaw](https://coderclaw.ai) mesh; PowerShell install script for local deployment
- **Iterative improvement** — `training_sessions` table tracks dataset → training → evaluation → re-training loops for continuous agent quality improvement

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
       └─ CODERCLAW_LINK_API_KEY → heartbeat → Builderforce.ai
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
export CODERCLAW_LINK_API_KEY=<your-api-key>
export CODERCLAW_LINK_URL=https://api.builderforce.ai
coderclaw start
```

CoderClaw operates fully standalone without Builderforce. The connection unlocks fleet visibility, task assignment with live execution tracking, enforced approval gates, portal-managed skill assignments, scheduled cron execution, and access to the Workforce Registry.

---

## On-Device AI Stack

Builderforce.ai is built on the open-source MambaCode.js / MambaKit / SSMjs stack for on-device AI:

```
MambaCode.js (@seanhogg/mambacode.js)
  └─ WebGPU WGSL kernels: Mamba-1 (S6), Mamba-2 (SSD), Mamba-3 (complex MIMO+ET), causal attention
        ↓
MambaKit (@seanhogg/mambakit)
  └─ MambaSession.create() — one-call GPU init, tokenizer, model, checkpoint, persistence
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
│  └────────────────────────────┘                                   │
└───────────────────────────────────────────────────────────────────┘
```

**Two Cloudflare Workers, one platform:**

| | `api` (api.builderforce.ai) | `worker` (worker.builderforce.ai) |
|---|---|---|
| **Purpose** | Auth, tenants, claws, tasks, brain, marketplace | IDE projects, files, datasets, training, collaboration |
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

**Required secrets:** `CF_API_TOKEN`, `CF_ACCOUNT_ID`, `NEON_DATABASE_URL`, `JWT_SECRET`, `OPENROUTER_API_KEY`

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

## Roadmap

See the [platform roadmap](../README.md#roadmap) for the full picture. Builderforce.ai-specific priorities:

- **Telemetry domain** — `POST /api/runtime/executions/:id/telemetry` callback; `GET /api/runtime/dashboard` aggregate per tenant; true OTel trace proxy
- **Approval workflow** — full approval gate UI with policy rules (model cost threshold, file scope, role); mobile-ready
- **Worker → API consolidation** — fold IDE project/file/training/collaboration routes into the API worker; single deployment target
- **Auth hardening** — OAuth (GitHub / Google) alongside existing JWT; SSO for enterprise tenants
- **Billing** — usage-based credits for AI inference, storage, and training GPU-time
- **Template gallery** — React, Vue, Express, Python starters for new projects
- **Self-hosted deployment** — Docker + Compose path for Builderforce.ai itself; abstract Cloudflare-specific primitives for on-premises installations

---

## License

MIT — see [LICENSE](LICENSE).
