> **PRD** — drafted by Ada (Sr. Product Mgr) · task #873
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: `chats.post_to_brain` MCP Tool

## Problem & Goal
Cloud agents currently cannot post arbitrary updates or messages back into the originating Brain chat from which they were spawned. The existing MCP toolset lacks a `post_to_brain` endpoint. Without it, agents are forced into read-only interaction flows, unable to notify the user, log progress, or inject structured outputs directly into the conversation. This limits the agent’s ability to provide real-time feedback and closes a critical loop in human–agent collaboration.

**Goal**: Implement a dedicated MCP tool `chats.post_to_brain` that allows a cloud agent to publish a message into the Brain chat that initiated the agent session. The tool must be cloud‑agent‑only, respect the originating chat’s context, and integrate seamlessly into the existing MCP surface.

## Target Users / ICP Roles
- **Cloud Agent Developers**: Building agents that need to push status updates, intermediate results, or final summaries back to the user’s chat.
- **End Users (Brain Chat Participants)**: Receive in‑line agent messages without polling or external notifications.
- **Platform / MCP Tool Maintainers**: Ensure the new tool follows MCP conventions, security, and cloud‑agent isolation.

## Scope
- A single new MCP tool: `chats.post_to_brain`
- Invokable exclusively by cloud‑based agents (same isolation as other cloud‑agent tools).
- Accepts a message payload and optional metadata (e.g., message type, formatting hint).
- Writes the message into the **exact Brain chat** from which the agent was launched.
- The tool’s response includes a confirmation with message ID and timestamp.
- Basic input validation and error handling (e.g., invalid content, missing permissions).
- Documentation and update to the MCP tool manifest for discovery.

## Functional Requirements
1. **Tool Registration**  
   - Register `chats.post_to_brain` in the MCP tool set.  
   - The tool must be tagged as `cloud-agent-only` in its definition.

2. **Authentication & Authorization**  
   - Inherit the agent’s existing authorization context; no additional credentials.  
   - Verify that the calling agent is a cloud agent with an active Brain chat session.  
   - Deny invocation if agent is not associated with a valid chat.

3. **Input Schema**  
   - Required:  
     - `content` (string, max length 4000 characters, plain text or Markdown as supported by chat UI).  
   - Optional:  
     - `message_type` (enum: `"info"`, `"warning"`, `"error"`, `"success"`, `"assistant"` – default `"info"`).  
     - `format` (enum: `"text"`, `"markdown"` – default `"markdown"`).  
   - Additional metadata may be passed as a free-form `metadata` object, but validation is limited to size.

4. **Processing**  
   - Resolve the Brain chat ID from the agent’s session metadata.  
   - Construct a chat message record with: sender = agent ID, timestamp = server time, content, type, format.  
   - Persist the message in the Brain chat’s message store.  
   - Trigger any real‑time notification so that the chat UI reflects the new message immediately.

5. **Response**  
   - On success: return `{ “status”: “ok”, “message_id”: “...”, “timestamp”: “ISO8601” }`.  
   - On failure: return appropriate MCP error code (`INVALID_PARAMS`, `PERMISSION_DENIED`, `INTERNAL`) with a human‑readable message.

6. **Edge Cases**  
   - Agent attempts to post after the chat has been archived/closed → `PERMISSION_DENIED`.  
   - Empty content → `INVALID_PARAMS`.  
   - Content exceeds length limit → `INVALID_PARAMS` with clear message.  
   - Agent not in a Brain chat context → `PERMISSION_DENIED`.

## Acceptance Criteria
- [ ] `chats.post_to_brain` is listed when an MCP client queries available tools for a cloud agent session.  
- [ ] Calling the tool with valid `content` results in a new message appearing in the original Brain chat within 2 seconds.  
- [ ] The message is correctly attributed to the agent and includes the correct timestamp.  
- [ ] Invalid payloads (missing content, oversize, unsupported type) return a `400`‑level MCP error with descriptive details.  
- [ ] Attempt from a non‑cloud agent or an agent without an active chat returns `PERMISSION_DENIED`.  
- [ ] Posting to an archived chat returns `PERMISSION_DENIED`.  
- [ ] The tool’s performance does not degrade chat UI responsiveness (message delivery < 1 sec for 95th percentile).  
- [ ] Integration tests run in staging environment covering happy path, validation, and error scenarios.

## Out of Scope
- **Editing or deleting messages** – only creation is supported.  
- **Cross‑chat posting** – the tool is strictly bound to the originating Brain chat.  
- **File attachments or rich media** – messages are text/Markdown only.  
- **Typing indicators or streaming** – the tool is a single‑shot post, not a stream.  
- **User‑initiated tool calls** – the tool is only invocable by cloud agents via MCP.  
- **Conversation branching or reply threading** – messages appear as top‑level entries in the chat.  
- **Local agent support** – cloud‑agent‑only constraint remains.

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