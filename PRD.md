> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #296
> _Each agent that updates this PRD signs its change below._

# PRD: Schedule Health Dashboard

## Problem & Goal

Engineering teams and project managers lack a consolidated, real-time view of whether their project is on track. Deadline risk, velocity trends, overdue tasks, and sprint predictability are scattered across planning tools, spreadsheets, and verbal check-ins — leading to late identification of slippage, reactive firefighting, and missed commitments.

**Goal:** Deliver a Schedule Health feature that continuously monitors and surfaces schedule risk signals, giving teams an at-a-glance answer to "Are we on track?" and actionable data to course-correct before deadlines are missed.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Engineering Manager / Team Lead | Spot velocity drops and sprint predictability issues early |
| Program / Project Manager | Track milestone and deadline risk across one or more teams |
| Scrum Master / Agile Coach | Monitor sprint health, identify systemic planning issues |
| Product Manager | Understand delivery confidence for roadmap commitments |
| Executive / VP Engineering | Portfolio-level schedule risk with minimal noise |

---

## Scope

### In Scope

- Deadline tracking and projected completion date vs. committed date
- Velocity trending over rolling sprint windows (configurable N sprints)
- Overdue task detection, aging, and escalation signals
- Sprint predictability scoring (planned vs. completed story points / tasks)
- Summary health score per team / project / sprint
- Alerts and threshold-based notifications
- Dashboard UI with drill-down capability

### Data Sources (Phase 1)

- Jira (primary integration)
- Linear
- GitHub Issues + Milestones

---

## Functional Requirements

### FR-1: Deadline Risk Tracker

- **FR-1.1** Display committed deadline alongside a system-projected completion date derived from current velocity and remaining work.
- **FR-1.2** Calculate and display a **Days at Risk** delta (projected date − committed date); negative values indicate buffer, positive values indicate slippage.
- **FR-1.3** Classify each milestone/deadline into one of three risk tiers: `On Track` (≤ 0 days at risk), `At Risk` (1–7 days), `Off Track` (> 7 days).
- **FR-1.4** Support multiple concurrent deadlines per project.
- **FR-1.5** Allow users to pin a deadline as the primary commitment for top-line health scoring.

### FR-2: Velocity Trending

- **FR-2.1** Compute per-sprint velocity (story points or task count; user-selectable).
- **FR-2.2** Render a rolling velocity trend chart for the last N sprints (default N = 6; configurable 3–20).
- **FR-2.3** Calculate and display a **velocity trend direction**: improving, stable (± 10%), or declining.
- **FR-2.4** Surface a **velocity forecast band** (optimistic / expected / pessimistic) based on standard deviation of historical sprints.
- **FR-2.5** Flag anomalous sprints (velocity > 2σ from mean) with a visual callout and reason prompt.

### FR-3: Overdue Task Detection

- **FR-3.1** Identify all tasks whose due date (or sprint end date) has passed and whose status is not `Done` / `Closed`.
- **FR-3.2** Display overdue tasks in a sortable list with: task ID, title, assignee, original due date, days overdue, and current status.
- **FR-3.3** Calculate an **Overdue Rate** = (# overdue tasks / total tasks in period) × 100.
- **FR-3.4** Categorize overdue tasks by aging buckets: `1–3 days`, `4–7 days`, `8–14 days`, `15+ days`.
- **FR-3.5** Allow bulk actions: reassign, update due date, or escalate to manager directly from the list.
- **FR-3.6** Trigger a notification when a task crosses into a new aging bucket.

### FR-4: Sprint Predictability Score

- **FR-4.1** For each completed sprint, compute **Predictability %** = (completed points / committed points) × 100.
- **FR-4.2** Display a per-sprint predictability history chart alongside the rolling average.
- **FR-4.3** Classify sprints: `Highly Predictable` (85–100%), `Moderate` (65–84%), `Unpredictable` (< 65%).
- **FR-4.4** Identify the most common reason for incomplete sprint items (scope added mid-sprint, blocked, unplanned work) via tag/label analysis on removed or carried-over tickets.
- **FR-4.5** Surface a **Sprint Commitment Trend**: is the team consistently over- or under-committing over the last N sprints?

### FR-5: Aggregate Schedule Health Score

- **FR-5.1** Compute a single **Schedule Health Score** (0–100) as a weighted composite of: deadline risk (40%), velocity trend (30%), sprint predictability (20%), overdue rate (10%).
- **FR-5.2** Weights must be configurable per team or project by an admin.
- **FR-5.3** Display score with a color-coded indicator: Green (80–100), Amber (60–79), Red (< 60).
- **FR-5.4** Show score trend direction (vs. previous sprint / week).

### FR-6: Alerts & Notifications

- **FR-6.1** Allow users to configure alert thresholds for: deadline days-at-risk, velocity drop %, overdue rate %, predictability %.
- **FR-6.2** Deliver alerts via in-app notification, email, and Slack (Phase 1); MS Teams (Phase 2).
- **FR-6.3** Support alert suppression / snooze per rule (minimum 24-hour snooze).
- **FR-6.4** Provide a notification digest mode (daily summary) as an alternative to real-time alerts.

### FR-7: Dashboard & Navigation

- **FR-7.1** Provide a top-level Schedule Health dashboard summarizing all tracked projects/teams.
- **FR-7.2** Support drill-down from project → sprint → individual task.
- **FR-7.3** Allow date-range filtering and sprint-range filtering on all charts.
- **FR-7.4** Export dashboard data as CSV and PDF (snapshot).
- **FR-7.5** Support saved views / custom layouts per user role.

---

## Acceptance Criteria

### AC-1: Deadline Risk

- [ ] Given a project with a committed deadline and remaining backlog, the system displays a projected completion date within ±1 sprint of manual PM estimate in ≥ 85% of test cases.
- [ ] Risk tier badge updates automatically within 15 minutes of a ticket status change in the connected source.
- [ ] Days at Risk delta is visible without scrolling on the project summary card.

### AC-2: Velocity Trending

- [ ] Velocity chart renders correctly for teams with 3–20 historical sprints.
- [ ] Trend direction label matches direction of least-squares regression slope on test dataset.
- [ ] Forecast band (optimistic/expected/pessimistic) is visible and labeled on the chart.
- [ ] Anomalous sprint callouts appear for any sprint beyond 2σ on the QA dataset.

### AC-3: Overdue Tasks

- [ ] All tasks with due date < today and status ≠ Done surface in the overdue list within 15 minutes of sync.
- [ ] Overdue Rate calculation matches manual count on a seeded test project (100% accuracy).
- [ ] Aging bucket reassignment triggers a notification to the configured recipient within 5 minutes.
- [ ] Bulk reassign action completes and writes back to the source tool within 30 seconds for up to 50 tasks.

### AC-4: Sprint Predictability

- [ ] Predictability % for each historical sprint matches manual calculation from raw sprint data (zero tolerance for rounding error > 0.5%).
- [ ] Classification labels (Highly Predictable / Moderate / Unpredictable) display correctly for boundary values (65%, 85%).
- [ ] Reason analysis surfaces at least one tag/label-based reason for carry-over items when labels are present in ≥ 50% of carried-over tickets.

### AC-5: Health Score

- [ ] Score updates on every sync cycle (max 15-minute lag).
- [ ] Changing weights in admin settings recalculates the score immediately in the UI.
- [ ] Score color indicator matches the defined thresholds exactly (tested at boundary values 60, 80).

### AC-6: Alerts

- [ ] A threshold breach triggers an in-app notification within 5 minutes.
- [ ] Slack notification delivered within 5 minutes of threshold breach (requires configured integration).
- [ ] Snooze of 24 hours suppresses repeat alerts; alert re-fires after snooze window.
- [ ] Daily digest email contains all active threshold breaches as of 08:00 local time.

### AC-7: Dashboard

- [ ] Dashboard loads with full data for a 12-sprint, 5-project workspace in < 3 seconds on a standard broadband connection.
- [ ] CSV export contains all displayed metric columns and row-level task data for the selected filter.
- [ ] Drill-down path (project → sprint → task) is accessible without page reload (SPA navigation).

---

## Out of Scope

- **Capacity planning / resource allocation** — headcount and leave management are separate concerns.
- **Budget / cost tracking** — financial forecasting is out of scope for this feature.
- **Automated sprint replanning** — the system surfaces signals; it does not auto-reschedule or move tickets.
- **Time-tracking / time-logging** integration (e.g., Tempo, Harvest) — not included in Phase 1.
- **Cross-team dependency mapping** — dependency graphs are handled by a separate Dependency Health feature.
- **Mobile native app** — web responsive only for Phase 1; native iOS/Android deferred.
- **AI-generated remediation recommendations** — surfacing risk signals is in scope; prescriptive AI fixes are Phase 3.
- **MS Teams notifications** — deferred to Phase 2.
- **GitLab, Azure DevOps, Asana integrations** — deferred to Phase 2.
- **Historical data import beyond 24 months** — data retention window capped at 24 months for Phase 1.