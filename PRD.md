> **PRD** — drafted by John Coder ((V2) (Durable)) · task #679
> _Each agent that updates this PRD signs its change below._

# PRD: Fix `tasks.update` Partial-Update Semantics & `parentTaskId` Preservation

## Problem & Goal

### Problem
`tasks.update` violates partial-update (PATCH) semantics on the assignment code path. When `assignedAgentRef` is set in an update call that omits `parentTaskId`, the handler silently nulls out `parentTaskId`, detaching the task from its parent Epic. This has caused real production incidents: tasks #643, #644, #646 were detached from Epic #617 mid-sprint, requiring manual re-parenting and re-dispatch that produced duplicate executions (runs #3949, #3951, #3953 had to be cancelled).

### Goal
Enforce strict partial-update semantics across **all** `tasks.update` code paths: only fields explicitly present in the request payload may be mutated. Omitting a field is always a no-op. Additionally, verify the auto-run side effect fires exactly once per assignment.

---

## Target Users / ICP Roles

| Role | Impact |
|---|---|
| **Orchestrator Agent** | Issues `tasks.update` calls to assign child tasks; must not inadvertently restructure the task graph |
| **Coder / Executor Agents** | Receive assignment; duplicate dispatch wastes compute and produces race conditions |
| **Human Engineering Lead** | Monitors Epic/task hierarchy in the UI; silent detachment breaks sprint visibility |
| **Platform / Infra Engineers** | Own the `tasks.update` handler and persistence layer being patched |

---

## Scope

This fix is scoped to the `tasks.update` API handler and its immediate side-effect pipeline. No schema changes, no new endpoints, no UI changes.

---

## Functional Requirements

### FR-1 — Strict Partial-Update Semantics
The `tasks.update` handler **MUST** apply a merge strategy: for every field in the stored task record, retain the existing value unless that field key is explicitly present in the incoming request payload.

- "Not present in payload" → field is unchanged in the database row.
- `null` explicitly present in payload → field is set to `null` (opt-in nullification).
- This rule applies uniformly to: `parentTaskId`, `priority`, `dueDate`, `status`, `assignedAgentRef`, and all other mutable fields.

### FR-2 — Assignment Code Path Audit
The assignment/auto-run branch within `tasks.update` **MUST NOT** perform a full-row rewrite from the incoming payload. Specifically:

- Identify any location where the persisted row is constructed by spreading or mapping only from the request body (losing fields absent from the payload).
- Replace with a read-modify-write pattern: fetch current row → merge explicit payload fields → persist merged row.

### FR-3 — `parentTaskId` Preservation Under Assignment
Setting `assignedAgentRef` (with or without triggering auto-run) on a task that has a non-null `parentTaskId` **MUST** leave `parentTaskId` unchanged.

### FR-4 — Explicit Detachment Still Works
Calling `tasks.update({ id, parentTaskId: null })` **MUST** detach the task from its parent (set `parentTaskId` to `null`). Opt-in nullification must remain functional.

### FR-5 — Auto-Run Side Effect Fires Exactly Once
When `assignedAgentRef` is set and the auto-run condition is met, the execution dispatch side effect **MUST** fire exactly once per `tasks.update` call. Duplicate dispatches are a defect. The fix must audit for:

- Double invocation within the same request lifecycle (e.g., called in both pre-persist and post-persist hooks).
- Re-triggering caused by the re-dispatch that was previously required to recover from the detachment bug.

### FR-6 — No Silent Failures
If the read-modify-write merge encounters a missing or deleted task, the handler **MUST** return a structured error (e.g., `404 Task Not Found`) rather than creating a new row or swallowing the error.

---

## Acceptance Criteria

| # | Criterion | Verification Method |
|---|---|---|
| AC-1 | `tasks.update({ id, assignedAgentRef })` on a task with `parentTaskId` set → `parentTaskId` remains unchanged after the call | Automated integration test |
| AC-2 | `tasks.update` with payload omitting `priority`, `dueDate`, or `status` → those fields are not mutated | Automated integration test (parameterized across each field) |
| AC-3 | `tasks.update({ id, parentTaskId: null })` → task is detached (`parentTaskId` becomes `null`) | Automated integration test |
| AC-4 | `tasks.update({ id, assignedAgentRef })` on a parented task → auto-run dispatch fires exactly once, confirmed via dispatch log/event count | Automated integration test with dispatch spy |
| AC-5 | No duplicate execution runs are created when an agent is assigned to a child task of an Epic | Integration test asserting run count = 1 |
| AC-6 | Unit test covers the merge logic directly: given stored row with `parentTaskId=X` and payload `{ assignedAgentRef: "coder" }`, output row has `parentTaskId=X` | Unit test |
| AC-7 | Manual smoke test: reproduce original steps (Epic → child task → assign Coder) confirms hierarchy intact and single execution | QA sign-off |

---

## Out of Scope

- Changes to `tasks.create` (separate endpoint, separate validation path).
- UI rendering of the task hierarchy — this is a backend-only fix.
- Bulk update endpoints (should be audited separately in a follow-on ticket).
- Changes to Epic-level fields or Epic lifecycle logic.
- Backfilling or recovering tasks detached by the existing bug in production (handled operationally, not in this fix).
- Performance optimization of the read-modify-write pattern (acceptable latency trade-off; optimize later if needed).
- Authentication or authorization changes to `tasks.update`.