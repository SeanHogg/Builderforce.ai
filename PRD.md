> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #78
> _Each agent that updates this PRD signs its change below._

```markdown
# Product Requirements Document: Team Member Avatar Filters on Task Board

## 1. Problem & Goal

### 1.1. Problem
Users currently lack the ability to efficiently filter the task board by assigned team members. This hinders quick identification of individual workloads, progress, and relevant tasks, leading to slower navigation and analysis of board contents.

### 1.2. Goal
Enable users to quickly filter the task board by assigned team member(s) through an intuitive, interactive avatar-based filter interface, thereby improving task visibility and board navigation efficiency.

## 2. Target Users / ICP Roles

*   **Project Managers / Team Leads:** To monitor individual team member workloads and progress at a glance.
*   **Individual Contributors:** To quickly filter the board to see only their assigned tasks or tasks assigned to specific colleagues they are collaborating with.
*   **Stakeholders:** To gain immediate insight into who is working on what without extensive searching.

## 3. Scope

This feature focuses on adding a new filter mechanism to the existing task board filter bar. It specifically includes the display of team member avatars as clickable filter chips, the associated filtering logic, and visual states.

**Location:** Task board filter bar — adjacent to status & priority dropdowns.

## 4. Functional Requirements

*   **FR.1: Display Avatar Filter Chips:** The system shall display a row of clickable team member avatars within the task board's filter bar.
    *   **FR.1.1:** Avatars should represent all team members assigned tasks visible on the current board view.
    *   **FR.1.2:** Each avatar must include a badge indicating the count of tasks currently assigned to that member.
*   **FR.2: Filter by Single Member:** Upon clicking a single team member avatar, the task board shall dynamically filter to display only tasks assigned to that specific member.
*   **FR.3: Filter by Multiple Members:** The system shall allow users to select multiple team member avatars.
    *   **FR.3.1:** When multiple avatars are selected, the board shall display tasks assigned to *any* of the selected members (OR logic). A clear UI toggle for AND/OR logic is outside this scope but should be considered for future iterations if user feedback indicates a need for AND logic.
*   **FR.4: Visual Filter State:** The UI shall clearly indicate which team member avatars are currently active filters (e.g., highlighted, distinct chip style).
*   **FR.5: Clear/Reset Filter:** A dedicated option (e.g., "All" avatar, "Clear Filters" button) shall be available to reset the team member filter, showing tasks for all team members.
*   **FR.6: Responsiveness:** The avatar filter row shall adapt gracefully to different screen sizes, potentially using horizontal scrolling or collapsing into a dropdown for smaller viewports.
*   **FR.7: Composability:** The team member avatar filter must function correctly and compose with existing filters (e.g., search, status, priority), applying all active filters in conjunction.

## 5. Acceptance Criteria

*   [x] Display team member avatars as clickable filter chips (row or horizontal scroll).
*   [x] Clicking an avatar filters the board to show only tasks assigned to that member.
*   [x] Multiple avatars can be selected (OR logic initially; AND/OR toggle is a future enhancement).
*   [x] Active filter state is visually clear (highlighted avatar, chip style).
*   [x] "All" / clear option to reset the filter.
*   [x] Responsive — works on smaller screens (horizontal scroll or collapse).
*   [x] Avatars should show a count badge of assigned tasks.
*   [x] Works alongside existing search, status, and priority filters (composable).

## 6. Out of Scope

*   **`parentTaskId` Surfacing:** Addressing the problem of `parentTaskId` not being surfaced to make epic groupings visible is a separate feature for board hierarchy and grouping, and is not covered by this PRD.
*   **New Filter Types:** Any filter types beyond team member assignment (e.g., "unassigned tasks," "tasks I'm following").
*   **Avatar Management:** Functionality for adding, editing, or deleting team member avatars or managing their association with user profiles. This assumes avatar data is provided by an existing user management system.
*   **Complex Filtering Logic:** Advanced conditional filtering (e.g., "show tasks assigned to A AND (B OR C)").
*   **Saved Filters:** Persisting selected team member filters across sessions or as part of custom saved board views.
*   **Filter Sharing:** Functionality to share specific filtered board views with other users.
```