> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1632
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
The `/api/kanban/*` endpoints are returning a 401 "Token has been revoked or expired" error, which blocks multiple operations related to kanban manifests. This issue affects the following operations:
- Reading participation manifests (`kanban_participants`)
- Assigning participants (`kanban_assign_participant`)
- Removing participants (`kanban_remove_participant`)
- Accountability reads

While the `/api/tasks/*` endpoints are functioning correctly, the token revocation logic is incorrectly affecting only the kanban namespace routes.

### Goal
Resolve the 401 authentication issue for `/api/kanban/*` endpoints to ensure all kanban-related operations function correctly without being blocked by token revocation issues.

## Target Users / ICP Roles
- **Developers**: Who rely on the kanban API endpoints for manifest operations.
- **Project Managers**: Who use kanban boards for task and participant management.
- **QA Engineers**: Who need to test kanban-related functionalities.

## Scope

### In-Scope
- **Authentication Fix**: Modify the authentication logic to ensure that token revocation does not incorrectly affect the kanban namespace routes.
- **Endpoint Testing**: Validate all `/api/kanban/*` endpoints to ensure they function correctly after the fix.
  - Reading participation manifests
  - Assigning participants
  - Removing participants
  - Accountability reads
- **Error Handling**: Implement appropriate error handling for token-related issues that do not result in a blanket 401 response for kanban endpoints.
- **Documentation Update**: Update the API documentation to reflect the changes in authentication handling for kanban endpoints.

### Out-of-Scope
- **Token Revocation Logic**: Changes to the core token revocation mechanism are not part of this fix.
- **Other API Endpoints**: Fixes for other API namespaces (e.g., `/api/tasks/*`) are not included unless directly related to the kanban namespace.
- **UI Changes**: Any changes to the user interface related to kanban boards are not part of this scope.

## Functional Requirements

1. **Authentication Mechanism Update**
   - Modify the authentication middleware to exclude kanban namespace routes from the token revocation check that causes the 401 error.
   - Ensure that the kanban endpoints validate tokens correctly without being affected by the global token revocation logic.

2. **Endpoint Validation**
   - Ensure that all `/api/kanban/*` endpoints correctly handle authenticated requests without returning a 401 error due to token revocation.
   - Validate that the endpoints return appropriate responses for valid and invalid tokens.

3. **Error Handling**
   - Implement granular error handling for token-related issues in the kanban namespace.
   - Ensure that errors are descriptive and provide actionable feedback to the user.

4. **Testing**
   - Conduct unit tests for the updated authentication logic.
   - Perform integration tests for all kanban endpoints to ensure they function as expected.
   - Validate that the endpoints handle edge cases, such as expired tokens and revoked tokens, without blocking legitimate requests.

5. **Documentation**
   - Update the API documentation to reflect the changes in the authentication mechanism for kanban endpoints.
   - Provide clear guidelines on how to handle token-related errors for developers using the kanban API.

## Acceptance Criteria

- All `/api/kanban/*` endpoints return successful responses for valid tokens without being blocked by token revocation issues.
- The kanban endpoints correctly handle expired or revoked tokens by returning appropriate error messages without a 401 response unless the token is invalid for the specific request.
- Unit and integration tests pass for the updated authentication logic and kanban endpoints.
- The API documentation is updated to reflect the changes in the authentication mechanism for kanban endpoints.
- No regression issues are introduced in other API namespaces due to the changes in the authentication logic.

## Out of Scope

- Changes to the core token revocation mechanism.
- Fixes for other API namespaces unless directly related to the kanban namespace.
- UI changes related to kanban boards.
- Modification of authentication protocols (e.g., switching from JWT to another method).

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