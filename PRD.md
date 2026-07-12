> **PRD** — drafted by Ada (Sr. Product Mgr) · task #682
> _Each agent that updates this PRD signs its change below._

# PRD: Task Detachment Detection & Handling

## Problem & Goal

When a Task's `parentTaskId` is set to `null` — whether through a direct update, a cascade from Epic deletion, or a data integrity issue — the system currently has no mechanism to detect, surface, or respond to this "orphaned task" state. This creates silent data loss of organizational hierarchy, breaks Epic progress tracking, and leaves downstream agents and users without actionable information.

**Goal:** Detect when a Task becomes detached from its Epic (`parentTaskId` transitions to `null`), emit a reliable signal, and ensure the system and its users can observe and respond to that event consistently.

---

## Target Users / ICP Roles

| Role | Interest |
|---|---|
| **Project Manager** | Needs to re-assign orphaned tasks to the correct Epic before sprint planning is affected |
| **Developer / Engineer** | Needs to understand why a task no longer appears under an Epic in their tooling |
| **Platform / Backend Agent** | Must react programmatically to the detachment event to maintain data integrity |
| **QA / Audit Agent** | Needs a traceable log of all detachment events for compliance and debugging |

---

## Scope

This PRD covers:

- Detection of the `parentTaskId → null` transition on any Task entity
- Event emission at the point of detachment
- Observability artifacts (logs, audit trail entry, UI indicator)
- A defined recovery path (re-attachment or explicit orphan acknowledgement)

---

## Functional Requirements

### FR-1 · Detachment Detection

- The system **MUST** detect when a Task's `parentTaskId` changes from a non-null Epic ID to `null`, regardless of the trigger (direct edit, Epic deletion cascade, bulk operation, API call, or migration script).
- Detection **MUST** occur at the persistence layer (pre- or post-save hook / domain event) so no update path can bypass it.

### FR-2 · Orphaned Task Event

- On detachment, the system **MUST** emit a `task.detached` domain event containing:
  - `taskId` — ID of the affected Task
  - `previousParentId` — Epic ID that was the former parent
  - `detachedAt` — ISO-8601 timestamp
  - `triggeredBy` — actor ID (user, agent, or system process)
  - `reason` — enum: `EPIC_DELETED | MANUAL_UPDATE | BULK_OPERATION | UNKNOWN`

### FR-3 · Audit Trail

- Every `task.detached` event **MUST** produce an immutable audit log entry with all fields from FR-2.
- Audit entries **MUST** be queryable by `taskId`, `previousParentId`, and date range.

### FR-4 · Observability & Notification

- The orphaned Task **MUST** be visually flagged in the UI (e.g., "Unassigned Epic" badge) until re-attached or explicitly acknowledged.
- Project Managers and the task's Assignee **MUST** receive an in-app notification and, if configured, an email/webhook alert when a task they own becomes detached.
- A dedicated **Orphaned Tasks** view/filter **MUST** be available in the project dashboard.

### FR-5 · Recovery Workflow

- A user with edit rights **MUST** be able to re-attach the orphaned Task to any existing Epic via the Task detail pane.
- A user **MUST** be able to explicitly mark a Task as "standalone" (intentionally parentless), which clears the orphan flag without requiring re-attachment.
- Re-attachment **MUST** emit a `task.reattached` event and clear the orphan badge.

### FR-6 · Epic Progress Recalculation

- When a Task is detached, the former Epic's progress metrics (completion %, story point totals) **MUST** be recalculated immediately and synchronously before the response is returned to the caller.

---

## Acceptance Criteria

| # | Scenario | Expected Result |
|---|---|---|
| AC-1 | A Task's `parentTaskId` is set to `null` via the REST API | `task.detached` event is emitted; audit log entry created; orphan badge appears on Task within one UI refresh cycle |
| AC-2 | An Epic is deleted and its child Tasks are cascaded | All child Tasks emit individual `task.detached` events with `reason: EPIC_DELETED`; none are silently orphaned |
| AC-3 | Project Manager views the project dashboard | An "Orphaned Tasks" section lists all tasks where `parentTaskId` is `null` and status is not `STANDALONE` |
| AC-4 | PM re-attaches a Task to a new Epic | `task.reattached` event emitted; orphan badge removed; new Epic progress recalculated |
| AC-5 | PM marks a Task as "standalone" | Orphan badge cleared; Task no longer appears in Orphaned Tasks view; audit log records the acknowledgement |
| AC-6 | Former Epic's progress is queried immediately after Task detachment | Returned metrics exclude the detached Task's story points and status |
| AC-7 | Audit log is queried by `previousParentId` | All `task.detached` events referencing that Epic ID are returned in chronological order |
| AC-8 | A bulk operation nullifies `parentTaskId` on 50 Tasks simultaneously | All 50 Tasks individually appear in Orphaned Tasks view; no events are dropped |

---

## Out of Scope

- **Sub-task detachment** — Tasks detaching from a parent Task (non-Epic) are handled by a separate sub-task hierarchy PRD.
- **Automatic re-assignment** — The system will not automatically assign orphaned Tasks to a default Epic; this remains a human or agent decision.
- **Historical backfill** — Tasks that were already orphaned before this feature ships will be surfaced in the Orphaned Tasks view but will not have synthetic `task.detached` events generated retroactively.
- **Cross-project Epic re-attachment** — Attaching a Task to an Epic in a different project is out of scope for this iteration.
- **Slack / third-party notification integrations** — Only in-app and email notifications are in scope; webhook support for external tools is a follow-on.
- **Soft-delete / archive flows** — Behavior when an Epic is archived (not deleted) is addressed in the Epic Lifecycle PRD.

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