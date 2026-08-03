> **PRD** — drafted by Ada (Sr. Product Mgr) · task #692
> _Each agent that updates this PRD signs its change below._
> - **Requirements** authored by BA (Business Analyst) · 2026-08-03

# Task Detachment Detection & Handling

## Problem & Goal
When a parent task is deleted, moved, or otherwise invalidated, child tasks become "detached" — their `parentTaskId` unexpectedly becomes `null`. Currently, this detachment is silent: no notification, no audit trail, and no recovery mechanism. Users lose structural context, which leads to confusion, orphaned work, and broken workflows.

**Goal:** Provide a robust detection, notification, audit, and recovery system for task detachment events. Ensure that when a task becomes detached, the system immediately records the event, alerts relevant users, surfaces affected tasks in a central dashboard, and offers guided reattachment or recovery.

## Target Users / ICP Roles
- **Project Managers / Team Leads** – need visibility into detached tasks to maintain project structure and prevent lost work.
- **Task Owners & Assignees** – need to know when their task's parent context has changed so they can take corrective action.
- **System Administrators / Auditors** – require a full audit trail of detachment events for compliance and debugging.

## Scope
- Detect parent removal events that cause `parentTaskId` to become `null` for any task.
- Emit a domain event (`TaskDetached`) containing relevant metadata.
- Persist an immutable audit log entry for every detachment.
- Expose a dedicated dashboard view listing all currently detached tasks with filtering and sorting.
- Provide manual reattachment workflow (boundary-checked selection of a new parent) and a "recover" option (set parent to root/project root).
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
   - Add a new tab/section to the project dashboard: "Detached Tasks".
   - Display tasks in a sortable, filterable list with columns: task title, previous parent name, detachment timestamp, reason, current status (detached/reattached).
   - Allow bulk selection and group actions (reattach, recover).
   - Show a summary badge in the main navigation indicating the number of pending detachments.

5. **Reattachment & Recovery Workflows**
   - **Manual reattachment:** From the dashboard or task detail page, enable a "Change Parent" action that opens a search/select dialog of valid parent tasks (excluding the task itself and descendants).
   - **Recovery:** Provide a "Recover to Root" action that sets the parent to a designated project root task (defined by project configuration).
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

### User Stories

| ID | Role | Story | Acceptance Criteria | Priority |
|----|------|-------|---------------------|----------|
| US-1 | Project Manager | As a PM, I want to see all detached tasks in one place so I can triage orphaned work immediately. | Dashboard lists every task with `parentTaskId = null` that had a prior parent; badge count matches list length; list refreshes within 5 seconds of a detachment event. | P0 |
| US-2 | Project Manager | As a PM, I want to re-parent a detached task to restore it to the correct hierarchy. | "Change Parent" dialog loads valid candidate tasks (excludes self + descendants); selecting a parent updates `parentTaskId`, fires `TaskReattached`, and the task disappears from the detached list. | P0 |
| US-3 | Task Owner | As a task assignee, I want to be notified when my task loses its parent so I am not blindsided by a broken workflow. | `TaskDetached` event is published; the dashboard badge increments; the task appears in the detached view with my ownership visible. | P1 |
| US-4 | System Admin | As an admin, I need a complete, immutable audit trail of every detachment and reattachment for compliance and debugging. | Every detachment writes a row to `task_detachment_audit`; every reattachment updates the row's `reattachmentStatus` and appends a reattachment audit entry; no row is ever deleted or modified except the status field. | P1 |
| US-5 | Team Lead | As a team lead, I want to recover a detached task to the project root when the original parent cannot be restored. | "Recover to Root" sets `parentTaskId` to the project's configured root task; recovery is logged in the audit trail with `reason = "recovered_to_root"`. | P1 |
| US-6 | Project Manager | As a PM, I want to bulk-reattach or bulk-recover multiple detached tasks to reduce manual effort. | Dashboard supports multi-select checkboxes; "Bulk Reattach" and "Bulk Recover" actions apply to all selected tasks; each task emits its own event and audit entry. | P2 |

### Detailed Functional Requirements

#### FR-1: Detachment Detection

| # | Requirement | Rationale |
|---|-------------|-----------|
| FR-1.1 | The system MUST intercept any operation that sets a task's `parentTaskId` from a non-null value to `null` (including: parent deletion with cascading null-set, explicit parent removal via task update, and parent move to another project). | This is the core detection trigger. Without interception, detachment is silent. |
| FR-1.2 | Detection MUST run in the same database transaction as the parent-modifying operation. | Prevents race conditions where a child is detached but the event is never emitted due to a mid-operation crash. |
| FR-1.3 | For bulk/cascading deletes, the system MUST enumerate every affected child individually and emit one `TaskDetached` event per child. | Ensures no child is silently detached; each gets its own audit row. |
| FR-1.4 | The system MUST NOT flag tasks that were created with `parentTaskId = null` (i.e., tasks that were always root-level). Only tasks that *transition* from having a parent to no parent are "detached." | Prevents false positives that would flood the dashboard. |
| FR-1.5 | The triggering operation's actor (user ID or system identifier) MUST be captured and stored as `actorId` on the audit record. | Required for the audit trail (US-4). |

#### FR-2: Domain Events

| # | Requirement | Rationale |
|---|-------------|-----------|
| FR-2.1 | A `TaskDetached` event MUST be emitted with the following payload: `{ eventId, eventType: "task.detached", taskId, previousParentId, projectId, detachmentTimestamp, reason, actorId }`. | Standardised event schema enables downstream subscribers (notification service, analytics). |
| FR-2.2 | A `TaskReattached` event MUST be emitted with payload: `{ eventId, eventType: "task.reattached", taskId, newParentId, previousParentId, projectId, reattachmentTimestamp, reason, actorId }`. | Mirrors the detachment event for symmetry; enables reattachment tracking. |
| FR-2.3 | The event bus MUST deliver each event at least once. Deduplication is the subscriber's responsibility. | At-least-once is the standard reliability guarantee for domain events. |
| FR-2.4 | Events MUST be published AFTER the database transaction commits (transactional outbox pattern). | Prevents emitting events for rolled-back operations. |
| FR-2.5 | `reason` MUST be one of the enumerated set: `parent_deleted`, `parent_moved`, `explicit_unlink`, `cascade_delete`. | Constrained vocabulary enables reliable filtering and reporting. |

#### FR-3: Audit Trail

| # | Requirement | Rationale |
|---|-------------|-----------|
| FR-3.1 | An `task_detachment_audit` table MUST be created with columns: `id` (UUID, PK), `taskId` (UUID, FK→tasks), `previousParentId` (UUID, nullable FK→tasks), `projectId` (UUID, FK→projects), `reason` (enum), `actorId` (UUID, FK→users), `detachmentTimestamp` (timestamptz), `reattachmentStatus` (enum: `detached`, `reattached`, `recovered`), `reattachedTo` (UUID, nullable FK→tasks), `reattachmentTimestamp` (timestamptz, nullable), `createdAt` (timestamptz, default now()). | Complete audit record capturing the full lifecycle. |
| FR-3.2 | Rows MUST be INSERT-only with respect to detachment data. Only `reattachmentStatus`, `reattachedTo`, and `reattachmentTimestamp` may be updated once (on reattachment). | Immutability is the defining property of an audit log. |
| FR-3.3 | The table MUST support queries filtered by: `taskId`, `projectId`, `reason`, `reattachmentStatus`, and a `detachmentTimestamp` range. | Enables the dashboard and audit-query APIs. |
| FR-3.4 | An index MUST exist on `(projectId, reattachmentStatus, detachmentTimestamp DESC)` for dashboard queries. | The dashboard's default query ("show me all currently detached tasks, newest first") must be fast. |
| FR-3.5 | The audit log MUST NOT be truncatable or deletable by any application-level operation. Only a DB-level migration or admin tool may remove rows, and only with an explicit justification logged. | Compliance requirement from US-4. |

#### FR-4: Dashboard

| # | Requirement | Rationale |
|---|-------------|-----------|
| FR-4.1 | A "Detached Tasks" view MUST be accessible from the project dashboard, reachable via a navigation tab or sidebar link. | Discoverability — PMs should not have to hunt for it. |
| FR-4.2 | The view MUST display a table with columns: Task Key + Title (linked to task detail), Previous Parent (name + link), Detachment Timestamp, Reason, Status Badge (detached / reattached / recovered). | Covers all fields a PM needs to triage. |
| FR-4.3 | The table MUST support sorting by: detachment timestamp (default: newest first), task title, previous parent name. | Standard data-table interaction. |
| FR-4.4 | The table MUST support filtering by: reason (dropdown), status (detached / all), date range (from–to pickers). | Enables focused triage workflows. |
| FR-4.5 | Each row MUST have a row-level action menu with "Reattach…" and "Recover to Root" options. | Per-task actions for quick resolution. |
| FR-4.6 | A "Select All" / multi-select checkbox column MUST be present, with a toolbar that appears when ≥1 row is selected offering "Bulk Reattach…" and "Bulk Recover". | Satisfies US-6. |
| FR-4.7 | A badge/count indicator MUST appear in the main project navigation (e.g., next to a "Tasks" or "Detached" nav item) showing the number of currently detached tasks. The badge MUST update within 5 seconds of a new detachment. | Real-time visibility per the acceptance criteria. |

#### FR-5: Reattachment & Recovery

| # | Requirement | Rationale |
|---|-------------|-----------|
| FR-5.1 | The "Reattach" dialog MUST present a searchable tree/select of valid parent candidates. A candidate is valid if: it belongs to the same project; it is not the detached task itself; it is not a descendant of the detached task (no cycles). | Prevents hierarchy corruption. |
| FR-5.2 | The search MUST support fuzzy text matching on task key + title, with results ranked by relevance. | Usability for large projects. |
| FR-5.3 | The "Recover to Root" action MUST set `parentTaskId` to the project's configured root task. If no root task is configured for the project, the action MUST be disabled with a tooltip explanation. | Graceful degradation. |
| FR-5.4 | Both actions MUST be idempotent: reattaching an already-reattached task to the same parent is a no-op (200 OK, no duplicate events). | Safe retry behaviour. |
| FR-5.5 | Attempting to reattach to an invalid parent (self, descendant, task in another project) MUST return HTTP 400 with a structured error: `{ error: "invalid_parent", detail: "..." }`. | Clear, machine-readable errors. |
| FR-5.6 | On successful reattachment or recovery, the audit row's `reattachmentStatus` MUST be updated, and a `TaskReattached` event MUST be emitted. | Completes the audit lifecycle. |

### Non-Functional Requirements

| # | Requirement | Target |
|---|-------------|--------|
| NFR-1 | Detached tasks list API response time | ≤ 200ms p95 under 5,000 tasks |
| NFR-2 | Reattachment operation latency (end-to-end: API → DB → event → response) | ≤ 500ms p95 |
| NFR-3 | Dashboard initial render time | ≤ 2s on standard broadband |
| NFR-4 | Badge count freshness | ≤ 5 seconds after detachment event |
| NFR-5 | Concurrent detachment handling | Correct under up to 50 concurrent parent deletions |
| NFR-6 | Audit log retention | Indefinite (never pruned by application) |
| NFR-7 | API auth enforcement | Every endpoint returns 403 for unauthenticated / insufficient-scope requests |

### Data Model

```
task_detachment_audit
├── id: UUID (PK, default gen_random_uuid())
├── taskId: UUID (NOT NULL, FK → tasks.id)
├── previousParentId: UUID (NULLABLE, FK → tasks.id)
├── projectId: UUID (NOT NULL, FK → projects.id)
├── reason: VARCHAR(50) (NOT NULL, CHECK IN ('parent_deleted','parent_moved','explicit_unlink','cascade_delete'))
├── actorId: UUID (NOT NULL, FK → users.id)
├── detachmentTimestamp: TIMESTAMPTZ (NOT NULL, DEFAULT NOW())
├── reattachmentStatus: VARCHAR(20) (NOT NULL, DEFAULT 'detached', CHECK IN ('detached','reattached','recovered'))
├── reattachedTo: UUID (NULLABLE, FK → tasks.id)
├── reattachmentTimestamp: TIMESTAMPTZ (NULLABLE)
└── createdAt: TIMESTAMPTZ (NOT NULL, DEFAULT NOW())

INDEXES:
  - idx_detachment_audit_project_status_time ON (projectId, reattachmentStatus, detachmentTimestamp DESC)
  - idx_detachment_audit_task ON (taskId)
  - idx_detachment_audit_reason ON (reason)
  - idx_detachment_audit_timestamp_range ON (detachmentTimestamp)
```

### Business Rules

| # | Rule | Enforcement |
|---|------|-------------|
| BR-1 | A task is "detached" iff its current `parentTaskId IS NULL` AND an audit row exists with `reattachmentStatus = 'detached'`. A task created with `parentTaskId = NULL` and no audit row is a root task, not a detached task. | Query filter: `WHERE parentTaskId IS NULL AND EXISTS (SELECT 1 FROM task_detachment_audit WHERE taskId = t.id AND reattachmentStatus = 'detached')` |
| BR-2 | A reattached task that is later detached again receives a NEW audit row; the prior row retains its `reattachmentStatus` of `reattached`/`recovered`. | INSERT new row, never overwrite the old one. |
| BR-3 | The valid-parent constraint (no self, no descendant) is enforced at the API layer with a pre-flight check query, not solely by the DB foreign key. | API returns 400 before attempting the write. |
| BR-4 | Project root task ID is a project-level setting (configuration). If unset, "Recover to Root" is unavailable. | Feature flag / config key checked at runtime. |
| BR-5 | Detachment detection fires only for tasks that EXIST at the moment the parent is removed. Soft-deleted tasks are excluded. | WHERE clause excludes soft-deleted tasks. |

### API Contract

#### `GET /api/tasks/detached`

Query params:
- `projectId` (required) — UUID of the project
- `reason` (optional) — filter by detachment reason
- `status` (optional, default `detached`) — `detached` | `reattached` | `all`
- `from` / `to` (optional) — ISO-8601 timestamp range
- `sortBy` (optional, default `detachmentTimestamp`) — `detachmentTimestamp` | `title` | `previousParentName`
- `sortDir` (optional, default `desc`) — `asc` | `desc`
- `page` (optional, default 1) — 1-based page number
- `pageSize` (optional, default 25, max 100)

Response 200:
```json
{
  "items": [
    {
      "taskId": "uuid",
      "taskKey": "PROJ-123",
      "taskTitle": "Fix login bug",
      "previousParentId": "uuid",
      "previousParentKey": "PROJ-100",
      "previousParentTitle": "Auth Epic",
      "detachmentTimestamp": "2026-08-03T10:00:00Z",
      "reason": "parent_deleted",
      "reattachmentStatus": "detached"
    }
  ],
  "total": 47,
  "page": 1,
  "pageSize": 25
}
```

#### `GET /api/tasks/{taskId}/detachment-audit`

Response 200:
```json
{
  "taskId": "uuid",
  "history": [
    {
      "id": "uuid",
      "previousParentId": "uuid",
      "reason": "parent_deleted",
      "actorId": "uuid",
      "detachmentTimestamp": "2026-08-03T10:00:00Z",
      "reattachmentStatus": "reattached",
      "reattachedTo": "uuid",
      "reattachmentTimestamp": "2026-08-03T11:00:00Z"
    }
  ]
}
```

#### `POST /api/tasks/{taskId}/reattach`

Body:
```json
{ "parentTaskId": "uuid" }
```

Response 200:
```json
{
  "taskId": "uuid",
  "newParentId": "uuid",
  "reattachmentTimestamp": "2026-08-03T12:00:00Z",
  "auditId": "uuid"
}
```

Errors: 400 (invalid parent — self/descendant/wrong-project/not-found), 403 (unauthorized), 404 (task not found), 409 (task not currently detached).

#### `POST /api/tasks/{taskId}/recover`

Body: none (empty).

Response 200:
```json
{
  "taskId": "uuid",
  "newParentId": "uuid",
  "reattachmentTimestamp": "2026-08-03T12:00:00Z",
  "auditId": "uuid",
  "recovered": true
}
```

Errors: 400 (no project root configured), 403, 404, 409 (task not currently detached).

### Dependencies & Assumptions

| # | Dependency | Impact if unmet |
|---|------------|-----------------|
| D-1 | The platform MUST have a domain-event bus (pub/sub) that supports at-least-once delivery. | Without it, `TaskDetached` and `TaskReattached` events cannot be published; notification subscribers break. |
| D-2 | The platform MUST have a `tasks` table with `parentTaskId` (nullable UUID FK→tasks.id) and a `projects` table with a root-task configuration key. | The data model this feature operates on. |
| D-3 | The platform MUST have an existing REST API layer (the `api/` tree with Hono/Cloudflare Workers per the project conventions) into which these endpoints are added. | New endpoints need a routing/middleware framework to attach to. |
| D-4 | The frontend MUST have an existing project dashboard with a tabbed or sidebar navigation pattern. | The "Detached Tasks" view plugs into an existing navigation structure. |
| D-5 | The platform MUST have an auth middleware that populates request context with `actorId` and enforces scope-based authorization. | Every endpoint returns 403 for unauthorized callers. |

| # | Assumption | Rationale |
|---|------------|-----------|
| A-1 | Detachments are rare events (≤ 100/day/project under normal operation). | Drives the performance budget — dashboard queries are infrequent and lightweight. |
| A-2 | The notification service (email/Slack) is a SEPARATE feature and will subscribe to `TaskDetached` events when ready. | This PRD does not cover notification; the event schema is designed to be forward-compatible. |
| A-3 | A "project root task" is a single designated task per project, stored as a project-level configuration value (e.g., `projects.rootTaskId`). | Simplest model; avoids multi-root complexity. |
| A-4 | The frontend uses React with a component library (consistent with the existing `Builderforce.ai/frontend/` tree). | Implementation will follow existing patterns. |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._
