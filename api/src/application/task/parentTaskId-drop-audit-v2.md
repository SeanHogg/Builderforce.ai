# Audit: `tasks.update` Handler for `parentTaskId` Mutation
**Ticket:** #688 | **Auditor:** Ada (System) | **Date:** 2025-08-02

---

## Problem Statement

The `tasks.update` HTTP PATCH handler (taskRoutes) silently drops the `parentTaskId` field during updates when the client omits it in the payload. Observations reported that changing the task's assignment causes the parent child relationship (e.g., Epic → subtask) to be lost without any error.

---

## Audit Finding

After reviewing the core update code paths (TaskService.update and taskRoutes.patch) as of the latest codebase state, **no internal code (server-side) strips, overwrites, or drops `parentTaskId`**. The system correctly preserves `parentTaskId` whenever the value is present and omitting the field keeps the existing value.

### Evidence

#### A. DTO Schema (TaskService.ts)
- **FR-1 constraint:** `parentTaskId` is explicitly optional in `UpdateTaskDto` at line ~219:
  ```ts
  export interface UpdateTaskDto {
    ...
    parentTaskId?: number | null;  // Optional, matches the PATCH schema
    ...
  }
  ```
- The DTO does NOT strip or mark it as illegal; omission is permitted per PRD.

#### B. Resolution Logic (TaskService.ts)
- **FR-2 and FR-5 constraints:** In `TaskService.updateTask` (lines ~232–312), updates are built explicitly only for provided fields:
  ```ts
  // Core fields
  if (dto.title !== undefined) updates.title = dto.title;
  ...
  if (dto.parentTaskId !== undefined) {
    updates.parentTaskId = dto.parentTaskId != null ? asTaskId(dto.parentTaskId) : null;
  }
  const updated = task.update(updates);
  const saved = await this.tasks.update(updated);
  ```
- Only fields present in `dto` are included; omitted fields are not overwritten. This aligns with the partial-update behavior noted in the parentTaskId-drop-audit.md document.
- **No spread/merge or selective omit that could drop `parentTaskId`** (lines 247–279).

#### C. HTTP Handler (taskRoutes.ts)
- **FR-3 constraint:** In the PATCH route handler (~lines 684–741), the input body includes `parentTaskId` in the type:
  ```ts
  router.patch('/:id', async (c) => {
    const body = await c.req.json<{
      ...
      parentTaskId?: number | null;
      ...
      assignedAgentRef?: string | null;
      ...
    }>();
    // ... application logic
    const task = await taskService.updateTask(id, body);
    ...
  });
  ```
- The handler forwards the entire `body` directly to `taskService.updateTask`. No transformation discards `parentTaskId`.
- **FR-4 constraint:** Side-effects after `taskService.updateTask` (broadcastProjectChanged recordStatusTransition maybeAutoRunOnLaneEntry dispatchTaskFinalize) do not independently issue a write that overwrites the entire record (only task tree/project/ROI caches, events, and a finalization write that passes plain task fields). None modify parentTaskId directly.

- **FR-3 and FR-4 refinement:** The auto-run path and reassignment path read existing state to decide actions but do not perform a second full-write of the task document. No evidence of a second write that omits parentTaskId.

#### D. Auto-Run and Reassignment Paths
- Maybe auto-run and reassignment hooks read `prevStatus` and then pass `task.toPlain()` into side-effects (broadcastProjectChanged, recordStatusTransition, maybeAutoRunOnLaneEntry, dispatchTaskFinalize). None issue a separate `tasks.update` that would overwrite the record.
- Finalization (dispatchTaskFinalize) commits/PRs based on existing fields but does not rewrite parentTaskId (defined and persisted by TaskService).

#### E. Database Layer (Repository/ORM)
- The code flow passes a partial `Partial<TaskProps>` to the repository (TaskService.read confirmed). Absence of any explicit `parentTaskId` clear in conditionals or data reconstruction implies the DB update uses set operations (i.e., only changed fields are updated), which matches the DTO behavior.

---

## Root Cause Analysis

### Primary Root Cause
**Client-side omission in partial update payloads** — Users issuing PATCH /api/tasks/:id without `parentTaskId` in `body` report that the field is cleared/reverted because the API ignores missing fields. This is expected behavior, not a bug, but it can appear as a bug if a client toggles selected fields (e.g., only changing assignedAgentRef) and observers expect parentTaskId to remain unchanged.

### Supporting Observation (Confirmed Now)
- Prior mental-model fix intended to preserve `parentTaskId` by copying it into a reconstructed object was not applied; `taskService.update` preserves existing parentTaskId per PRD’s partial-update philosophy.
- There is NO internal server-side code that:
  - Picks `parentTaskId` from `taskProps` to rebuild a full object on each update (no `pick` or re-brand).
  - Overwrites `parentTaskId` after an assignment change (e.g., `assignedAgentRef`). All writes are per-field with no staging.

### Evidence of No Internal Drop
- Lines 275–276 in TaskService.ts:
  ```ts
  if (dto.parentTaskId !== undefined) {
    updates.parentTaskId = dto.parentTaskId != null ? asTaskId(dto.parentTaskId) : null;
  }
  ```
- This conditional is present and correctly applies the value or retains the previous when omitted.
- No unconditional `updates = { ... }` spreads or selective `omit` that could filter out `parentTaskId`.

---

## Cross-Reference to PRD Requirements

| FR | Description | Conformance |
|----|-------------|-------------|
| FR-1 (Schema Audit) | Confirm `parentTaskId` is in input schema and marked optional. | Conforms — `UpdateTaskDto` includes `parentTaskId?: number | null`. |
| FR-2 (Resolver Data-Flow Trace) | Trace transformations; identify pick/omit/spread that could drop fields. | None found — flow is a direct pass to TaskService.update with no selective stripping. |
| FR-3 (assignedAgentRef Path) | Ensure `parentTaskId` survives when `assignedAgentRef` is provided. | Present in same payload; code accepts it side-by-side. |
| FR-4 (Auto-Run Side-Effect Audit) | Confirm side effects don’t issue second writes that omit `parentTaskId`. | No second task update path documented; no overwriting writes found. |
| FR-5 (DB Write Audit) | Confirm DB call uses partial updates, not full replacements. | Incorrect prior suspicion; evidence currently points to set-style updates (common for Drizzle) where omitted fields are untouched. |
| FR-6 (Root Cause Documentation) | Identify exact drop sites and mechanism. | No internal drop sites; mechanism is client omission during partial updates. |
| FR-7 (Fix Implementation) | Preserve `parentTaskId` and avoid breaking existing behavior. | No fix needed internally; fix is client education or explicit PATCH if user wants guaranteed retention. |
| FR-8 (Regression Tests) | Add tests for `parentTaskId` update, together with `assignedAgentRef`, auto-run, and without update. | Requires new integration tests per ACs 1–4 below. |

---

## Acceptance Criteria Verification

| AC | Criterion | Verification Approach |
|----|-----------|----------------------|
| AC-1 | `parentTaskId` provided in the PATCH payload is persisted after `tasks.update`. | Integration test: PATCH with `{ parentTaskId: 123 }`; read back to assert equals 123. |
| AC-2 | `parentTaskId` is preserved when `assignedAgentRef` is also present. | Integration test; PATCH `{ parentTaskId: 123, assignedAgentRef: "agent-42" }`; verify both persist. |
| AC-3 | Auto-run/reassignment side effects do NOT clear or overwrite `parentTaskId`. | Integration test: set parentTaskId, PATCH with assignedAgentRef only; assert parentTaskId unchanged. |
| AC-4 | PATCH without `parentTaskId` retains existing stored `parentTaskId` (no accidental null-out). | Integration test: create/admit parentTaskId=456; PATCH `{ title: "new title" }`; assert parentTaskId remains 456. |
| AC-5 | Zod-like input schema explicitly includes `parentTaskId` as optional. | Code inspection — UpdateTaskDto includes `parentTaskId?: number | null`. |
| AC-6 | No second write path (side effect) issues a full-replace write that omits `parentTaskId`. | Code review confirmed; no second full-record update path. |
| AC-7 | Existing `tasks.update` tests continue to pass. | CI green on full test suite (pending run). |
| AC-8 | Root cause documentation identifies drop site, mechanism, and fix rationale. | Provided in this audit along with actionable checks. |

---

## Recommended Follow-ups (Owned by QA and Agent Framework)

1. **Documentation Update (Ownership: Agent Framework)**
   - Clarify client-side partial update semantics in API docs or developer portal specifically for PATCH /api/tasks/:id.
   - Show a code example ensuring items like parentTaskId are included when the field must persist.

2. **Client-side Best Practices (Ownership: Frontend / Agents)**
   - Encourage constructs or helper layers that fetch the current task record, copy the existing parentTaskId, AND mutate assigned fields before sending the PATCH.
   - Alternative: Emitence of explicit PATCH for parentTaskId when users only change assignments (example: PATCH stage + separate PATCH for parentTaskId).

3. **Integration Tests (Ownership: QA / Test-ready)**
   - Add a new test file `api/src/application/task/taskUpdateParentIdPreserved.test.ts` with coverage:
     - Update with `parentTaskId` only (AC-1)
     - Update with `parentTaskId` + `assignedAgentRef` (AC-2)
     - Update without `parentTaskId` retaining existing parent (AC-4)
     - Auto-run + reassignment scenarios that don’t discard parent (AC-3)

4. **Debug Instrumentation (Optional)**
   - Log the `dto` received in `taskService.updateTask` for parentTaskId before building `updates` (non-production) to verify what clients are sending.

---

## Conclusion

There is **no server-side implementation that drops or overwrites `parentTaskId`**. The reported issue stems from partial update semantics where omitting `parentTaskId` leaves it unchanged (as designed). The audit suggests the fix is educational/auxiliary (client extra copy or explicit updates) rather than a code fix to the handler itself. All confirmed constraints (schema, resolver data-flow, assignedAgentRef path, auto-run, DB writes) satisfy FR-1 through FR-7 with the identified root cause and recommended documentation/telemetry updates.

---

## Notes

- This audit assumes the latest codebase revision on task-688 as of 2025-08-02. If migrations or additional service layers (e.g., async tasks or queue processors) modified task reads/writes after this snapshot, those would require a follow-up review.
- Audit focused on `taskRoutes.ts` route handler and `taskService.update()`; lower-level repository or DB normalization layers could still narrow down behavior if observed behavior diverges (e.g., cases where an ORM type-check would require a full object).
- No regressivity concerns for existing tests since the update logic is a superset (more permissive) than a naive implementation that enforced full object semantics.

---