> **PRD** — drafted by Ada (Sr. Product Mgr) · task #682
> _Each agent that updates this PRD signs its change below._

# PRD: Task Detachment Detection & Handling

## Problem & Goal

When a Task's `parentTaskId` is set to `null` — whether through an API call, a cascading delete of the parent Epic, or a data mutation — the system currently provides no signal that this detachment occurred. Orphaned tasks accumulate silently, breaking Epic-level progress tracking, reporting roll-ups, and team visibility.

**Goal:** Detect when a Task becomes detached from its Epic (`parentTaskId` transitions to `null`), communicate that event to relevant consumers, and ensure the system and its users can respond appropriately.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Project Manager** | Visibility into orphaned tasks so they can be reassigned or closed |
| **Developer / Task Owner** | Notification that their task is no longer linked to an Epic |
| **Backend / Integration Engineer** | Reliable event or hook to trigger downstream workflows |
| **Data / Reporting Analyst** | Clean lineage data; no silent gaps in Epic completion metrics |

---

## Scope

This PRD covers:

1. Detection of the `parentTaskId → null` state transition on a Task entity.
2. System-level event emission when detachment is confirmed.
3. User-facing notification of the detachment.
4. UI and API surfacing of orphaned task status.

---

## Functional Requirements

### FR-1 — Transition Detection

- The system **must** detect when `parentTaskId` changes from a non-null Epic ID to `null`, regardless of trigger (direct edit, Epic deletion, bulk operation, or external API call).
- Detection **must** differentiate between:
  - **Intentional detachment** — user explicitly removes the Epic link.
  - **Cascading detachment** — parent Epic was deleted and the Task was orphaned as a side effect.

### FR-2 — Event Emission

- On confirmed detachment, the system **must** emit a `task.detached` domain event with the following payload:

  ```json
  {
    "eventType": "task.detached",
    "taskId": "<uuid>",
    "previousParentId": "<epic-uuid>",
    "detachmentReason": "explicit_unlink | parent_deleted",
    "detachedAt": "<ISO-8601 timestamp>",
    "actorId": "<user-uuid | system>"
  }
  ```

- The event **must** be published to the internal event bus within 500 ms of the write commit.

### FR-3 — Orphaned Task Flagging

- The Task record **must** receive an `orphaned: true` flag and an `orphanedAt` timestamp upon detachment.
- The Task **must** remain fully accessible and editable in its orphaned state.
- A Task's `orphaned` flag **must** be cleared when `parentTaskId` is reassigned to a valid Epic.

### FR-4 — User Notification

- The Task owner and any Task watchers **must** receive an in-app notification within 60 seconds of detachment.
- Notification content **must** include: Task name, previous Epic name, detachment reason, and a direct link to the Task.
- If a workspace notification integration (Slack, email) is configured, the notification **must** also be forwarded via that channel.

### FR-5 — Orphaned Task Discovery

- The Task list view **must** support filtering by `orphaned: true`.
- The API `GET /tasks` endpoint **must** accept `?orphaned=true` as a query parameter.
- Project Managers **must** be able to bulk-reassign or bulk-close orphaned tasks from the filtered view.

### FR-6 — Epic Progress Integrity

- When a Task is detached, its progress contribution (story points, completion percentage) **must** be immediately removed from the parent Epic's roll-up calculations.
- Historical Epic snapshots (for reporting) **must** retain the Task's contribution up to the moment of detachment.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a Task with a valid `parentTaskId`, when `parentTaskId` is set to `null` via the UI or API, then a `task.detached` event is emitted within 500 ms and contains all required payload fields. |
| AC-2 | Given an Epic is deleted, when child Tasks exist, then each child Task's `parentTaskId` is set to `null`, each emits a `task.detached` event with `detachmentReason: "parent_deleted"`, and each is flagged `orphaned: true`. |
| AC-3 | Given a Task is flagged `orphaned: true`, when the Task owner opens the app, then an in-app notification is visible within 60 seconds. |
| AC-4 | Given orphaned tasks exist, when a Project Manager filters the Task list by `orphaned: true`, then only orphaned tasks are returned in the correct order. |
| AC-5 | Given a Task is orphaned, when it is reassigned to a new Epic, then `orphaned` is set to `false`, `orphanedAt` is cleared, and the Task's points are added to the new Epic's roll-up. |
| AC-6 | Given a Task was detached, when Epic progress metrics are queried, then the detached Task's contribution is excluded from current totals but present in historical snapshots prior to `orphanedAt`. |
| AC-7 | Given `GET /tasks?orphaned=true` is called with valid auth, then the response contains only tasks where `orphaned: true` and returns HTTP 200. |
| AC-8 | Detachment of a Task produces no unhandled exceptions, no silent data loss, and is fully recorded in the audit log with actor, timestamp, and previous Epic ID. |

---

## Out of Scope

- Automatic re-parenting or AI-suggested Epic reassignment (future phase).
- Archiving or auto-closing orphaned tasks on a schedule.
- Changes to Epic deletion policy (soft vs. hard delete behavior is governed by a separate PRD).
- Sub-task detachment (Tasks whose parent is another Task, not an Epic) — handled under a separate work item.
- Retroactive backfill of `orphaned` flags for tasks that were silently orphaned prior to this feature's release.
- Third-party project management integrations (Jira, Linear sync) — dependent on integration layer PRD.

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