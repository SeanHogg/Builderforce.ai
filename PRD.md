> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #182
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Percentage-Complete Score per OKR Epic

## 1. Problem & Goal

### 1.1 Problem Statement
Currently, there is no standardized, automated way to quickly ascertain the progress of an OKR epic. Teams and stakeholders rely on manual updates or subjective assessments, leading to inconsistent reporting, lack of transparency, and difficulty in making informed decisions about epic progress and potential risks.

### 1.2 Goal
To provide an automated, clear, and consistent "percentage-complete" score for each OKR epic, enhancing visibility, facilitating data-driven reporting, and improving decision-making for all stakeholders.

## 2. Target Users / ICP Roles
*   Product Managers
*   Engineering Leads/Managers
*   Program Managers
*   OKR Owners
*   Team Leads
*   Stakeholders (e.g., Executives, Department Heads) needing quick progress updates

## 3. Scope
This feature will introduce a mechanism to automatically calculate and display a percentage-complete score for each OKR epic based on the completion status of its directly linked child items (e.g., stories, tasks, sub-tasks). The score will be visible on the OKR epic details view and update dynamically.

## 4. Functional Requirements

*   **FR.1: Item Association:** The system SHALL allow users to link stories, tasks, and sub-tasks to an OKR epic.
*   **FR.2: Completion Status Tracking:** The system SHALL accurately identify the completion status of all items linked to an OKR epic (e.g., "Done", "Completed", "Closed").
*   **FR.3: Percentage Calculation:** The system SHALL calculate the percentage complete of an OKR epic based on the ratio of "completed" linked items to the total number of linked items.
    *   *Formula:* `(Number of Completed Items / Total Number of Linked Items) * 100`
*   **FR.4: Display:** The system SHALL display the calculated percentage-complete score prominently on the OKR epic's dedicated view/page.
*   **FR.5: Real-time Update:** The system SHALL update the percentage-complete score in near real-time whenever the completion status of any linked item changes.
*   **FR.6: Informational Tooltip:** The system SHOULD provide a tooltip or a small information icon near the percentage score, explaining the calculation method (e.g., "Calculated based on 5 of 10 linked tasks completed").

## 5. Acceptance Criteria

*   **AC.1:** When an OKR epic has 0 linked items, its percentage-complete score is 0%.
*   **AC.2:** When an OKR epic has N linked items, and all N items are marked as "Done", its percentage-complete score is 100%.
*   **AC.3:** When an OKR epic has N linked items, and M items are marked as "Done" (where 0 < M < N), its percentage-complete score is (M/N * 100)%, rounded to the nearest whole number.
*   **AC.4:** The percentage-complete score is clearly visible on the OKR epic details page for all relevant user roles.
*   **AC.5:** Changing the status of a linked item from a non-completed state (e.g., "To Do", "In Progress") to a completed state (e.g., "Done", "Closed") immediately updates the epic's percentage complete.
*   **AC.6:** Changing the status of a linked item from a completed state to a non-completed state immediately updates the epic's percentage complete.
*   **AC.7:** The tooltip (if implemented) accurately describes the calculation and current item count breakdown.

## 6. Out of Scope

*   Weighting linked items in the percentage calculation (e.g., by story points, estimated time, complexity). The current calculation is based solely on item count.
*   Configurable "completed" statuses. The system will rely on a predefined or standard "Done" state for linked items.
*   Historical tracking or trending of the percentage-complete score over time.
*   Aggregation of percentage-complete scores beyond the individual epic level (e.g., for an Objective or Key Result).
*   Predictive completion dates or burn-down/up charts based on velocity.
*   Customizable formulas or weighting schemes for percentage calculation.