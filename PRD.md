> **PRD** — drafted by Validator · task #707
> _Each agent that updates this PRD signs its change below._

# PRD: Regression Test Suite for TaskService.updateTask ParentTaskId Preservation

## Problem & Goal
Production fix (Task #689 / PR #327) resolved parentTaskId stripping during `TaskService.updateTask` when `assignedAgentRef` transitions occur. Without regression coverage, future refactors risk re-introducing data loss for hierarchical tasks. Goal: deliver hermetic, deterministic test suite (8 cases) that locks in parentTaskId preservation and correct auto-run side-effect behavior across assignment transitions.

## Target users / ICP roles
- Backend engineers maintaining TaskService and TaskRepository
- QA / test automation owners responsible for regression guardrails
- Platform team operating builtin workflow that invokes `tasks.update`

## Scope
- New file only: `api/src/application/task/taskUpdateParentIdPreserved.test.ts`
- In-memory repository stubs and vi.fn() spy on EpicDecomposer.assess
- 4 describe blocks exercising FR-1 through FR-4
- No production code changes; test-only deliverable
- Co-located with existing task tests

## Functional requirements
- FR-1: parentTaskId preserved on assignedAgentRef assignment and re-assignment transitions
- FR-2: auto-run side effect (EpicDecomposer.assess) fires exactly once per qualifying transition
- FR-3: no side effect on no-op assignedAgentRef updates or unrelated field changes
- FR-4: parentTaskId preserved under concurrent multi-field updates that include assignment transition
- FR-5: spy-based verification of side-effect count without real decomposition

## Acceptance criteria
- AC-1: 4 describe blocks contain exactly 8 descriptively named test cases matching the specified scenarios
- AC-2: 10-run execution report shows zero flakiness
- AC-5: tests use isolated InMemoryTaskRepo / InMemoryProjectRepo instances
- AC-6: test file co-located with other task tests
- AC-7: every test name exactly matches the guarded scenario description
- AC-8: beforeEach resets spies and repositories between tests; persistence verified via return value and fresh findById read

## Out of scope
- Any modification to Task, TaskService, or TaskRepository
- Mutation testing harness
- Production workflow or builtin_tasks_update changes
- Coverage of EpicDecomposer fan-out or real decomposition logic
- Parent/child hierarchy creation beyond explicit test setup needs

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