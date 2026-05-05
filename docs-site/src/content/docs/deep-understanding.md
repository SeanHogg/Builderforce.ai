---
title: "Deep Understanding"
summary: "Systems-level guide to how CoderClaw works under the hood."
---

# Deep Understanding of CoderClaw

This guide is for operators and developers who want to understand how CoderClaw works at a
systems level — beyond the getting-started docs and into the mechanics that govern runtime
behaviour, state, and extension points.

---

## The Mental Model

CoderClaw is a **gateway-centred AI agent runtime**. A single long-lived Gateway process owns
all messaging surfaces (Slack, Telegram, iMessage, Discord, …), all agent sessions, and all
tool policy enforcement. Clients — the TUI, macOS app, iOS/Android nodes, and the web Control
UI — are thin consumers of the Gateway's typed WebSocket API.

```
┌─────────────────────────────────────────────────────┐
│                     GATEWAY                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │
│  │  Channels   │  │  Sessions   │  │    Tools    │  │
│  │ (Slack/TG/…)│  │  + Memory   │  │  + Sandbox  │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  │
│         └────────────────┼────────────────┘         │
│                   Agent Runner                       │
│              (agentic loop per session)              │
└───────────────────────┬─────────────────────────────┘
                        │ WebSocket (typed events)
        ┌───────────────┼───────────────┐
        │               │               │
      TUI            macOS App       Web UI / Nodes
```

The Gateway is the single source of truth. If it is not running, nothing works — no sessions, no
replies, no tool execution.

---

## Session Lifecycle

A **session** is a named, persistent conversation thread associated with one agent. Sessions:

- Are identified by a `sessionKey` (e.g. `main`, `global`, or a custom key)
- Persist to disk in the workspace (`~/.coderclaw/workspace/sessions/`)
- Carry history, memory, and verbose/thinking level overrides
- Are serialised — only one agent run executes per session at a time (queue prevents races)

### Run states

```
PENDING → PLANNING → RUNNING → DONE
                              → ERROR
                              → ABORTED
                              → TIMEOUT
```

A run enters PLANNING while the prompt is being assembled (skill loading, system-prompt
construction, bootstrap-file injection). It enters RUNNING when the first model token is
requested. Every state transition is emitted as a typed WebSocket event, which the TUI and
other clients consume to render status.

---

## The Agentic Loop in Depth

For every message the Gateway receives it runs:

1. **Validate & enqueue** — input is validated against the session's tool policy; run is
   added to the per-session queue
2. **Session preparation** — workspace directory asserted; skill SKILL.md files loaded;
   `BOOTSTRAP.md`, `AGENTS.md`, and `BOOT.md` injected as the leading system-prompt blocks
3. **Prompt assembly** — user message prepended; hook `before_prompt_build` fires, allowing
   plugins to inject or strip context
4. **Model inference** — streaming request sent to the resolved model; tokens and tool-use
   deltas streamed back
5. **Tool execution** — each tool call is dispatched synchronously (exec, web, browser, …);
   results are appended to the conversation and the loop continues until the model stops
   calling tools
6. **Streaming to clients** — every delta is emitted as a Gateway event; verbose level
   controls whether full tool output (`full`) or just results (`on`) are forwarded
7. **Persistence** — final messages written to the session's history file; any memory
   directives are applied

### Verbose levels

| Level  | What clients see                                      |
|--------|-------------------------------------------------------|
| `off`  | Only assistant text — no tool information             |
| `on`   | Tool call names + result summaries (default)          |
| `full` | Complete tool input and output (useful for debugging) |

Set the default via config:

```yaml
agents:
  defaults:
    verboseDefault: "on"   # or "full" for complete output
```

Or toggle per-session in the TUI with `/verbose`, `/verbose full`, or `/verbose off`.

---

## Gateway Connection Model

The TUI and other clients connect to the Gateway over a local (or remote) WebSocket:

```
ws://127.0.0.1:18789/  (default)
```

On connection the Gateway sends a `health` event with version and status, then a `presence`
event listing active sessions. The client subscribes to session events by sending a
`subscribe` message with the `sessionKey`.

### What happens when the Gateway is unreachable

If the TUI starts and the Gateway is not running:

1. The TUI shows "Gateway not connected" in the status bar
2. A hint appears: **Type `/setup` or `/onboard` to run the setup wizard**
3. Once `/setup` completes the Gateway is started automatically in the background
4. The TUI reconnects automatically — no restart required

---

## Config File Structure

CoderClaw's config lives at `~/.coderclaw/coderclaw.yaml` (or `coderclaw.json`). The key
namespaces:

```yaml
gateway:
  port: 18789
  bind: loopback          # loopback | lan | auto | tailnet | custom
  auth:
    mode: token           # token | password
    token: "..."

agents:
  defaults:
    model:
      primary: "claude-opus-4-6"
    verboseDefault: "on"  # off | on | full
    workspace: "~/.coderclaw/workspace"
    timeoutSeconds: 600

models:
  anthropic:
    apiKey: "..."
```

Run `coderclaw configure` to change any setting interactively, or `coderclaw doctor` to
validate the current config and check connectivity.

---

## Tool Policy and Sandboxing

Every tool call goes through a **tool policy** before execution. Policies enforce:

- **Allowlists** — which tool categories are permitted (exec, web, browser, …)
- **Elevated mode** — whether the agent can perform higher-risk actions
- **Sandbox** — Docker-based isolation for exec and file operations

Policies are configured per-agent or globally under `agents.defaults`. See
[Sandbox vs Tool Policy vs Elevated](/gateway/sandbox-vs-tool-policy-vs-elevated) for the
full decision matrix.

---

## Memory and Context

CoderClaw supports three memory layers that are injected into each prompt:

| Layer          | Source file    | Purpose                                     |
|----------------|----------------|---------------------------------------------|
| Bootstrap      | `BOOTSTRAP.md` | One-time context loaded at session start    |
| Agent rules    | `AGENTS.md`    | Persistent rules and identity for the agent |
| Session memory | `memory/` dir  | Accumulated facts written by the agent      |

The **session-memory hook** (`/new` command) writes a summary of the previous session to
`memory/` before resetting the conversation. This is how CoderClaw maintains long-term
context across resets without ballooning the token count.

---

## Extension Points

| Mechanism      | Where                         | What it can do                                                         |
|----------------|-------------------------------|------------------------------------------------------------------------|
| **Hooks**      | `~/.coderclaw/hooks/`         | Run scripts on gateway events (`/new`, `/reset`, `/stop`)             |
| **Skills**     | `~/.coderclaw/skills/`        | Inject SKILL.md files as tool-use instructions                         |
| **Plugins**    | `plugins.entries.<id>` config | Register channels, CLI commands, RPC methods, background services      |
| **Sub-agents** | `subagents` tool              | Spawn parallel agent runs from within an agent run                     |

Hooks and skills are the primary extension mechanisms for most operators. Plugins require
writing TypeScript code that runs in-process with the Gateway.

---

## Common Diagnostic Commands

```bash
coderclaw status              # Session status and active runs
coderclaw doctor              # Config validation + connectivity check
coderclaw gateway probe       # Check if gateway is reachable
coderclaw logs --follow       # Tail gateway logs in real time
coderclaw sessions list       # List all known sessions
coderclaw agent status --all  # Verbose status across all agents
```

See [Troubleshooting](/troubleshooting) and [Doctor](/cli/doctor) for full guidance.

---

## Further Reading

- [Gateway Architecture](/concepts/architecture) — component diagram and connection flow
- [Agent Loop](/concepts/agent-loop) — step-by-step execution path
- [Session Management](/concepts/session) — session lifecycle and pruning
- [Memory](/concepts/memory) — memory layers and injection
- [Security](/security) — hardening your installation
- [Configuration Reference](/gateway/configuration-reference) — every config key
