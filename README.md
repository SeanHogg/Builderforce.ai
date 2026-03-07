# Builderforce.ai

A minimal **browser-based AI coding platform** (Replit / AI Studio style) built on a **Cloudflare-first architecture** with **WebContainers** to minimise backend compute while supporting real-time collaboration and highly performant communication.

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
