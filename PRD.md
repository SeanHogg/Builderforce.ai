> **PRD** — drafted by Ada (Sr. Product Mgr) · task #786
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
Currently, the Owner role in the participation manifest does not dynamically update when an epic is assigned to an agent via `assignedAgentRef`, `assignedUserId`, or `assignedAgentHostId`. This leads to confusion and potential mismanagement of responsibilities, as the Owner role does not reflect the actual assigned agent.

### Goal
To ensure that the Owner role in the participation manifest automatically resolves to the assigned agent when an epic is assigned through any of the supported assignment methods (`assignedAgentRef`, `assignedUserId`, or `assignedAgentHostId`).

## Target Users / ICP Roles

- **Project Managers**: Need to clearly see who is responsible for an epic.
- **Agents**: Need to be aware of their assigned epics and responsibilities.
- **Stakeholders**: Require accurate information on ownership for decision-making and accountability.

## Scope

### In-Scope
- **Assignment Methods**: Support for `assignedAgentRef`, `assignedUserId`, and `assignedAgentHostId` as valid assignment methods.
- **Participation Manifest Update**: Automatic update of the Owner role in the participation manifest when an epic is assigned.
- **Real-Time Synchronization**: Immediate reflection of ownership changes in the participation manifest.
- **API and UI Integration**: Ensure that both API and user interface components recognize and display the updated Owner role.

### Out-of-Scope
- **Multiple Ownership**: Handling scenarios where multiple agents are assigned to an epic.
- **Unassignment Logic**: Automatic unassignment of the Owner role when an epic is unassigned.
- **Historical Tracking**: Maintaining a history of ownership changes.
- **Notification System**: Notifications to agents or other roles about changes in ownership.

## Functional Requirements

1. **Assignment Handling**
   - The system must recognize when an epic is assigned via `assignedAgentRef`, `assignedUserId`, or `assignedAgentHostId`.
   - Upon assignment, the system must identify the assigned agent.

2. **Participation Manifest Update**
   - The Owner role in the participation manifest must be updated to reflect the assigned agent.
   - The update must occur in real-time to ensure immediate visibility.

3. **Validation**
   - The system must validate the assignment method and the assigned agent's existence before updating the participation manifest.
   - If the assignment method is invalid or the agent does not exist, the system must handle the error gracefully and not update the participation manifest.

4. **API Support**
   - The API must support retrieval of the updated participation manifest reflecting the current Owner.
   - The API must allow for assignment of epics via the supported methods.

5. **UI Integration**
   - The user interface must display the updated Owner role in the participation manifest.
   - The UI must provide visual cues or indicators when the ownership changes.

## Acceptance Criteria

- When an epic is assigned via `assignedAgentRef`, `assignedUserId`, or `assignedAgentHostId`, the Owner role in the participation manifest is updated to reflect the assigned agent within 5 seconds.
- The system correctly handles assignment methods and does not update the participation manifest if the assignment is invalid.
- The API returns the correct Owner information after an epic is assigned.
- The user interface accurately displays the current Owner of the epic.
- Error handling is in place for scenarios where the assignment method is unsupported or the assigned agent does not exist.

## Out of Scope

- **Bulk Assignments**: Handling bulk assignments of epics.
- **Permission Management**: Managing permissions related to ownership changes.
- **Audit Trails**: Maintaining detailed logs of ownership changes.
- **Integration with Other Systems**: Integration with external systems for ownership updates.
- **Customization of Participation Manifest**: Allowing customization of the participation manifest beyond the Owner role.

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