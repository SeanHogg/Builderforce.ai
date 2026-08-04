> **PRD** — drafted by Ada (Sr. Product Mgr) · task #765
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
Currently, the Owner role in the participation manifest does not dynamically update when an epic is assigned to an agent via `assignedAgentRef`, `assignedUserId`, or `assignedAgentHostId`. This leads to confusion and potential mismanagement of responsibilities, as the ownership does not reflect the current agent assignment.

### Goal
To ensure that the Owner role in the participation manifest automatically resolves to the assigned agent when an epic is assigned through any of the supported assignment methods (`assignedAgentRef`, `assignedUserId`, or `assignedAgentHostId`).

## Target Users / ICP Roles

- **Project Managers**: Need to clearly see who is responsible for an epic.
- **Agents**: Need to be aware of their assigned epics and responsibilities.
- **Stakeholders**: Require accurate ownership information for decision-making and accountability.

## Scope

### In-Scope
- Update the Owner role in the participation manifest to reflect the assigned agent when an epic is assigned.
- Support for all existing assignment methods:
  - `assignedAgentRef`
  - `assignedUserId`
  - `assignedAgentHostId`
- Ensure that the Owner role is updated in real-time or near real-time when an assignment changes.
- Provide clear and consistent behavior across all interfaces (UI, API, etc.).

### Out-of-Scope
- Changes to the assignment methods themselves.
- Modification of other roles in the participation manifest (e.g., Contributor, Viewer).
- Handling of assignment conflicts or multiple assignments.
- Notification system for role changes.

## Functional Requirements

1. **Assignment Detection**
   - System must detect when an epic is assigned via `assignedAgentRef`, `assignedUserId`, or `assignedAgentHostId`.
   - Detection must occur at the time of assignment and upon any subsequent changes to the assignment.

2. **Owner Role Update**
   - Upon detection of an assignment, the system must update the Owner role in the participation manifest to reflect the assigned agent.
   - The update must be atomic to prevent inconsistent states.

3. **Real-Time Synchronization**
   - The Owner role must be updated in real-time or near real-time to ensure that all users see the current owner.
   - Any interface displaying the participation manifest must reflect the change immediately.

4. **Error Handling**
   - If an assignment fails, the system must not update the Owner role.
   - The system must log errors related to assignment and role updates for troubleshooting.

5. **API Support**
   - Provide API endpoints to retrieve the current Owner role based on assignment.
   - Ensure that API responses reflect the updated Owner role immediately after assignment.

## Acceptance Criteria

- When an epic is assigned via `assignedAgentRef`, the Owner role in the participation manifest must reflect the agent referenced by `assignedAgentRef`.
- When an epic is assigned via `assignedUserId`, the Owner role must reflect the user with the corresponding `assignedUserId`.
- When an epic is assigned via `assignedAgentHostId`, the Owner role must reflect the agent with the corresponding `assignedAgentHostId`.
- The Owner role must update within 2 seconds of the assignment being made.
- The participation manifest must accurately reflect the Owner role across all interfaces (UI, API, etc.).
- No errors should occur during the assignment and role update process.
- The system must handle assignment changes gracefully, ensuring that the Owner role is always accurate.

## Out of Scope

- Modification of assignment methods (`assignedAgentRef`, `assignedUserId`, `assignedAgentHostId`).
- Handling of multiple assignments or conflicting assignments.
- Implementation of a notification system for role changes.
- Changes to other roles in the participation manifest (e.g., Contributor, Viewer).
- Modification of the participation manifest structure.

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