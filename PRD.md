> **PRD** — drafted by Ada (Sr. Product Mgr) · task #683
> _Each agent that updates this PRD signs its change below._

# PRD: Preserve `parentTaskId` on Partial Task Update

## Problem & Goal

When `tasks.update({ id, assignedAgentRef })` is called on a task that has a parent, the `parentTaskId` field is silently dropped or overwritten with `null`/`undefined`. This breaks the task hierarchy, causes orphaned subtasks, and corrupts any downstream logic that relies on parent–child relationships (rollups, dependency graphs, cascading status changes).

**Goal:** Ensure that a partial update to any task field leaves all unspecified fields — specifically `parentTaskId` — unchanged.

---

## Target Users / ICP Roles

| Role | Why they are affected |
|---|---|
| **Agent orchestrator** | Assigns agents to subtasks programmatically; hierarchy corruption breaks multi-agent workflows. |
| **Backend / platform engineer** | Owns the `tasks` service and must implement the fix. |
| **QA / test engineer** | Must write regression coverage to prevent recurrence. |
| **Product integrator / API consumer** | Calls `tasks.update` from external systems; relies on stable partial-update semantics. |

---

## Scope

This change is limited to the `tasks.update` method and its persistence layer. It does not redesign the task data model or alter how `parentTaskId` is set during task creation.

---

## Functional Requirements

### FR-1 — Partial-update semantics (core fix)
`tasks.update` **must** perform a merge/patch update, not a full replace. Any field absent from the update payload **must** retain its current persisted value.

### FR-2 — `parentTaskId` preservation
Calling `tasks.update({ id, assignedAgentRef })` on a task where `parentTaskId` is already set **must** leave `parentTaskId` unchanged after the operation completes.

### FR-3 — Explicit null/undefined is intentional
If the caller explicitly passes `parentTaskId: null`, the field **may** be cleared (detach from parent). An absent key and an explicit `null` must be treated differently.

### FR-4 — All scalar fields follow the same rule
The merge/patch behavior introduced for `parentTaskId` **must** apply uniformly to every other task field (`status`, `title`, `dueDate`, `metadata`, etc.) to prevent future regressions of the same class.

### FR-5 — Atomic persistence
The read-modify-write cycle (fetch existing record → merge patch → write back) **must** be atomic or protected by optimistic concurrency control to prevent race-condition data loss.

### FR-6 — Return value reflects final state
`tasks.update` **must** return the complete, post-merge task object so callers can confirm the final state without a separate `tasks.get` call.

---

## Acceptance Criteria

| # | Scenario | Expected outcome |
|---|---|---|
| AC-1 | `tasks.update({ id, assignedAgentRef })` called on a task with `parentTaskId = "task-42"` | Returned task has `parentTaskId === "task-42"`; persisted record unchanged |
| AC-2 | `tasks.update({ id, assignedAgentRef })` called on a task with `parentTaskId = null` | Returned task has `parentTaskId === null`; no error |
| AC-3 | `tasks.update({ id, parentTaskId: null })` called on a task with `parentTaskId = "task-42"` | Returned task has `parentTaskId === null`; parent–child link removed |
| AC-4 | `tasks.update({ id, parentTaskId: "task-99" })` called on a task with `parentTaskId = "task-42"` | Returned task has `parentTaskId === "task-99"`; link updated |
| AC-5 | `tasks.update({ id, status: "done" })` called on a task with `assignedAgentRef` set | Returned task retains existing `assignedAgentRef` value |
| AC-6 | Two concurrent `tasks.update` calls on the same task ID | Both operations complete without either silently discarding the other's changes (optimistic lock or equivalent) |
| AC-7 | Unit test suite passes with no regressions on existing `tasks.update` tests | CI green |
| AC-8 | Integration test explicitly covering AC-1 through AC-4 is added to the test suite | Tests present, named, and passing |

---

## Out of Scope

- Changing the `tasks.create` signature or behavior
- Migrating existing corrupted records (tracked separately)
- Adding new fields to the task schema
- UI changes or API versioning
- Cascading update logic (e.g., propagating status changes to parent) — that is a separate feature
- Authorization / permission checks on who may reassign an agent or reparent a task

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