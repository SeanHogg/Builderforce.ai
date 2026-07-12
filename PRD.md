> **PRD** — drafted by Ada (Sr. Product Mgr) · task #516
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Low-Priority Task Status Management

## Overview
FR6: Enhance visibility and management of low-priority tasks through dedicated status controls in the task list/detail views.

---

## Problem & Goal
**Problem:**
Current task management lacks explicit visibility for low-priority tasks (`on_hold`, `deferred`). Users manually triage these tasks, leading to inefficiency and misalignment.

**Goal:**
- Provide explicit, intuitive controls for setting/modifying low-priority task statuses.
- Ensure status transitions are auditable, reversible, and surfaced contextually.

---

## Target Users / ICP Roles
| Role               | Use Case Example                                      |
|--------------------|-------------------------------------------------------|
| Project Managers   | Adjust backlog priority while sprint planning.        |
| Team Leads         | Defer non-blocking tasks during high-priority spikes. |
| Individual Devs    | Flag tasks as `on_hold` pending external dependencies.|
| Product Owners     | Pause feature development awaiting requirements.      |

---

## Scope
### In Scope
1. **Backend API**
   - New `PriorityStatusService` methods (`setStatusOnHold`, `setStatusDeferred`, `getTaskStatus`).
   - `LowPriorityStatus` enum (`on_hold` | `deferred` | existing values).

2. **UI Controls**
   - Popover/quick-action menu in:
     - Task list rows (`TaskPriorityListItem`).
     - Task detail view.
   - Visual affordances to reflect current status and available transitions.

---

## Functional Requirements
### Backend
| Requirement                                      | Details                                                                 |
|--------------------------------------------------|-------------------------------------------------------------------------|
| **API Endpoints**                                | `POST /tasks/{taskId}/status/on-hold` (optional `note`)                 |
|                                                  | `POST /tasks/{taskId}/status/deferred` (optional `note`)                |
|                                                  | `GET /tasks/{taskId}/status` (returns `{ status, flags }`)             |
| **Status Enum**                                  | `LowPriorityStatus`: `"on_hold"` \| `"deferred"` \| existing values).   |
| **Auditability**                                 | Capture user, timestamp, and optional `note` for each status change.   |
| **Flags**                                        | `isLowPriority`: `true` if status is `on_hold` or `deferred`.           |

### Frontend
| Requirement                                      | Details                                                                 |
|--------------------------------------------------|-------------------------------------------------------------------------|
| **Trigger Points**                               | (a) Task list `TaskPriorityListItem` right-click/ellipsis menu.         |
|                                                  | (b) Task detail view top-right action button.                           |
| **UI Controls**                                  | Popover with `Apply Priority` actions:                                 |
|                                                  | - Move to `On Hold` (trigger `setStatusOnHold`).                        |
|                                                  | - Move to `Deferred` (trigger `setStatusDeferred`).                     |
|                                                  | **Visibility Rules:** Only show actions valid for current state.        |
| **Feedback**                                     | Post-action toast confirmation (`Task marked as On Hold`).             |
| **Visual Indicators**                            | Badge / muted styling for `on_hold`/`deferred` tasks in list/detail.    |

---

## Acceptance Criteria
### Must-Have ✅
- [ ] All `PriorityStatusService` APIs implemented, unit-tested, documented.
- [ ] Status transitions logged in task history (user + timestamp).
- [ ] UI popover appears on trigger points; actions disable for invalid states.
- [ ] `LowPriorityStatus` enum enforced at API/DB layers; frontend dropdowns auto-filter invalid options.
- [ ] Inbound task status respected (e.g., `getTaskStatus` drives UI state).

### Should-Have 🔶
- [ ] Optional `note` rendered in task history.
- [ ] Drag-and-drop support for status changes in Kanban view.
- [ ] Bulk actions for status batch-updates.

---

## Out of Scope
- **Workflow Automation:** Triggers/automations for status changes.
- **Overlapping Priorities:** Conflict resolution for status + explicit priority fields.
- **Hierarchical Statuses:** Sub-statuses under `on_hold`/`deferred` (e.g., `waiting_for_pr`).