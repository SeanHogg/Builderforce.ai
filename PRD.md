> **PRD** — drafted by Ada (Sr. Product Mgr) · task #805
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
Assigning roles to users within an application is a common requirement for managing permissions and access control. However, current methods for assigning roles are often manual, error-prone, and lack flexibility, leading to potential security vulnerabilities and inefficiencies in user management.

### Goal
To provide a reliable and efficient way to assign roles to users by implementing a `roleKey` parameter that allows for dynamic role assignment based on predefined role keys.

## Target Users / ICP Roles

- **System Administrators**: Responsible for managing user roles and permissions within the application.
- **Developers**: Implementing role-based access control (RBAC) in their applications.
- **Security Officers**: Ensuring that role assignments comply with security policies and best practices.

## Scope

- Implement a `roleKey` parameter that accepts a string representing the role key (e.g., "engineer").
- Validate the `roleKey` against a predefined list of role keys to ensure it exists and is active.
- Assign the corresponding role to the user based on the validated `roleKey`.
- Provide feedback on the success or failure of the role assignment process.

## Functional Requirements

1. **Role Key Validation**
   - The system must validate the `roleKey` against a predefined list of active role keys.
   - If the `roleKey` is invalid or inactive, the system must return an error message indicating the issue.

2. **Role Assignment**
   - Upon successful validation, the system must assign the corresponding role to the user.
   - The role assignment must be reflected in the user's profile and permissions immediately.

3. **Error Handling**
   - The system must handle errors gracefully, providing clear and actionable error messages for:
     - Invalid `roleKey` format (e.g., non-string input).
     - Non-existent or inactive `roleKey`.
     - Internal server errors during the assignment process.

4. **Audit Logging**
   - All role assignment attempts, including successes and failures, must be logged for auditing purposes.
   - The logs must include the timestamp, user ID, `roleKey`, and outcome.

5. **API Endpoint**
   - Provide a RESTful API endpoint (e.g., `POST /api/users/{userId}/roles`) that accepts the `roleKey` as a parameter.
   - The endpoint must support authentication and authorization checks to ensure that only authorized personnel can assign roles.

## Acceptance Criteria

- The `roleKey` parameter is successfully validated against the predefined list of role keys.
- The user is assigned the correct role based on the `roleKey`.
- The role assignment is reflected in the user's profile and permissions.
- The system returns appropriate success or error messages based on the outcome of the operation.
- All role assignment attempts are logged correctly in the audit logs.
- The API endpoint adheres to RESTful principles and includes necessary authentication and authorization checks.

## Out of Scope

- Modifying the predefined list of role keys.
- Implementing role hierarchy or inheritance.
- Handling bulk role assignments.
- Providing a user interface for role assignment (this PRD focuses on the API endpoint).
- Integrating with third-party identity management systems.
- Implementing role revocation or role change history tracking.

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