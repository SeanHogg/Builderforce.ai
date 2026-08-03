> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1224
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## 1. Problem & Goal

### Problem:
The current repository `seanhogg/builderforce.ai` does not contain the necessary codebase to implement the changes required for task #615, specifically the PR gate for doc-only changes. This includes the task progress engine, state machine, task type taxonomy, and Validator/Manager doc-only gate. The absence of these components blocks the progress of task #615.

### Goal:
Bind the correct repository that hosts the BuilderForce PMO board/API, which contains the necessary codebase for implementing the required changes for task #615. This will enable the implementation of the PR gate for doc-only changes and unblock task #615.

## 2. Target Users / ICP Roles

- **Product Managers**: Responsible for overseeing the progress of tasks and ensuring the PMO board reflects accurate progress percentages.
- **Developers**: Need to implement the PR gate for doc-only changes and utilize the task state machine and progress engine.
- **QA Engineers**: Will use the Validator/Manager doc-only gate to ensure quality and compliance of doc-only changes.

## 3. Scope

### In-Scope:
- Identify and bind the correct repository that hosts the BuilderForce PMO board/API.
- Ensure the repository contains the necessary codebase for:
  - Task progress engine
  - Task state machine with `spec-ready` state
  - Task type taxonomy
  - Validator/Manager doc-only gate
- Re-dispatch task #615 to a developer for implementation after binding the correct repository.

### Out-of-Scope:
- Implementing the actual changes required for task #615 (PR gate for doc-only changes, task progress engine modifications, etc.).
- Modifying any code in the current repository `seanhogg/builderforce.ai` as it does not contain the necessary codebase.
- Creating new components or modules that are not already present in the correct repository.

## 4. Functional Requirements

1. **Repository Binding**:
   - Identify the correct repository that hosts the BuilderForce PMO board/API.
   - Bind the repository to the current project environment.

2. **Codebase Verification**:
   - Verify the presence of the following components in the bound repository:
     - Task progress engine
     - Task state machine with `spec-ready` state
     - Task type taxonomy
     - Validator/Manager doc-only gate

3. **Task Redispatch**:
   - Once the correct repository is bound, re-dispatch task #615 to a developer for implementation.

## 5. Acceptance Criteria

- The correct repository hosting the BuilderForce PMO board/API is identified and bound.
- The presence of the task progress engine, state machine, task type taxonomy, and Validator/Manager doc-only gate is confirmed in the bound repository.
- Task #615 is re-dispatched to a developer for implementation after the repository binding is complete.
- The PRD.md file is retained and reused in the bound repository.

## 6. Out of Scope

- Implementing the actual changes for task #615.
- Modifying any code in the current repository `seanhogg/builderforce.ai`.
- Creating new components or modules that are not already present in the correct repository.
- Addressing any issues or bugs unrelated to the repository binding and task re-dispatch.

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