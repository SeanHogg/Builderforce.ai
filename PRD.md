> **PRD** — drafted by Ada (Sr. Product Mgr) · task #689
> _Each agent that updates this PRD signs its change below._

# PRD: Fix `parentTaskId` Preservation in `tasks.update`

## Problem & Goal

When `tasks.update` is called with a payload that includes `assignedAgentRef` (but omits `parentTaskId`), the update operation unintentionally nullifies or resets the `parentTaskId` field on the task record. This breaks task hierarchy integrity, causes orphaned subtasks, and produces incorrect downstream behaviour in any workflow that relies on parent–child task relationships.

**Goal:** Make `tasks.update` a true partial-update operation — only fields explicitly present in the caller's payload are written; absent fields retain their current persisted values.

---

## Target Users / ICP Roles

| Role | Impact |
|---|---|
| **Orchestrator agents** | Emit `tasks.update` to assign agents mid-workflow; must not corrupt task trees |
| **Backend / platform engineers** | Own the update service layer and must implement the fix correctly |
| **QA / test engineers** | Must verify regression coverage for all partial-update combinations |
| **Downstream consumer agents** | Read `parentTaskId` to traverse task hierarchies; correctness is critical |

---

## Scope

This fix targets the `tasks.update` endpoint/service method exclusively. It covers:

- The field-merging logic in the task update handler
- Any DTO-to-model mapping step that could silently coerce `undefined` → `null`
- Unit and integration tests for the affected code paths

---

## Functional Requirements

### FR-1 — Partial field semantics
`tasks.update` **must** apply a merge strategy: only keys present in the incoming payload object are written to the data store. Keys absent from the payload are ignored and the stored value is preserved unchanged.

### FR-2 — `parentTaskId` isolation
Setting `assignedAgentRef` (or any other single field) in the payload **must not** alter `parentTaskId` unless `parentTaskId` is explicitly included in the same payload.

### FR-3 — Explicit null support
A caller may intentionally clear `parentTaskId` by passing `"parentTaskId": null` explicitly. This deliberate nullification **must** be honoured and distinguished from the field being absent.

### FR-4 — No regression on other fields
The same partial-update guarantee applies to all task fields: `status`, `assignedAgentRef`, `metadata`, `dueAt`, `priority`, etc. No field may be reset to a default or null value solely because it was omitted from the payload.

### FR-5 — Atomic write
The merged update **must** be applied atomically; no intermediate state with partially-reset fields should be observable.

### FR-6 — Error handling unchanged
Validation errors (e.g., unknown `parentTaskId` reference, invalid `assignedAgentRef` format) **must** continue to be raised and must not be affected by this change.

---

## Acceptance Criteria

| # | Scenario | Expected Result |
|---|---|---|
| AC-1 | `tasks.update` called with only `{ assignedAgentRef: "agent-42" }` on a task that has `parentTaskId: "task-99"` | `parentTaskId` remains `"task-99"` after the update |
| AC-2 | `tasks.update` called with `{ assignedAgentRef: "agent-42", parentTaskId: null }` | `parentTaskId` is set to `null`; `assignedAgentRef` is set to `"agent-42"` |
| AC-3 | `tasks.update` called with `{ parentTaskId: "task-55" }` on a task with an existing `assignedAgentRef` | `assignedAgentRef` is unchanged; `parentTaskId` is updated to `"task-55"` |
| AC-4 | `tasks.update` called with an empty payload `{}` | No fields are mutated; task record is identical to pre-call state |
| AC-5 | `tasks.update` called with every field explicitly provided | All provided fields are written; behaviour matches current full-update path |
| AC-6 | Concurrent `tasks.update` calls on the same task targeting different fields | Both fields are persisted correctly; neither call resets the other's field |
| AC-7 | Existing unit tests continue to pass | No regressions in the test suite |
| AC-8 | New unit tests covering AC-1 through AC-4 are added and pass | Test coverage for partial-update scenarios is present in the codebase |

---

## Out of Scope

- Changes to `tasks.create` — full-object semantics at creation time are correct and intentional
- Changes to any field's validation rules or business logic beyond the merging layer
- Schema migrations — `parentTaskId` already exists as a nullable column/field
- UI or API contract changes (request/response shape remains identical)
- Bulk update endpoints — addressed separately if the same bug exists there
- Performance optimisations to the update path unrelated to field merging
- Audit logging or event-sourcing changes triggered by the update

## Requirements

_Owned by the business-analyst — to be authored._

## Design

### Root Cause

The bug originated from a naïve `{ ...this.props, ...updates }` spread in the merge step, where omitted fields filled in as `undefined` in `updates`. The persistence layer (Postgres via Drizzle) interprets an omitted field during `UPDATE` as "do not touch this column". However, upstream code that accepted payload merging (awaited `FieldService.update(...)`) and the persistence layer which wrote `null` for `undefined`-valued DTO fields had a cross-cutting bug: an omitted-field DTO could be silently coerced to `null` on write, not just omitted.

### Fix Strategy

We enforce true partial-update semantics by making three guarantees across the update path:

1. **Merge Surgery (Task.update) — the ringmaster:** A partial-update promise is enforced BEFORE persistence. `Task.update` only merges keys with a defined value: `Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined))`. `undefined`-valued keys are discarded, and only fields the caller explicitly provided propagate into the `TaskProps`. This ensures `this.props` (with its current persisted value) is never clobbered by an omitted field.

2. **DTO Passing Guard (TaskService.updateTask):** The service never propagates an implicit `undefined` into the domain merge. For each nullable DTO field (e.g., `parentTaskId`, `assignedAgentHostId`), if there is no change (`dto.field === undefined`), we pass `undefined` directly; otherwise we pass the coerced value (`dto.field != null ? coerce(dto.field) : null`). This mirrors the pattern in `Task.update` and guarantees that the domain merge receives a clean set of fields.

3. **Persistence Layer (TaskRepository.update):** Writes `plain.parentTaskId ?? null` and `plain.assignedAgentRef ?? null`. Because `Task.update` returns a new `Task` whose `parentTaskId` is always a concrete value (never `undefined`), `plain.parentTaskId` is the real forced-merge value. Drizzle's Postgres driver omits `undefined` from the `SET` clause, so:
   - If `parentTaskId === undefined` on the plain object, the column is left untouched (preserve existing).
   - If `parentTaskId === null`, the column is written as `NULL` (explicit clear).
   - If `parentTaskId` is a concrete `TaskId`, the column is written to the new value.

The combination guarantees:
- Omitted fields → undefined passed through → not merged by `Task.update` → left untouched in DB.
- Explicit null request → `null` passed through → merged as `null` in `Task.update` → written as `NULL`.
- Multiple partial fields in one call → all present values are merged into `TaskProps` → all written atomically.

### Scope

- **Not touched:** `tasks.create` (full-object semantics are intentional at creation time; constraints like `parentTaskId: null` are the exception).
- **Not touched:** validation or business logic beyond merging.
- **Not touched:** schema migrations (`parentTaskId` already exists as nullable).
- **Not touched:** bulk-update endpoints (addressed separately if issues surface there).
- **Not touched:** UI or API contract (request/response shape stays identical).
- **Not touched:** performance optimizations unrelated to field merging.

---

## Implementation Notes

### Code Pattern Consistency

The fix is consistent across all nullable DTO fields in `UpdateTaskDto` (`parentTaskId`, `sprintId`, `releaseId`, `storyPoints`, `businessValue`, `assignedAgentType`, `assignedAgentHostId`, `assignedAgentRef`, `assignedUserId`, `startDate`, `dueDate`, `persona`, description):

```ts
// TaskService.updateTask example for parentTaskId
parentTaskId: dto.parentTaskId !== undefined
  ? (dto.parentTaskId != null ? asTaskId(dto.parentTaskId) : null)
  : undefined,
```

This pattern guarantees that:
- When `dto.parentTaskId` is absent, `undefined` propagates to `Task.update`.
- When `dto.parentTaskId === null` is explicitly passed, `null` propagates.
- When `dto.parentTaskId` has a value, the coerced value propagates.

### Atomic Update Guarantees

`TaskRepository.update` performs a single `db.update(...).where(...).returning()` statement, which in Postgres is atomic. The entire payload (all merged fields) is written in one statement, preventing an intermediate state where `parentTaskId` is reset but `assignedAgentRef` remains set. No other service code mutates the task between `Task.update()` and `TaskRepository.update()`.

### Branch Consistency

The partial-update pattern enforced in `Task.update` also backs the manual setters (`start()`, `complete()`, `linkPullRequest()`, etc.), which all delegate to `update()`, so other update paths (not part of this ticket) inherit the same semantics without regressions.

---

## Review

**Reviewer verdict: APPROVED (no blocking issues).**

Correctness (ranked by severity):
- **[resolved] Highest severity — the reported bug:** `parentTaskId` no longer nulls when `assignedAgentRef` is set alone. Verified via the `undefined`-stripping merge in `Task.update` plus the `undefined`-vs-`null` guard in `TaskService.updateTask`. AC-1..AC-5 covered by `taskUpdateParentIdPreserved.test.ts`.
- **[verified] Explicit-null path (FR-3):** `{ parentTaskId: null }` still clears the column because the service converts an explicit `null` DTO value to `null` (not `undefined`), and `Task.update` keeps `null` (only `undefined` is stripped). `TaskRepository.update` writes `plain.parentTaskId ?? null`, which persists `NULL`.
- **[verified] No collateral regressions (FR-4):** The same `!== undefined` guard is applied to every nullable DTO field in `updateTask` (`assignedAgentHostId`, `startDate`, `dueDate`) and the generic strip in `Task.update` protects the rest, so no field is reset merely by omission.
- **[verified] Atomicity (FR-5):** `TaskRepository.update` is a single `UPDATE ... RETURNING` — no observable half-written state.
- **[verified] Error handling unchanged (FR-6):** No validation branches were altered; the merge/persist change is orthogonal.

Maintainability note (non-blocking): the "convert `undefined` → coerced-or-null, else `undefined`" pattern is repeated per field in `updateTask`. It is intentional and readable, and centralising it into a helper is a future refactor, out of scope for this fix.

## Test Evidence

_Owned by the qa-tester — to be authored._