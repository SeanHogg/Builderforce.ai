> **PRD** — drafted by Ada (Sr. Product Mgr) · task #230
> _Each agent that updates this PRD signs its change below._

# PRD: Current Backlog Size Dashboard Metric

## Problem & Goal

Engineering and product teams lack a real-time, at-a-glance view of their current backlog size expressed in both story points and task count. Without this metric surfaced clearly, sprint planning decisions are made with stale or manually aggregated data, leading to inaccurate capacity planning and delayed triage.

**Goal:** Deliver a single, reliable backlog size metric widget that displays the current total number of backlog items and their aggregate story point value, updated in real time, accessible from the primary project dashboard.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Engineering Manager** | Monitors team load and backlog health across one or more teams |
| **Product Manager / Owner** | Tracks outstanding scope to prioritize grooming sessions |
| **Scrum Master / Agile Coach** | Uses backlog size trends to facilitate sprint planning and retrospectives |
| **Individual Contributor (Engineer)** | Quickly checks what is waiting in the backlog before pulling new work |

---

## Scope

### In Scope

- Backlog size metric displayed as:
  - **Total task count** (integer)
  - **Total story points** (sum of all pointed items)
- Metric reflects the **current sprint-excluded backlog** (all items in a Backlog status that are not assigned to an active or future sprint)
- Support for **team-level** and **project-level** filtering
- Data refreshed on a **defined polling interval** (default: 5 minutes) with a manual refresh option
- Metric available on the **main project dashboard** as a widget
- Unpointed items counted in task count but flagged separately; not included in story-point total
- Historical snapshot stored to support a **trend sparkline** (last 30 days)

---

## Functional Requirements

### FR-1 — Backlog Query & Calculation
- The system **must** query all work items where:
  - `status = Backlog`
  - `sprint = NULL` or `sprint.state ≠ active | future`
- The system **must** compute:
  - `task_count` = COUNT of qualifying items
  - `story_points_total` = SUM of `story_points` for items where `story_points IS NOT NULL`
  - `unpointed_count` = COUNT of items where `story_points IS NULL`

### FR-2 — Widget Display
- The widget **must** show:
  - `Task Count` as a prominent numeric value
  - `Story Points` as a prominent numeric value
  - `Unpointed items: N` as a secondary label beneath story points
  - Last-updated timestamp ("Updated 3 min ago")
- The widget **must** support a manual **Refresh** button/icon
- The widget **must** display a 30-day trend sparkline for both metrics (togglable)

### FR-3 — Filtering
- The widget **must** support filtering by:
  - Project (single or multi-select)
  - Team (single or multi-select)
  - Label / Epic (optional secondary filter)
- Applied filters **must** persist per user session

### FR-4 — Data Freshness
- Backlog data **must** be polled or pushed at a maximum interval of **5 minutes**
- A staleness indicator **must** appear if data is older than **15 minutes**

### FR-5 — Historical Snapshots
- The system **must** record a daily snapshot of `task_count` and `story_points_total` per project/team combination
- Snapshots **must** be retained for a minimum of **90 days**

### FR-6 — Permissions
- Users **must** only see backlog data for projects/teams they have at least **read** access to
- Aggregated cross-team views **must** be available only to users with **Manager** role or above

### FR-7 — Integrations
- The metric **must** ingest data from supported project management sources:
  - Jira (primary)
  - Linear
  - GitHub Issues (with milestone/label-based backlog definition)
- New integrations added via a pluggable connector interface

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | Given a project with 42 backlog items (30 pointed, 12 unpointed, total 185 SP), the widget displays **Task Count: 42**, **Story Points: 185**, **Unpointed: 12** |
| AC-2 | When an item is moved from Backlog into an active sprint, the widget reflects the updated count within **5 minutes** without manual refresh |
| AC-3 | When the user applies a Team filter, only items belonging to that team are included in both counts |
| AC-4 | When data is older than 15 minutes, a yellow staleness banner reads "Data may be outdated — last synced [timestamp]" |
| AC-5 | The 30-day sparkline renders correctly with no data gaps; days with zero changes show a flat line (not null) |
| AC-6 | A user without access to Project X cannot see Project X backlog counts, even via direct API call (returns 403) |
| AC-7 | Manual Refresh button triggers a new data fetch and updates the timestamp within **10 seconds** on a standard connection |
| AC-8 | Story-point total excludes unpointed items; unpointed count is shown separately and never added to the SP total |
| AC-9 | The widget loads and renders within **2 seconds** on initial page load (P95, measured in production-like environment) |
| AC-10 | Daily snapshots for a project are queryable via API for the trailing 90 days without data loss |

---

## Out of Scope

- **Sprint backlog metrics** (items inside an active sprint) — covered by a separate Sprint Health widget
- **Velocity tracking** and **burndown/burnup charts** — separate reporting module
- **Backlog prioritization or reordering** — this PRD covers read-only metric display only
- **Capacity planning recommendations** or AI-driven suggestions
- **Mobile native app** — web responsive only in this iteration
- **Real-time WebSocket push** for sub-minute updates — polling model sufficient for v1
- **Custom story-point scales** beyond numeric integers (e.g., T-shirt sizing) — v2 consideration
- **Exporting** the backlog metric data to PDF/CSV — post-v1 backlog item
- **Alerting / notifications** when backlog exceeds a threshold — future enhancement