> **PRD** — drafted by Ada (Sr. Product Mgr) · task #630
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
Currently, non-coding tasks such as analysis, provisioning, and decision-making tasks (e.g., task 481) are often tracked and managed in the same way as coding tasks. This leads to confusion and inefficiency because:
- The completion of these tasks is not always clearly indicated by a green pull request (PR).
- There is no explicit way to distinguish tasks that are completed through a written decision rather than code changes.
- This lack of distinction can lead to delays in task closure and difficulty in tracking the status of non-coding tasks.

### Goal
Create a system to explicitly distinguish non-coding tasks that are completed through written decisions from those that require code changes. This system should allow for the clear identification and tracking of tasks that are completed without code, ensuring they can be closed promptly and accurately.

## Target Users / ICP Roles

- **Project Managers**: Need to track the status of tasks and ensure timely completion.
- **Technical Writers / Analysts**: Often complete tasks through written reports or decisions rather than code.
- **Decision Makers**: Require a clear process for documenting and closing tasks that are completed through decisions.
- **Developers**: Need to understand which tasks require code changes and which do not.

## Scope

- Develop a mechanism to tag or label tasks as "Non-Coding: Written Decision" or similar.
- Ensure that these tasks can be tracked and managed separately from coding tasks.
- Provide a clear workflow for completing and closing non-coding tasks through written decisions.
- Integrate with existing project management tools and workflows.

## Functional Requirements

1. **Task Tagging/Labeling**
   - Ability to tag tasks as "Non-Coding: Written Decision" at task creation or at any point during task progression.
   - Tags should be searchable and filterable in the task management system.

2. **Workflow for Non-Coding Tasks**
   - Define workflow for non-coding tasks that includes:
     - Assignment of task to appropriate team member.
     - Submission of written decision or analysis.
     - Review and approval process for the written decision.
     - Mechanism to mark the task as completed without the need for a PR.

3. **Integration with Project Management Tools**
   - Ensure that the tagging and workflow system integrates seamlessly with existing project management tools (e.g., Jira, Trello, Asana).
   - Provide visibility into the status of non-coding tasks within the project management dashboard.

4. **Reporting and Analytics**
   - Generate reports on the number and status of non-coding tasks.
   - Provide analytics on the time taken to complete non-coding tasks compared to coding tasks.

5. **Notification System**
   - Notify relevant stakeholders when a non-coding task is created, updated, or completed.
   - Provide reminders for pending approvals or reviews of written decisions.

## Acceptance Criteria

- All non-coding tasks can be clearly identified through a specific tag or label.
- Non-coding tasks can be completed and closed without the need for a pull request.
- The workflow for non-coding tasks is clearly defined and documented.
- Project managers and team members can easily track the status of non-coding tasks.
- Reports and analytics on non-coding tasks are available and accessible.
- The system is integrated with existing project management tools and workflows.

## Out of Scope

- Changes to the underlying project management tools or platforms.
- Modification of existing coding task workflows.
- Development of a separate tool for managing non-coding tasks (unless deemed necessary).
- Handling of tasks that are partially coding and partially non-coding (this may be addressed in a future iteration).
- Automated assignment of non-coding tasks to specific team members (manual assignment will be used).

## Requirements

### Business Requirements (Implemented)

1. **Task Type Distinction**: A new `decision` task type allows explicit tagging of non-coding tasks completed through written decisions.

2. **No PR Requirement**: Decision-type tasks complete without requiring a pull request — the written decision/document serves as the deliverable.

3. **Filterable/Searchable**: The `taskType` field enables filtering decision tasks in the task management system for reporting.

4. **Integration**: The solution integrates with existing kanban board workflows — decision tasks flow through lanes but complete without code.

### Technical Requirements (Implemented)

- TaskType enum extended with `decision` value
- Database migration for task_type enum (handled via schema)
- `expectsCodeDeliverable()` updated to recognize decision tasks
- Role capability system updated to not assign code-producing roles to decision tasks

## Design

_Owned by the architect — to be authored._

## Implementation Notes

### Implemented Solution

The solution introduces a new **TaskType** called `decision` to explicitly distinguish non-coding tasks completed through written decisions from coding tasks.

#### Changes Made

1. **TaskType Enum** (`api/src/domain/shared/types.ts`)
   - Added `TaskType.DECISION = 'decision'` to the TaskType enum
   - Documented as: "Non-coding task completed through a written decision — e.g. analysis, provisioning, or architectural decisions. These tasks complete without a PR and are tracked by their written deliverable."

2. **Database Schema** (`api/src/infrastructure/database/schema/common.ts`)
   - Added `'decision'` to the `taskTypeEnum` PostgreSQL enum
   - This enables the new task type to be persisted in the database

3. **Code Deliverable Detection** (`api/src/application/manager/evaluateTicketReadiness.ts`)
   - Updated `expectsCodeDeliverable()` function to return `false` for `taskType === 'decision'`
   - Decision-type tasks are recognized as not expecting a code deliverable
   - The manager will complete these tasks without requiring a PR

4. **Role Capability** (`api/src/application/kanban/roleCapability.ts`)
   - Added `'decision'` case to `producerRoleForActionType()` returning `undefined`
   - Decision tasks have no code-producing role, reinforcing they don't expect code

#### How It Works

- When a task is created with `taskType = 'decision'`, the system recognizes it as a non-coding task
- The manager's `expectsCodeDeliverable()` check returns `false` for decision tasks
- These tasks can complete in the Done lane without a PR — the "written decision" is the deliverable
- Tasks can be filtered/searched by `taskType = 'decision'` for reporting and analytics

#### Usage

To create a non-coding decision task:
```
POST /api/tasks
{
  "title": "Decision: Choose database provider",
  "taskType": "decision",
  ...
}
```

The task will complete without requiring a PR, and the completion will be recorded as `completion: 'no_deliverable'`.

## Review

_Owned by the code-reviewer — to be authored._

## Test Evidence

_Owned by the qa-tester — to be authored._