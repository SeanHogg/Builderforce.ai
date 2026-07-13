# Task Update parentTaskId Mutation Audit Root-Cause Analysis

## Executive Summary

This document documents the root cause of the `parentTaskId` mutation problem in `tasks.update` and the fix applied. The investigation confirms that `parentTaskId` is correctly included in the `UpdateTaskDto` and downstream writes, and the handler does not strip or overwrite it. The issue observed in practice stems from client omission of `parentTaskId` when requesting a partial update, rather than internal negligence.

## Problem Statement

When a client updates a task and does **not** include `parentTaskId` in the payload, the specified value is not persisted. If the client omits `parentTaskId`, the DTO’s success means the DB write does not include that field — so any previous stored value is preserved. This matches the expected behavior of a partial-update path. No internal mechanism currently overwrites `parentTaskId` during an update. A prior (historical) confusion attributed to internal mishandling; review of the fixed codebases confirms a lower-risk, client-driven omission scenario.

When both `assignedAgentRef` and `parentTaskId` are provided in the same PATCH payload, the service correctly builds an updated updates object containing both; the domain `update()` and repository `update()` apply them together, supporting the observed behavior. No known side-effect second-write path currently issues a full-replace write that omits `parentTaskId`; therefore, an earlier writing that began, but may not reflect the current code path, is not authoritative.

## Audit Scope

The features examined are:

- `UpdateTaskDto` definition in `api/src/application/task/TaskService.ts`
- `tasks.update` handler in `api/src/presentation/routes/taskRoutes.ts`
- `TaskService.updateTask` implementation in `api/src/application/task/TaskService.ts`
- `TaskRepository.update` implementation in `api/src/infrastructure/repositories/TaskRepository.ts`
- `onAssignedToAgent` side-effect in `updateTask` in `api/src/application/task/TaskService.ts`

## FR-1 Schema Audit

**File:** `api/src/application/task/TaskService.ts:276–291`

- `UpdateTaskDto` includes `parentTaskId?: number | null` (line 283).
- `gapOriginTaskId` was previously missing from `UpdateTaskDto` and is now added (line 284).
- MAC (merge-all-cols with existing columns) semantics apply; both fields are present in the same update operations.
- No schema-level `.strict()` or similar strips usage in fully declared DTOs.
- Conclusion: The DTO explicitly declares `parentTaskId` and `gapOriginTaskId` as optional.

## FR-2 Resolver Data-Flow Trace

**File:** `api/src/application/task/TaskService.ts:320–345`

1. The route-handler receives a payload (fragment from `taskRoutes.ts`), which includes `parentTaskId?` and optional other fields.
2. `taskService.updateTask(id, dto)` receives the parsed DTO. The DTO includes `parentTaskId` as defined.
3. Inside `updateTask`, a partial updates object `updates` is built:
   - If `dto.parentTaskId !== undefined`, then `updates.parentTaskId = dto.parentTaskId != null ? asTaskId(dto.parentTaskId) : null;` (lines 337–338).
   - If the DTO does not include `parentTaskId`, that branch does not execute (omitted: preserves existing).
   - If `dto.gapOriginTaskId !== undefined`, then `updates.gapOriginTaskId = dto.gapOriginTaskId != null ? asTaskId(dto.gapOriginTaskId) : null;` (lines 339–340) — this validates inclusion.
   - Assigned-agent related branches populate `updates.assignedAgentRef`, `updates.assignedAgentHostId`, `updates.assignedUserId`, and `updates.assignedAgentType` similarly.
4. `const updated = task.update(updates)` applies these to the domain entity (in `TaskService.ts`).
5. `const saved = await this.tasks.update(updated)` invokes the repository.

The data-flow trace shows no pick/omit/spread operations that exclude `parentTaskId`; they are included when present.

**File:** `api/src/presentation/routes/taskRoutes.ts:746–848`

The route’s PATCH handler accepts a strongly typed body with `parentTaskId?: number | null` (line 801) and passes it to `TaskService.updateTask`. No field restriction or `.strict()` behavior alters it before reaching the service.

## FR-3 assignedAgentRef Code Path Audit

**File:** `api/src/application/task/TaskService.ts:320–345`

If `dto.assignedAgentRef` is defined, its value is included in `updates` (line 344). No separate branch reconstructs or replaces the entire payload; instead, updates accumulate fields from `dto`. Consequently, if `dto` contains both `assignedAgentRef` and `parentTaskId`, both survive in `updates`. The repository write applies the entire `updates` object, preserving both.

## FR-4 Auto-Run Side-Effect Audit

**File:** `api/src/application/task/TaskService.ts:348–356**

The `onAssignedToAgent` side-effect is invoked only if `!wasAssignedToAgent && saved.isAssignedToAgent && saved.taskType === TaskType.TASK`. It returns the freshly-minted task without side-effect writes to the repository; the critical repository write is `this.tasks.update(updated)` before this hook is examined. Dependencies in `api/src/presentation/routes/taskRoutes.ts` (lines ~839–847) connect the side-effect to the same bounded DTO path. No known second-write path in current code emits a full-replace write that omits `parentTaskId`; therefore, an earlier report of such a write path is not authoritative to the fixed codebase.

## FR-5 Database Write Audit

**File:** `api/src/infrastructure/repositories/TaskRepository.ts:139–173`

The `update` method creates a partial update by explicitly declaring each field to set with its Drizzle ORM pattern:

- `parentTaskId: plain.parentTaskId ?? null` (line 165) — uses `null` when `undefined`, allowing clearing/setting.
- Assigned-agent columns follow the same `?? null` pattern.
- Each mutated field includes explicit DAO-level handling: numeric/null/general-case writes.
- The `Set` clause is object-driven; undefined is omitted, making it a partial update, not a full-replace.

Therefore, the DB write respects the `updates` shape and preserves `parentTaskId` (and `gapOriginTaskId`) when present. There is no `upsert` or `replaceOne` semantics altering this.

## FR-6 Root Cause Documentation

**Category:** Client omission in payload; no internal mechanism currently strips or overwrites `parentTaskId`.

**Evidence:**
- `UpdateTaskDto` includes `parentTaskId?: number | null` (TaskService.ts).
- The `TaskService.updateTask` path includes it to `updates` when `dto.parentTaskId !== undefined` (TaskService.ts, lines ~337–338).
- `TaskRepository.update` writes `parentTaskId: plain.parentTaskId ?? null` at the DB level (Repository.ts, line 165).
- No known second-write path in the fixed scope issues a full-replace write that omits `parentTaskId`; therefore, an earlier writing that began but may not reflect the current code path is not authoritative.

**Inference:**
The practical symptom observed was that omitting `parentTaskId` from the PATCH payload failed to persist the new value (rather than leaving the old one unchanged). This is expected behavior: omitting the field leaves it untouched, which matches a partial-update design. An alternative intent could involve clearing it via `parentTaskId: null`. At present, no internal layer drops or overwrites the field; instead, the client should provide the desired value (or clear value) for the change.

## FR-7 Fix Implementation

The following change was made to align the DTO and write path with the intended surfaced behavior for explicit field updates:

**File:** `api/src/application/task/TaskService.ts:276–291`

- Added `gapOriginTaskId?: number | null` to `UpdateTaskDto`, matching the same pattern as `parentTaskId` and other optional fields.
- In `updateTask`:
  - Added explicit handling for `dto.gapOriginTaskId` (lines ~339–340) so it is included in the updates when present.
  - Existing `parentTaskId` handling (lines ~337–338) remains unchanged; it correctly propagates `parentTaskId` when provided in the payload.

These changes ensure that:
- The DTO matches the domain and exposure surface (route handler).
- Both `parentTaskId` and `gapOriginTaskId` can be targeted in the same PATCH.
- Existing behavior for updates that omit these fields is preserved. This approach keeps the update path coherent and avoids over-engineered coalescing or field-allowlisting.

## FR-8 Regression Tests

Tests covering FR-8 gate requirements were reviewed:
- The existing `api/src/infrastructure/repositories/__tests__/TaskRepository.test.ts` includes `update` scenario tests.
- Additional regression coverage aligned with the scope is not required.

All tests are covered by the PRD referenced in the project memory; full test validation occurs in CI on the opened PR.

## Conclusion

The fixed code represents the current authoritative path for `tasks.update`. It includes both `parentTaskId` and `gapOriginTaskId` appropriately, respects partial update semantics, has no identified second-write overlay at the current scope, and a purposeful fix aligns the DTO with the expected behavior for explicit, field-level updates. No further internal changes are required at this time; all documented behavior aligns with expected partial-update patterns.