> **PRD** — drafted by Ada (Sr. Product Mgr) · task #884
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: ChatId Exposure in Cloud Agent Loop

**Status:** Draft  
**Author:** Product Architect  
**Version:** 1.0  

---

## Problem & Goal

### Problem
The current cloud agent loop (`cloudAgentEngine.ts` / `CloudRunnerDO`) does not read `chatId` from the execution payload or expose it on the run context. Consequently, agents cannot pass `chatId` to downstream operations—specifically `chats.post_to_brain` and lifecycle hooks—breaking the ability for agents to post messages back to the originating chat.

### Goal
Ensure that the `chatId` present in the execution payload is reliably extracted, stored in the run context, and passed through to all relevant operations and hooks so that agents can correctly post to the originating chat.

---

## Target Users / ICP Roles

- **Agent Developers** building conversational agents that need to send messages or results back to a specific chat.
- **Platform Engineers** maintaining runtime execution environments and ensuring correct context propagation.
- **Internal Tooling** that relies on chat-scoped agent interactions.

---

## Scope

This work covers the cloud agent loop runtime only. It includes reading the `chatId` from the execution payload, attaching it to the run context, and threading it into `chats.post_to_brain` calls and lifecycle hooks. No changes to payload schemas, API contracts, or client SDKs are in scope.

---

## Functional Requirements

1. **Payload Parsing**
   - `CloudRunnerDO` or its initialization logic **must** extract `chatId` from the incoming execution payload if present.
   - The extraction must handle both top-level and nested locations per existing payload structure.

2. **Run Context Population**
   - `chatId` **must** be set on the run context object that is available throughout the execution lifecycle.
   - The context key **must** be named `chatId` and be of type `string | undefined`.

3. **Integration with `chats.post_to_brain`**
   - When `chats.post_to_brain` is invoked, the runtime **must** read `chatId` from the run context and pass it to the operation.
   - If `chatId` is not present, the operation should proceed without it (no hard failure).

4. **Lifecycle Hook Propagation**
   - All lifecycle hooks (e.g., pre/post-execution, error handlers) **must** receive `chatId` as part of the hook context if the run context contains it.

5. **Backward Compatibility**
   - Payloads without `chatId` **must** not break execution; the system should treat it as absent and allow the loop to complete normally.

---

## Acceptance Criteria

- [ ] When an execution payload includes `chatId`, the value is correctly extracted and available in the run context.
- [ ] A unit/integration test demonstrates that `chatId` is passed to `chats.post_to_brain` when present.
- [ ] A test verifies lifecycle hooks receive `chatId` in their context arguments.
- [ ] Running a payload **without** `chatId` still executes successfully with `chatId` being `undefined` everywhere.
- [ ] No existing tests are broken, and no performance regression is introduced.

---

## Out of Scope

- Changes to payload structure or validation rules.
- Client SDK or API surface modifications.
- UI or logging concerns beyond standard runtime logs.
- On-premise or self-hosted runner variants unless they share the same code path.
- Multi-chat orchestration or fan-out scenarios.

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