> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #340
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Blocked Items

## 1. Problem & Goal

### 1.1 Problem
Project teams often struggle to quickly identify and address tasks that are stalled due to unresolved dependencies or external issues. This lack of visibility leads to delayed resolutions, inaccurate progress reporting, missed deadlines, and inefficient resource allocation as team members may continue working on dependent tasks unaware of blockers.

### 1.2 Goal
Enable users to clearly mark, track, filter, and monitor tasks that are currently blocked, improving project transparency, accelerating issue identification and resolution, and facilitating proactive management of dependencies to maintain project velocity.

## 2. Target Users / ICP Roles
*   **Project Managers / Team Leads**: To gain an immediate overview of project bottlenecks, prioritize unblocking efforts, and reallocate resources effectively.
*   **Individual Contributors (Developers, Designers, etc.)**: To clearly signal when their progress is hindered, provide context for the blocker, and request assistance.
*   **Stakeholders**: To understand project health and potential risks at a glance, without deep diving into individual task statuses.

## 3. Scope
This feature focuses on providing a manual mechanism for users to identify and manage blocked tasks within the existing task management system. It includes marking a task as blocked, providing a reason, visual identification, and basic filtering capabilities.

## 4. Functional Requirements

*   **FR1.1: Mark as Blocked**: Users SHALL be able to mark a task as "Blocked" from its detail view or context menu.
*   **FR1.2: Blocker Reason Input**: When a task is marked "Blocked" (FR1.1), a mandatory text field for "Blocker Reason" SHALL appear, allowing users to describe why the task is blocked.
*   **FR1.3: Reason Character Limit**: The "Blocker Reason" field SHALL support up to 255 characters.
*   **FR1.4: Visual Indicator**: Blocked tasks SHALL display a distinct visual indicator (e.g., a red flag icon, a specific badge) in all relevant views (list, board, detail).
*   **FR1.5: Filter Blocked Tasks**: Users SHALL be able to filter task lists and boards to show only tasks marked as "Blocked."
*   **FR1.6: Unmark as Blocked**: Users SHALL be able to unmark a task as "Blocked" from its detail view or context menu.
*   **FR1.7: Blocker Reason Persistence**: The "Blocker Reason" SHALL be visible in the task's detail view as long as the task is marked "Blocked".
*   **FR1.8: Blocker Reason Clearing**: When a task is unmarked as "Blocked" (FR1.6), the "Blocker Reason" SHALL be cleared.

## 5. Acceptance Criteria

*   **AC1.1**: A user can successfully toggle a task's status between "Blocked" and "Not Blocked."
*   **AC1.2**: Marking a task "Blocked" prompts for a mandatory "Blocker Reason," and the task cannot be saved as "Blocked" without one.
*   **AC1.3**: The provided "Blocker Reason" is saved and accurately displayed on the task detail view and associated hover/tooltip in list views.
*   **AC1.4**: Tasks marked "Blocked" are visually distinguishable from unblocked tasks across all primary task views (e.g., list, board, calendar).
*   **AC1.5**: Applying the "Blocked" filter accurately displays only tasks currently marked as "Blocked," and no unblocked tasks.
*   **AC1.6**: Unmarking a task as "Blocked" removes its visual indicator and clears its associated "Blocker Reason."

## 6. Out of Scope
*   Automatic blocking of tasks based on dependencies (e.g., if a parent task is blocked, children are not automatically blocked).
*   Notification system for blocked tasks (e.g., alerting assigned users, project managers).
*   Historical logging of blocker reasons or changes in blocked status.
*   Categorization or predefined types for blocker reasons.
*   Integration with external systems for identifying or resolving blockers.
*   Customizable "blocked" statuses beyond a simple binary (e.g., "Waiting for Review," "On Hold").
*   Dedicated dashboard widgets or reports specifically for blocked items beyond standard filtering.