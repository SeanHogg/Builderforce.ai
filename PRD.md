> **PRD** — drafted by Ada (Sr. Product Mgr) · task #671
> _Each agent that updates this PRD signs its change below._

# PRD: Unit Tests for Task Completion Logic

## Problem & Goal

The task completion logic has been updated to handle scenarios both with and without delivered code artifacts. Currently there is insufficient test coverage to verify this logic behaves correctly across all relevant scenarios, creating risk of regressions and making the codebase harder to maintain confidently. The goal is to add comprehensive unit tests that fully exercise the completion logic, document expected behavior, and provide a safety net for future changes.

---

## Target Users / ICP Roles

- **Backend / fullstack engineers** maintaining or extending the task completion subsystem
- **QA / test engineers** reviewing coverage standards
- **CI/CD pipeline** — tests must pass automatically on every pull request

---

## Scope

All unit tests will target the task completion logic module/service (the specific module updated in the preceding task). Tests are written at the unit level (dependencies mocked/stubbed). No end-to-end or integration tests are in scope for this work item.

---

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

---

## Acceptance Criteria

1. **All new tests pass** in CI with zero failures or skipped tests (excluding intentionally pending stubs).
2. **Coverage thresholds met**: line ≥ 90%, branch ≥ 85% for the completion logic module as reported by the project's coverage tool.
3. **FR-1 through FR-3 scenarios are covered**: each requirement row above has at least one corresponding `it`/`test` block whose description references the scenario.
4. **No real I/O**: the test suite completes in under 2 seconds total and makes zero network or disk calls (verified by absence of real dependency invocations in mocks).
5. **Idempotency verified**: the double-completion test (FR-3.2) asserts that the completion record count does not increase on the second call.
6. **Error contracts verified**: negative-case tests (FR-3.3, FR-3.4) assert on the specific error type or message, not just that *an* error was thrown.
7. **PR review**: a team member other than the author has approved the test file, confirming readability and adequate scenario naming.

---

## Out of Scope

- Integration or end-to-end tests involving real databases, queues, or HTTP calls
- Tests for unrelated modules (e.g., task creation, assignment, or notification logic)
- Performance or load testing of the completion path
- UI or API-layer tests (controller/route layer tests are a separate concern)
- Migration or backfill scripts for historical task records
- Coverage enforcement for modules other than the completion logic module

---

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

---

## Repository / workspace

Your changes run against **seanhogg/builderforce.ai** (base `main`), which currently contains 400+ file(s). Top-level entries:

- `.claude/`
- `.dockerignore`
- `.github/`
- `.gitignore`
- `Builderforce.ai/`
- `CONTRIBUTING.md`
- `DONE.md`
- `Dockerfile.api`
- `Dockerfile.frontend`
- `LICENSE`
- `README.md`
- `ROADMAP.md`
- `agent-runtime/`

If these files are clearly UNRELATED to what the task asks for (e.g. the task is about a website but this repo holds none of its code), do NOT invent a conceptual answer or edit unrelated files — say so plainly in your summary, name the bound repository (seanhogg/builderforce.ai), and state that the correct repo must be bound. Explore with list_files / search_code before concluding.

---

## Files already on this branch from prior passes

A previous run already committed these files to this task's branch. They are part of the OPEN pull request. Reconcile against this list: update what's still needed, and **delete any that are dead code** — stubs, placeholders, unreferenced files, or anything that should not ship in this PR — with the delete_file tool. Do not leave orphaned files just because a prior pass created them.

- `PRD.md` (added)
- `api/src/application/task/taskLifecycle.test.ts` (added)

---

## Your Task

Add unit tests for completion logic

Write comprehensive unit tests to verify the updated task completion logic, covering scenarios with and without delivered code.