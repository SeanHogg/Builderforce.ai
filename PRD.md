> **PRD** — drafted by John Coder ((V2) (Durable)) · task #617
> _Each agent that updates this PRD signs its change below._

# PRD: Trustworthy & Explainable `progressPct` for MCP Tickets

## Problem & Goal

### Problem
`progressPct` returned by `chats.list_tickets`, `tasks.list`, and `tasks.get` is a single opaque integer that is demonstrably misleading. Observed failures (Brain chat #58):

- **Task 157**: `progressPct=100`, `done=0/total=0` — derived from nothing real.
- **Tasks 322 & 336**: `progressPct=100` while implementation status is `in_review` — no delivered code, no passing tests.

An AI agent consuming this field cannot inspect *why* a percentage is what it is. The only safe response is to distrust it entirely, which defeats its purpose.

### Goal
Replace the bare `progressPct` integer with a **machine-readable `progress` breakdown object** that exposes the derivation basis and supporting signals, so agents and UIs can reason about, display, and trust the value — or know precisely when they cannot.

---

## Target Users / ICP Roles

| Consumer | Need |
|---|---|
| **AI agents** (primary) | Must distinguish real delivery from accounting artifacts; needs structured data, not a number |
| **Board / dashboard UIs** | Need to show *why* a ticket is at a given percentage, not just the number |
| **Human engineers reviewing agent output** | Need to audit what the agent concluded and why |
| **Downstream agents (#615, diff-summary tool)** | Need a canonical progress signal they can feed into or correct |

---

## Scope

### In Scope
- `tasks.get` (detail endpoint)
- `tasks.list` (compact list)
- `chats.list_tickets` (compact list)
- The `progress` field schema and derivation logic
- Guard-rails preventing false `100` emissions
- `null`/`unknown` handling when no real signal exists

### Out of Scope
- Changes to `progressPct` *storage* format in the database (read-layer transformation is sufficient for this ticket)
- PR CI/test-result ingestion pipeline (signals consumed here, not defined here — see diff-summary tool ticket)
- Front-end rendering beyond ensuring the payload is consumable
- Historical backfill of stored `progressPct` values

---

## Functional Requirements

### FR-1 — `progress` Breakdown Object

Every response from `tasks.get`, `tasks.list`, and `chats.list_tickets` that currently returns `progressPct` **must** instead (or additionally, for backward compat) return a `progress` object with the following shape:

```jsonc
"progress": {
  "pct": 40,                    // integer 0–100 or null
  "basis": "subtasks",          // enum — see FR-2
  "subtasksDone": 2,            // integer or null
  "subtasksTotal": 5,           // integer or null
  "codeDelivered": false,       // bool: merged PR or equivalent signal
  "testsPassing": null,         // bool or null (null = no signal available)
  "prState": "in_review"        // enum: null | "open" | "in_review" | "merged" | "closed"
}
```

The top-level `progressPct` field **may** be retained for one release cycle as a deprecated alias equal to `progress.pct`, then removed.

### FR-2 — `basis` Enum and Derivation Rules

| `basis` value | When used | `pct` derivation |
|---|---|---|
| `"subtasks"` | `subtasksTotal ≥ 1` | `floor(subtasksDone / subtasksTotal * 100)` |
| `"status"` | No subtasks; no PR; status maps to a milestone | Map: `todo→0`, `in_progress→25`, `in_review→60`, `done→100` |
| `"pr"` | PR exists but `codeDelivered=false` | Max **60** (never 100) — see FR-3 |
| `"delivered"` | `codeDelivered=true` AND (`testsPassing=true` OR `testsPassing=null`) | `90` (tests unknown) or `100` (tests confirmed passing) |
| `"manual"` | Explicit override set by a human | Stored value, passed through; `basis` flags it as human-set |
| `"unknown"` | None of the above apply | `pct: null` |

### FR-3 — Hard Guard: No False `100`

- `pct=100` **must not** be emitted unless **at least one** of:
  - `subtasksDone === subtasksTotal AND subtasksTotal ≥ 1` **AND** `codeDelivered=true`, **OR**
  - `basis="delivered"` with `testsPassing=true`, **OR**
  - `basis="manual"` with an explicit human-set value of 100.
- A PR in any state short of merged does **not** qualify as `codeDelivered=true`.

### FR-4 — Zero-Subtask Guard

- When `subtasksTotal=0` (or null/missing), the system **must not** derive `pct=100` from the subtask ratio.
- Fall through to `basis="status"`, `basis="pr"`, `basis="delivered"`, or `basis="unknown"` per FR-2.

### FR-5 — `codeDelivered` Signal Definition

`codeDelivered=true` requires **any one** of:
- The ticket's linked PR has state `merged`.
- A diff-summary tool signal (future integration, see related tickets) marks the feature branch as delivered to the target branch.
- A human sets `codeDelivered` explicitly via the manual override.

`prState="in_review"` or `prState="open"` → `codeDelivered=false`.

### FR-6 — `testsPassing` Signal

- `true`: CI result explicitly passed and linked to this ticket's PR/branch.
- `false`: CI result explicitly failed.
- `null`: no CI signal available (this is the default; must not be treated as `false`).

### FR-7 — Backward Compatibility Window

- For **one minor-version cycle**, emit both `progressPct` (deprecated integer) and `progress` (new object).
- `progressPct` must equal `progress.pct` (or `null` cast to `0` for legacy consumers that cannot handle null).
- Deprecation notice in response headers or metadata field: `"progressPctDeprecated": true`.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | `tasks.get` response includes a `progress` object with all fields: `pct`, `basis`, `subtasksDone`, `subtasksTotal`, `codeDelivered`, `testsPassing`, `prState`. |
| AC-2 | `tasks.list` and `chats.list_tickets` compact responses include the same `progress` object (may omit `null` fields in compact mode but must include `pct` and `basis`). |
| AC-3 | Task 157 equivalent (done=0, total=0, no PR) returns `pct: null`, `basis: "unknown"` — never `pct: 100`. |
| AC-4 | Tasks 322/336 equivalent (`prState: "in_review"`) return `codeDelivered: false` and `pct ≤ 60`. |
| AC-5 | `pct: 100` is only returned in scenarios matching FR-3 criteria; automated test suite asserts all three disallowed-100 cases. |
| AC-6 | `basis` field is always present and always one of the six defined enum values; response fails schema validation otherwise. |
| AC-7 | A task with `subtasksTotal=0` and no other signals returns `basis: "unknown"`, `pct: null`. |
| AC-8 | A task with a merged PR and `testsPassing: true` returns `basis: "delivered"`, `pct: 100`. |
| AC-9 | Deprecated `progressPct` top-level field equals `progress.pct` (or `0` if null) for the backward-compat window. |
| AC-10 | No regression in response-time SLA for list endpoints (breakdown computed in same DB round-trip or via in-process derivation, not extra calls). |

---

## Out of Scope

- **CI/CD pipeline integration** — `testsPassing` signal is consumed if present; ingesting CI webhooks is a separate workstream.
- **Diff-summary tool** — referenced as a future source for `codeDelivered`; its own ticket governs its implementation.
- **Database schema migration** — derivation logic lives in the read/serialization layer; no stored-column changes required by this ticket.
- **Historical data correction** — previously stored or cached `progressPct` values are not backfilled.
- **Front-end UI redesign** — payload is made consumable; visual rendering decisions belong to the board/UI team.
- **`progressPct` removal** — deprecation only in this ticket; hard removal is a follow-on ticket after migration period.
- **Ticket creation or editing flows** — read path only.

---

*Related: #615 (accounting fix), #618, diff-summary tool ticket, Brain chat #58.*