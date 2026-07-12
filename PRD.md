> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #299
> _Each agent that updates this PRD signs its change below._

# PRD: Scope Health Dashboard

## Problem & Goal

Engineering and product teams frequently lose visibility into whether a project is expanding faster than it is being completed. Undetected scope creep causes missed deadlines, burnout, and eroded stakeholder trust. This feature provides a real-time **Scope Health** panel that surfaces three quantitative signals — a scope creep indicator, the new-vs-completed work ratio, and epic completion percentage — so teams can identify and respond to scope drift before it becomes a crisis.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Engineering Manager | Detect runaway scope early; report delivery confidence to leadership |
| Product Manager | Balance backlog growth against sprint throughput |
| Program / Delivery Manager | Monitor multiple epics across teams for portfolio health |
| Executive Stakeholder | High-level read on whether projects are on track |

---

## Scope

This PRD covers the design, data model, calculation logic, and UI/UX requirements for the **Scope Health** feature within the existing project management platform. It targets both individual project views and a cross-project portfolio rollup.

---

## Functional Requirements

### 1. Scope Creep Indicator

**FR-1.1** Calculate a **Scope Creep Score** as the percentage change in total committed work items (stories, tasks, bugs) added after the sprint or phase baseline is locked.

```
Scope Creep Score (%) = ((Items Added Post-Baseline) / Baseline Item Count) × 100
```

**FR-1.2** Display the score as a color-coded badge:
- 🟢 Green: 0–10%
- 🟡 Yellow: 11–25%
- 🔴 Red: > 25%

**FR-1.3** Provide a historical trend sparkline showing Scope Creep Score over the last 8 sprints / time periods.

**FR-1.4** Allow the PM or EM to manually lock or re-lock the baseline at any point; all additions after the lock date count toward creep.

**FR-1.5** Support both **story-point-based** and **item-count-based** calculation modes, configurable per project.

---

### 2. New vs. Completed Work Ratio

**FR-2.1** Compute a rolling **New/Done Ratio** over a configurable window (default: current sprint, options: 7 / 14 / 30 days, current sprint, current quarter).

```
New/Done Ratio = Items (or Points) Added in Window / Items (or Points) Completed in Window
```

**FR-2.2** Render the ratio as a dual-bar or diverging bar chart with "New Work Added" and "Work Completed" side by side, updated in near-real-time (≤ 5-minute polling or on push event).

**FR-2.3** Highlight ratio values > 1.0 (more work added than completed) with a warning state.

**FR-2.4** Expose a drill-down view listing each new item added in the window with its creator, date, linked epic, and story points.

**FR-2.5** Export the ratio data as CSV for the selected time window.

---

### 3. Epic Completion Percentage

**FR-3.1** For each epic in scope, calculate:

```
Epic Completion % = (Completed Story Points or Items / Total Story Points or Items in Epic) × 100
```

where "total" includes all items currently in the epic (i.e., completion % drops when new items are added).

**FR-3.2** Render a sortable, filterable table of epics with columns: Epic Name, Owner, Due Date, Total Items, Completed Items, Completion %, Status (On Track / At Risk / Off Track), and Days Until Due.

**FR-3.3** Derive Status automatically:
- **On Track**: Completion % ≥ expected completion % based on elapsed time
- **At Risk**: Completion % is 10–25 percentage points below expected
- **Off Track**: Completion % is > 25 percentage points below expected

**FR-3.4** Support a portfolio rollup view aggregating epic completion across multiple projects, grouped by team or label.

**FR-3.5** Trigger an in-app notification and optional email/Slack alert when an epic transitions to **At Risk** or **Off Track**.

---

### 4. Scope Health Summary Panel

**FR-4.1** Surface a single **Scope Health Score** (0–100) as a composite of the three signals, with configurable weighting (default: Scope Creep 40%, New/Done Ratio 30%, Epic Completion 30%).

**FR-4.2** Display the summary panel on the project overview page, the sprint board header, and the portfolio dashboard.

**FR-4.3** Provide a "Health History" tab showing how the composite score has changed over time, with annotations for key events (baseline locks, sprint boundaries, major scope additions).

---

### 5. Integrations & Data Sources

**FR-5.1** Ingest work item data from native platform, Jira (REST API v3), Linear (GraphQL API), and GitHub Issues.

**FR-5.2** Recalculate all metrics on each data sync (push webhook preferred; polling fallback every 5 minutes).

**FR-5.3** Respect project-level permissions; users only see epics and items they have read access to.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | Given a baseline is locked and 3 of 20 baseline items are added post-lock, the Scope Creep Score displays 15% with a Yellow badge. |
| AC-2 | Given 10 items added and 8 completed in the current sprint window, the New/Done Ratio displays 1.25 with a warning state indicator. |
| AC-3 | Given an epic with 40 of 100 points complete and 60% of its time elapsed, the epic status is "Off Track" (completion % 40% vs. expected 60%, delta = 20 pts → At Risk boundary; delta > 25 → Off Track — adjust expected accordingly). |
| AC-4 | Given a user switches calculation mode from item-count to story-points, all three metrics recalculate within 3 seconds without a full page reload. |
| AC-5 | Given an epic transitions from On Track to At Risk, an in-app notification appears within one polling cycle (≤ 5 minutes) and, if configured, a Slack message is delivered. |
| AC-6 | Given a user exports the New/Done ratio for a 14-day window, a valid CSV file downloads containing one row per work item with columns: ID, Title, Type, Status, Points, Added Date, Completed Date, Epic. |
| AC-7 | Given a user without read access to an epic, that epic does not appear in any Scope Health view or export. |
| AC-8 | The Scope Health Summary Panel loads within 2 seconds on projects with up to 1,000 active work items. |
| AC-9 | All three metric widgets are individually embeddable via iframe for external stakeholder dashboards. |
| AC-10 | Composite score weighting changes made by an admin take effect immediately with no data loss. |

---

## Out of Scope

- **Predictive forecasting / ML-based scope risk models** — completion date prediction is a separate roadmap initiative.
- **Time-tracking or hours-based metrics** — this feature operates on item counts and story points only.
- **Two-way write-back to Jira/Linear** (e.g., auto-closing items or reassigning epics) — read-only integration only.
- **Custom metric formula builder** — calculation logic is fixed per this release; formula customization is a future enhancement.
- **Mobile native app** — responsive web only for this release.
- **Billing, seat management, or permissions changes** required to unlock Scope Health — feature is available to all existing permission tiers.
- **Sprint retrospective tooling** — Scope Health surfaces data but does not facilitate retro workflows.