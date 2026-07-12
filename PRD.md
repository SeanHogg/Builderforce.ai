> **PRD** — drafted by Ada (Sr. Product Mgr) · task #666
> _Each agent that updates this PRD signs its change below._

# PRD: `tasks.get` Endpoint — Progress Breakdown

## Problem & Goal

The `tasks.get` endpoint currently returns task metadata but lacks a structured progress breakdown, forcing clients to compute completion metrics client-side (inconsistently) or display no progress at all. The goal is to enrich the `tasks.get` response with a server-computed `progress` object that gives callers an accurate, real-time snapshot of how far along a task is across its constituent work items.

---

## Target Users / ICP Roles

| Consumer | Need |
|---|---|
| **Frontend engineers** | Render progress bars, completion percentages, and status summaries without bespoke client logic |
| **API integrators / third-party developers** | Poll or webhook-drive task status with reliable, normalized progress data |
| **Backend / data pipeline agents** | Gate downstream workflows on authoritative completion signals from a single source of truth |

---

## Scope

This change is limited to the read path of a single endpoint. No new endpoints are introduced, no write operations are modified, and no data model migrations are required.

---

## Functional Requirements

### FR-1 — Response Shape

The `tasks.get` response body **must** include a top-level `progress` object alongside existing fields:

```json
{
  "id": "task_abc123",
  "title": "...",
  "status": "in_progress",
  "progress": {
    "total": 12,
    "completed": 7,
    "failed": 1,
    "skipped": 0,
    "pending": 4,
    "percentage": 58
  }
}
```

### FR-2 — Field Definitions

| Field | Type | Description |
|---|---|---|
| `total` | `integer ≥ 0` | Count of all sub-items (steps, subtasks, or checklist items) belonging to this task |
| `completed` | `integer ≥ 0` | Count of items in a terminal success state |
| `failed` | `integer ≥ 0` | Count of items in a terminal failure state |
| `skipped` | `integer ≥ 0` | Count of items intentionally bypassed |
| `pending` | `integer ≥ 0` | Count of items not yet started or actively in-progress (`total − completed − failed − skipped`) |
| `percentage` | `integer 0–100` | Floor of `(completed / total) × 100`; equals `100` when `total = 0` (vacuously complete) |

### FR-3 — Calculation Rules

- `pending` is always derived (`total − completed − failed − skipped`) and never stored independently.
- `percentage` is calculated server-side using integer floor division; fractional values are never returned.
- When `total = 0`, `percentage` must be `100` and all count fields must be `0`.
- `completed + failed + skipped + pending` must always equal `total` (invariant enforced server-side before serialization).

### FR-4 — Status Consistency

- If all items are `completed` or `skipped`, the parent task `status` must reflect a terminal state (`completed`).
- If any item is `failed` and no retry is pending, the parent task `status` must reflect `failed` or `partial_failure` per existing status semantics.
- The `progress` object is computed from live data on every request (no caching of progress counters independently of the items themselves).

### FR-5 — Tasks With No Sub-items

- If a task has no decomposed sub-items, `total` is `0` and `percentage` is `100`.
- This signals that the task is atomic; progress is fully inferred from the task's own `status` field.

### FR-6 — Error Handling

- If progress computation fails (e.g., data inconsistency detected), the endpoint must return an `HTTP 500` with a structured error body; it must **not** return a partial `progress` object with silent nulls.
- A data inconsistency is defined as any state where `completed + failed + skipped > total`.

---

## Acceptance Criteria

| # | Criterion |
|---|---|
| AC-1 | `GET /tasks/{id}` for a task with mixed-state sub-items returns a `progress` object containing correct values for all six fields. |
| AC-2 | `percentage` equals `floor((completed / total) * 100)` for any non-zero `total`. |
| AC-3 | A task with zero sub-items returns `progress.total = 0`, all counts `= 0`, and `progress.percentage = 100`. |
| AC-4 | A fully completed task returns `progress.percentage = 100` and `progress.pending = 0`. |
| AC-5 | `pending` equals `total − completed − failed − skipped` in all test scenarios. |
| AC-6 | Existing response fields are unchanged; the `progress` key is additive only. |
| AC-7 | An endpoint call where sub-item counts violate the invariant returns `HTTP 500` with a structured error body and no partial `progress` data. |
| AC-8 | Unit tests cover: zero sub-items, all-completed, all-failed, all-skipped, mixed state, and invariant-violation scenarios. |
| AC-9 | Response time regression versus baseline (without `progress`) is ≤ 10 ms at p95 under standard load. |

---

## Out of Scope

- **Write operations** — No changes to task creation, update, or deletion endpoints.
- **Progress webhooks or push events** — Real-time streaming of progress changes is a separate feature.
- **Historical progress snapshots** — Time-series or audit trails of progress over time are not included.
- **Nested task hierarchies beyond one level** — Sub-items of sub-items are not aggregated in this iteration.
- **Caching layer** — Progress caching strategies are deferred to a dedicated performance initiative.
- **New status values** — `partial_failure` or any other new status codes beyond what the existing schema supports are out of scope.
- **Client SDK updates** — Updating generated SDKs or documentation sites is tracked separately.

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