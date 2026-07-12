> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #305
> _Each agent that updates this PRD signs its change below._

# PRD: Automated Scoring Engine for Project Data

## Problem & Goal

Project teams and stakeholders currently lack a consistent, objective way to evaluate project health, quality, and progress. Manual reviews are time-consuming, inconsistent across reviewers, and often too infrequent to catch issues early. The goal is to build an automated scoring engine that continuously ingests project data, applies configurable scoring rules, and surfaces actionable scores and insights to relevant stakeholders in near real-time.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| **Project Manager** | Monitor overall project health score; receive alerts on score degradation |
| **Engineering Lead** | Drill into technical sub-scores (code quality, test coverage, velocity) |
| **Portfolio Manager** | Compare scores across multiple projects; track trends over time |
| **QA / Compliance Officer** | Verify that scored criteria meet defined thresholds before release gates |
| **Executive Stakeholder** | High-level dashboard view of project status without manual reporting |

---

## Scope

### In Scope

- Ingestion of structured project data from supported sources (version control, issue trackers, CI/CD pipelines, documentation systems)
- A configurable scoring model with weighted dimensions and sub-dimensions
- Score computation engine (batch and near-real-time modes)
- Score storage and historical trending
- REST API to expose scores and metadata to downstream consumers
- Notification/alert system for threshold breaches
- Admin UI for managing scoring rules and weights
- Role-based access control (RBAC) for score visibility

### Out of Scope

- Direct modification of project data or source systems
- Natural language generation of full project reports (summarization layer is a future phase)
- Billing or subscription management
- Mobile native applications (responsive web only for v1)

---

## Functional Requirements

### 1. Data Ingestion

**FR-1.1** The engine must support configurable connectors for at least the following data sources: GitHub/GitLab (commits, PRs, issues), Jira/Linear (tickets, sprints, epics), CI/CD platforms (build pass/fail rates, deployment frequency), and Confluence/Notion (documentation coverage).

**FR-1.2** Each connector must support OAuth 2.0 or API-key-based authentication and store credentials encrypted at rest.

**FR-1.3** Ingestion must run on a configurable schedule (minimum granularity: every 15 minutes) and support webhook-triggered ingestion for real-time events.

**FR-1.4** The system must handle partial data availability gracefully — if a data source is unavailable, the engine must compute scores using the last known data for that dimension and flag the score as stale.

---

### 2. Scoring Model

**FR-2.1** The scoring model must support multiple configurable **dimensions** (e.g., Velocity, Code Quality, Risk, Documentation, Team Health), each composed of weighted **sub-dimensions**.

**FR-2.2** Each dimension must produce a normalized score on a scale of 0–100.

**FR-2.3** A composite **Project Health Score** (0–100) must be computed as a weighted average of all active dimensions.

**FR-2.4** Dimension weights must be configurable per project or per project template and must sum to 100%.

**FR-2.5** Scoring rules must support the following expression types: threshold comparisons, percentage calculations, trend-over-time calculations (delta over N days), and ratio comparisons.

**FR-2.6** The engine must support a library of built-in scoring rules and allow admins to define custom rules using a structured configuration schema (YAML or JSON).

**FR-2.7** Score computation must be deterministic — given the same input snapshot, the engine must always produce the same output score.

---

### 3. Score Computation Engine

**FR-3.1** The engine must operate in two modes:
- **Batch mode**: full re-computation of all project scores on a configurable schedule.
- **Incremental mode**: re-computation of affected dimensions when new data arrives via webhook.

**FR-3.2** Score computation for a single project must complete within 30 seconds for datasets up to 12 months of history.

**FR-3.3** The engine must support concurrent computation for up to 500 projects simultaneously without degradation beyond defined SLA.

**FR-3.4** All intermediate computation steps must be logged for auditability and debugging.

---

### 4. Score Storage & History

**FR-4.1** Every computed score snapshot must be persisted with a timestamp, the version of the scoring model used, and the data snapshot hash.

**FR-4.2** Score history must be retained for a minimum of 24 months.

**FR-4.3** The system must support querying score history at configurable time granularities: hourly, daily, weekly, monthly.

---

### 5. API

**FR-5.1** A versioned REST API (`/v1/`) must expose the following endpoints:

| Endpoint | Description |
|---|---|
| `GET /projects/{id}/score` | Current composite score and dimension breakdown |
| `GET /projects/{id}/score/history` | Score history with time-range and granularity filters |
| `GET /projects/{id}/dimensions` | List of active dimensions and their current sub-scores |
| `POST /projects/{id}/score/trigger` | Manually trigger a score recomputation |
| `GET /scoring-rules` | List all available scoring rules |
| `PUT /scoring-rules/{id}` | Update a scoring rule configuration |

**FR-5.2** All API responses must include a `computed_at` timestamp and a `data_freshness` field indicating the age of the underlying data.

**FR-5.3** The API must support pagination, filtering, and sorting on all list endpoints.

**FR-5.4** API authentication must use JWT Bearer tokens with configurable expiry.

---

### 6. Alerts & Notifications

**FR-6.1** Users must be able to configure threshold-based alerts per project and per dimension (e.g., "alert when Project Health Score drops below 60").

**FR-6.2** Alerts must be delivered via at least two channels in v1: email and Slack webhook.

**FR-6.3** Alert configurations must support cooldown periods to prevent alert fatigue (minimum cooldown: 1 hour).

**FR-6.4** All triggered alerts must be logged in an alert history accessible via the admin UI and API.

---

### 7. Admin UI

**FR-7.1** The admin UI must allow authorized users to: create and edit scoring rule configurations, assign dimension weights per project or template, view score computation logs, manage data source connectors, and configure alert thresholds.

**FR-7.2** The UI must display a real-time score dashboard per project including current composite score, dimension breakdown, trend sparklines for the past 30 days, and data freshness indicators.

**FR-7.3** The UI must support bulk operations: apply a scoring template to multiple projects simultaneously.

---

### 8. Access Control

**FR-8.1** RBAC must support the following default roles: `Admin`, `Manager`, `Viewer`.

**FR-8.2** `Admin` may configure rules, weights, and connectors. `Manager` may view all scores and configure alerts. `Viewer` may only view scores for projects they are assigned to.

**FR-8.3** Project-level access scoping must ensure that users only see scores for projects they have been granted access to.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| **AC-1** | Given a fully configured project with all connectors active, a composite score is computed and available via API within 5 minutes of initial setup. |
| **AC-2** | When a webhook event is received from a connected source, the affected dimension score is recomputed and updated within 60 seconds. |
| **AC-3** | Changing a dimension weight in the admin UI triggers a full score recomputation and the updated score is reflected in the API within 2 minutes. |
| **AC-4** | When a project's composite score drops below a configured alert threshold, a notification is delivered to all configured channels within 5 minutes of the score update. |
| **AC-5** | Score history for a project can be queried for any 12-month window and returns results in under 2 seconds for up to 10,000 data points. |
| **AC-6** | If a data source connector fails, the engine completes score computation using stale data and marks the affected dimensions with a `stale` flag — no unhandled errors are returned to the API consumer. |
| **AC-7** | Given the same input data snapshot, two separate score computation runs produce identical output scores (determinism check). |
| **AC-8** | A `Viewer` role user cannot access scoring rule configurations or connector settings; any attempt returns HTTP 403. |
| **AC-9** | The system sustains scoring computation for 500 concurrent projects with p95 computation time under 30 seconds per project under load test conditions. |
| **AC-10** | All scoring rule changes are captured in an immutable audit log accessible to `Admin` users. |

---

## Out of Scope

- **Predictive / ML scoring**: AI-based forecasting of future project health is deferred to a future phase.
- **Automated remediation**: The engine surfaces scores and alerts only; it does not take corrective actions in source systems.
- **Natural language report generation**: Prose summaries or executive narrative reports are a future phase.
- **Custom connector SDK (public)**: Third-party developers building their own connectors is a future phase; v1 supports only the built-in connectors listed in FR-1.1.
- **Mobile native apps**: iOS and Android applications are out of scope for v1.
- **Billing, licensing, and subscription management**: Handled by a separate platform service.
- **Single sign-on (SSO) / SAML integration**: Deferred to v1.1; v1 supports JWT-based auth only.
- **Real-time collaborative editing of scoring rules**: Rule configuration is single-user write with optimistic locking only.
- **Data export in formats beyond JSON/CSV**: PDF or Excel exports are a future enhancement.