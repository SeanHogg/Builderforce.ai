> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #301
> _Each agent that updates this PRD signs its change below._

# PRD: Risk Health Dashboard

## Problem & Goal

Engineering and product teams lack a consolidated, real-time view of project risk exposure. High-priority open items, dependency risks, and external blockers are tracked across disparate tools (Jira, Linear, Confluence, Slack, GitHub), making it impossible to quickly assess overall risk posture or escalate appropriately. As a result, critical blockers surface late, miss SLAs, or derail sprint and release commitments.

**Goal:** Deliver a Risk Health module that aggregates, scores, and surfaces the count and status of high-priority open items, dependency risks, and external blockers in a single authoritative view — enabling teams to identify, triage, and resolve risk before it impacts delivery.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Engineering Manager / Team Lead | Spot blockers threatening sprint goals; triage daily |
| Program / Delivery Manager | Track cross-team dependencies and escalation status |
| VP of Engineering / CTO | Executive-level risk posture at a glance |
| Product Manager | Understand risk to feature commitments and release dates |
| Staff / Principal Engineer | Identify technical dependency chains and unblock teams |

---

## Scope

### In Scope

- Aggregation and classification of risk items across connected data sources
- Three primary risk categories:
  1. **High-Priority Open Items** — unresolved tickets/issues at P0/P1 or equivalent severity
  2. **Dependency Risks** — items blocked on another team, service, or internal milestone
  3. **External Blockers** — items blocked on a third-party vendor, API, regulatory body, or other external entity
- Risk Health Score computed from category counts and aging signals
- Dashboard view with counts, trends, and drill-down detail
- Alerting and notification for threshold breaches
- Historical trend tracking (rolling 7 / 30 / 90 days)

### Out of Scope

- Full project management or ticket editing (read + status-update only)
- Budget / financial risk tracking
- Security vulnerability / CVE management
- Resource capacity planning
- Custom ML-based risk prediction (v1)

---

## Functional Requirements

### FR-1: Data Ingestion & Classification

- **FR-1.1** Connect to at least Jira, Linear, and GitHub Issues as source-of-truth systems via OAuth 2.0 or API token.
- **FR-1.2** Ingest open items every 15 minutes (configurable, minimum 5 min for paid tiers).
- **FR-1.3** Classify each open item into one or more risk categories (High-Priority, Dependency Risk, External Blocker) using:
  - Configurable label/tag mappings (e.g., `blocker`, `external`, `waiting-on-vendor`)
  - Priority field thresholds set per integration (default: P0, P1, Critical, High)
  - Dependency detection via linked issue relationships (blocks/blocked-by, upstream/downstream)
- **FR-1.4** Allow workspace admins to define and save custom classification rules without engineering involvement.

### FR-2: Risk Health Score

- **FR-2.1** Compute a Risk Health Score (0–100, higher = healthier) per project, team, and workspace using the formula:

  ```
  Score = 100 − (w₁ × HighPriorityCount + w₂ × DependencyRiskCount + w₃ × ExternalBlockerCount + w₄ × AgingPenalty)
  ```

  Default weights configurable by admins; clamped to [0, 100].

- **FR-2.2** Apply an aging penalty that increases proportionally for items open beyond configurable SLA thresholds (default: +5 penalty per item open > 3 days, +10 per item open > 7 days).
- **FR-2.3** Display score as a numeric value and a color-coded status band:
  - 🟢 Healthy: 80–100
  - 🟡 At Risk: 50–79
  - 🔴 Critical: 0–49

### FR-3: Dashboard View

- **FR-3.1** Render a top-level Risk Health summary card showing:
  - Current Risk Health Score with status band
  - Counts for each of the three risk categories
  - Delta vs. previous period (↑↓ with percentage)
- **FR-3.2** Provide three category drill-down panels, each listing individual items with: title, source system, assignee, age (days open), linked dependencies, and last-updated timestamp.
- **FR-3.3** Support filtering by: team, project, sprint/milestone, assignee, date range, and source system.
- **FR-3.4** Display a trend sparkline (7-day rolling) for each risk category count and the overall score.
- **FR-3.5** Allow users to mark an item as "acknowledged" with a required comment; acknowledged items are visually differentiated but remain in counts until resolved.
- **FR-3.6** Support full-page and embedded widget (iframe) rendering modes.

### FR-4: Alerting & Notifications

- **FR-4.1** Send configurable alerts when:
  - Overall Risk Health Score drops below a user-defined threshold (default: 60)
  - Any single category count exceeds a user-defined threshold (default: 5 per category)
  - A new P0/Critical item is ingested
  - An item ages past the configured SLA without resolution
- **FR-4.2** Deliver alerts via: in-app notification, email digest (immediate or daily), Slack, and Microsoft Teams webhook.
- **FR-4.3** Support alert suppression windows (e.g., scheduled maintenance, sprints in cool-down).
- **FR-4.4** Provide a notification log with full audit trail (who was notified, when, alert reason).

### FR-5: Historical Trends & Reporting

- **FR-5.1** Store daily snapshots of category counts and Risk Health Score with a minimum 12-month retention.
- **FR-5.2** Render line charts for score and category trends across selectable time windows: 7d, 30d, 90d, custom.
- **FR-5.3** Export risk data as CSV and PDF; exports must respect current filter state.
- **FR-5.4** Provide a shareable, read-only snapshot URL for any dashboard state (expires configurable, default 30 days).

### FR-6: Permissions & Multi-Tenancy

- **FR-6.1** Enforce role-based access: Admin, Manager (read + acknowledge), Viewer (read-only).
- **FR-6.2** Respect source-system permissions — users must not see items their connected account cannot access in the origin tool.
- **FR-6.3** Support workspace-level and project-level permission overrides.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | Given a connected Jira/Linear/GitHub workspace, the system ingests and classifies open items within 15 minutes of creation or priority change. |
| AC-2 | The Risk Health Score updates automatically after each ingestion cycle without manual refresh. |
| AC-3 | Counts displayed on the dashboard match a manual audit of source-system items satisfying classification rules, with zero discrepancy. |
| AC-4 | An alert is fired within 5 minutes of an item triggering a configured threshold breach and appears in the notification log. |
| AC-5 | A user acknowledging an item must provide a non-empty comment; the item remains in the count and is visually marked as acknowledged. |
| AC-6 | Filtering by team or project updates all counts, score, and trend charts without full page reload (< 2 s response at p95). |
| AC-7 | CSV export of the current filtered view downloads within 10 seconds for datasets up to 10,000 items. |
| AC-8 | An Admin can add or modify a classification rule and see it applied on the next ingestion cycle without code deployment. |
| AC-9 | A Viewer-role user cannot access items from projects for which they lack source-system permissions; attempting to do so returns a 403 with a clear message. |
| AC-10 | Historical trend data is available and accurate for any date within the past 12 months. |
| AC-11 | The embedded widget renders correctly at minimum 400 × 300 px and is functional across Chrome, Firefox, Safari, and Edge (latest two major versions). |
| AC-12 | Disabling an alert suppression window immediately re-activates threshold monitoring without requiring a page reload or manual trigger. |

---

## Out of Scope

- Ticket creation, editing, or deletion in source systems (beyond status acknowledgment)
- Financial or budgetary risk dimensions
- Security posture, vulnerability scanning, or CVE tracking
- Headcount, capacity, and resource availability planning
- AI/ML predictive risk forecasting (planned for v2)
- Mobile native applications (iOS / Android)
- On-premise / self-hosted deployment (cloud-only for v1)
- SLA enforcement or automated escalation workflows (tracked for v2)
- Integration with tools beyond Jira, Linear, and GitHub Issues in v1 (Asana, Monday.com, Azure DevOps queued for v2)