# Builderforce.ai

> **Browser-based AI coding platform** — build, run, and deploy Node.js projects entirely in the browser, backed by Cloudflare's edge infrastructure and in-browser LoRA model training.

[![Deploy Status](https://img.shields.io/badge/deploy-Cloudflare%20Pages-orange)](https://builderforce.ai)
[![Worker](https://img.shields.io/badge/api-Cloudflare%20Workers-blue)](https://workers.cloudflare.com)
[![DB](https://img.shields.io/badge/db-Neon%20Postgres-green)](https://neon.tech)

---

## What Is Builderforce.ai?

Builderforce.ai is a full-stack, cloud-native IDE that combines:

| Capability | Technology |
|---|---|
| **In-browser Node.js runtime** | [WebContainers](https://webcontainers.io) |
| **Code editor** | Monaco Editor + Yjs collaborative binding |
| **Terminal** | xterm.js connected to the WebContainer shell |
| **Real-time collaboration** | Yjs + Cloudflare Durable Objects WebSocket relay |
| **Project storage** | Cloudflare R2 (per-file, per-project) |
| **Relational data** | Neon Serverless Postgres |
| **AI coding assistant** | Cloudflare Workers AI / OpenRouter (streaming) |
| **In-browser LoRA training** | Transformers.js + WebGPU |
| **Agent marketplace** | Workforce Registry (publish & hire fine-tuned agents) |
| **Auth** | JWT with tenant isolation |
| **Frontend** | Next.js 15 + React 19 + TypeScript |
| **API** | Hono on Cloudflare Workers |

---

## CoderClawLink → Builderforce.ai

**CoderClawLink has been replaced by Builderforce.ai.** The orchestration portal, API, and mesh relay now live at [builderforce.ai](https://builderforce.ai) and [api.builderforce.ai](https://api.builderforce.ai). Builderforce.ai adds a browser IDE and in-browser LoRA training on top of the same orchestration API.

**CoderClaw integration:** Configure the CLI and gateway with `CODERCLAW_LINK_URL=https://api.builderforce.ai` (or use the Builderforce onboarding flow). Documentation for the API surface (auth, tenants, claws, runtime, marketplace) lives at [docs.coderclaw.ai/link/](https://docs.coderclaw.ai/link/).

---

## Product flow

The experience is built around one path from idea to execution, with an alternative path via agents:

1. **Brain Storm** — Start here. Users brainstorm in chat (no project required). Chats are ideas and plans.
2. **Execute → Project** — User turns ideas into a project: assign a chat to a project (or create a project). Same chat is now tied to that project.
3. **Transform ideas → IDE** — In the project, users get **IDE tools** (editor, terminal, AI chat with project context, Apply/Create file). They build from the same conversation.
4. **Or: Tasks & Agents** — Instead of (or in addition to) building in the IDE, users can **register or hire BuilderForce agents (Claws)**, use **Tasks / Project management**, and assign work to those agents.

So: **Brain Storm → Project → IDE** (hands-on build), or **Brain Storm → Project → Tasks + Claws** (assign to agents). Chats are unified and project-scoped; the **origin** of a chat (brainstorm, ide, project) only tells each page which tools to load.

---

## Data model & API (strategy alignment)

The schema and API are structured to match the product flow above.

| Flow step | Data model | API (api.builderforce.ai) |
|-----------|------------|---------------------------|
| **Brain Storm** (ideate) | `ide_project_chats` (origin=’brainstorm’, projectId nullable), `ide_project_chat_messages` | `GET/POST /api/brain/chats`, `PATCH /api/brain/chats/:id` (title, **projectId** = assign to project), `GET/POST .../messages`, `POST .../summarize` |
| **Execute → Project** | `projects`, chat row updated with projectId | `GET/POST /api/projects`, `PATCH /api/brain/chats/:id` with projectId |
| **Same chat in IDE** | Same `ide_project_chats` row (projectId set), `origin` unchanged | `GET /api/projects/:id/chats` (lists all chats for project), `GET /api/projects/:id/chats/:chatId` (messages + origin), `POST /api/ai/chat` (projectId → inject file tree + package.json context) |
| **IDE tools** | R2 project files, project chats | `GET/PUT/DELETE /api/ide/projects/:id/files/*`, project chats as above |
| **Tasks** (assign work) | `tasks` (projectId, assignedClawId, status, priority), `executions` | `GET/POST/PATCH/DELETE /api/tasks`, `POST /api/tasks/next`, `POST/GET /api/runtime/executions` |
| **Workforce / Claws** | `coderclaw_instances`, `claw_projects`, `agents`, `skills` | `GET/POST /api/claws`, `GET/PUT/DELETE /api/claws/:id/projects/:projectId`, `GET /api/claws/:id/assignment-context`, `PATCH /api/claws/:id/heartbeat`, `GET/POST /api/agents`, `GET/POST /api/skill-assignments/...` |

- **Unified chats:** One conversation can start in Brain (no project), be assigned to a project, then be opened in the IDE or anywhere else; **origin** tells the UI which tools to load.
- **Tasks and Claws:** Tasks belong to a project; they can be assigned to a Claw (`assignedClawId`). Executions track runs. Claws are registered per tenant and linked to projects via `claw_projects`.

### Claw assignment handshake

- `POST /api/claws` now accepts optional `machineProfile` metadata (machine name/IP, workspace/install dirs, ports, tunnel details).
- `PATCH /api/claws/:id/heartbeat` persists capability and machine profile updates.
- `GET /api/claws/:id/assignment-context` is claw-authenticated (API key) and returns:
  - claw runtime metadata,
  - assigned projects,
  - primary project context hints derived from synced `.coderclaw` files (manifest/PRD/tasks/memory paths).

This payload is consumed by coderClaw relay to keep local `.coderClaw/context.yaml` aligned with project assignment and execution context.

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
│  Workers (Hono)                 Durable Objects                   │
│  ┌────────────────────┐        ┌──────────────────────────────┐  │
│  │ /api/projects      │        │  CollaborationRoom           │  │
│  │ /api/files         │        │  - Yjs sync                  │  │
│  │ /api/ai (stream)   │        │  - Cursor presence           │  │
│  │ /api/datasets      │        │  - Terminal streaming        │  │
│  │ /api/training      │        └──────────────────────────────┘  │
│  │ /api/agents        │                                           │
│  └────────┬───────────┘                                           │
│           │                     R2 Bucket                         │
│           │                    ┌──────────────────────────────┐  │
│           └───────────────────►│ project files (per-project/) │  │
│                                │ training artifacts (adapters) │  │
│                                │ datasets (.jsonl)             │  │
│                                └──────────────────────────────┘  │
│                                                                   │
│  Neon Postgres (via HTTP driver)                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ users · tenants · projects · datasets · training_sessions   │ │
│  │ agents · ai_messages · collaboration_sessions               │ │
│  └─────────────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────────────┘
```

---

## Worker vs API (api.builderforce.ai)

The repo has **two** Cloudflare Workers that the frontend talks to:

| | **worker** (builderforce-worker) | **api** (api.builderforce.ai) |
|---|---|---|
| **Purpose** | Original Builderforce backend: IDE projects, files, datasets, training, workforce registry, AI chat. | CoderClawLink port: auth, tenants, projects/tasks, claws, brain, chat, LLM, marketplace. |
| **Auth** | None (CORS only; frontend may send Bearer but worker does not validate). | JWT + tenant isolation on protected routes. |
| **Database** | Neon Postgres (`NEON_DATABASE_URL`) — `projects`, `datasets`, `training_jobs`, etc. | Neon Postgres (`NEON_DATABASE_URL`) — Drizzle schema (tenants, **projects**, tasks, claws, etc.). **Projects are unified:** the API’s `projects` table is the single source of truth; IDE datasets/training/agents reference `projects.id`. |
| **Storage** | R2 `STORAGE` (builderforce-storage): project files (`projectId/path`), dataset JSONL, LoRA artifacts. | R2 `UPLOADS` (builderforce-uploads): brain uploads, claw-related assets. |
| **Durable Objects** | **CollaborationRoom** — WebSocket at `/api/collab/:sessionId/ws` (Yjs sync, presence, terminal). | **ClawRelayDO** — claw relay only. |
| **AI** | Workers AI binding + optional OpenRouter (`/api/ai/chat` streaming). | OpenRouter only (`/llm/v1/chat/completions`). |

**Frontend usage today:**

- **NEXT_PUBLIC_WORKER_URL** (worker): dashboard projects, project files (IDE), datasets, training (create/jobs/logs/artifact), AI chat in IDE, workforce list/hire/package, **collaboration WebSocket** (`useCollaboration.ts`).
- **NEXT_PUBLIC_AUTH_API_URL** (api): login, tenants, Brain Storm (brain + chat API), Workforce claws (list/register), Terms/Privacy, marketplace-stats.

So the **worker is not “just a REST API”**. It has:

1. **WebSocket + Durable Object** — real-time collaboration (CollaborationRoom) that the API does not provide.
2. **R2 project file storage** — IDE file read/write by `projectId/path`; API has no equivalent project-files API.
3. **Datasets + training** — R2 + Neon tables for LoRA datasets and training jobs; API has no training/dataset routes.
4. **Workers AI** — optional Cloudflare AI binding; API uses OpenRouter only.

**Consolidation:** To fold the worker into the API you would need to:

- Port worker REST routes (projects, files, datasets, training, agents) into the API and either unify with the existing API project/task/agent model or run both data models in one worker.
- Add **CollaborationRoom** DO to the API worker and expose `/api/collab/:sessionId/ws` (and optionally `/api/collab/:sessionId`) there.
- Add an R2 binding (or reuse `UPLOADS` with a prefix) for worker-style project files and dataset/artifact keys.
- Optionally add a Workers AI binding to the API if you want to keep that provider for IDE chat.

Until that consolidation is done, the worker remains the backend for IDE projects, files, training, workforce registry (list/hire), IDE AI chat, and real-time collaboration.

**Single database:** Both applications use **Neon** (different DBs today). You can consolidate to one Neon database by running the migration scripts for both schemas against the same DB; worker and API can then share one `NEON_DATABASE_URL` if you later merge code paths.

**How the frontend talks to data:** The frontend never connects to the database. It only calls the worker and the API over HTTP (`fetch`). Those two Workers are the only things that connect to Neon (and R2). So the flow is:

```
  Browser (Next.js)                    Cloudflare Workers                      Neon / R2
  ┌─────────────────┐                  ┌──────────────────────────────────┐
  │ fetch(WORKER_   │ ─── HTTP ──────► │ worker (builderforce-worker)     │ ───► Neon DB (worker schema)
  │   URL/...)      │                  │   → projects, files, datasets,    │      R2 (builderforce-storage)
  │                 │                  │     training, agents, ai/chat    │
  │ fetch(AUTH_     │ ─── HTTP ──────► │ api (api.builderforce.ai)        │ ───► Neon DB (API schema)
  │   API_URL/...)  │                  │   → auth, tenants, claws, brain,  │      R2 (builderforce-uploads)
  └─────────────────┘                  │     chat, marketplace            │
                                       └──────────────────────────────────┘
```

Moving the worker’s REST endpoints into the API is a valid choice: then the frontend would call only the API for all REST, and the worker would only be needed for the collaboration WebSocket (until that is moved into the API too).

---

## Repository Structure

```
builderforce.ai/
├── api/                         # api.builderforce.ai — CoderClawLink API (Hono on Cloudflare Workers)
│   ├── src/                     # Auth, tenants, projects, tasks, claws, marketplace, brain, etc.
│   ├── migrations/              # Drizzle/Postgres migrations
│   └── wrangler.toml            # Routes: api.builderforce.ai
│
├── frontend/                    # Next.js application (Cloudflare Worker + static assets)
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx      # Root layout: fonts, starfield, anti-FOUC theme script
│   │   │   ├── ThemeProvider.tsx  # Client island: dark/light toggle
│   │   │   ├── globals.css     # Design system: CSS variables, animations, utilities
│   │   │   ├── page.tsx        # Public landing page
│   │   │   ├── login/          # Auth pages
│   │   │   ├── register/
│   │   │   ├── dashboard/      # Project list (authenticated)
│   │   │   ├── projects/[id]/  # IDE workspace
│   │   │   ├── workforce/      # Agent marketplace
│   │   │   ├── tenants/        # Workspace management
│   │   │   └── training/       # Redirect → /projects
│   │   ├── components/
│   │   │   ├── AppShell.tsx    # Sidebar (collapsible) + TopBar + Footer for authenticated app
│   │   │   ├── Sidebar.tsx     # Main / MESH / Extensions / System nav
│   │   │   ├── TopBar.tsx      # Logo, Marketplace, theme, sign-out
│   │   │   ├── AppFooter.tsx  # Version, Terms of Use (api.builderforce.ai), Privacy
│   │   │   ├── AppHeader.tsx   # Shared sticky nav (public/legacy pages)
│   │   │   ├── IDE.tsx         # Main IDE layout orchestrator
│   │   │   ├── CodeEditor.tsx  # Monaco + Yjs binding
│   │   │   ├── FileExplorer.tsx
│   │   │   ├── EditorTabs.tsx
│   │   │   ├── Terminal.tsx    # xterm.js → WebContainer shell
│   │   │   ├── PreviewFrame.tsx # iframe for running app
│   │   │   ├── AIChat.tsx      # Streaming AI assistant
│   │   │   ├── AITrainingPanel.tsx  # WebGPU LoRA training UI
│   │   │   └── AgentPublishPanel.tsx # Publish to Workforce Registry
│   │   ├── hooks/
│   │   │   ├── useWebContainer.ts  # WebContainer lifecycle management
│   │   │   └── useCollaboration.ts # Yjs + Durable Object WebSocket
│   │   └── lib/
│   │       ├── api.ts          # All worker API calls (NEXT_PUBLIC_WORKER_URL)
│   │       ├── auth.ts         # JWT storage / parsing
│   │       ├── AuthContext.tsx # React auth context
│   │       ├── types.ts        # Shared TypeScript types
│   │       └── webgpu-trainer.ts # In-browser LoRA training engine
│   ├── next.config.js          # COOP/COEP headers (credentialless for SharedArrayBuffer)
│   ├── tailwind.config.js      # CSS variable–backed gray scale for theme
│   └── wrangler.toml           # Worker config for builderforce.ai
│
├── worker/                     # Cloudflare Worker API (Hono)
│   ├── src/
│   │   ├── index.ts            # App entry, CORS, global error handler
│   │   ├── routes/
│   │   │   ├── projects.ts     # CRUD + Vite template seeding
│   │   │   ├── files.ts        # R2 file read/write/delete
│   │   │   ├── ai.ts           # Streaming AI (Workers AI / OpenRouter)
│   │   │   ├── datasets.ts     # Dataset generation + R2 storage
│   │   │   ├── training.ts     # Training job management + R2 artifacts
│   │   │   └── agents.ts       # Workforce Registry CRUD
│   │   ├── durable-objects/
│   │   │   └── CollaborationRoom.ts  # Yjs relay + presence
│   │   └── services/
│   │       └── training.ts     # AI evaluation + artifact persistence
│   ├── schema.sql              # Full Neon Postgres schema
│   ├── scripts/migrate.ts      # Run migrations against Neon
│   └── wrangler.toml           # Worker deployment config
│
├── migrations/                 # SQL migration files
│   └── 001_create_projects.sql
└── .github/workflows/
    └── deploy-frontend.yml    # CI: API (api.builderforce.ai) + Frontend (Pages)
```

---

## Features

### ✅ Implemented

#### IDE Workspace (`/projects/[id]`)
- **Monaco Editor** with syntax highlighting, IntelliSense, and multi-file tabs
- **Collaborative editing** via Yjs bound to Monaco — real-time cursor sharing through Cloudflare Durable Objects WebSockets
- **File Explorer** — create, rename, delete files; tree view
- **xterm.js Terminal** connected to the WebContainer interactive shell (full PTY)
- **WebContainer runtime** — mounts project files into an in-browser Node.js environment; runs `npm install` then starts Vite dev server
- **Preview iframe** — live preview of the running Vite app, auto-opens after `▶ Run`
- **AI Chat Panel** — streams responses token-by-token using Cloudflare Workers AI or OpenRouter fallback; can generate/modify files
- **AI Training Panel** — in-browser LoRA fine-tuning with WebGPU (Transformers.js, up to 2B params)
- **Agent Publish Panel** — publish trained agents to the Workforce Registry with skills and eval scores

#### Authentication & Multi-Tenancy
- JWT-based auth with `Authorization: Bearer` on all API calls
- Tenant isolation (workspace scoping)
- Protected routes via Next.js middleware (`/dashboard`, `/projects/*`, `/tenants`, `/training`)

#### Project Storage (Cloudflare R2)
- Files stored as `{projectId}/{path}` objects in R2
- Fetched and mounted into WebContainer on project open
- Auto-saved on editor change via `PUT /api/projects/:id/files/:path`
- Vite template seeded on project creation (`index.html`, `src/main.jsx`, `package.json`)

#### Dataset Generation
- `POST /api/datasets` — generates JSONL instruction-tuning datasets from a capability prompt using AI
- Stored in R2; streamed back via `GET /api/datasets/:id/download`

#### LoRA Training (Browser-side)
- WebGPU-accelerated model fine-tuning using Transformers.js
- Syncs epoch progress to the worker DB (`training_sessions`)
- Serialises adapter weights from GPU buffers and uploads to R2

#### AI Evaluation
- Independent AI judge scores model outputs (correctness, reasoning, hallucination rate)
- Results stored in training session record

#### Workforce Registry (`/workforce`)
- Browse published agents by skills
- Search / filter
- "Hire" action (records hire count)
- Publish panel in the IDE to list your trained agent

#### Design System
- **CoderClaw** deep space aesthetic: Clash Display + Satoshi fonts, CSS variable tokens
- Full **light/dark** theme with localStorage persistence and anti-FOUC inline script
- Animated starfield + nebula backgrounds
- Glassmorphism cards, hover lift effects, gradient text, pulsing badge dots
- Shared `AppHeader` component used across all pages

---

## Neon Postgres Schema

```sql
-- Core
CREATE TABLE users (id UUID PRIMARY KEY, email TEXT UNIQUE, ...);
CREATE TABLE tenants (id UUID PRIMARY KEY, name TEXT, owner_id UUID REFERENCES users);
CREATE TABLE tenant_users (tenant_id UUID, user_id UUID, role TEXT);

-- Projects
CREATE TABLE projects (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner_id TEXT,
  template TEXT DEFAULT 'vanilla',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI Training
CREATE TABLE datasets (id UUID PRIMARY KEY, project_id UUID, name TEXT, file_key TEXT, ...);
CREATE TABLE ai_models (id UUID PRIMARY KEY, project_id UUID, base_model TEXT, adapter_key TEXT, ...);
CREATE TABLE training_sessions (
  id UUID PRIMARY KEY, project_id UUID, model_id UUID,
  dataset_id UUID, status TEXT, eval_score NUMERIC, ...
);

-- Workforce
CREATE TABLE agents (
  id UUID PRIMARY KEY, project_id UUID, name TEXT,
  skills TEXT[], eval_score NUMERIC, hire_count INT, status TEXT
);

-- Collaboration
CREATE TABLE collaboration_sessions (id UUID PRIMARY KEY, project_id UUID, ...);
```

See [`worker/schema.sql`](worker/schema.sql) for the full schema.

---

## Documentation

- **CoderClawLink / orchestration:** Full docs (getting started, architecture, API reference, marketplace, multi-agent, pricing) live at [docs.coderclaw.ai/link/](https://docs.coderclaw.ai/link/). Builderforce.ai’s API is a CoderClawLink-style port; use those guides for auth, tenants, projects, tasks, claws, runtime, and marketplace concepts.
- **Builderforce.ai Worker** (IDE, files, training, collaboration): see Worker API Reference below.

## Worker API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List all projects |
| `POST` | `/api/projects` | Create project (seeds Vite template into R2) |
| `GET` | `/api/projects/:id` | Get project by ID |
| `PUT` | `/api/projects/:id` | Update project metadata |
| `DELETE` | `/api/projects/:id` | Delete project |
| `GET` | `/api/projects/:id/files` | List project files from R2 |
| `GET` | `/api/projects/:id/files/:path` | Read file content from R2 |
| `PUT` | `/api/projects/:id/files/:path` | Write/create file in R2 |
| `DELETE` | `/api/projects/:id/files/:path` | Delete file from R2 |
| `POST` | `/api/ai/chat` | Streaming AI chat (Workers AI / OpenRouter) |
| `POST` | `/api/datasets` | Generate JSONL dataset from capability prompt |
| `GET` | `/api/datasets/:id` | Get dataset metadata |
| `GET` | `/api/datasets/:id/download` | Download JSONL from R2 |
| `POST` | `/api/training` | Create training job |
| `GET` | `/api/training/:id` | Get training job status |
| `PATCH` | `/api/training/:id/status` | Update job status/progress |
| `POST` | `/api/training/:id/artifact` | Upload LoRA adapter blob to R2 |
| `GET` | `/api/agents` | List published agents (Workforce Registry) |
| `POST` | `/api/agents` | Publish agent |
| `POST` | `/api/agents/:id/hire` | Record agent hire |
| `GET/POST` | `/api/collab/:sessionId/ws` | WebSocket → Durable Object collaboration room |

**Error format** (all 5xx): `{ error: string, details: { message, stack, route, method, timestamp } }`

---

## Environment Variables

### Frontend (`frontend/.env.local`)

```bash
NEXT_PUBLIC_WORKER_URL=http://localhost:8787   # Worker API base URL
```

> **Important:** Must be set during `next build` to be baked into the static output.

### Worker (`worker/.env` or Wrangler secrets)

```bash
NEON_DATABASE_URL=postgresql://...            # Neon connection string
OPENROUTER_API_KEY=sk-or-...                  # Optional: OpenRouter fallback AI
AI_PROVIDER=cloudflare                        # "cloudflare" | "openrouter" | "ab"
```

Workers also need Wrangler bindings:
- `STORAGE` — R2 bucket binding
- `AI` — Workers AI binding
- `COLLABORATION_ROOM` — Durable Object namespace

---

## Local Development

### Prerequisites
- Node.js 20+
- Wrangler CLI (`npm i -g wrangler`)
- A Neon Postgres database
- (Optional) Cloudflare account for R2 / Workers AI

### 1. Clone & install

```bash
git clone https://github.com/your-org/builderforce.ai
cd builderforce.ai

# Install frontend deps
cd frontend && npm install && cd ..

# Install worker deps
cd worker && npm install && cd ..
```

### 2. Configure environment

```bash
# frontend/.env.local
echo "NEXT_PUBLIC_WORKER_URL=http://localhost:8787" > frontend/.env.local

# worker/.env
echo "NEON_DATABASE_URL=postgresql://user:pass@host/db" > worker/.env
```

### 3. Run migrations

```bash
cd worker && npm run migrate
```

### 4. Start the worker

```bash
cd worker && npx wrangler dev
```

### 5. Start the frontend

```bash
cd frontend && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Deployment

### API (api.builderforce.ai)

```bash
cd api
# From api/.env, push all secrets to the Worker in one go:
npm run secrets:from-env

# Or set individually:
# npx wrangler secret put NEON_DATABASE_URL
# npx wrangler secret put JWT_SECRET
# npx wrangler secret put OPENROUTER_API_KEY   # required for IDE AI chat (get key at openrouter.ai)
npm run deploy   # runs migrate then wrangler deploy
```

Project chat endpoints (`GET/POST /api/projects/:id/chats`, etc.) and IDE AI with project context require the latest API code and migrations. If you see **404 on POST /api/projects/:id/chats**, redeploy the API and ensure migration `0025_ide_project_chats.sql` has been applied.

For CoderClawLink-style API concepts (auth, tenants, claws, runtime, marketplace), see [docs.coderclaw.ai/link/](https://docs.coderclaw.ai/link/) (getting started, architecture, API reference, multi-agent orchestration, pricing).

### Frontend (Cloudflare Worker)

Build uses `NEXT_PUBLIC_WORKER_URL` (production: `https://worker.builderforce.ai`).

Production host ownership is explicit:
- `builderforce.ai` → frontend worker
- `www.builderforce.ai` → frontend worker
- `api.builderforce.ai` → API worker
- `worker.builderforce.ai` → legacy IDE/data worker

### CI/CD (push to `main`)

The `.github/workflows/deploy-frontend.yml` workflow deploys both:

1. **API** — `api/`: runs migrations (requires `NEON_DATABASE_URL`) then `wrangler deploy` to api.builderforce.ai
2. **Frontend** — `frontend/`: Next.js build → `@cloudflare/next-on-pages` → `wrangler deploy`

Required GitHub Actions secrets:
- `CF_API_TOKEN` — Cloudflare API token
- `CF_ACCOUNT_ID` — Cloudflare account ID
- `NEON_DATABASE_URL` — Neon Postgres URL (for API migrations in CI; set via wrangler for deployed worker)

---

## Browser Requirements

| Feature | Required Browser API |
|---|---|
| WebContainers | Chrome 90+, Edge 90+ (requires COOP + COEP headers) |
| WebGPU training | Chrome 113+ with `chrome://flags/#enable-webgpu` |
| SharedArrayBuffer | COOP: `same-origin` + COEP: `credentialless` |
| Collaborative editing | Any modern browser |

> **Note:** Firefox and Safari do not support WebContainers. Safari lacks WebGPU. Chrome is the recommended browser.

---

## Design System

The UI follows the **CoderClaw deep space** aesthetic:

| Token | Dark | Light |
|---|---|---|
| `--bg-deep` | `#050810` | `#fcfeff` |
| `--bg-surface` | `#0a0f1a` | `#ffffff` |
| `--coral-bright` | `#4d9eff` | `#3b82f6` |
| `--cyan-bright` | `#00e5cc` | `#008f87` |
| `--text-primary` | `#f0f4ff` | `#0b1220` |
| `--font-display` | Clash Display | Clash Display |
| `--font-body` | Satoshi | Satoshi |

Theme is stored in `localStorage('bf-theme')` and applied before first paint via an inline `<script>` in `<head>` to prevent flash.

---

## Roadmap

- [ ] **Authentication hardening** — proper OAuth (GitHub/Google)
- [ ] **File versioning** — R2 object versioning + `file_versions` table
- [ ] **Template gallery** — React, Vue, Express, Python starters
- [ ] **Live share links** — shareable collaboration URLs
- [ ] **Agent API keys** — let hired agents be called via REST
- [ ] **Mobile layout** — responsive IDE for tablet use
- [ ] **WebGPU fallback** — CPU training path for non-Chrome browsers
- [ ] **Billing** — usage-based credits for AI and storage

---

## License

MIT — see [LICENSE](LICENSE).
