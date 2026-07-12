> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #257
> _Each agent that updates this PRD signs its change below._

# PRD: Data Ingestion — Initial Sync, Progress, and Gap Flagging

## Problem & Goal

New users and integrations land in the product with no data. Without a clear, guided ingestion flow, they experience a blank-state UI, have no visibility into how long sync will take, and cannot tell when data is missing or incomplete. The goal is to provide a reliable, transparent initial data sync experience that (1) triggers ingestion automatically or on demand, (2) surfaces real-time progress, and (3) proactively flags data gaps so users can take corrective action before they rely on incomplete data.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Admin / Integration Owner** | Trigger sync, monitor health, resolve gaps |
| **Analyst / Power User** | Understand data completeness before running queries or reports |
| **Developer / Implementer** | Confirm API/connector is wired correctly; debug failures |
| **End User (read-only)** | Know whether the data they are viewing is current and complete |

---

## Scope

### In Scope
- Initial sync trigger (automatic on connection + manual re-trigger)
- Real-time and polling-based progress display
- Gap detection and flagging at the field, record, and time-range level
- Notifications (in-app and email) for sync completion and gap alerts
- Sync history log accessible to Admins

### Out of Scope
- Incremental / scheduled recurring sync logic *(separate PRD)*
- Transformation or normalization of ingested data *(downstream pipeline concern)*
- Data quality scoring or anomaly detection beyond gap detection
- Multi-tenant / cross-workspace sync orchestration

---

## Functional Requirements

### FR-1 — Sync Trigger

| ID | Requirement |
|---|---|
| FR-1.1 | System automatically initiates an initial sync within 60 seconds of a new data source connection being successfully authenticated. |
| FR-1.2 | Admin users can manually trigger a full re-sync from the **Data Sources** settings page at any time. |
| FR-1.3 | Triggering a sync while one is already in progress must be blocked with a clear error message and estimated time-to-completion of the running sync. |
| FR-1.4 | Sync trigger events must be logged with actor identity, timestamp, and source type. |

### FR-2 — Progress Display

| ID | Requirement |
|---|---|
| FR-2.1 | A persistent progress indicator is shown globally (top-of-UI banner or sidebar badge) while a sync is active. |
| FR-2.2 | Progress must reflect: overall percentage complete, current stage (e.g., *Connecting*, *Fetching*, *Writing*, *Verifying*), records processed / total estimated records, and elapsed + estimated remaining time. |
| FR-2.3 | Progress state refreshes at least every 10 seconds without requiring a full page reload. |
| FR-2.4 | On sync completion the indicator transitions to a success state and remains visible for a minimum of 5 minutes before auto-dismissing. |
| FR-2.5 | On sync failure the indicator transitions to an error state with a plain-language message and a link to the detailed error log. |

### FR-3 — Gap Detection and Flagging

| ID | Requirement |
|---|---|
| FR-3.1 | After sync completes, the system compares ingested data against the source manifest or expected schema to identify: missing required fields, missing records within a declared date/ID range, and source-reported record counts that do not match ingested counts. |
| FR-3.2 | Each detected gap is classified by severity: **Critical** (data unusable), **Warning** (partial data present), **Info** (non-breaking omission). |
| FR-3.3 | Gaps are surfaced in a dedicated **Sync Report** panel accessible from the sync history log and from any data-source detail page. |
| FR-3.4 | Critical gaps trigger an in-app alert banner on any view that renders the affected dataset, with a direct link to the Sync Report. |
| FR-3.5 | The Sync Report must list per-gap: affected source, field/table/range, severity, description, suggested remediation action, and whether the gap is user-resolvable or requires support escalation. |
| FR-3.6 | Users can acknowledge (dismiss) Warning and Info gaps; Critical gaps cannot be dismissed until resolved or explicitly overridden by an Admin. |

### FR-4 — Notifications

| ID | Requirement |
|---|---|
| FR-4.1 | Admin and Integration Owner roles receive an in-app notification on sync completion (success or failure). |
| FR-4.2 | Admins may opt in to email notifications for sync completion and/or gap detection; opt-in defaults to **on** for Critical gaps, **off** for Warning/Info. |
| FR-4.3 | Notification content includes: source name, sync duration, record counts, count of gaps by severity, and a deep link to the Sync Report. |

### FR-5 — Sync History Log

| ID | Requirement |
|---|---|
| FR-5.1 | Every sync run is recorded with: run ID, source, trigger type (automatic/manual), start time, end time, status, records synced, and gap summary. |
| FR-5.2 | Log is paginated and retains entries for a minimum of 90 days. |
| FR-5.3 | Admins can export the log as CSV. |

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | Sync begins automatically within 60 s of new source authentication with no manual action required. | Automated integration test measuring trigger latency. |
| AC-2 | Progress indicator displays all four data points (stage, percentage, records, time) and updates within 10 s intervals throughout a live sync. | QA manual walkthrough + network trace confirming polling cadence. |
| AC-3 | When source record count minus ingested record count > 0, at least one gap entry appears in the Sync Report with correct severity classification. | Unit test with mocked source manifest returning known discrepancies. |
| AC-4 | A Critical gap causes an alert banner to render on every view that displays the affected dataset within one page navigation cycle. | QA scenario test across at minimum 3 affected views. |
| AC-5 | Attempting to trigger a sync while one is running returns an error state (not a 5xx) with time-to-completion copy visible to the user. | Automated test firing concurrent trigger requests. |
| AC-6 | Sync history log entry is written for 100% of sync runs, including failed runs that never completed ingestion. | Database assertion in CI post-integration test suite. |
| AC-7 | Admin receives in-app notification within 2 minutes of sync status change to success or failure. | End-to-end test with notification delivery timestamp assertion. |
| AC-8 | No Critical gap can be dismissed from the UI without Admin role; UI control is absent or disabled for non-Admin roles. | Role-based access QA with Analyst and End User accounts. |

---

## Out of Scope

- **Incremental / delta sync** — scheduled or event-driven recurring ingestion after the initial load.
- **Data transformation pipelines** — normalization, deduplication, or enrichment of ingested records.
- **Advanced anomaly detection** — statistical outlier detection, drift monitoring, or ML-based quality scoring.
- **Connector build tooling** — SDK or framework for authoring new source connectors.
- **Cross-workspace or multi-tenant orchestration** — syncing data across organizational boundaries.
- **Billing or usage metering** tied to ingestion volume.
- **Rollback or point-in-time restore** of ingested data.