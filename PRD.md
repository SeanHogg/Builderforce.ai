> **PRD** — drafted by Ada (Sr. Product Mgr) · task #554
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Datadog Monitor State & Events Ingest

## Problem & Goal
Operators currently lack a unified view of Datadog monitor alerts within our internal incident management system. Alert state changes (triggered/recovered) must be manually correlated, leading to delayed response and incomplete audit trails.

**Goal:** Automatically ingest active Datadog monitor states and alert transition events (triggered, recovered), map them to internal incident records with `source=datadog`, and keep the incident timeline current.

## Target Users / ICP Roles
- **Incident Responders (SRE, On-call Engineers):** Need real-time, auto-populated incidents from Datadog monitors.
- **Incident Commanders:** Require accurate timeline and status for Datadog-sourced incidents.
- **NOC / Operations Analysts:** Rely on consistent incident records across monitoring sources.

## Scope
- Poll Datadog Monitor API for active monitor states (overall state `Alert`, `Warn`, `No Data`).
- Receive and process Datadog Event webhooks/stream for `alert` (triggered) and `recovery` events.
- Map monitor and event data to internal incident format with mandatory `source=datadog`.
- Deduplicate incidents by monitor ID and maintain idempotent state transitions.
- Cover functional requirements **FR-1.3** and **FR-1.4**, acceptance criteria **AC-DD-2** and **AC-DD-4**.

## Functional Requirements

### FR-1: Monitor State Polling
- **FR-1.1:** Poll `GET /api/v1/monitor` every 60 seconds (configurable) with `monitor_type` filter; retrieve monitors in state `Alert`, `Warn`, or `No Data`.
- **FR-1.2:** Respect Datadog rate limits and page through results.
- **FR-1.3:** For each active monitor, upsert an internal incident record keyed by `datadog_monitor_id` with `source=datadog`, `status` mapped from monitor state, and `title`, `severity`, `tags` extracted from monitor definition.
- **FR-1.4:** When a monitor state transitions to `OK` during a subsequent poll, close the associated incident if it exists.

### FR-2: Event Ingestion
- **FR-2.1:** Accept Datadog Event payloads (via webhook or event stream integration) for event types `metric_alert_monitor` and `recovery`.
- **FR-2.2:** Parse event `alert_type` (`error`, `warning`, `info`, `success`) and `event_type`.
- **FR-2.3:** On `triggered` alert event, create incident if it does not exist; append event details to incident timeline.
- **FR-2.4:** On `recovered` event, mark matching incident as resolved with resolution reason and timestamp from the event.

### FR-3: Data Mapping & Deduplication
- **FR-3.1:** Always set `source=datadog` in the internal incident record.
- **FR-3.2:** Use `datadog_monitor_id` as the deduplication key; if an open incident already exists, update rather than duplicate.
- **FR-3.3:** Map Datadog `overall_state` to internal incident statuses (`alert` → `open`, `warn` → `open`, `no data` → `open`, `ok` → `resolved`).
- **FR-3.4:** Preserve raw payload in incident metadata for auditing.

### FR-4: Idempotency & Error Handling
- **FR-4.1:** Event processing must be idempotent based on `event_id`.
- **FR-4.2:** Log and retry recoverable API failures (network, 5xx) with exponential backoff; surface persistent failures to operational dashboards.

## Acceptance Criteria

- **AC-DD-2:** When a Datadog monitor enters `Alert`, `Warn`, or `No Data`, an internal incident is created or updated within 90 seconds of state change with `source=datadog` and correct status mapping.
- **AC-DD-4:** When a Datadog monitor recovers to `OK`, the corresponding incident is automatically resolved within 90 seconds, and the resolution event is logged in the incident timeline.
- **AC-1:** Duplicate events or overlapping poll results do not create duplicate incidents for the same `datadog_monitor_id`.
- **AC-2:** Event webhook delivery errors (4xx client errors) are logged and not replayed; malformed payloads do not crash the ingestion pipeline.

## Out of Scope
- Synthetics, SLO, or Log Monitor alert types beyond standard metric/query monitors.
- User-interface changes to the incident management dashboard.
- Historical backfill of Datadog states prior to go-live.
- Correlation or grouping of multiple Datadog monitors into a single incident.
- Bi-directional sync (updating Datadog monitor state from internal incident actions).

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._