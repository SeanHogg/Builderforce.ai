> **PRD** — drafted by Ada (Sr. Product Mgr) · task #645
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD)

## Problem & Goal

### Problem
When a task has no subtasks (i.e., `total = 0`), the current implementation incorrectly sets the `progressPct` to 100%. This can mislead users into believing that the task is complete when, in fact, there is no progress information available.

### Goal
Ensure that when a task has no subtasks (`total = 0`), the `progressPct` does not default to 100%. Instead, it should either:
- Report `null` or an "unknown" state.
- Derive progress from other relevant signals (e.g., delivery status, task completion flags).

## Target Users / ICP Roles
- **Project Managers**: Need accurate progress tracking for tasks and subtasks.
- **Team Members**: Rely on progress indicators to understand task status and prioritize work.
- **Stakeholders**: Require reliable progress data for reporting and decision-making.

## Scope

### In-Scope
- **Behavior Change**: Modify the logic that calculates `progressPct` when `total = 0`.
- **User Interface**: Update UI components that display progress to handle `null` or "unknown" states gracefully.
- **Documentation**: Update relevant documentation and API references to reflect the new behavior.
- **Testing**: Implement unit and integration tests to verify the correct behavior when `total = 0`.

### Out-of-Scope
- **Changes to Other Metrics**: This change does not affect other progress-related metrics or calculations.
- **Historical Data**: The change will not retroactively alter existing data; it will only apply to new and updated tasks.
- **Advanced Progress Signals**: Incorporating additional progress signals beyond `total` and `completed` subtasks is not part of this scope.

## Functional Requirements

1. **Progress Calculation Logic**
   - When `total = 0`, do not default `progressPct` to 100%.
   - If `total = 0` and there are no relevant progress signals, set `progressPct` to `null`.
   - If `total = 0` but other progress signals (e.g., delivery status) are available, derive `progressPct` from these signals.

2. **User Interface Updates**
   - Display "Unknown" or a similar indicator when `progressPct` is `null`.
   - Ensure that UI components do not show misleading progress bars or indicators when `progressPct` is `null`.

3. **API Changes**
   - Update the API response to reflect the new `progressPct` logic.
   - Include documentation and examples for handling `null` values in client applications.

4. **Error Handling**
   - Implement error handling to manage unexpected states where `total = 0` but other progress signals are inconsistent.

## Acceptance Criteria

1. **Correct Calculation**
   - When `total = 0` and no other progress signals are present, `progressPct` is set to `null`.
   - When `total = 0` and other progress signals are present, `progressPct` is derived correctly.

2. **User Interface**
   - UI components display "Unknown" or equivalent when `progressPct` is `null`.
   - No misleading progress indicators are shown when `total = 0`.

3. **API Compliance**
   - API responses adhere to the new `progressPct` logic.
   - API documentation is updated to reflect the changes.

4. **Testing**
   - All tests pass, including unit and integration tests for the new logic.
   - No regression issues are introduced by the changes.

5. **Documentation**
   - All relevant documentation is updated to reflect the new behavior.
   - Clear guidelines are provided for developers and users on handling `null` progress percentages.

## Out of Scope

- **Retroactive Data Updates**: The change will not alter existing data in the database.
- **Advanced Progress Derivation**: Incorporating additional progress signals beyond the current scope is not included.
- **Customization Options**: Providing configuration options for how `progressPct` is derived when `total = 0` is not part of this release.

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