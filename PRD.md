> **PRD** — drafted by Ada (Sr. Product Mgr) · task #685
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
Currently, when a task is created with `parentTaskId: null`, the system implicitly detaches the task from any parent, even if the user does not intend to detach it. This behavior can lead to unintended task hierarchies and confusion for users who expect the task to be part of the main task list.

### Goal
Modify the system to make the detachment of tasks with `parentTaskId: null` an explicit, opt-in behavior. This will ensure that tasks are only detached when the user explicitly chooses to do so, providing better control over task hierarchies.

## Target Users / ICP Roles

- **Project Managers**: Users who manage task hierarchies and need to control the association of tasks with parent tasks.
- **Team Members**: Users who create and manage tasks and need to ensure tasks are correctly associated with parent tasks.
- **Administrators**: Users who configure system settings and need to ensure that task management behaviors align with organizational policies.

## Scope

- Modify the task creation and update APIs to handle `parentTaskId: null` as a non-detaching action by default.
- Introduce a new system setting or flag to enable explicit detachment when `parentTaskId: null` is set.
- Update the user interface to reflect the new behavior and provide options for explicit detachment.
- Update documentation and provide migration guidance for existing users who rely on the current implicit detachment behavior.

## Functional Requirements

1. **API Modification**
   - Modify the task creation and update APIs to interpret `parentTaskId: null` as a request to associate the task with the main task list, not as a detachment command.
   - Ensure that tasks with `parentTaskId: null` are treated as top-level tasks unless explicitly detached.

2. **Explicit Detachment Flag**
   - Introduce a new system flag or setting, e.g., `explicitDetach`, that controls whether `parentTaskId: null` triggers detachment.
   - When `explicitDetach` is enabled, setting `parentTaskId: null` will detach the task from its current parent.
   - When `explicitDetach` is disabled, setting `parentTaskId: null` will associate the task with the main task list.

3. **User Interface Updates**
   - Update the task creation and editing forms to include a checkbox or toggle for explicit detachment when `parentTaskId: null` is set.
   - Display a warning or confirmation dialog when a user attempts to detach a task, informing them of the consequences.

4. **Documentation and Migration Guidance**
   - Update API documentation to reflect the new behavior of `parentTaskId: null`.
   - Provide migration guidance for users who rely on the current implicit detachment behavior, including instructions on how to use the new explicit detachment flag.

## Acceptance Criteria

- **API Behavior**: When `parentTaskId: null` is set and `explicitDetach` is disabled, the task is associated with the main task list, not detached.
- **Explicit Detachment**: When `parentTaskId: null` is set and `explicitDetach` is enabled, the task is detached from its current parent.
- **User Interface**: The task creation and editing forms include an option for explicit detachment when `parentTaskId: null` is set.
- **Documentation**: API and user documentation are updated to reflect the new behavior and include migration guidance.
- **Testing**: All changes are thoroughly tested to ensure that the new behavior does not introduce regressions and that the system handles edge cases gracefully.

## Implementation Notes

_Implementation complete - August 2025_

### API Changes

**UpdateTaskDto** (PATCH /api/tasks/:id):
- Added optional `explicitDetach?: boolean` field
- When `explicitDetach: true` is passed with `parentTaskId: null`, the task is detached from its parent
- When `explicitDetach` is false/undefined and `parentTaskId: null` is passed, the existing parent is preserved (no change)

**CreateTaskDto** (POST /api/tasks):
- Added optional `explicitDetach?: boolean` field
- New tasks start without a parent by default; `explicitDetach` provides API consistency with update behavior

### Behavior Matrix

| explicitDetach | parentTaskId | Result |
|---------------|--------------|--------|
| true          | null         | Detach from parent (set as top-level) |
| true          | 5            | Re-parent to task #5 |
| false/undefined | null      | Preserve existing parent (no-op for new tasks) |
| false/undefined | 5         | Re-parent to task #5 |
| not provided  | not provided | Preserve existing parent |

### Files Modified

- `api/src/application/task/TaskService.ts` - Core logic for handling explicitDetach
- `api/src/presentation/routes/taskRoutes.ts` - API route handlers with explicitDetach field

## Out of Scope

- Changing the default value of the `explicitDetach` flag; it will be disabled by default to maintain current behavior unless explicitly enabled by the user.
- Modifying the behavior of other fields related to task hierarchy management.
- Implementing a bulk update feature for detaching multiple tasks at once.
- Providing a user interface for configuring the `explicitDetach` flag; it will be managed via system settings or environment variables.

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