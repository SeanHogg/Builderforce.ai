> **PRD** — drafted by Kevin BA/PM/PO (Durable) · task #201
> _Each agent that updates this PRD signs its change below._

## Product Requirements Document: Blocked & Overdue Task Identification

### 1. Problem & Goal

**Problem:** Manual identification of blocked and overdue tasks is time-consuming, prone to human error, and delays critical interventions. Current reporting indicates zero blocked/overdue tasks, but this needs automated verification against live data.

**Goal:** To automate the identification and reporting of blocked and overdue tasks within the project management system, ensuring timely visibility and enabling proactive resolution.

### 2. Target Users / ICP Roles

*   **Project Managers:** To monitor project health, reallocate resources, and prioritize interventions.
*   **Team Leads:** To identify team bottlenecks and support task completion.
*   **Individual Contributors:** To gain awareness of tasks they are blocking or that are overdue for them.

### 3. Scope

This feature will focus on the automatic identification and presentation of:
*   Tasks whose `due_date` has passed without completion (`status` != "Done", "Completed").
*   Tasks that are explicitly marked as `blocked` or have unmet `dependencies`.

### 4. Functional Requirements

*   **FR1:** The system shall access and process task data including `status`, `due_date`, `assigned_to`, and `dependencies` / `blocked_by` flags.
*   **FR2:** The system shall identify tasks where `due_date < current_date` AND `status` is not "Done" or "Completed".
*   **FR3:** The system shall identify tasks where `status` is "Blocked" OR `dependencies` are incomplete AND `status` is not "Done" or "Completed".
*   **FR4:** The system shall provide a clear, exportable list of all identified overdue tasks.
*   **FR5:** The system shall provide a clear, exportable list of all identified blocked tasks, including details on what is blocking them.
*   **FR6:** The system shall run this identification process daily (or on-demand).

### 5. Acceptance Criteria

*   **AC1:** Given a task with `due_date = YYYY-MM-DD` and `status = "In Progress"` on `YYYY-MM-DD+1`, the task shall be correctly identified and listed as overdue.
*   **AC2:** Given a task with `status = "Blocked"` and `dependent_task_id = [Task X]`, the task shall be correctly identified and listed as blocked, showing `Task X` as the blocker.
*   **AC3:** Given a task with `status = "In Progress"` and `dependencies = [Task Y]` where `Task Y` is not "Completed", the task shall be correctly identified and listed as blocked, showing `Task Y` as the blocker.
*   **AC4:** The generated lists of overdue and blocked tasks accurately reflect the criteria defined in FR2 and FR3 for a given dataset, with no false positives or negatives.
*   **AC5:** The system can process a dataset of 1000 tasks and generate the lists within 5 seconds.

### 6. Out of Scope

*   Automated task prioritization or rescheduling based on blocked/overdue status.
*   Proactive prediction of future blocked tasks.
*   Notification mechanisms (e.g., email alerts, Slack integration) – this will be a separate PRD item.
*   Modification or management of task dependencies within the system.
*   Deep analytics or trend reporting on blocked/overdue tasks.