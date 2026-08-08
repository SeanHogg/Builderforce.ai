> **PRD** — drafted by Ada (Sr. Product Mgr) · task #631
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
Currently, the validation process for tasks being marked as "done" is ad hoc, with validators manually checking if the associated branch contains non-documentation code. This manual process is error-prone and time-consuming, leading to potential gaps in the validation process where tasks are incorrectly marked as complete without the necessary code changes.

### Goal
Systematize the validation process by implementing an automated check that flags any "done" task whose associated branch has no non-documentation code. This will ensure that all tasks marked as "done" have the required code changes, thereby improving the reliability and efficiency of the validation process.

## Target Users / ICP Roles

- **Validators**: Individuals responsible for verifying the completion and correctness of tasks.
- **Project Managers**: Individuals who oversee the project and need to ensure that tasks are completed according to requirements.
- **Developers**: Individuals who work on tasks and need to ensure that their code changes are properly documented and reflected in the branches.

## Scope

- **Automated Check**: Implement a systematic check that automatically verifies the presence of non-documentation code in the branch associated with a "done" task.
- **Flagging Mechanism**: Create a flagging mechanism that alerts validators and project managers when a "done" task has no non-documentation code in its branch.
- **Integration with Task Management**: Integrate the check into the existing task management workflow to ensure that task completion is gated by this validation.

## Functional Requirements

1. **Automated Validation Script**:
   - Develop a script that scans the branch associated with a task when it is marked as "done".
   - The script should identify and differentiate between documentation and non-documentation code files.

2. **Flagging Mechanism**:
   - If the script detects that the branch contains no non-documentation code, it should automatically flag the task.
   - The flag should be visible in the task management system and notify relevant stakeholders (validators and project managers).

3. **Integration with Task Status**:
   - Modify the task status workflow to include the validation check as a gate before a task can be fully marked as "done".
   - If the validation check fails, the task status should revert to "needs review" or a similar state.

4. **Notification System**:
   - Implement notifications to alert validators and project managers when a task is flagged for lacking non-documentation code.
   - Notifications should include details about the task and the branch in question.

5. **Reporting Dashboard**:
   - Provide a dashboard or report that displays all tasks flagged for lacking non-documentation code.
   - The dashboard should allow stakeholders to filter and sort tasks based on various criteria (e.g., date, team, project).

## Acceptance Criteria

- The automated validation script correctly identifies branches with and without non-documentation code.
- Tasks marked as "done" are automatically checked by the script before being fully completed.
- Any task lacking non-documentation code is flagged and reverted to a "needs review" state.
- Notifications are sent to relevant stakeholders when a task is flagged.
- The reporting dashboard accurately reflects all tasks that have been flagged.
- The system integrates seamlessly with the existing task management workflow without causing disruptions.

## Out of Scope

- **Manual Overrides**: The system will not allow manual overrides of the validation check. Any exceptions must be handled through a separate process.
- **Detailed Code Analysis**: The script will not perform detailed code analysis or quality checks; it will only verify the presence of non-documentation code.
- **Historical Data**: The system will not maintain a historical record of flagged tasks beyond the reporting dashboard.
- **Integration with External Systems**: Integration with external systems (e.g., version control systems, communication tools) is not included in this scope.
- **User Training**: The development of training materials or user guides for the new system is not covered.

## Requirements

_Owned by the business-analyst — to be authored._

## Design

_Owned by the architect — to be authored._

## Implementation Notes

_Owned by the developer — to be authored._

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._