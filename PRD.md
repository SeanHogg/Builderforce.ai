> **PRD** — drafted by Ada (Sr. Product Mgr) · task #749
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
Currently, there is no streamlined way to assign agents to existing manifest roles on tasks or epics. This process is manual, error-prone, and time-consuming, leading to inefficiencies in task management and potential delays in project execution.

### Goal
Develop a tool or API that allows for the assignment of an agent (by `agentRef`) to an existing manifest role on a task or epic. This will automate and simplify the assignment process, reducing errors and improving efficiency.

## Target Users / ICP Roles

- **Project Managers**: Responsible for overseeing tasks and ensuring roles are appropriately assigned.
- **Team Leads**: Need to assign team members to specific roles within tasks or epics.
- **Agents**: Require visibility and assignments to their respective roles.
- **Developers/Contributors**: May need to assign or reassign roles programmatically via API.

## Scope

### In-Scope
- **API Endpoint**: Create an API endpoint to assign an agent to a manifest role on a task or epic.
  - Endpoint: `POST /tasks/{taskId}/roles/{roleId}/assign`
  - Endpoint: `POST /epics/{epicId}/roles/{roleId}/assign`
- **Parameters**:
  - `agentRef`: Identifier for the agent to be assigned.
  - `taskId` / `epicId`: Identifier for the task or epic.
  - `roleId`: Identifier for the manifest role.
- **Validation**: Ensure the agent, task/epic, and role exist before assignment.
- **Error Handling**: Provide meaningful error messages for invalid inputs or conflicts.
- **Permissions**: Implement role-based access control to ensure only authorized users can assign agents.
- **Audit Log**: Maintain a log of all assignments for auditing purposes.

### Out-of-Scope
- **UI Component**: Development of a graphical user interface for assignment is not included.
- **Bulk Assignment**: Assigning multiple agents simultaneously is not supported.
- **Notification System**: Notifications to agents upon assignment are not part of this scope.
- **Unassignment**: Functionality to unassign agents from roles is not included.
- **Integration with External Systems**: Integration with third-party systems for agent data is not covered.

## Functional Requirements

1. **API Endpoint for Assignment**
   - Implement `POST /tasks/{taskId}/roles/{roleId}/assign` and `POST /epics/{epicId}/roles/{roleId}/assign` endpoints.
   - Accept `agentRef` as a parameter in the request body.

2. **Validation**
   - Verify that the `agentRef` exists and is active.
   - Confirm that the `taskId` or `epicId` exists.
   - Ensure that the `roleId` is valid for the specified task or epic.

3. **Error Handling**
   - Return appropriate HTTP status codes and error messages for:
     - Non-existent agents, tasks, epics, or roles.
     - Unauthorized access.
     - Conflicting assignments.

4. **Permissions**
   - Implement authorization checks to ensure the requesting user has the necessary permissions to assign agents.

5. **Audit Log**
   - Record each assignment event with details such as timestamp, user, agentRef, task/epic ID, and role ID.

## Acceptance Criteria

- The API endpoints are accessible and functional, allowing for the assignment of agents to manifest roles on tasks and epics.
- Validation checks are in place and correctly enforce the existence and validity of agents, tasks, epics, and roles.
- Error handling provides clear and actionable feedback for invalid requests or unauthorized access.
- Permissions are enforced, ensuring that only authorized users can perform assignments.
- The audit log accurately records all assignment events with the required details.
- The system handles concurrent assignments gracefully, preventing race conditions or conflicts.

## Out of Scope

- Development of a user interface for manual assignments.
- Support for bulk assignments or mass reassignments.
- Integration with external notification systems.
- Functionality to unassign agents from roles.
- Integration with third-party systems for agent data.

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