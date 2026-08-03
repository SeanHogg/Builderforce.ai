> **PRD** — drafted by Ada (Sr. Product Mgr) · task #896
> _Each agent that updates this PRD signs its change below._

# PRD: Effort Estimation Visibility (FR-4)

**Status:** Draft  
**Author:** Product Architect  
**Version:** 1.0  

---

## 1. Problem & Goal

**Problem**  
Users cannot view or set effort estimates (e.g., Story Points, T-shirt sizes) on work items. The feature required by FR‑4 (“prominent effort estimation display”) is entirely absent—no dedicated field, no UI exposure. This gap prevents teams from sizing work during backlog refinement and sprint planning, impeding forecast accuracy and capacity management.

**Goal**  
Provide a first‑class effort estimation field that is visible, editable, and prominently displayed across all relevant views (backlog, board, item detail). Enable teams to assign commonly used sizing scales and quickly assess work item magnitude at a glance.

---

## 2. Target Users / ICP Roles

- **Product Owners / Product Managers** – assess relative effort when prioritizing the backlog.
- **Scrum Masters / Agile Coaches** – facilitate planning and ensure sizing is applied consistently.
- **Engineers / Delivery Team Members** – input and update effort estimates during refinement and planning.

---

## 3. Scope

- Introduce a configurable effort field on work items (Story, Task, Bug, etc.).
- Support at least two standard sizing scales: **Story Points** (modified Fibonacci sequence) and **T‑shirt sizes** (XS, S, M, L, XL).
- Display the effort estimate prominently on:
  - Backlog list/card view
  - Board card (Kanban/Scrum)
  - Work item detail panel
- Allow editing the effort value inline (backlog/board) and in the detail form.
- Persist changes immediately with appropriate audit trail.
- (Optional) Provide basic sorting and filtering by effort estimate in backlog/board views.

---

## 4. Functional Requirements

| ID | Requirement | Description |
|----|------------|-------------|
| FR‑4.1 | Effort Field Definition | Each work item type (Story, Task, etc.) shall include an “Effort” field. The field can be configured by the workspace admin to use Story Points or T‑shirt sizes. |
| FR‑4.2 | Display on Backlog/Board Card | The effort estimate value must appear on the card visualization in both the backlog list and board views (e.g., top‑right corner or alongside key identifiers). |
| FR‑4.3 | Display on Detail View | The effort field shall be shown in a dedicated, easy‑to‑locate area on the work item detail panel (e.g., “Effort: 5 Story Points”). |
| FR‑4.4 | Inline Editing | Clicking the effort indicator on a card or in the detail panel shall enable quick editing (dropdown or direct input). Must support keyboard navigation and accessibility. |
| FR‑4.5 | Value Validation | For Story Points, accept only predefined Fibonacci numbers: 1, 2, 3, 5, 8, 13, 20, 40, 100; for T‑shirts, accept XS, S, M, L, XL, XXL. Provide a null/unestimated state. |
| FR‑4.6 | Instant Persistence | Changes are saved automatically (no separate save action) with optimistic UI feedback. In case of conflict, show latest server state. |
| FR‑4.7 | Sorting & Filtering (MVP) | Backlog and board views shall allow sorting by effort estimate in ascending/descending order and filtering by specific values or ranges. |
| FR‑4.8 | Bulk Edit | Users must be able to select multiple work items and set a common effort estimate via bulk edit modal. |
| FR‑4.9 | Audit & History | Effort changes shall be recorded in the work item’s activity log with timestamp and author. |
| FR‑4.10 | Responsiveness & Empty State | The effort display must not break layout on cards; empty state should show a subtle placeholder (e.g., “—” or greyed‑out hint) inviting input. |

---

## 5. Acceptance Criteria

1. **Field Existence**  
   - Every Story, Task, and Bug detail view shows an “Effort” field.  
   - The field is absent on work item types that the admin explicitly excludes (if configurable).

2. **Backlog/Board Visibility**  
   - In the backlog list: effort value is visible next to the work item title/key.  
   - On the board: effort value appears in the card without truncation for supported sizes.  
   - Verification: a Story with “5” Story Points shows “5 SP” on the card.

3. **Editing**  
   - Clicking the effort indicator on a card opens an in‑place dropdown for Story Points or T‑shirt sizes.  
   - Selecting a value immediately updates the card and the server.  
   - The detail panel allows editing via the same dropdown, and changes reflect across all views without page reload.

4. **Validation**  
   - Only allowed Fibonacci numbers are accepted for Story Points; attempting to type “7” shows an error message and prevents saving.  
   - T‑shirt size dropdown contains XS–XXL only.  
   - Clearing the field resets it to “unestimated” state.

5. **Persistence & Conflict**  
   - After editing, refreshing the page retains the new value.  
   - Two users editing concurrently: second save sees a conflict banner and the actual server value.

6. **Sort/Filter (if included in MVP)**  
   - Sorting backlog by effort ascending orders items with no estimate last.  
   - Filtering by “5 SP” shows only items with exactly 5 Story Points.

7. **Audit**  
   - Activity log shows entry “Effort changed from Nothing to 3” with timestamp and user.

8. **Responsiveness**  
   - On a board with many columns, effort text does not break card layout; it wraps or truncates sensibly.

9. **Accessibility**  
   - Inline edit is operable via keyboard (Tab, Enter, arrow keys); screen readers announce current value and changing state.

---

## 6. Out of Scope

- Advanced sizing scales (ideal days, custom numeric ranges) – handled in future configuration enhancements.
- Velocity calculation or sprint capacity reports – part of sprint metrics module.
- Effort estimation based on AI or historical data.
- Roll‑up or aggregation of child/parent work item efforts (epic‑level effort summary).
- Custom field styling or placement per team beyond the default prominent location.
- Integration with external planning tools (e.g., Jira sync) for effort field mapping.

## Requirements

_Owned by the business-analyst — authored by Business Analyst (task #896)._

> **Traceability:** Each requirement maps to a functional requirement (FR‑4.x) in §4. Acceptance criteria in §5 are the verification gates.

---

### REQ‑1: Effort Data Model & Configuration

| Attribute | Detail |
|-----------|--------|
| Maps to | FR‑4.1, FR‑4.5 |
| Priority | P0 (blocking) |

**1.1 Field Definition**

- Every work item type (Story, Task, Bug, Epic, Gap) SHALL carry an `effort` field stored as a nullable JSONB column with the shape `{ scale: 'story-points' | 't-shirt', value: number | string }`.
- A `null` effort means "unestimated" — distinct from `0` or `""`.
- The workspace-level `effortScale` configuration enum SHALL default to `'story-points'` and accept `'story-points'` | `'t-shirt'`. The active scale determines which values are offered in all editing affordances.
- A future admin toggle MAY restrict effort to specific work item types; in MVP all types carry the field and only Epic MAY omit display (out of scope for roll-up).

**1.2 Valid Values**

| Scale | Allowed Values | Display Format |
|-------|---------------|----------------|
| `story-points` | 1, 2, 3, 5, 8, 13, 20, 40, 100 | `"{value} SP"` (e.g. "5 SP") |
| `t-shirt` | XS, S, M, L, XL, XXL | `"{value}"` (e.g. "M") |

- The canonical order for sort operations SHALL be the list order above (ascending).
- Any value outside these sets SHALL be rejected server-side with a `422 Unprocessable Entity` and a descriptive error message; the client SHALL surface that message to the user.

**1.3 T‑shirt → Numeric Ordinal Mapping (for sorting only)**

| T‑shirt | Ordinal |
|---------|---------|
| XS | 0 |
| S | 1 |
| M | 2 |
| L | 3 |
| XL | 4 |
| XXL | 5 |

This mapping is NEVER exposed as a numeric value — it exists solely so `ORDER BY effort` produces a sensible sequence.

---

### REQ‑2: Display on Backlog / Board Card

| Attribute | Detail |
|-----------|--------|
| Maps to | FR‑4.2, FR‑4.10 |
| Priority | P0 |

**2.1 Card Placement**

- The effort badge SHALL render on every board card and backlog row in the top-right region, right-justified, on the same row as the task key / status badge area.
- The badge SHALL be a compact pill / tag with a distinct but understated visual treatment (subtle background tint, rounded border).

**2.2 States**

| State | Rendering |
|-------|-----------|
| Estimated (story-points) | `"5 SP"` — pill with accent color |
| Estimated (t-shirt) | `"M"` — pill with accent color |
| Unestimated | A muted, low-contrast `"—"` or `"Estimate"` placeholder, greyed out, that invites click |
| Restricted / clearance-needed task | Effort badge is hidden (same as other metadata) |

**2.3 Responsiveness**

- The pill SHALL NOT exceed 48 px in width; text truncates with `text-overflow: ellipsis` if needed, though all valid values fit comfortably.
- On narrow viewports (< 400 px card width) the badge MAY wrap to a second line but MUST NOT overflow the card boundary.

---

### REQ‑3: Display on Detail View

| Attribute | Detail |
|-----------|--------|
| Maps to | FR‑4.3 |
| Priority | P0 |

**3.1 Detail Panel Placement**

- The task detail drawer / panel SHALL include an "Effort" row in its metadata section (alongside Priority, Status, Assignee, Due Date).
- Label: **"Effort"** with the current value displayed inline. If unestimated, display `"—"` or `"Not estimated"`.
- This row SHALL be one of the inline-editable fields in the drawer (see REQ‑4), matching the pattern already used for Priority, Status, and Assignee.

---

### REQ‑4: Inline Editing

| Attribute | Detail |
|-----------|--------|
| Maps to | FR‑4.4, FR‑4.6 |
| Priority | P0 |

**4.1 Card Inline Edit**

- Clicking the effort badge on a board card or backlog row SHALL open a small dropdown anchored to the badge.
- The dropdown SHALL list the allowed values for the workspace's configured scale, plus a clear/reset option labelled "Clear" or "None".
- Selecting a value SHALL immediately fire a PATCH to the server. The card SHALL optimistically update before the server responds.
- On server error (network, conflict, validation), the card SHALL revert to the previous value and surface the error in a toast or inline message.

**4.2 Detail Panel Edit**

- In the task detail drawer, the Effort row SHALL be click-to-edit, following the existing inline-editing pattern (the drawer's `editingField` / `fieldDraft` mechanism).
- Clicking the row opens a dropdown identical to REQ‑4.1. Selecting a value commits the change instantly (same PATCH + optimistic flow).

**4.3 Keyboard & Accessibility**

- The effort badge SHALL be focusable (`tabindex="0"`) and respond to Enter / Space to open the dropdown.
- Arrow keys SHALL navigate the dropdown options; Escape SHALL close without change.
- The badge SHALL carry `aria-label` describing the current state: e.g. `"Effort: 5 Story Points. Press Enter to edit."` or `"Effort: not estimated. Press Enter to set an estimate."`.
- The dropdown options SHALL use `<button>` elements inside a `role="listbox"` with `aria-selected` reflecting the current value.

---

### REQ‑5: Bulk Edit

| Attribute | Detail |
|-----------|--------|
| Maps to | FR‑4.8 |
| Priority | P1 |

**5.1 Bulk Action**

- When one or more tasks are selected (checkbox multi-select on the board/backlog), a bulk-edit toolbar SHALL appear.
- The toolbar SHALL include an "Effort" dropdown matching the pattern of the existing bulk-status dropdown.
- Selecting an effort value SHALL apply it to ALL selected tasks via individual PATCH requests (no dedicated bulk endpoint in MVP).
- A progress indicator (e.g. "Setting effort on 3 of 7…") SHALL be shown during the operation.
- The "Clear" / "None" option SHALL reset effort to unestimated on every selected task.

---

### REQ‑6: Sorting & Filtering

| Attribute | Detail |
|-----------|--------|
| Maps to | FR‑4.7 |
| Priority | P1 |

**6.1 Backlog / Table Sort**

- The backlog / table view SHALL include a sortable "Effort" column header. Clicking the header toggles: unsorted → ascending → descending → unsorted.
- Ascending order: unestimated items sort LAST. Story Points sort by numeric value; T‑shirts sort by ordinal (XS→XXL).
- Descending order: unestimated items sort LAST. Story Points sort descending; T‑shirts sort descending (XXL→XS).

**6.2 Board Filter**

- A dropdown filter in the board toolbar SHALL allow filtering by specific effort values (e.g. "5 SP", "M").
- The filter values SHALL be drawn dynamically from the effort values present in the currently loaded task set (not hardcoded), so only relevant options appear.
- "All" (default) shows every task regardless of effort.
- "Unestimated" SHALL be a filter option that shows only tasks with `null` effort.

**6.3 Server‑Side Support (Future)**

- MVP sorting/filtering MAY be client-side on the loaded task set. A future iteration (post‑MVP) SHALL push sort/filter to server-side query parameters (`?sortBy=effort&sortDir=asc&effort=5`) for large datasets.

---

### REQ‑7: Persistence & Conflict Handling

| Attribute | Detail |
|-----------|--------|
| Maps to | FR‑4.6 |
| Priority | P0 |

**7.1 Optimistic Update**

- On effort change, the client SHALL optimistically update the local task state IMMEDIATELY and fire a `PATCH /api/tasks/:id` with `{ effort: { scale, value } }` (or `{ effort: null }` to clear).
- If the server responds `200`, no further action.
- If the server responds `409 Conflict` (concurrent edit), the client SHALL revert to the server's value and display a brief banner: "This item was updated by someone else. The latest estimate is shown."
- If the server responds `422`, the client SHALL revert and display the validation error.

**7.2 API Contract**

```
PATCH /api/tasks/:id
Content-Type: application/json

{
  "effort": { "scale": "story-points", "value": 5 }
  // or
  "effort": { "scale": "t-shirt", "value": "M" }
  // or
  "effort": null   // clear
}
```

Response `200`:
```json
{
  "task": {
    "id": 42,
    "effort": { "scale": "story-points", "value": 5 },
    ...
  }
}
```

The `Task` type in the frontend (`builderforceApi.ts`) SHALL include:
```ts
effort?: { scale: 'story-points' | 't-shirt'; value: number | string } | null;
```

---

### REQ‑8: Audit & Activity Log

| Attribute | Detail |
|-----------|--------|
| Maps to | FR‑4.9 |
| Priority | P0 |

**8.1 Activity Entry Format**

- Every effort change SHALL create an activity log entry with:
  - **Actor:** the user/agent who made the change.
  - **Timestamp:** server time at commit.
  - **Field:** `"effort"`.
  - **From:** previous value in display format (e.g. `"Nothing"`, `"3 SP"`, `"M"`).
  - **To:** new value in display format.
  - **Rendered message:** `"Effort changed from Nothing to 5 SP"` or `"Effort changed from L to M"` or `"Effort cleared"`.

**8.2 Display**

- The entry SHALL appear in the task's Activity / Changes tab (existing `TaskChangesPanel`) alongside title, status, priority, assignee changes.
- The activity feed SHALL be sorted newest-first.

---

### REQ‑9: Workspace Configuration

| Attribute | Detail |
|-----------|--------|
| Maps to | FR‑4.1 |
| Priority | P1 |

**9.1 Effort Scale Setting**

- The workspace admin SHALL be able to switch the effort scale between "Story Points" and "T‑shirt Sizes" via a workspace-level setting.
- Changing the scale does NOT clear or convert existing effort values — items with a now-inactive scale display their stored value with a visual indicator that the scale has changed (e.g. "5 SP (legacy)" with a tooltip).
- The dropdown in all editing affordances SHALL only offer values for the active scale. A task carrying a legacy scale value that is edited SHALL be migrated to the active scale on save.
- MVP exposes this setting via the existing settings infrastructure (tenant settings or project settings endpoint). A dedicated admin UI is post‑MVP.

**9.2 Default**

- New workspaces SHALL default to `story-points`.

---

### REQ‑10: Non‑Functional Requirements

| Attribute | Detail |
|-----------|--------|
| Maps to | All |
| Priority | P1 |

**10.1 Performance**

- Effort badge render SHALL NOT add measurable latency to card rendering. The effort value is part of the task payload already returned by `GET /api/tasks` — no extra network round-trip.
- Dropdown open/close SHALL be sub‑100 ms.

**10.2 Error Handling**

- Network failure during save: revert to previous value, show toast "Couldn't save estimate. Check your connection."
- Server validation failure: revert and display the server's error message inline.
- Concurrent edit conflict (`409`): revert and display banner as described in REQ‑7.1.

**10.3 State Consistency**

- When the same task is visible in multiple views (board + open drawer), an effort change in one SHALL reflect in the other within the same render cycle via shared React state (`setTasks`).

---

### Traceability Matrix

| REQ | FR(s) | AC(s) |
|-----|-------|-------|
| REQ‑1 | FR‑4.1, FR‑4.5 | AC‑1, AC‑4 |
| REQ‑2 | FR‑4.2, FR‑4.10 | AC‑2, AC‑8 |
| REQ‑3 | FR‑4.3 | AC‑1 |
| REQ‑4 | FR‑4.4, FR‑4.6 | AC‑3, AC‑9 |
| REQ‑5 | FR‑4.8 | AC‑3 (bulk) |
| REQ‑6 | FR‑4.7 | AC‑6 |
| REQ‑7 | FR‑4.6 | AC‑5 |
| REQ‑8 | FR‑4.9 | AC‑7 |
| REQ‑9 | FR‑4.1 | AC‑1 |
| REQ‑10 | All | AC‑5, AC‑8, AC‑9 |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._

## Acceptance

_Owned by the validator — to be authored._