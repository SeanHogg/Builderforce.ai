> **PRD** — drafted by Ada (Sr. Product Mgr) · task #559
> _Each agent that updates this PRD signs its change below._

# Incident Fields, Query & Export API PRD

## Problem & Goal
Incident records currently lack essential operational metadata and structured access. Operations teams, SREs, and incident commanders cannot efficiently search, filter, or export incident data enriched with PagerDuty context, hindering post-incident reviews, trend analysis, and compliance reporting.

**Goal:** Provide a complete, queryable, and exportable incident data store with a 90-day retention window. Ensure every incident record is automatically populated with PagerDuty severity/urgency, assigned responders, service name, and timestamps (created/updated/resolved). Expose a filterable query API and support JSON/CSV export.

## Target Users / ICP Roles
- Incident Commanders & SREs: need fast lookup of active/past incidents with operational context.
- Operations Analysts: require batch export for trend analysis and reporting.
- Compliance & Audit personnel: rely on complete, timestamped records for review.

## Scope
Covers functional requirements FR-3.1 through FR-3.5 and acceptance criteria AC-INC-1, AC-INC-2, AC-INC-3.

- **In Scope:**
  - Automated enrichment of incident records with PagerDuty fields.
  - Structured incident record schema with all required fields.
  - Query API with filtering capabilities.
  - Export endpoint supporting JSON and CSV formats.
  - 90-day data retention policy with automated pruning.
- **Out of Scope:**
  - Real-time streaming or webhook delivery of incident data.
  - Customizable retention periods beyond 90 days.
  - UI dashboard or visualization layer.
  - Historical backfill of incidents created before this feature launch.

## Functional Requirements

### FR-3.1 Incident Field Population
- Upon incident creation, the system MUST fetch and store the following fields from the associated PagerDuty incident:
  - Severity
  - Urgency
  - Assigned responder(s) (user(s) or escalation policy)
  - Service name
  - Created timestamp
  - Updated timestamp (initially equal to created timestamp)
  - Resolved timestamp (null until incident resolves)
- Field population SHALL be atomic per incident; all fields must be populated or the record creation must fail.

### FR-3.2 Incident Record Schema
- Every incident record SHALL include, at minimum:
  - Incident ID (internal)
  - PagerDuty incident ID
  - Severity
  - Urgency
  - Assigned responder(s)
  - Service name
  - Status (triggered, acknowledged, resolved)
  - `created_at` (ISO 8601)
  - `updated_at` (ISO 8601)
  - `resolved_at` (ISO 8601, nullable)

### FR-3.3 Query API
- Expose a `GET /incidents` endpoint that supports case-insensitive filtering on:
  - Status
  - Severity
  - Urgency
  - Service name
  - Assigned responder
  - Date range (created/updated/resolved)
- API MUST support pagination via `limit` and `offset` (or `page_token`).
- API responses SHALL be JSON.

### FR-3.4 Export API
- Expose `POST /incidents/export` accepting the same filter parameters as the query API.
- Support `Accept` header or query parameter (`format`) for:
  - `application/json` → JSON array of incident objects.
  - `text/csv` → CSV with column headers matching record schema.
- Export MUST apply the same retention window.

### FR-3.5 90-Day Retention
- Incidents with `created_at` older than 90 days from the current date MUST be automatically removed from the operational data store.
- The pruning process SHALL run at least daily and log the count of deleted records.
- Query and export endpoints MUST only return incidents within the 90-day window.

## Acceptance Criteria

### AC-INC-1: Full Field Population
- **Given** a new PagerDuty incident is created, **when** the incident record is ingested, **then** all required fields (severity, urgency, responder(s), service name, created/updated timestamp) are populated and resolvable via the Query API within 60 seconds.

### AC-INC-2: Filterable Query API
- **Given** multiple incident records with varying severities and services, **when** a user queries with `?service=payment-api&severity=critical`, **then** only matching incidents are returned.
- **When** a user queries with an invalid filter key or unsupported date format, **then** the API responds with `400 Bad Request` and an actionable error message.

### AC-INC-3: JSON/CSV Export
- **Given** a set of incidents matching a filter, **when** an export request is made with `format=csv`, **then** the response is a valid CSV with headers and data corresponding to the incident schema.
- **When** an export request is made without an explicit format, **then** the default response is JSON.

## Out of Scope
- Real-time notifications (e.g., webhooks) for incident updates.
- Configurable data retention; only 90 days is supported.
- End-user UI for query or export beyond API.
- Data residency or multi-region replication configurations.

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