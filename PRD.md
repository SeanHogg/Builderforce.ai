> **PRD** — drafted by Ada (Sr. Product Mgr) · task #405
> _Each agent that updates this PRD signs its change below._

# PRD: Pass `chatId` to Dispatched Agents for Brain Chat Status Updates

## Problem & Goal

When a user dispatches an agent from a Brain chat via `chats.dispatch_agent`, the agent executes in an isolated cloud environment with zero awareness of its originating conversation. The user receives no feedback — no acknowledgement that work has started, no progress updates, and no completion summary — unless they manually inspect task logs elsewhere.

**Goal:** Thread the originating `chatId` through the entire dispatch pipeline so that cloud agents can post status updates back to the Brain chat. Deliver three capabilities: automatic lifecycle messages ("starting work" / "finished"), and an agent-callable tool for arbitrary mid-task updates.

---

## Target Users / ICP Roles

| Role | Need |
|------|------|
| **Brain chat user** | Sees real-time feedback without leaving the conversation |
| **Agent developer / prompt author** | Can instrument agents with `chats.post_to_brain` calls to surface progress or ask clarifying questions |
| **Platform engineer** | Needs the plumbing to be backward-compatible with all non-chat dispatch paths |

---

## Scope

This work touches the dispatch pipeline from the MCP tool call in the API layer down to the cloud agent runtime loop, plus a new outbound MCP tool available inside cloud agent sessions.

---

## Functional Requirements

### FR-1 — `chats.dispatch_agent` MCP Tool (`builtinMcpService.ts`)

- When the MCP tool `chats.dispatch_agent` is invoked inside a Brain chat, the tool handler **must** include the current `chatId` in the POST body sent to `/api/tasks/:id/run-now`.
- `chatId` is optional in the request body; callers outside a chat context omit it and behavior is unchanged.

### FR-2 — `/api/tasks/:id/run-now` Endpoint (`taskRoutes.ts`)

- Extract `chatId` from the POST body (string, optional).
- Merge `chatId` into `payloadObj` before passing it to `dispatchCloudRunForTask`.
- If `chatId` is absent the endpoint behaves exactly as today.

### FR-3 — Dispatch Message (`runtimeRoutes.ts`)

- The `DispatchMessage` structure **must** carry an optional `chatId` field.
- When constructing the dispatch message for a cloud run, populate `chatId` from `payloadObj` when present.
- Existing dispatch paths (board runs, autofix, approvals, webhooks) that never set `chatId` are unaffected.

### FR-4 — Cloud Agent Loop Reads `chatId` (`cloudAgentEngine.ts` / `CloudRunnerDO`)

- On agent startup, read `chatId` from the execution payload.
- Expose `chatId` on the run context object so all downstream logic (tools, lifecycle hooks) can access it without re-parsing the payload.
- If `chatId` is absent, the agent runs normally with no chat-posting behavior.

### FR-5 — New MCP Tool: `chats.post_to_brain`

Available **only** inside a cloud agent session (not in Brain chat itself).

**Tool definition:**

| Field | Value |
|-------|-------|
| Name | `chats.post_to_brain` |
| Description | Post a message to the Brain chat that dispatched this agent. |
| Input: `message` | `string`, required — the text to post |
| Input: `chatId` | `string`, optional — defaults to the `chatId` from run context; explicit override allowed |

**Behavior:**

- Resolves `chatId` from run context when not explicitly provided.
- If no `chatId` is available (non-chat dispatch), the tool returns a clear error: `"No originating chat; message not sent."` — it does **not** throw or crash the agent.
- Posts the message to the Brain chat via the internal chat message API (same endpoint used by the Brain itself).
- Returns a success/failure result to the agent.

### FR-6 — Automatic Lifecycle Messages

| Event | Message posted to chat |
|-------|------------------------|
| Agent dispatch confirmed (before cloud run starts executing agent logic) | `"⚙️ Agent [name] has picked up your task and is starting work."` |
| Agent run completes successfully | `"✅ Agent [name] finished. [optional brief summary if agent provided one]"` |
| Agent run fails / times out | `"❌ Agent [name] encountered an error. Check task logs for details."` |

- Lifecycle messages are posted by the **platform** (not the agent LLM) so they appear even if the agent never calls `chats.post_to_brain`.
- Auto-post only fires when `chatId` is present on the run context.
- The "finished" message may incorporate a final summary if the agent's last `chats.post_to_brain` call sets a `summary: true` flag (nice-to-have; not required for v1).

---

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC-1 | Dispatching an agent from a Brain chat results in a "starting work" message appearing in that chat within 5 seconds of dispatch. |
| AC-2 | When the agent run completes (success or failure), a corresponding lifecycle message appears in the originating chat. |
| AC-3 | A cloud agent can call `chats.post_to_brain` with a string message and that message appears verbatim in the Brain chat. |
| AC-4 | Dispatching via board runs, autofix, approval flows, or webhooks (no `chatId` in payload) produces no errors and no behavioral change. |
| AC-5 | If `chats.post_to_brain` is called when no `chatId` exists in run context, the tool returns a graceful error string and the agent continues executing. |
| AC-6 | `chatId` is never logged at INFO level or exposed in any client-visible error message to avoid leaking internal IDs. |
| AC-7 | Existing unit and integration tests for `run-now`, `DispatchMessage`, and `cloudAgentEngine` continue to pass without modification. |
| AC-8 | The `chats.post_to_brain` tool is not listed in the MCP tool manifest served to Brain chat sessions (it is cloud-agent-only). |

---

## Out of Scope

- **Bidirectional messaging / agent asking clarifying questions in v1:** The agent can post to chat but users cannot reply back to the agent via chat in this iteration. That requires a separate "agent inbox" mechanism.
- **Streaming / incremental updates via websocket:** Messages are posted as discrete chat messages, not streamed tokens.
- **Modifying the Brain chat UI** to visually distinguish agent-posted messages from human messages (styling / badges).
- **Persisting `chatId` on the Task record** in the database. `chatId` lives only in the ephemeral execution payload for this iteration.
- **Rate-limiting `chats.post_to_brain`** calls within a single agent run (deferred to a follow-on abuse-prevention story).
- **Multi-chat fan-out:** An agent dispatched from one chat cannot post to a different chat; `chatId` is read-only from run context.
- **Approval / human-in-the-loop flows** triggered from Brain chat (separate feature).