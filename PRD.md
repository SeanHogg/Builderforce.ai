> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #205
> _Each agent that updates this PRD signs its change below._

# Velocity Metrics Per Project

## Problem & Goal

**Problem:** Project teams currently lack visibility into consistent velocity metrics for their projects. This makes it difficult to accurately forecast completion times, identify bottlenecks, and understand team performance.

**Goal:** To provide project teams with clear, actionable velocity metrics, specifically project completion percentage and average time-to-done, to improve predictability and efficiency in project delivery.

## Target Users / ICP Roles

*   Project Managers
*   Team Leads
*   Scrum Masters
*   Engineering Managers
*   Individual Contributors (for self-assessment)

## Scope

This feature will introduce the calculation and display of two key velocity metrics for active projects:

1.  **Project Completion Percentage:** Visualized as a progress bar indicating the percentage of work completed relative to the total estimated work.
2.  **Average Time-to-Done:** The average number of days it takes for a work item (e.g., task, story, bug) to move from "In Progress" to "Done."

These metrics will be accessible via a dedicated "Velocity" or "Reporting" section within the project view.

## Functional Requirements

1.  **Work Item Status Tracking:** The system must accurately track the status of all work items within a project.
2.  **Time-to-Done Calculation:** The system shall calculate the duration (in days) from the point a work item transitions to an "In Progress" state to the point it transitions to a "Done" state. Only work items that have reached a "Done" state will be included in this calculation.
3.  **Average Time-to-Done Aggregation:** The system shall calculate the average time-to-done for all completed work items within a project over a defined historical period (e.g., last 30 days, last quarter, project lifetime).
4.  **Total Work Estimation:** The system requires a mechanism to estimate the total effort or size of work items within a project (e.g., story points, estimated hours). This is necessary for calculating completion percentage.
5.  **Work Completed Estimation:** The system shall sum the estimates of all work items that have reached a "Done" state.
6.  **Project Completion Percentage Calculation:** The system shall calculate project completion percentage using the formula: `(Sum of estimates for Done work items / Total estimated work for the project) * 100`.
7.  **Metric Display:** The calculated project completion percentage and average time-to-done shall be displayed clearly within the project's reporting or velocity view.
8.  **Historical Data Window:** Users should have the ability to select a historical period for which to view the average time-to-done (e.g., last sprint, last 30 days, project lifetime).
9.  **Data Accuracy:** Calculations must be based on the actual timestamps of status transitions.

## Acceptance Criteria

*   **AC1:** A project with 10 tasks, each estimated at 1 story point, and 5 tasks marked as "Done" displays "Project Completion: 50%" with a corresponding visual indicator.
*   **AC2:** For a project with 3 completed tasks having durations of 2, 3, and 4 days respectively, the "Average Time-to-Done" metric displays "3 days."
*   **AC3:** When a new task is marked "Done," the project completion percentage and average time-to-done are immediately updated.
*   **AC4:** The historical data window selector allows users to choose "Last 30 Days," "Last Quarter," and "Project Lifetime" for viewing average time-to-done.
*   **AC5:** The system correctly handles projects with no completed work items, displaying "0%" completion and an N/A or "No data available" for average time-to-done.
*   **AC6:** The system accurately calculates time-to-done based on the difference between the "In Progress" and "Done" timestamp of individual work items.

## Out of Scope

*   Predictive forecasting of project completion dates based on velocity.
*   Integration with external BI tools for advanced reporting.
*   Automated alerts or notifications based on velocity metrics.
*   Defining custom "In Progress" or "Done" states beyond standard configurations.
*   Calculation of cycle time for work items that are not yet "Done."
*   Metrics on specific bottlenecks within the workflow (e.g., time spent in a particular status).