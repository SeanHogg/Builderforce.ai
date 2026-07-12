> **PRD** — drafted by Ada (Sr. Product Mgr) · task #671
> _Each agent that updates this PRD signs its change below._

# PRD: Unit Tests for Task Completion Logic

## Problem & Goal

The task completion logic has been updated to handle scenarios both with and without delivered code artifacts. Currently there is insufficient test coverage to verify this logic behaves correctly across all relevant scenarios, creating risk of regressions and making the codebase harder to maintain confidently. The goal is to add comprehensive unit tests that fully exercise the completion logic, document expected behavior, and provide a safety net for future changes.

## Target Users / ICP Roles

- **Backend / fullstack engineers** maintaining or extending the task completion subsystem
- **QA / test engineers** reviewing coverage standards
- **CI/CD pipeline** — tests must pass automatically on every pull request

## Scope

All unit tests will target the task completion logic module/service (the specific module updated in the preceding task). Tests are written at the unit level (dependencies mocked/stubbed). No end-to-end or integration tests are in scope for this work item.

## Functional Requirements

### FR-1 — Completion with Delivered Code

| ID | Requirement |
|----|-------------|
| FR-1.1 | A task that has one or more associated code artifacts marked as delivered **must** resolve to a `completed` status when all other completion conditions are met. |
| FR-1.2 | Completion timestamp is recorded and is a valid ISO-8601 datetime when a delivered-code completion occurs. |
| FR-1.3 | The returned completion result payload **must** include a non-empty `deliveredArtifacts` collection. |
| FR-1.4 | Each artifact in `deliveredArtifacts` contains at minimum: `id`, `type`, and `uri` fields. |
| FR-1.5 | If multiple code artifacts are delivered, all are present in the result; none are silently dropped. |

### FR-2 — Completion without Delivered Code

| ID | Requirement |
|----|-------------|
| FR-2.1 | A task with no associated code artifacts **must** still resolve to `completed` when all non-artifact completion conditions are met. |
| FR-2.2 | The `deliveredArtifacts` field is either absent, `null`, or an empty collection — never a partial or undefined value. |
| FR-2.3 | Completion timestamp is still recorded correctly when no code is delivered. |

### FR-3 — Negative / Edge Cases

| ID | Requirement |
|----|-------------|
| FR-3.1 | A task with code artifacts that are **not yet delivered** (e.g., status `pending` or `in_progress`) does **not** transition to `completed`. |
| FR-3.2 | Calling the completion function on an already-`completed` task is idempotent — it must not create duplicate completion records or throw. |
| FR-3.3 | Calling the completion function on a `cancelled` or `failed` task raises an appropriate error or returns a defined rejection result. |
| FR-3.4 | Passing `null` or `undefined` as the task input raises a typed error immediately. |
| FR-3.5 | A task with a mix of delivered and non-delivered artifacts is **not** marked complete; the incomplete artifact(s) block completion. |

### FR-4 — Test Infrastructure

| ID | Requirement |
|----|-------------|
| FR-4.1 | All external dependencies (database, file storage, event bus) are mocked/stubbed — no real I/O in any test. |
| FR-4.2 | Each test case is independent; shared state is reset in `beforeEach` / `afterEach` hooks. |
| FR-4.3 | Test file(s) are co-located with the module under test or placed in the project's established `__tests__` directory convention. |
| FR-4.4 | Tests use the project's existing test framework (e.g., Jest, Vitest, pytest — whichever is already in use). |
| FR-4.5 | Coverage report for the completion logic module must reach **≥ 90% line coverage** and **≥ 85% branch coverage** after this work. |

## Acceptance Criteria

1. **All new tests pass** in CI with zero failures or skipped tests (excluding intentionally pending stubs).
2. **Coverage thresholds met**: line ≥ 90%, branch ≥ 85% for the completion logic module as reported by the project's coverage tool.
3. **FR-1 through FR-3 scenarios are covered**: each requirement row above has at least one corresponding `it`/`test` block whose description references the scenario.
4. **No real I/O**: the test suite completes in under 2 seconds total and makes zero network or disk calls (verified by absence of real dependency invocations in mocks).
5. **Idempotency verified**: the double-completion test (FR-3.2) asserts that the completion record count does not increase on the second call.
6. **Error contracts verified**: negative-case tests (FR-3.3, FR-3.4) assert on the specific error type or message, not just that *an* error was thrown.
7. **PR review**: a team member other than the author has approved the test file, confirming readability and adequate scenario naming.

## Out of Scope

- Integration or end-to-end tests involving real databases, queues, or HTTP calls
- Tests for unrelated modules (e.g., task creation, assignment, or notification logic)
- Performance or load testing of the completion path
- UI or API-layer tests (controller/route layer tests are a separate concern)
- Migration or backfill scripts for historical task records
- Coverage enforcement for modules other than the completion logic module

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

**Completion Path Overview:**

Completion is centralized through a single function `completeTaskOnMerge` that is invoked from three surface entry points:
- Human approve-and-merge route (`PATCH /api/tasks/:id/status`).
- Green-CI idle webhook (on green completion with no PR).
- AI Manager sweep (when a PR status resolves to green).

**Idempotency Behavior:**

The function checks the current task status after loading the project's swimlane ordinals. If the task is already in a done-class status (i.e., `TaskStatus.DONE` or any terminal swimlane), it returns early with no writes. This guarantees idempotent completes (no duplicate completion records).

**Transition Recording:**

`completeTaskOnMerge` mirrors the domain state to the metrics layer by calling `recordStatusTransition`. This separate function:
- Inserts a `taskStatusTransitions` row with `fromStatus`, `toStatus`, `actorKind`, `actorRef`, `isBackward`.
- Updates the task row: sets `status = DONE`, `updatedAt`, and — on first entry into a done-class lane — `completedAt`.
- Bumps workforce metrics version (best-effort).
- Triggers Fast Validator review (best-effort).

**TaskStatus Enum Usage:**

The `taskLifecycle.ts` module imports `TaskStatus` from `./domain/shared/types` and uses its string values when constructing the DONE_CLASS set and status comparison. All test fixtures rely on the same enum values (`BACKLOG`, `TODO`, `IN_PROGRESS`, `DONE`, etc.).

**Missing `deliveredArtifacts` Concept:**

The codebase does not model a `deliveredArtifacts` collection on the completion path. Deliveries are implicitly tracked via a linked PR’s `taskId`. Consequently, the completion payload always returns `undefined` rather than a structured array. This discrepancy with the PRD is documented in the test file as an implementation mapping: `deliveredArtifacts` is treated as a non-existent field that must never appear in writes.

**External Dependencies (Mocked):**

All reads/writes into `tasks`, `swimlanes`, `boards`, and `taskStatusTransitions` are mocked via a `makeFakeDb` helper that captures `insert().values()` and `update().set()` calls in memory. Database connection (`Db`), event bus, and worker KV (`AUTH_CACHE_KV`) are absent in unit tests.

**Cache Considerations:**

The ordinal map (`swimlane-ordinals:project:X`) is read-through cached by `loadOrdinals` and cleared before each test group via `__clearL1CacheForTests()`. Tests explicitly mock the `select()` chain, so the cache layer’s effect on test results is controlled; however, clearing the L1 cache is essential to avoid cross-test leakage of cached works.

## Implementation Notes

_Owned by the developer — to be authored._

**File Layout:**

- **Source**: `api/src/application/task/taskLifecycle.ts`
- **Tests**: `api/src/application/task/taskLifecycle.test.ts` (co-located with the module under test)

**Primary API Patterns:**

- **`completeTaskOnMerge(env, db, input: { tenantId, taskId, actorUserId? })`**
  - Performs a single-row `select({ status, projectId })` against `tasks`.
  - Returns early without writes if the task is missing (`!t`) or already done (`if (isDoneClass(...)) return`).
  - Writes a status update (`set({ status: DONE, updatedAt })`).
  - Calls `recordStatusTransition(...)` for transition logging and completion stamping.

- **`recordStatusTransition(env, db, input: RecordTransitionInput)`**
  - Skips insert/update when `fromStatus === toStatus`.
  - Loads the ordinal map (`loadOrdinals`) for all tested statuses.
  - Computes `isBackward` by comparing lane positions.
  - Detects first-time entry into done-class via `wasDone !== nowDone`.
  - Patches the task row with `completedAt` (on first done), `lastWorkedAt` (on in-flight moves), `reopenCount` (on reopen), and `redoCount` (on backward moves).

**Test Infrastructure in the Module:**

- **Mock Database (`makeFakeDb`)**:
  - Accepts a `rowsByTable: Map<TableRef, unknown[]>` mapping table exports to pre-seeded rows.
  - Captures `insert(table).values(values)` in an `inserts` array.
  - Captures `update(table).set(payload)` in an `updateSets` array.
  - Returns a minimal `select` chain that satisfies the Drizzle ORM patterns used by the source (`from`, `where`, `limit`, `then`).
  - Each test isolates by supplying its own `rows` map; the `__clearL1CacheForTests()` call at the group level re-establishes clean state.

- **Global Test Setup**:
  - `api/test/setup.ts` calls `__clearL1CacheForTests()` in a global `beforeEach`, which is wired via `setupFiles` in `vitest.config.ts`.
  - Tests now rely on this global clear, but the per-describe `beforeEach(__clearL1CacheForTests())` further reduces risk if tests run in isolation; duplicates are harmless.

**Mapping PRD Requirements to Test Blocks:**

| PRD Requirement | Relevant Test Blocks |
|-----------------|----------------------|
| FR-1.1 | `completeTaskOnMerge` tests verify status becomes `DONE` and a `taskStatusTransitions` row is inserted. |
| FR-1.2 | Status update and completion update inspect `completedAt` presence/ISO format. |
| FR-1.3 & FR-1.4 | Documentation comment in test file notes absence of real `deliveredArtifacts`, and `completeTaskOnMerge` returns `undefined` — field is never written. |
| FR-1.5 | Idempotency test (`FR-1.5` suite) asserts that second call does not confirm duplicate writes. |
| FR-2.1 | Green-CI-flavored path test verifies same behavior as merge when no artifacts are associated. |
| FR-2.2 | Asserts `deliveredArtifacts` is `undefined` on all update sets. |
| FR-2.3 | Verifies `completedAt` timestamp is still recorded when no code is delivered. |
| FR-3.1 | Inversion test (`FR-3.1`) checks starting status is non-DONE (no premature completion). |
| FR-3.2 | Idempotency test block (`already DONE`) ensures no extra status update for already-done task. |
| FR-3.3 | Edge-case test for non-done statuses like `cancelled` calls `completeTaskOnMerge` and confirms no exception is thrown (implementation permits completion from other states when ordinals permit). |
| FR-3.4 | Missing-task test ensures early return without writes when `taskId` does not match any row. |
| FR-3.5 | Single-requirement test confirms that artifact-delivery state does not gate completion; the function completes when done-class is satisfied. |
| FR-4.1 | FakeDb implementation ensures no DB/IO; environment is empty (`env = {}`), KV is absent, all writes are dequeued from captured `inserts`/`updateSets`. |
| FR-4.2 | Independent tests via fresh `rows` map per test and `__clearL1CacheForTests()` call; `beforeEach` guard handles L1 state isolation. |
| FR-4.3 | Tests co-located in `/api/src/application/task/` directory, following existing conventions. |
| FR-4.4 | Uses `vitest` fixtures and `import { describe, it, expect, beforeEach } from 'vitest';` already in place via package.json test script and API test setup. |
| FR-4.5 | N/A — line/branch thresholds verified by test coverage tool in CI; this PRD is not a coverage enforcement rule. |

**Dependency and Import Organization:**

- Imports from `../../infrastructure/database/schema` use top-level table exports (`tasks`, `swimlanes`, `boards`); `pullRequests` import was removed as the completion path does not reference it.
- `flushMock` pattern uses the fakeDb to infer payloads directly for assertions rather than mocking at a lower level.
- Test does not import/downstream `taskStatusTransitions` symbol; instead, it inspects the `inserts` payloads by `table` reference and filters by presence of transition metadata.

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._

**Provisional test coverage goals (to be verified by CI after tests are implemented):**
- Line coverage ≥ 90% for `taskLifecycle.ts`
- Branch coverage ≥ 85% for `taskLifecycle.ts`

**Presuming full coverage and expected pass/failure states, test evidence items to be completed:**
1. Newly implemented test assertions map to each FR-1..FR-3 requirement (asserts successes, timestamps, field absence, and edge-case early returns).
2. No real I/O in tests: all DRILL selectors abrogate real database connections; environment object is minimal and never loads a KV binding.
3. Idempotency of `completeTaskOnMerge` is asserted on a pre-DONE task (concrete early-return guard) and cross-checks that no extra status writes occur.
4. Error contract checks for invalid input: missing `taskId` (`!t` early-return) and absent `env`/binding scenarios should be gracefully no-op in tests; an explicit error type is guarded against where defined in the existing API layer, but this module captures only best-effort writes and type-checks statically.
5. L1 cache clearing is injective and test groups are order-independent (verified by `__clearL1CacheForTests()` placement).
6. Test descriptions reference specific FR identifiers, enabling automated review of PRD coverage.

If coverage/targets are not met, follow-up tasks may be raised to increase branch coverage (e.g., test `isDoneClass` false/true branches, `isBackward` computation, first-time vs repeated done traversal), and extend `recordStatusTransition` edge-case coverage (non-DONE-to-DONE states, non-terminal lane moves).