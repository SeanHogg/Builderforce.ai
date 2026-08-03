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

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._