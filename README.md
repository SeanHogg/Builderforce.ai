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

## Repository Structure

```
builderforce.ai/
├── frontend/                   # Next.js application (Cloudflare Pages)
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
│   │   │   ├── AppHeader.tsx   # Shared sticky nav (claw logo, theme toggle)
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
│   └── wrangler.toml           # Pages deployment config
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
    ├── deploy-frontend.yml     # CI: next build → Cloudflare Pages
    └── deploy-worker.yml       # CI: wrangler deploy (with migrate predeploy)
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
- Vite template seeded on project creation (`index.html`, `src/main.js`, `package.json`)

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

### Worker

```bash
cd worker
npx wrangler secret put NEON_DATABASE_URL
npx wrangler secret put OPENROUTER_API_KEY   # optional
npm run deploy   # runs migrate then wrangler deploy
```

### Frontend (Cloudflare Pages)

Set these GitHub Actions secrets in your repo:
- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`
- `NEXT_PUBLIC_WORKER_URL` → your deployed worker URL

Push to `main` — the `.github/workflows/deploy-frontend.yml` workflow builds and deploys automatically.

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
