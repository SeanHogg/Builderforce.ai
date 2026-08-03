> **PRD** — drafted by Ada (Sr. Product Mgr) · task #681
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
When updating a task using the `tasks.update` function, the current implementation requires the `parentTaskId` to be passed, even when the task being updated is not a subtask. This requirement adds unnecessary complexity and potential for errors when updating standalone tasks.

### Goal
Modify the `tasks.update` function to allow updates without requiring the `parentTaskId` parameter when the task is not a subtask. Specifically, enable the update of a task's status and assigned agent without passing the `parentTaskId`.

## Target Users / ICP Roles

- **Developers**: Individuals or teams who integrate with the task management API.
- **Product Managers**: Users who oversee the task management process and need to update task statuses and assignments.
- **Customer Support Agents**: Users who need to update task statuses and assignments for customer-related tasks.

## Scope

### In-Scope
- Modify the `tasks.update` function to allow updates without the `parentTaskId` parameter.
- Ensure that the function can update the `status` and `assignedAgentRef` fields without requiring `parentTaskId`.
- Provide clear documentation and examples for developers on how to use the updated function.

### Out-of-Scope
- Changes to the `tasks.update` function that affect other parameters or functionalities not related to `parentTaskId`.
- Modifications to the task data model or database schema.
- Implementation of new validation rules for other parameters.

## Functional Requirements

1. **Update Function Modification**
   - The `tasks.update` function should accept an object with the following parameters:
     - `id` (string, required): The unique identifier of the task to be updated.
     - `status` (string, optional): The new status of the task (e.g., "in_progress").
     - `assignedAgentRef` (string, optional): The reference to the agent assigned to the task.
   - The `parentTaskId` parameter should be optional. If not provided, the function should assume the task is not a subtask.

2. **Error Handling**
   - If `parentTaskId` is provided and the task is not a subtask, the function should return an error.
   - If required fields are missing or invalid, the function should return an appropriate error message.

3. **API Documentation**
   - Update the API documentation to reflect the changes in the `tasks.update` function.
   - Provide examples of how to update a task without specifying `parentTaskId`.

4. **Testing**
   - Write unit tests to ensure the function behaves as expected when `parentTaskId` is omitted.
   - Ensure that existing tests for subtasks are not affected by the changes.

## Acceptance Criteria

- The `tasks.update` function can successfully update a task's `status` and `assignedAgentRef` without requiring the `parentTaskId` parameter.
- The function returns a success response when the update is completed.
- The function returns appropriate error messages when required fields are missing or invalid.
- The API documentation has been updated to reflect the changes.
- All existing tests pass, and new tests for the updated functionality are included.

## Out of Scope

- Changes to other functions or endpoints related to task management.
- Modifications to the task data model or database schema.
- Implementation of new features or functionalities beyond the scope of updating the `tasks.update` function.

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