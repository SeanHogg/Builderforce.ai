# Builderforce.ai IDE — Architecture Document

> **Version:** 2.0  
> **Last updated:** March 2026  
> **Scope:** Full-stack deep-dive covering layout, data flow, API design, data model, technology stack, state management, collaboration, AI training pipeline, agent publishing, and the new Hybrid Local Brain / Mamba State Engine.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Technology Stack](#2-technology-stack)
3. [Repository Structure](#3-repository-structure)
4. [IDE Layout & Panels](#4-ide-layout--panels)
5. [Routing & Entry Points](#5-routing--entry-points)
6. [Authentication Flow](#6-authentication-flow)
7. [State Management](#7-state-management)
8. [File System & Storage](#8-file-system--storage)
9. [WebContainer Integration](#9-webcontainer-integration)
10. [Real-time Collaboration](#10-real-time-collaboration)
11. [AI Chat (Left Panel)](#11-ai-chat-left-panel)
12. [AI Training Pipeline](#12-ai-training-pipeline)
13. [Agent Publish Flow](#13-agent-publish-flow)
14. [API Reference](#14-api-reference)
15. [Data Model](#15-data-model)
16. [End-to-End Data Flows](#16-end-to-end-data-flows)
17. [Security Considerations](#17-security-considerations)
18. [Use Cases](#18-use-cases)
19. [Hybrid Local Brain — Mamba State Engine](#19-hybrid-local-brain--mamba-state-engine)
20. [Agent Runtime SDK](#20-agent-runtime-sdk)
21. [WebGPU Runtime Layer](#21-webgpu-runtime-layer)
22. [Storage Integration](#22-storage-integration)

---

## 1. Overview

The Builderforce.ai IDE is a **browser-native, full-stack development environment** that combines a Monaco-powered code editor, a live Vite preview powered by WebContainers, a real-time AI assistant, an in-browser LoRA fine-tuning engine, and a workforce-agent publishing pipeline — all in a single Next.js page.

### Key Capabilities at a Glance

| Capability | Description |
|---|---|
| **Code Editor** | Monaco Editor with Yjs CRDT for multi-user editing |
| **Live Preview** | Vite dev server running inside a WebContainer in-browser sandbox |
| **Interactive Terminal** | xterm.js shell connected to a persistent WebContainer process |
| **AI Assistant** | Stateful project-scoped chat with Memory toggle and inference-mode selector |
| **Model Training** | In-browser WebGPU LoRA fine-tuning + Memory Training + Hybrid Training |
| **Agent Publishing** | Package and publish trained LLM agents to the Builderforce Workforce Registry |
| **Real-time Collaboration** | Presence-aware multi-user editing via Cloudflare Durable Objects + Yjs |
| **Mamba State Engine** | Persistent SSM memory layer per agent — runs in-browser via WebGPU (WGSL) or JS fallback |
| **Agent State Viewer** | Visualise Mamba memory evolution, replay sequences, debug reasoning drift |
| **Hybrid Inference** | Local-first → confidence check → optional cloud escalation (Workers AI / OpenRouter) |

---

## 2. Technology Stack

### Frontend

| Layer | Technology | Purpose |
|---|---|---|
| Framework | **Next.js 15** (App Router) | SSR, routing, middleware |
| UI Library | **React 18** | Component model, hooks |
| Code Editor | **Monaco Editor** (`@monaco-editor/react`) | Syntax highlighting, IntelliSense |
| CRDT | **Yjs** (`yjs`, `y-monaco`) | Conflict-free replicated document for collaborative editing |
| Terminal | **xterm.js** (`@xterm/xterm`) | Interactive in-browser terminal |
| WebContainer | **@webcontainer/api** | In-browser Node.js / Vite sandbox |
| AI Models | **@huggingface/transformers** (Transformers.js) | WebGPU-accelerated model inference and LoRA training |
| Styling | **Tailwind CSS** + inline CSS custom properties | Theming system (`var(--bg-deep)`, etc.) |
| Auth | Custom `localStorage` + cookie session | JWT token storage |
| Language | **TypeScript** | Type safety throughout |

### Backend (Cloudflare Worker)

| Layer | Technology | Purpose |
|---|---|---|
| Runtime | **Cloudflare Workers** | Edge compute, zero cold-start |
| Framework | **Hono** | Lightweight HTTP router |
| Database | **Neon Postgres** (`@neondatabase/serverless`) | Persistent relational data |
| File Storage | **Cloudflare R2** | S3-compatible object storage for project files, datasets, and LoRA artifacts |
| Real-time | **Cloudflare Durable Objects** | Stateful WebSocket rooms for collaboration |
| AI Provider | **Cloudflare Workers AI** (default) / **OpenRouter** | LLM inference for chat, dataset generation, evaluation |
| Language | **TypeScript** | Type safety in worker routes |

---

## 3. Repository Structure

```
Builderforce.ai/
├── frontend/                         # Next.js 15 application
│   ├── src/
│   │   ├── app/                      # App Router pages
│   │   │   ├── ide/[id]/page.tsx     # IDE entry point (per-project)
│   │   │   ├── projects/[id]/page.tsx# Legacy project page
│   │   │   ├── workforce/page.tsx    # Agent registry browser
│   │   │   ├── dashboard/page.tsx    # Project list
│   │   │   ├── login/page.tsx
│   │   │   ├── register/page.tsx
│   │   │   └── tenants/page.tsx
│   │   ├── components/
│   │   │   ├── IDENew.tsx            # ★ Primary IDE orchestrator (718 lines)
│   │   │   ├── IDE.tsx               # IDE shell (used from projects/[id])
│   │   │   ├── IDE/                  # Decomposed layout sub-components
│   │   │   │   ├── Layout.tsx
│   │   │   │   ├── Header.tsx
│   │   │   │   ├── LeftPanel.tsx
│   │   │   │   ├── CenterPanel.tsx
│   │   │   │   ├── RightPanel.tsx
│   │   │   │   └── ViewToggle.tsx
│   │   │   ├── AITrainingPanel.tsx   # ★ Model training UI (501 lines)
│   │   │   ├── AgentPublishPanel.tsx # ★ Workforce agent publishing (421 lines)
│   │   │   ├── ProjectAIChat.tsx     # Left-panel AI chat
│   │   │   ├── CodeEditor.tsx        # Monaco wrapper + Yjs binding
│   │   │   ├── Terminal.tsx          # xterm.js wrapper
│   │   │   ├── PreviewFrame.tsx      # iFrame for live preview
│   │   │   ├── EditorTabs.tsx        # Open-file tab bar
│   │   │   ├── FileExplorer.tsx      # Right-panel file tree
│   │   │   └── ProjectsSlideOutPanel.tsx
│   │   ├── hooks/
│   │   │   ├── useWebContainer.ts    # WebContainer boot/mount/run
│   │   │   └── useCollaboration.ts   # Yjs doc + WebSocket sync
│   │   └── lib/
│   │       ├── types.ts              # All shared TypeScript types
│   │       ├── api.ts                # Worker API client functions
│   │       ├── apiClient.ts          # Base fetch wrapper
│   │       ├── auth.ts               # Auth helpers (login, register, tokens)
│   │       ├── builderforceApi.ts    # Brain/BrainStorm API client
│   │       └── webgpu-trainer.ts     # ★ WebGPU LoRA training engine
│   └── package.json
│
├── worker/                           # Cloudflare Worker (Hono)
│   ├── src/
│   │   ├── index.ts                  # App entry point + route mounting
│   │   ├── routes/
│   │   │   ├── projects.ts           # Project CRUD
│   │   │   ├── files.ts              # R2 file read/write/delete
│   │   │   ├── ai.ts                 # Chat + AI inference
│   │   │   ├── datasets.ts           # Dataset generation + storage
│   │   │   ├── training.ts           # Training job CRUD + artifact upload + eval
│   │   │   └── agents.ts             # Workforce agent registry
│   │   ├── services/
│   │   │   ├── ai.ts                 # LLM provider abstraction
│   │   │   ├── training.ts           # Evaluation + artifact helpers
│   │   │   └── dataset.ts            # Dataset generation helpers
│   │   └── durable-objects/
│   │       └── CollaborationRoom.ts  # WebSocket broadcast hub
│   ├── schema.sql                    # Neon Postgres DDL
│   └── wrangler.toml                 # Cloudflare config
│
├── migrations/                       # DB migration scripts
└── docs/
    └── ide-architecture.md           # ← This document
```

---

## 4. IDE Layout & Panels

The IDE renders a **three-column responsive layout** with a collapsible terminal at the bottom of the center column.

```
┌──────────────────────────────────────────────────────────────────────┐
│  TOP BAR — hamburger | project title (editable) | details | ▶ Run  │
├─────────────────┬──────────────────────────────┬────────────────────┤
│                 │  VIEW TOGGLE: Preview | Code  │                    │
│  LEFT PANEL     ├──────────────────────────────┤  RIGHT PANEL       │
│  (320 px)       │                              │  (300 px)          │
│                 │  CENTER — Preview iFrame      │  Tabs:             │
│  AI Chat        │         OR                   │  📁 Files          │
│  (ProjectAIChat)│  Code Editor (Monaco)         │  🧠 Train          │
│                 │  + EditorTabs                │  🚀 Publish        │
│                 │                              │                    │
│                 ├──────────────────────────────┤                    │
│                 │  TERMINAL (collapsible, 220px)│                    │
│                 │  xterm.js ← WebContainer shell│                   │
└─────────────────┴──────────────────────────────┴────────────────────┘
```

### Top Bar

| Element | Behaviour |
|---|---|
| **Hamburger / ☰** | Opens `ProjectsSlideOutPanel` — lets user switch projects without leaving the IDE |
| **Project title** | Inline `<input>` that saves on blur or `Enter` via `PUT /api/projects/:id` |
| **Description** | Read-only summary clipped to 200 px |
| **Details button** | Fires `onOpenProjectDetails` prop — parent renders a slide-out with tasks and metadata |
| **Live indicator** | Green dot when `collabConnected === true` (Yjs WebSocket is live) |
| **WC status** | Shows `⏳ Booting…` / `✅ Ready` / `⚠️ WC Error` from `wcState.status` |
| **▶ Run** | Triggers the 4-stage WebContainer pipeline (see §9) |

### Left Panel — AI Chat (320 px)

- Houses `<ProjectAIChat>`, a project-scoped LLM chat.
- Passes `activeFile` and `activeFileContent` so the AI has context.
- Exposes `onApplyCode` — the AI can replace the active file's content with one click.
- `onCreateFile` creates a new file, saves it to R2, then opens it in the editor.
- `onStartBrainStormSession` creates a chat on the Brain API and redirects to `/brainstorm`.

### Center Panel — Code / Preview

Two views overlay each other using `position: absolute` / `visibility` toggling so neither fully unmounts:

| View | Component | Notes |
|---|---|---|
| **Preview** | `<PreviewFrame url={previewUrl} />` | iFrame pointed at the WebContainer dev server URL |
| **Code** | `<EditorTabs>` + `<CodeEditor>` | Monaco with Yjs binding, auto-save on change |

Below both sits a **collapsible terminal** (default height 220 px, collapses to a 36 px tab bar). It hosts a single persistent WebContainer shell spawned at IDE load.

### Right Panel — Files / Train / Publish (300 px)

Three sub-panels share the same absolute-positioned container, swapped by `rightTab` state:

| Tab | Component | Purpose |
|---|---|---|
| `📁 Files` | `<FileExplorer>` | Tree of project files; create / open / delete |
| `🧠 Train` | `<AITrainingPanel>` | Dataset generation + LoRA training |
| `🚀 Publish` | `<AgentPublishPanel>` | Profile + download + publish to Workforce Registry |

---

## 5. Routing & Entry Points

```
/ide/[id]           → frontend/src/app/ide/[id]/page.tsx
/projects/[id]      → frontend/src/app/projects/[id]/page.tsx
/workforce          → frontend/src/app/workforce/page.tsx
/dashboard          → frontend/src/app/dashboard/page.tsx
/brainstorm         → frontend/src/app/brainstorm/page.tsx
/login              → frontend/src/app/login/page.tsx
/register           → frontend/src/app/register/page.tsx
/tenants            → frontend/src/app/tenants/page.tsx
```

The Next.js **middleware** (`src/middleware.ts`) protects `/dashboard`, `/tenants`, and `/ide` routes by checking for a `bf_web_token` cookie and redirecting unauthenticated users to `/login?next=...`.

The `[id]` segment on `/ide/[id]` and `/projects/[id]` is the project UUID (matching the `id` column in the `projects` table). An optional `?chat=<chatId>` query parameter pre-selects an AI chat on load via the `initialChatId` prop.

---

## 6. Authentication Flow

Authentication is handled by an external service (`api.builderforce.ai`) and is entirely token-based.

```
Browser
  │
  ├─ POST /api/auth/web/login  ──────► api.builderforce.ai
  │  { email, password }                │
  │  ◄──────────────────────────────────┤ { token, user }
  │
  ├─ persistSession(token, user)
  │    └─ localStorage: bf_web_token, bf_user
  │    └─ cookie: bf_web_token (SameSite=Lax)
  │
  ├─ GET /api/auth/my-tenants (Bearer: webToken)
  │  ◄────────────────────────────────── Tenant[]
  │
  ├─ POST /api/auth/tenant-token { tenantId }
  │  ◄────────────────────────────────── { token }
  │
  └─ persistTenantSession(tenantToken, tenant)
       └─ localStorage: bf_tenant_token, bf_tenant
       └─ cookie: bf_tenant_token (SameSite=Lax)
```

### Token Lifecycle

| Token | Key | Usage |
|---|---|---|
| **Web token** | `bf_web_token` | Identifies the user globally across all tenants |
| **Tenant token** | `bf_tenant_token` | Scopes API calls to the selected workspace |
| **Last project** | `bf_last_project_id` | Remembers which project to reopen |
| **Default tenant** | `bf_default_tenant_id` | Auto-selects workspace on subsequent logins |

On any `401` response where a token was sent, `handleApiUnauthorized()` clears all tokens and redirects to `/login?next=<currentPath>`.

---

## 7. State Management

The IDE uses **React local state** exclusively — no Redux, Zustand, or Context for editor data. State is co-located in the component that needs it and passed down as props.

### `IDENew.tsx` State Inventory

| State variable | Type | Purpose |
|---|---|---|
| `files` | `FileEntry[]` | Master list of project files (paths + types) |
| `openFiles` | `string[]` | Ordered list of currently open file paths (tabs) |
| `activeFile` | `string \| undefined` | Currently focused file path |
| `fileContents` | `Record<string, string>` | In-memory cache: path → file content |
| `centerView` | `'preview' \| 'code'` | Which view is visible in the center panel |
| `rightTab` | `'files' \| 'train' \| 'publish'` | Active right-panel tab |
| `previewUrl` | `string \| undefined` | WebContainer dev-server URL for the iFrame |
| `terminalWriter` | `((data: string) => void) \| undefined` | Function to write text to the xterm terminal |
| `shellWriter` | `WritableStreamDefaultWriter<string> \| undefined` | Stream writer into the WebContainer shell stdin |
| `isRunning` | `boolean` | Guards against concurrent Run invocations |
| `completedJobs` | `TrainingJob[]` | Training jobs that finished successfully; forwarded to `AgentPublishPanel` |
| `projectTitle` | `string` | Local copy of project name for inline editing |
| `isSavingTitle` | `boolean` | Disables title input during save |
| `projectsPanelOpen` | `boolean` | Controls `ProjectsSlideOutPanel` visibility |
| `terminalExpanded` | `boolean` | Collapses / expands the terminal pane |
| `shellStartedRef` | `Ref<boolean>` | One-shot guard: ensures the shell boots only once |
| `terminalWriteRef` | `Ref<fn>` | Allows the shell-output callback to reach the terminal even before it mounts |

### `AITrainingPanel.tsx` State Inventory

| State variable | Type | Purpose |
|---|---|---|
| `tab` | `'configure' \| 'datasets' \| 'jobs'` | Active sub-panel |
| `config` | `TrainingConfig` | Current training hyperparameters |
| `datasets` | `Dataset[]` | Project datasets fetched from API |
| `jobs` | `TrainingJob[]` | Training jobs fetched from API |
| `selectedDatasetId` | `string` | Dataset to associate with the next training job |
| `logs` | `string[]` | Live training log lines rendered in the log console |
| `lossHistory` | `TrainingStep[]` | Per-step loss values for the bar chart |
| `isGenerating` | `boolean` | Dataset generation in progress |
| `isTraining` | `boolean` | Training in progress |
| `activeJobId` | `string \| null` | ID of the currently running job |
| `webgpuAvailable` | `boolean` | Cached `isWebGPUAvailable()` result |
| `trainerRef` | `Ref<WebGPUTrainer \| null>` | Reference to the active trainer instance (allows stop) |

### `AgentPublishPanel.tsx` State Inventory

| State variable | Type | Purpose |
|---|---|---|
| `tab` | `'profile' \| 'download' \| 'publish'` | Active sub-panel |
| `profile` | `AgentProfile` | Agent name, title, bio, skills, resumeMarkdown |
| `skillInput` | `string` | Controlled input for adding a new skill tag |
| `selectedJobId` | `string` | Which completed training job's adapter to attach |
| `isPublishing` | `boolean` | Publish API call in progress |
| `publishedId` | `string \| null` | Registry ID after successful publish |
| `publishError` | `string \| null` | Error message from failed publish |
| `copiedInstall` | `boolean` | Clipboard copy confirmation (resets after 2 s) |

---

## 8. File System & Storage

### R2 Object Key Convention

All project files live under a flat namespace in Cloudflare R2:

```
{projectId}/{filePath}

Examples:
  abc123/package.json
  abc123/src/main.jsx
  abc123/src/index.css
```

Dataset blobs:
```
datasets/{projectId}/{datasetId}.jsonl
```

LoRA adapter artifacts:
```
artifacts/{projectId}/{jobId}/adapter.bin
```

Error logs:
```
logs/errors.txt
logs/global-errors.txt
```

### File Lifecycle in the IDE

```
User opens IDE
     │
     ▼
fetchFiles(projectId)          GET /api/projects/:id/files
     │                         → lists R2 prefix, returns FileEntry[]
     ▼
FileExplorer renders tree
     │
     ▼ (user clicks a file)
openFile(path)
  ├─ if already in fileContents cache → switch tab
  └─ else fetchFileContent(projectId, path)   GET /api/projects/:id/files/*
                                    → R2 object text
     │
     ▼
CodeEditor renders content
     │
     ▼ (user types)
handleEditorChange(value)
  ├─ update fileContents cache immediately (optimistic)
  └─ saveFile(projectId, path, value)    PUT /api/projects/:id/files/*
                                    → R2 put (fire-and-forget, non-blocking)
```

**Auto-save** happens on every editor change event — the PUT to R2 is awaited in a `try/catch` but does not block the UI.

### Default Scaffold (Vanilla Template)

When a project is created via `POST /api/projects`, the worker automatically seeds R2 with a working React + Vite scaffold:

```
package.json    ← React 18, Vite 4 dependencies
index.html      ← HTML entry with #root div
src/main.jsx    ← Hello World React app
src/index.css   ← Base styles
vite.config.js  ← Vite config with React plugin
```

---

## 9. WebContainer Integration

WebContainers run a full Node.js-compatible environment entirely in the browser using WebAssembly, enabling `npm install`, Vite dev servers, and interactive shells without a remote server.

### Boot Sequence

The `useWebContainer` hook manages a **module-level singleton** (`webContainerInstance`) so the container is never booted twice across re-renders or hot reloads:

```
IDE mounts
     │
     ▼
useEffect (once, via shellStartedRef guard)
     │
     ├─ getOrBootWebContainer()
     │    ├─ if instance exists → return immediately
     │    ├─ if bootPromise exists → await it
     │    └─ else: WebContainer.boot()  [~1-3 seconds]
     │
     └─ startShell(outputCallback)
          └─ spawns /bin/jsh
          └─ pipes stdout/stderr to terminal via terminalWriteRef
```

### Run Pipeline (4 Stages)

Triggered by clicking **▶ Run**:

```
Stage 1 — Fetch file contents
  ├─ For every file not yet in the in-memory cache:
  │    fetchFileContent(projectId, path)  →  GET R2
  └─ Build allContents: Record<string, string>

Stage 2 — Validate / scaffold missing files
  ├─ Validate package.json is parseable JSON
  └─ Fill default scaffold for any empty/missing required file
     (package.json, index.html, src/main.jsx, src/index.css, vite.config.js)
     Note: defaults only affect the mount copy, NOT the R2-persisted files

Stage 3 — Mount to WebContainer
  └─ mountFiles(contents)
       └─ buildFileSystemTree(flat map → nested { directory / file } tree)
       └─ wc.mount(tree)

Stage 4 — npm install + dev server
  ├─ runCommandAndWait('npm', ['install'])
  │    ← streams output to terminal; fails hard on non-zero exit
  └─ startDevServer(outputCallback)
       └─ wc.spawn('npm', ['run', 'dev'])
       └─ waits for server-ready event → captures URL
       └─ setPreviewUrl(url) → setCenterView('preview')
```

All four stages write coloured progress messages to the terminal using ANSI escape codes.

### Interactive Terminal

The terminal is permanently connected to the WebContainer shell:

```
User types in xterm.js
     │
     ▼
handleTerminalInput(data)
     └─ shellWriter.write(data)    ← writes to WebContainer jsh stdin

WebContainer shell produces output
     └─ startShell callback fires
     └─ terminalWriteRef.current(data)  ← writes to xterm.js
```

The terminal is collapsible (a `height` CSS transition from `220px` → `36px`) and mounts lazily but the shell connection is established immediately at IDE load.

---

## 10. Real-time Collaboration

### Architecture

```
Browser A                 Cloudflare Worker             Browser B
    │                          │                            │
    ├─ useCollaboration(projectId, userId)                  │
    │    └─ new Y.Doc()                                     │
    │    └─ WebSocket → /api/collab/{projectId}/ws          │
    │              ─────────────────────────────────────►   │
    │         CollaborationRoom (Durable Object)            │
    │              ◄─────────────────────────────────────   │
    │                                                       │
    ▼ Yjs update                                            │
    ├─ Y.Doc serialise → binary                             │
    └─ ws.send(binary)                                      │
         └─► CollaborationRoom.broadcast() ──────────────►  │
                                          Browser B applies update
```

### CollaborationRoom Durable Object

A **Cloudflare Durable Object** (`CollaborationRoom`) acts as a broadcast hub:

| Message type | Handling |
|---|---|
| Binary frame | Treated as a Yjs CRDT update; broadcast to all other sessions |
| `yjs-update` | JSON-encoded Yjs update; broadcast |
| `presence` | Cursor position / user metadata; broadcast with session's userId + colour |
| `terminal-input` | User keypress in shared terminal; broadcast |
| `terminal-output` | Terminal stdout; broadcast |

Each room is identified by the `projectId` string via `idFromName(sessionId)`. Up to thousands of sessions can exist simultaneously across separate Durable Object instances.

### Yjs Integration in Monaco

`CodeEditor.tsx` creates a `MonacoBinding` that ties a Yjs `Text` type to the Monaco editor model. All edits become CRDT operations that automatically merge across concurrent edits — no last-write-wins conflicts.

---

## 11. AI Chat (Left Panel)

### Component: `ProjectAIChat`

The AI chat is scoped to the current project and maintains a persistent message history stored in the `ai_messages` table.

**Message flow:**

```
User types a message
     │
     ▼
POST /api/ai/messages   { projectId, role: 'user', content }
     │
     ▼
POST /api/ai/chat (SSE stream)
     ├─ Worker selects AI provider (Cloudflare AI / OpenRouter)
     └─ Streams tokens back as Server-Sent Events

Each chunk → append to message bubble in real time
     │
     ▼
On stream end → store assistant message in ai_messages
```

**Context injection:**
- The `activeFile` path and its full content are prepended as a system prompt fragment.
- This allows the AI to give file-specific suggestions.

**Code application:**
- The AI can return a fenced code block.
- The chat UI renders an **Apply** button beneath code blocks.
- Clicking it calls `onApplyCode(code)`, which updates `fileContents` and fire-and-forgets a `saveFile`.

**File creation:**
- The AI can suggest a new file path + content.
- `onCreateFile(path, content)` saves to R2, refreshes the file list, and opens the new file in the editor.

---

## 12. AI Training Pipeline

### Supported Models

| ID | Name | Parameters | Task | Training |
|---|---|---|---|---|
| `gpt-neox-20m` | GPT-NeoX 20M | 20M | Tiny reasoning | WebGPU |
| `codeparrot-110m` | CodeParrot 110M | 110M | Python coding | WebGPU |
| `gpt-neo-125m` | GPT-Neo 125M | 125M | General reasoning | WebGPU |
| `codeparrot-350m` | CodeParrot 350M | 350M | Python coding | WebGPU |
| `codegen-350m` | CodeGen 350M | 350M | Coding | WebGPU |
| `gpt-neo-350m` | GPT-Neo 350M | 350M | General reasoning | WebGPU |
| `santacoder-1b` | SantaCoder 1B | 1B | Coding + reasoning | WebGPU |
| `starcoder-1b` | StarCoder 1B | 1B | Coding + reasoning | WebGPU |
| `mpt-1b` | MPT-1B | 1B | Instruction-following | WebGPU |
| `mpt-1b-instruct` | MPT-1B-Instruct | 1B | Instruction-following | WebGPU |
| `openassistant-1b` | OpenAssistant 1B | 1B | Instruction-following | WebGPU |
| `mpt-1.3b` | MPT-1.3B | 1.3B | Instruction-following | WebGPU |
| `codegen-2b` | CodeGen 2B | 2B | Full coding capabilities | WebGPU |
| `starcoder-2b` | StarCoder 2B | 2B | Coding & reasoning | WebGPU |

Models with ≤ 2 B parameters train in-browser via WebGPU. Larger models are offloaded to cloud GPU (simulated polling path in current implementation).

### Training Panel Tabs

#### `configure` Tab

1. **Base model selection** — dropdown from `SUPPORTED_MODELS`; a green/orange indicator shows whether WebGPU or cloud is needed.
2. **Capability prompt** — free-text description of desired skill (e.g. "Python debugging and error explanation").
3. **Training dataset** — optionally associate a previously generated dataset; or leave blank to use capability prompt only.
4. **Generate button** — calls `generateDataset()` via SSE; streams progress; auto-selects the new dataset when done.
5. **Hyperparameters** — LoRA rank (1–64), epochs (1–20), batch size (1–32), learning rate (0.000001–0.01).
6. **▶ Start Training** / **⏹ Stop** — starts/stops the WebGPUTrainer.
7. **Loss curve** — bar chart of the last 60 training steps, re-renders on each `onStep` callback.
8. **Training logs** — auto-scrolling green console log.

#### `datasets` Tab

Lists all `Dataset` records for the project with status badges: `pending` / `generating` / `ready` / `error`.

#### `jobs` Tab

Lists all `TrainingJob` records with status badges and per-job progress (`Epoch X/Y — loss: Z`). Completed jobs show an **Evaluate** button that calls `POST /api/training/:id/evaluate`.

### Dataset Generation Flow (SSE)

```
Client                              Worker
  │                                    │
  ├─ POST /api/datasets/generate ─────►│
  │  { projectId, capabilityPrompt,    │
  │    name, exampleCount }            │
  │                                    ├─ INSERT datasets (status='generating')
  │                                    ├─ Open SSE stream
  │  ◄── data: { type:'status' } ──────┤
  │                                    ├─ generateDatasetWithAI(prompt, count, env)
  │                                    │    └─ calls LLM to produce instruction/input/output triples
  │  ◄── data: { type:'chunk' } ───────┤ (progress updates)
  │                                    ├─ serialiseDataset() → JSONL text
  │                                    ├─ storeDatasetInR2() → R2 key
  │                                    ├─ UPDATE datasets (status='ready', r2_key, example_count)
  │  ◄── data: { type:'done', dataset }┤
  │  ◄── data: [DONE] ─────────────────┤
  └─ add to datasets list; auto-select │
```

### LoRA Training Flow (WebGPU)

```
handleStartTraining()
  │
  ├─ POST /api/training  ─────────────► Worker creates training_jobs record
  │  { projectId, datasetId, baseModel,   + initial training_logs entry
  │    loraRank, epochs, batchSize, lr }   → returns job record
  │
  ├─ if webgpuAvailable && canUseWebGPU:
  │    new WebGPUTrainer({ ... })
  │    trainer.init()
  │      └─ pipeline('text-generation', modelId, { device: 'webgpu' })
  │         (HuggingFace Transformers.js loads model weights into GPU memory)
  │    trainer.train(params, examples)
  │      └─ For each epoch:
  │           For each batch:
  │             forward pass (GPU)
  │             compute loss
  │             backward pass (LoRA gradients only)
  │             update A/B adapter matrices
  │           ► onStep({ epoch, step, loss, learningRate })
  │           ► onEpochEnd(epoch, avgLoss)
  │      └─ Serialise LoRA adapter to ArrayBuffer
  │      └─ POST /api/training/:id/artifact (application/octet-stream)
  │             → R2.put(artifacts/{projectId}/{jobId}/adapter.bin)
  │             → UPDATE training_jobs SET r2_artifact_key
  │      └─ PUT /api/training/:id { status: 'completed', r2ArtifactKey }
  │      ► onComplete(artifactKey)
  │             → setCompletedJobs(prev => [...prev, completedJob])
  │
  └─ else (cloud path):
       Simulate epoch loop with setTimeout polling
       ► onJobCompleted(job)
```

### Model Evaluation Flow

```
handleEvaluate(jobId)
  │
  ├─ POST /api/training/:id/evaluate
  │    Worker:
  │    ├─ Fetch linked dataset examples from R2 (first 10 rows of JSONL)
  │    ├─ For each example: ask LLM to generate output (as if it were the fine-tuned model)
  │    ├─ evaluateModelOutputs(examples, modelOutputs, jobId, env)
  │    │    └─ AI judge rates: code_correctness, reasoning_quality, hallucination_rate
  │    ├─ saveModelArtifact() → R2 (eval JSON alongside adapter.bin)
  │    ├─ INSERT model_artifacts (eval_score)
  │    └─ INSERT training_logs (score summary)
  │
  └─ appendLog(score, code_correctness, reasoning_quality, hallucination_rate, details)
```

---

## 13. Agent Publish Flow

### Panel Tabs

#### `👤 Profile` Tab

The user fills in:
- **Agent Name** *(required)* — e.g. "Python Expert"
- **Title / Role** *(required)* — e.g. "Senior Python Developer"
- **Bio** *(required)* — description of specialisation
- **Skills** — tag cloud; enter skill + Enter or click `+`
- **Resume (Markdown)** — paste directly or upload `.md` / `.txt` file
- **Associated Model** — dropdown of `completedJobs` (fed from `AITrainingPanel` via `onJobCompleted`)

#### `⬇ Download` Tab

- Shows a JSON preview of the `AgentPackage` object.
- **Download agent-package.json** — creates a Blob URL and triggers a browser download.
- **Download resume.md** — optional Markdown resume download.

The `AgentPackage` format:

```json
{
  "version": "1.0",
  "platform": "builderforce.ai",
  "name": "Python Expert",
  "title": "Senior Python Developer",
  "bio": "...",
  "skills": ["Python", "Debugging"],
  "base_model": "codeparrot-350m",
  "lora_config": {
    "rank": 8,
    "alpha": 16,
    "target_modules": ["q_proj", "v_proj"]
  },
  "training_job_id": "uuid",
  "r2_artifact_key": "artifacts/proj/job/adapter.bin",
  "resume_md": "...",
  "created_at": "2026-03-18T..."
}
```

#### `🌐 Publish` Tab

```
handlePublish()
  │
  ├─ Validate: profile.name, profile.title, profile.bio are non-empty
  ├─ POST /api/agents
  │    { project_id, job_id, name, title, bio, skills, base_model,
  │      lora_rank, r2_artifact_key, resume_md }
  │    Worker: INSERT INTO agents → returns agent record
  │
  ├─ setPublishedId(agent.id)
  │
  └─ Success state shows:
       ✅ "Agent published to the Workforce Registry!"
       Agent ID (monospace)
       📦 Install Command: `iwr -useb https://coderclaw.ai/install.ps1 | iex`
       Copy-to-clipboard button
       🌐 View in Workforce Registry → /workforce
       "Publish another agent" resets state
```

### Install Command

The PowerShell install script at `/install.ps1` (served by the frontend) downloads agent packages via `GET /api/agents/:id/package`, which returns the same JSON structure with a `Content-Disposition: attachment` header for direct save.

---

## 14. API Reference

All routes are served by the Cloudflare Worker at `https://worker.builderforce.ai` (configured in `wrangler.toml`) and mounted under `/api/`.

### Projects

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/projects` | — | `Project[]` |
| `POST` | `/api/projects` | `{ name, description?, template? }` | `Project` (201) |
| `GET` | `/api/projects/:id` | — | `Project` |
| `PUT` | `/api/projects/:id` | `{ name?, description? }` | `Project` |
| `DELETE` | `/api/projects/:id` | — | `{ success: true }` |

### Files

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/projects/:projectId/files` | — | `FileEntry[]` (list from R2 prefix) |
| `GET` | `/api/projects/:projectId/files/*` | — | File text content |
| `PUT` | `/api/projects/:projectId/files/*` | Raw text body | `{ success: true }` |
| `DELETE` | `/api/projects/:projectId/files/*` | — | `{ success: true }` |

### AI Chat

| Method | Path | Body | Response |
|---|---|---|---|
| `POST` | `/api/ai/chat` | `{ messages, projectId? }` | SSE stream of token chunks |
| `GET` | `/api/ai/messages?projectId=` | — | `AIMessage[]` |
| `POST` | `/api/ai/messages` | `{ projectId, role, content }` | `AIMessage` (201) |

### Datasets

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/datasets?projectId=` | — | `Dataset[]` |
| `GET` | `/api/datasets/:id` | — | `Dataset` |
| `GET` | `/api/datasets/:id/download` | — | JSONL stream from R2 |
| `POST` | `/api/datasets/generate` | `{ projectId, capabilityPrompt, name, exampleCount? }` | SSE stream → done event with `Dataset` |

### Training

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/training?projectId=` | — | `TrainingJob[]` |
| `POST` | `/api/training` | `{ projectId, datasetId?, baseModel, loraRank, epochs, batchSize, learningRate }` | `TrainingJob` (201) |
| `GET` | `/api/training/:id` | — | `TrainingJob` |
| `PUT` | `/api/training/:id` | `{ status?, currentEpoch?, currentLoss?, r2ArtifactKey?, errorMessage? }` | `TrainingJob` |
| `GET` | `/api/training/:id/logs` | — | `TrainingLog[]` |
| `POST` | `/api/training/:id/logs` | `{ epoch?, step?, loss?, message }` | `TrainingLog` (201) |
| `GET` | `/api/training/:id/logs/stream` | — | SSE stream of log entries until job completes |
| `POST` | `/api/training/:id/artifact` | Raw `application/octet-stream` body | `{ r2Key }` (201) |
| `POST` | `/api/training/:id/evaluate` | — | `EvaluationResult` |

### Agents (Workforce Registry)

| Method | Path | Body | Response |
|---|---|---|---|
| `GET` | `/api/agents` | — | `PublishedAgent[]` (sorted by `hire_count DESC`) |
| `POST` | `/api/agents` | `{ project_id, job_id?, name, title, bio, skills?, base_model, lora_rank?, r2_artifact_key?, resume_md? }` | `PublishedAgent` (201) |
| `GET` | `/api/agents/:id` | — | `PublishedAgent` |
| `GET` | `/api/agents/:id/package` | — | `AgentPackage` JSON (with `Content-Disposition: attachment`) |
| `POST` | `/api/agents/:id/hire` | — | `PublishedAgent` (increments `hire_count`) |

### Collaboration WebSocket

| Path | Protocol |
|---|---|
| `/api/collab/:sessionId/ws` | WebSocket upgrade; routed to `CollaborationRoom` Durable Object |
| `/api/collab/:sessionId` | HTTP info endpoint; routed to same DO |

---

## 15. Data Model

The Neon Postgres database (`schema.sql`) contains nine tables. The entity-relationship diagram below shows all columns, primary keys, and foreign-key relationships.

### Entity-Relationship Diagram

```
┌───────────────────┐          ┌──────────────────────────┐
│       users       │          │         projects          │
├───────────────────┤          ├──────────────────────────┤
│ id         TEXT PK│◄────────┤ owner_id  TEXT            │
│ email      TEXT   │          │ id        TEXT PK         │
│ name       TEXT   │          │ name      TEXT            │
│ created_at TSTZ   │          │ description TEXT          │
└───────────────────┘          │ template  TEXT            │
                               │ created_at TSTZ           │
         ┌─────────────────────┤ updated_at TSTZ           │
         │                     └────────────┬─────────────┘
         │                                  │ 1
         │                     ┌────────────┼──────────────┐
         │                     │            │              │
         ▼ N                   ▼ N          ▼ N            ▼ N
┌──────────────────┐  ┌────────────────┐  ┌──────────────┐  ┌────────────────────┐
│ project_members  │  │  ai_messages   │  │   datasets   │  │  collaboration_    │
├──────────────────┤  ├────────────────┤  ├──────────────┤  │    sessions        │
│ project_id TEXT ◄┘  │ id       TEXT  │  │ id      TEXT │  ├────────────────────┤
│ user_id    TEXT ──► │ project_id TEXT│  │ project_id ◄─┘  │ id          TEXT   │
│ role       TEXT  │  │ role     TEXT  │  │ name    TEXT │  │ project_id  TEXT ◄─┘
└──────────────────┘  │ content  TEXT  │  │ description │  │ user_id     TEXT   │
                      │ created_at TSTZ│  │ capability_ │  │ started_at  TSTZ   │
                      └────────────────┘  │  prompt TEXT│  │ ended_at    TSTZ   │
                                          │ r2_key  TEXT│  └────────────────────┘
                                          │ example_    │
                                          │  count  INT │
                                          │ status  TEXT│
                                          │ created_at  │
                                          │ updated_at  │
                                          └──────┬───────┘
                                                 │ 1
                                                 ▼ N
┌──────────────────────────────────────────────────────────────────────────────────┐
│                               training_jobs                                       │
├──────────────────────────────────────────────────────────────────────────────────┤
│ id              TEXT PK                                                           │
│ project_id      TEXT → projects.id                                                │
│ dataset_id      TEXT → datasets.id  (nullable)                                   │
│ base_model      TEXT                 (e.g. 'codeparrot-350m')                    │
│ lora_rank       INTEGER DEFAULT 8                                                 │
│ epochs          INTEGER DEFAULT 3                                                 │
│ batch_size      INTEGER DEFAULT 4                                                 │
│ learning_rate   REAL    DEFAULT 0.0002                                            │
│ status          TEXT    DEFAULT 'pending'  (pending/running/completed/failed)     │
│ current_epoch   INTEGER DEFAULT 0                                                 │
│ current_loss    REAL    (nullable)                                                │
│ r2_artifact_key TEXT    (nullable)  R2 key of adapter.bin                        │
│ error_message   TEXT    (nullable)                                                │
│ created_at      TSTZ    DEFAULT NOW()                                             │
│ updated_at      TSTZ    DEFAULT NOW()                                             │
└───────────────────────────────────┬─────────────────────────────────────────────┘
                                    │ 1
                      ┌─────────────┴─────────────┐
                      ▼ N                          ▼ N
           ┌──────────────────────┐    ┌───────────────────────────┐
           │    training_logs     │    │      model_artifacts       │
           ├──────────────────────┤    ├───────────────────────────┤
           │ id         TEXT PK   │    │ id          TEXT PK        │
           │ job_id     TEXT → ◄──┘    │ project_id  TEXT           │
           │ epoch      INTEGER        │ job_id      TEXT → ◄───────┘
           │ step       INTEGER        │ base_model  TEXT            │
           │ loss       REAL           │ r2_key      TEXT            │
           │ message    TEXT           │ eval_score  REAL            │
           │ created_at TSTZ           │ created_at  TSTZ            │
           └──────────────────────┘    └───────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│                           training_sessions                                 │
├────────────────────────────────────────────────────────────────────────────┤
│ id         TEXT PK                                                          │
│ project_id TEXT → projects.id                                               │
│ model_id   TEXT  (nullable)                                                 │
│ dataset_id TEXT → datasets.id  (nullable)                                   │
│ status     TEXT  DEFAULT 'pending'                                          │
│ metrics    JSONB (nullable) — free-form evaluation metrics blob             │
│ created_at TSTZ                                                             │
│ updated_at TSTZ                                                             │
└────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                                   agents                                      │
├──────────────────────────────────────────────────────────────────────────────┤
│ id              TEXT PK                                                       │
│ project_id      TEXT → projects.id                                            │
│ job_id          TEXT → training_jobs.id  (nullable)                           │
│ name            TEXT    Agent display name                                    │
│ title           TEXT    Job title / role                                      │
│ bio             TEXT    Description                                           │
│ skills          TEXT    JSON array e.g. '["Python","Debugging"]'             │
│ base_model      TEXT    Base model identifier                                 │
│ lora_rank       INTEGER (nullable)                                            │
│ r2_artifact_key TEXT    (nullable)  points to adapter.bin                    │
│ resume_md       TEXT    (nullable)  Markdown resume                          │
│ status          TEXT    DEFAULT 'active'  (active/inactive)                  │
│ hire_count      INTEGER DEFAULT 0  — bumped by POST /api/agents/:id/hire     │
│ eval_score      REAL    (nullable)  0.0–1.0 from evaluation                  │
│ created_at      TSTZ    DEFAULT NOW()                                         │
│ updated_at      TSTZ    DEFAULT NOW()                                         │
└──────────────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────────────┐
│                            file_versions                                    │
├────────────────────────────────────────────────────────────────────────────┤
│ id         TEXT PK                                                          │
│ project_id TEXT → projects.id                                               │
│ file_path  TEXT                                                             │
│ content    TEXT    Full file content snapshot                               │
│ author_id  TEXT → users.id  (nullable)                                      │
│ created_at TSTZ                                                             │
└────────────────────────────────────────────────────────────────────────────┘
```

### Table Summary

| Table | Rows represent | Key relationships |
|---|---|---|
| `users` | Registered Builderforce users | Referenced by `project_members`, `file_versions` |
| `projects` | IDE projects / workspaces | Parent of files (R2), messages, datasets, jobs, agents |
| `project_members` | User ↔ project role mapping | Links `users` ↔ `projects` |
| `ai_messages` | Chat history per project | Belongs to `projects` |
| `collaboration_sessions` | Multiplayer session tracking | Belongs to `projects` and `users` |
| `file_versions` | Snapshot history of file edits | Belongs to `projects`, authored by `users` |
| `datasets` | Training datasets (JSONL in R2) | Belongs to `projects`; referenced by `training_jobs` |
| `training_jobs` | LoRA fine-tuning jobs | Belongs to `projects` + optionally `datasets`; parent of logs/artifacts |
| `training_logs` | Step-level log lines for a job | Belongs to `training_jobs` |
| `training_sessions` | High-level iterate-improve loops | Links `projects`, `datasets`, optional `model_id` |
| `model_artifacts` | Stored model evaluation results | Belongs to `projects` and `training_jobs` |
| `agents` | Published workforce agents | Belongs to `projects`; optionally links `training_jobs` |

### TypeScript Type Definitions

All frontend types mirror the database schema:

```typescript
// Project
interface Project {
  id: number;
  publicId?: string;
  name: string;
  description?: string | null;
  template?: string | null;
  created_at?: string;
  updated_at?: string;
}

// File (R2-backed, no DB row)
interface FileEntry {
  path: string;
  content: string;
  type: 'file' | 'directory';
}

// Dataset
interface Dataset {
  id: string;
  project_id: number | string;
  name: string;
  capability_prompt: string;
  r2_key: string;
  example_count: number;
  status: 'pending' | 'generating' | 'ready' | 'error';
  created_at: string;
  updated_at: string;
}

// TrainingJob
interface TrainingJob {
  id: string;
  project_id: number | string;
  dataset_id?: string;
  base_model: string;
  lora_rank: number;
  epochs: number;
  batch_size: number;
  learning_rate: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  current_epoch: number;
  current_loss?: number;
  r2_artifact_key?: string;
  error_message?: string;
  created_at: string;
  updated_at: string;
}

// TrainingLog
interface TrainingLog {
  id: string;
  job_id: string;
  epoch?: number;
  step?: number;
  loss?: number;
  message: string;
  created_at: string;
}

// EvaluationResult
interface EvaluationResult {
  job_id: string;
  score: number;           // 0.0 – 1.0
  code_correctness?: number;
  reasoning_quality?: number;
  hallucination_rate?: number;
  details: string;
  created_at: string;
}

// Agent
interface PublishedAgent {
  id: string;
  project_id: number | string;
  job_id?: string;
  name: string;
  title: string;
  bio: string;
  skills: string[];
  base_model: string;
  lora_rank?: number;
  r2_artifact_key?: string;
  resume_md?: string;
  status: 'active' | 'inactive';
  hire_count: number;
  eval_score?: number;
  created_at: string;
  updated_at: string;
}

// AgentPackage (portable download format)
interface AgentPackage {
  version: '1.0';
  platform: 'builderforce.ai';
  name: string;
  title: string;
  bio: string;
  skills: string[];
  base_model: string;
  lora_config: {
    rank: number;
    alpha: number;
    target_modules: string[];
  };
  training_job_id?: string;
  r2_artifact_key?: string;
  resume_md?: string;
  created_at: string;
}
```

---

## 16. End-to-End Data Flows

### Flow 1: Developer opens the IDE and edits a file

```
1. Browser navigates to /ide/{projectId}
2. Next.js middleware checks bf_web_token cookie → passes
3. Page component calls GET /api/projects/:id and GET /api/projects/:id/files
4. IDENew renders with project + initialFiles props
5. useEffect fires: WebContainer.boot() + startShell()
6. useCollaboration creates Yjs doc + WebSocket to /api/collab/{projectId}/ws
7. CollaborationRoom DO accepts WebSocket, assigns userId + colour
8. User clicks a file in FileExplorer
9. openFile(path) → fetchFileContent(projectId, path)
   → GET /api/projects/:id/files/src/App.tsx → R2 object text
10. fileContents cache updated; Monaco Editor renders content
11. User types → handleEditorChange fires
12. fileContents updated optimistically (React state)
13. Yjs MonacoBinding serialises the edit as a CRDT delta
14. WebSocket sends binary Yjs update to CollaborationRoom
15. CollaborationRoom broadcasts to all other sessions
16. saveFile(projectId, path, value) → PUT /api/projects/:id/files/src/App.tsx (fire-and-forget)
17. R2 stores updated content
```

### Flow 2: Developer runs the project

```
1. Click ▶ Run
2. Stage 1: fetch any uncached file content from R2 (parallel)
3. Stage 2: validate package.json; fill default scaffold where empty
4. Stage 3: mountFiles() → buildFileSystemTree() → wc.mount()
5. Stage 4: runCommandAndWait('npm', ['install'])
   → npm output streams to terminal via ANSI-coloured messages
6. startDevServer() → wc.spawn('npm', ['run', 'dev'])
   → Vite starts; emits server-ready event with URL (e.g. localhost:5173)
7. setPreviewUrl(url); setCenterView('preview')
8. PreviewFrame renders iFrame pointing at WebContainer URL
9. Live React app visible in browser
```

### Flow 3: Train a custom LLM agent

```
1. Switch to 🧠 Train tab
2. On mount: listDatasets(projectId) + listTrainingJobs(projectId) (parallel)
3. User types capability prompt: "Explain Python tracebacks in plain English"
4. Click ✨ Generate
   → POST /api/datasets/generate (SSE)
   → Worker calls LLM to produce 50 instruction/input/output examples
   → Streams progress chunks; on done: dataset inserted into DB
   → New dataset appears in dropdown; auto-selected
5. User selects model (e.g. CodeParrot 350M) and keeps default hyperparameters
6. Click ▶ Start Training
   → POST /api/training → creates training_jobs record
   → new WebGPUTrainer({ modelId, jobId, datasetId, ... })
   → trainer.init() → loads model via Transformers.js WebGPU backend
   → trainer.train() → iterates epochs/steps with LoRA gradient updates
   → Each step: onStep fires → loss history bar chart updates
   → Each epoch: onEpochEnd fires → log entry appended
   → On completion: adapter serialised to ArrayBuffer
     → POST /api/training/:id/artifact (octet-stream)
     → R2.put(artifacts/{projectId}/{jobId}/adapter.bin)
     → UPDATE training_jobs SET r2_artifact_key, status='completed'
   → onJobCompleted fires → IDENew adds job to completedJobs
7. User optionally clicks 🧪 Evaluate
   → POST /api/training/:id/evaluate
   → Returns score, code_correctness, reasoning_quality, hallucination_rate
```

### Flow 4: Publish agent to Workforce Registry

```
1. Switch to 🚀 Publish tab
2. 👤 Profile tab: fill name, title, bio; add skill tags; paste resume
3. Select associated training job from dropdown
4. ⬇ Download tab: preview AgentPackage JSON; optionally download
5. 🌐 Publish tab: click 🌐 Publish to Workforce
   → POST /api/agents { project_id, job_id, name, title, bio, skills,
                         base_model, lora_rank, r2_artifact_key, resume_md }
   → Worker INSERT INTO agents → returns agent record with new UUID
6. Success: show agent ID + PowerShell install command
7. Others discover agent at /workforce (GET /api/agents sorted by hire_count)
8. Others click Hire → POST /api/agents/:id/hire → hire_count incremented
9. Others install via: iwr -useb https://coderclaw.ai/install.ps1 | iex
   → PowerShell downloads GET /api/agents/:id/package → agent-package.json
```

---

## 17. Security Considerations

### Authentication

- **Token storage**: JWTs are stored in both `localStorage` and as `SameSite=Lax` cookies. The cookie is used for server-side middleware checks; `localStorage` is the source of truth for client-side API calls.
- **HTTPS enforcement**: Cookies are marked `Secure` when the page is served over HTTPS.
- **Expiry handling**: Any `401` response automatically clears all stored tokens and redirects to `/login`.
- **No server-side secret in the frontend**: The external auth API URL is a public constant; tokens are issued by `api.builderforce.ai`.

### API Layer

- **CORS**: The worker sets `Access-Control-Allow-Origin: *` with a restricted methods list. This is appropriate for public APIs; tenant-scoped routes should add `Authorization` header validation.
- **Input validation**: All POST/PUT routes validate required fields and return `400` for missing data.
- **SQL injection**: All database queries use parameterized tagged template literals (`neon`'s `` sql`...` `` syntax) — no raw string interpolation.
- **R2 path traversal**: File routes use the full `projectId/filePath` key — cross-project access requires knowing another project's UUID (UUID v4, computationally infeasible to brute force).

### WebContainer Sandbox

- WebContainers run in a browser-native sandbox (WASM + service worker). They have no access to the host file system or network beyond what the browser allows.
- The live preview iFrame is served from the WebContainer's service-worker origin, isolated from the host page.

### LoRA Artifact

- Adapter binaries (`adapter.bin`) are stored under project-scoped R2 keys and are only accessible if the caller knows the exact key or goes through the worker API.
- No public listing of artifact keys is exposed.

---

## 18. Use Cases

### UC-1: Solo Developer — Build and Preview a React App

**Actor:** Individual developer  
**Flow:**
1. Create a new project at `/dashboard` → IDE opens with vanilla React scaffold.
2. Edit `src/main.jsx` in Monaco.
3. Click **▶ Run** → WebContainer boots, npm installs, Vite starts.
4. View live app in the Preview panel; see changes reflected instantly after saving.
5. Use the AI Chat to ask "How do I add a button that increments a counter?" — AI generates code.
6. Click **Apply** — code replaces the current file; save fires automatically.

---

### UC-2: Team — Collaborative Pair Programming

**Actor:** Two developers  
**Flow:**
1. Both navigate to the same `/ide/{projectId}` URL.
2. `useCollaboration` connects both browsers to the same `CollaborationRoom` Durable Object.
3. Yjs CRDT merges concurrent edits in real time — no conflicts.
4. Presence indicators show each user's cursor colour.
5. One developer uses the terminal; keystrokes are broadcast via `terminal-input` messages.

---

### UC-3: AI Practitioner — Fine-tune a Code Model In-Browser

**Actor:** ML engineer / developer  
**Flow:**
1. Open the **🧠 Train** panel.
2. Type capability prompt: "Generate Python unit tests for a given function."
3. Click **✨ Generate** → 50 instruction-tuning examples stream in from the LLM.
4. Select CodeGen 350M (WebGPU indicator shows green).
5. Set LoRA rank=16, epochs=5, batch_size=4, lr=0.0002.
6. Click **▶ Start Training** — browser GPU begins LoRA gradient updates; loss curve descends in real time.
7. Training completes; adapter.bin uploaded to R2.
8. Click **🧪 Evaluate** → AI judge scores code correctness: 87%, hallucination rate: 4%.

---

### UC-4: Business — Hire a Specialist AI Agent

**Actor:** Business user browsing `/workforce`  
**Flow:**
1. Browse the Workforce Registry — agents sorted by `hire_count` (most-hired first).
2. Find "Python Expert (CodeParrot 350M, rank=8, eval: 89%)".
3. Click **Hire** → `POST /api/agents/:id/hire` increments hire_count.
4. Run the PowerShell install command to download and configure the agent locally in CoderClaw.
5. The agent's LoRA adapter is loaded on top of the base model for specialised responses.

---

### UC-5: Developer — Iterate on Agent Quality

**Actor:** Agent creator  
**Flow:**
1. Run initial training job → evaluate → score: 71%.
2. Return to **🧠 Train**, regenerate dataset with a more specific prompt.
3. New dataset has 50 higher-quality examples (stored in R2 as JSONL).
4. Run second training job with higher LoRA rank (r=32, epochs=10).
5. Evaluate → score: 88%.
6. Update agent publish with the new `r2_artifact_key`.
7. The `training_sessions` table tracks this iterative loop for future automation.

---

### UC-6: Platform Administrator — Monitor and Debug

**Actor:** Platform admin  
**Flow:**
1. Navigate to `/admin` (requires `isSuperadmin: true` on the auth user).
2. View all projects, agents, and training jobs across tenants.
3. Check `logs/global-errors.txt` in R2 for unhandled worker errors.
4. Use the Observability page (`/observability`) to inspect LLM usage metrics.

---

*End of Architecture Document*

---

## 19. Hybrid Local Brain — Mamba State Engine

### Overview

The **Mamba State Engine** (`frontend/src/lib/mamba-engine.ts`) is a new in-browser persistent memory layer that extends the existing Transformers.js + LoRA system into a **Hybrid Local Brain**.

It implements a simplified State Space Model (SSM) inspired by the Mamba architecture. Unlike transformer attention (O(n²)), the Mamba SSM runs in O(n) — making it efficient for continuous, low-latency state updates in the browser.

```
Hybrid Local Brain
  ├── Transformers.js          (existing — WebGPU inference)
  ├── LoRA adapters            (existing — fine-tuned weights)
  └── Mamba State Engine       (new — persistent memory)
```

### State Representation

Each agent maintains a compact state vector:

```typescript
interface MambaStateSnapshot {
  data: number[];    // Packed Float32 values (channels × order)
  dim: number;       // Input embedding dimension
  order: number;     // SSM hidden states per channel
  channels: number;  // Parallel channels
  step: number;      // Monotonic interaction counter
}
```

Default configuration: `dim=64, order=4, channels=16` — producing a 64-float state vector (256 bytes).

### SSM Recurrence

The state evolves via the discretised recurrence:

```
h_{t+1} = A_disc · h_t + B_disc · x_t
y_t = C · h_t
```

Where `A` is a stable diagonal matrix (eigenvalues < 1), `x_t` is the projected input embedding, and `y_t` is the channel output used to build a memory context string.

### WebGPU Kernels (WGSL)

The selective scan is implemented as a WGSL compute shader dispatched via a `@compute @workgroup_size(64)` kernel:

```
WebGPU Runtime
 ├── Transformers.js pipeline   (existing)
 ├── LoRA training kernels      (existing)
 └── mamba_scan.wgsl            (new — selective scan kernel)
```

**Buffers:**

| Buffer | Usage | Size |
|---|---|---|
| `paramsBuffer` | UNIFORM | 16 bytes (dim, order, channels, dt) |
| `stateBuffer` | STORAGE (read) | channels × order × 4 bytes |
| `inputBuffer` | STORAGE (read) | dim × 4 bytes |
| `stateOutBuffer` | STORAGE (write) | channels × order × 4 bytes |
| `outputBuffer` | STORAGE (write) | channels × 4 bytes |

### Fallback Chain

1. **WebGPU WGSL** (preferred) — GPU-accelerated via `GPUComputePipeline`
2. **Pure JavaScript** — identical arithmetic, runs on any device via `jsSelectiveScan()`

### Persistence

| Layer | What is stored | Key |
|---|---|---|
| **IndexedDB** | Active `MambaAgentState` (live state + history ring-buffer) | `mamba_state_<agentId>` |
| **R2** (via agent package download) | `MambaStateSnapshot` embedded in `agent-package.json` | inside `mamba_state` field |

The engine auto-saves after every `step()` call when memory is enabled in AI Chat.

### Text Embedding

Input text is converted to a `dim`-dimensional float vector using a character-level positional hash (no external model required):

```
vec[i % dim] += sin(charCode × 0.01 + i × 0.1)
vec[(i+1) % dim] += cos(charCode × 0.007 + i × 0.07)
// then L2-normalised
```

### Memory Context Injection

After each `step()`, the engine produces a context string:

```
[Memory: step=42 signal=0.731 channels=ch0,ch3,ch7 context="previous turn → last turn"]
```

This string is prepended to the system prompt before Transformer inference.

---

## 20. Agent Runtime SDK

### Overview

`frontend/src/lib/agent-runtime.ts` provides the unified agent execution contract:

```typescript
const runtime = await createAgentRuntime({ agentId, projectId });

// Advance state + run inference
const result = await runtime.step({ userMessage, useMemory: true });

// Train memory (no gradient descent)
await runtime.train({ mode: 'memory', sequences: [...] });

// Train behavior (signals LoRA pipeline)
await runtime.train({ mode: 'behavior' });

// Full hybrid pass
await runtime.train({ mode: 'hybrid', sequences: [...] });

// State management
const snap = runtime.getSnapshot();   // for agent package embedding
await runtime.saveState();             // persist to IndexedDB

// Cloud escalation
const result = await runtime.offload({ type: 'inference', payload: { messages } });
```

### Execution Flow (per step)

```
1. engine.step(userMessage)      → advances Mamba state, returns memoryContext
2. assemble system prompt         → file context + project context + memoryContext
3. sendAIMessage()                → local inference via Workers AI proxy
4. scoreConfidence(response)      → heuristic confidence score (0–1)
5. if confidence < threshold      → escalate to cloud via offload()
6. engine.save()                  → persist updated state to IndexedDB
```

### Training Modes

| Mode | What happens |
|---|---|
| `behavior` | Signals caller to run the existing LoRA fine-tuning pipeline |
| `memory` | Runs `engine.trainMemory(sequences)` — advances state over historical data, no gradients |
| `hybrid` | Memory pass first, then behavior signal |

### Confidence Scoring

A lightweight heuristic scores response quality:

- Base score = `min(1, response.length / 500)`
- Penalty of 0.1 per hedge phrase (`"I think"`, `"maybe"`, `"not sure"`, etc.)
- Threshold (default `0.4`) — responses below this trigger cloud escalation

---

## 21. WebGPU Runtime Layer

The unified WebGPU runtime now hosts three subsystems:

```
WebGPU Runtime
 ├── Transformers.js    (existing — ONNX model inference)
 ├── LoRA training      (existing — gradient accumulation kernels)
 └── Mamba engine       (new — selective scan WGSL kernel)
```

All three subsystems share the same `GPUDevice` obtained via `navigator.gpu.requestAdapter()`. If WebGPU is unavailable, each subsystem degrades gracefully:

| Subsystem | Fallback |
|---|---|
| Transformers.js | ONNX WASM (CPU) |
| LoRA training | Cloud GPU offload via Workers AI |
| Mamba engine | Pure JavaScript SSM (`jsSelectiveScan`) |

---

## 22. Storage Integration

### Extended Storage Map

| Store | Technology | Contents |
|---|---|---|
| **R2** | Cloudflare R2 | Project files, datasets, LoRA artifacts, agent packages |
| **Postgres** | Neon Postgres | Projects, training jobs, datasets, published agents |
| **IndexedDB** (new) | Browser IndexedDB | Active Mamba agent state, training checkpoints |

### IndexedDB Schema

```
Database: builderforce_mamba  (version 1)
└── Object store: agent_states  (keyPath: agentId)
    └── MambaAgentState {
          agentId, projectId, version,
          snapshot: MambaStateSnapshot,
          history: string[],
          updatedAt
        }
```

### Agent Package Format (v2.0)

Agents trained with Memory or Hybrid mode are published as **v2.0 packages**:

```jsonc
{
  "version": "2.0",
  "platform": "builderforce.ai",
  "name": "MyAgent",
  "base_model": "gpt-neox-20m",
  "lora_config": { "rank": 8, "alpha": 16, "target_modules": ["q_proj", "v_proj"] },
  "mamba_state": {
    "data": [0.12, -0.05, ...],   // Float32 packed state
    "dim": 64,
    "order": 4,
    "channels": 16,
    "step": 142
  },
  "created_at": "2026-03-18T07:00:00.000Z"
}
```

Agents without a Mamba snapshot remain **v1.0** packages (backward compatible).

### Agent State Viewer Panel

A new right-panel tab **🔬 State** renders the `AgentStateViewer` component:

- **State summary cards** — step counter, channels, order, dim
- **Heatmap visualisation** — colour-coded channel activation (blue = positive, red = negative)
- **Interaction history** — last 10 entries from the history ring-buffer
- **Sequence replay** — replay arbitrary sequences against a copy of the current state and observe memory evolution in real-time
- **Reset** — zero the state and persist

---

*End of Architecture Document*
