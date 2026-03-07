<p align="center">
  <img src="https://github.com/user-attachments/assets/40bc436d-a042-47ca-83c3-25b5a10ae9b4" alt="Builderforce.ai — Decentralized Agent Workforce Platform" width="600" />
</p>

<h1 align="center">Builderforce.ai</h1>

<p align="center">
  <strong>Decentralized Agent Workforce Platform</strong><br/>
  Build your own LLM. Train your own Agent. Register it into the Workforce.
</p>

---

## Vision

**Builderforce.ai** is the platform where developers build, train, and deploy custom AI agents — then register them into a decentralized workforce that powers real products.

We believe the future of software is **agent-native**: every application will have an AI brain capable of reasoning, planning, and acting autonomously. Builderforce gives every developer the tools to build that brain directly in the browser, with no infrastructure overhead.

### Core Pillars

| Pillar | Description |
|--------|-------------|
| 🧠 **Build** | Fine-tune a custom LLM in the browser using WebGPU LoRA training on your own datasets |
| 🤖 **Agent** | Wrap your model in an autonomous agent with tools, memory, and decision-making capabilities |
| 🌐 **Register** | Publish your agent to the Builderforce Workforce Registry for integration into any platform |
| ⚡ **Deploy** | Power real products — starting with [CoderClaw](https://github.com/SeanHogg/coderClaw) |

---

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the full Go-to-Market Strategy and phased rollout plan.

### Key Differentiators

- **Human-in-the-loop LLM** — train a model on your own expertise and embed yourself into the agentic workforce
- **Build-to-deploy in the browser** — no local GPU, no cloud account required
- **You own your model** — fine-tuned weights are yours, stored in your own Cloudflare R2
- **CoderClaw technology embedding** — your trained agent is embedded directly into CoderClaw for real production impact
- **Decentralized registry** — agents are registered once and usable everywhere
- **Real product integration** — not a demo platform; agents power production products like CoderClaw

---

## CoderClaw Integration

[**CoderClaw**](https://github.com/SeanHogg/coderClaw) is the first production application powered by a Builderforce-trained agent.

Developers use Builderforce.ai to:
1. **Train** a custom coding/reasoning LLM on their codebase patterns, code review guidelines, and best practices
2. **Wrap** it as an autonomous coding agent with the ability to read files, propose changes, and run evaluations
3. **Register** the agent in the Builderforce Workforce Registry
4. **Connect** CoderClaw to that registered agent — the agent becomes CoderClaw's internal AI brain

This end-to-end loop — **build → train → register → integrate** — is the core workflow that Builderforce.ai is designed to support.

```
Developer  ──builds──►  Custom LLM  ──trains──►  Agent
                                                    │
                                              Register in
                                           Workforce Registry
                                                    │
                                                    ▼
                                             CoderClaw 🦀
                                         (and any future product)
```

---

## Human-in-the-Loop

A core differentiator of Builderforce.ai is the **human-in-the-loop** model. Unlike generic AI agents that run on foundation models with no personalization, Builderforce allows any user to:

1. **Encode their own expertise** — curate instruction-tuning datasets from their codebase, documentation, past decisions, and domain knowledge
2. **Fine-tune a personal LLM** — run LoRA training in the browser to produce a model that reasons like *them*
3. **Embed themselves as an agent** — wrap the trained model in an autonomous agent using **CoderClaw technology**, giving the user a persistent AI representative that acts on their behalf
4. **Register into the workforce** — publish the agent to the Builderforce Workforce Registry so it can be integrated into any CoderClaw-powered product or third-party platform

This means developers and domain experts can effectively *register themselves into the agentic workforce* — their knowledge and decision-making style encoded once, then working autonomously at machine speed across all integrated products.

### Why human-in-the-loop matters

| Approach | Generic AI | Builderforce Agent |
|---|---|---|
| Model | Shared foundation model | Your fine-tuned personal LLM |
| Knowledge | General | Domain-specific to you |
| Behaviour | Unpredictable | Aligned to your patterns |
| Ownership | Vendor-controlled | You own the weights |
| Integration | Prompt engineering only | Embedded via CoderClaw technology |

---

## Target Markets

### Primary — AI Developers & Independent Builders

Developers who want to create specialized AI agents without managing infrastructure. Builderforce provides the full stack: dataset curation, browser-based LoRA fine-tuning, agent wrapping, and workforce registration — all without a cloud account or local GPU.

### Secondary — Domain Experts

Professionals in any field (engineering, law, medicine, finance) who want to encode their expertise into a custom model. Builderforce lets them train on their own data and deploy an autonomous representative that works on their behalf.

### Tertiary — Product Teams & Enterprises

Companies that want to integrate battle-tested domain-specific agents into their products without building an ML team. The Workforce Registry provides a marketplace of production-ready agents that can be consumed via API.

### First Vertical — Developer Tooling (CoderClaw)

[CoderClaw](https://github.com/SeanHogg/coderClaw) is the first vertical: an AI-powered code review and automation tool. Builderforce-trained agents are embedded into CoderClaw to provide personalised code review, automated refactoring, and codebase-specific reasoning — powered by each developer's own fine-tuned model.

---

## Platform Overview

A **browser-based AI coding platform** (Replit / AI Studio style) with **full AI-to-AI model training capabilities**, built on a **Cloudflare-first architecture**. Users can code, collaborate in real time, and fine-tune their own AI coding/reasoning models directly in the browser — leveraging **WebContainers**, **WebGPU LoRA training**, **Cloudflare R2 + Workers**, and **Neon Postgres**.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│                              Browser                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  ┌─────────────┐  │
│  │  Next.js UI  │  │ WebContainer │  │ WebGPU   │  │  Yjs collab │  │
│  │  (React/TS)  │  │  Node.js env │  │ LoRA     │  │  y-websocket│  │
│  │              │  │              │  │ Trainer  │  │             │  │
│  └──────┬───────┘  └──────┬───────┘  └────┬─────┘  └──────┬──────┘  │
└─────────┼────────────────┼───────────────┼───────────────┼──────────┘
          │  HTTP / SSE    │               │ artifacts      │ WebSocket
          ▼                │               ▼                ▼
┌─────────────────────┐    │   ┌──────────────────────────────────────┐
│  Cloudflare Worker  │    │   │        Durable Objects               │
│  (Hono.js REST API) │    │   │  CollaborationRoom                   │
│                     │    │   │  (Yjs broadcast, presence, terminal) │
│  /api/projects      │    │   └──────────────────────────────────────┘
│  /api/files         │    │
│  /api/ai/chat       │    │
│  /api/datasets      │    │
│  /api/training      │    │
│  /api/collab        │    │
└──────────┬──────────┘    │
           │               │
   ┌───────┴────────┐      │
   │                │      │
   ▼                ▼      ▼
┌──────┐  ┌────────────────────────┐
│ Neon │  │    Cloudflare R2       │
│  PG  │  │  project files         │
│      │  │  datasets (.jsonl)     │
│      │  │  model artifacts       │
└──────┘  └────────────────────────┘
```

---

## Features

### Frontend

| Feature | Details |
|---------|---------|
| **Framework** | Next.js 15 + React 18 + TypeScript |
| **Styling** | Tailwind CSS |
| **Code Editor** | Monaco Editor with syntax highlighting for 15+ languages |
| **Terminal** | xterm.js with fit & web-links addons, running inside WebContainer |
| **File Explorer** | Tree view with create / delete, nested directories |
| **Editor Tabs** | Multi-tab editing with close button |
| **Preview** | Live iframe preview of the running WebContainer dev server |
| **AI Chat** | Streaming AI assistant panel (Cloudflare Workers AI / OpenRouter) |
| **AI Training Panel** | Full model training UI — see [AI Model Training](#ai-model-training) |
| **Collaboration** | Yjs + y-websocket + y-monaco for real-time multi-cursor editing |

### Browser Runtime (WebContainers)

When a project opens and **Run** is clicked:
1. Fetches all project files from Cloudflare R2 via the Worker API.
2. Mounts them into a **WebContainer** instance running inside the browser.
3. Runs `npm install` (if `package.json` is present) and streams output to the terminal.
4. Starts the dev server (`npm run dev`) and displays the running app in the preview iframe.
5. All subsequent file saves are synced back to R2 automatically.

### Backend (Cloudflare Workers)

#### Existing endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/projects` | GET | List all projects |
| `/api/projects` | POST | Create a project (seeds starter files in R2) |
| `/api/projects/:id` | GET / PUT / DELETE | Read / update / delete a project |
| `/api/projects/:id/files` | GET | List project files |
| `/api/projects/:id/files/*` | GET / PUT / DELETE | Read / write / delete a file |
| `/api/ai/chat` | POST | Streaming AI chat (SSE) |
| `/api/collab/:sessionId/ws` | WS | WebSocket collaboration endpoint |

#### AI training endpoints (new)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/datasets` | GET | List datasets for a project (`?projectId=`) |
| `/api/datasets/:id` | GET | Get a single dataset |
| `/api/datasets/generate` | POST | Generate an instruction-tuning dataset (SSE stream) |
| `/api/training` | GET | List training jobs for a project (`?projectId=`) |
| `/api/training` | POST | Create a new training job |
| `/api/training/:id` | GET | Get a training job |
| `/api/training/:id` | PUT | Update job status / progress |
| `/api/training/:id/logs` | GET | Get all logs for a job |
| `/api/training/:id/logs` | POST | Append a log entry |
| `/api/training/:id/logs/stream` | GET | Stream live training logs (SSE) |
| `/api/training/:id/evaluate` | POST | AI-judge evaluation of fine-tuned model |

### Storage (Cloudflare R2)

| Path pattern | Contents |
|---|---|
| `{projectId}/{filePath}` | Project source files |
| `datasets/{projectId}/{datasetId}.jsonl` | Generated training datasets (JSONL) |
| `artifacts/{projectId}/{jobId}/adapter.bin` | LoRA adapter weights / metadata |

### Database (Neon serverless Postgres)

```sql
users                  -- platform users
projects               -- project metadata (owner, template, timestamps)
project_members        -- per-project access roles
ai_messages            -- persisted AI conversation history
collaboration_sessions -- WebSocket session audit log
file_versions          -- historical file snapshots
datasets               -- dataset metadata (capability prompt, example count, R2 key, status)
training_jobs          -- training job config & progress (model, LoRA params, loss, status)
training_logs          -- per-step training log entries (epoch, step, loss, message)
model_artifacts        -- completed adapter metadata (R2 key, eval score)
```

### Realtime (Cloudflare Durable Objects)

`CollaborationRoom` Durable Object handles:
- Broadcasting **Yjs** binary document updates to all connected peers.
- **Presence** messages (name, cursor colour).
- **Terminal I/O** streaming between collaborators.
- Automatic cleanup on disconnect.

### AI providers

| Provider | Used for | Config |
|---|---|---|
| **Cloudflare Workers AI** (`@cf/meta/llama-3.1-8b-instruct`) | AI chat (default), dataset generation fallback | `AI_PROVIDER=cloudflare` |
| **OpenRouter** (6 free models, round-robin with 429 failover) | AI chat, dataset generation, evaluation | `AI_PROVIDER=openrouter` + `OPENROUTER_API_KEY` |
| **A/B mode** | 50/50 random split for validation | `AI_PROVIDER=ab` |

---

## AI Model Training

The **AI Training Panel** (right-hand tab in the IDE, labelled 🧠 Train) enables users to fine-tune language models for coding and reasoning without leaving the browser.

### Workflow

```
1. Describe capability  →  AI generates JSONL dataset  →  stored in R2
2. Configure LoRA params  →  Start training
3. Training runs in-browser via WebGPU (models ≤2B) or cloud offload (>2B)
4. Live loss curve + log stream displayed in the panel (and mirrored to terminal)
5. Evaluate fine-tuned model  →  AI judge scores it  →  result stored in Postgres
6. Identify weaknesses  →  re-generate targeted examples  →  retrain
```

### Supported models

| Model | Parameters | Task | Backend |
|---|---|---|---|
| GPT-NeoX 20M | 20M | Tiny reasoning (browser testing) | WebGPU |
| CodeParrot 110M | 110M | Python coding | WebGPU |
| GPT-Neo 125M | 125M | General reasoning | WebGPU |
| CodeParrot 350M / CodeGen 350M / GPT-Neo 350M | 350M | Coding / reasoning | WebGPU |
| SantaCoder 1B / StarCoder 1B | 1B | Coding + reasoning | WebGPU |
| MPT-1B / MPT-1B-Instruct / OpenAssistant 1B | 1B | Instruction-following & reasoning | WebGPU |
| MPT-1.3B | 1.3B | Instruction-following & reasoning | WebGPU |
| CodeGen 2B / StarCoder 2B | 2B | Full coding + reasoning (LoRA) | WebGPU |
| Models > 2B | > 2B | Any | Cloud GPU offload |

### Training parameters

| Parameter | Default | Range | Description |
|---|---|---|---|
| LoRA rank | 8 | 1–64 | Rank of the low-rank adapter matrices |
| Epochs | 3 | 1–20 | Full passes over the dataset |
| Batch size | 4 | 1–32 | Examples per gradient step |
| Learning rate | 0.0002 | 1e-6–0.01 | Optimiser step size |
| Precision | float16 | float16 / int8 | Tensor precision |
| Gradient accumulation | auto | — | `TARGET_EFFECTIVE_BATCH=16 / batchSize` |

### WebGPU trainer (`frontend/src/lib/webgpu-trainer.ts`)

- Requests a `high-performance` GPU adapter at training start.
- Allocates real `GPUBuffer` objects for LoRA A/B adapter matrices.
- Runs a training loop with per-step loss simulation and gradient accumulation.
- Yields to the browser event loop each step so the UI remains responsive.
- Streams every step via `onStep` callback (drives the live loss curve).
- On completion, emits an R2 artifact key via `onComplete`.
- `stop()` / `destroy()` cleanly release GPU resources.

> **Note:** The current trainer simulates the forward/backward pass with a realistic decaying loss curve while running real `GPUBuffer` allocations to verify WebGPU availability. A production implementation would add full transformer compute shaders and real tokenised data from R2.

### Dataset generation (`worker/src/services/dataset.ts`)

- Sends a structured system prompt and capability description to OpenRouter / Cloudflare AI.
- Parses the JSON array response, filtering out malformed or empty examples.
- Serialises to JSONL and stores in R2 at `datasets/{projectId}/{datasetId}.jsonl`.
- Returns example count and R2 key; metadata recorded in Postgres `datasets` table.

### Evaluation engine (`worker/src/services/training.ts`)

- Samples up to 5 examples from the linked dataset.
- Sends actual vs expected outputs to an AI judge (OpenRouter / Cloudflare AI).
- Parses JSON scores: `score`, `code_correctness`, `reasoning_quality`, `hallucination_rate` — all clamped to [0, 1].
- Stores evaluation result in R2 artifact + `model_artifacts` Postgres table.
- Falls back to neutral scores (0.5) if the AI provider is unavailable.

---

## Project Structure

```
Builderforce.ai/
├── frontend/                       # Next.js application
│   ├── src/
│   │   ├── app/                    # Next.js App Router pages
│   │   │   ├── page.tsx            # Project list / home page
│   │   │   └── projects/[id]/      # IDE page
│   │   ├── components/
│   │   │   ├── IDE.tsx             # Main IDE layout (tabbed right panel)
│   │   │   ├── FileExplorer.tsx
│   │   │   ├── EditorTabs.tsx
│   │   │   ├── CodeEditor.tsx      # Monaco + Yjs binding
│   │   │   ├── Terminal.tsx        # xterm.js panel
│   │   │   ├── AIChat.tsx          # Streaming AI chat
│   │   │   ├── AITrainingPanel.tsx # AI model training UI (new)
│   │   │   └── PreviewFrame.tsx
│   │   ├── hooks/
│   │   │   ├── useWebContainer.ts  # WebContainer lifecycle
│   │   │   └── useCollaboration.ts # Yjs + y-websocket
│   │   └── lib/
│   │       ├── api.ts              # Typed Worker API client (projects, files, AI, datasets, training)
│   │       ├── types.ts            # Shared TypeScript types (incl. training types + SUPPORTED_MODELS)
│   │       ├── webgpu-trainer.ts   # WebGPU LoRA training engine (new)
│   │       └── utils.ts            # Language detection, file tree helpers
│   └── next.config.js              # COOP / COEP headers (required for WebContainers + WebGPU)
│
└── worker/                         # Cloudflare Worker
    ├── src/
    │   ├── index.ts                # Hono app + route registration
    │   ├── routes/
    │   │   ├── projects.ts         # Project CRUD + template seeding
    │   │   ├── files.ts            # File CRUD (R2)
    │   │   ├── ai.ts               # AI streaming chat
    │   │   ├── datasets.ts         # Dataset CRUD + AI generation SSE (new)
    │   │   └── training.ts         # Training job CRUD + log streaming + evaluation (new)
    │   ├── services/
    │   │   ├── ai.ts               # Multi-provider AI (Cloudflare, OpenRouter, A/B)
    │   │   ├── dataset.ts          # Dataset generation + R2 storage (new)
    │   │   └── training.ts         # Evaluation engine + artifact saving (new)
    │   └── durable-objects/
    │       └── CollaborationRoom.ts
    ├── schema.sql                  # Neon Postgres DDL (incl. new training tables)
    └── wrangler.toml               # Cloudflare bindings config
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- Cloudflare account with R2, Workers AI, and Durable Objects enabled
- [Neon](https://neon.tech) serverless Postgres project

### 1. Clone & install

```bash
git clone https://github.com/SeanHogg/Builderforce.ai
cd Builderforce.ai

# Frontend
cd frontend && npm install

# Worker
cd ../worker && npm install
```

### 2. Set up Neon Postgres

Create a Neon project, then run the full schema (includes new training tables):

```bash
psql "$NEON_DATABASE_URL" -f worker/schema.sql
```

Set the connection string as a Wrangler secret:

```bash
cd worker
wrangler secret put NEON_DATABASE_URL
# Paste your Neon connection string when prompted
```

### 3. Configure Cloudflare R2

```bash
wrangler r2 bucket create builderforce-storage
```

### 4. (Optional) Enable OpenRouter for dataset generation

```bash
wrangler secret put OPENROUTER_API_KEY
# Paste your OpenRouter API key when prompted

# Switch AI provider:
# Edit wrangler.toml and set AI_PROVIDER = "openrouter" or "ab"
```

### 5. Run locally

```bash
# Terminal 1 – Worker (port 8787)
cd worker && npm run dev

# Terminal 2 – Frontend (port 3000)
cd frontend && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 6. Deploy

```bash
# Deploy the Worker
cd worker && npm run deploy

# Build & deploy the frontend (Cloudflare Pages, Vercel, etc.)
cd frontend && npm run build
```

Set `NEXT_PUBLIC_WORKER_URL` to your deployed Worker URL in your hosting environment.

---

## Environment Variables

### Frontend (`frontend/.env.local`)

```env
NEXT_PUBLIC_WORKER_URL=http://localhost:8787
```

### Worker (via `wrangler secret put`)

```
NEON_DATABASE_URL      # Neon serverless Postgres connection string (required)
OPENROUTER_API_KEY     # OpenRouter API key (optional — enables openrouter/ab modes)
```

Cloudflare bindings (`wrangler.toml`):
- `STORAGE` — R2 bucket for project files, datasets, and model artifacts
- `AI` — Workers AI binding (used in `cloudflare` and `ab` modes)
- `COLLABORATION_ROOM` — Durable Object namespace

`AI_PROVIDER` var in `wrangler.toml`:
- `"cloudflare"` (default) — Cloudflare Workers AI
- `"openrouter"` — OpenRouter free-model pool (requires `OPENROUTER_API_KEY`)
- `"ab"` — 50/50 random split for A/B validation (requires both configured)

---

## How It Works

### Opening a Project
1. Project metadata fetched from Neon Postgres via the Worker.
2. IDE page renders with an empty WebContainer and the file list from R2.

### Running a Project
1. All file contents fetched from R2 and mounted into WebContainer.
2. `npm install` executed inside WebContainer (output streamed to terminal).
3. `npm run dev` starts the dev server; preview iframe opens on the server-ready URL.

### Saving Files
Every editor change triggers an auto-save to R2 via `PUT /api/projects/:id/files/*`.

### Real-time Collaboration
- On IDE load a Yjs document is created and connected via `y-websocket` to the Durable Object.
- Yjs binary updates are broadcast to all peers in the same session.
- Monaco is bound to the Yjs document via `y-monaco` for cursor-aware co-editing.

### AI Chat
Messages sent to `/api/ai/chat` which calls Workers AI with the full conversation history. Response streamed as SSE and appended token-by-token to the chat panel.

### AI Model Training (new)

1. **Generate dataset** — User enters a capability prompt in the 🧠 Train panel and clicks *Generate*. The Worker calls OpenRouter (or Cloudflare AI fallback) to produce a structured JSONL dataset, stores it in R2, and records metadata in Postgres. The response is streamed token-by-token via SSE.

2. **Configure & start training** — User selects a base model, adjusts LoRA rank / epochs / batch size / learning rate, optionally links a dataset, and clicks *Start Training*.
   - Models ≤ 2B parameters: `WebGPUTrainer` requests a high-performance GPU adapter, allocates LoRA adapter `GPUBuffer` objects, and runs the training loop in-browser.
   - Models > 2B parameters: job queued for cloud GPU offload orchestrated via Cloudflare Workers.

3. **Monitor progress** — Live loss curve and log stream update in the panel; logs are also piped to the IDE terminal panel (purple `[Train]` prefix).

4. **Evaluate** — Clicking *Evaluate* on a completed job sends sampled dataset examples + model outputs to an AI judge via the Worker. Scores (overall, code correctness, reasoning quality, hallucination rate) are returned, stored in the `model_artifacts` table, and displayed in the terminal.

5. **Iterate** — User can generate a refined dataset targeting identified weaknesses, create a new training job, and repeat until quality thresholds are met.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 18, TypeScript, Tailwind CSS |
| Code Editor | Monaco Editor, Yjs, y-monaco |
| Terminal | xterm.js |
| Browser Runtime | WebContainers API |
| In-browser Training | WebGPU API (LoRA fine-tuning) |
| Backend | Cloudflare Workers, Hono.js |
| Realtime | Cloudflare Durable Objects, WebSockets |
| Storage | Cloudflare R2 (files, datasets, artifacts) |
| AI (inference) | Cloudflare Workers AI (Llama 3.1 8B) |
| AI (dataset gen / eval) | OpenRouter free-model pool |
| Database | Neon serverless Postgres |
| Collaboration | Yjs, y-websocket |

---

## Tests

```bash
# Worker (76 tests — routes, services, durable objects)
cd worker && npm test

# Frontend (48 tests — API client, utilities)
cd frontend && npm test
```

---

## License

[MIT](LICENSE)


---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│                        Browser                             │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Next.js UI  │  │ WebContainer │  │  Yjs (collab)    │  │
│  │ (React/TS)  │  │ Node.js env  │  │  y-websocket     │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘  │
└─────────┼────────────────┼───────────────────┼────────────┘
          │   HTTP/Stream  │                   │ WebSocket
          ▼                │                   ▼
┌─────────────────────┐    │    ┌──────────────────────────┐
│  Cloudflare Worker  │    │    │  Durable Objects         │
│  (Hono.js REST API) │    │    │  CollaborationRoom       │
│                     │    │    │  (Yjs broadcast,         │
│  ├── /api/projects  │    │    │   presence, terminal)    │
│  ├── /api/files     │    │    └──────────────────────────┘
│  ├── /api/ai/chat   │    │
│  └── /api/collab    │    │
└──────────┬──────────┘    │
           │               │
   ┌───────┴────────┐      │
   │                │      │
   ▼                ▼      │
┌──────┐  ┌──────────────┐ │
│ Neon │  │ Cloudflare   │ │
│ PG   │  │ R2 (files)   │◄┘
│      │  │ Workers AI   │
└──────┘  └──────────────┘
```

---

## Features

### Frontend
| Feature | Details |
|---------|---------|
| **Framework** | Next.js 15 + React 18 + TypeScript |
| **Styling** | Tailwind CSS |
| **Code Editor** | Monaco Editor (`@monaco-editor/react`) with syntax highlighting for 15+ languages |
| **Terminal** | xterm.js (`@xterm/xterm`) with fit & web-links addons, running inside WebContainer |
| **File Explorer** | Tree view with create / delete, nested directories |
| **Editor Tabs** | Multi-tab editing with close button |
| **Preview** | Live iframe preview of the running WebContainer dev server |
| **AI Chat** | Streaming AI assistant panel powered by Cloudflare Workers AI |
| **Collaboration** | Yjs + `y-websocket` + `y-monaco` for real-time multi-cursor editing |

### Browser Runtime (WebContainers)
When a project opens and **Run** is clicked the IDE:
1. Fetches all project files from Cloudflare R2 via the Worker API.
2. Mounts them into a **WebContainer** instance running inside the browser.
3. Runs `npm install` (if `package.json` is present) and streams output to the terminal.
4. Starts the dev server (`npm run dev`) and displays the running app in the preview iframe.
5. All subsequent file saves are synced back to R2 automatically.

### Backend (Cloudflare Workers)
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/projects` | GET | List all projects |
| `/api/projects` | POST | Create a project (seeds starter files in R2) |
| `/api/projects/:id` | GET/PUT/DELETE | Read / update / delete a project |
| `/api/projects/:id/files` | GET | List project files |
| `/api/projects/:id/files/*` | GET/PUT/DELETE | Read / write / delete a file |
| `/api/ai/chat` | POST | Streaming AI chat (SSE) |
| `/api/collab/:sessionId/ws` | WS | WebSocket collaboration endpoint |

### Storage (Cloudflare R2)
- All project files are stored under the key `{projectId}/{filePath}`.
- Files are fetched on demand and synced back on every editor save.

### Database (Neon serverless Postgres)
```sql
users                  -- platform users
projects               -- project metadata (owner, template, timestamps)
project_members        -- per-project access roles
ai_messages            -- persisted AI conversation history
collaboration_sessions -- WebSocket session audit log
file_versions          -- historical file snapshots
```

### Realtime (Cloudflare Durable Objects)
`CollaborationRoom` Durable Object handles:
- Broadcasting **Yjs** binary document updates to all connected peers.
- **Presence** messages (name, cursor colour).
- **Terminal I/O** streaming between collaborators.
- Automatic cleanup on disconnect.

### AI (Cloudflare Workers AI)
- Model: `@cf/meta/llama-3.1-8b-instruct`
- System-prompt primed as an expert coding assistant.
- Responses streamed token-by-token (SSE) to the AI chat panel.

---

## Project Structure

```
Builderforce.ai/
├── frontend/                  # Next.js application
│   ├── src/
│   │   ├── app/               # Next.js App Router pages
│   │   │   ├── page.tsx       # Project list / home page
│   │   │   └── projects/[id]/ # IDE page
│   │   ├── components/
│   │   │   ├── IDE.tsx        # Main IDE layout
│   │   │   ├── FileExplorer.tsx
│   │   │   ├── EditorTabs.tsx
│   │   │   ├── CodeEditor.tsx # Monaco + Yjs binding
│   │   │   ├── Terminal.tsx   # xterm.js panel
│   │   │   ├── AIChat.tsx     # Streaming AI chat
│   │   │   └── PreviewFrame.tsx
│   │   ├── hooks/
│   │   │   ├── useWebContainer.ts  # WebContainer lifecycle
│   │   │   └── useCollaboration.ts # Yjs + y-websocket
│   │   └── lib/
│   │       ├── api.ts         # Typed Worker API client
│   │       └── types.ts       # Shared TypeScript types
│   └── next.config.js         # COOP / COEP headers (required for WebContainers)
│
└── worker/                    # Cloudflare Worker
    ├── src/
    │   ├── index.ts           # Hono app, file routes, collab routes
    │   ├── routes/
    │   │   ├── projects.ts    # Project CRUD + template seeding
    │   │   ├── files.ts       # File CRUD (R2)
    │   │   └── ai.ts          # AI streaming chat
    │   └── durable-objects/
    │       └── CollaborationRoom.ts
    ├── schema.sql             # Neon Postgres DDL
    └── wrangler.toml          # Cloudflare bindings config
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm i -g wrangler`)
- Cloudflare account with R2, Workers AI, and Durable Objects enabled
- [Neon](https://neon.tech) serverless Postgres project

### 1. Clone & install

```bash
git clone https://github.com/SeanHogg/Builderforce.ai
cd Builderforce.ai

# Frontend
cd frontend && npm install

# Worker
cd ../worker && npm install
```

### 2. Set up Neon Postgres

Create a Neon project, then run the schema:

```bash
psql "$NEON_DATABASE_URL" -f worker/schema.sql
```

Set the connection string as a Wrangler secret:

```bash
cd worker
wrangler secret put NEON_DATABASE_URL
# Paste your Neon connection string when prompted
```

### 3. Configure Cloudflare R2

Create an R2 bucket named `builderforce-storage` (or update `wrangler.toml`):

```bash
wrangler r2 bucket create builderforce-storage
```

### 4. Run locally

```bash
# Terminal 1 – Worker (port 8787)
cd worker && npm run dev

# Terminal 2 – Frontend (port 3000)
cd frontend && npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Deploy

```bash
# Deploy the Worker
cd worker && npm run deploy

# Build & deploy the frontend (Cloudflare Pages, Vercel, etc.)
cd frontend && npm run build
```

Set `NEXT_PUBLIC_WORKER_URL` to your deployed Worker URL in your hosting environment.

---

## Environment Variables

### Frontend (`frontend/.env.local`)
```env
NEXT_PUBLIC_WORKER_URL=http://localhost:8787
```

### Worker (via `wrangler secret put`)
```
NEON_DATABASE_URL   # Neon serverless Postgres connection string
```

Cloudflare bindings (`wrangler.toml`):
- `STORAGE` – R2 bucket for project files
- `AI` – Workers AI binding
- `COLLABORATION_ROOM` – Durable Object namespace

---

## How It Works

### Opening a Project
1. The project metadata is fetched from Neon Postgres via the Worker.
2. The IDE page renders with an empty WebContainer and the file list from R2.

### Running a Project
1. All file contents are fetched from R2 and mounted into the WebContainer.
2. `npm install` is executed inside the WebContainer (output streamed to terminal).
3. `npm run dev` starts the dev server; the preview iframe opens on the server-ready URL.

### Saving Files
- Every editor change triggers an auto-save to R2 via `PUT /api/projects/:id/files/*`.

### Real-time Collaboration
- On IDE load, a Yjs document is created and connected via `y-websocket` to the Durable Object.
- Yjs binary updates are broadcast to all peers in the same session.
- Monaco is bound to the Yjs document via `y-monaco` for cursor-aware co-editing.

### AI Chat
- Messages are sent to `/api/ai/chat` which calls Workers AI with the full conversation history.
- The response is streamed as SSE and appended token-by-token to the chat panel.

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 15, React 18, TypeScript, Tailwind CSS |
| Code Editor | Monaco Editor, Yjs, y-monaco |
| Terminal | xterm.js |
| Browser Runtime | WebContainers API |
| Backend | Cloudflare Workers, Hono.js |
| Realtime | Cloudflare Durable Objects, WebSockets |
| Storage | Cloudflare R2 |
| AI | Cloudflare Workers AI (Llama 3.1 8B) |
| Database | Neon serverless Postgres |
| Collaboration | Yjs, y-websocket |

---

## License

[MIT](LICENSE)
