> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #312
> _Each agent that updates this PRD signs its change below._

# PRD: Engineering Health Intelligence Ingestion Pipeline

## Problem & Goal

Engineering leaders lack a unified, real-time view of team health and delivery performance. Metrics live in siloed tools (Jira, GitHub, CI/CD platforms, PagerDuty, etc.), forcing manual aggregation that is slow, error-prone, and too infrequent to drive timely decisions.

**Goal:** Build a reliable ingestion pipeline that continuously collects, normalizes, and stores eight core engineering health signals so that downstream analytics, alerting, and reporting agents operate on a single, authoritative data layer.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| VP / Director of Engineering | Portfolio-level health trends, capacity risk |
| Engineering Manager | Sprint health, team velocity, incident load |
| DevOps / Platform Engineer | Build stability, deployment frequency, pipeline regression |
| Product Manager | Backlog throughput, release confidence |
| SRE / On-Call Lead | Incident count, severity trends, MTTR correlation |

---

## Scope

### In Scope

- Ingestion of the eight defined metric domains (see Functional Requirements)
- Adapters for the primary source systems most commonly used across target companies
- Normalization into a canonical internal schema
- Incremental / event-driven ingestion with configurable polling fallback
- Storage into a time-series-aware data store with raw + normalized layers
- Basic data-quality validation and dead-letter handling
- Metadata tagging: team, service, environment, time window

### Out of Scope *(see full section below)*

---

## Functional Requirements

### FR-1 — Task Backlog Ingestion
- Pull open, in-progress, and closed work items from configured project management tools (Jira, Linear, GitHub Issues, Azure DevOps).
- Capture: item ID, type, status, priority, story points / effort estimate, age, sprint/iteration, assignee team.
- Support backlog snapshot (daily) and delta (on item state change via webhook).

### FR-2 — Bug Count / Severity / Trend Ingestion
- Identify and extract items tagged or typed as defects/bugs.
- Capture: severity/priority level (P0–P3 or equivalent), status, created date, resolved date, linked service/component.
- Compute rolling trend windows (7-day, 30-day) at ingestion time and store alongside raw counts.

### FR-3 — PR Cycle Time Ingestion
- Connect to version control platforms (GitHub, GitLab, Bitbucket, Azure Repos).
- Capture per-PR: created\_at, first\_review\_at, approved\_at, merged\_at, closed\_at, author team, target branch, lines changed, review count.
- Derive cycle time sub-metrics: time-to-first-review, review duration, merge lag.

### FR-4 — Build Failure Rate Ingestion
- Integrate with CI platforms (GitHub Actions, Jenkins, CircleCI, GitLab CI, Buildkite).
- Capture per build: pipeline name, trigger type, status (success/failure/cancelled), duration, failure stage, commit SHA, branch, team owner.
- Calculate rolling failure rate (failures / total runs) per pipeline per time window.

### FR-5 — Deployment Frequency Ingestion
- Connect to CD platforms and release tooling (ArgoCD, Spinnaker, Harness, deployment webhooks, GitHub Releases).
- Capture: deploy timestamp, environment (dev/staging/prod), service, version/tag, initiator (human vs. automated), outcome.
- Aggregate to hourly, daily, and weekly frequency metrics per service and environment.

### FR-6 — Incident Count Ingestion
- Integrate with incident management tools (PagerDuty, OpsGenie, Firehydrant, Statuspage).
- Capture: incident ID, severity/SEV level, start time, acknowledged time, resolved time, impacted services, owning team, postmortem link.
- Derive MTTR and MTTA at ingestion time.

### FR-7 — Team Velocity Ingestion
- Extract completed story points or ticket counts per sprint/iteration from project management tools (FR-1 source systems).
- Capture: team, sprint ID, sprint dates, planned points, completed points, carry-over points, scope change delta.
- Store both per-sprint snapshots and rolling 3-sprint and 6-sprint averages.

### FR-8 — Resource Allocation Ingestion
- Pull allocation data from HRIS, workforce planning tools, or structured configuration (headcount files, Org charts, Workday, Lattice, or static YAML manifests).
- Capture: person ID (anonymized/pseudonymized), team, role/level, allocation percentage per project or workstream, effective date range.
- Flag allocation gaps or over-allocation breaches (>100%) at ingestion time.

### FR-9 — Normalization & Schema
- All ingested records must be mapped to a canonical `EngHealthRecord` envelope:
  - `record_id`, `source_system`, `metric_domain`, `team_id`, `service_id`, `environment`, `event_timestamp`, `ingested_at`, `raw_payload` (JSON), `normalized_fields` (domain-specific typed object), `data_quality_flags[]`
- Schema versioning must be maintained; breaking changes require a new schema version.

### FR-10 — Data Quality & Error Handling
- Validate required fields; flag missing or out-of-range values without dropping records.
- Route malformed or unprocessable records to a dead-letter queue with full payload and error reason.
- Emit a data-quality score (0–1) per record and per ingestion run.
- Alert on-call pipeline owner when error rate for any domain exceeds 5% over a 15-minute window.

### FR-11 — Ingestion Orchestration
- Support webhook/event-driven ingestion as the primary mode.
- Provide configurable polling schedules (cron) as fallback per source.
- Guarantee at-least-once delivery with idempotency keys to prevent duplicate records in the store.
- Provide a manual backfill API for historical data loads with configurable date ranges.

### FR-12 — Observability
- Expose ingestion lag, throughput, error rate, and record count per domain as metrics (Prometheus-compatible).
- Structured logs per ingestion event (source, domain, record count, latency, errors).
- Distributed tracing support (OpenTelemetry) across adapters and normalization stages.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | All eight metric domains successfully ingest records from at least one reference source system per domain in the staging environment. |
| AC-2 | End-to-end latency from source event to normalized record in the data store is ≤ 60 seconds for webhook-triggered ingestion under normal load. |
| AC-3 | Polling fallback operates within ±10% of the configured schedule interval. |
| AC-4 | Zero records are silently dropped; all failures appear in the dead-letter queue with error context within 30 seconds of failure detection. |
| AC-5 | Duplicate source events produce exactly one normalized record in the store (idempotency verified by replaying 1,000 synthetic duplicate events). |
| AC-6 | All normalized records conform to the `EngHealthRecord` schema; schema validation pass rate ≥ 99.9% on a 30-day production sample. |
| AC-7 | Data-quality alerts fire within 2 minutes when the injected error rate exceeds the 5% threshold in integration tests. |
| AC-8 | Derived metrics (bug trend, PR sub-times, build failure rate, MTTR, velocity averages) match manual calculations within ±0.5% tolerance on a reference dataset of ≥ 500 records per domain. |
| AC-9 | Backfill API successfully loads 12 months of historical data per domain without duplication, completing within an SLA defined per domain in the runbook. |
| AC-10 | All ingestion metrics are visible in the Prometheus-compatible endpoint; a reference Grafana dashboard shows live data within 5 minutes of pipeline start. |
| AC-11 | Resource allocation records pseudonymize person identifiers; no PII appears in logs, traces, or the normalized layer. |
| AC-12 | Pipeline recovers automatically from a simulated source-system outage (connection refused) within 3 retry attempts using exponential backoff, then parks work in the dead-letter queue. |

---

## Out of Scope

- **Analytics, scoring, or benchmarking** of ingested data — responsibility of downstream agents.
- **Alerting to end users** based on metric thresholds (beyond internal pipeline health alerts in FR-10).
- **UI or dashboards** beyond the reference Grafana observability panel.
- **Source system write-back** (e.g., updating Jira tickets, closing PagerDuty incidents).
- **Custom metric domains** beyond the eight defined above in v1.
- **Real-time streaming to end-user clients** (WebSocket / SSE delivery layer).
- **Cost or financial data** ingestion (e.g., cloud spend, tooling licenses).
- **Performance/load testing tooling** infrastructure — assumed provided by the platform team.
- **Data retention policy enforcement** — handled by the storage layer operator.
- **Authentication / SSO for human users** — pipeline runs as a service account; no human login surface in this scope.