> **PRD** — drafted by Ada (Sr. Product Mgr) · task #628
> _Each agent that updates this PRD signs its change below._

# Progress% for Coding Task: Implementation + Tests

## Problem & Goal

### Problem
Current progress tracking for coding tasks often relies solely on the existence of a Pull Request (PR), which does not accurately reflect the true completion status of the task. This can lead to misleading indicators of progress, causing inefficiencies in project management and potential delays in delivery.

### Goal
Develop a system to accurately calculate the progress percentage of a coding task by considering both the implementation and the presence and passing of tests. This will provide a more realistic and reliable measure of task completion.

## Target Users / ICP Roles

- **Software Engineers**: To get a clear understanding of their task progress.
- **Project Managers**: To accurately track and report on project status.
- **QA Engineers**: To ensure that testing is accounted for in progress tracking.
- **DevOps Engineers**: To integrate progress tracking into CI/CD pipelines.

## Scope

- **Signal Definition**: Define what constitutes progress based on files changed under source directories and the presence and passing of tests.
- **Progress Calculation**: Implement a mechanism to calculate progress percentage based on the defined signals.
- **Integration**: Integrate the progress calculation into existing project management and CI/CD tools.
- **Reporting**: Provide clear and concise reports on task progress.

## Functional Requirements

1. **Signal Definition**
   - **Files Changed**: Monitor and analyze changes in source code directories.
     - Track additions, modifications, and deletions of files.
     - Categorize changes based on file types and directories.
   - **Tests Presence and Passing**
     - Detect the presence of test files in the codebase.
     - Run tests and verify their status (passing or failing).
     - Identify the coverage of tests in relation to the implementation.

2. **Progress Calculation**
   - **Weighting**: Assign weights to implementation and tests based on project requirements.
     - Example: 70% for implementation, 30% for tests.
   - **Algorithm**: Develop an algorithm to calculate progress percentage.
     - Consider the number of files changed, complexity of changes, and test coverage.
   - **Real-time Update**: Ensure the progress percentage updates in real-time as changes are made and tests are run.

3. **Integration**
   - **APIs**: Provide APIs for integration with project management tools (e.g., Jira, Trello).
   - **CI/CD Pipeline**: Integrate with CI/CD tools (e.g., Jenkins, GitHub Actions) to trigger progress updates.
   - **Dashboard**: Create a dashboard for visualizing progress across multiple tasks and projects.

4. **Reporting**
   - **Detailed Reports**: Generate detailed reports on progress, including breakdowns of implementation and testing.
   - **Notifications**: Send notifications to relevant stakeholders when progress thresholds are met or if issues arise.
   - **Export Options**: Allow exporting of reports in various formats (e.g., PDF, CSV).

## Acceptance Criteria

- **Signal Accuracy**: The system accurately identifies and categorizes changes in source directories and tests.
- **Progress Calculation**: The progress percentage calculation is consistent and reflects the actual state of the task.
- **Integration Success**: The system integrates seamlessly with existing tools and pipelines without causing disruptions.
- **Reporting Clarity**: Reports are clear, comprehensive, and provide actionable insights.
- **Performance**: The system performs efficiently, with minimal latency in progress updates and reporting.

## Out of Scope

- **Historical Data Analysis**: Tracking and analyzing progress over time is not part of this implementation.
- **User Access Control**: Managing user permissions and access to progress data is not included.
- **Advanced Analytics**: Implementing machine learning or advanced analytics for predictive progress tracking is out of scope.
- **Customization of Weights**: Allowing users to customize the weighting of implementation and tests is not covered in this iteration.
- **Third-party Tool Integration**: Integration with third-party project management tools beyond basic API support is not included.

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