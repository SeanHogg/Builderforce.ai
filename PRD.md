> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #199
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Completion Rate Calculation

## 1. Problem & Goal

**Problem:** Teams need a clear and consistent way to understand the completion progress of tasks across various projects within our platform. Currently, this information is scattered and not easily aggregated for a unified view.

**Goal:** To develop a feature that accurately calculates and displays the completion rate of tasks for individual projects and across all projects, providing users with actionable insights into project progress and potential bottlenecks.

## 2. Target Users / ICP Roles

*   **Project Managers:** To monitor team progress, identify stalled tasks, and report on project status.
*   **Team Leads:** To track individual and team task completion, allocate resources effectively, and ensure team alignment.
*   **Individual Contributors:** To visualize their own task progress and understand their contribution to overall project goals.
*   **Stakeholders/Executives:** To gain a high-level overview of project completion across the organization.

## 3. Scope

This initial iteration will focus on calculating and displaying the completion rate for tasks within defined projects on the BuilderForce.AI platform. It will support manual or automatically updated task statuses.

## 4. Functional Requirements

*   **FR-1: Task Status Tracking:** The system must be able to track the status of individual tasks. Supported statuses will include at a minimum: "To Do", "In Progress", and "Done".
*   **FR-2: Project-Level Completion Rate Calculation:** For each project, the system shall calculate the completion rate using the formula: `(Number of "Done" tasks / Total number of tasks) * 100%`.
*   **FR-3: Global Completion Rate Calculation:** The system shall calculate a global completion rate across all projects, using the formula: `(Total "Done" tasks across all projects / Total tasks across all projects) * 100%`.
*   **FR-4: Display Completion Rate:** The calculated completion rates (project-level and global) shall be displayed prominently within the user interface.
*   **FR-5: Data Aggregation:** The system needs to aggregate task counts and "Done" task counts from all relevant projects for global calculation.

## 5. Acceptance Criteria

*   **AC-1:** Given a project with 13 "Done" tasks and a total of 19 tasks, the project completion rate displayed must be 68%.
*   **AC-2:** Given a project with 0 "Done" tasks and a total of 40 tasks, the project completion rate displayed must be 0%.
*   **AC-3:** Given a project with 1 "Done" task and a total of 9 tasks, the project completion rate displayed must be 11% (rounded up).
*   **AC-4:** Given a project with 0 "Done" tasks and a total of 9 tasks, the project completion rate displayed must be 0%.
*   **AC-5:** The global completion rate calculation must accurately sum "Done" tasks and total tasks across all listed projects (13 + 0 + 1 + 0 = 14 "Done" tasks; 19 + 40 + 9 + 9 = 77 total tasks), resulting in a displayed global rate of approximately 18%.
*   **AC-6:** Task statuses can be updated, and the displayed completion rates (project and global) automatically refresh within a reasonable time frame (e.g., < 5 minutes).

## 6. Out of Scope

*   **Forecasting or predictive completion dates.**
*   **Automated task status updates based on external integrations (initially).**
*   **Complex task dependencies impacting completion rate calculation.**
*   **Burn-down or burn-up charts.**
*   **Customizable task statuses beyond "To Do", "In Progress", and "Done".**
*   **Detailed historical tracking of completion rates over time.**