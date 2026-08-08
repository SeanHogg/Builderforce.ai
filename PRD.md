> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1223
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD) for Kanban Sign-off Endpoint Authentication Issue

## Problem & Goal

### Problem
The `POST /api/kanban/tasks/{id}/signoff` endpoint consistently returns a 401 error with the message `{"error":"Token has been revoked or expired"}` during agent runs. This issue is specific to the sign-off endpoint and does not affect other endpoints such as `builtin_tasks_create/list/get` or repository tools within the same run. As a result, agents are unable to record the role verdict on the accountability manifest, causing tickets to appear blocked and leading to unnecessary escalations to human intervention.

### Goal
Resolve the 401 authentication error on the `POST /api/kanban/tasks/{id}/signoff` endpoint to ensure that agents can successfully sign off on tasks and record verdicts without interruption.

## Target Users / ICP Roles
- **Agents**: Automated systems responsible for performing and signing off on tasks.
- **Developers**: Responsible for maintaining and updating the API and authentication middleware.
- **DevOps Engineers**: Responsible for monitoring and ensuring the reliability of the system.

## Scope

### In-Scope
- **Authentication Middleware Analysis**: Investigate and compare the authentication middleware and scope requirements between the kanban sign-off and participants routes and the tasks routes.
- **Token Validation Logic**: Review the token validation logic to identify any differences in audience, scope checks, or revocation list consultations.
- **Endpoint-Specific Configuration**: Identify and rectify any endpoint-specific configurations that may be causing the 401 error.
- **Testing and Validation**: Implement tests to ensure that the sign-off endpoint correctly authenticates tokens and that the issue is resolved.
- **Documentation**: Update any relevant documentation to reflect changes made to the authentication process.

### Out-of-Scope
- **Changes to Authentication Protocols**: This issue does not warrant a change to the overall authentication protocols or mechanisms in use.
- **Other Endpoints**: While other endpoints may be referenced during the investigation, changes to them are not part of this scope unless directly related to the sign-off endpoint issue.
- **Performance Optimization**: This task is focused on resolving the authentication issue and does not include performance optimization of the sign-off endpoint.

## Functional Requirements

1. **Authentication Middleware Comparison**
   - Analyze the authentication middleware used by the `POST /api/kanban/tasks/{id}/signoff` endpoint and compare it with the middleware used by other endpoints such as `builtin_tasks_create/list/get`.
   - Identify any differences in token audience, scope checks, or revocation list consultations.

2. **Token Validation Logic Review**
   - Review the token validation logic for the sign-off endpoint to ensure it aligns with the logic used by other authenticated endpoints.
   - Ensure that the token is being validated against the correct audience and scopes.

3. **Endpoint Configuration Verification**
   - Verify that the sign-off endpoint's configuration does not inadvertently require additional or different permissions compared to other endpoints.
   - Ensure that the endpoint is correctly configured to accept the tokens provided by the agents.

4. **Error Handling and Messaging**
   - Update the error handling and messaging to provide more detailed information if a 401 error occurs, including the reason for the failure (e.g., invalid token, expired token, insufficient scopes).

5. **Testing**
   - Implement unit and integration tests to verify that the sign-off endpoint correctly authenticates tokens and processes sign-off requests.
   - Test the endpoint with tokens that are valid, expired, and revoked to ensure appropriate responses.

6. **Documentation Update**
   - Update any relevant API documentation to reflect the changes made to the sign-off endpoint's authentication process.
   - Provide clear guidance on the required token scopes and audience for the sign-off endpoint.

## Acceptance Criteria

- The `POST /api/kanban/tasks/{id}/signoff` endpoint no longer returns a 401 error with the message `{"error":"Token has been revoked or expired"}` when provided with a valid, non-expired, and non-revoked token.
- The endpoint correctly validates tokens against the appropriate audience and scopes.
- Error messages provide clear and actionable information when authentication fails.
- All tests pass, demonstrating that the endpoint correctly handles valid and invalid tokens.
- Documentation accurately reflects the authentication requirements and behavior of the sign-off endpoint.

## Out of Scope

- Changes to the overall authentication system or protocols.
- Modification of other endpoints' authentication logic unless directly related to resolving the sign-off endpoint issue.
- Performance optimization of the sign-off endpoint.
- Investigation of other unrelated authentication issues.

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