> **PRD** — drafted by John Coder ((V2) (Durable)) · task #488
> _Each agent that updates this PRD signs its change below._

# PRD: Evermind Learn Gate for IDE/Agent Chat Sessions

## Problem & Goal

### Problem
Evermind's learning pipeline is wired exclusively to the web Brain `POST /chats/:id/messages` route. IDE and agent chat sessions persist assistant turns through a separate message-append path that never invokes `evaluateBrainLearnGate` or `dispatchBrainLearn`. As a result, substantive, project-scoped IDE/agent conversations contribute zero learning signal to Evermind — the QUEUED counter never increments and LAST LEARNED never advances from these sessions, even when the user has a seeded + connected Evermind and Learning is toggled On.

### Goal
Every qualifying assistant turn — regardless of whether it originates from the web Brain UI or an IDE/agent chat session — must flow through the same learn gate, dispatch a contribution to the coordinator, and surface a truthful `evermindLearn` outcome in the response.

---

## Target Users / ICP Roles

| Role | Relevance |
|---|---|
| Developer using IDE extension / agent runtime | Primary sufferer: their sessions never teach Evermind despite expectations |
| Team lead / architect managing Evermind settings | Observes stale "LAST LEARNED" and incorrectly believes learning is broken at the product level |
| Evermind coordinator / background job | Downstream consumer that never receives IDE-session contributions |

---

## Scope

This work covers the server-side learn-gate invocation path only. It does not alter the learning algorithm, coordinator internals, Evermind version semantics, or any client-side UI beyond the `evermindLearn` field already present in chat message responses.

---

## Functional Requirements

### FR-1 — Shared Learn-Gate Invocation
After every assistant turn is persisted in the IDE/agent chat message-append path, the system **must** invoke `evaluateBrainLearnGate(chatId, tenantId, insertedTurns)` using the same signature and logic as the existing web Brain route (`brainRoutes.ts:198-210`).

### FR-2 — Conditional Dispatch
When `evaluateBrainLearnGate` returns `learned: true`, the system **must** call `dispatchBrainLearn(...)` (or equivalently `dispatchProjectEvermindLearnText(taskPrompt, exemplar, projectId, tenantId)`) inside a `waitUntil` (or equivalent fire-and-forget context) so it does not block the chat response.

### FR-3 — Eligibility Parity
The gate conditions applied to IDE/agent turns **must** be identical to those in `brainEvermindLearning.ts`:
- Assistant turn content length ≥ `MIN_TEACH_CHARS` (40 characters).
- Chat is project-scoped (`projectId` is non-null and matches a valid project).
- `getProjectEvermindHead` returns `version >= 1` and `mode === 'connected'`.

### FR-4 — Skip Reason Propagation
When the gate determines a turn is ineligible, the system **must** return the appropriate `BrainLearnSkipReason` value (e.g., `GLOBAL_CHAT`, `UNSEEDED`, `FROZEN`, `TOO_SHORT`) in the response payload rather than silently returning nothing or `undefined`.

### FR-5 — Response Field Consistency
The IDE/agent chat turn response **must** include an `evermindLearn` field with the same shape as the web Brain route response:
```ts
{ learned: true, version: number }          // on successful dispatch
{ learned: false, reason: BrainLearnSkipReason }  // on skip
```

### FR-6 — QUEUED Counter Increment
A successfully dispatched IDE/agent contribution **must** cause the project's QUEUED counter to increment by 1, observable in the Brain panel, identical to a web Brain dispatch.

### FR-7 — LAST LEARNED Timestamp Update
After the coordinator processes a contribution that originated from an IDE/agent session, LAST LEARNED **must** update to reflect the processing time, indistinguishable from a web-originated learn event.

### FR-8 — No Duplicate Dispatch on Shared Turns
If an assistant turn is somehow processed by both the web Brain route and the IDE/agent path (e.g., a shared persistence layer), the gate **must** ensure only one dispatch is fired per unique `(chatId, turnId)` pair.

### FR-9 — Backward Compatibility
Existing web Brain `POST /chats/:id/messages` behavior **must** remain unchanged. No existing tests, contracts, or response shapes for that route may regress.

---

## Acceptance Criteria

| ID | Criterion | Verification method |
|---|---|---|
| AC-1 | A substantive (≥ 40 chars) assistant reply in a project-scoped IDE/agent chat with `version >= 1` + `mode === 'connected'` Evermind produces `evermindLearn: { learned: true, version: N }` in the turn response. | Integration test / manual chat #55 repro |
| AC-2 | After AC-1, the Brain panel QUEUED counter increments by 1 within the same request cycle (coordinator enqueue confirmed). | Brain panel observation + coordinator queue log |
| AC-3 | After the coordinator drains the queue, LAST LEARNED reflects a timestamp ≤ 2 minutes after the IDE session message was sent. | Brain panel observation |
| AC-4 | A turn in a **global** (non-project-scoped) IDE chat returns `evermindLearn: { learned: false, reason: 'GLOBAL_CHAT' }` and dispatches nothing. | Unit test |
| AC-5 | A turn in a project chat where `getProjectEvermindHead` returns `version === 0` returns `evermindLearn: { learned: false, reason: 'UNSEEDED' }` and dispatches nothing. | Unit test |
| AC-6 | A turn in a project chat where `mode === 'frozen'` returns `evermindLearn: { learned: false, reason: 'FROZEN' }` and dispatches nothing. | Unit test |
| AC-7 | An assistant turn with content length < 40 characters returns `evermindLearn: { learned: false, reason: 'TOO_SHORT' }` and dispatches nothing. | Unit test |
| AC-8 | The web Brain `POST /chats/:id/messages` route passes all existing tests with no behavior change. | CI regression suite |
| AC-9 | A single assistant turn cannot produce more than one coordinator dispatch, even if both code paths execute. | Unit test asserting dispatch call count = 1 |

---

## Out of Scope

- Changes to the Evermind coordinator, learning algorithm, or version-bump logic.
- Changes to `getProjectEvermindHead` or `dispatchProjectEvermindLearnText` internals.
- Client-side IDE extension changes; the fix is server-side only.
- Learning from non-assistant turn types (tool calls, system messages, user turns).
- Retroactive reprocessing of historical IDE/agent chat turns that were missed before this fix.
- Any modification to the Brain panel UI beyond what already renders the `evermindLearn` field.
- Multi-tenant isolation changes; existing tenant context propagation is assumed correct.
- Rate limiting or deduplication beyond the single-turn `(chatId, turnId)` guard in FR-8.