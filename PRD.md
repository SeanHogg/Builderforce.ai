> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1369
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
The Kanban signoff API is returning a 401 error ("Token has been revoked or expired") for all agent runs, preventing accountability slots from being signed. This issue affects multiple endpoints and is systemic, not specific to individual tickets. Additionally, a separate bug has been identified where creating a task without an assignee fails due to a foreign key constraint violation.

### Impact
- **Stuck Tickets**: Agents can produce deliverables but cannot record verdicts, causing tickets to remain unsigned and stuck in the workflow.
- **Repeated Work**: The platform re-dispatches the same ticket to another agent, leading to redundant work and increased resource consumption.
- **False Verdicts**: Agents are incentivized to provide false "approved" verdicts to bypass the issue, compromising the integrity of the workflow.
- **Lost Findings**: The inability to file gap tickets results in out-of-scope findings being lost.

### Goal
- **Immediate Fix**: Resolve the 401 error by rotating/renewing the agent service token and implementing a startup assertion for expired credentials.
- **Secondary Fix**: Validate the default-assignee foreign key before inserting a new task to prevent the creation of tasks without valid assignees.
- **Long-term Stability**: Ensure that agent sessions remain valid and that all API endpoints handle authentication gracefully to prevent similar issues in the future.

## Target Users / ICP Roles
- **Developers**: Responsible for implementing and maintaining the agent workflows.
- **Reviewers**: Responsible for verifying the work done by agents.
- **Project Managers**: Responsible for overseeing the workflow and ensuring that tickets are processed correctly.
- **Platform Administrators**: Responsible for managing API credentials and ensuring system stability.

## Scope

### In-Scope
- **API Endpoint Authentication**: Rotate/renew the agent service token used for Kanban and lifecycle endpoints.
- **Startup Assertion**: Implement a startup assertion that checks for expired credentials and fails loudly if an expired token is detected.
- **Foreign Key Validation**: Validate the default-assignee foreign key before inserting a new task to ensure that the assigned user exists.
- **Error Handling**: Improve error handling for API endpoints to provide more informative messages and prevent silent failures.

### Out-of-Scope
- **Agent Logic Modification**: Changes to the logic of the agents themselves are not part of this fix.
- **User Management System**: Modifications to the user management system or the `users` table are not included.
- **Workflow Redesign**: Redesigning the workflow to accommodate different failure modes is not part of this PRD.

## Functional Requirements

1. **Token Rotation/Renewal**
   - Rotate the existing agent service token used for Kanban and lifecycle endpoints.
   - Implement a mechanism to renew the token before it expires.

2. **Startup Assertion**
   - Implement a startup assertion that checks the validity of the agent service token.
   - If the token is expired or invalid, the agent should fail to start and log an appropriate error message.

3. **Foreign Key Validation**
   - Before inserting a new task, validate that the assigned user ID exists in the `users` table.
   - If the user ID does not exist, prevent the task from being created and return an informative error message.

4. **Error Handling**
   - Improve error handling for all relevant API endpoints to provide clear and informative error messages.
   - Ensure that errors are logged appropriately for troubleshooting purposes.

## Acceptance Criteria

1. **Token Rotation/Renewal**
   - The agent service token is successfully rotated and renewed.
   - The agent no longer receives 401 errors due to expired or revoked tokens.

2. **Startup Assertion**
   - The startup assertion is implemented and functioning correctly.
   - If an expired or invalid token is detected, the agent fails to start and logs an appropriate error message.

3. **Foreign Key Validation**
   - The default-assignee foreign key is validated before task creation.
   - Tasks are not created with non-existent user IDs, and an informative error message is returned.

4. **Error Handling**
   - All relevant API endpoints return clear and informative error messages.
   - Errors are logged appropriately for troubleshooting.

## Out of Scope

- **Agent Logic Modification**: The logic of the agents themselves will not be modified as part of this fix.
- **User Management System**: The user management system and the `users` table will not be altered.
- **Workflow Redesign**: The overall workflow will not be redesigned to accommodate different failure modes.

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