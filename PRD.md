> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1633
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
The `builtin_kanban_signoff` and other kanban API calls return a 401 "Token has been revoked or expired" error when used by agent tokens. This issue prevents the sign-off loop from functioning correctly for any role using the affected executor. However, the `builtin_tasks_get` API works correctly with the same tokens, indicating an inconsistency in authentication handling between different API endpoints.

### Goal
Investigate and resolve the authentication discrepancy between `/api/kanban/*` and `/api/tasks/*` endpoints to ensure that agent tokens can successfully authenticate and perform kanban sign-off operations without returning a 401 error.

## Target Users / ICP Roles

- **Software Developers**: Users who integrate and interact with the kanban APIs for task management and sign-off processes.
- **DevOps Engineers**: Individuals responsible for maintaining and deploying automation workflows that rely on agent tokens for authentication.
- **Product Managers**: Stakeholders who oversee the task and sign-off processes and rely on the kanban system for tracking progress.

## Scope

- **Authentication Mechanism Analysis**: Investigate the authentication mechanisms used by `/api/kanban/*` and `/api/tasks/*` endpoints to identify discrepancies.
- **Token Validation**: Review the token validation process for agent tokens to ensure consistency across all API endpoints.
- **API Endpoint Updates**: Modify the `/api/kanban/*` endpoints to align with the authentication handling of `/api/tasks/*` endpoints.
- **Testing**: Implement comprehensive testing to verify that agent tokens can successfully authenticate and perform kanban sign-off operations without errors.

## Functional Requirements

1. **Authentication Mechanism Alignment**
   - Ensure that the authentication mechanism used by `/api/kanban/*` endpoints is consistent with that of `/api/tasks/*` endpoints.
   - Update the authentication logic for kanban APIs to accept and validate agent tokens in the same manner as task APIs.

2. **Token Validation Enhancement**
   - Modify the token validation process to correctly handle agent tokens for all relevant API endpoints.
   - Implement logging to capture detailed information about token validation failures for debugging purposes.

3. **Error Handling Improvement**
   - Update error handling for `/api/kanban/*` endpoints to provide more descriptive messages when authentication fails.
   - Ensure that 401 errors are only returned when there is a legitimate authentication issue, not due to token type or format.

4. **API Documentation Update**
   - Reflect the changes in the authentication mechanism and token validation in the API documentation.
   - Provide clear guidelines on how to use agent tokens with kanban APIs.

5. **Testing and Validation**
   - Develop unit and integration tests to verify that agent tokens can authenticate with `/api/kanban/*` endpoints.
   - Conduct regression testing to ensure that changes do not adversely affect other API functionalities.

## Acceptance Criteria

- Agent tokens can successfully authenticate with `/api/kanban/*` endpoints without returning a 401 error.
- The authentication mechanism for kanban APIs is consistent with that of task APIs.
- All existing functionalities related to task APIs remain unaffected by the changes.
- Comprehensive test coverage is achieved, with all tests passing successfully.
- Updated API documentation is available and accurately reflects the changes made.

## Out of Scope

- **Authentication Protocol Changes**: Modifying the underlying authentication protocol or introducing new authentication methods is not part of this task.
- **User Interface Updates**: Any changes to the user interface related to authentication or task management are not included.
- **Performance Optimization**: While testing will ensure that performance is not degraded, optimizing the API performance is not a goal of this task.
- **Third-Party Integrations**: Ensuring compatibility with third-party systems that use the APIs is not covered unless it directly impacts the authentication issue.

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