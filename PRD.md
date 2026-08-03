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

_Owned by the business-analyst — authored by code-creator + code-reviewer + test-generator._

### REQ-1: Function Signature & Invocation

**REQ-1.1** The builtin MUST be registered under the name `builtin_chats_get_messages`.

**REQ-1.2** The function MUST accept a single parameter object with the following schema:

| Parameter  | Type     | Required | Default   | Description                                      |
| ---------- | -------- | -------- | --------- | ------------------------------------------------ |
| `chatId`   | `string` | yes      | —         | The unique identifier of the chat to retrieve.   |
| `limit`    | `number` | no       | (none)    | Maximum number of messages to return.            |
| `offset`   | `number` | no       | `0`       | Zero-based offset into the message transcript.   |
| `order`    | `string` | no       | `"asc"`   | Sort direction: `"asc"` (oldest first) or `"desc"` (newest first). |

**REQ-1.3** When `limit` is omitted, the function MUST return the full transcript (no artificial cap beyond the system's hard ceiling — see REQ-5.1).

**REQ-1.4** When `limit` is provided, the function MUST return at most that many messages, respecting the `offset`.

**REQ-1.5** The `order` parameter MUST control the order in which messages are returned to the caller. The underlying storage order is chronological (oldest first); `"desc"` reverses the slice before returning it. Pagination cursors (`offset`) are always relative to the canonical chronological ordering, regardless of the `order` parameter — i.e. `offset: 0` always means "the earliest message."

### REQ-2: Response Schema

**REQ-2.1** On success, the function MUST return an object with the following shape:

```jsonc
{
  "chatId": "string",            // echoed from the request
  "messages": [                  // ordered array per the `order` parameter
    {
      "id": "string",            // unique message identifier
      "role": "string",          // "user" | "assistant" | "system" | "tool"
      "content": "string",       // plain-text message body
      "timestamp": "string",     // ISO 8601 UTC, e.g. "2025-01-15T10:30:00.000Z"
      "senderId": "string|null", // identifier of the sender (user, agent, or system)
      "senderName": "string|null"// human-readable display name of the sender
    }
  ],
  "totalCount": "number",        // total messages in the chat (un-paginated)
  "returnedCount": "number",     // number of messages in this response slice
  "offset": "number",            // the offset applied
  "hasMore": "boolean"           // true when more messages exist beyond this slice
}
```

**REQ-2.2** The `role` field MUST be one of: `"user"`, `"assistant"`, `"system"`, `"tool"`.

**REQ-2.3** The `timestamp` field MUST be in ISO 8601 UTC format with millisecond precision.

**REQ-2.4** `senderId` and `senderName` MUST be `null` when the sender is not known (e.g., historical messages imported without attribution).

**REQ-2.5** `totalCount` MUST reflect the total number of messages in the chat regardless of pagination.

**REQ-2.6** `hasMore` MUST be `true` when `offset + returnedCount < totalCount`, `false` otherwise.

### REQ-3: Error Handling

**REQ-3.1** When `chatId` is missing or empty, the function MUST return an error with code `"invalid_parameter"` and a message indicating `chatId` is required.

**REQ-3.2** When `chatId` does not correspond to any existing chat, the function MUST return an error with code `"chat_not_found"` and a message including the provided `chatId`.

**REQ-3.3** When `limit` is negative, the function MUST return an error with code `"invalid_parameter"`.

**REQ-3.4** When `offset` is negative, the function MUST return an error with code `"invalid_parameter"`.

**REQ-3.5** When `order` is provided but is not `"asc"` or `"desc"`, the function MUST return an error with code `"invalid_parameter"`.

**REQ-3.6** When the caller lacks access to the requested chat (e.g., a cross-tenant or cross-project read), the function MUST return an error with code `"access_denied"`. This is a forward-looking requirement; the initial implementation MAY treat all chats within the caller's tenant as accessible, but the error code MUST exist in the error catalog from day one.

**REQ-3.7** All error responses MUST follow the platform's standard error envelope:

```jsonc
{
  "error": {
    "code": "string",    // machine-readable error code
    "message": "string"  // human-readable description
  }
}
```

### REQ-4: Ordering & Pagination Contract

**REQ-4.1** Messages MUST be returned in the order specified by the `order` parameter:
- `"asc"`: oldest message first (index 0 = earliest).
- `"desc"`: newest message first (index 0 = latest).

**REQ-4.2** Pagination with `offset` and `limit` MUST operate on the canonical chronological ordering (oldest first), NOT on the display order. Examples:

| Scenario                   | `offset` | `limit` | `order`  | Returns                                                                 |
| -------------------------- | -------- | ------- | -------- | ----------------------------------------------------------------------- |
| First 50 messages          | 0        | 50      | `"asc"`  | Messages 1–50, oldest first.                                            |
| Next page (ascending)      | 50       | 50      | `"asc"`  | Messages 51–100, oldest first.                                          |
| Most recent 50             | (none)   | 50      | `"desc"` | Messages N–(N−49), newest first.                                        |
| Next page (descending)     | (none)   | 50      | `"desc"` | N/A — descending pagination uses `offset` from the canonical ordering.  |

**REQ-4.3** When `offset` is greater than or equal to `totalCount`, the function MUST return an empty `messages` array, `hasMore: false`, and `totalCount` reflecting the real count.

**REQ-4.4** When a chat has zero messages, the function MUST return:
```jsonc
{ "chatId": "...", "messages": [], "totalCount": 0, "returnedCount": 0, "offset": 0, "hasMore": false }
```

### REQ-5: Performance & Resource Constraints

**REQ-5.1** The function MUST impose a hard ceiling of **10,000 messages** per call. When `limit` is omitted and the chat exceeds 10,000 messages, only the most recent 10,000 are returned (in the requested order), and `hasMore` MUST be `true`. Pagination via `offset` allows retrieval beyond this window.

**REQ-5.2** The function MUST complete in under **2 seconds** for transcripts up to 1,000 messages.

**REQ-5.3** The function SHOULD complete in under **5 seconds** for transcripts up to 10,000 messages.

**REQ-5.4** The function MUST NOT hold a long-lived database transaction or connection. It MUST use a single read query (or a limited batch) and release the resource immediately.

**REQ-5.5** The function MUST be idempotent: repeated calls with the same parameters MUST return the same result (modulo new messages that arrive between calls).

### REQ-6: Integration & Registration

**REQ-6.1** The builtin MUST be registered in the platform's builtin registry alongside the existing `builtin_team_chat_read`, `builtin_team_chat_post`, and other chat-related builtins.

**REQ-6.2** The builtin MUST be discoverable by agents through the standard tool-description mechanism (the LLM tool-use schema).

**REQ-6.3** The tool description provided to LLMs MUST:
- Explain that `chatId` can come from `builtin_team_chat_read` responses, incident war-room references, or direct-chat identifiers.
- Document the `order` parameter's effect clearly so the LLM can request "most recent first" when it only needs the tail.
- Include an example call and response.

**REQ-6.4** The implementation MUST reuse the existing chat-persistence layer rather than introducing a parallel storage mechanism. It MUST query the same backing store that `builtin_team_chat_read` reads from.

### REQ-7: Data Integrity & Edge Cases

**REQ-7.1** Messages with empty `content` (e.g., an attachment-only message with no caption) MUST be returned with `content: ""` — they MUST NOT be filtered out.

**REQ-7.2** Deleted or soft-deleted messages MUST be excluded from the returned transcript. The function MUST NOT surface tombstoned records.

**REQ-7.3** Concurrent writes (new messages arriving while a paginated read is in progress) MUST NOT cause message duplication or omission within a single page. Slight inconsistency across pages (a message appearing on page 2 that was also on page 1, or being skipped entirely) is ACCEPTABLE per REQ-5.4's single-query constraint.

**REQ-7.4** The function MUST handle chats of any type supported by the platform: team chats, incident war-room chats, direct/1:1 chats, and project-scoped chats.

### REQ-8: Forward Compatibility

**REQ-8.1** The response schema MUST include the `senderId` and `senderName` fields from day one, even if the initial implementation returns `null` for them in some chat types.

**REQ-8.2** The `role` field MUST support the full enumerated set (`"user"`, `"assistant"`, `"system"`, `"tool"`) from day one. The initial implementation MAY only emit `"user"` and `"assistant"` until `"system"` and `"tool"` message types are added to the chat persistence layer, but the schema MUST NOT reject them.

**REQ-8.3** The error code `"access_denied"` MUST be defined and documented in the error catalog, even if the initial implementation does not enforce access control.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._