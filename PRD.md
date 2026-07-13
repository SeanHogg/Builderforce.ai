> **PRD** — drafted by Ada (Sr. Product Mgr) · task #683
> _Each agent that updates this PRD signs its change below._

# PRD: Preserve `parentTaskId` on Task Update

## Problem & Goal

When `tasks.update({ id, assignedAgentRef })` is called on a task that belongs to a parent (i.e., has a non-null `parentTaskId`), the current implementation silently drops or nullifies the `parentTaskId` field. This breaks parent–child task relationships whenever an agent assignment is updated, causing orphaned subtasks, broken dependency graphs, and incorrect rollup reporting.

**Goal:** Ensure that any call to `tasks.update(...)` that does not explicitly include `parentTaskId` in its payload leaves the existing `parentTaskId` value untouched on the persisted record.

---

## Target Users / ICP Roles

| Role | Why They Are Affected |
|---|---|
| **Orchestrator Agent** | Assigns sub-agents to child tasks during plan decomposition; relies on stable parent–child links for progress tracking |
| **Task Service Consumers** | Any service or agent reading `parentTaskId` to build task trees or compute rollup status |
| **QA / Test Automation** | Must be able to assert task hierarchy integrity after any update operation |

---

## Scope

This change is limited to the `tasks.update` method and its underlying persistence layer. No schema migrations, no new API endpoints, and no changes to how `parentTaskId` is set at task creation time.

---

## Functional Requirements

### FR-1 — Immutable `parentTaskId` by Default
When `tasks.update({ id, ...payload })` is called and `payload` does **not** contain a `parentTaskId` key, the stored `parentTaskId` for that task **must** remain unchanged after the update completes.

### FR-2 — Explicit `null` Clears the Relationship
When `payload` explicitly includes `parentTaskId: null`, the update **must** set `parentTaskId` to `null`, allowing intentional de-parenting.

### FR-3 — Explicit Value Reassigns the Relationship
When `payload` explicitly includes a valid `parentTaskId: <id>`, the update **must** persist the new parent reference (subject to existing parent-existence validation).

### FR-4 — `assignedAgentRef` Update Does Not Affect Hierarchy
A call of the exact form `tasks.update({ id, assignedAgentRef })` (no `parentTaskId` key present) **must** update only `assignedAgentRef` and leave all other fields, including `parentTaskId`, at their pre-call values.

### FR-5 — Atomicity
The field-level preservation must be atomic; partial writes that temporarily clear `parentTaskId` are not acceptable.

### FR-6 — Audit / Event Payload Consistency
Any event or changelog entry emitted after `tasks.update` must reflect the true post-update state of `parentTaskId` (i.e., the preserved value, not null).

---

## Acceptance Criteria

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | A task exists with `parentTaskId = "parent-123"` | `tasks.update({ id, assignedAgentRef: "agent-7" })` is called | Task record still has `parentTaskId = "parent-123"` |
| AC-2 | A task exists with `parentTaskId = "parent-123"` | `tasks.update({ id, assignedAgentRef: "agent-7", parentTaskId: null })` is called | Task record has `parentTaskId = null` |
| AC-3 | A task exists with `parentTaskId = "parent-123"` | `tasks.update({ id, assignedAgentRef: "agent-7", parentTaskId: "parent-456" })` is called | Task record has `parentTaskId = "parent-456"` |
| AC-4 | A task exists with `parentTaskId = null` | `tasks.update({ id, assignedAgentRef: "agent-7" })` is called | Task record still has `parentTaskId = null` |
| AC-5 | AC-1 scenario | Event/changelog emitted after update | Event payload contains `parentTaskId = "parent-123"` |
| AC-6 | Any update call | Read-back immediately after `tasks.update` resolves | Returned task object's `parentTaskId` matches persisted value |

---

## Out of Scope

- Changes to `tasks.create` — parentage at creation time is unaffected.
- Cascading re-parenting of grandchild tasks.
- Validation that the referenced `parentTaskId` forms no cycles (covered by existing creation-time logic; not re-evaluated on every update unless `parentTaskId` is changing).
- UI or API surface changes — this is a service/data-layer fix only.
- Migration of historically corrupted records where `parentTaskId` was previously dropped.
- Changes to any other update methods (e.g., `tasks.updateStatus`, `tasks.updatePriority`) — those are separate concerns to be evaluated independently.

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