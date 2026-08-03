> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1224
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## 1. Problem & Goal

### Problem:
Task #615 (PR #309) requires implementing a PR gate for doc-only changes. The prior analysis incorrectly stated the codebase lacked the necessary components.

### Verified Finding:
The repository `seanhogg/builderforce.ai` DOES contain the BuilderForce PMO board/API codebase:
- **`api/src/domain/shared/types.ts`**: Contains `TaskStatus` enum (BACKLOG, TODO, READY, IN_PROGRESS, IN_REVIEW, DONE, BLOCKED) and `TaskType` enum (TASK, EPIC, GAP, SECURITY, INCIDENT)
- **`api/src/domain/task/Task.ts`**: Contains the Task entity with status, priority, taskType, parentTaskId
- **`api/src/application/kanban/`**: Contains progress tracking via participant states (pending, assigned, in_progress, completed)
- **`api/src/application/validation/`**: Contains ValidationService for gap detection
- **`api/src/application/manager/`**: Contains ManagerService for ticket lifecycle

The current codebase is MISSING the specific features needed for task #615:
- No `spec-ready` state in TaskStatus (needs to be added)
- No doc-only PR detection logic
- No progress capping for docs-only changes
- No distinction between coding vs non-coding task types for completion

### Goal:
Re-dispatch task #615 to a Coder for implementation now that the correct repository is confirmed.

## 2. Target Users / ICP Roles

- **Product Managers**: Responsible for overseeing the progress of tasks and ensuring the PMO board reflects accurate progress percentages.
- **Developers**: Need to implement the PR gate for doc-only changes and utilize the task state machine and progress engine.
- **QA Engineers**: Will use the Validator/Manager doc-only gate to ensure quality and compliance of doc-only changes.

## 3. Scope

### In-Scope:
- Confirm the repository `seanhogg/builderforce.ai` hosts the BuilderForce PMO board/API
- Re-dispatch task #615 to a developer for implementation
- Verify implementation covers:
  - Task progress engine modification to detect docs-only PRs
  - Task state machine with new `spec-ready` state
  - Task type taxonomy distinguishing coding vs non-coding tasks
  - Validator/Manager doc-only gate

### Out-of-Scope:
- Implementing the actual changes (this is task #615's scope)
- Modifying the PMO board beyond what's required for #615

## 4. Functional Requirements

1. **Repository Confirmation**:
   - The repository `seanhogg/builderforce.ai` is confirmed to host the BuilderForce PMO board/API
   - Located in `api/src/` directory with full application, domain, and infrastructure layers

2. **Codebase Verification**:
   - Task model: `api/src/domain/task/Task.ts` ✓
   - Task types: `api/src/domain/shared/types.ts` ✓
   - Kanban/progress: `api/src/application/kanban/` ✓
   - Validation: `api/src/application/validation/` ✓
   - Manager: `api/src/application/manager/` ✓

3. **Task Redispatch**:
   - Re-dispatch task #615 to a Coder agent for implementation

## 5. Acceptance Criteria

- ✓ Repository `seanhogg/builderforce.ai` confirmed to contain PMO board/API code
- ✓ Required components identified in `api/src/`
- ✓ Gap identified: need to add `spec-ready` state, doc-only PR detection, progress capping
- ✓ Task #615 to be re-dispatched for implementation
- ✓ PRD.md retained for traceability

## 6. Out of Scope

- Implementing the actual changes for task #615
- Creating new components not required for #615
- Addressing any issues unrelated to the doc-only PR gate

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

## Acceptance

_Owned by the validator — to be authored._
