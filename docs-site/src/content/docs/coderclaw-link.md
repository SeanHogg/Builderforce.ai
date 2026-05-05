---
summary: "Builderforce — orchestration portal (replaces builderforce.ai) with project/task management, Kanban/List/Gantt views, and OpenRouter integration"
read_when:
  - You want to manage projects and tasks in a Jira-style web UI
  - You want to use AI to write PRDs and task descriptions
  - You want Kanban, List, or Gantt views for your work
  - You want to connect CoderClaw agents to the orchestration API
title: "Builderforce (Orchestration)"
---

# Builderforce (Orchestration)

**[Builderforce.ai](https://builderforce.ai)** is the orchestration platform for the CoderClaw ecosystem (builderforce.ai has been replaced by Builderforce.ai). Portal at [builderforce.ai](https://builderforce.ai), API at **api.builderforce.ai**. It provides a Jira-style web UI for managing projects, tasks, and AI agent mesh — with Kanban, List, and Gantt views, AI-powered PRD writing via OpenRouter, drag-and-drop task management, and full multi-tenant workspace support.

## Features

### Task Board Views

Builderforce supports three task board views you can switch between at any time:

- **Kanban** — swim-lane board with drag-and-drop between columns (To Do, In Progress, In Review, Done, Blocked)
- **List** — sortable table view with all task fields visible at a glance
- **Gantt** — timeline chart showing task start/due dates as horizontal bars, with today marker and overdue highlighting

### AI-Powered Task & PRD Writing

Use OpenRouter to generate detailed task descriptions and PRDs directly in the task creation and edit forms:

1. Go to **Workspace → AI Settings**
2. Enter your [OpenRouter API key](https://openrouter.ai/keys)
3. Select a model (Claude Sonnet 4.6 recommended)
4. When creating or editing a task, click **✨ Generate with AI** to auto-write a full PRD including:
   - Objective and background
   - Acceptance criteria checklist
   - Technical implementation notes
   - Edge cases to consider

### Task Management

Each task supports:
- **Status**: To Do, In Progress, In Review, Done, Blocked
- **Priority**: Low, Medium, High, Critical
- **Agent assignment**: Claude, OpenAI, Ollama, HTTP
- **Start date & Due date** (used in Gantt view)
- **GitHub PR link** (auto-set when agent creates a PR)
- **Description / PRD** (AI-generated or manual)

### Project Management

- Create projects with a unique key (e.g., `PROJ`)
- Link to a GitHub repository for PR automation
- Auto-incremented task keys (e.g., `PROJ-001`)

### Multi-Tenant Workspaces

- Create isolated workspaces for different teams or repositories
- Invite members with roles: Viewer, Developer, Manager, Owner
- Switch between workspaces instantly

### CoderClaw Mesh

- Register any number of CoderClaw instances (claws) to your workspace
- Each claw gets a unique one-time API key
- Assign marketplace skills to your entire workspace or individual claws
- Each registered claw maintains a **live WebSocket relay** via `ClawRelayDO`:
  - When the claw's gateway is running, it connects to the relay automatically
  - Browser users can chat directly with the remote agent from the Claw panel
  - Relay status (online/offline, last seen timestamp) is shown in real time

## Architecture

Builderforce is built on:
- **Cloudflare Workers** — serverless edge hosting
- **Hono** — lightweight TypeScript web framework
- **Drizzle ORM + Neon Postgres** — type-safe database with serverless PostgreSQL
- **Clean Architecture** — Domain → Application → Infrastructure → Presentation layers
- **JWT authentication** — web tokens (no-tenant) and tenant-scoped tokens

## Quick Start

### 1. Sign up

Go to [builderforce.ai](https://builderforce.ai) and create a free account.

### 2. Create a workspace

After logging in, create your first workspace. This is your tenant — a fully isolated environment for your team.

### 3. Create a project

Navigate to **Projects → + New Project**. Set a short key (e.g., `APP`) and a name.

### 4. Add tasks

Go to **Tasks → + New Task**. Enter a title, then click **✨ Generate with AI** to auto-write the description using OpenRouter, or write it manually.

Set start and due dates to use the Gantt view.

### 5. Register your CoderClaw

Go to **Claws → + Register Claw**. Copy the one-time API key. CoderClaw reads two environment variables from `~/.coderclaw/.env`:

```bash
CODERCLAW_LINK_API_KEY=your-key-here   # one-time key from the Claws panel
CODERCLAW_LINK_URL=https://api.builderforce.ai  # default
```

You also need the claw's instance ID in your project's `.coderClaw/context.yaml` (set automatically by `coderclaw link` or the onboarding wizard):

```yaml
clawLink:
  instanceId: "42"          # numeric ID from the Claws panel
  instanceSlug: my-project
```

Once both are present, starting the CoderClaw gateway connects the relay automatically.

### 6. Configure AI settings

Go to **Workspace → AI Settings** and enter your OpenRouter API key. Choose your preferred model.

## OpenRouter Integration

Builderforce uses [OpenRouter](https://openrouter.ai) as a unified gateway to access Claude, GPT-4o, Gemini, Llama, and other models for task and PRD generation.

**Supported models:**
| Model | Notes |
|-------|-------|
| `anthropic/claude-sonnet-4-6` | Recommended — best quality |
| `anthropic/claude-opus-4-6` | Highest capability |
| `anthropic/claude-haiku-4-5` | Fastest |
| `openai/gpt-4o` | Strong alternative |
| `openai/gpt-4o-mini` | Fast and cheap |
| `google/gemini-2.0-flash-001` | Good quality/speed ratio |
| `meta-llama/llama-3.3-70b-instruct` | Open-weight model |

Your API key is stored locally in your browser and never sent to Builderforce servers. All AI calls go directly from your browser to OpenRouter.

## Task Status Flow

```
todo → in_progress → in_review → done
            ↓
         blocked
```

Drag cards between columns in Kanban view, or use the Status dropdown in the task edit modal.

## Gantt View

The Gantt view shows all tasks as horizontal timeline bars. Tasks without explicit start/due dates use `createdAt` as start and `createdAt + 7 days` as end for display purposes.

- **Bars are colored by status** (blue = in progress, cyan = in review, green = done, red = blocked)
- **Overdue tasks** are highlighted with a red outline
- **Today marker** shows the current date as a red vertical line
- Click any bar or row to open the task edit modal

## Task assignment flow (Builderforce → claw)

When you create or assign a task in Builderforce to a claw, the following happens. The table also shows **where in the app** you see each part of the flow.

| Step | Where | What happens | Where user sees it |
|------|--------|----------------|---------------------|
| 1 | **Builderforce** | Task created (title, description, optional artifacts: skills, personas, content; task ID, execution ID). | **Tasks** (Kanban / List / Gantt), task edit modal. |
| 2 | **Builderforce** | Assignment sent to the claw over the upstream WebSocket (`task.assign` or `task.broadcast`). | Task appears as assigned to that claw; assignment may be triggered from task modal or **Workforce**. |
| 3 | **Claw (relay)** | Relay receives message; calls `artifacts.sync` then `chat.send` for the main session. | — (backend). |
| 4 | **Claw (gateway)** | Artifacts applied; agent runs for the new user message (streaming, tools). | **CoderClaw TUI or WebChat**: new user message with task title/description; agent response streams as usual. |
| 5 | **Claw (relay)** | All chat events (deltas, messages, tool use) forwarded back over the upstream WebSocket to Builderforce. | — (relay). |
| 6 | **Builderforce** | `ClawRelayDO` receives events and **broadcasts** them to every browser client connected to that claw’s WebSocket (`/api/claws/:id/ws`). | **Builderforce UI → Claw panel** (slide-out from **Dashboard**, **Projects**, or **Workforce** when you click a claw). The live stream is delivered on that connection. Today: **Debug** tab uses it for Status/Health and manual RPC; **Observability** tab (Logs / Timeline) is the intended place for execution and task flow (Timeline is placeholder until execution data is wired). New clients also get a **chat.history** replay and complete messages are persisted for future task/activity views. |
| 7 | **Builderforce** | Run “complete” when the agent sends a final message; no separate completion API call from the claw. | Builderforce infers completion from the stream; you see the final reply in **CoderClaw TUI/WebChat** and, when implemented, in the Claw panel’s execution/Timeline view. |

So for **#6 (where you see the artifact)**: open the **Claw panel** for that claw (from Dashboard, Projects, or Workforce). The relay stream is available on the same WebSocket the **Debug** tab uses; a dedicated task/execution or **Observability → Timeline** view would show the live agent output (Timeline is placeholder today).

## Connecting CoderClaw to Builderforce

CoderClaw connects to Builderforce in two ways simultaneously when the gateway starts.

### 1. WebSocket Relay (real-time chat)

`ClawLinkRelayService` opens a persistent WebSocket to the `ClawRelayDO` Durable Object for the registered claw:

```
GET wss://api.builderforce.ai/api/claws/:id/upstream?key=<apiKey>
```

This enables:
- **Browser → agent**: messages typed in the browser Claw panel are forwarded to the local gateway in real time
- **Agent → browser**: streaming responses (deltas, tool calls, results) are broadcast to all connected browser sessions
- **Heartbeat**: a `PATCH /api/claws/:id/heartbeat` keeps the "Last seen" timestamp fresh every 5 minutes

### 2. HTTP Task API

CoderClaw agents can submit tasks directly via the execution API:

```
POST /api/runtime/executions           Submit a task for agent execution
GET  /api/runtime/executions/:id       Get execution state
PATCH /api/runtime/executions/:id/state  Agent callback to update state
```

```typescript
import { ClawLinkTransportAdapter } from "coderclaw/transport";

const adapter = new ClawLinkTransportAdapter({
  baseUrl: "https://api.builderforce.ai",
  apiKey: process.env.CODERCLAW_LINK_API_KEY,
});

await adapter.connect();
const state = await adapter.submitTask({
  agentId: "claude",
  description: "Implement login page",
  input: "Create a login component with email + password fields",
});
```

## API Reference

All API endpoints are at `https://api.builderforce.ai`.

### Tasks
| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/tasks?project_id=1` | List tasks (tenant-scoped) |
| `GET`    | `/api/tasks/:id` | Get task |
| `POST`   | `/api/tasks` | Create task |
| `PATCH`  | `/api/tasks/:id` | Update task (status, title, dates, etc.) |
| `DELETE` | `/api/tasks/:id` | Delete task |

### Projects
| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/projects` | List projects |
| `POST`   | `/api/projects` | Create project |
| `PATCH`  | `/api/projects/:id` | Update project |
| `DELETE` | `/api/projects/:id` | Delete project |

### Claws (Agent Instances)
| Method | Path | Description |
|--------|------|-------------|
| `GET`    | `/api/claws` | List registered claws (tenant-scoped) |
| `POST`   | `/api/claws` | Register a new claw (returns one-time API key) |
| `DELETE` | `/api/claws/:id` | Remove a claw |
| `GET`    | `/api/claws/:id/status` | Connection status (`connectedAt`, `lastSeenAt`) |
| `PATCH`  | `/api/claws/:id/heartbeat?key=<apiKey>` | Update last-seen timestamp |
| `GET`    | `/api/claws/:id/ws?token=<jwt>` | Browser WebSocket connection to relay |
| `GET`    | `/api/claws/:id/upstream?key=<apiKey>` | CoderClaw upstream WebSocket to relay |

### Runtime (Agent Execution)
| Method | Path | Description |
|--------|------|-------------|
| `POST`   | `/api/runtime/executions` | Submit task for execution |
| `GET`    | `/api/runtime/executions` | List executions |
| `GET`    | `/api/runtime/executions/:id` | Get execution state |
| `POST`   | `/api/runtime/executions/:id/cancel` | Cancel execution |
| `PATCH`  | `/api/runtime/executions/:id/state` | Agent state callback |

### Auth
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/web/register` | Register |
| `POST` | `/api/auth/web/login` | Login |
| `POST` | `/api/auth/tenant-token` | Get tenant-scoped JWT |

## Further reading

- **[Orchestration docs](/link/)** — Full documentation (Builderforce.ai replaces builderforce.ai): [Getting Started](/link/getting-started/), [Architecture](/link/architecture/), [API Reference](/link/api-reference/), [Marketplace](/link/marketplace/), [Multi-Agent Orchestration](/link/multi-agent-orchestration/), [Pricing](/link/pricing/), [Visual Debugging](/link/visual-debugging/).
- [Builderforce.ai](https://builderforce.ai) · [builderforce.ai repository (legacy)](https://github.com/SeanHogg/builderforce.ai)
- [OpenRouter documentation](https://openrouter.ai/docs)
- [CoderClaw workflows](/coderclaw-workflows)
- [Phase 2 distributed runtime](/phase2)
