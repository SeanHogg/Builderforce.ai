> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #338
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document: Overdue Items Report

## 1. Problem & Goal

### Problem
Users currently lack a consolidated, easily accessible view of all overdue tasks across projects. This makes it difficult for project managers and team leads to quickly identify bottlenecks, assess project health, and prioritize corrective actions, leading to missed deadlines and reduced accountability.

### Goal
To provide a dedicated report that lists all past-due tasks, clearly indicating how many days each task is overdue, and grouping these tasks by their parent epic. This will enable users to gain immediate visibility into overdue work and identify which epics are most affected.

## 2. Target Users / ICP Roles

*   **Project Managers**: To monitor project health, identify risks, and reallocate resources.
*   **Team Leads**: To track team performance, unblock tasks, and support team members.
*   **Product Owners**: To understand progress against product backlogs and epic commitments.
*   **Stakeholders/Management**: For high-level oversight of project delivery and potential delays.

## 3. Scope

This feature will deliver a new report view within the application that displays overdue tasks. The report will:
*   Identify all tasks with a due date in the past and a non-completed status.
*   Calculate and display the number of days each task is overdue.
*   Group these overdue tasks under their respective parent epics.
*   Provide a dedicated access point in the application's navigation.

## 4. Functional Requirements

*   **FR.1 Data Retrieval**: The system shall retrieve all tasks from the primary task management database.
*   **FR.2 Overdue Task Definition**: A task is considered "overdue" if its `due_date` is earlier than the current date and its `status` is not marked as `Completed`, `Done`, `Closed`, or equivalent final state.
*   **FR.3 Days Overdue Calculation**: For each overdue task, the system shall calculate `days_overdue` as `current_date - task.due_date`.
*   **FR.4 Task Detail Display**: For each overdue task, the report shall display:
    *   Task Title (clickable link to the task details page)
    *   Original Due Date
    *   Calculated Days Overdue
*   **FR.5 Grouping by Epic**: All overdue tasks shall be grouped under their associated parent Epic.
    *   **FR.5.1 Unassigned Tasks**: Tasks without an assigned parent Epic shall be grouped under a distinct category, e.g., "Tasks without Epic".
*   **FR.6 Epic Header Display**: Each epic group shall display the Epic Title/Name as a header.
*   **FR.7 Access Point**: A new menu item (e.g., "Overdue Report") shall be added to the main navigation for authorized users to access this report.
*   **FR.8 Permissions**: Access to the Overdue Items Report shall be restricted to users with `read` permissions for the projects/tasks contained within the report.

## 5. Acceptance Criteria

*   **AC.1**: The "Overdue Report" is accessible via its designated navigation link.
*   **AC.2**: The report loads successfully and displays a list of tasks.
*   **AC.3**: All tasks listed have a `due_date` in the past relative to the current date and are not in a final `Completed` state.
*   **AC.4**: The `Days Overdue` calculation for each task accurately reflects `current_date - task.due_date` (e.g., a task due yesterday shows "1 day overdue").
*   **AC.5**: All overdue tasks are correctly grouped under their respective parent epics.
*   **AC.6**: Tasks without an assigned epic are accurately grouped under the "Tasks without Epic" category.
*   **AC.7**: Clicking on a Task Title in the report navigates the user to the detailed view of that specific task.
*   **AC.8**: Only users with appropriate project/task read permissions can view the report. Unauthorized users are blocked or see an empty state/error message.

## 6. Out of Scope

*   Filtering or sorting capabilities beyond the default grouping by epic.
*   Editing or updating tasks directly from the Overdue Items Report.
*   Exporting the report data (e.g., CSV, PDF).
*   Real-time notifications or alerts for newly overdue tasks.
*   Customizing the columns displayed in the report.
*   Aggregated summaries (e.g., total overdue tasks per epic, average days overdue per epic).
*   Any form of graphical representation or visualization (charts, graphs).
*   Inclusion of sub-tasks; only parent tasks are considered for overdue status.