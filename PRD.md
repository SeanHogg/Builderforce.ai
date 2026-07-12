> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #342
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Backlog Health Monitoring

## Problem & Goal

### Problem
Teams lack consistent visibility into the readiness and health of their product backlog. This often leads to inefficient sprint planning sessions, increased risk of committing to undefined or unsized work, and an inability to forecast future work accurately. Key issues include:
*   Difficulty identifying immediately actionable work.
*   Last-minute grooming during sprint planning.
*   Uncertainty about the scope and effort of upcoming items.

### Goal
To provide product teams and stakeholders with clear, real-time visibility into the health of their backlog by displaying the ratio of groomed versus ungroomed, and sized versus unsized backlog items. This will enable proactive backlog management, improve planning efficiency, and facilitate more accurate forecasting.

## Target Users / ICP Roles
*   **Product Managers / Product Owners:** To understand the readiness of their backlog for upcoming sprints and ensure continuous grooming.
*   **Engineering Leads / Managers:** To assess the availability of well-defined work for their teams and contribute to sizing efforts.
*   **Scrum Masters / Agile Coaches:** To identify coaching opportunities for backlog refinement processes and promote good agile practices.
*   **Team Members:** To gain insight into the state of the backlog they will be working from.

## Scope

This feature will introduce a new report or dashboard widget that calculates and displays two primary ratios for a selected backlog:
1.  **Groomed vs Ungroomed:** Percentage of backlog items that meet the definition of "groomed".
2.  **Sized vs Unsized:** Percentage of backlog items that have a defined estimate (e.g., story points).

The report will enable filtering by project or team and display the current state of the backlog health.

## Functional Requirements

*   **FR1: Calculate Groomed Ratio:** The system shall calculate the percentage of "groomed" backlog items out of the total relevant backlog items.
    *   *Definition of "Groomed":* A backlog item is considered "groomed" if it is in the `Ready for Development` workflow state AND has content in its `Acceptance Criteria` field.
*   **FR2: Calculate Sized Ratio:** The system shall calculate the percentage of "sized" backlog items out of the total relevant backlog items.
    *   *Definition of "Sized":* A backlog item is considered "sized" if its `Story Points` field (or equivalent numerical estimate field) contains a positive integer value (`> 0`).
*   **FR3: Display Ratios:** The system shall display the calculated "Groomed" and "Sized" percentages prominently in a dedicated dashboard widget or report view.
*   **FR4: Filtering:** The report shall allow users to filter the displayed ratios by:
    *   Project
    *   Team
    *   Backlog query (e.g., "items in sprint N+1, N+2")
*   **FR5: Data Refresh:** The displayed ratios shall be updated daily automatically and offer a manual "Refresh" option for on-demand updates.
*   **FR6: Item Inclusion:** The calculation shall include all `Story`, `Bug`, and `Task` type work items within the selected scope that are not in a `Done` or `Closed` state.

## Acceptance Criteria

*   **AC1:** Users can navigate to the "Backlog Health" report/widget from the main project dashboard.
*   **AC2:** The report clearly displays two distinct percentages: "X% Groomed" and "Y% Sized".
*   **AC3:** The displayed percentages are accurate based on the definitions in FR1 and FR2 when manually verified against a sample set of backlog items.
*   **AC4:** When a user applies a filter (e.g., selects a different project), the displayed ratios update correctly to reflect the filtered backlog.
*   **AC5:** Clicking the "Refresh" button immediately updates the displayed percentages with the latest data.
*   **AC6:** The UI for the report is intuitive and provides a quick overview of backlog health without requiring deep drill-down for initial assessment.

## Out of Scope

*   **Trend Analysis:** Tracking backlog health ratios over time or displaying historical graphs.
*   **Alerting:** Automated notifications or alerts based on predefined thresholds for backlog health ratios.
*   **Configuration of Definitions:** Allowing users to customize the definitions of "groomed" or "sized" beyond the specified workflow states and fields.
*   **Root Cause Analysis:** Providing automated insights into *why* items are ungroomed or unsized (e.g., missing specific sub-fields of acceptance criteria).
*   **Predictive Analytics:** Forecasting future backlog health based on current trends.
*   **Automated Grooming/Sizing:** Any functionality that automatically modifies backlog items (e.g., adding story points, marking as groomed).
*   **Detailed Item Lists:** Displaying the full list of groomed/ungroomed or sized/unsized items directly within this primary report (this should be a drill-down capability if implemented separately).