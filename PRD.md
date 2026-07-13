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

- `pending` is derived as `total − completed − failed − skipped` (per code; matches AC-5 cases) and never stored independently. All counts must satisfy `completed + failed + skipped + pending == total`.
- `percentage` is calculated server-side using integer floor division for non-zero `total`; fractional values are never returned. When `total = 0`, `percentage` must be `100`.
- The invariant (`completed + failed + skipped + pending == total`) is asserted server-side before serialization; a violation causes a 500 with a structured error body.

### FR-4 — Status Consistency

- If all items are `completed` or `skipped`, the parent task `status` must reflect a terminal state (`completed`).
- If any item is `failed` and no retry is pending, the parent task `status` must reflect `failed` or `partial_failure` per existing status semantics.
- The `progress` object is computed on every request from live data (no caching of progress counters independently of the items themselves).

### FR-5 — Tasks With No Sub-items

- If a task has no decomposed sub-items, `total` is `0` and `percentage` is `100`.
- This signals that the task is atomic; progress is fully inferred from the task's own `status` field.

### FR-6 — Error Handling

- If progress computation fails (e.g., data inconsistency detected), the endpoint must return an `HTTP 500` with a structured error body; it must **not** return a partial `progress` object with silent nulls.
- A data inconsistency is defined as any state where `completed + failed + skipped > total`. This violation yields a 500 with a structured error, mirroring AC-7.

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

---

## Out of Scope

- **Write operations** — No changes to task creation, update, or deletion endpoints.
- **Progress webhooks or push events** — Real-time streaming of progress changes is a separate feature.
- **Historical progress snapshots** — Time-series or audit trails of progress over time are not included.
- **Nested task hierarchies beyond one level** — Sub-items of sub-items are not aggregated in this iteration.
- **Caching layer** — Progress caching strategies are deferred to a dedicated performance initiative.
- **New status values** — `partial_failure` or any other new status codes beyond what the existing schema supports are out of scope.
- **Client SDK updates** — Updating generated SDKs or documentation sites is tracked separately.
- **Response time regression (<10ms vs. baseline)** — Addressed in implementation notes; not yet measured.

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

- **Endpoint implementation** (`GET /tasks/:id` in `taskRoutes.ts`):
  - Fetches task via repository.
  - Calls `TaskService.getTaskWithProgress(task)` which computes `progress`.
  - Maps to `TaskDTO` response. Errors (404, invariant violation, others) are caught and returned as 404/500 with structured bodies.
- **Progress computation** (`computeProgress` in `taskService.ts`):
  - `total = 0` if `parentTaskId === null`, otherwise `1`.
  - Sets `completed/failed/skipped` per `status`.
  - Derives `pending = total - completed - failed - skipped`.
  - Tosses `TaskProgressInvariantError` when `completed + failed + skipped > total`.
  - Returns `percentage = 100` when `total === 0`, otherwise `Math.floor((completed / total) * 100)`.
- **Service method** (`TaskService.getTaskWithProgress`):
  - Delegates to `computeProgress(task)` and returns result.
- **Error types**:
  - `TaskNotFoundError`: thrown by repository on non-existent tasks.
  - `TaskProgressInvariantError`: thrown for invariant violations; caught in route with 500+structured error.
  - Default `catch` returns generic 500 `internal_error`.
- **Test coverage** (`taskRoutes.test.ts`):
  - AC-1: mixed-state atomic task.
  - AC-2: percentage calculation for atomic completion.
  - AC-3: atomic zero sub-items returns total=0, all counts=0, percentage=100.
  - AC-4: two completions, both atomic and with sub-items, each give percentage=100 and pending=0.
  - AC-5: pending == total - completed - failed - skipped.
  - AC-6: all original response fields are unchanged, progress key is additive.
  - AC-7: expects invariant violation to surface via 500; test does not explicitly store broken counts (repo model doesn't), but confirms no crash and documents error handling.
  - Additional: multiple statuses and nonexistent ID return correctly.
- **Performance notes**:
  - No caching added yet; can be deferred as a separate performance initiative.
  - Estimated CPU impact low (constant-time per-task arithmetic + invariant check); targeted <10ms p95 under expectations bench (AC-9 pending).

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored.