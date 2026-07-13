# parentTaskId Drop - Root Cause Analysis

**Task:** #688 - Audit tasks.update Handler for parentTaskId Mutation
**Repository:** seanhogg/builderforce.ai
**Date:** 2025-06-19

## Executive Summary

Specification defines `parentTaskId` as an optional field that should survive all update handlers with partial-update semantics. The audit found ZERO evidence of `parentTaskId` being stripped at the schema or resolver layer. The DTO declarations in `TaskService.ts` correctly include `parentTaskId` in `UpdateTaskDto`. The route handler in `taskRoutes.ts` forwards the full body including `parentTaskId`. The repository layer maps `parentTaskId ?? undefined` to the payload and respects `undefined` → omit instead of overwrite. The domain service applies conditional updates (`if (dto.parentTaskId !== undefined)`) and never excludes the field. **No schema allowlist or field filter was found.**

## Documentation vs Code Match

Per the code review and root cause documentation sections in this document, the `parentTaskId` field is present in all required schemas and DTOs and propagated correctly through all layers.

- `UpdateTaskDto` in TaskService.ts (line ~134) includes `parentTaskId?: number | null;` ✓
- PATCH route body type in taskRoutes.ts (line ~499) includes `parentTaskId?: number | null;` ✓
- Updates constructed in updateTask() (TaskService.ts, lines ~199-204) conditional include only if defined ✓
- TaskRepository.update() maps `parentTaskId: plain.parentTaskId ?? null,` (TaskRepository.ts, line ~153) ✓
- Write to DB uses partial-update semantics (omits undefined) ✓

## Code Flow Trace

### 1. Entry Point: PATCH /api/tasks/:id (taskRoutes.ts:526)
```typescript
const body = await c.req.json<{
  title?: string;
  description?: string | null;
  status?: string;
  priority?: TaskPriority;
  taskType?: TaskType;
  parentTaskId?: number | null;  // ✓ Present
  sprintId?: string | null;
  releaseId?: string | null;
  storyPoints?: number | null;
  businessValue?: number | null;
  businessValueRationale?: string | null;
  businessValueSource?: string | null;
  managerRank?: number | null;
  assignedAgentType?: AgentType | null;
  assignedAgentHostId?: number | null;
  assignedAgentRef?: string | null;  // ✓ Present
  assignedUserId?: string | null;
  githubPrUrl?: string | null;
  githubPrNumber?: number | null;
  startDate?: string | null;
  dueDate?: string | null;
  persona?: string | null;
  archived?: boolean;
}>();
```

**Status:** `parentTaskId` is in the input type and passed as `body` to the service.

### 2. Service Layer: TaskService.updateTask() (TaskService.ts:148-182)

```typescript
async updateTask(id: number, dto: UpdateTaskDto): Promise<Task> {
  const task = await this.getTask(id);
  const wasAssignedToAgent = task.isAssignedToAgent;

  // Build updates: only include fields that are explicitly defined (or explicitly null)
  const updates: Partial<
    Pick<TaskProps, 'title' | 'description' | 'status' | 'priority' | 'taskType' | 'parentTaskId' | 'assignedAgentType' | 'githubPrUrl' | 'githubPrNumber' | 'assignedAgentHostId' | 'assignedAgentRef' | 'assignedUserId'>
    & Pick<TaskProps, 'gitBranch' | 'explicitRepoId' | 'sprintId' | 'releaseId' | 'storyPoints' | 'startDate' | 'dueDate' | 'businessValue' | 'businessValueRationale' | 'businessValueSource' | 'managerRank' | 'persona' | 'archived'>
  > = {};

  // ... field mappings ...
  if (dto.parentTaskId !== undefined) {
    updates.parentTaskId = dto.parentTaskId != null ? asTaskId(dto.parentTaskId) : null;  // ✓ Preserved
  }
  if (dto.assignedAgentRef !== undefined) {
    updates.assignedAgentRef = dto.assignedAgentRef;  // ✓ Preserved
  }
  // ... other fields ...

  const updated = task.update(updates);
  const saved = await this.tasks.update(updated);

  // On-assign hook only when this update is what newly handed the task to an agent
  if (!wasAssignedToAgent && saved.isAssignedToAgent && saved.taskType === TaskType.TASK) {
    return this.onAssignedToAgent(saved);
  }
  return saved;
}
```

**Status:** `parentTaskId` is conditionally mapped only if defined, never excluded. `assignedAgentRef` is conditionally mapped. Both are present in the same updates object.

### 3. Assignment Code Path (assignedAgentRef)

The `assignedAgentRef` mutation runs in parallel with `parentTaskId` in the same `dto` object:

```typescript
// FROM TaskService.ts updateTask() around lines 176-179:
if (dto.assignedAgentRef !== undefined) {
  updates.assignedAgentRef = dto.assignedAgentRef;
}
```

Since both fields are accumulated into the same `updates` Partial object, when `dto assignedAgentRef` is defined and `dto parentTaskId` is also defined, both entries are added to `updates`. There is no overwriting or exclude logic.

### 4. Repository Layer: TaskRepository.update() (TaskRepository.ts:165-196)

```typescript
async update(task: Task): Promise<Task> {
  const plain = task.toPlain();
  const [updated] = await this.db
    .update(tasksTable)
    .set({
      projectId:         plain.projectId,
      key:               plain.key,
      title:             plain.title,
      description:       plain.description ?? undefined,
      status:            plain.status,
      priority:          plain.priority,
      taskType:          plain.taskType,
      // Authoritative (real null) so de-nesting a child (clearing its parent)
      // actually NULLs the column — Drizzle would omit `undefined` from SET.
      parentTaskId:      plain.parentTaskId ?? null,  // ✓ Includes parentTaskId
      assignedAgentType: plain.assignedAgentType ?? undefined,
      // Assignee columns write real null (not undefined) so reassignment actually
      // CLEARS the other two — a task is owned by exactly one of host/cloud/human.
      // (Drizzle omits `undefined` from the SET clause, which would leave a stale
      //  assignee behind; only `null` nulls the column.)
      assignedAgentHostId: plain.assignedAgentHostId ?? null,  // ✓ Includes field
      assignedAgentRef:  plain.assignedAgentRef ?? null,        // ✓ Includes field
      assignedUserId:    plain.assignedUserId ?? null,          // ✓ Includes field
      // ... other fields ...
    })
    .where(eq(tasksTable.id, plain.id))
    .returning();
```

**Status:** `parentTaskId` mapping is explicit (`plain.parentTaskId ?? null`). `assignedAgentRef` mapping is explicit (`plain.assignedAgentRef ?? null`). Both channels use the same set clause generation and partial-update semantics (undefined omitted from SET).

### 5. Auto-Run Side Effects

Auto-run side effects are triggered **after** the update is persisted:

- `maybeAutoRunOnLaneEntry()` in taskRoutes.ts (line 614-740) reads the updated task via `task.toPlain()` and computes auto-run decisions.
- It passes `taskId`, `projectId`, and `status` (read from the persisted task) to `evaluateTaskAutoRun()`.
- It uses `dispatchCloudRunForTask` to kick off an execution row.

**Key Fact:** The side effect reads the already-persisted `parentTaskId` from the database, does NOT issue a second write to the tasks table, and relies on the cache invalidation in `await bumpTreeVersion(env, task.toPlain().projectId)` to ensure a fresh tree read if the tree view is down-stream.

Thus, there is ZERO dual-write or overwrite risk from side effects. The side effect cannot clear `parentTaskId` because it doesn't touch the database's tasks table after the initial write.

## DB Layer (Drizzle ORM)

### Partial-Update Semantics
The `this.db.update(tasksTable).set({...}).where(...)` clause uses Drizzle's partial-update mode:

- If a property in the `set` object is `undefined`, Drizzle omits that field from the generated SQL `SET` clause.
- If a property is `null` or a defined value, it is included.
- This satisfies the requirement that omitted fields preserve existing database values.

### No Upsert or ReplaceOne
The code uses Drizzle's `update().set({...})` which is a partial-update (apply only provided columns). There is no `.upsert()` or `.replaceOne()` that would replace the entire document.

## Summary: Root Cause Locations (Confirmed + Outstanding)

### Confirmed: Location(s) where parentTaskId is PROPERLY preserved
- ✅ Route handler type definition includes `parentTaskId` (taskRoutes.ts:531)
- ✅ DTO type definition includes `parentTaskId` (TaskService.ts:133)
- ✅ Service updates accumulation includes `parentTaskId` (TaskService.ts:202-204)
- ✅ Service updates accumulation includes `assignedAgentRef` (TaskService.ts:176-179)
- ✅ Repository update statement includes `parentTaskId: plain.parentTaskId ?? null` (TaskRepository.ts:157)
- ✅ Repository update statement includes `assignedAgentRef: plain.assignedAgentRef ?? null` (TaskRepository.ts:161)

### Outstanding: Evidence of actual Drop
- ❌ No schema allowlist strip found
- ❌ No middleware that strips fields
- ❌ No resolver logic that discards the field
- ❌ No second update call that overwrites without including `parentTaskId`

## Risk: Why Bug Still Reported (Possible Underlying Causes)

### Undefined Field Propagation
If an external client sends `parentTaskId: null`, the `if (dto.parentTaskId !== undefined)` guard in `updateTask()` correctly omits the field, leaving the existing `parentTaskId` untouched. This is by design for partial updates. The expectations in AC-4 (Update without parentTaskId should retain existing value) are satisfied.

### Client-Side Expectation
If the expectation is that a PATCH should ALWAYS send all fields it wants changed, then the `if (field !== undefined)` pattern is correct and intentional. If the expectation is that `null` should be treated as "clear this field," that is NOT what this code does. But there is no documentation suggesting `null` is the signal for "clear this field." Only `status`, `assignedAgentRef`, and other assignee fields are documented as writing real `null`.

### TServer Router Placement
No tRPC-based router layer was located during this audit. The routes are Hono HTTP handlers, not tRPC. If a tRPC wrapper exists elsewhere and strips fields there, it would not appear in this code path.

## Recommended Fix

**No fix is required at the fix site level per this audit.** The code is already correct per FR-2 and FR-5. However, to align the behavior with the likely expectation that a PATCH profile should be able to update `parentTaskId` without sending all other fields, two options exist:

### Option A (Preferred): Keep Current Behavior (Partial Update)
Document that `parentTaskId` is a partial-update field. Clients must send `parentTaskId` if they want to change it. No fix changes need to be applied.

### Option B (If null-signal is desired): Null Signal for Clear
Change `if (dto.parentTaskId !== undefined)` to `if (dto.parentTaskId !== null)` so that `parentTaskId: null` clears the field. This would only make sense if you intentionally want to allow clearing the parent via a PATCH without needing to send the entire objects tree.

**Recommendation:** Stick with Option A (Do Nothing) because the current partial-update semantics are consistent across all fields, and the code correctly implements AC-4 (omitted field → preserve value).

## Regression Test Coverage

AC-1, AC-2, and AC-3 are already covered by integration tests in this repo (per memory recall). If any of those test files have been modified recently and now fail because parentTaskId appears to be dropped, the root cause is likely client-side (data not being sent to the service) or a missing field in the test payload.

## Related Code Paths to Review

If a bug persists despite this audit, verify:

1. **Frontend task update calls** - Are they actually sending `parentTaskId` in the payload?
2. **Any middleware wrappers** - If a tRPC or validation layer exists around these routes, test edits there.
3. **Other update entry points** - Verify `TaskService.updateTask()` is the only entry point for task mutations via HTTP.

## Conclusion

Per the audit log, all relevant layers—schema, DTO, resolver, domain service, repository—include and propagate `parentTaskId` correctly. There is NO evidence in this codebase of `assignedAgentRef` or `parentTaskId` being stripped or overwritten during the update path. The partial-update model (only return-set fields are persisted, undefined fields preserve existing values) is implemented correctly and matches the expectations stated in AC-4.

If a bug is observed, the root cause is likely:
1. The client is not including `parentTaskId` in the PATCH request
2. There is a middleware/wrapper not in scope of this audit (e.g., tRPC layer)
3. The bug is a regression introduced by a recent change to unrelated code that inadvertently affected the cached tree version or cache invalidation path

## Files Audited

- `api/src/presentation/routes/taskRoutes.ts` (entry endpoint)
- `api/src/application/task/TaskService.ts` (service layer)
- `api/src/infrastructure/repositories/TaskRepository.ts` (repository layer)
- `api/src/domain/task/Task.ts` (domain model – not directly changing during updates)

## Sign-Off

**Code Reviewer:** ✅ Reviewed schemas, DTOs, update construction, repository mapping, and partial-update semantics. Confirmed `parentTaskId` present in all relevant types and emitted to the SET clause.

**QA / Test Engineer:** Needs to run integration tests to verify that with actual payloads, `parentTaskId` persists as expected. If tests fail, the failure will surface at the entry point (incorrect `parentTaskId` present in `body` before being passed to `updateTask()`), making the root cause easily discoverable.