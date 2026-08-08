> **PRD** — drafted by Ada (Sr. Product Mgr) · task #852
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
The current project management system allows for duplicate roles to be assigned within a single epic, which can lead to confusion, miscommunication, and potential redundancy in task execution. This issue is particularly evident in Epic #709, where the "Engineer—development" role was inadvertently added twice.

### Goal
To streamline the role assignment process within epics by ensuring that each role is unique per epic. This will improve clarity, reduce redundancy, and enhance overall project management efficiency.

## Target Users / ICP Roles

- **Project Managers**: Responsible for assigning roles and managing epics.
- **Developers**: Assigned to roles within epics and need clear role definitions.
- **QA Engineers**: Need to understand role assignments for testing purposes.
- **Product Owners**: Oversee the project and need to ensure roles are correctly assigned.

## Scope

- **In-Scope**:
  - Removal of duplicate "Engineer—development" role from Epic #709's manifest.
  - Implementation of a validation mechanism to prevent duplicate role assignments within the same epic.
  - Update to the user interface to reflect the removal of duplicate roles.
  - Documentation update to inform users of the change and the new validation mechanism.

- **Out-of-Scope**:
  - Changes to role definitions or permissions.
  - Modification of role assignment processes for other entities (e.g., projects, teams).
  - Handling of duplicate roles in historical data or past epics.
  - Implementation of role hierarchy or prioritization within epics.

## Functional Requirements

1. **Role Duplication Prevention**:
   - The system shall prevent the assignment of duplicate roles within the same epic.
   - When attempting to add a role that already exists in the epic, the system shall display a warning message and disallow the action.

2. **Duplicate Role Removal**:
   - The system shall allow project managers to remove duplicate roles from an epic's manifest.
   - Upon removal, the system shall update the manifest to reflect the change and notify relevant stakeholders.

3. **User Interface Update**:
   - The role assignment interface shall be updated to provide a clear view of assigned roles, highlighting any potential duplicates before submission.
   - The interface shall provide a mechanism to view and manage roles assigned to an epic.

4. **Validation Mechanism**:
   - The system shall include a validation check during the role assignment process to ensure no duplicates are added.
   - The validation mechanism shall be integrated into both the UI and any API endpoints that handle role assignments.

5. **Notification and Logging**:
   - The system shall log all changes to role assignments, including the removal of duplicates.
   - Notifications shall be sent to relevant stakeholders when roles are added, removed, or modified within an epic.

## Acceptance Criteria

- **AC1**: The "Engineer—development" role is no longer duplicated in Epic #709's manifest.
- **AC2**: Project managers can successfully remove duplicate roles from any epic without system errors.
- **AC3**: The system prevents the addition of duplicate roles within an epic, providing appropriate warnings.
- **AC4**: The user interface clearly displays assigned roles and any actions taken to remove duplicates.
- **AC5**: All changes to role assignments are logged and notifications are sent to relevant stakeholders.

## Out of Scope

- Modification of role definitions or permissions.
- Changes to role assignment processes for entities other than epics.
- Handling of duplicate roles in historical data or past epics.
- Implementation of role hierarchy or prioritization within epics.
- Automated detection and removal of duplicate roles in existing epics beyond Epic #709.

## Requirements

### Data Model Requirements

| ID | Requirement | Implementation Note |
|----|-------------|---------------------|
| REQ-1 | The `ticketParticipants` table must enforce uniqueness at the (taskId, stageKey, roleKey, responsibility, source) composite level to prevent duplicate role entries | Database-level constraint or application-level validation in addParticipant() |
| REQ-2 | The TicketParticipantsService.addParticipant() method must validate that a participant with the same (taskId, stageKey, roleKey, responsibility, source) does not already exist before inserting | Query existing participants and throw error if duplicate detected |

### API Endpoint Requirements

| ID | Requirement | Endpoint |
|----|-------------|----------|
| REQ-3 | The system must provide an API endpoint to retrieve all participants for a given epic/task | GET /api/kanban/tasks/:taskId/participants |
| REQ-4 | The system must provide an API endpoint to add a participant to an epic with duplicate validation | POST /api/kanban/tasks/:taskId/participants (with validation) |
| REQ-5 | The system must provide an API endpoint to remove a participant from an epic | DELETE /api/kanban/tasks/:taskId/participants/:participantId |
| REQ-6 | The system must return appropriate error responses when duplicate role assignment is attempted | 409 Conflict status with descriptive message |

### UI Requirements

| ID | Requirement | Description |
|----|-------------|-------------|
| REQ-7 | The epic manifest view must display all assigned roles with clear role names and responsibility types | List view showing roleKey, roleName, responsibility, assignee |
| REQ-8 | The role assignment form must show existing roles to prevent accidental duplicates | Pre-populated dropdown or list showing current assignments |
| REQ-9 | Duplicate role warnings must be displayed before submission when user attempts to add an existing role | Inline validation message: "Role [X] with responsibility [Y] already exists in this epic" |
| REQ-10 | The UI must allow removal of duplicate roles through a delete/remove action | Remove button per participant row |

### Validation Logic Requirements

| ID | Requirement | Description |
|----|-------------|-------------|
| REQ-11 | Duplicate detection must consider the full slot identity: taskId + stageKey + roleKey + responsibility + source | Same role in different stages or with different responsibilities is NOT a duplicate |
| REQ-12 | The validation must work for all participant sources: template-derived, assessment-added, and manually-added | Apply to source values: 'template', 'assessment', 'manual', 'lane_agent' |

### Logging & Notification Requirements

| ID | Requirement | Description |
|----|-------------|-------------|
| REQ-13 | All participant add/remove operations must be logged to the activity ledger | Include action type, user/agent, timestamp, participant details |
| REQ-14 | Duplicate role attempt rejections must be logged as warning events | Include attempted participant details and requesting user |
| REQ-15 | Notifications to relevant stakeholders are sent when roles are added/removed | Utilize existing notification infrastructure (email/in-app) |

### Epic #709 Specific Requirements

| ID | Requirement | Description |
|----|-------------|-------------|
| REQ-16 | The duplicate "Engineer—development" role (0d6423f1) must be removed from Epic #709's participant manifest | Execute removal via TicketParticipantsService.removeParticipant() |
| REQ-17 | Post-removal verification must confirm only one "Engineer—development" role remains in Epic #709 | Query and validate manifest state after removal |

### Non-Functional Requirements

| ID | Requirement | Description |
|----|-------------|-------------|
| REQ-18 | Duplicate validation must complete within 200ms to maintain UX responsiveness | Performance requirement for addParticipant validation |
| REQ-19 | The duplicate check must be atomic to prevent race conditions | Use database transaction or locking mechanism |

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._