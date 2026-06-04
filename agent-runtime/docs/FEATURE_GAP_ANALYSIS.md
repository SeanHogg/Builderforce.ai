# BuilderForce Agents Feature Gap Analysis

> Last updated: 2026-03-04  
> Primary competitive focus: **Cursor** and **Continue.dev**  
> See also: [Business Roadmap](BUSINESS_ROADMAP.md)

## Strategic Objective

BuilderForce Agents's immediate competitive goal is to **out-feature Cursor and Continue.dev** while
maintaining our open-source, self-hosted, model-agnostic advantage. These two tools
represent the largest share of the AI coding assistant market and the developers most
likely to switch to BuilderForce Agents.

- **Cursor** ($20/user/month, closed source): IDE fork of VS Code with Composer multi-file
  agent, semantic codebase indexing, MCP support, and a slick diff-acceptance UX.
- **Continue.dev** (free, MIT): VS Code + JetBrains extension, MCP-first, local model
  support, fully customisable, but single-agent and no orchestration.

Our thesis: BuilderForce Agents already wins on orchestration depth, self-hosting, and multi-channel
access. We need to close five specific gaps before those advantages become irrelevant.

---

## Head-to-Head: BuilderForce Agents vs. Cursor vs. Continue.dev

| Feature                                | **BuilderForce Agents**           | **Cursor**         | **Continue.dev**       |
| -------------------------------------- | ----------------------- | ------------------ | ---------------------- |
| **Price**                              | Free (MIT)              | $20/user/month     | Free (MIT)             |
| **Self-hosted**                        | ✅ Full                 | ❌ Cloud only      | ✅ Extension           |
| **Any model provider**                 | ✅ 30+ providers        | ⚠️ Limited list    | ✅ Any (Ollama, API)   |
| **MCP support**                        | ⚠️ consume via mcporter | ✅ Native (full)   | ✅ Native (full)       |
| **Expose tools as MCP server**         | 🔲 Planned P0-4         | ❌                 | ❌                     |
| **Codebase semantic search**           | 🔲 Planned P0           | ✅ `@codebase`     | ✅ `@codebase`         |
| **Inline diff / accept-reject**        | 🔲 Planned P1           | ✅ Composer panel  | ✅ `⌘K` diff           |
| **Tab autocomplete**                   | ❌                      | ✅ Native          | ✅ Native              |
| **IDE extension**                      | 🔲 Planned              | ✅ VS Code fork    | ✅ VS Code + JetBrains |
| **Multi-agent orchestration**          | ✅ 7 roles + DAG        | ❌ Single agent    | ❌ Single agent        |
| **Planning workflow (PRD→Tasks)**      | ✅ `/spec`              | ❌                 | ❌                     |
| **Adversarial review pass**            | ✅ Built-in             | ❌                 | ❌                     |
| **Workflow persistence**               | ✅ YAML checkpoint      | ❌                 | ❌                     |
| **Persistent project memory**          | ✅ `.builderforce/`        | ⚠️ In-session only | ⚠️ In-session only     |
| **Session handoffs**                   | ✅ `/handoff`           | ❌                 | ❌                     |
| **Agent-to-agent delegation**            | ✅ `remote:<agentNodeId>`    | ❌                 | ❌                     |
| **Works in WhatsApp/Telegram/Slack**   | ✅                      | ❌                 | ❌                     |
| **AST-level code analysis**            | ✅                      | ⚠️ Basic RAG       | ⚠️ Basic RAG           |
| **Live workflow dashboard**            | 🔲 Planned P0           | ❌                 | ❌                     |
| **Git-aware context (blame/hotspots)** | ✅ `git_history`        | ⚠️ Basic diff      | ❌                     |
| **RBAC + audit trails**                | ✅                      | ❌                 | ❌                     |
| **Open source**                        | ✅ MIT                  | ❌                 | ✅ MIT                 |

**Legend**: ✅ Available · ⚠️ Partial · ❌ Not available · 🔲 Planned

---

## Priority Gap Analysis: What We Must Close

### Gap 1 — MCP: Consume AND Expose (P0)

**What Cursor and Continue.dev do:**  
Both tools treat MCP as a first-class citizen. Cursor supports MCP tool calls in Composer
agent mode. Continue.dev was built MCP-first and any MCP server can supply context or
actions. Developers who use Cursor/Continue expect their existing MCP servers to just work.

**What BuilderForce Agents does today:**  
BuilderForce Agents can _consume_ MCP servers via the `mcporter` bridge, but there is no dedicated
integration path and it is not surfaced prominently. More critically, BuilderForce Agents does
**not expose its own tools as an MCP server**, so Cursor and Continue.dev users cannot
call `project_knowledge`, `codebase_search`, or `git_history` from inside their IDE.

**Why this matters for competing with Cursor/Continue:**  
Developers migrating to BuilderForce Agents want their Cursor `@codebase` context and their
Continue.dev MCP servers to keep working. Without a first-class MCP story on both sides
(consume + provide), BuilderForce Agents feels like a regression.

**Required work:**

1. **MCP Server module** (`src/mcp-server/`): expose BuilderForce Agents tools at
   `http://localhost:18789/mcp` with a standards-compliant manifest + call endpoint.
   - Tools: `project_knowledge`, `codebase_search`, `git_history`, `workflow_status`, `agent_fleet`
   - Auth: API key via `Authorization: Bearer <key>` header
   - Streaming: SSE for long-running tools

2. **First-class MCP consumption**: add `mcpServers` config key; on gateway startup,
   connect to listed MCP servers and register their tools in the tool registry —
   available to all agent roles automatically.

3. **Docs**: "Connect BuilderForce Agents to Cursor / Continue.dev as an MCP server" guide.

**Estimate**: M (4–6 days)  
**Owner**: BuilderForce Agents core (`src/mcp-server/`, `src/gateway/`)

---

### Gap 2 — Codebase Semantic Search (`@codebase`) (P0)

**What Cursor and Continue.dev do:**

- Cursor: `@codebase` builds a vector index of the project; Composer pre-fetches relevant
  files automatically based on the user's request before sending to the model.
- Continue.dev: `@codebase` and `@file` context providers use embeddings (via Ollama or
  remote) for semantic retrieval.

**What BuilderForce Agents does today:**  
`project_knowledge` queries `.builderforce/memory/` with keyword matching. The
`memory-lancedb` extension exists but is not wired into any query path. Agents are
given a task and must call `grep`/`glob` tools themselves to find relevant files —
wasting context budget and producing inconsistent results.

**Why this matters for competing with Cursor/Continue:**  
Semantic retrieval is the single most visible quality difference between basic and
advanced AI coding tools. Users switching from Cursor immediately notice when the agent
doesn't "just know" about the right files.

**Required work:**

1. **Wire `memory-lancedb` into `project_knowledge`**: when `type: "codebase"` query is
   made, embed the query and return top-K results from LanceDB.

2. **New `codebase_search` tool**: `{ query: string, topK?: number }` → returns ranked
   list of `{ filePath, snippet, score }`. Available to all agent roles.

3. **Semantic auto-context injection**: in `spawnSubagentDirect()`, before building the
   system prompt, run a `codebase_search` with the task description and inject top-5
   files as context (similar to Cursor Composer's automatic file inclusion).

4. **Indexing CLI command**: `builderforce index` — builds/refreshes the LanceDB index for
   the current project. Auto-runs on `builderforce init`.

5. **Expose via MCP** (see Gap 1): so Cursor and Continue.dev users get BuilderForce Agents's
   richer semantic index as their `@codebase` context.

**Estimate**: M (5–7 days)  
**Owner**: `src/builderforce/tools/`, `extensions/memory-lancedb/`, `src/agents/subagent-spawn.ts`

---

### Gap 3 — Inline Diff / Accept-Reject Pair Programming (P1)

**What Cursor and Continue.dev do:**

- Cursor Composer: all file changes appear in a side panel as diffs; every change is
  staged with Accept/Reject controls. Nothing is written until the user approves.
- Continue.dev: `⌘K` inline edit shows a diff overlay in the editor; user presses
  `⌘⇧↩` to accept, `⌘⇧⌫` to reject.
- Aider (the CLI benchmark): shows unified diffs before applying and asks confirmation
  on each hunk.

**What BuilderForce Agents does today:**  
`edit` and `create` tools write files immediately. There is no staging, no diff preview,
and no per-file accept/reject. The developer must run `git diff` after the fact to see
what changed.

**Why this matters for competing with Cursor/Continue:**  
This is the #1 UX friction point for developers migrating from Cursor. The "accept this
change" interaction is muscle memory for Cursor users. Without it, BuilderForce Agents feels
dangerous for production codebases.

**Required work:**

1. **Staged edit buffer** (`src/builderforce/staged-edits.ts`): in-memory map of
   `filePath → { originalContent, proposedContent, toolCallId }`.

2. **Modify `edit`/`create` tools**: when `BUILDERFORCE_AGENTS_STAGED=true` (env var or config),
   write to the staged buffer instead of disk; return a `"staged"` confirmation to the agent.

3. **TUI commands**:
   - `/diff` — show all staged changes as unified diff
   - `/diff <file>` — show diff for one file
   - `/accept` — apply all staged changes to disk
   - `/accept <file>` — apply one file
   - `/reject` — discard all staged changes
   - `/reject <file>` — discard one file

4. **Builderforce integration**: staged diffs can be posted to the portal for remote
   review (P1-4 in BUILDERFORCE_AGENTS_LINK_GAPS.md).

**Estimate**: M (4–5 days)  
**Owner**: `src/agents/tools/`, `src/tui/commands.ts`, `src/tui/tui-command-handlers.ts`

---

### Gap 4 — VS Code / IDE Extension (P1)

**What Cursor and Continue.dev do:**

- Cursor _is_ VS Code (fork). All interaction happens in the IDE.
- Continue.dev is a VS Code + JetBrains extension. Developers install it and work in
  their existing editor.

**What BuilderForce Agents does today:**  
BuilderForce Agents is terminal-first (TUI) or messaging-channel-based. There is no VS Code
extension. Developers who live in VS Code must switch to a terminal to use BuilderForce Agents.

**Why this matters for competing with Cursor/Continue:**  
IDE presence is table stakes for competing in this market. Without a VS Code extension,
BuilderForce Agents is inaccessible to the 70%+ of developers who primarily work in VS Code.

**Required work (phased):**

**Phase A — VS Code Extension (sidebar + inline diff)**

1. New package `extensions/vscode/` — VS Code extension (TypeScript, `@types/vscode`)
2. Extension connects to local gateway via WebSocket (`ws://127.0.0.1:18789`)
3. Sidebar panel: chat with BuilderForce Agents agent, workflow status, fleet view
4. Inline diff decoration: when staged edits exist, show diff gutter decorations with
   codelens "Accept / Reject" per hunk
5. Command palette: `BuilderForce Agents: Run Workflow`, `BuilderForce Agents: Run /spec`, `BuilderForce Agents: Accept All Diffs`

**Phase B — Language Server / `@codebase` Context** 6. BuilderForce Agents language server: exposes `codebase_search` as an LSP workspace symbol provider 7. `@codebase` context in chat: automatically retrieves semantically relevant snippets

**Estimate**: L (2–3 weeks for Phase A)  
**Owner**: New `extensions/vscode/` package

---

### Gap 5 — Tab Autocomplete (P2)

**What Cursor and Continue.dev do:**

- Cursor: fast ghost-text tab completion powered by a small fill-in-the-middle model.
- Continue.dev: configurable tab autocomplete with support for local models (StarCoder2,
  DeepSeek-Coder, Codestral) via Ollama or any FIM-compatible API.

**What BuilderForce Agents does today:**  
No autocomplete. BuilderForce Agents operates at the task/workflow level, not the keystroke level.

**Why this matters for competing with Cursor/Continue:**  
Tab completion keeps developers in a productive flow state inside the editor. Without it,
developers retain their Cursor subscription alongside BuilderForce Agents for day-to-day coding
even if they use BuilderForce Agents for orchestration. This prevents full switching.

**Required work:**

1. **FIM proxy endpoint** on local gateway: `POST /api/complete` accepting
   `{ prefix, suffix, maxTokens, stopSequences }` → streams completion tokens.
2. Route to a configured FIM model (Codestral, DeepSeek-Coder via Ollama, or any
   provider that supports fill-in-the-middle).
3. VS Code extension (Gap 4): register as an inline completion provider using this endpoint.
4. Continue.dev compatibility: expose as a Continue-compatible autocomplete provider
   so existing Continue.dev users can point their tab completion at BuilderForce Agents.

**Estimate**: M (3–4 days once VS Code extension exists)  
**Owner**: `src/gateway/`, `extensions/vscode/`

---

## Market Landscape (Full)

### Tier 1: IDE-Embedded Assistants

| Tool                   | Price       | Self-hosted | Multi-agent | Orchestration | MCP       | Diff UX     | Open Source |
| ---------------------- | ----------- | ----------- | ----------- | ------------- | --------- | ----------- | ----------- |
| **Cursor**             | $20/user/mo | ❌          | ❌          | ❌            | ✅ Native | ✅ Composer | ❌          |
| **Windsurf (Codeium)** | $15/user/mo | ❌          | ❌          | ❌            | ✅        | ✅ Cascade  | ❌          |
| **GitHub Copilot**     | $19/user/mo | ❌          | ❌          | ❌            | ❌        | ⚠️ Inline   | ❌          |
| **Continue.dev**       | Free        | ✅          | ❌          | ❌            | ✅ Native | ✅ `⌘K`     | ✅ MIT      |
| **Tabnine**            | $12/user/mo | ❌          | ❌          | ❌            | ❌        | ❌          | ❌          |

### Tier 2: Agentic CLI / Terminal Tools

| Tool              | Price       | Self-hosted | Multi-agent | Orchestration | MCP | Open Source |
| ----------------- | ----------- | ----------- | ----------- | ------------- | --- | ----------- |
| **Claude Code**   | Usage-based | ❌          | ❌          | ❌            | ✅  | ❌          |
| **Aider**         | Free        | ✅          | ❌          | ❌            | ❌  | ✅ Apache 2 |
| **Goose** (Block) | Free        | ✅          | ❌          | ❌            | ✅  | ✅ Apache 2 |
| **OpenHands**     | Free        | ✅          | ❌          | ⚠️ basic      | ❌  | ✅ MIT      |
| **Plandex**       | Free/Usage  | ✅          | ❌          | ⚠️ plan-only  | ❌  | ✅ AGPL     |

### Tier 3: Autonomous Agents

| Tool          | Price   | Self-hosted | Multi-agent | Orchestration  | Open Source |
| ------------- | ------- | ----------- | ----------- | -------------- | ----------- |
| **Devin**     | $500/mo | ❌          | ❌          | ✅ (black box) | ❌          |
| **SWE-agent** | Free    | ✅          | ❌          | ❌             | ✅ MIT      |

### BuilderForce Agents Position (current → target)

| Tool                 | Price      | Self-hosted | Multi-agent | Orchestration | MCP                | Diff UX   | IDE ext    | Open Source |
| -------------------- | ---------- | ----------- | ----------- | ------------- | ------------------ | --------- | ---------- | ----------- |
| **BuilderForce Agents today**  | Free       | ✅          | ✅ 7 roles  | ✅ DAG        | ⚠️ mcporter        | ❌        | ❌         | ✅ MIT      |
| **BuilderForce Agents target** | Free + Pro | ✅          | ✅ 7 roles  | ✅ DAG        | ✅ Native + server | ✅ staged | ✅ VS Code | ✅ MIT      |

---

## Competitive Differentiation: What BuilderForce Agents Already Wins On

These are genuine, durable advantages over Cursor and Continue.dev today:

| Feature                        | Advantage vs. Cursor                                               | Advantage vs. Continue.dev                      |
| ------------------------------ | ------------------------------------------------------------------ | ----------------------------------------------- |
| **Multi-agent orchestration**  | Cursor uses one agent; BuilderForce Agents uses 7 specialised roles in a DAG | Same — no orchestration in Continue             |
| **Adversarial review pass**    | Not available in Cursor                                            | Not available in Continue                       |
| **Planning workflow (/spec)**  | Cursor has no PRD → arch → task decomposition                      | Continue has no planning workflow               |
| **Workflow persistence**       | Cursor loses workflow state on close                               | Continue has no workflow concept                |
| **Post-task memory loop**      | Cursor has no persistent project memory                            | Continue's context is in-session only           |
| **Agent mesh (distributed)**    | No distributed delegation in Cursor                                | Not available in Continue                       |
| **Works in WhatsApp/Telegram** | Cursor is IDE-only                                                 | Continue is IDE-only                            |
| **Self-hosted, open source**   | Cursor is closed, cloud-required                                   | Continue is open but IDE-tethered               |
| **AST + git-history analysis** | Cursor has basic RAG, no AST                                       | Continue has no AST analysis                    |
| **Any model, no lock-in**      | Cursor limits model choices                                        | Continue supports any model ✅ (same advantage) |

---

## Implementation Priority (Cursor + Continue Focus)

| #   | Feature                                       | Priority | Effort | Target Quarter |
| --- | --------------------------------------------- | -------- | ------ | -------------- |
| 1   | MCP server (expose BuilderForce Agents tools)           | P0       | M      | Q2 2026        |
| 2   | Codebase semantic search + auto-context       | P0       | M      | Q2 2026        |
| 3   | Inline diff / accept-reject (staged edits)    | P1       | M      | Q2 2026        |
| 4   | VS Code extension (sidebar + diff decoration) | P1       | L      | Q3 2026        |
| 5   | Tab autocomplete (FIM proxy)                  | P2       | M      | Q3 2026        |
| 6   | Session auto-checkpoint                       | P1       | S      | Q2 2026        |
| 7   | Persona profiles                              | P1       | M      | Q2 2026        |
| 8   | GitHub issue → PR workflow                    | P1       | M      | Q2 2026        |
