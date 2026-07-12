> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #250
> _Each agent that updates this PRD signs its change below._

# PRD: Project Status & Progress Tracking Feature

## Problem & Goal

Teams managing multiple workstreams lack a unified, structured way to surface per-item health at a glance. Stakeholders waste time in status meetings because there is no single source of truth that answers — for each item — what its current state is, how far along it is, how risky it is, what is blocking it, and what happens next. The goal is to deliver a lightweight tracking layer that populates and displays exactly those five data points for every tracked item, enabling faster decisions and clearer accountability.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Program Manager | Aggregate view of all items to identify blockers and escalate risk |
| Team Lead | Per-item detail to assign next actions and unblock contributors |
| Individual Contributor | Know exactly what their next action is and what is blocking progress |
| Executive Sponsor | High-level risk and completion signal without noise |

---

## Scope

### In Scope

- Tracking of the following five fields per item:
  1. **Status** — categorical state of the item
  2. **Completion %** — numeric progress indicator (0–100)
  3. **Risk Level** — severity classification of current risk
  4. **Key Blocker** — primary impediment preventing forward progress
  5. **Next Action** — the immediate, concrete step required to advance the item
- Display of all five fields in a structured list or table view
- Ability to update each field manually
- Filtering and sorting by status and risk level
- Exportable snapshot (CSV or markdown table)

### Out of Scope

- Automated progress calculation from subtasks
- Time tracking or effort estimation
- Integration with third-party project management tools (Phase 2)
- Notifications or alerting (Phase 2)
- Role-based access control beyond basic authentication

---

## Functional Requirements

### FR-1: Item Data Model

Each tracked item must store and expose the following fields:

| Field | Type | Allowed Values / Constraints |
|---|---|---|
| `status` | Enum | `Not Started`, `In Progress`, `Blocked`, `In Review`, `Complete` |
| `completion_pct` | Integer | 0–100 inclusive |
| `risk_level` | Enum | `Low`, `Medium`, `High`, `Critical` |
| `key_blocker` | String (nullable) | Free text; null if no active blocker |
| `next_action` | String | Free text; required; max 500 characters |

### FR-2: Create & Edit Items

- Users can create a new item with a name and any subset of the five fields pre-populated; defaults apply where fields are omitted.
- Users can edit any of the five fields on an existing item inline or via an edit form.
- Changes are persisted immediately on save with a visible confirmation.

### FR-3: Display

- All items are displayed in a table with one row per item and one column per tracked field.
- `risk_level` cells are color-coded: Low = green, Medium = yellow, High = orange, Critical = red.
- `status = Blocked` rows are visually distinguished (e.g., striped background or left border accent).
- Completion % is rendered as both a numeric value and a progress bar within the cell.

### FR-4: Filtering & Sorting

- Users can filter the table by one or more `status` values simultaneously.
- Users can filter the table by one or more `risk_level` values simultaneously.
- Users can sort the table by `completion_pct` (ascending/descending) and `risk_level` (severity order).
- Active filters are displayed as removable chips; a "Clear All" control resets to the full list.

### FR-5: Export

- Users can export the current view (respecting active filters) as:
  - A CSV file with headers matching field names.
  - A GitHub-flavored markdown table copied to clipboard.
- Export timestamp is appended as a footer row or file comment.

### FR-6: Defaults

| Field | Default Value |
|---|---|
| `status` | `Not Started` |
| `completion_pct` | `0` |
| `risk_level` | `Low` |
| `key_blocker` | null |
| `next_action` | *(required — no default; must be entered by user)* |

---

## Acceptance Criteria

### AC-1: Data Integrity
- [ ] An item cannot be saved without a value for `next_action`.
- [ ] `completion_pct` rejects values outside 0–100 with an inline validation error.
- [ ] Setting `status` to `Complete` automatically sets `completion_pct` to 100 and prompts the user to clear `key_blocker`.

### AC-2: Display Correctness
- [ ] All five fields are visible for every item without horizontal scrolling on a 1280px-wide viewport.
- [ ] Risk level color coding matches the defined palette with sufficient contrast (WCAG AA minimum).
- [ ] Progress bar reflects `completion_pct` value accurately within ±1px rounding.

### AC-3: Filtering & Sorting
- [ ] Applying a status filter of `Blocked` returns only items with `status = Blocked`.
- [ ] Combining a status filter and a risk filter returns items matching both conditions (AND logic).
- [ ] Sorting by `risk_level` orders rows: Critical → High → Medium → Low (descending severity).

### AC-4: Export
- [ ] CSV export contains a header row and one data row per visible item.
- [ ] Markdown export is valid GFM table syntax that renders correctly in GitHub.
- [ ] Export reflects the currently active filters, not the full unfiltered dataset.

### AC-5: Performance
- [ ] Table renders up to 500 items without perceptible lag (< 300 ms paint after data load).
- [ ] Inline edits save and confirm within 1 second under normal network conditions.

---

## Out of Scope

- Automatic calculation of `completion_pct` from child tasks or subtask counts
- Historical audit log or change history per field
- Comments, mentions, or threaded discussion on items
- Gantt chart or timeline view
- Dependency mapping between items
- Slack, Jira, Linear, or any other third-party integration
- Mobile-native application (responsive web is in scope; native is not)
- Workflow automation or trigger-based field updates
- Multi-workspace or multi-tenant support