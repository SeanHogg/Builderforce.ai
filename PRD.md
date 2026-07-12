> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #332
> _Each agent that updates this PRD signs its change below._

# PRD: Last Sync Timestamp

## Problem & Goal

Users and system operators have no reliable, visible indicator of when data was last successfully synchronized between the client and the backend (or between integrated services). This creates uncertainty about data freshness, makes debugging stale-data issues difficult, and erodes trust in the application's reliability.

**Goal:** Record, persist, and surface the last successful sync timestamp throughout the product so that users can confirm data recency and engineers/support can diagnose sync failures quickly.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **End user** | Glanceable confirmation that their data is current |
| **Power user / admin** | Precise timestamp + sync status for auditing and troubleshooting |
| **Support / ops engineer** | Queryable sync metadata to diagnose incidents |
| **Frontend developer** | Stable API contract to render timestamp in UI |
| **Backend / data engineer** | Clear storage and update requirements for sync events |

---

## Scope

This PRD covers:

- Capturing and persisting the timestamp of the last successful sync event
- Exposing the timestamp via an internal API endpoint
- Displaying the timestamp in the relevant UI surface(s)
- Handling edge cases: never-synced state, sync in progress, sync failure

---

## Functional Requirements

### 1. Timestamp Capture & Storage

- **FR-1.1** The system **must** record an ISO 8601 UTC timestamp (`last_synced_at`) immediately after each successful sync operation completes.
- **FR-1.2** The timestamp **must** be persisted in the primary datastore, scoped to the appropriate entity (user, account, workspace, or integration — whichever is the sync unit).
- **FR-1.3** A sync failure **must not** overwrite the existing `last_synced_at` value.
- **FR-1.4** The system **must** separately record a `last_sync_attempted_at` timestamp and a `last_sync_status` field (`success | failure | in_progress`) to distinguish recency from health.
- **FR-1.5** Timestamps **must** be stored and transmitted in UTC; conversion to local time is the responsibility of the display layer.

### 2. API

- **FR-2.1** A GET endpoint **must** return `last_synced_at`, `last_sync_attempted_at`, and `last_sync_status` for the authenticated entity.
- **FR-2.2** If no sync has ever occurred, the API **must** return `last_synced_at: null` (not a zero-value date).
- **FR-2.3** The endpoint **must** respond within 200 ms at p95 under normal load.
- **FR-2.4** The endpoint **must** be authenticated and scoped — users **must not** be able to query sync state for entities they do not own or administer.

### 3. UI Display

- **FR-3.1** The relevant UI surface (dashboard header, settings panel, or data table) **must** display a human-readable relative time string (e.g., *"Last synced 3 minutes ago"*) derived from `last_synced_at`.
- **FR-3.2** Hovering or tapping the relative time **must** reveal the full absolute timestamp in the user's local timezone.
- **FR-3.3** When `last_synced_at` is `null`, the UI **must** display *"Never synced"* or equivalent copy — never a blank or raw null.
- **FR-3.4** When `last_sync_status` is `in_progress`, the UI **must** display a loading/syncing indicator instead of the stale timestamp.
- **FR-3.5** When `last_sync_status` is `failure`, the UI **must** display a warning state (e.g., amber icon + *"Sync failed · Last successful sync X ago"*).
- **FR-3.6** The displayed timestamp **must** auto-refresh at a maximum interval of 60 seconds without requiring a full page reload.

### 4. Logging & Observability

- **FR-4.1** Every sync completion and failure **must** emit a structured log event containing the entity ID, sync type, status, and timestamp.
- **FR-4.2** A monitoring alert **must** fire if `last_synced_at` for any active entity exceeds the configured staleness threshold (default: 2× the expected sync interval).

---

## Acceptance Criteria

| ID | Criterion |
|---|---|
| **AC-1** | After a successful sync, `last_synced_at` in the datastore is updated within 2 seconds of sync completion. |
| **AC-2** | After a failed sync, `last_synced_at` retains its previous value; `last_sync_status` is set to `failure`. |
| **AC-3** | GET sync-status API returns HTTP 200 with correct fields in < 200 ms at p95. |
| **AC-4** | Unauthenticated requests to the sync-status endpoint return HTTP 401. |
| **AC-5** | UI shows *"Never synced"* for a brand-new entity that has never completed a sync. |
| **AC-6** | UI shows the syncing indicator while a sync is actively `in_progress`. |
| **AC-7** | UI shows the warning state within one auto-refresh cycle (≤ 60 s) after a sync failure is recorded. |
| **AC-8** | Hovering the relative-time string reveals the correct absolute local-timezone timestamp. |
| **AC-9** | Structured log events are emitted for every sync completion and every sync failure with required fields. |
| **AC-10** | Staleness alert fires in the monitoring system when threshold is exceeded for an active entity. |

---

## Out of Scope

- Triggering or scheduling sync operations (covered by the sync engine PRD)
- Detailed sync error messages or error-code enumeration (covered by error-handling PRD)
- Historical sync log UI / audit trail beyond the single last-sync record
- Per-field or per-record granular sync status
- Real-time push/WebSocket delivery of timestamp updates (polling interval satisfies v1)
- Multi-region timestamp conflict resolution
- User-configurable staleness thresholds (ops-configured only in v1)