> **PRD** — drafted by Ada (Sr. Product Mgr) · task #883
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: chatId Plumbing for Dispatch Flow

**Document Status:** Draft  
**Feature Area:** Agent Dispatch Pipeline  
**Version:** 1.0  
**Date:** 2025-03-22  

## 1. Problem & Goal

**Problem:**  
The `chatId` parameter originating from `dispatch_agent` is not propagated through the internal dispatch pipeline (`builtinMcpService.ts`, `taskRoutes.ts`, `runtimeRoutes.ts`). As a result, the final `DispatchMessage` payload lacks a `chatId`, breaking downstream session correlation, logging, and context-aware features that depend on this identifier.

**Goal:**  
Ensure `chatId` is reliably extracted, merged into the relevant payload objects, and included in `DispatchMessage` when a dispatch is triggered from `dispatch_agent` through the `run-now` execution path.

## 2. Target Users / ICP Roles

- **Platform Developers** maintaining the dispatch and runtime subsystems; they need consistent data flow for debugging and extending the pipeline.
- **Downstream Services** (e.g., conversation handlers, analytics) that consume `DispatchMessage` and require a `chatId` to associate events with the correct ongoing session.

## 3. Scope

**In Scope:**
- `builtinMcpService.ts` (FR-1): Logic to extract `chatId` from incoming dispatch requests and merge it into the internal `payloadObj`.
- `taskRoutes.ts` (FR-2): Logic to pass `chatId` when creating dispatch tasks and enqueuing work.
- `runtimeRoutes.ts` (FR-3): Logic to include `chatId` in the final `DispatchMessage` sent to executors/subscribers.

**Out of Scope:**
- Adding `chatId` to other services or unrelated message types.
- Changing the overall dispatch protocol, authentication, or API surface beyond what is required for `chatId` propagation.
- Backward‑compatibility fallback mechanisms (the field will be added as optional where missing, but strict enforcement is out of scope for this work).

## 4. Functional Requirements

### FR-1: builtinMcpService.ts – Extract and Merge chatId
- When a dispatch request arrives (via `dispatch_agent`), the service must extract the `chatId` from the incoming payload (e.g., `req.body.chatId` or an equivalent parameter).
- The extracted `chatId` shall be merged into the `payloadObj` that is passed to subsequent processing steps.  
- If `chatId` is undefined or absent, the merge must not fail; the field will simply be absent from `payloadObj`.

### FR-2: taskRoutes.ts – Include chatId in Task Creation
- When the runtime creates a task from a dispatch, `chatId` (if present in the incoming data) must be forwarded so it reaches the task’s payload.
- The `run-now` path (which directly executes the dispatch) must preserve `chatId` in the execution context.

### FR-3: runtimeRoutes.ts – Include chatId in DispatchMessage
- When constructing a `DispatchMessage` for a dispatch‑initiated action, the runtime must populate the message’s `chatId` field with the value carried through the pipeline.
- If no `chatId` was provided, the field may be omitted or set to `null`, consistent with the existing message schema.

## 5. Acceptance Criteria

1. **End‑to‑end flow with chatId present**  
   - Given a `dispatch_agent` request that includes `chatId: "abc123"`, the resulting `DispatchMessage` logged or emitted by the system contains `"chatId": "abc123"` in its payload.

2. **Absence of chatId does not break flow**  
   - Given a `dispatch_agent` request without a `chatId`, the pipeline completes successfully and the resulting `DispatchMessage` does **not** contain a `chatId` field (or contains `null` if the schema requires it).

3. **Logging/observability**  
   - Debug logs in `builtinMcpService.ts`, `taskRoutes.ts`, and `runtimeRoutes.ts` show that `chatId` is correctly passed between steps when provided.

4. **Unit test coverage**  
   - Each modified file (FR‑1, FR‑2, FR‑3) has unit tests verifying the extraction, merging, and inclusion of `chatId` under both present and absent scenarios.

## 6. Out of Scope

- Adding `chatId` to other internal events or messages beyond the `dispatch_agent → run-now → DispatchMessage` chain.
- Implementation of a dedicated `chatId` registry or validation against an active chat system.
- Modifications to the `DispatchMessage` schema itself (the field is assumed to already exist but may be currently unused).

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

## Acceptance

_Owned by the validator — to be authored._