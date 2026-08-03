> **PRD** — drafted by Ada (Sr. Product Mgr) · task #775
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Role Assignment Replacement

## Problem & Goal
Currently, when assigning a user to a role that already has an assignee, the system can silently add a second assignee or return an error, leading to confusion about who holds the role. Users expect a role to be held by exactly one person at a time. The goal is to enforce single-assignee semantics for roles so that any new assignment automatically replaces the previous assignee, ensuring clarity and preventing duplicate responsibility.

## Target Users / ICP Roles
- Project Managers and Team Leads who allocate responsibilities.
- Administrators configuring project roles and memberships.
- Any user with permission to modify role assignments.

## Scope
The feature covers the core behavior change for role assignment flows: whenever a user is assigned to a role that already has an assignee, the previous assignee is immediately and atomically replaced by the new user. This applies to UI interactions (drag-and-drop, dropdown selection, etc.) and API calls.

## Functional Requirements

- **FR1: Single-Assignee Constraint** – A role can have at most one assigned user at any time.
- **FR2: Automatic Replacement** – When assigning a new user to a role currently occupied by a different user, the system must:
  - Remove the current assignee from the role.
  - Assign the new user to the role.
- **FR3: Atomic Operation** – The replacement must be executed as a single atomic transaction; no intermediate state where the role is unassigned but the new assignee is not yet set should be visible.
- **FR4: Idempotent Assignment** – Assigning the same user that already holds the role results in a no-op (success, no change).
- **FR5: Real-Time UI Update** – The frontend must reflect the replacement immediately without requiring a full page refresh.
- **FR6: API Behavior** – The existing role-assignment API endpoint must:
  - Accept a user identifier for the role.
  - If the role already has a different assignee, replace it and return a success response (e.g., 200 with details of the previous assignee that was replaced).
  - Avoid returning errors for duplicate assignments.
- **FR7: Audit Trail** – Every replacement must be logged with: timestamp, role identifier, previous assignee, new assignee, and the user who initiated the change.
- **FR8: User Notification (Optional)** – If notification infrastructure is present, the previously assigned user should be informed that they have been removed from the role.

## Acceptance Criteria

1. **Basic Replacement**  
   - Given role `R` is assigned to user `Alice`, when user `Bob` is assigned to role `R`, then `Alice` is unassigned, `Bob` is assigned, and role `R` shows `Bob` as the sole assignee.
2. **No Duplication**  
   - After the operation, no role ever lists more than one assignee in the system.
3. **UI Consistency**  
   - The role assignment UI updates within 2 seconds of the operation to display the new assignee and hides the previous assignee.
4. **API Contract**  
   - Calling `POST /api/roles/:id/assign` with `{ "userId": "bob" }` when `Alice` is assigned returns `200 OK` and `{ "replaced": "alice" }`.
5. **Idempotence**  
   - Assigning `Bob` again while `Bob` is already the assignee returns `200 OK` and does not trigger any replacement or audit entry (or logs a no-op if required).
6. **Audit Log**  
   - The audit system records an entry with `action: "role-assignment-replaced"` containing previous and new user details.

## Out of Scope

- Support for multiple simultaneous assignees on a single role.
- Role hierarchies or inherited assignments.
- Approval workflows or staged/request-based reassignment.
- Bulk replacement operations (handling an array of role assignments in one call).
- Customisable notification templates for role changes.
- Integration with external HR or identity systems causing cascading deprovisioning.

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