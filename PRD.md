> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #185
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Task Status & Insights View

## 1. Problem & Goal

### Problem
Task management systems often lack a consolidated, at-a-glance view of a task's health, historical performance, and underlying data. Users struggle to quickly ascertain the current status, identify performance shifts, or understand the critical data driving a task's progress without extensive drill-downs or manual data correlation. This leads to delayed issue detection, inefficient oversight, and reactive decision-making.

### Goal
To provide task owners, project managers, and stakeholders with a single, intuitive view for each task that encapsulates its current health (Red/Yellow/Green), performance trend (Improving/Worsening/Stable), detected anomalies, and supporting data (both ingested and manual). This will enable proactive identification of task-related issues, foster data-driven decision-making, and improve overall task management efficiency.

## 2. Target Users / ICP Roles

*   **Task Owners:** Individuals responsible for completing specific tasks.
*   **Team Leads:** Managers overseeing teams and task progress.
*   **Project Managers:** Responsible for overall project health and task dependencies.
*   **Stakeholders:** Executives or clients requiring high-level task status updates.

## 3. Scope

This feature will introduce a new "Insights" section or tab within the existing task detail view. This section will display four key data points for the selected task: Current State, Trend, Anomalies, and Supporting Data. The data will be dynamically updated based on configured rules and integrated data sources.

## 4. Functional Requirements

*   **FR1: Display Current State Indicator**
    *   The system SHALL display a visual indicator for the task's current state (Red, Yellow, or Green).
    *   The state SHALL be determined by predefined business rules (e.g., due date proximity, sub-task completion, resource allocation status).
    *   A tooltip or popover SHALL provide a brief explanation of how the current state was determined.
*   **FR2: Display Trend Indicator**
    *   The system SHALL display a visual indicator for the task's performance trend (Improving, Worsening, or Stable).
    *   The trend SHALL be calculated based on changes in the task's state or key metrics over a defined historical period (e.g., last 7 days).
    *   A tooltip or popover SHALL provide a brief explanation of how the trend was determined.
*   **FR3: Display Detected Anomalies**
    *   The system SHALL list any detected anomalies pertinent to the task.
    *   Anomalies SHALL be identified by a predefined set of rules (e.g., missed deadlines, unusual activity patterns, unexpected resource consumption, critical path blockage).
    *   Each anomaly SHALL include a brief description and a timestamp of detection.
*   **FR4: Display Supporting Data**
    *   The system SHALL present relevant data points supporting the current state, trend, and anomaly detection.
    *   Data points SHALL be clearly categorized as "Ingested Data" (automated feeds) or "Manual Data" (user input).
    *   For ingested data, the source and last updated timestamp SHALL be displayed.
    *   Users SHALL be able to click on individual data points (where applicable) to view more details or historical charts.

## 5. Acceptance Criteria

*   **AC1: Current State Indicator**
    *   When a task's due date is within 24 hours and not completed, its state shows `RED`.
    *   When a task's due date is within 3 days and not completed, its state shows `YELLOW`.
    *   When a task is on track and outside the 3-day window, its state shows `GREEN`.
    *   The explanation tooltip accurately describes the rule triggering the displayed state.
*   **AC2: Trend Indicator**
    *   When the task's state has improved (e.g., from Yellow to Green) over the last 3 days, the trend shows `IMPROVING`.
    *   When the task's state has worsened (e.g., from Green to Yellow/Red) over the last 3 days, the trend shows `WORSENING`.
    *   When the task's state has remained unchanged over the last 3 days, the trend shows `STABLE`.
*   **AC3: Detected Anomalies**
    *   When a task's primary assignee has exceeded 100% estimated capacity for the next 5 working days, an anomaly "Resource Overload" is displayed.
    *   When a task's deadline is missed, an anomaly "Deadline Missed" is displayed.
    *   Each displayed anomaly includes its description and the exact timestamp.
*   **AC4: Supporting Data**
    *   The section displays at least 3 relevant data points (e.g., "Time Spent (Ingested)", "Sub-tasks Remaining (Ingested)", "Blockers (Manual)").
    *   Each data point clearly labels its type (`Ingested` or `Manual`).
    *   Clicking on "Time Spent (Ingested)" opens a modal showing a historical chart of time logged against the task over the last 30 days.

## 6. Out of Scope

*   Customization of R/Y/G, Trend, or Anomaly detection rules by end-users (admin-configured only).
*   Real-time notifications for status changes or anomalies (this release focuses on display).
*   Aggregated reporting or dashboard views across multiple tasks.
*   New task creation or editing capabilities within the new "Insights" section.
*   Integration with external 3rd party analytics platforms (beyond ingesting defined data feeds).
*   Predictive analytics for task completion or risk assessment.