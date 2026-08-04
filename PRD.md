> **PRD** — drafted by Ada (Sr. Product Mgr) · task #800
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
Currently, when an epic has no assignee, the system does not clearly indicate that the epic is unstaffed. This lack of visibility can lead to confusion and inefficiency in project management, as stakeholders may not immediately recognize that an epic requires attention or assignment.

### Goal
To enhance project management transparency and efficiency by clearly indicating when an epic is unstaffed. The system should automatically set the Owner field to `unstaffed` when an epic has no assignee.

## Target Users / ICP Roles

- **Project Managers**: Need to quickly identify unstaffed epics to allocate resources effectively.
- **Team Leads**: Require visibility into unassigned epics to ensure team workload balance and project progress.
- **Executives**: Benefit from clear indicators of project status to make informed decisions.

## Scope

### In-Scope
- Automatically updating the Owner field to `unstaffed` when an epic has no assignee.
- Providing a clear visual indicator for unstaffed epics in the epic list view.
- Ensuring that the change is reflected in all relevant views and reports.

### Out-of-Scope
- Automatic assignment of epics to team members.
- Notification systems for unstaffed epics.
- Changes to the epic creation or editing process.

## Functional Requirements

1. **Automatic Owner Field Update**
   - When an epic is created without an assignee, the Owner field should default to `unstaffed`.
   - If an epic is edited and the assignee is removed, the Owner field should be updated to `unstaffed`.
   - The system should handle bulk updates and ensure that the Owner field is correctly set for all affected epics.

2. **Visual Indicator in Epic List View**
   - Unstaffed epics should be clearly marked in the epic list view with a distinct visual indicator (e.g., a specific color or icon).
   - The visual indicator should be consistent across all views and devices.

3. **Integration with Reporting Tools**
   - The Owner field status should be accurately reflected in all reporting tools and dashboards.
   - Reports should include a filter for unstaffed epics to allow for focused analysis.

4. **User Permissions and Access**
   - Only users with appropriate permissions should be able to change the Owner field from `unstaffed` to an assignee.
   - The system should maintain audit logs of changes to the Owner field for accountability.

## Acceptance Criteria

- [ ] When an epic is created without an assignee, the Owner field is automatically set to `unstaffed`.
- [ ] When an assignee is removed from an epic, the Owner field is updated to `unstaffed`.
- [ ] Unstaffed epics are visually distinguished in the epic list view.
- [ ] The Owner field status is accurately reflected in all reports and dashboards.
- [ ] Users with appropriate permissions can change the Owner field from `unstaffed` to an assignee.
- [ ] Audit logs record changes to the Owner field.

## Out of Scope

- Automatic assignment of epics to team members.
- Notification systems for unstaffed epics.
- Changes to the epic creation or editing process.
- Modification of user permission structures.

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