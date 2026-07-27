> **PRD** — drafted by Validator · task #747
> _Each agent that updates this PRD signs its change below._

# PRD: Regression Test for tasks.update parentTaskId Preservation

## Problem & Goal
A dead stub test file left coverage gaps for `tasks.update` parentTaskId preservation, risking hierarchy regressions. Goal: replace with complete in-memory infrastructure tests that validate preservation across scenarios while removing unused imports and side-effect dependencies.

## Target users / ICP roles
Internal platform engineers and QA automation roles responsible for task/goal domain integrity.

## Scope
- Delete `api/src/application/task/taskUpdateParentIdPreserved.test.ts`
- Clean unused import in `api/src/infrastructure/tests/goal/restrictions/tasks/parentTaskIdPreserved.test.ts`
- Confirm existing suite covers FR-1–FR-4 with descriptive names, beforeEach spy resets, and pure in-memory execution

## Functional requirements
- FR-1: Preserve parentTaskId on direct task update with no parent change
- FR-2: Preserve parentTaskId when updating unrelated task fields
- FR-3: Preserve parentTaskId under goal restriction context
- FR-4: Ensure no side-effect calls occur during preservation checks

## Acceptance criteria
- AC-1: Every test name clearly references its exact scenario
- AC-5: All tests run purely in-memory with no external service dependencies or undefined calls
- AC-6: Test suite implements FR-1–FR-4
- AC-7: Descriptive naming used for each scenario
- AC-8: beforeEach resets side-effect spies before every test

## Out of scope
- Integration tests against real databases or external services
- Changes to production task update logic
- Additional test files outside the two listed paths

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