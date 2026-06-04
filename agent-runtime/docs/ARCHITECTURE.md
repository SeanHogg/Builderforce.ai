# BuilderForce Agents Architecture

> Last updated: 2026-03-04  
> See also: [Vision](VISION.md) · [Feature Gap Analysis](FEATURE_GAP_ANALYSIS.md) · [Business Roadmap](BUSINESS_ROADMAP.md)

## Overview

BuilderForce Agents is a self-hosted AI coding agent gateway that runs on developer machines.  
It provides **7 built-in agent roles**, a **multi-agent orchestrator**, **53 skills**, a
**semantic knowledge loop**, and a **WebSocket-based transport layer**. It connects to
**builderforce.ai** (cloud portal) for fleet management, task delegation, approval
workflows, and observability.

---

## System Diagram

```
Human Developer
  │  (TUI / IDE / messaging channel)
  ▼
┌──────────────────────────────────────────────────────────────┐
│                    BuilderForce Agents Gateway                          │
│                  ws://127.0.0.1:18789                         │
│                                                               │
│  ┌────────────┐  ┌─────────────────────────────────────┐     │
│  │  Sessions   │  │        Agent Dispatcher              │     │
│  │  (in-mem)   │  │  spawnSubagentDirect (roles+persona) │     │
│  └────────────┘  └─────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Tool Registry                                         │     │
│  │  Core: create | edit | view | bash | grep | glob      │     │
│  │  BuilderForce Agents: orchestrate | workflow_status |           │     │
│  │    code_analysis | project_knowledge | git_history    │     │
│  │    save_session_handoff | agent_fleet                  │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ TUI Slash Commands                                    │     │
│  │  /agent  /model  /think  /session  /init  /handoff   │     │
│  │  /compact  /spec  /workflow  /project  /sync         │     │
│  │  /verbose  /reasoning  /usage  /elevated  /gateway   │     │
│  │  /logs  /setup  /new  /reset  /abort  /exit          │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Orchestrator (dependency DAG + persistence)          │     │
│  │  Workflow types: feature | bugfix | refactor |        │     │
│  │    planning | adversarial | custom                    │     │
│  │  Roles: code-creator | code-reviewer | test-generator│     │
│  │    bug-analyzer | refactor-agent | documentation-    │     │
│  │    agent | architecture-advisor + persona plugins    │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Persona Plugin Registry                               │     │
│  │  Built-ins → user-global → project-local → agenthub  │     │
│  │  → agentlink-assigned (highest precedence)            │     │
│  │  PERSONA.yaml format, marketplace metadata, versioned│     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ BuilderForce AgentsLLM Brain (local or external fallback)      │     │
│  │  Amygdala: SmolLM2 (q4, ~0.9 GB) · Hippocampus: Qwen3-0.6B (q4f16, ~2.3 GB) │     │
│  │  Syscheck: RAM ≥ 2 GB free + disk ≥ 4 GB free (~3.5 GB total download)    │     │
│  │  Fallback: external LLM (Ollama / OpenAI-compat)    │     │
│  │  Memory + RAG + persona block injected into brain   │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Knowledge Loop (KnowledgeLoopService)                 │     │
│  │  Per-run: files created/edited, tools used            │     │
│  │  Semantic summary (heuristic, no model call)          │     │
│  │  Writes: .builderforce/memory/YYYY-MM-DD.md              │     │
│  │  Auto-syncs to builderforce.ai on completion            │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Extension System                                      │     │
│  │  diagnostics-otel | memory-core | memory-lancedb     │     │
│  │  channels: Discord, Slack, Telegram, Matrix, IRC…    │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ Model Providers (30+)                                 │     │
│  │  Anthropic | OpenAI | Google | Ollama | Bedrock      │     │
│  │  vLLM | Together | HuggingFace | Cloudflare | Venice │     │
│  │  Qianfan | MiniMax | Moonshot | NVIDIA | Qwen…       │     │
│  └─────────────────────────────────────────────────────┘     │
└──────────────────────────────────────┬───────────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────┐
│                  AgentLink Transport Layer                      │
│                                                               │
│  AgentLinkRelayService (WS)                                    │
│  → wss://.../api/agents/:id/upstream?key=…                    │
│  → bridges browser ↔ local gateway (bidirectional)           │
│  → PATCH .../heartbeat every 5 min (capabilities payload)    │
│  → receives remote.task, task.assign, task.broadcast          │
│                                                               │
│  AgentLinkDirectorySync (HTTP)                                 │
│  → PUT /api/agents/:id/directories/sync?key=…                 │
│  → one-way upload of .builderforce/ files (max 200 × 512 KB)    │
│                                                               │
│  AgentLinkTransportAdapter (HTTP)                              │
│  → POST /api/runtime/executions                               │
│  → GET  /api/runtime/executions/:id   (polling)              │
│  → POST /api/runtime/executions/:id/cancel                    │
│                                                               │
│  Remote Subagent Dispatch (HTTP)                              │
│  → POST /api/agents/:targetId/forward?from=…&key=…            │
│  → fleet discovery: GET /api/agents/fleet?from=…&key=…        │
└──────────────────────────────────────┬───────────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────┐
│                   builderforce.ai  (Cloud)                       │
│                                                               │
│  Runtime: Hono on Cloudflare Workers                          │
│  DB: Drizzle ORM → Postgres (Hyperdrive)                     │
│  Real-time: AgentNodeRelayDO (Durable Object — WS relay hub)       │
│  SPA: React management portal                                 │
│                                                               │
│  Current API surface:                                         │
│    Auth, Tenants, Agents, Projects, Fleet, Heartbeat,          │
│    Directory Sync, Runtime Executions, Remote Dispatch        │
│    Persona Assignment API (planned)                           │
└──────────────────────────────────────────────────────────────┘
```

---

## Core Modules

### Gateway (`src/gateway/`)

- WebSocket server on port 18789
- JSON-RPC message protocol
- Session management (create, switch, reset, message history)
- Agent dispatch — spawns subagents with tool access and persona identity

### Agent System (`src/agents/`)

- `subagent-spawn.ts` — `spawnSubagentDirect()`: primary agent execution engine; injects
  structured `--- Agent Persona ---` block into every sub-agent's system prompt
- `agent-scope.ts` — resolves agent configuration from YAML config
- `model-selection.ts` — model routing, allowlists, provider resolution
- `system-prompt.ts` — modular system prompt builder (full / minimal / none modes)
- `tools/` — core tools: create, edit, view, bash, grep, glob, task
- `context.ts` — context window discovery and token budget management
- `pi-embedded-runner/` — embedded agent runner with auto-compaction, safety timeout,
  post-compaction audit, tool-result context guard

#### BuilderForce AgentsLLM Brain (`src/agents/builderforcellm-local-stream.ts`)

Two-tier reasoning engine:

1. **Syscheck** — on first request checks free RAM (≥ 2 GB) and disk space (≥ 4 GB
   when models not yet cached; ~3.5 GB total download for amygdala + hippocampus).
   If requirements are not met, the factory transparently routes all requests to the
   configured external LLM instead (`callExecutionLlm`).
2. **Brain tier** — Amygdala: SmolLM2-1.7B (ONNX q4, ~0.9 GB). Hippocampus: Qwen3-0.6B-ONNX (q4f16, ~2.3 GB). Reads `.builderforce` memory,
   RAG-retrieved workspace context, and the sub-agent's **persona block** (injected via
   `context.systemPrompt`). Calls tools up to 3 rounds. Decides: HANDLE or DELEGATE.
3. **Execution tier** — configured Ollama / OpenAI-compatible LLM handles complex
   multi-file work when brain DELEGATEs (also used as the brain when syscheck fails).
4. **Multi-step chain** — on DELEGATE: plan pass → code pass → execution feedback →
   optional fix pass.

Each sub-agent spawn creates a **fresh brain instance** — memory + RAG + persona are
re-loaded per spawn so sub-agents have isolated, role-specific identities.

### BuilderForce Agents Layer (`src/builderforce/`)

- `agent-roles.ts` — 7 built-in roles with `persona` + `outputFormat` definitions.
  `findAgentRole()` resolves in order: built-ins → `.builderforce/personas/` (project-local) →
  `PersonaRegistry` (marketplace / builderforce.ai). `registerCustomRoles()` /
  `clearCustomRoles()` for runtime management.
- `personas.ts` — **`PersonaRegistry`**: plugin install/activate/assign lifecycle;
  loads from `~/.builderforce/personas/` (user-global), `.builderforce/personas/` (project),
  AgentHub-installed files, and builderforce.ai assignments.
  `buildPersonaSystemBlock()` encodes a role's voice/perspective/decisionStyle/
  outputFormat into a structured `--- Agent Persona ---` section for brain injection.
- `orchestrator.ts` — workflow engine: dependency DAG, task scheduling, disk persistence,
  `remote:<agentNodeId>` routing. `buildStructuredContext()` produces labelled per-agent
  context blocks (using `outputFormat.outputPrefix`) instead of plain text concatenation,
  so each agent knows which prior agent produced which output.
- `orchestrator-enhanced.ts` — workflow factory functions: `createPlanningWorkflow()`,
  `createFeatureWorkflow()`, `createBugFixWorkflow()`, `createRefactorWorkflow()`,
  `createAdversarialReviewWorkflow()`
- `project-context.ts` — `.builderforce/` directory management, YAML I/O, session handoff,
  workflow state persistence, knowledge memory append. Adds `personasDir` to
  `BuilderForce AgentsDirectory`; `loadProjectPersonaPlugins()`, `loadPersonaAssignments()`,
  `savePersonaAssignment()`, `removePersonaAssignment()`.
- `staged-edits.ts` — **staged edit buffer** for inline diff/accept/reject pair programming
- `types.ts` — all domain types: `ProjectContext`, `AgentRole`, `AgentPersona`,
  `AgentOutputFormat`, `TaskHandoff`, `PersonaPlugin`, `PersonaPluginMetadata`,
  `PersonaSource`, `PersonaAssignment`, `SessionHandoff`, `CodeMap`
- `tools/` — orchestrate, workflow_status, code_analysis, project_knowledge,
  git_history, save_session_handoff, agent_fleet, codebase_search

### TUI (`src/tui/`)

- `@mariozechner/pi-tui` terminal interface with full slash command set
- Key commands: `/spec <goal>` (planning workflow), `/workflow [id]` (status),
  `/compact`, `/handoff`, `/diff`, `/accept`, `/reject`

### MCP Server (`src/gateway/mcp-server-http.ts`)

- Exposes BuilderForce Agents tools at `http://localhost:18789/mcp` (MCP 2024-11-05 / JSON-RPC 2.0)
- Tools: `codebase_search`, `project_knowledge`, `git_history`, `workflow_status`, `agent_fleet`
- Add to Cursor / Continue.dev as an MCP server for semantic search inside your IDE

---

## Persona Plugin System

### Loading Precedence (highest wins)

```
agentlink-assigned  ← pushed from builderforce.ai by an operator
      agenthub      ← installed from AgentHub marketplace (agenthub install <name>)
  project-local    ← .builderforce/personas/*.yaml  (this project only)
   user-global     ← ~/.builderforce/personas/*.yaml (all projects on this machine)
     builtin       ← shipped in BuilderForce Agents core (always available)
```

Built-ins cannot be overridden — they form the stable floor. Marketplace personas
extend the set with new names or replace nothing.

### PERSONA.yaml Format

```yaml
name: senior-security-reviewer
description: "Adversarial security review specialist"
version: "1.0.0"
author: acme-corp
agenthubId: acme/senior-security-reviewer
license: Commercial
requiresLicense: true
tags: [security, compliance, backend]

capabilities:
  - OWASP Top 10 vulnerability detection
  - Supply chain risk assessment
tools: [view, grep, glob, bash]
model: anthropic/claude-opus-4-20250514
thinking: high

systemPrompt: |
  You are a senior security engineer with 15+ years of experience...

persona:
  voice: "skeptical and thorough"
  perspective: "every external input is untrusted until proven safe"
  decisionStyle: "risk-first: flag all potential vulnerabilities, not just obvious ones"

outputFormat:
  structure: markdown
  requiredSections:
    - "## Security Findings"
    - "## Risk Assessment"
    - "## Remediation"
  outputPrefix: "SECURITY:"

constraints:
  - Never approve code with unvalidated external input
  - Flag all third-party dependencies for license review
```

### Persona → Brain Injection Flow

```
1. orchestrator.executeTask() calls spawnSubagentDirect({ roleConfig })
2. subagent-spawn.ts appends to childSystemPrompt:
     "--- Role Guidance ---\n<systemPrompt>"
     "--- Agent Persona ---\nRole: ...\nVoice: ...\nPerspective: ...\n..."
3. Sub-agent session is created with this enriched system prompt
4. BuilderForce AgentsLLM brain receives it as context.systemPrompt
5. brainSystem = [context.systemPrompt, memoryBlock, ragContext, BRAIN_SYSTEM_PROMPT]
6. Brain reasons with full persona identity on BOTH direct and DELEGATE paths
7. Each sub-agent spawn → new brain instance → isolated persona identity
```

### builderforce.ai Persona Assignment

Operators assign marketplace personas to specific agents via the builderforce.ai portal:

```
builderforce.ai assigns persona → context.yaml personas.assignments updated
                               → gateway reads on startup → applyAssignments()
                               → persona.active = true for matching plugins
```

The `PersonaAssignment` record stored in `context.yaml`:

```yaml
personas:
  assignments:
    - name: senior-security-reviewer
      agenthubId: acme/senior-security-reviewer
      assignedByAgentLink: true
      assignedAt: "2026-03-04T11:00:00Z"
```

---

## Sub-Agent Context Execution

### Structured Context Between Agents

The orchestrator's `buildStructuredContext()` produces labelled sections instead of
naive text concatenation:

```
## Your Task

<task.input>

## Context from Prior Agents

### REVIEW: (code-reviewer)

<prior agent output>

---

### ARCH: (architecture-advisor)

<prior agent output>
```

The `outputPrefix` field from `AgentOutputFormat` (e.g. `"REVIEW:"`, `"ARCH:"`, `"TESTS:"`)
labels each prior agent's section so the receiving agent can quickly find the relevant input.

### Sub-Agent Personality Management

- Each `spawnSubagentDirect()` call creates a **new session** with its own system prompt
- The system prompt carries: `--- Role Guidance ---` (behavior rules) + `--- Agent Persona ---` (identity)
- The BuilderForce AgentsLLM brain is **stateless between spawns** — every spawn re-loads memory + RAG
- Personas propagate through nested workflows naturally: each depth level gets its own role config
- The `PersonaRegistry` is process-wide — all agents in a gateway process share the same
  installed persona set, but each spawn gets a fresh brain context

---

## Data Flows

### Agent Task Execution

```
1. User sends message via TUI / WS / channel
2. Gateway routes to active session
3. Session dispatches to agent (via spawnSubagentDirect)
4. Syscheck: validate RAM + disk; select local brain or external fallback
5. Agent receives system prompt (role guidance + persona block) + tools + message
6. Brain loads memory + RAG + persona; reasons; calls tools; decides handle/delegate
7. KnowledgeLoopService accumulates tool/file activity
8. Agent produces response
9. Response rendered in TUI / forwarded to channel
10. On lifecycle.end: knowledge entry written + builderforce.ai synced
```

### Spec-Driven Development (`/spec`)

```
1. User types: /spec Add real-time collaboration
2. TUI sends structured planning request to agent
3. Agent calls orchestrate tool with workflow: "planning"
4. Orchestrator creates 3-step workflow (all architecture-advisor role):
     Step 1: Write PRD for goal
     Step 2: Write architecture spec  [depends on Step 1]
     Step 3: Decompose into task list [depends on Step 2]
5. Each step: buildStructuredContext() passes labelled prior-agent output
6. Results saved to .builderforce/planning/
7. Agent reports summary to user
```

### builderforce.ai Integration

```
1. builderforce init → login → register agent → get API key
2. API key stored in ~/.builderforce/.env (BUILDERFORCE_AGENTS_LINK_API_KEY)
3. agentNodeLink.instanceId stored in .builderforce/context.yaml
4. On gateway startup:
   a. PersonaRegistry bootstraps: built-ins → user → project → apply assignments
   b. AgentLinkRelayService opens WS to /api/agents/:id/upstream?key=…
   c. AgentLinkDirectorySync uploads .builderforce/ files via HTTP PUT
5. Operator assigns persona in portal → context.yaml updated → registry activates
6. Remote workflows: POST /api/agents/:targetId/forward → remote.task delivered
```

### Multi-Agent Orchestration

```
Explicit target:  role: "remote:<agentNodeId>"
Auto-routing:     role: "remote:auto[cap1,cap2]"
  → selectAgentNodeByCapability() → GET /api/agents/fleet
  → filter by required capabilities → dispatch to best agent
```

---

## Capability Status (as of 2026-03-04)

### ✅ Complete

1. `executeWorkflow()` wired — all 6 workflow types execute end-to-end
2. 7 built-in roles wired — each with `persona`, `outputFormat`, and `constraints`
3. `PersonaRegistry` — plugin install/activate/assign lifecycle; file loading from all sources
4. Structured inter-agent context — `buildStructuredContext()` with labelled role sections
5. Persona → brain injection — `--- Agent Persona ---` block in every sub-agent system prompt
6. BuilderForce AgentsLLM syscheck — RAM + disk check before SmolLM2 load; external LLM fallback
7. Session handoff — `save_session_handoff` tool + `/handoff` + auto-load on start
8. Workflow persistence — checkpoints to `.builderforce/sessions/workflow-*.yaml`; resume after restart
9. Knowledge loop — activity log + builderforce.ai sync + `project_knowledge memory` query
10. Agent mesh — fleet discovery, heartbeat, `/forward` dispatch, `agent_fleet` tool
11. Capability-based agent routing — `remote:auto` / `remote:auto[cap1,cap2]`
12. `/spec`, `/workflow`, `/compact`, `/handoff` TUI commands
13. Staged edits — `/diff`, `/accept`, `/reject`
14. `codebase_search` tool + MCP server at `GET /mcp`

### 🔲 Open Items

- AgentHub marketplace download/install flow (client-side types ready, backend pending)
- builderforce.ai: Persona Assignment API endpoint
- Remote task result streaming (agent-to-agent result channel)
- Semantic knowledge synthesis (architecture.md auto-update after structural edits)
- VS Code extension (sidebar + inline diff decoration)
- Tab autocomplete / FIM proxy endpoint
- Session auto-checkpoint on exit

---

## Project Layout

```
src/
  agents/         Agent execution engine, brain, skills, syscheck
  builderforce/      Orchestrator, roles, personas, types, tools
  gateway/        WebSocket server, MCP server, session management
  tui/            Terminal UI, slash commands
  infra/          AgentLink relay, directory sync, knowledge loop
  transport/      Transport abstraction layer
  config/         Config loading and types
  logging/        Subsystem logger
extensions/       Channel and memory plugins
skills/           53 bundled skill definitions (SKILL.md + tool mappings)
.builderforce/
  personas/       Custom role YAML files (.builderforce/personas/*.yaml)
  personas/       Project-scoped persona plugins (.builderforce/personas/*.yaml)
  planning/       Agent context: roadmap, capability gaps, architecture ref
  memory/         Daily knowledge log (YYYY-MM-DD.md)
  sessions/       Workflow checkpoints + session handoffs
```

**File-location policy:** The product only creates or updates files under (1) **project-local** `<cwd>/.builderforce/` or (2) **global** `~/.builderforce/` (or `BUILDERFORCE_AGENTS_STATE_DIR`). Logs, model cache, config, and daemon scripts use the global directory; project context, memory, and sessions use the project directory.
