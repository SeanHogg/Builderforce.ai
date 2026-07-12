> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #334
> _Each agent that updates this PRD signs its change below._

# PRD: Integration Health Dashboard Per Project

## Problem & Goal

Engineering teams managing multiple third-party integrations (APIs, webhooks, data pipelines, auth providers, etc.) lack a unified, per-project view of integration status and health. Failures are discovered reactively — through end-user complaints or downstream errors — rather than proactively. The goal is to provide a real-time, per-project integration health dashboard that surfaces the operational status, error rates, latency trends, and recent failure details for every integration associated with a project, enabling teams to detect, diagnose, and resolve integration issues faster.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| **Backend / Platform Engineer** | Monitor integration uptime, view error payloads, drill into recent failures |
| **Engineering Manager / Tech Lead** | At-a-glance project health, SLA visibility, escalation triggers |
| **DevOps / SRE** | Alerting thresholds, incident correlation, historical trend analysis |
| **Product Manager** | Understand user-facing impact of integration degradation |

---

## Scope

### In Scope
- Per-project dashboard view showing all configured integrations and their health status
- Real-time and historical (up to 90 days) health metrics per integration
- Integration-level drill-down with recent request/event logs and error details
- Configurable alert thresholds and notification channels per integration
- Support for integration types: REST APIs, webhooks, OAuth providers, and internal service connections
- Status classification: **Healthy**, **Degraded**, **Down**, **Unknown**

### Out of Scope
- Creating or configuring new integrations from within the dashboard (handled by existing integration setup flow)
- Full APM / distributed tracing (covered by separate observability tooling)
- Billing or usage-quota dashboards
- Mobile native app (web responsive only for initial release)

---

## Functional Requirements

### FR-1: Project-Scoped Integration List
- The dashboard must display all integrations belonging to the selected project in a single, scrollable list.
- Each row must show: integration name, type/category icon, current status badge, uptime % (last 24 h / 7 d / 30 d), p50/p95 latency (last 1 h), and error rate (last 1 h).
- List must be filterable by status and integration type, and sortable by name, uptime, error rate, and latency.

### FR-2: Status Classification Engine
- Status must be computed continuously (refresh interval ≤ 60 seconds) based on configurable thresholds:
  - **Healthy** — error rate < threshold AND latency within baseline
  - **Degraded** — error rate or latency exceeds warning threshold
  - **Down** — error rate exceeds critical threshold OR consecutive failures ≥ N (configurable)
  - **Unknown** — no data received in the last polling window
- Default thresholds must be provided; project admins must be able to override per integration.

### FR-3: Integration Drill-Down Panel
- Clicking any integration row opens a detail panel (slide-over or dedicated page) containing:
  - Time-series charts: request volume, error rate, p50/p95/p99 latency (selectable windows: 1 h, 6 h, 24 h, 7 d, 30 d)
  - Recent event log: timestamp, HTTP method/event type, status code, latency, truncated error message (last 200 events, paginated)
  - Full error payload viewer for individual log entries (with sensitive field masking)
  - Link to related incidents or alert history

### FR-4: Alerting & Notifications
- Users must be able to configure alert rules per integration with conditions (error rate %, latency ms, consecutive failures).
- Supported notification channels for initial release: email, Slack, PagerDuty webhook.
- Alerts must fire within 2 minutes of threshold breach.
- Alert suppression (maintenance windows) must be configurable per integration with start/end time.

### FR-5: Summary & Rollup
- Top of the dashboard must display a project-level health summary card:
  - Total integrations count broken down by status
  - Count of active alerts
  - Worst-performing integration (highest error rate in last 1 h)
- A project health score (0–100) must be derived from weighted uptime and error rate across all integrations.

### FR-6: Access Control
- Dashboard visibility and data must be scoped to the authenticated user's project membership.
- Alert configuration must require project **Admin** or **Editor** role.
- Read-only view must be available for project **Viewer** role.

### FR-7: Data Retention & Export
- Raw event logs retained for 30 days; aggregated metrics retained for 90 days.
- Users must be able to export metric data (CSV) and event logs (JSON) for any integration within the retention window.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Given a project with ≥ 1 configured integration, the dashboard renders all integrations with correct status badges within 3 seconds of page load on a standard broadband connection. |
| AC-2 | Status badges update without full page reload within 60 seconds of a simulated integration failure in a staging environment. |
| AC-3 | Drill-down panel displays time-series charts and the last 200 log entries for any integration; pagination loads additional entries within 1 second. |
| AC-4 | An alert configured with a 5% error rate threshold fires a Slack notification within 2 minutes of the threshold being continuously breached in integration tests. |
| AC-5 | A user with **Viewer** role can view the dashboard but receives a permission error when attempting to save alert configuration changes. |
| AC-6 | Exporting 30 days of metric data for a single integration returns a valid CSV file within 10 seconds. |
| AC-7 | Sensitive fields (e.g., Authorization headers, tokens) are masked in the error payload viewer and do not appear in exported logs. |
| AC-8 | The project health score changes in real time and reflects the correct weighted calculation after a status change to any integration. |
| AC-9 | A maintenance window suppresses all alerts for the covered integration during the configured time range and resumes alerting immediately after the window closes. |
| AC-10 | Dashboard is accessible (WCAG 2.1 AA) and fully operable via keyboard navigation. |

---

## Out of Scope

- **Integration creation / configuration UI** — handled by the existing integrations setup wizard; this dashboard is read/monitor-only for integration configuration.
- **Distributed tracing & span-level APM** — teams should use dedicated observability tooling (e.g., Datadog, Honeycomb) for deep tracing; this dashboard surfaces aggregate signals only.
- **Cross-project rollup dashboard** — a portfolio-level view across all projects is a future phase.
- **Synthetic / uptime monitoring** (proactive external health checks) — current phase relies on observed traffic; synthetic monitoring is a future enhancement.
- **Mobile native application** — web responsive design only.
- **Billing, quota, or rate-limit dashboards** — separate product surface.
- **Auto-remediation or runbook automation** — the dashboard surfaces information; it does not trigger automated fixes.