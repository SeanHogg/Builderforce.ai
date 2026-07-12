> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #289
> _Each agent that updates this PRD signs its change below._

# PRD: Data Ingestion Inventory & Visibility

## Problem & Goal

Engineering teams using the platform lack a clear, real-time view of what data has been successfully ingested across the four core event types — commits, pull requests, incidents, and deploys. This creates debugging friction, reduces trust in downstream metrics, and makes it difficult to validate that integrations (GitHub, GitLab, PagerDuty, etc.) are working correctly.

**Goal:** Provide a queryable, auditable inventory of all ingested data so that users can instantly confirm what data exists in the system, when it arrived, and from which source.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Engineering Manager** | Confirm team activity is being captured before reviewing DORA metrics |
| **DevOps / Platform Engineer** | Debug missing deploys or incidents from a specific pipeline/tool |
| **Developer** | Verify their commits and PRs are attributed correctly |
| **Admin / Integration Owner** | Audit source integrations and detect ingestion gaps or failures |

---

## Scope

This PRD covers the **read-side inventory** of the following ingested event types:

- `commits`
- `pull_requests`
- `incidents`
- `deploys`

It covers surfacing what has been ingested — counts, time ranges, source attribution, and record-level inspection — but does **not** cover re-ingestion workflows or integration configuration.

---

## Functional Requirements

### FR-1 — Ingestion Summary Dashboard
- Display a summary count of ingested records per event type (`commits`, `pull_requests`, `incidents`, `deploys`).
- Summary must be filterable by:
  - **Time range** (last 7d / 30d / 90d / custom)
  - **Repository** (for commits and PRs)
  - **Service / environment** (for deploys and incidents)
  - **Integration source** (e.g., GitHub, GitLab, PagerDuty, CircleCI)

### FR-2 — Per-Event-Type Record List
- Each event type exposes a paginated list of ingested records.
- Each record displays:

  | Event Type | Key Fields |
  |---|---|
  | **Commit** | SHA, author, repo, branch, timestamp, integration source |
  | **Pull Request** | PR ID, title, author, repo, state, opened_at, merged_at, integration source |
  | **Incident** | Incident ID, title, severity, service, started_at, resolved_at, integration source |
  | **Deploy** | Deploy ID, service, environment, status, deployed_at, triggered_by, integration source |

### FR-3 — Search & Filter
- Full-text search within each event type (e.g., by PR title, commit SHA, incident title).
- Filter by author / deployer / assignee.
- Filter by date range on the primary timestamp field.

### FR-4 — Ingestion Timeline / Volume Chart
- Time-series chart showing ingestion volume per event type over the selected date range.
- Ability to overlay all four event types on one chart or view individually.
- Visible gaps in the timeline must be visually distinct (zero-count buckets rendered, not omitted).

### FR-5 — Record-Level Detail View
- Clicking any record opens a detail panel or page showing the full raw payload as received, plus normalized fields and the ingestion timestamp (`ingested_at`).
- Display the originating webhook or API call metadata (source IP redacted, event type header, delivery ID where available).

### FR-6 — Ingestion Health Indicators
- Each integration source displays a status badge:
  - `Healthy` — events received within the expected window
  - `Stale` — no events received in > 24 hours (configurable threshold)
  - `Error` — last delivery attempt returned a non-2xx or parsing failure
- Last-event timestamp shown per source.

### FR-7 — Export
- Allow CSV export of the filtered record list for each event type (up to 10,000 rows).
- Export must include all fields shown in FR-2.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | Summary counts match the actual record counts returned by the paginated list for the same filter set. |
| AC-2 | A commit ingested via webhook appears in the commits list within 60 seconds of delivery. |
| AC-3 | Filtering by repository correctly excludes events from other repositories with zero false positives. |
| AC-4 | A source with no events in > 24 hours displays the `Stale` badge without manual refresh. |
| AC-5 | The timeline chart renders zero-count buckets as flat segments, not gaps in the line. |
| AC-6 | Clicking a record displays the original raw payload and the `ingested_at` timestamp. |
| AC-7 | CSV export for 10,000 rows completes in < 30 seconds and column headers match FR-2 field names. |
| AC-8 | All four event types are accessible to any authenticated user with at least `viewer` role; raw payload is restricted to `admin` role. |

---

## Out of Scope

- **Re-ingestion / backfill workflows** — triggering a re-sync from an integration is a separate feature.
- **Integration setup or credential management** — covered by the Integrations Configuration PRD.
- **Alerting / notifications on ingestion failures** — covered by the Observability & Alerting PRD.
- **Data deletion or retention policy enforcement** — governed by the Data Retention PRD.
- **Real-time streaming view** (live tail of incoming events) — deferred to a future iteration.
- **Cross-team or org-level aggregation** — this PRD covers single-team scope only.