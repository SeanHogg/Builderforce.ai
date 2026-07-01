> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #206
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Stale Tasks List

## 1. Problem & Goal

**Problem:** Teams often struggle to keep track of tasks that have been open for an extended period without any recent activity. This "staleness" can lead to missed deadlines, decreased productivity, and a general lack of accountability.

**Goal:** To provide a clear and easily accessible list of tasks that are stale, enabling teams to proactively address them, re-prioritize, delegate, or close them out. This will improve task management efficiency and overall project momentum.

## 2. Target Users / ICP Roles

*   Project Managers
*   Team Leads
*   Individual Contributors
*   Scrum Masters
*   Anyone responsible for task management and workflow optimization.

## 3. Scope

This document outlines the requirements for a feature that identifies and presents a list of tasks that meet specific criteria for staleness. The feature will be accessible within the existing task management interface.

## 4. Functional Requirements

*   **FR.1: Task Identification:** The system shall identify tasks that are considered "stale" based on the following criteria:
    *   The task is currently in an "Open" or equivalent status (i.e., not "Closed," "Completed," "Done," or a similar terminal state).
    *   The task has had no activity (e.g., comment, status change, assignee change, due date change) for a configurable period of at least 14 days.
*   **FR.2: Stale Task List View:** A dedicated view (e.g., a tab, filter, or report) shall be available to display the identified stale tasks.
*   **FR.3: Displayed Task Information:** For each stale task in the list, the following information shall be displayed:
    *   Task Title/Name
    *   Task ID/Number
    *   Current Assignee(s)
    *   Original Creation Date
    *   Date of Last Activity
    *   Days Since Last Activity
    *   Link to the task for direct access.
*   **FR.4: Sortable List:** The stale task list shall be sortable by:
    *   Days Since Last Activity (ascending/descending)
    *   Date of Last Activity (ascending/descending)
    *   Task Title (alphabetical)
    *   Assignee (alphabetical)
*   **FR.5: Configurable Staleness Period:** The system shall allow administrators or authorized users to configure the "minimum days of inactivity" to define a stale task (defaulting to 14 days).
*   **FR.6: Filtering/Search:** Users shall be able to filter the stale task list by assignee, project, or other relevant task attributes.
*   **FR.7: Visual Indication:** Stale tasks within the main task list (if applicable) should have a visual indicator highlighting their stale status.

## 5. Acceptance Criteria

*   **AC.1:** A task marked "Open" and with no recorded activity for 15 days is correctly identified and appears in the "Stale Tasks List" view.
*   **AC.2:** A task marked "In Progress" with no recorded activity for 13 days is *not* identified as stale.
*   **AC.3:** A task that was "Open" and inactive for 10 days, but then had a comment added, is no longer identified as stale even if it hasn't had activity for another 5 days.
*   **AC.4:** The "Stale Tasks List" view displays Task Title, Assignee, Last Activity Date, and the number of "Days Since Last Activity" for all identified stale tasks.
*   **AC.5:** Clicking on a task in the "Stale Tasks List" navigates the user directly to that task's detail page.
*   **AC.6:** The stale task list can be sorted by "Days Since Last Activity" in descending order, showing the oldest inactive tasks first.
*   **AC.7:** An administrator can successfully change the staleness period from 14 days to 7 days, and the list updates accordingly.
*   **AC.8:** A user can filter the stale task list to show only tasks assigned to a specific individual.

## 6. Out of Scope

*   Automated task closing or archiving based on staleness.
*   Automated notifications or escalations for stale tasks (this may be a follow-up feature).
*   Integration with external communication tools for stale task follow-up.
*   Complex reporting dashboards beyond a simple list view.
*   Defining "activity" beyond comments, status changes, assignee changes, and due date changes.