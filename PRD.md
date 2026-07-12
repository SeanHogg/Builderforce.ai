> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #308
> _Each agent that updates this PRD signs its change below._

# PRD: Composite Project Health Score with Traffic Light

## Problem & Goal

Engineering and project teams lack a single, at-a-glance signal that communicates the overall health of a project. Metrics such as build status, test coverage, open incidents, deployment frequency, sprint velocity, and SLA compliance exist in disparate tools, forcing stakeholders to context-switch and mentally synthesize data before forming a judgment. This cognitive overhead delays escalations and obscures deteriorating projects until they become crises.

**Goal:** Compute a single composite health score (0–100) for each project by aggregating weighted sub-metrics, and surface that score as a traffic-light indicator (🔴 Red / 🟡 Amber / 🟢 Green) on every relevant surface where the project appears.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| Engineering Manager | Spot unhealthy projects across a portfolio without reading dashboards |
| Product Manager | Understand project risk before sprint reviews and stakeholder comms |
| VP / Director of Engineering | Portfolio-level roll-up; trigger escalations early |
| DevOps / Platform Engineer | Configure data source integrations and tune scoring weights |
| On-Call Engineer | Immediately know whether an incident is compounding existing project risk |

---

## Scope

### In Scope

- Definition and calculation of the composite health score
- Configuration of sub-metric sources, weights, and thresholds
- Traffic-light display component (Red / Amber / Green) with numeric score tooltip
- Project-level and portfolio-level views
- Historical score trend (rolling 30 days)
- Webhook / API for external consumers to read scores
- Alerting when a project transitions between traffic-light states
- Role-based visibility controls (read vs. configure)

### Out of Scope (see dedicated section)

---

## Functional Requirements

### FR-1 Sub-Metric Ingestion

1. The system **must** support at least the following built-in sub-metric categories at launch:
   - **CI/CD Health** — build pass rate, mean time to recovery (MTTR)
   - **Code Quality** — test coverage percentage, static analysis violation count
   - **Reliability** — open P1/P2 incident count, SLA breach rate
   - **Delivery Cadence** — deployment frequency, sprint velocity deviation from baseline
   - **Dependency Risk** — count of outdated or vulnerable dependencies
2. Each sub-metric **must** be sourced via a configurable integration (e.g., GitHub Actions, Jira, PagerDuty, SonarQube, Snyk, Datadog).
3. The system **must** support a custom numeric sub-metric submitted via REST API for teams with proprietary data sources.
4. Sub-metric data **must** refresh at a configurable interval (minimum 5 minutes, default 15 minutes).
5. If a data source is unreachable, the last known value **must** be used for up to 2 refresh cycles; beyond that the sub-metric is marked *stale* and its weight is redistributed proportionally across healthy sub-metrics.

### FR-2 Composite Score Calculation

1. Each sub-metric produces a normalised score in the range 0–100 using configurable min/max bounds or discrete lookup tables.
2. The composite score is computed as a **weighted average** of all active (non-stale) sub-metric scores.
3. Default weights **must** be provided out-of-the-box; a DevOps/Platform Engineer **must** be able to override weights per project or globally.
4. Weights for a project **must** sum to 100 %; the UI **must** enforce this constraint.
5. Score computation **must** complete within 5 seconds of all sub-metric values being available.
6. Score history **must** be stored at each refresh interval and retained for a minimum of 90 days.

### FR-3 Traffic Light Mapping

1. The traffic light status **must** be derived from the composite score using configurable thresholds with the following defaults:

   | Status | Default Range | Colour Token |
   |---|---|---|
   | Green | 75 – 100 | `health.green` |
   | Amber | 50 – 74 | `health.amber` |
   | Red | 0 – 49 | `health.red` |

2. Thresholds **must** be configurable globally and per project; project-level settings take precedence.
3. A **critical override rule** must allow a single sub-metric (e.g., open P1 incident) to force the overall status to Red regardless of composite score.

### FR-4 Display Components

1. A **Traffic Light Badge** component **must** show the colour status, numeric score, and a timestamp of last update.
2. Hovering / tapping the badge **must** reveal a tooltip or popover listing each sub-metric name, its individual score, and its weight.
3. The badge **must** be embeddable in:
   - The project list / portfolio dashboard
   - The individual project overview page
   - Pull request sidebar (GitHub / GitLab integration)
   - Slack / MS Teams notifications (rich unfurl)
4. The badge **must** meet WCAG 2.1 AA contrast requirements and include a text label alongside colour (not colour-only signalling).
5. A **Portfolio Health View** **must** list all projects, sortable and filterable by health status, score, and last-updated time.

### FR-5 Trend & History

1. A sparkline chart **must** display the composite score over the last 30 days on the project overview page.
2. Users **must** be able to drill into any historical data point to see the sub-metric breakdown at that point in time.
3. Score trend direction (improving / degrading / stable) **must** be calculated over a configurable window (default 7 days) and displayed alongside the badge.

### FR-6 Alerting & Notifications

1. The system **must** send a notification when a project's traffic-light status **transitions** (Green→Amber, Amber→Red, Red→Amber, etc.).
2. Notification channels: email, Slack, MS Teams, and outbound webhook.
3. Notifications **must** include: project name, previous status, new status, current score, top contributing sub-metric to the change.
4. Users **must** be able to configure per-project notification subscribers and suppress notifications during a defined maintenance window.

### FR-7 API & Integrations

1. A **REST API** (JSON) **must** expose:
   - `GET /projects/{id}/health` — current score, status, sub-metric breakdown
   - `GET /projects/{id}/health/history` — paginated score history with sub-metric snapshots
   - `POST /projects/{id}/metrics/custom` — ingest a custom sub-metric value
   - `GET /portfolio/health` — all projects with current scores and statuses
2. API responses **must** be paginated, versioned (`/v1/`), and include a `Last-Updated` header.
3. API authentication **must** use OAuth 2.0 (service accounts) and API key as a fallback.

### FR-8 Configuration & Administration

1. A configuration UI **must** allow DevOps/Platform Engineers to:
   - Connect and authenticate data source integrations
   - Set refresh intervals per integration
   - Define global and per-project weights and thresholds
   - Define critical override rules
2. All configuration changes **must** be logged in an audit trail (actor, timestamp, before/after values).
3. Configuration **must** be exportable and importable as YAML for GitOps workflows.

---

## Acceptance Criteria

### AC-1 Score Accuracy
- Given all sub-metric integrations are healthy, when the system calculates the composite score, then the result equals the weighted average of normalised sub-metric scores to within ±0.5 points of a manual calculation using the same inputs.

### AC-2 Traffic Light Threshold
- Given the default thresholds, when the composite score is 74, then the badge displays Amber; when the score is 75, then the badge displays Green.
- Given a critical override rule is active and a P1 incident is open, when the composite score is 90, then the badge displays Red.

### AC-3 Stale Data Handling
- Given a data source has been unreachable for more than 2 consecutive refresh cycles, when the score is computed, then the stale sub-metric is excluded and its weight is redistributed, and the badge displays a ⚠ stale-data indicator.

### AC-4 Refresh Latency
- Given all integrations respond within their SLA, when data is fetched at the configured interval, then the displayed score is updated within 60 seconds of the refresh cycle completing.

### AC-5 Notification on Transition
- Given a project transitions from Green to Amber, when the transition is detected, then a notification is delivered to all configured subscribers within 5 minutes, containing the required fields (project name, previous/new status, score, top contributing sub-metric).

### AC-6 Accessibility
- Given any traffic-light badge rendered in the UI, when inspected with an automated accessibility tool (e.g., axe), then zero WCAG 2.1 AA violations are reported, and the status is conveyed by both colour and a visible text label.

### AC-7 API Availability
- Given valid credentials, when `GET /v1/projects/{id}/health` is called, then it returns HTTP 200 with a JSON body containing `score`, `status`, and `sub_metrics` array within 500 ms at p95 under normal load.

### AC-8 Configuration Audit
- Given a DevOps Engineer changes a weight threshold, when the change is saved, then an audit log entry is created recording the actor's identity, timestamp, field changed, old value, and new value.

### AC-9 Historical Drill-down
- Given a user clicks any point on the 30-day sparkline, when the detail view opens, then it displays the composite score and all sub-metric scores recorded at that specific data point.

### AC-10 Portfolio View
- Given a portfolio contains ≥ 50 projects, when the portfolio health view loads, then it renders within 3 seconds and allows sorting by status and score without additional page load.

---

## Out of Scope

- Automated remediation or ticket creation triggered by score degradation (potential future phase)
- AI/ML-based anomaly detection or predictive health forecasting
- Financial or cost metrics as sub-metric inputs
- Native mobile applications (responsive web only at launch)
- Support for more than one composite score per project (single score per project only)
- Self-hosted / on-premises deployment (SaaS only at launch)
- Real-time streaming updates via WebSocket (polling only at v1)
- Integration with more than the listed built-in data sources without the custom API path