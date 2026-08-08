> **PRD** — drafted by Ada (Sr. Product Mgr) · task #802
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
The current `kanban_assess_resource` function creates an Owner role for tasks but does not correctly assign participants based on the task's `assignedUserId` or `assignedAgentRef`. This leads to incorrect role assignments and potential confusion in task management.

### Goal
Modify the `kanban_assess_resource` function to correctly identify and assign participants based on the task's `assignedUserId` or `assignedAgentRef`. This will ensure that the Owner and Participant roles are accurately populated.

## Target Users / ICP Roles

- **Project Managers**: Users who oversee tasks and need accurate role assignments for team members.
- **Team Members**: Users who are assigned tasks and need to be correctly identified as participants.
- **Administrators**: Users who manage user roles and permissions within the system.

## Scope

- **In Scope**:
  - Modify the `kanban_assess_resource` function to include logic for assigning participants.
  - Update the resolution logic to reference `assignedUserId` and `assignedAgentRef`.
  - Ensure that the Owner role is correctly assigned based on the updated logic.
  - Implement validation to ensure that the assigned user or agent exists.

- **Out of Scope**:
  - Changes to the UI for role assignment.
  - Modification of other role types beyond Owner and Participant.
  - Handling of scenarios where a task has multiple assignees or agents.

## Functional Requirements

1. **Update Resolution Logic**:
   - The function should check the `assignedUserId` and `assignedAgentRef` fields of the task.
   - If `assignedUserId` is present, use it to assign the Participant role.
   - If `assignedAgentRef` is present, use it to assign the Participant role.
   - If both are present, prioritize `assignedUserId` for Participant assignment.

2. **Assign Owner Role**:
   - The Owner role should be assigned based on existing logic, ensuring that it is not overwritten by the Participant assignment.

3. **Validation**:
   - The function should validate that the user or agent referenced by `assignedUserId` or `assignedAgentRef` exists in the system.
   - If the user or agent does not exist, the function should log an error and not assign the Participant role.

4. **Error Handling**:
   - The function should handle exceptions gracefully, ensuring that a failure in role assignment does not affect other parts of the system.

5. **Logging**:
   - All changes to role assignments should be logged for auditing purposes.

## Acceptance Criteria

- The `kanban_assess_resource` function correctly assigns the Participant role based on `assignedUserId` or `assignedAgentRef`.
- The Owner role is not affected by the changes and is correctly assigned.
- The system logs errors when the assigned user or agent does not exist.
- The system handles exceptions without crashing or affecting other functionalities.
- The changes are tested and validated in a staging environment before deployment.

## Out of Scope

- Modifications to the UI for role assignment.
- Changes to other role types (e.g., Viewer, Editor).
- Handling of tasks with multiple assignees or agents.
- Integration with external systems for user or agent validation.

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