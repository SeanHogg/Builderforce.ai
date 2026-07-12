> **PRD** — drafted by John Coder ((V2) (Durable)) · task #643
> _Each agent that updates this PRD signs its change below._

# PRD: Ticket Detail Progress Breakdown Object

## Problem & Goal

Ticket detail responses currently lack a unified, structured representation of task progress. Consumers of the API (UI, agents, automations) must stitch together disparate signals—subtask counts, PR states, CI results, manual status—into their own ad-hoc logic, producing inconsistency across surfaces.

**Goal:** Expose a single, normalized `progress` object on every ticket detail payload (both `tasks.get` and the compact list endpoint) that gives callers a clear, unambiguous picture of how far along a ticket is and what that assessment is based on.

---

## Target Users / ICP Roles

| Role | Need |
|---|---|
| **Frontend engineers** | Render progress bars, status badges, and completion indicators without custom derivation logic |
| **AI agents / automation scripts** | Make routing and gating decisions (e.g. "is this ticket ready for QA?") from a single field |
| **Engineering managers / PMs** | Trust that progress shown in list views and detail views is computed identically |
| **Backend / integration developers** | Consume a stable, versioned contract when building webhooks or external dashboards |

---

## Scope

### In Scope

- Adding a `progress` object to:
  - `tasks.get` (single ticket detail)
  - The compact ticket list endpoint (all list items)
- Defining the shape, valid values, and derivation rules for the `progress` object
- Server-side derivation logic that selects the correct `basis` and populates all sub-fields
- Serialization and OpenAPI/schema documentation updates

### Out of Scope

- UI rendering of the progress object (separate ticket)
- Webhooks payload changes (separate ticket)
- Historical progress tracking / time-series data
- Allowing callers to *set* the `basis` field directly (it is computed, not user-configurable, except where `manual` is the explicit ticket setting)

---

## Functional Requirements

### FR-1 — Progress Object Shape

Every ticket payload (detail and compact list) **MUST** include a top-level `progress` field with the following structure:

```jsonc
{
  "progress": {
    "basis":          "subtasks" | "pr" | "status" | "manual",
    "subtasksDone":   number | null,   // null when basis != "subtasks" and no subtasks exist
    "subtasksTotal":  number | null,   // null under same condition
    "codeDelivered":  boolean,
    "testsPassing":   boolean | null,  // null = no CI data available
    "prState":        "none" | "open" | "review" | "merged" | "closed"
  }
}
```

### FR-2 — Basis Selection Rules (Priority Order)

The server **MUST** select `basis` using the following waterfall; the first matching rule wins:

1. **`"manual"`** — The ticket has an explicit manual progress override set by a user.
2. **`"subtasks"`** — The ticket has one or more subtasks (regardless of PR or CI state).
3. **`"pr"`** — No subtasks exist but one or more linked PRs exist.
4. **`"status"`** — None of the above; progress is inferred from the ticket's workflow status alone.

### FR-3 — Field Derivation Rules

| Field | Derivation |
|---|---|
| `subtasksDone` | Count of subtasks whose status is in a "done" category; `null` if `subtasksTotal` is `null` |
| `subtasksTotal` | Total count of direct child subtasks; `null` if the ticket has no subtasks |
| `codeDelivered` | `true` if any linked PR has state `merged`; otherwise `false` |
| `testsPassing` | `true` if all linked PRs with CI data have passing checks; `false` if any check is failing; `null` if no CI data exists for any linked PR |
| `prState` | Highest-precedence state across all linked PRs using order: `merged > review > open > closed > none` |

### FR-4 — Consistency Guarantee

The `progress` object returned for a given ticket **MUST** be computed by the same function/module for both `tasks.get` and the compact list endpoint. Duplicate derivation logic is not permitted.

### FR-5 — Performance

- For compact list responses, progress derivation **MUST NOT** issue per-ticket N+1 queries. Subtask counts, PR states, and CI statuses **MUST** be batch-loaded.
- p99 latency increase for the compact list endpoint **MUST NOT** exceed **50 ms** over the pre-change baseline.

### FR-6 — Null Safety

All nullable fields **MUST** be explicitly `null` (not omitted, not `undefined`, not `0`) when data is unavailable, so consumers can distinguish "no data" from "zero / false."

### FR-7 — Schema Documentation

The `progress` object **MUST** be documented in the OpenAPI spec with descriptions, enum values, and nullable annotations for every field.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | `tasks.get` response includes a `progress` object matching the specified shape on every ticket, including tickets with no subtasks, no PRs, and no CI. |
| AC-2 | Compact list response includes `progress` on every item in the list; shape is identical to `tasks.get`. |
| AC-3 | `basis` is always one of the four defined enum values and is never `null` or omitted. |
| AC-4 | A ticket with subtasks always has `basis: "subtasks"` regardless of PR or CI state. |
| AC-5 | A ticket with no subtasks but with a merged PR has `codeDelivered: true` and `prState: "merged"`. |
| AC-6 | `testsPassing` is `null` for tickets where no linked PR has CI check data. |
| AC-7 | `subtasksDone` and `subtasksTotal` are `null` (not `0`) for tickets with no subtasks. |
| AC-8 | A manual-override ticket has `basis: "manual"` regardless of subtask or PR state. |
| AC-9 | Compact list endpoint p99 latency regression is ≤ 50 ms measured against the pre-change baseline in the staging load test. |
| AC-10 | OpenAPI spec is updated; schema validation passes in CI with no new warnings. |
| AC-11 | Unit tests cover all four `basis` branches and every nullable field's null/non-null cases. |
| AC-12 | A single shared derivation function is used by both endpoints (verified by code review / import graph). |

---

## Out of Scope

- Changes to how `basis` is *stored* on a ticket — `manual` mode is toggled via an existing separate mechanism; this PRD only concerns reading and exposing the derived value.
- Aggregated progress across epics or projects.
- Real-time / streaming updates to the progress object.
- UI components, design specs, or frontend implementation.
- Webhook payload changes or event emission triggered by progress changes.
- Admin tooling for bulk backfilling historical tickets.
- Any change to how CI/CD systems report check statuses to the platform.