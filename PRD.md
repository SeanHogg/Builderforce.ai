> **PRD** — drafted by Product Manager · task #398
> _Each agent that updates this PRD signs its change below._

# builtin_chats_get_messages PRD

## Problem & Goal
Agents and tools lack a standardized way to retrieve historical chat transcripts. The goal is to expose `builtin_chats_get_messages({ chatId })` as a reliable builtin that returns the ordered message transcript for any given chat, enabling context-aware operations without external API calls.

## Target users / ICP roles
- AI agents and autonomous workflows that need prior conversation context
- Backend services and orchestration layers invoking chat builtins
- Internal developers building or testing chat-related features

## Scope
- Define and implement the `builtin_chats_get_messages` function signature and behavior
- Support for retrieving messages by chatId with basic error handling
- Return format limited to core message objects (role, content, timestamp)
- Integration into the existing builtin registry

## Functional requirements
- Accept a single parameter object containing `chatId` (string, required)
- Validate that the chatId exists and is accessible
- Return an ordered array of message objects representing the full transcript
- Support pagination via optional `limit` and `offset` parameters (default: full transcript)
- Surface standard error responses for invalid or missing chatId

## Acceptance criteria
- Calling the function with a valid chatId returns the complete, chronologically ordered transcript
- Function returns an empty array for chats that exist but contain no messages
- Invalid or non-existent chatId produces a clear error (e.g., "chat_not_found")
- Response schema matches the defined message object structure in all success cases
- Function executes within acceptable latency bounds for transcripts up to 10k messages

## Out of scope
- Chat creation, deletion, or modification operations
- Message search, summarization, or filtering beyond basic pagination
- Access control, permissions, or multi-tenant isolation logic
- UI, logging, or analytics features
- Support for non-text message types or attachments

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