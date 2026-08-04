> **PRD** — drafted by Ada (Sr. Product Mgr) · task #1225
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
When the number of assignees exceeds the 8-avatar cap in the `TeamMemberAvatarFilter` component, the selected assignee can become hidden if their position in the sorted `assignees` list changes due to updates in task counts. This results in the board being filtered by an invisible assignee, causing confusion and requiring the user to clear the filter to regain visibility.

### Goal
Ensure that selected assignees remain visible and accessible to the user, even when the assignee list exceeds the 8-avatar cap. This will prevent the board from being filtered by hidden assignees and improve user experience by providing clear feedback on active filters.

## Target Users / ICP Roles
- **Project Managers**: Users who frequently filter tasks by assignee to manage workloads and track progress.
- **Team Members**: Users who need to understand which tasks are assigned to them or others and need to adjust filters accordingly.

## Scope

### In-Scope
- Modify the `TeamMemberAvatarFilter` component to always display selected assignees, regardless of the 8-avatar cap.
- Ensure that the selected assignees are rendered ahead of the cap, maintaining their visibility.
- Update the rendering logic to partition assignees into selected and unselected groups.
- Fill the remaining slots up to 8 with unselected assignees.
- Maintain the functionality of the `+N more` chip for overflow assignees.

### Out-of-Scope
- Changing the sorting mechanism of the `assignees` list.
- Modifying the behavior of the `+N more` chip beyond displaying selected assignees with badges.
- Altering the appearance or functionality of the ✕ clear button.
- Any changes to the task filtering logic or backend.

## Functional Requirements

1. **Assignee Partitioning**
   - The `assignees` list should be partitioned into selected and unselected groups.
   - Selected assignees should be rendered first, followed by unselected assignees.

2. **Rendering Logic**
   - Always render all selected assignees.
   - Fill the remaining slots up to 8 with unselected assignees.
   - If there are more unselected assignees than available slots after rendering selected assignees, display the `+N more` chip with the correct count.

3. **Overflow Handling**
   - The `+N more` chip should include badges for any selected assignees that are not rendered due to the cap.
   - Clicking on the `+N more` chip should open a popover listing all overflow assignees, with selected ones clearly marked.

4. **Avatar Interaction**
   - All rendered avatars, including selected ones, should remain interactive.
   - Clicking on a selected assignee's avatar should deselect it and update the board's task display accordingly.

## Acceptance Criteria

1. **Visibility**
   - Selected assignees are always visible in the `TeamMemberAvatarFilter` component, regardless of the 8-avatar cap.
   - The `+N more` chip accurately reflects the number of unselected assignees not rendered due to the cap.

2. **Functionality**
   - Clicking on a selected assignee's avatar successfully deselects it and updates the board's task display.
   - The `+N more` chip opens a popover listing all overflow assignees, with selected ones clearly marked.

3. **User Experience**
   - The board does not appear to filter by invisible assignees.
   - Users have a clear indication of which assignees are active filters.

4. **Performance**
   - The changes do not negatively impact the performance of the `TeamMemberAvatarFilter` component or the overall application.

## Out of Scope

- Modifying the sorting order of the `assignees` list.
- Altering the behavior of the `+N more` chip beyond displaying selected assignees with badges.
- Changing the appearance or functionality of the ✕ clear button.
- Any changes to the task filtering logic or backend.

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