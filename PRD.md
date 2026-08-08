> **PRD** — drafted by Ada (Sr. Product Mgr) · task #890
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
The current system does not support the linkage between Epics/Initiatives and their child tasks/features. This gap leads to a lack of visibility into the hierarchical relationships within the product backlog, making it difficult for users to understand the broader context of their work items.

### Goal
Implement a mechanism to display the parent Epic or Initiative for each task/feature, or clearly indicate if an item is unlinked. This will enhance transparency and provide users with a clearer understanding of the relationships between different work items.

## Target Users / ICP Roles
- **Product Managers**: Need to view and manage the hierarchy of work items.
- **Project Managers**: Require visibility into the relationships between Epics/Initiatives and their child tasks/features.
- **Developers**: Benefit from understanding the context of their work items within the larger project scope.

## Scope

### In Scope
- Addition of a `parent_epic_id` field to the database schema.
- Modification of API responses to include the `parent_epic_id` field.
- Update of the UI to display the parent Epic/Initiative or indicate an unlinked status.
  - Option to display as a column in the task/feature list view.
  - Option to display as a tooltip on hover.
- Backend logic to handle the retrieval and association of parent Epics/Initiatives.

### Out of Scope
- Implementation of drag-and-drop functionality for reordering Epics/Initiatives.
- Automatic assignment of parent Epics/Initiatives based on keywords or other criteria.
- Visualization of the full hierarchy beyond the parent-child relationship.
- Support for multiple parent Epics/Initiatives for a single task/feature.

## Functional Requirements

1. **Database Schema Update**
   - Add a new field `parent_epic_id` to the task/feature table in the database.
   - Ensure that the `parent_epic_id` field is nullable to accommodate unlinked items.

2. **API Modification**
   - Update all relevant API endpoints to include the `parent_epic_id` in the response payload.
   - Ensure that the API documentation is updated to reflect this change.

3. **Backend Logic**
   - Implement logic to validate and associate the `parent_epic_id` with the correct Epic/Initiative.
   - Ensure that the system handles cases where the referenced Epic/Initiative does not exist.

4. **UI Updates**
   - Add a new column in the task/feature list view to display the parent Epic/Initiative title.
     - If the item is unlinked, display "Unlinked" in the column.
   - Alternatively, implement a tooltip on the task/feature title that shows the parent Epic/Initiative when hovered over.
   - Provide a filter option to view only linked or unlinked items.

5. **User Interactions**
   - Allow users to link a task/feature to an Epic/Initiative via a dropdown or search field in the task/feature details view.
   - Provide the ability to unlink a task/feature from its parent Epic/Initiative.

## Acceptance Criteria

1. The `parent_epic_id` field is successfully added to the database schema and is nullable.
2. All relevant API endpoints return the `parent_epic_id` in their response payloads.
3. The UI displays the parent Epic/Initiative title in the designated column or as a tooltip.
4. The UI clearly indicates if a task/feature is unlinked.
5. Users can link and unlink tasks/features to/from Epics/Initiatives via the UI.
6. The system correctly handles cases where the referenced Epic/Initiative does not exist.
7. The API documentation is updated to reflect the changes.

## Out of Scope

- Drag-and-drop functionality for reordering Epics/Initiatives.
- Automatic assignment of parent Epics/Initiatives.
- Visualization of the full hierarchy beyond the parent-child relationship.
- Support for multiple parent Epics/Initiatives for a single task/feature.

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