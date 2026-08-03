> **PRD** — drafted by Ada (Sr. Product Mgr) · task #692
> _Each agent that updates this PRD signs its change below._

# Task Detachment Detection & Handling

## Problem & Goal
When a parent task is deleted, moved, or otherwise invalidated, child tasks become “detached” — their `parentTaskId` unexpectedly becomes `null`. Currently, this detachment is silent: no notification, no audit trail, and no recovery mechanism. Users lose structural context, which leads to confusion, orphaned work, and broken workflows.

**Goal:** Provide a robust detection, notification, audit, and recovery system for task detachment events. Ensure that when a task becomes detached, the system immediately records the event, alerts relevant users, surfaces affected tasks in a central dashboard, and offers guided reattachment or recovery.

## Target Users / ICP Roles
- **Project Managers / Team Leads** – need visibility into detached tasks to maintain project structure and prevent lost work.
- **Task Owners & Assignees** – need to know when their task’s parent context has changed so they can take corrective action.
- **System Administrators / Auditors** – require a full audit trail of detachment events for compliance and debugging.

## Scope
- Detect parent removal events that cause `parentTaskId` to become `null` for any task.
- Emit a domain event (`TaskDetached`) containing relevant metadata.
- Persist an immutable audit log entry for every detachment.
- Expose a dedicated dashboard view listing all currently detached tasks with filtering and sorting.
- Provide manual reattachment workflow (boundary-checked selection of a new parent) and a “recover” option (set parent to root/project root).
- Supply REST API endpoints to query detachment status and trigger reattachment.

## Functional Requirements
1. **Detection Hook**
   - Whenever a parent task is deleted or its relationship is severed, the system must inspect all children and flag any whose `parentTaskId` transitions to `null` (explicitly or implicitly).
   - Edge case: bulk operations (e.g., cascading deletes) must treat each affected child individually.

2. **Domain Event**
   - Publish a `TaskDetached` event with at least: `taskId`, `previousParentId`, `detachmentTimestamp`, `reason` (e.g., `parent_deleted`, `parent_moved`).
   - The event bus must guarantee at-least-once delivery to all subscribers.

3. **Audit Trail**
   - Write a permanent record to an audit log table (`task_detachment_audit`) containing the same fields as the event, plus `actorId` (the user/system that triggered the removal) and `reattachmentStatus`.
   - The audit log must be immutable once written; support querying by time range, task, parent, or reason.

4. **Dashboard**
   - Add a new tab/section to the project dashboard: “Detached Tasks”.
   - Display tasks in a sortable, filterable list with columns: task title, previous parent name, detachment timestamp, reason, current status (detached/reattached).
   - Allow bulk selection and group actions (reattach, recover).
   - Show a summary badge in the main navigation indicating the number of pending detachments.

5. **Reattachment & Recovery Workflows**
   - **Manual reattachment:** From the dashboard or task detail page, enable a “Change Parent” action that opens a search/select dialog of valid parent tasks (excluding the task itself and descendants).
   - **Recovery:** Provide a “Recover to Root” action that sets the parent to a designated project root task (defined by project configuration).
   - Both actions must update `parentTaskId`, emit a `TaskReattached` event, append audit logs, and update the detachment status in the audit trail.

6. **API Endpoints**
   - `GET /api/tasks/detached` – list all currently detached tasks.
   - `GET /api/tasks/{taskId}/detachment-audit` – get detachment history for a task.
   - `POST /api/tasks/{taskId}/reattach` – reattach to a specified new parent (body: `{ parentTaskId: "..." }`).
   - `POST /api/tasks/{taskId}/recover` – reattach to project root.
   - All endpoints require appropriate authorization scopes.

## Acceptance Criteria
- When a parent task is deleted, all immediate children are flagged as detached, `TaskDetached` events are emitted, and audit entries are recorded within the same transaction.
- The detached tasks dashboard shows the items within 5 seconds of the event; the count badge updates accordingly.
- A user can select a detached task, choose a new parent, and the task reappears in the normal hierarchy with updated parent, `TaskReattached` event fired, and audit log updated.
- Recovering a task to the project root sets `parentTaskId` to the configured root task ID and logs the recovery.
- Audit trails are queryable and never deleted or modified.
- APIs respond within 200ms under normal load; auth failures return 403. Reattachment to an invalid parent (e.g., the task itself) returns 400 with a clear error message.

## Out of Scope
- Automatic reattachment (e.g., heuristics to guess the intended parent).
- Undo/redo of detachment beyond reattachment itself (i.e., no versioned rollback of the hierarchy).
- Historical snapshot of the tree before detachment (only audit log).
- Integration with external notification channels (email/Slack) – will be covered by a separate notification service PRD.
- Bulk detachment handling performance optimisation for >10,000 tasks – initial release targets typical project sizes (<5,000 tasks).

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