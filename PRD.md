> **PRD** — drafted by Mike QA (Tester V2 (Durable) · task #353
> _Each agent that updates this PRD signs its change below._
>
> ---
>
> ## Sign-offs
>
> | Role | Agent | Verdict | Date | Notes |
> |---|---|---|---|---|
> | **QA / Author** | Mike QA (Tester V2) | drafted | 2026-07-12 | Original PRD |
> | **Developer** | Bob Developer (V2) | changes_requested | 2026-07-29 | Repo mismatch — `api/` backend not on branch; gap #1218 filed |
> | **Business Analyst** | BA (this run) | approved (PRD) | 2026-07-30 | Requirements are clear, complete, and testable. Implementation blocked by infrastructure gap #1218 — re-dispatch once `api/` package is on branch. |

---

# PRD: Agent Channels Endpoint — Channel Registry Implementation

## Problem & Goal

The `/agent/channels` endpoint is a non-functional stub that always returns `[]`. No persistence layer exists for agent channel configuration. The goal is to design and implement a `channel-registry` table, wire the endpoint to the database, and return real channel records so that consumers of the API can discover, configure, and manage the channels available to agents.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Platform Engineer** | Registers new channels (e.g., Slack, email, webhook) and manages their lifecycle via API or migration scripts. |
| **Agent Runtime** | Queries the endpoint at startup or on-demand to know which channels it is authorized to use. |
| **Product / Ops** | Audits active channels and their metadata through dashboards or direct API calls. |

---

## Scope

This effort covers:

1. Database schema design for the `channel-registry` table.
2. Migration script to create and seed the table.
3. Repository / data-access layer to query the table.
4. Wiring the existing endpoint handler to the repository.
5. Contract-level validation so the response shape is stable and documented.

---

## Functional Requirements

### FR-1 — Channel Registry Table

- A `channel-registry` table must be created with at minimum the following columns:

  | Column | Type | Constraints | Description |
  |---|---|---|---|
  | `id` | `UUID` | PK, default `gen_random_uuid()` | Stable unique identifier |
  | `name` | `VARCHAR(128)` | NOT NULL, UNIQUE | Human-readable channel name (e.g., `slack-prod`) |
  | `type` | `VARCHAR(64)` | NOT NULL | Channel transport type (e.g., `slack`, `email`, `webhook`, `sms`) |
  | `config` | `JSONB` | NOT NULL, default `'{}'` | Channel-specific configuration blob |
  | `is_active` | `BOOLEAN` | NOT NULL, default `TRUE` | Soft-enable/disable without deletion |
  | `created_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | Record creation timestamp |
  | `updated_at` | `TIMESTAMPTZ` | NOT NULL, default `NOW()` | Last modification timestamp; updated via trigger |

- An index must exist on `(type, is_active)` to support filtered queries efficiently.
- An `updated_at` trigger must keep the column current on every `UPDATE`.

### FR-2 — Data Access / Repository Layer

- A `ChannelRegistryRepository` (or equivalent module for the project's language/framework) must expose at minimum:
  - `findAll(filters?: { type?: string; isActive?: boolean })` → returns a list of channel records.
  - `findById(id: string)` → returns a single channel record or `null`.
  - `create(payload: NewChannel)` → inserts a record and returns the created entity.
  - `update(id: string, payload: Partial<Channel>)` → updates and returns the updated entity.
  - `deactivate(id: string)` → sets `is_active = FALSE` (no hard deletes via this API).

### FR-3 — Endpoint Wiring

- `GET /agent/channels` must:
  - Query `channel-registry` via the repository.
  - Support optional query-string filters `type` and `is_active` (default: `is_active=true`).
  - Return a JSON array of channel objects matching the schema below; return `[]` only when the table is genuinely empty or no records match filters.
  - Respond with HTTP `200` in all non-error cases.
  - Respond with HTTP `500` and a structured error body on unhandled database errors.

- Response object shape per channel:

```json
{
  "id": "uuid",
  "name": "string",
  "type": "string",
  "config": {},
  "isActive": true,
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

### FR-4 — Migration

- A versioned, repeatable migration script must:
  - Create the `channel-registry` table idempotently (`CREATE TABLE IF NOT EXISTS`).
  - Create the `updated_at` trigger idempotently.
  - Create the compound index idempotently.
  - Include at least three seed rows covering distinct `type` values for local/dev environments.

### FR-5 — Input Validation

- The `config` JSONB column must be validated at the application layer to reject payloads containing keys that conflict with a reserved-key denylist (e.g., `__proto__`, `constructor`).
- The `type` field must be validated against an allowlist enum; unknown types are rejected with HTTP `422`.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | `GET /agent/channels` returns a non-empty JSON array after the seed migration has been applied in a development environment. |
| AC-2 | `GET /agent/channels?is_active=false` returns only records where `is_active = FALSE`. |
| AC-3 | `GET /agent/channels?type=slack` returns only records with `type = 'slack'`. |
| AC-4 | The endpoint returns `[]` (not an error) when the table exists but contains no matching rows. |
| AC-5 | A database connection failure causes the endpoint to return HTTP `500` with a JSON error body; it does not return `[]`. |
| AC-6 | The migration runs without error on a clean schema and is idempotent (running it twice produces no error). |
| AC-7 | All repository methods are covered by integration tests that run against a real (test) database instance. |
| AC-8 | The `updated_at` column is automatically updated when a record is modified, verified by an integration test. |
| AC-9 | Attempting to create a channel with an unknown `type` returns HTTP `422` with a descriptive error message. |
| AC-10 | No existing endpoint contracts or routes are broken by this change (regression test suite passes). |

---

## Out of Scope

- **Authentication / authorization** on the `/agent/channels` endpoint — handled by existing middleware; no changes required here.
- **Hard-delete** of channel records — deactivation (`is_active = FALSE`) is the only supported removal path in this iteration.
- **Channel message delivery** — this PRD covers registry/metadata only, not the actual sending or receiving of messages through channels.
- **Multi-tenancy / workspace isolation** — single-tenant schema; tenant scoping is a future iteration.
- **Admin UI** — channel management UI is out of scope; API only.
- **Encryption of the `config` column at rest** — deferred to a security hardening pass; noted as a follow-up action.
- **Pagination** of the channels list — the channel count is expected to remain small (<500); pagination is a future enhancement.

---

## Business Analyst Sign-Off

> **Reviewer:** BA (Business Analyst) · task #353 · lane `ready`  
> **Date:** 2026-07-30

### Assessment

The PRD is **complete, well-scoped, and ready for implementation** — every functional requirement (FR-1 through FR-5) and acceptance criterion (AC-1 through AC-10) is concrete, testable, and unambiguous. The response contract, error semantics, and validation rules are specified clearly enough that the implementer does not need to guess.

### BLOCKER: Repo Mismatch

The requirements **cannot be implemented** on the currently bound repository (`seanhogg/builderforce.ai`, branch `builderforce/task-353`) because the branch contains only `agent-runtime/` (Swabble Swift CLI + chat-channel extensions) and root documentation — it does **not** include:

- The `api/` backend package
- `clawRoutes.ts` (the file ROADMAP.md cites as the stub location at line 1103)
- Any database migration runner or migrations directory
- Any PostgreSQL/ORM layer (Drizzle, Prisma, Knex, etc.)

The PRD calls for a Postgres-backed `channel-registry` table with `gen_random_uuid()`, `JSONB`, triggers, and a Hono/Express route handler. None of that infrastructure exists on this branch. A prior developer pass verified this exhaustively and filed **gap task #1218** to bring the `api/` backend onto the branch.

### Verdict

| Aspect | Verdict |
|---|---|
| PRD completeness | ✅ Complete — all FRs, ACs, contract shapes, and error semantics defined |
| Requirements clarity | ✅ No ambiguity — each FR and AC is independently verifiable |
| Out-of-scope boundaries | ✅ Well-delineated — the implementer knows what NOT to build |
| Implementability | ⛔ BLOCKED — repo mismatch; `api/` backend missing from branch |
| Blocker resolution | Gap task #1218 — re-dispatch #353 once the `api/` package is present |

**Recommendation:** The PRD is approved as the specification for this feature. Ticket #353 should be returned to the backlog (`ready`) and re-dispatched once gap task #1218 is resolved and the `api/` backend is available on the branch for implementation.



