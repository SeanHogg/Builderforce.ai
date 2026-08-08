> **PRD** — drafted by Ada (Sr. Product Mgr) · task #719
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD) - Health Score Calculation

## Problem & Goal
### Problem
Teams need a simple, standardized way to assess the overall health of their projects based on the status of tasks. Currently, there is no unified method to quickly evaluate project progress, making it difficult to identify potential bottlenecks or areas needing attention.

### Goal
Develop a "Health Score" that provides a numerical value representing the overall status of a project based on the distribution of tasks across different stages (shipped, in_progress, planned). This score will help teams quickly gauge project health and make informed decisions.

## Target Users / ICP Roles
- **Project Managers**: To monitor project progress and identify areas needing attention.
- **Team Leads**: To assess the status of their team's projects and communicate progress to stakeholders.
- **Executives**: To get a high-level view of multiple projects' health across the organization.

## Scope
- **In-Scope**:
  - Calculation of health score based on the formula: `(shipped * 1.0 + in_progress * 0.5 + planned * 0.1) / total * 100`
  - Integration with existing project management tools to fetch task status data.
  - Display of health score in a dashboard or report format.
  - Historical tracking of health scores to monitor trends over time.

- **Out-of-Scope**:
  - Customization of the health score formula.
  - Integration with external tools not currently supported by the platform.
  - Advanced analytics or predictive modeling based on health scores.
  - Real-time updates of health scores (batch processing is acceptable).

## Functional Requirements
1. **Data Integration**:
   - Fetch task status data (shipped, in_progress, planned) from the project management tool.
   - Ensure data is up-to-date with a maximum latency of 24 hours.

2. **Health Score Calculation**:
   - Implement the formula: `(shipped * 1.0 + in_progress * 0.5 + planned * 0.1) / total * 100`
   - Handle edge cases where total tasks might be zero to avoid division by zero errors.

3. **User Interface**:
   - Display the health score prominently on the project dashboard.
   - Provide a visual indicator (e.g., color-coded gauge) to represent the health score (e.g., green for high, yellow for moderate, red for low).
   - Allow users to view historical health scores through a trend chart.

4. **Reporting**:
   - Generate reports that include the health score and its breakdown (shipped, in_progress, planned).
   - Enable export of reports in common formats (e.g., PDF, CSV).

5. **Notifications**:
   - Optionally, send notifications to users when the health score falls below a certain threshold.

## Acceptance Criteria
- The health score is accurately calculated based on the provided formula.
- The user interface displays the health score and its visual representation correctly.
- Historical data is stored and accessible for at least the past 12 months.
- Reports can be generated and exported without errors.
- The system handles edge cases gracefully (e.g., zero total tasks).
- Integration with the project management tool does not impact its performance.

## Out of Scope
- Customization of the health score formula.
- Real-time data integration and score updates.
- Integration with third-party tools not supported by the platform.
- Advanced analytics or machine learning models based on health scores.
- Mobile application support for viewing health scores.

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