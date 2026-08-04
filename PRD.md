> **PRD** — drafted by Ada (Sr. Product Mgr) · task #834
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
Currently, when an epic has no assignee, the system does not clearly indicate that the epic is unstaffed. This lack of visibility can lead to confusion and inefficiency in project management, as stakeholders may not immediately recognize that an epic requires attention or resources.

### Goal
To enhance project management transparency and efficiency by clearly indicating when an epic is unstaffed. The system should automatically set the Owner field to `unstaffed` when an epic has no assignee.

## Target Users / ICP Roles

- **Project Managers**: Need to quickly identify unstaffed epics to allocate resources effectively.
- **Team Leads**: Require visibility into unstaffed epics to assign team members and manage workloads.
- **Executives**: Benefit from clear indicators of project status to make informed decisions.

## Scope

- **In Scope**:
  - Automatically update the Owner field to `unstaffed` when an epic has no assignee.
  - Provide a clear visual indicator in the UI for unstaffed epics.
  - Allow manual override of the Owner field if necessary.

- **Out of Scope**:
  - Automatic assignment of epics to team members.
  - Notification system for unstaffed epics.
  - Historical tracking of Owner field changes.

## Functional Requirements

1. **Automatic Owner Field Update**:
   - When an epic is created without an assignee, the Owner field should default to `unstaffed`.
   - If an epic has an assignee and the assignee is removed, the Owner field should automatically update to `unstaffed`.
   - The Owner field should only be editable to `unstaffed` or a valid user.

2. **User Interface (UI) Indicator**:
   - Unstaffed epics should be visually distinguished in the epic list view (e.g., via a specific color or icon).
   - The Owner field should display `unstaffed` in a prominent manner within the epic details view.

3. **Manual Override Capability**:
   - Users with appropriate permissions should be able to manually set the Owner field to `unstaffed` or assign an owner.
   - A confirmation dialog should be implemented when overriding the Owner field to prevent accidental changes.

4. **API Support**:
   - The API should support setting the Owner field to `unstaffed` and reflect this status in responses.

## Acceptance Criteria

- **Scenario 1: Epic Created Without Assignee**
  - Given: An epic is created without an assignee.
  - When: The epic is saved.
  - Then: The Owner field is set to `unstaffed`.
  - And: The epic is visually indicated as unstaffed in the list view.

- **Scenario 2: Assignee Removed from Epic**
  - Given: An epic has an assignee.
  - When: The assignee is removed.
  - Then: The Owner field is updated to `unstaffed`.
  - And: The epic is visually indicated as unstaffed in the list view.

- **Scenario 3: Manual Override of Owner Field**
  - Given: An epic is unstaffed.
  - When: A user with permissions sets the Owner field to a valid user.
  - Then: The Owner field is updated to the selected user.
  - And: The epic is no longer visually indicated as unstaffed.

- **Scenario 4: API Interaction**
  - Given: An epic is unstaffed.
  - When: The API is queried for the epic.
  - Then: The response includes the Owner field as `unstaffed`.

## Out of Scope

- **Automatic Assignment**: The system will not automatically assign unstaffed epics to team members.
- **Notification System**: There will be no notifications for unstaffed epics.
- **Historical Tracking**: Changes to the Owner field will not be tracked historically.
- **Advanced Filtering**: The system will not include advanced filtering options for unstaffed epics.

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