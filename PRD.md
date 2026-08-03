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

_Authored by the business-analyst — each requirement is traceable to a functional requirement above._

---

### REQ-1: Datadog API Client

A dedicated HTTP client for the Datadog REST API (US and EU sites), shared by the poll path and available as a utility for any future Datadog-integration surface.

- **REQ-1.1 — Client configuration.** Construct the base URL from `DD_SITE` (default `datadoghq.com` → `https://api.datadoghq.com`; `datadoghq.eu` → `https://api.datadoghq.eu`). Authenticate every request with headers `DD-API-KEY` and `DD-APPLICATION-KEY` drawn from the tenant's integration-credentials store (same pattern as the existing `errorCollectorIntegrations` — an `integration_credentials` row with `provider='datadog'`, or a dedicated per-tenant secret on `board_connections`).

- **REQ-1.2 — Rate-limit awareness.** Before every call, check response headers `X-RateLimit-Remaining` / `X-RateLimit-Reset`. When remaining ≤ 2, sleep until `reset` epoch before issuing the next call. Log a warning when remaining hits 0 so the operations dashboard surfaces it (existing `alerts` / `alert_events` tables). Do NOT hard-fail on rate-limit headers being absent — some Datadog orgs have them off.

- **REQ-1.3 — Pagination.** Datadog returns page links in the response body (`meta.page`). Follow `next` links until exhausted. Cap total pages per sweep at 50 (a runaway guard — ~5,000 monitors at default page size).

- **REQ-1.4 — Retry policy.** On network error or 5xx, retry up to 3 times with exponential backoff (1s → 2s → 4s). On 4xx (except 429 rate-limit), log and stop — do not retry a malformed request. On 429, sleep until `X-RateLimit-Reset` and retry once.

---

### REQ-2: Monitor State Poll Sweep

A scheduled sweep that calls `GET /api/v1/monitor` for a configured tenant, iterates the returned monitors, and upserts or resolves incidents in `prod_incidents` via the existing `IncidentService`.

- **REQ-2.1 — Poll trigger.** Drive it from the existing board-sync cron sweep (`runSyncSweep` in `SyncEngine.ts`). It is a new branch in the poll loop: alongside the ITSM fork (`itsmIngest.forkIncidentsFromTickets`), add `datadogIngest.forkIncidentsFromMonitors` when the connection's `provider='datadog'`. This gives it cursor management, sync-log entries, and `last_polled_at` for free — a Datadog "connection" is a `board_connections` row with `provider='datadog'`, no board mapping required.

- **REQ-2.2 — Poll query.** Request monitors with `monitor_type` in `['metric alert','query alert','service check','event alert','process alert','trace-analytics alert','rum alert']`, excluding synthetic and SLO monitors (out of scope). Include `group_states=alert,warn,no data`. Do NOT pass `group_states=ok` — the poll only retrieves active monitors; the OK transition is detected locally (REQ-2.4).

- **REQ-2.3 — Incident upsert per monitor.** For each returned monitor:
  1. Extract `monitor.id` → `externalRef`. Call `IncidentService.openIncident()` with `source='datadog'`, `externalRef=<monitor.id>`, `title=<monitor.name>`.
  2. Map `monitor.overall_state` → incident status: `Alert`/`Warn`/`No Data` all open the incident; the severity is derived below.
  3. Extract `severity` from monitor tags: scan `monitor.tags[]` for `severity:sev1` through `severity:sev4`; if absent, map the Datadog monitor `priority` field (integer 1–5): 1→sev1, 2→sev2, 3→sev3, 4–5→sev4. If neither exists, default to `sev3`.
  4. Extract `affectedSystem` from monitor tags (`system:<name>`) or from the monitor `query` text via the existing `guessAffectedSystem()` heuristic.
  5. Stamp `externalUrl` with the monitor's Datadog permalink: `https://app.datadoghq.com/monitors/<monitor.id>`.
  6. The idempotency is guaranteed by `IncidentService.openIncident()`'s existing `findByExternal` guard on `(source, externalRef)`.

- **REQ-2.4 — OK transition (recovery by poll).** Maintain a local in-memory set (per sweep — or a lightweight cache keyed by connection) of monitor IDs seen as active in the prior sweep. For each monitor that was active in the prior sweep but is absent in the current sweep's results (or returned with `overall_state=OK` when `group_states=all` is optionally used), call `IncidentService.updateIncident()` to set `status='resolved'` with an `actorRef='datadog'`. Append a timeline event (`addEvent` with `kind='resolved'`): "Monitor recovered to OK (via poll sweep)". This is the poll-path complement to the webhook recovery path (REQ-4.3).

- **REQ-2.5 — Poll delta tracking.** Store the set of active monitor IDs from the last poll on the `board_connections` row (a JSONB `poll_state` column, or a dedicated key-value row in `sync_log`). This is how the next sweep knows which monitors disappeared. If no prior poll state exists (cold start / first sweep), skip the OK-transition step — do not resolve incidents we never knew about.

---

### REQ-3: Datadog Event Webhook Endpoint

A public HTTP endpoint that receives Datadog Event webhook POSTs, verifies them, and maps alert/recovery events into incident operations.

- **REQ-3.1 — Route and verification.** Expose `POST /api/webhooks/datadog/events` (or a per-connection path like `/api/webhooks/boardsync/<connectionId>/datadog` — follow the existing boardsync webhook routing convention). Verify the payload with HMAC-SHA256 using the shared webhook secret stored on the connection, reusing `verifyProviderWebhookSignature()` from `webhookIngest.ts` (add a `'datadog'` case there if it does not exist, or use the generic `sha256=<hex>` path).

- **REQ-3.2 — Payload validation.** Require `event_type` to be one of `['metric_alert_monitor', 'query_alert_monitor', 'service_check_monitor', 'event_monitor', 'process_alert_monitor', 'trace_analytic_alert_monitor', 'rum_alert_monitor']` (alert events) or a `recovery` event. Require `alert_id` (the monitor ID) or `monitor_id` to be present. Return HTTP 400 for malformed payloads — do not crash or silently drop them; log the raw body for diagnostics.

- **REQ-3.3 — Alert event → incident.** When `event_type` indicates an alert (not recovery):
  1. Extract `alert_id` or `monitor_id` → `externalRef`. Call `IncidentService.openIncident()` with `source='datadog'`, `externalRef=<monitor_id>`, `title` from `event_title` or `title` field, `description` from `event_msg` or `body`.
  2. Parse `alert_type` (`error`/`warning`/`info`/`success`) → severity: `error`→sev2, `warning`→sev3, `info`→sev4. Override with tags if present.
  3. Append the event body as a timeline event via `addEvent`: `kind='note'`, `actorRef='datadog'`, `message` containing the event title, alert type, and a truncated snippet of the event message.
  4. Store the `event_id` from the payload in the timeline event's `target` field (or as a metadata field) for idempotency (REQ-5.1).

- **REQ-3.4 — Recovery event → resolve.** When the event is a recovery (`event_type` contains `recovery` or the Datadog alert recovery webhook format):
  1. Look up the incident by `externalRef=<monitor_id>`, `source='datadog'` via `IncidentService`'s existing lookup.
  2. If found and status is not already `resolved`, call `IncidentService.updateIncident()` with `status='resolved'`.
  3. Append a `kind='resolved'` timeline event: "Monitor recovered (webhook) — <event_msg>", `actorRef='datadog'`.
  4. If no open incident exists for the monitor, log a warning and return 200 (do not create a new incident on a stale recovery — the webhook may be late/replayed).

---

### REQ-4: Severity & Data Mapping Contract

The mapping from Datadog to internal incident fields — a single source of truth used by both poll and webhook paths.

| Datadog Field | Internal Field | Mapping Rule |
|---|---|---|
| `monitor.id` / `alert_id` | `externalRef` | Stringify to `varchar(255)`. The dedup key alongside `source='datadog'`. |
| `monitor.name` / `event_title` | `title` | Truncate to 255 chars. Prefix with "[Datadog] " only if the name does not already mention Datadog. |
| `monitor.tags[]` / `tags` | — | Scan for `severity:sev<N>` and `system:<name>` for affected-system classification. |
| `monitor.priority` (1–5) | `severity` | Fallback: 1→sev1, 2→sev2, 3→sev3, 4–5→sev4. |
| Datadog `overall_state` | `status` | `Alert`/`Warn`/`No Data` → `open`, `OK` → `resolved`. |
| `alert_type` (`error`/`warning`/`info`/`success`) | `severity` | Webhook fallback: `error`→sev2, `warning`→sev3, `info`→sev4, `success`→sev4. |
| Monitor query (`monitor.query`) | `impact` / `affectedSystem` | Run `guessAffectedSystem()` over the query text. Store query in `impact` field for the triage agent. |
| `monitor.message` | `description` | The monitor's notification message body — stored as `impact` (the description field on `prodIncidents`). |
| Full raw payload | `impact` metadata | Append a compact JSON summary (`id`, `state`, `tags`, `query` truncated) to the `impact` text field for audit trail. |

- **REQ-4.1 — `source` is always hard-coded to `'datadog'`.** No other value is ever written for incidents ingested through this pipeline.

- **REQ-4.2 — Monitor tags are the authority for severity and system.** If `severity:<level>` or `system:<name>` tags are present, they override any heuristic. This lets teams configure their Datadog monitors to control how our platform classifies them.

---

### REQ-5: Idempotency Guarantees

- **REQ-5.1 — Event-level idempotency.** For webhook events, use `event_id` from the Datadog payload. Store it in a new `incident_events.source_event_id` column, or as a JSON field on the `incident_events` row — a unique index on `(source_event_id)` prevents duplicate event processing. If the webhook is replayed, the `addEvent` insert is skipped (ON CONFLICT DO NOTHING); the incident upsert itself is already idempotent via `openIncident().findByExternal`.

- **REQ-5.2 — Monitor-level idempotency.** The poll path relies on the existing unique index `uq_prod_incidents_external(tenantId, source, externalRef)`. `openIncident()` returns the existing incident on collision; the caller still updates severity/tags/title if they changed (freshness, not duplication).

- **REQ-5.3 — Concurrent poll + webhook.** Both paths may process the same monitor simultaneously. This is safe because:
  - `openIncident()` uses a DB-level unique constraint (not app-level locking), so one path wins the INSERT and the other gets the existing row.
  - The poll upsert is a no-op for an already-open incident (FR-1.3 says upsert, not re-create).
  - The webhook recovery and the poll OK transition both call `updateIncident(status='resolved')` — the second call is a no-op (status already resolved).

---

### REQ-6: Operational Integration

- **REQ-6.1 — Escalation & paging.** After a Datadog-sourced incident is opened (by poll or webhook), fire the same escalation flow the ITSM path uses: `EscalationService.pageInitial()` and `dispatchIncidentTriage()`. The Incident Manager agent's triage run classifies the system, adjusts severity if needed, and opens the war room. This must be identical to the ITSM fork path in `itsmIngest.ts` so Datadog-monitor incidents are treated on par with help-desk-derived incidents.

- **REQ-6.2 — Tenant-level opt-in.** Datadog ingestion is gated by the presence of a `board_connections` row with `provider='datadog'` on the tenant. No connection = no poll sweep and no webhook endpoint for that tenant. This mirrors the ITSM fork's `findTenantIncidentManagerRef()` gate — no infrastructure cost for tenants that do not use Datadog.

- **REQ-6.3 — Error surfacing.** Persistent failures (3+ consecutive poll errors, webhook verification failures) are written to `api_error_log` (the existing table) with `source='datadog-ingest'` and the tenant ID. The existing operational dashboards (`/api/quality/stats`) surface these. The `reportedErrors` count on the `board_connections` row is bumped so the connection shows as degraded.

- **REQ-6.4 — Poll interval.** Default poll interval is 60 seconds, driven by the existing `boardConnections.pollIntervalSeconds` column. This satisfies the 90-second SLA in AC-DD-2 (60s poll + up to 30s processing window).

---

### REQ-7: Configuration & Secrets

- **REQ-7.1 — Secrets storage.** Datadog API and Application keys are stored in the existing `board_connections.credentials` JSONB column (the same pattern used by other connectors — GitHub tokens, Jira tokens, etc.). Schema: `{ "ddApiKey": "<encrypted>", "ddAppKey": "<encrypted>", "ddSite": "datadoghq.com" }`. The keys are AES-encrypted at rest using the tenant's `INTEGRATION_ENCRYPTION_SECRET`.

- **REQ-7.2 — Webhook secret.** Stored in `board_connections.webhook_secret` (already a column). The Datadog integration configuration UI generates this secret; the user copies it into the Datadog Event webhook integration setup.

---

### REQ-8: Monitoring Board Integration (Future Readiness)

While the internal `monitors` table (migration 0329 — monitoring boards with pins) is a separate bounded context from external Datadog monitors, the ingestion pipeline should be designed so a future iteration can optionally surface Datadog monitor state on an internal monitoring board. This requirement is NOT for implementation now — it is a forward-compatibility constraint on the data model and architecture decisions.

- **REQ-8.1 — No foreign key between `prodIncidents` and `monitors`.** Datadog monitors are NOT rows in the internal `monitors` table. The link is purely through `prodIncidents.externalRef` storing the Datadog monitor ID as an opaque string.

- **REQ-8.2 — Keep the adapter decoupled.** The Datadog ingestion module (`datadogIngest.ts`) calls `IncidentService` through its public API (`openIncident`, `updateIncident`, `addEvent`). It does not touch `prodIncidents` or `incidentEvents` tables directly, and it does not import Drizzle schema symbols. This keeps the adapter swappable — if Datadog is replaced with another monitoring provider, only the adapter changes.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._