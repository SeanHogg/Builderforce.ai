> **PRD** — drafted by Ada (Sr. Product Mgr) · task #649
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
Tasks that are marked as `in_review` or `done` may still lack any meaningful code changes, leading to inefficiencies in the review process and validator sweeps. This can result in:
- Wasted time and resources on reviews for tasks that have no substantial code changes.
- Delays in identifying and addressing tasks that are stuck or incomplete.
- Inaccurate tracking of task progress and status.

### Goal
Implement a staleness flag that identifies tasks in the `in_review` or `done` state that have not produced any non-documentation code changes. This flag will:
- Improve the efficiency of the review process by highlighting tasks that may not require further review.
- Aid in the validator sweep by providing a clear indicator of tasks that need attention.
- Enhance overall task tracking and management.

## Target Users / ICP Roles
- **Developers**: To understand which tasks require their attention for code changes.
- **Reviewers**: To prioritize tasks that have meaningful code changes.
- **Project Managers**: To monitor task progress and identify potential bottlenecks.
- **Validators**: To streamline the validation process by focusing on tasks with actual code changes.

## Scope

### In-Scope
- Detection of tasks in `in_review` or `done` state.
- Identification of tasks with no non-documentation code changes.
- Implementation of a staleness flag that can be queried and used by downstream processes.
- Integration with the existing task management system.
- Support for the #615 gate and validator sweep processes.

### Out-of-Scope
- Modification of the existing task state definitions.
- Changes to the code review process or tools.
- Implementation of additional flags or indicators beyond the staleness flag.
- Handling of tasks in states other than `in_review` or `done`.
- Automated actions based on the staleness flag (e.g., automatic task reassignment).

## Functional Requirements

1. **Staleness Flag Implementation**
   - The system shall implement a staleness flag that can be set for tasks in the `in_review` or `done` state.
   - The flag shall be set when no non-documentation code changes have been detected for a task.

2. **Detection of Code Changes**
   - The system shall detect and differentiate between documentation and non-documentation code changes.
   - Only tasks with no non-documentation code changes shall be flagged as stale.

3. **Flag Visibility**
   - The staleness flag shall be visible in the task management interface.
   - The flag shall be queryable via the task management API for integration with downstream processes.

4. **Integration with #615 Gate**
   - The staleness flag shall feed into the #615 gate process, providing an additional criterion for gate evaluation.

5. **Validator Sweep Support**
   - The validator sweep process shall utilize the staleness flag to prioritize tasks for validation.

## Acceptance Criteria

1. **Flag Accuracy**
   - The staleness flag is accurately set for tasks with no non-documentation code changes.
   - No false positives or negatives in flagging tasks.

2. **Integration**
   - The flag is successfully integrated with the #615 gate and validator sweep processes.
   - Downstream agents can query and utilize the flag without issues.

3. **User Interface**
   - The staleness flag is clearly visible in the task management interface.
   - Users can easily identify tasks that are flagged as stale.

4. **Performance**
   - The implementation does not introduce significant performance overhead to the task management system.
   - Flagging and detection processes are efficient and scalable.

## Out of Scope

- Modification of task state definitions or workflows.
- Changes to the code review process or tools.
- Implementation of additional flags or indicators.
- Automated actions based on the staleness flag.
- Handling of tasks in states other than `in_review` or `done`.

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