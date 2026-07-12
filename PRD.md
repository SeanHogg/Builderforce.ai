> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #339
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Stale/Aging WIP Identification

## 1. Problem & Goal

### 1.1 Problem
Tasks in a "Work In Progress" (WIP) state that remain untouched for extended periods (e.g., >7 days) lead to several critical issues:
*   **Inaccurate Progress Reporting:** Stakeholders see tasks as active when no actual work is occurring, leading to misleading project status updates.
*   **Blocked Throughput:** Stale WIP items can artificially inflate WIP limits, preventing new work from being pulled in or masking true bottlenecks.
*   **Resource Misallocation:** Teams may be perceived as busy with active work, while resources are actually underutilized or focused on lower-priority items.
*   **Increased Context Switching & Re-work:** When a task becomes stale, resuming it often requires re-establishing context, reducing efficiency.

### 1.2 Goal
To improve project visibility, throughput, and resource allocation by accurately identifying, highlighting, and enabling teams to address work-in-progress tasks that have been inactive for a defined period.

## 2. Target Users / ICP Roles

*   **Project Managers / Program Managers:** To monitor project health, identify blockers, and manage pipeline flow.
*   **Team Leads / Scrum Masters:** To guide team focus, facilitate daily stand-ups, and ensure continuous delivery.
*   **Individual Contributors (ICs):** To self-manage their active tasks and ensure timely progression of their assignments.

## 3. Scope

This feature will focus on the identification, visualization, and basic notification of stale work-in-progress tasks.

## 4. Functional Requirements

### 4.1. Stale Task Identification
*   **FR1.1:** The system SHALL identify tasks that are currently in a designated "Work In Progress" (or equivalent, configurable) status.
*   **FR1.2:** The system SHALL track the last activity date for all tasks (activity defined as: status change, comment added, assignee changed, description/title updated, sub-task status change).
*   **FR1.3:** The system SHALL flag a task as "stale" if it meets FR1.1 AND has had no recorded activity (per FR1.2) for more than 7 consecutive days.
*   **FR1.4:** The 7-day threshold SHALL be configurable by an administrator.

### 4.2. Stale Task Visibility
*   **FR2.1:** The system SHALL provide a dedicated filter option in task lists and board views to display only "stale" tasks.
*   **FR2.2:** Stale tasks SHALL be visually distinguished in task lists and board views (e.g., a specific icon, color overlay, or tag).
*   **FR2.3:** The system SHALL display the number of days a task has been stale when viewing its details or in filtered views.

### 4.3. Notification (Optional, but recommended for V1)
*   **FR3.1:** The system MAY send a daily summary notification (e.g., email or in-app) to the assignee(s) of stale tasks, listing their respective stale items.
*   **FR3.2:** The system MAY send a daily/weekly summary notification to Team Leads/Project Managers detailing stale tasks within their owned projects/teams.

### 4.4. Activity Reset
*   **FR4.1:** Any new activity (as defined in FR1.2) on a stale task SHALL reset its stale counter to zero and remove the stale flag.

## 5. Acceptance Criteria

*   **AC1:** A task moved into "In Progress" on Day 1, with no subsequent activity, is correctly flagged as "stale" on Day 8.
*   **AC2:** A task flagged as "stale" receives a new comment; the stale flag is removed, and its stale counter resets to 0.
*   **AC3:** Using the "Show Stale Tasks" filter correctly displays only tasks currently identified as stale.
*   **AC4:** The visual indicator for stale tasks is clearly distinguishable from non-stale tasks across all relevant views.
*   **AC5:** An administrator successfully changes the stale threshold from 7 to 5 days, and tasks are subsequently flagged according to the new threshold.
*   **AC6:** (If FR3.1 is in scope) An assignee with a stale task receives a notification listing that task within the configured frequency.

## 6. Out of Scope

*   Automated status changes for stale tasks (e.g., automatically moving to "Blocked" or "Archived").
*   Automated reassignment of stale tasks.
*   Automated commenting or bot interactions on stale tasks.
*   Complex analytical dashboards or detailed reporting specifically for stale WIP beyond basic listing and counts.
*   Integration with external messaging platforms (e.g., Slack, Microsoft Teams) for stale task notifications (notifications will be in-app or email only).