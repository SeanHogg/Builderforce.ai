> **PRD** — drafted by Ada (Sr. Product Mgr) · task #898
> _Each agent that updates this PRD signs its change below._

# Implement 'Ready for Refinement' Status and Filter

## Problem & Goal
**Problem:** Per existing specification (FR‑5/AC‑6), the system must support a “Ready for Refinement” status and a corresponding filter. Currently, no such status value exists, and users cannot filter items by readiness for refinement. This gap blocks efficient backlog grooming and refinement planning.

**Goal:** Introduce a dedicated “Ready for Refinement” status in the work item status model and deliver a one‑click filter on the backlog/board view, so teams can quickly surface and manage items awaiting refinement.

## Target Users / ICP Roles
- **Product Owners / Managers:** identify and prioritise items ready for refinement.
- **Scrum Masters / Agile Coaches:** facilitate refinement meetings with a pre‑filtered list.
- **Developers:** understand which items are finalised enough for refinement discussion.
- **Anyone participating in backlog grooming workflows.**

## Scope
- Add a new status value **“Ready for Refinement”** to the list of system statuses for applicable work item types.
- Make the status manually settable by users with edit permissions on work items.
- Surface a **quick filter** labelled “Ready for Refinement” on the backlog/board filter bar.
- Ensure the filter can be combined with other filters, saved in views, and used via the public API.

## Functional Requirements

1. **Status Value**
   - The system shall support a status with internal name `ready_for_refinement`, display name “Ready for Refinement”, and a distinct colour (default purple `#8A2BE2`).
   - The status shall be available in the status dropdown for editing work items (user stories, tasks, bugs, etc.).
   - Administrators may configure the status order and colour via workflow settings.

2. **Filter**
   - A “Ready for Refinement” quick‑filter button shall appear on the backlog/board view’s filter bar.
   - Activating the filter shall display **only** work items whose current status is “Ready for Refinement”.
   - The filter must support logical AND/OR with other active filters (e.g., Assignee, Label).
   - The filter shall be available in saved searches, custom views, and persistent across sessions.
   - Real‑time feedback: changing an item’s status away from “Ready for Refinement” immediately removes it from the filtered list.

3. **API & Integrations**
   - The status value `ready_for_refinement` shall be returned in the status field of work item API responses.
   - Querying items via `/items?status=ready_for_refinement` (or equivalent parameter) shall return only items with that status.
   - No breaking changes to existing API contracts; the new value is additive.

4. **Reporting & Dashboards**
   - “Ready for Refinement” shall appear as a distinct segment in status distribution charts and exported reports.

## Acceptance Criteria
- **AC1:** A user can set any writeable work item’s status to “Ready for Refinement” via the detail view or bulk edit.
- **AC2:** The “Ready for Refinement” quick filter is visible on the default backlog/board view and, when selected, shows only items with that status.
- **AC3:** Combining the filter with another active filter (e.g., Assignee = “Jane”) displays the intersection of matching items.
- **AC4:** The filter can be saved as part of a custom view; the view persists after browser refresh and log‑in.
- **AC5:** The REST API returns `"status": "ready_for_refinement"` for affected items and filtering via query parameter works correctly.
- **AC6:** No existing statuses, filters, or workflows are degraded or unintentionally altered.
- **AC7:** The status name and colour are clearly distinguishable from other statuses during user acceptance testing.

## Out of Scope
- Automatic transition rules or workflow constraints (e.g., enforcing that only items in “Draft” may move to “Ready for Refinement”).
- Automatic notifications or reminders when an item enters “Ready for Refinement”.
- A dedicated “Ready for Refinement” column on the kanban board (only backlog/board filter).
- Retroactive assignment of the status to historical items.
- Bulk update or automation of status via rules engine in this delivery.

## Requirements

_Owned by the business-analyst — authored by BA (task #898)._

### R1 — Status Value (no schema migration required)

- **R1.1** The `tasks.status` column is already `varchar(64)` (migration 0076 converted it from the old `task_status` enum to free-form text), so the new value `ready_for_refinement` requires **no DDL migration**. Write paths that accept a status string (PATCH `/api/tasks/:id`, bulk edit endpoint, task-creation endpoint) already validate against the active swimlane labels for the project's board, so the system must recognise `ready_for_refinement` as a valid status without requiring a matching swimlane (FR explicitly scopes out a dedicated kanban column).
- **R1.2** The board/backlog status dropdown on the task detail view and the bulk-edit modal must include `"Ready for Refinement"` (display label) / `ready_for_refinement` (internal value) in the pick-list, with colour `#8A2BE2` (purple). The dropdown is populated from the project's swimlane set (table `swimlanes`); the BA notes that FR scopes this as a filter-only status, NOT a board column, so the pick-list must be augmented with system statuses that lack a swimlane. This is the key architectural decision the architect must resolve: either add a `ready_for_refinement` swimlane hidden from the board but visible in the status picker, or maintain a separate system-status registry that the picker consults.
- **R1.3** The status change must emit a row to `task_status_transitions` (migration 0117) — same as any other lane move — with `from_status` = prior status, `to_status` = `'ready_for_refinement'`, `actor_kind` = the actor performing the change, and `is_backward` computed against the project's swimlane ordinal positions (null when no matching swimlane exists for the new status).

### R2 — Quick Filter on Backlog / Board View

- **R2.1** The frontend filter bar must render a **"Ready for Refinement" quick-filter chip/button**, visually distinct (purple accent, per the status colour). This lives alongside existing quick filters (e.g. "My Items", "Unassigned", per-label chips).
- **R2.2** Activating the chip appends `status=ready_for_refinement` to the active query/filter state. The board query (presumably `GET /api/projects/:id/tasks` or the kanban list endpoint) already supports a `status` query parameter; the filter simply passes it through.
- **R2.3** The filter must compose with other active filters via logical AND. The API query layer (whichever service/handler resolves task lists) must accept `status` alongside existing filter params (`assignee`, `label`, `priority`, `type`, etc.) and return the intersection. The BA's read of the existing list-task handler (to be confirmed by the developer) suggests `status` filtering already works for any arbitrary string value post-0076; the main work is wiring the frontend chip.
- **R2.4** The filter state must be persistable: included in saved views (`saved_views` / custom-view persistence — to be confirmed by the developer), carried in the URL query string so a bookmark/share restores it, and restored on browser refresh / re-login when the user's last active view is loaded.
- **R2.5** Real-time removal: when a user changes a task's status from `ready_for_refinement` to any other value while the filter is active, the task must disappear from the filtered list immediately. This is standard reactive-list behaviour if the frontend maintains a live subscription (WebSocket / SSE / polling refetch); the BA defers the exact mechanism to the architect.

### R3 — API and Integrations (additive, no breaking changes)

- **R3.1** `GET /api/tasks/:id` responses already include `"status"` as a `varchar(64)` field. No change is needed for the response shape — it will naturally return `"status": "ready_for_refinement"` when a task holds that value.
- **R3.2** `GET /api/tasks?status=ready_for_refinement` (or the project-scoped equivalent, e.g. `GET /api/projects/:id/tasks?status=ready_for_refinement`) must filter to only tasks with that status. The BA's assessment is that this already works because status is free-form text; the developer must verify and add a test.
- **R3.3** The public Developer API (tenant API keys, `/developer/v1/...`) must also support the new status value in both read responses and the `status` query filter, with no contract version bump (additive).
- **R3.4** The status value must pass through webhook payloads (`task.updated` events) unchanged.

### R4 — Reporting and Dashboards

- **R4.1** Status-distribution queries (used by the project dashboard's status breakdown chart and any exported CSV/PDF reports) typically `GROUP BY tasks.status`. Since `ready_for_refinement` is a new distinct value, it will appear as its own segment automatically. The developer must confirm that the reporting queries do not hardcode a closed set of status labels, and if they do, add `ready_for_refinement` to the set.
- **R4.2** The status colour `#8A2BE2` must be carried through to chart legends and report styling. The colour mapping (status → hex) should be defined in a single shared constant or config table, not duplicated across chart components.

### R5 — Constraints and Non-Functional Requirements

- **R5.1** The status value `ready_for_refinement` must sort sensibly in board/backlog views. The BA recommends it sort immediately after `backlog` (the typical refinement entry point) and before `todo` / `in_progress` — i.e., it is a pre-execution, post-triage status.
- **R5.2** The filter chip must render correctly on mobile viewports (the board is responsive). It may collapse into a "More filters" dropdown on narrow screens.
- **R5.3** No permission model changes: any user who can edit a task's status (existing `task:write` or project-member edit scope) can set `ready_for_refinement`.
- **R5.4** The feature must degrade gracefully for projects that predate this change: existing tasks retain their current status; no backfill is performed (out of scope per PRD). The filter simply returns an empty set for boards with no `ready_for_refinement` tasks.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._