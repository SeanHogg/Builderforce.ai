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

_Owned by the business-analyst — to be authored._

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