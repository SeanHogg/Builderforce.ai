> **PRD** — drafted by Ada (Sr. Product Mgr) · task #831
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
Currently, when a manifest is built or refreshed, the Owner role is not automatically assigned based on the epic's assigned user or agent. This manual assignment process is time-consuming and prone to human error, leading to potential delays and inconsistencies in ownership tracking.

### Goal
Automate the assignment of the Owner role in the manifest based on the epic's assigned user or agent during the build or refresh process. This will streamline the workflow, reduce manual effort, and ensure consistency in ownership assignment.

## Target Users / ICP Roles

- **Project Managers**: Responsible for overseeing project progress and ensuring ownership is correctly assigned.
- **Development Team Leads**: Need to quickly identify who is responsible for specific tasks or epics.
- **Product Owners**: Require accurate ownership information to make informed decisions and prioritize work.
- **Agents/Users Assigned to Epics**: Should be automatically recognized as the owner of the associated manifest.

## Scope

- **In-Scope**:
  - Automatically assign the Owner role in the manifest based on the epic's assigned user or agent.
  - Support for both user and agent assignments.
  - Handling of scenarios where the epic has no assigned user or agent.
  - Validation to ensure that the assigned user or agent exists in the system.
  - Logging of automatic assignments for audit purposes.

- **Out-of-Scope**:
  - Changes to the UI for manual override of the Owner role.
  - Automatic assignment of other roles in the manifest.
  - Integration with external systems for ownership assignment.
  - Handling of circular dependencies or conflicts in ownership.

## Functional Requirements

1. **Automatic Assignment**:
   - When a manifest is built or refreshed, the system must automatically assign the Owner role based on the epic's assigned user or agent.
   - If the epic has both a user and an agent assigned, the user should take precedence.

2. **Validation**:
   - The system must validate that the assigned user or agent exists in the system before assigning the Owner role.
   - If the assigned user or agent does not exist, the system must log an error and leave the Owner role unassigned.

3. **Handling Unassigned Epics**:
   - If the epic has no assigned user or agent, the system must leave the Owner role unassigned and log a warning.

4. **Logging**:
   - All automatic assignments and errors must be logged for audit and troubleshooting purposes.

5. **Notification**:
   - The system should notify the assigned user or agent via email or in-app notification when they are assigned as the Owner.

## Acceptance Criteria

- The Owner role in the manifest is automatically assigned based on the epic's assigned user or agent during the build or refresh process.
- The system correctly handles scenarios where the epic has no assigned user or agent by leaving the Owner role unassigned and logging a warning.
- The system validates the existence of the assigned user or agent and logs an error if the assignment cannot be made.
- All automatic assignments and errors are logged for audit purposes.
- Assigned users or agents receive a notification informing them of their new ownership status.

## Out of Scope

- UI changes for manual override of the Owner role.
- Automatic assignment of other roles in the manifest.
- Integration with external systems for ownership assignment.
- Handling of circular dependencies or conflicts in ownership.
- Notification customization options for assigned users or agents.

## Requirements

### FR-O-001: Epic Parent Resolution
The system MUST resolve the epic ancestor of a task by traversing the `parentTaskId` chain until a task with `taskType = 'epic'` is found. If no epic exists in the ancestry chain, the system MUST log a debug-level message and proceed to the fallback resolution.

### FR-O-002: Owner Assignment Precedence
When resolving an Owner (`responsibility = 'owner'`) slot in the manifest, the system MUST check the epic's assignees in the following order:
1. **Epic assigned user** — if `epic.assignedUserId` is present, use it.
2. **Epic assigned agent** — if `epic.assignedAgentRef` is present, use it as fallback.

### FR-O-003: Assignee Validation
Before persisting an epic assignee as the Owner, the system MUST validate that the assignee exists in the participant roster:
- For a **user**: the user ID must exist in the `users` table.
- For an **agent**: the agent ref must exist in the `ide_agents` table.

If validation fails, the system MUST log a warning and fall back to the standard pin → role-capable agent resolution.

### FR-O-004: Fallback Resolution
If the epic has no assignee, the epic chain does not exist, or validation fails, the system MUST fall back to the existing `resolveAssignee` logic (project pin → role-capable agent → null).

### FR-O-005: Logging & Audit Trail
All owner-resolution decisions MUST be logged at appropriate levels:
- `debug`: "Resolving owner for task {id}, epic={epicId}"
- `info`: "Epic assignee {kind}:{ref} validated and assigned to owner role for task {id}"
- `warn`: "Epic has no assignee for task {id}, falling back to role resolution"
- `warn`: "Epic assignee validation failed for {kind}:{ref}, falling back to role resolution"

### FR-O-006: Idempotent Derivation
The owner assignment MUST be recomputed on every `deriveManifest` call. If the epic's assignee changes, the manifest MUST reflect the new owner on the next refresh without manual intervention.

### FR-N-001: Notification (Deferred)
Notifications to the assigned owner are **out of scope** for this initial implementation and SHOULD be handled in a follow-up task.

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._