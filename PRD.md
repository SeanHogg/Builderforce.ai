> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #330
> _Each agent that updates this PRD signs its change below._

# PRD: Calendar / Project Management — Deadline Data Availability

## Problem & Goal

Teams and individual contributors lack a reliable, queryable source of truth for deadline data across calendar and project management tools. Deadlines live in siloed systems (Google Calendar, Outlook, Jira, Asana, Linear, Notion, etc.), making it impossible for downstream automation, reporting, and AI agents to consistently answer the question: **"What deadlines exist, for whom, and when?"**

**Goal:** Expose a unified, normalized deadline data layer that any authorized agent, integration, or UI can query to retrieve, filter, and act on deadline information in real time.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Individual Contributor** | Know their own upcoming deadlines across all tools in one place |
| **Project Manager / Team Lead** | Monitor team-wide deadline status, spot conflicts, and flag at-risk items |
| **Engineering / Automation Agent** | Programmatically query deadline data to trigger alerts, reports, or workflows |
| **Executive / Stakeholder** | Portfolio-level visibility into milestone and delivery dates |

---

## Scope

### In Scope

- **Deadline ingestion** from supported calendar and project management sources
- **Normalized deadline schema** (see Functional Requirements)
- **Query API** for reading deadline data by user, project, date range, status, and source
- **Real-time + scheduled sync** from connected sources
- **Basic conflict detection** (overlapping deadlines for the same assignee on the same date)
- **Authentication & authorization** — users and agents only see deadlines they are permitted to see

### Out of Scope *(see full section below)*

---

## Functional Requirements

### FR-1 — Source Connectivity

- The system **must** support read-access connectors for at minimum:
  - Google Calendar (events with due-date semantics)
  - Microsoft Outlook / Exchange Calendar
  - Jira (issue due dates)
  - Asana (task due dates)
  - Linear (issue target dates)
  - Notion (database date properties)
- Each connector **must** authenticate via OAuth 2.0 or API key and store credentials securely.
- Connector sync **must** run on a configurable schedule (default: every 15 minutes) and support webhook-triggered updates where the source API supports it.

### FR-2 — Normalized Deadline Schema

Every ingested deadline **must** be mapped to the canonical record:

```json
{
  "id": "string (UUID)",
  "source": "string (e.g., jira | google_calendar | asana)",
  "source_id": "string (native ID in source system)",
  "title": "string",
  "description": "string | null",
  "deadline_at": "ISO 8601 datetime with timezone",
  "all_day": "boolean",
  "assignees": ["user_id_1", "user_id_2"],
  "project": "string | null",
  "tags": ["string"],
  "status": "open | completed | cancelled | overdue",
  "priority": "critical | high | medium | low | none",
  "url": "string (deep link to source item)",
  "created_at": "ISO 8601 datetime",
  "updated_at": "ISO 8601 datetime",
  "synced_at": "ISO 8601 datetime"
}
```

### FR-3 — Query API

- REST and/or GraphQL endpoint: `GET /deadlines`
- **Must** support filtering by:
  - `assignee_id` (one or many)
  - `project`
  - `source`
  - `status`
  - `deadline_from` / `deadline_to` (date range)
  - `priority`
- **Must** support sorting by `deadline_at`, `priority`, `updated_at`
- **Must** support pagination (cursor-based)
- Response time **must** be ≤ 300 ms at p95 for queries returning ≤ 500 records

### FR-4 — Conflict Detection

- The system **must** flag when a single assignee has ≥ 2 deadlines within a configurable overlap window (default: same calendar day).
- Conflict records **must** be queryable via `GET /deadlines/conflicts`.

### FR-5 — Status Derivation

- If a deadline's `deadline_at` is in the past and the source status is still `open`, the system **must** automatically set `status = overdue`.
- Status changes **must** be reflected within one sync cycle.

### FR-6 — Authorization

- Users **must** only retrieve deadlines for projects and calendars they have been granted access to in the source system.
- Service accounts / agents authenticate via signed JWT or API key scoped to specific data domains.

### FR-7 — Audit & Observability

- Every sync run **must** produce a structured log entry: source, records fetched, records upserted, errors, duration.
- Failed syncs **must** surface as a queryable health status: `GET /connectors/{source}/status`.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | A connected Google Calendar deadline appears in `GET /deadlines` within 15 minutes of creation, with all required schema fields populated. |
| AC-2 | A Jira issue with a due date set to yesterday and status `open` is returned with `status: overdue` on the next sync cycle. |
| AC-3 | Querying `GET /deadlines?assignee_id=X&deadline_from=2024-06-01&deadline_to=2024-06-30` returns only deadlines assigned to user X within that date range, sorted by `deadline_at` ascending by default. |
| AC-4 | An assignee with two deadlines on the same day appears in `GET /deadlines/conflicts`. |
| AC-5 | A user without access to a given project in Jira receives zero results for that project via the API. |
| AC-6 | `GET /connectors/{source}/status` reflects a failed sync within one polling cycle and includes the error reason. |
| AC-7 | API p95 response time is ≤ 300 ms for result sets ≤ 500 records under standard load. |
| AC-8 | Revoking a connector's OAuth token causes all subsequent syncs for that source to halt gracefully and report `auth_error` status. |

---

## Out of Scope

- **Writing / mutating deadlines** back to source systems (read-only in v1)
- **Push notifications or alerting UI** (consumers are responsible for building notifications on top of the API)
- **Time-tracking or estimation data** beyond the deadline date itself
- **Dependencies between tasks** (e.g., task B blocked by task A)
- **Resource capacity planning** or workload balancing recommendations
- **Support for source systems beyond the listed connectors** in v1 (e.g., Monday.com, Basecamp, Smartsheet)
- **Historical deadline analytics or trend reporting** (query layer only; no aggregation engine in v1)
- **End-user UI / dashboard** (API-only deliverable in v1)