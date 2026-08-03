> **PRD** — drafted by Ada (Sr. Product Mgr) · task #885
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document

**Feature:** `chats.post_to_brain` MCP Tool

---

## Problem & Goal

Cloud‑based agents lack a standardised mechanism to proactively post messages back to the originating Brain chat during execution. This prevents agents from delivering real‑time progress updates, requesting clarification, or signalling completion directly in the conversation stream. The result is a degraded user experience and limited agent‑to‑user communication.

**Goal:** Implement a cloud‑agent‑only MCP tool (`chats.post_to_brain`) that enables an agent to inject formatted messages into the current Brain chat thread, closing the communication gap and improving observability of agent actions.

---

## Target Users / ICP Roles

- **Agent developers** building agents for the cloud platform, who need a reliable way to send messages into the chat.
- **End‑users** interacting with agents in Brain chats indirectly benefit from timely updates and richer agent behaviour.

The tool is exclusively intended for cloud‑hosted agents. Local agents are not in scope.

---

## Scope

- Deliver the `chats.post_to_brain` tool as part of the cloud‑agent MCP server.
- Define tool schema: input parameters (`content`, `message_type`) and response structure.
- Handle posting a message to the originating Brain chat (the conversation that invoked the agent).
- Enforce cloud‑only availability; return a clear error when the tool is invoked from a local agent context.
- Ensure message content supports standard text (UTF‑8) and that the message is immediately visible in the chat UI.

---

## Functional Requirements

- **FR‑1:** The tool must be registered with the name `chats.post_to_brain` and be discoverable via the MCP `tools/list` method.
- **FR‑2:** The tool must accept the following parameters:
  - `content` (string, required) – the message text to post.
  - `message_type` (string, optional, default `"info"`) – supported values: `info`, `warning`, `error`. The type may be used by the chat UI for styling.
- **FR‑3:** Upon invocation, the tool must post the message into the Brain chat thread associated with the current agent run. The message must appear as a bot/agent message, not a user message.
- **FR‑4:** Cloud‑only enforcement:
  - When running in a cloud agent environment, the tool must function normally.
  - When invoked in a local agent environment, the tool must return an MCP error indicating: `“This tool is only available for cloud agents.”`
- **FR‑5:** The tool must handle messages of any reasonable length without truncation (the chat UI may apply its own display limits).
- **FR‑6:** The tool must return an MCP tool result containing:
  - `success` (boolean) – `true` if the message was posted.
  - `message_id` (string) – the unique identifier of the posted message.
  - On failure, an MCP error response with a descriptive message.
- **FR‑7:** Content must be transmitted and stored without loss of non‑ASCII characters (full UTF‑8 support).

---

## Acceptance Criteria

- **AC‑1:** Given a cloud agent session, when the agent calls `chats.post_to_brain` with `{ "content": "Hello, world!" }`, then the message `"Hello, world!"` appears in the Brain chat as a bot message.
- **AC‑2:** The successful tool response contains `"success": true` and a non‑empty `"message_id"`.
- **AC‑3:** When the same tool is called from a local agent session, the response is an MCP error with code `-32000` and a message stating the tool is not available for local agents.
- **AC‑4:** The tool is listed in the output of `tools/list` with the correct name and parameter schema.
- **AC‑5:** Calling the tool without the required `content` parameter returns a validation error (e.g., missing field).
- **AC‑6:** A message containing emoji, accented characters, and multi‑byte characters (e.g., `“你好 😊”`) is posted and displayed identically in the chat.

---

## Out of Scope

- File attachments or binary payloads.
- Markdown rendering logic – that is owned by the chat UI.
- Editing or deleting previously posted messages.
- Threading beyond the current Brain chat context.
- Posting to direct messages or other channels.
- Callbacks or webhook notifications to external systems.
- Local agent support or fallback behaviour.
- UI modifications to the Brain chat interface.
- Multi‑lingual translation of tool error messages.

## Requirements

_Authored by business-analyst — signed below._

### Business Context

Cloud agents need to communicate with users during execution. Without a standard, discoverable mechanism, agents cannot deliver real‑time progress updates, request clarifications, or signal completion inside the originating conversation. The `chats.post_to_brain` MCP tool closes this gap, giving every cloud‑hosted agent a uniform channel back to the Brain chat thread that launched it.

### User Stories & Actors

| ID    | Actor           | Story | Rationale |
|-------|-----------------|-------|-----------|
| US‑1 | Agent Developer | As an agent developer, I want my cloud agent to call `chats.post_to_brain` so that end‑users see timely progress, warning, and error messages in the same chat thread they used to invoke the agent. | Developer experience; one standard tool instead of bespoke per‑agent messaging. |
| US‑2 | End User       | As an end user interacting with an agent in Brain chat, I want to see the agent's status updates inline so I can gauge progress and trust that the work is proceeding. | Observability and user confidence. |
| US‑3 | Platform Operator | As a platform operator, I want the tool gated to cloud‑agent contexts so that local agents cannot accidentally (or maliciously) inject messages into user chats. | Security boundary; cloud‑only is a deliberate design constraint. |

### Functional Requirements (Detailed)

_Note: these elaborate on FR‑1 through FR‑7 already stated above; they do not replace them._

| ID  | Requirement | Validation |
|-----|------------|------------|
| REQ‑1 | The tool MUST register under the fully‑qualified MCP name `chats.post_to_brain` and appear in `tools/list` with its input schema (JSON Schema). | AC‑4 |
| REQ‑2 | The tool MUST accept a required `content` parameter (string, non‑empty, no length limit enforced by the tool) and an optional `message_type` parameter (enum: `info`, `warning`, `error`; default `info`). | AC‑5, AC‑6 |
| REQ‑3 | On success, the tool MUST post a bot‑role message into the **originating** Brain chat thread (the conversation that invoked the agent run). The message MUST NOT appear as a user message. | AC‑1 |
| REQ‑4 | The success response payload MUST be `{ "success": true, "message_id": "<unique-id>" }` where `message_id` is the platform‑assigned message identifier. | AC‑2 |
| REQ‑5 | When invoked outside a cloud‑agent context (local agent), the tool MUST return an MCP error with code `-32000` and human‑readable message: `"This tool is only available for cloud agents."` | AC‑3 |
| REQ‑6 | Message content MUST be transported and stored in UTF‑8 without loss; emoji, accented, and multi‑byte characters must survive round‑trip intact. | AC‑6 |
| REQ‑7 | Missing required parameters MUST yield a validation error per the MCP tool‑call error contract (not a crash or silent failure). | AC‑5 |

### Non‑Functional Requirements

| ID   | Category      | Requirement | Measurable Target |
|------|---------------|-------------|-------------------|
| NFR‑1 | Performance   | Tool invocation (including message persistence) must complete within 2 seconds under normal load. | p95 ≤ 2 s |
| NFR‑2 | Reliability   | If the Brain chat context is unavailable (expired session, deleted chat), the tool must return a deterministic MCP error — never crash the agent runtime. | 100 % graceful degradation |
| NFR‑3 | Security      | The tool must post ONLY to the originating Brain chat; it must not accept or infer a target chat / channel parameter. | No cross‑chat leakage |
| NFR‑4 | Observability | Every invocation must emit a structured log containing agent ID, execution ID, chat ID, timestamp, message type, and content hash (not raw content). | Log present on every call |
| NFR‑5 | Compatibility | The tool must conform to the MCP specification for tool registration, parameter validation, and error reporting (JSON‑RPC 2.0). | Passes MCP conformance suite |

### Data Contract

| Direction | Field          | Type     | Required | Description |
|-----------|----------------|----------|----------|-------------|
| Input     | `content`      | string   | yes      | UTF‑8 message text to post into the Brain chat. |
| Input     | `message_type` | string   | no       | One of `"info"` (default), `"warning"`, `"error"`. May inform chat‑UI styling. |
| Output    | `success`      | boolean  | yes      | `true` when the message was persisted and delivered. |
| Output    | `message_id`   | string   | yes      | Platform‑assigned unique identifier for the posted message. |
| Error     | `code`         | number   | yes      | JSON‑RPC error code (`-32000` for cloud‑only rejection, standard validation codes otherwise). |
| Error     | `message`      | string   | yes      | Human‑readable description of the failure. |

### Environment & Context Constraints

- **Runtime:** Cloud‑agent execution environment only (managed by the platform's agent orchestrator).
- **Session scope:** The tool derives the target Brain chat from the active agent run context — no explicit chat ID parameter is exposed.
- **Local‑agent behaviour:** Invocation from a local agent runtime returns error `-32000` immediately, before any message processing.
- **No offline buffering:** If the chat context is unavailable, the tool fails synchronously; it does not queue messages for later delivery.

### Traceability Matrix

| FR   | Detailed REQ | Acceptance Criteria | Priority  |
|------|-------------|---------------------|-----------|
| FR‑1 | REQ‑1       | AC‑4                | High      |
| FR‑2 | REQ‑2, REQ‑7 | AC‑5               | High      |
| FR‑3 | REQ‑3       | AC‑1, AC‑6          | Critical  |
| FR‑4 | REQ‑5       | AC‑3                | Critical  |
| FR‑5 | REQ‑2       | (implicit)          | Medium    |
| FR‑6 | REQ‑4       | AC‑2                | High      |
| FR‑7 | REQ‑6       | AC‑6                | Critical  |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._