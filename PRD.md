> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #309
> _Each agent that updates this PRD signs its change below._

# PRD: Historical Health Snapshots for Comparison

## Problem & Goal

Users and operators currently have no way to compare system or application health metrics across different points in time. Diagnosing regressions, validating deployments, and identifying degradation trends requires manual cross-referencing of logs or live dashboards — a slow, error-prone process. This feature introduces **historical health snapshots**: point-in-time captures of key health indicators that can be retrieved, listed, and diff'd against each other or against the current state, enabling fast, confident comparisons.

---

## Target Users / ICP Roles

| Role | Primary Need |
|---|---|
| **Site Reliability Engineer (SRE)** | Correlate health changes with deployment events; validate rollbacks |
| **DevOps / Platform Engineer** | Monitor long-term health trends; detect configuration drift |
| **Backend Developer** | Compare pre/post-deploy health to confirm a fix or identify a new regression |
| **Engineering Manager** | Review historical uptime and reliability reports for a service |

---

## Scope

This document covers the MVP of historical health snapshot capture, storage, retrieval, and comparison. It does not address alerting, anomaly detection, or predictive analytics (see Out of Scope).

---

## Functional Requirements

### FR-1 — Snapshot Capture

- **FR-1.1** The system must automatically capture a health snapshot at a configurable interval (default: every 5 minutes).
- **FR-1.2** The system must allow users to trigger a manual snapshot on demand via API call or UI action.
- **FR-1.3** Each snapshot must capture the following data points at minimum:
  - Timestamp (UTC, ISO 8601)
  - Overall health status (`healthy`, `degraded`, `unhealthy`)
  - Per-component / per-service status with individual status codes
  - Response latency (p50, p95, p99) per component
  - Error rate (%) per component
  - Resource utilization (CPU %, memory %, disk %) where applicable
  - Active incident or alert count
  - Software version / build identifier of the monitored system
- **FR-1.4** Snapshots must be labeled with a source (`scheduled`, `manual`, `deployment-hook`).
- **FR-1.5** Deployment events (CI/CD webhook) must optionally trigger an automatic snapshot tagged with the deployment ID, environment, and commit SHA.

### FR-2 — Snapshot Storage & Retention

- **FR-2.1** Snapshots must be stored in a queryable, append-only data store.
- **FR-2.2** Default retention policy: 90 days for full-resolution snapshots; configurable per environment (min 1 day, max 2 years).
- **FR-2.3** Snapshots older than the retention window must be automatically purged or archived to cold storage.
- **FR-2.4** Each snapshot must have a unique, stable identifier (UUID).
- **FR-2.5** Storage must support at least 10,000 snapshots per monitored service without performance degradation.

### FR-3 — Snapshot Retrieval

- **FR-3.1** Users must be able to list snapshots for a given service, filterable by:
  - Time range (start/end timestamp)
  - Source type (`scheduled`, `manual`, `deployment-hook`)
  - Health status
  - Environment (e.g., `production`, `staging`)
- **FR-3.2** Users must be able to retrieve a single snapshot by its UUID.
- **FR-3.3** The API must return paginated results (default page size: 50, max: 200).
- **FR-3.4** Snapshot data must be retrievable in JSON format; CSV export must be supported for list views.

### FR-4 — Snapshot Comparison

- **FR-4.1** Users must be able to compare any two snapshots by providing two snapshot UUIDs.
- **FR-4.2** Users must be able to compare any historical snapshot against the current live health state.
- **FR-4.3** A comparison result must include:
  - Delta values for all numeric metrics (absolute and percentage change)
  - Status change indicators (`healthy → degraded`, etc.) per component
  - Components added or removed between the two snapshots
  - Version / build identifier diff
  - Human-readable summary of significant changes (threshold-based: >10% change in any metric flagged as significant by default; threshold configurable)
- **FR-4.4** The comparison must be accessible via API (`GET /snapshots/compare?base={id}&target={id}`) and via the UI diff view.
- **FR-4.5** The UI diff view must use color coding: green for improvement, red for degradation, gray for no meaningful change.

### FR-5 — UI / Dashboard

- **FR-5.1** A **Snapshot History** timeline view must display snapshots chronologically for a selected service and time range.
- **FR-5.2** Users must be able to select two snapshots from the timeline and invoke a side-by-side diff view.
- **FR-5.3** Deployment event markers must be overlaid on the timeline when deployment-hook snapshots are present.
- **FR-5.4** Each snapshot entry must display: timestamp, source, overall health status badge, and version identifier.
- **FR-5.5** The diff view must be shareable via a permalink URL that encodes the two snapshot IDs.

### FR-6 — Access Control

- **FR-6.1** Snapshot read access must respect existing role-based access control (RBAC); users may only access snapshots for services within their permitted scope.
- **FR-6.2** Manual snapshot creation must require at minimum the `operator` role.
- **FR-6.3** Snapshot deletion (outside of automated retention) must require the `admin` role.

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| AC-1 | A scheduled snapshot is created automatically within ±30 seconds of the configured interval with all required fields populated. |
| AC-2 | A manual snapshot triggered via API responds with `201 Created` and returns the full snapshot payload including its UUID within 3 seconds. |
| AC-3 | A deployment-hook snapshot is created and tagged with the correct deployment ID and commit SHA within 60 seconds of the webhook event. |
| AC-4 | Listing snapshots with a time-range filter returns only snapshots whose timestamps fall within the specified range, with correct pagination metadata. |
| AC-5 | A comparison of two valid snapshot UUIDs returns delta values for all numeric fields and status-change indicators for all components within 2 seconds. |
| AC-6 | A comparison against the live state reflects health data no older than 30 seconds at the time of the API call. |
| AC-7 | The UI timeline renders up to 500 snapshot markers without a measurable frame drop (< 16 ms render budget per frame) in modern browsers (Chrome, Firefox, Safari latest stable). |
| AC-8 | The diff view permalink, when opened by a user with appropriate permissions, renders the correct comparison without requiring re-selection of snapshots. |
| AC-9 | Snapshots beyond the configured retention window are purged or archived within 24 hours of expiry. |
| AC-10 | A user without `operator` role receives `403 Forbidden` when attempting to create a manual snapshot via API. |
| AC-11 | CSV export of a filtered snapshot list contains all listed columns and matches the JSON response data exactly. |
| AC-12 | System sustains 10,000 stored snapshots per service with list query p99 latency under 500 ms. |

---

## Out of Scope

- **Alerting & notifications** based on snapshot deltas (future phase)
- **Anomaly detection or ML-based trend analysis** on snapshot data
- **Metric forecasting or predictive health scoring**
- **Custom metric ingestion** beyond the defined standard health data points in FR-1.3 (plugin system is a future phase)
- **Real-time streaming** of health data; snapshots are discrete point-in-time captures only
- **Cross-service / dependency-graph comparison** (comparing service A health vs. service B health)
- **Mobile application** UI support
- **Billing or usage metering** tied to snapshot volume or retention duration
- **Migration tooling** for importing historical data from third-party monitoring systems