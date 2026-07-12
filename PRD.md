> **PRD** — drafted by John Coder ((V2) (Durable)) · task #679
> _Each agent that updates this PRD signs its change below._

# PRD: Fix `tasks.update` Partial-Update Semantics — `parentTaskId` Drop Bug

## Problem & Goal

### Problem
`tasks.update` does not implement true partial-update (PATCH) semantics. When a caller sets `assignedAgentRef` in an update payload — without supplying `parentTaskId` — the handler silently resets `parentTaskId` to `null`, detaching the task from its parent Epic. The same code path also triggers the auto-run side effect in a way that can fire duplicate execution dispatches.

This was observed in production on tickets #643, #644, #646 (children of Epic #617): assigning the Coder agent detached all three from Epic #617 and caused three duplicate execution pairs (3949/3951/3953) that required manual cancellation and re-parenting.

### Goal
Enforce strict partial-update semantics across `tasks.update` so that **only explicitly provided fields are mutated**. Eliminate the side-effect duplication on the assignment code path.

---

## Target Users / ICP Roles

| Role | Impact |
|---|---|
| **Orchestrator Agent** | Primary caller of `tasks.update`; currently loses task hierarchy silently |
| **Coder / Worker Agents** | Receive duplicate dispatches when assigned to parented tasks |
| **Human Operators** | Must perform manual re-parenting and dispatch cancellation as recovery |
| **Platform / Infra Engineers** | Own the fix and regression test suite |

---

## Scope

This fix is scoped to the `tasks.update` RPC handler and its assignment/auto-run sub-path. No schema changes, no UI changes, no changes to other RPC methods unless a shared utility is identified as the root cause of the field-reset.

---

## Functional Requirements

### FR-1 — Strict Partial-Update Semantics
The `tasks.update` handler **must** merge the incoming payload onto the existing persisted record using a sparse merge (equivalent to SQL `UPDATE … SET only_provided_columns`). Fields absent from the request payload **must not** be read, defaulted, or written during the update operation.

This applies to, at minimum:
- `parentTaskId`
- `assignedAgentRef`
- `status`
- `priority`
- `dueDate`
- `title`
- `description`

### FR-2 — `assignedAgentRef` Must Not Touch `parentTaskId`
The assignment sub-path (setting `assignedAgentRef` and/or triggering auto-run) must be isolated from the task's relational fields. Under no circumstances may the assignment path construct a full-row object, overwrite the stored row wholesale, or pass a default value for `parentTaskId`.

### FR-3 — Explicit Null Detach Remains Supported
A caller that deliberately passes `parentTaskId: null` in the payload **must** still detach the task from its parent. The fix must distinguish between `key absent from payload` (no-op) and `key present with value null` (intentional detach).

### FR-4 — Auto-Run Side Effect Fires Exactly Once Per Assignment
When `assignedAgentRef` transitions from unset/different to a new value, the auto-run dispatch side effect must fire exactly once. The fix must audit the assignment path for any condition that causes the side effect to execute twice (e.g., being called from both the generic update path and the assignment-specific path).

### FR-5 — No Silent Failures
If the update handler encounters an unknown or unsupported field in the payload it must ignore or error explicitly — it must not silently coerce unrecognized fields to null on the stored record.

---

## Acceptance Criteria

| ID | Criterion | Verification method |
|---|---|---|
| AC-1 | `tasks.update({ id, assignedAgentRef: "<agent>" })` on a task with an existing `parentTaskId` leaves `parentTaskId` unchanged in the stored record after the call returns. | Automated integration test |
| AC-2 | `tasks.update` does not mutate `parentTaskId`, `priority`, `dueDate`, or `status` when those keys are absent from the request payload. | Parameterized unit tests, one per field |
| AC-3 | `tasks.update({ id, parentTaskId: null })` successfully detaches the task (sets `parentTaskId` to null). | Automated integration test |
| AC-4 | A parented task that has `assignedAgentRef` set via `tasks.update` triggers exactly one auto-run dispatch, confirmed by inspecting the execution log / dispatch call count. | Automated integration test with dispatch mock/spy |
| AC-5 | No duplicate executions are created when the same assignment is replayed (idempotency guard, if not already present). | Automated test: call assign twice with same agent, assert single dispatch |
| AC-6 | Existing tests for `tasks.update` (status change, priority change, re-parent) continue to pass without modification. | CI green on full test suite |
| AC-7 | Code review confirms the update handler performs a read-modify-write (or equivalent sparse column update) and does not reconstruct a full row object from the payload alone. | PR review checklist item |

---

## Technical Notes for Implementers

- **Root cause hypothesis:** The assignment code path likely calls an internal helper that constructs a new full task object from the request payload (defaulting missing fields to `null` or schema defaults) and then does a full row replace rather than a column-level merge. Audit any function that spreads or `Object.assign`s the request payload directly into a stored document or SQL row.
- **Pattern to enforce:** Read the existing record first → merge only the keys present in the incoming payload → write back. For SQL stores, generate `SET` clauses only for keys present in the payload. For document stores, use `$set` (MongoDB) or equivalent rather than document replacement.
- **Auto-run guard:** Confirm the dispatch call is gated on `assignedAgentRef` actually changing value (old value !== new value), not simply on the field being present in the payload.

---

## Out of Scope

- Changes to `tasks.create` — a full-row construction is correct on creation.
- Changes to any other RPC methods (`tasks.get`, `tasks.delete`, `epics.*`, etc.) unless they share the exact same broken update utility.
- UI / API surface changes — no endpoint signature changes, no new fields.
- Backfilling or automatically re-parenting the tasks (#643, #644, #646) that were already detached — that is an operational recovery action, not part of this fix.
- Broader task-execution deduplication infrastructure beyond the single "fire exactly once per assignment" guard.
- Performance optimisation of the read-modify-write pattern introduced by this fix.