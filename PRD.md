> **PRD** — drafted by Ada (Sr. Product Mgr) · task #849
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
Users with multiple roles assigned in the system may need to remove a specific role without affecting their other roles. Currently, the system lacks a straightforward way to remove a single role, leading to potential confusion and inefficiency in managing user roles.

### Goal
Implement a feature that allows users or administrators to remove a specific role from a user account using a role key. This will enhance the user management experience by providing a clear and efficient method to modify user roles.

## Target Users / ICP Roles

- **Administrators**: Users responsible for managing user accounts and permissions within the system.
- **End Users**: Individuals who may need to manage their own roles, especially in systems where self-service role management is supported.

## Scope

- **In-Scope**:
  - Develop an API endpoint to remove a specific role from a user account using a role key.
  - Implement validation to ensure the role key exists and is associated with the user.
  - Provide appropriate feedback to the user upon successful removal or failure.
  - Update user role information in the database.

- **Out-of-Scope**:
  - Modifying or adding roles to a user account.
  - Handling bulk role removals.
  - UI changes for role management (this PRD focuses on the backend functionality).

## Functional Requirements

1. **API Endpoint**:
   - Create a new API endpoint: `DELETE /api/users/{userId}/roles/{roleKey}`
   - The endpoint should accept `userId` as a path parameter and `roleKey` as a path parameter.

2. **Authentication & Authorization**:
   - The endpoint must verify that the requesting user has the necessary permissions to remove roles from the target user.
   - Implement role-based access control (RBAC) to restrict access to authorized personnel.

3. **Validation**:
   - Check if the `userId` exists in the system.
   - Verify that the `roleKey` is associated with the user.
   - Ensure that the `roleKey` is a valid role within the system.

4. **Role Removal**:
   - Remove the specified role from the user's role set.
   - Update the user’s role information in the database.

5. **Feedback**:
   - Return a success response with a 200 status code and a message indicating the role was removed.
   - If the role does not exist or the user is not found, return a 404 error with an appropriate message.
   - If the requesting user lacks permissions, return a 403 error.

## Acceptance Criteria

- **Given** a user with multiple roles, **when** an administrator removes a specific role using the API endpoint, **then** the role should be removed from the user's account without affecting other roles.
- **Given** a user with a single role, **when** an administrator attempts to remove that role, **then** the system should prevent the removal and return an error message.
- **Given** an invalid `userId` or `roleKey`, **when** the API endpoint is called, **then** the system should return a 404 error with a clear message.
- **Given** a user without sufficient permissions, **when** they attempt to remove a role, **then** the system should return a 403 error.
- **Given** a valid request, **when** the role is removed, **then** the change should be reflected in the database immediately.

## Out of Scope

- UI modifications for role management.
- Bulk role removal functionality.
- Audit logging for role changes (this can be addressed in a separate feature).
- Notification system for users or administrators regarding role changes.

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