> **PRD** — drafted by Ada (Sr. Product Mgr) · task #188
> _Each agent that updates this PRD signs its change below._

# PRD: "What's Overdue?" Section

## Problem & Goal

Users lose track of tasks, bugs, and deadlines that have silently slipped past their due dates. There is no consolidated, prominent view that surfaces overdue items in one place, forcing users to manually scan across projects, boards, or lists to discover what is late. The goal is to introduce a **"What's Overdue?"** section that automatically aggregates and displays all past-due items so users can triage, reassign, or resolve them without hunting.

---

## Target Users / ICP Roles

| Role | Pain Point Addressed |
|---|---|
| **Individual Contributors** | Quickly see their own overdue tasks without filtering manually |
| **Team Leads / Managers** | Monitor overdue items across the full team or project |
| **Project Managers** | Identify deadline slippage early and take corrective action |
| **QA Engineers** | Track bugs whose fix-by dates have passed |

---

## Scope

This PRD covers the design and implementation of a **"What's Overdue?" section** rendered within the existing dashboard and/or a dedicated overdue view. It applies to all item types that carry a due date: tasks, bugs/issues, and milestone deadlines.

---

## Functional Requirements

### FR-1 — Overdue Item Detection
- An item is classified as **overdue** when its `due_date` is strictly less than the current date (midnight, user's local timezone) **and** its status is not in a completed or cancelled state.
- Detection must run in real time; items must transition to overdue status automatically without requiring a manual refresh.

### FR-2 — "What's Overdue?" Section Display
- The section must appear on the **main dashboard** as a collapsible panel, visible by default.
- Each overdue item must display:
  - Item title (linked to the detail view)
  - Item type badge: `Task`, `Bug`, or `Deadline`
  - Original due date
  - Days overdue (e.g., "3 days overdue") calculated dynamically
  - Assignee avatar(s)
  - Priority indicator (Critical / High / Medium / Low)
  - Parent project or milestone name

### FR-3 — Sorting & Ordering
- Default sort: **days overdue descending** (most overdue at top).
- Secondary sort: **priority descending** (Critical before High, etc.).
- Users can re-sort by: Due Date, Priority, Item Type, or Assignee.

### FR-4 — Filtering
- Users can filter the section by:
  - Item type (Task / Bug / Deadline)
  - Assignee (self, specific user, or all)
  - Project / team
  - Priority level
- Applied filters must persist across page reloads (stored in user preferences).

### FR-5 — Scope Toggle (Personal vs. Team View)
- A toggle at the section header allows switching between:
  - **My Overdue** — items assigned to the current user only
  - **Team Overdue** — all overdue items visible to the user based on their permissions

### FR-6 — Inline Actions
- From within the section, users must be able to perform the following without leaving the page:
  - **Reschedule** — update the due date via a date picker
  - **Reassign** — change the assignee via a user picker
  - **Mark Complete** — close/resolve the item immediately
  - **Snooze** — temporarily hide the item for 1 day, 3 days, or 7 days (snoozed items reappear after the snooze period and are flagged with a snooze indicator)

### FR-7 — Empty State
- When no items are overdue, display a positive empty state message (e.g., "You're all caught up — nothing is overdue right now.") with an illustrative icon.

### FR-8 — Notifications & Badges
- A numeric badge on the dashboard navigation item must reflect the count of currently overdue items.
- The badge must update in real time (WebSocket or polling interval ≤ 60 seconds).
- Users may opt out of the badge via notification preferences without hiding the section itself.

### FR-9 — Accessibility
- The section must meet **WCAG 2.1 AA** standards: keyboard navigable, screen-reader labelled, sufficient color contrast for priority indicators.

### FR-10 — Performance
- The section must render with full data within **2 seconds** on a standard broadband connection for up to 500 overdue items.
- For counts exceeding 500, paginate in increments of 50 with a "Load more" control.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-01 | An item whose due date was yesterday (and is not completed/cancelled) appears in the "What's Overdue?" section within 60 seconds of the due date passing. |
| AC-02 | Each overdue item displays its title, type badge, due date, days-overdue count, assignee, priority, and parent project. |
| AC-03 | Items are sorted by days overdue (descending) by default; secondary sort by priority descending. |
| AC-04 | The scope toggle correctly switches between "My Overdue" and "Team Overdue" and respects permission boundaries. |
| AC-05 | Rescheduling an item to a future date removes it from the overdue list immediately (within the same session, no reload required). |
| AC-06 | Marking an item complete removes it from the list immediately. |
| AC-07 | Snoozing an item hides it for the selected period and restores it automatically after the period expires. |
| AC-08 | The navigation badge count matches the number of overdue items visible to the current user and updates within 60 seconds. |
| AC-09 | Filters applied by the user persist after a full page reload. |
| AC-10 | The section renders within 2 seconds for a dataset of 500 overdue items on a standard broadband connection. |
| AC-11 | The empty state is displayed when zero items are overdue. |
| AC-12 | The section and all interactive elements are fully operable via keyboard alone and pass automated WCAG 2.1 AA checks. |

---

## Out of Scope

- **Automated escalation or alerts** sent to managers when items become overdue (covered by a separate Notifications PRD).
- **Overdue reporting / analytics** (trend charts, SLA breach reports) — addressed in the Reporting module.
- **Recurring task logic** — overdue detection for recurring tasks follows existing recurrence rules and is not modified by this feature.
- **Third-party integrations** (Jira, Asana, GitHub Issues) — synced items may surface in the section if already ingested, but sync behavior itself is out of scope.
- **Mobile native apps** — this release targets web only; mobile parity is a follow-on effort.
- **Custom overdue thresholds** (e.g., warn at 2 hours past due) — default behavior is calendar-day granularity only.