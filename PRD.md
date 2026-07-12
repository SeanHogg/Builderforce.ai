> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #346
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Overdue/Stale/Blocked Task Detection with Evidence

## Problem & Goal

**Problem:** Tasks often become overdue, stale (inactive), or blocked without clear visibility, leading to project delays, reduced productivity, and lack of accountability. Manual tracking is time-consuming and prone to human error, especially in complex projects with numerous dependencies.

**Goal:** To automatically detect and surface overdue, stale, or blocked tasks across integrated task management systems, providing clear evidence for their status. This aims to empower project managers, team leads, and individual contributors to proactively address impediments, improve workflow efficiency, and maintain project momentum.

## Target Users / ICP Roles

*   **Project Managers / Program Managers:** To maintain oversight of project health and identify bottlenecks.
*   **Team Leads / Scrum Masters:** To facilitate daily stand-ups, unblock team members, and ensure sprint goals are met.
*   **Individual Contributors:** To gain awareness of their own potentially stuck tasks and prompt action, or to easily see dependencies holding them back.
*   **Stakeholders:** To get a high-level view of project risks and progress.

## Scope

This feature will provide a configurable system to:
1.  Define rules for identifying overdue, stale, and blocked tasks.
2.  Scan integrated task management systems (e.g., Jira, Asana, GitHub Issues).
3.  Collect and display relevant "evidence" for the detected status.
4.  Notify relevant users about identified tasks.
5.  Allow users to review and dismiss detections.

## Functional Requirements

*   **FR1: Configurable Detection Rules:**
    *   **FR1.1: Overdue:** Users must be able to define what constitutes "overdue" (e.g., `due_date < today`).
    *   **FR1.2: Stale:** Users must be able to define what constitutes "stale" (e.g., `last_updated > X days`, `no_comments > Y days`, `no_status_change > Z days`).
    *   **FR1.3: Blocked:** Users must be able to define criteria for "blocked" (e.g., `status = "Blocked"`, `has_dependency_in_blocked_state`, `linked_PR_is_stuck`).
    *   **FR1.4: Rule Prioritization:** System should allow for multiple rules and define their priority or AND/OR logic.
*   **FR2: Task Scanning & Integration:**
    *   **FR2.1:** System must integrate with specified task management platforms (initial focus: Jira, GitHub Issues).
    *   **FR2.2:** System must periodically scan tasks based on configured intervals.
    *   **FR2.3:** System must retrieve task details including status, assignee, due date, last updated date, comments, linked PRs, and dependencies.
*   **FR3: Evidence Collection & Display:**
    *   **FR3.1:** For each detected task, the system must collect and display relevant evidence supporting its classification (e.g., "Last updated 30 days ago", "No comments in 15 days", "Linked PR #123 is in 'Review Requested' for 7 days", "Dependent task ABC-456 is 'Blocked'").
    *   **FR3.2:** Evidence should be presented in an easily digestible format (e.g., summary bullet points, direct links to relevant comments/PRs).
    *   **FR3.3:** The UI should clearly distinguish between overdue, stale, and blocked tasks.
*   **FR4: Notification System:**
    *   **FR4.1:** Users must be able to configure notification preferences (e.g., email, Slack, in-app notification).
    *   **FR4.2:** Notifications should include a summary of detected tasks and links to view details.
    *   **FR4.3:** Notifications can be configured for individuals, teams, or specific roles.
    *   **FR4.4:** Notification frequency must be configurable (e.g., daily, weekly).
*   **FR5: Review & Dismissal Workflow:**
    *   **FR5.1:** Users must be able to mark a detected task as "Reviewed" or "Not an issue" to remove it from the active detection list temporarily or permanently.
    *   **FR5.2:** Dismissed tasks should have an option to reappear if the underlying issue persists or re-emerges after a defined period.
    *   **FR5.3:** Users should be able to provide an optional comment when dismissing a task.
*   **FR6: Dashboard & Reporting:**
    *   **FR6.1:** A dashboard view should summarize currently detected overdue, stale, and blocked tasks across projects/teams.
    *   **FR6.2:** Filters should be available to view tasks by project, assignee, status type, etc.

## Acceptance Criteria

*   **AC1: Accuracy:** The system accurately identifies tasks as overdue, stale, or blocked based on configured rules 95% of the time.
*   **AC2: Evidence Clarity:** For every detected task, at least one clear piece of evidence is displayed that justifies its classification.
*   **AC3: Notification Delivery:** Configured notifications are sent reliably and contain actionable information and links.
*   **AC4: User Control:** Users can successfully define, enable, and disable detection rules, and configure notification preferences.
*   **AC5: Dismissal Effectiveness:** Dismissing a task successfully removes it from the active detection list until conditions for reappearance are met or manually reactivated.
*   **AC6: Performance:** Task scanning completes within a reasonable timeframe (e.g., within 5 minutes for 10,000 tasks); UI loads detection results within 3 seconds.
*   **AC7: Integration Robustness:** The system maintains stable connections with integrated task management platforms and handles API rate limits gracefully.

## Out of Scope

*   **Automated Remediation:** The system will not automatically change task statuses, reassign tasks, or post comments to resolve issues. It is purely for detection and alerting.
*   **Advanced Predictive Analytics:** Beyond rule-based detection, this phase will not include AI/ML-driven prediction of future blockers or delays.
*   **Cross-System Task Management:** The system will not provide functionality to create, edit, or manage tasks across different integrated platforms.
*   **Custom Integrations (Phase 1):** While extensible, initial scope limits direct integrations to a defined set (Jira, GitHub Issues). Custom API integrations for other systems are out of scope for this phase.