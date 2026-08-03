> **PRD** — drafted by Ada (Sr. Product Mgr) · task #733
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD) - Health Score Calculation

## Problem & Goal
### Problem
Teams need a simple, quantifiable metric to assess the overall health and progress of their projects based on the status of tasks.

### Goal
Develop a "Health Score" that provides a numerical value representing the current state of project tasks, enabling teams to quickly gauge progress and identify potential bottlenecks.

## Target Users / ICP Roles
- **Project Managers**: To monitor project health and make informed decisions.
- **Team Leads**: To track the progress of their team's tasks.
- **Executives**: To get a high-level overview of multiple projects' health.

## Scope
- **In Scope**:
  - Calculation of the health score based on task statuses.
  - Display of the health score in the project dashboard.
  - API endpoint for accessing the health score programmatically.
  
- **Out of Scope**:
  - Visualization of historical health scores.
  - Integration with third-party project management tools.
  - Customization of weightings for task statuses.

## Functional Requirements

### 1. Health Score Calculation
- **Description**: Compute the health score using the formula:
  \[
  \text{Health Score} = \left( \frac{\text{shipped} \times 1.0 + \text{in\_progress} \times 0.5 + \text{planned} \times 0.1}{\text{total}} \right) \times 100
  \]
- **Inputs**:
  - Number of tasks in "shipped" status.
  - Number of tasks in "in_progress" status.
  - Number of tasks in "planned" status.
  - Total number of tasks.
- **Output**: A numerical health score between 0 and 100.

### 2. Data Aggregation
- **Description**: Aggregate task data from the project management system to provide accurate inputs for the health score calculation.
- **Requirements**:
  - Real-time data aggregation.
  - Handling of tasks with statuses other than "shipped", "in_progress", and "planned" by excluding them from the total count.

### 3. User Interface (UI) Integration
- **Description**: Display the health score prominently in the project dashboard.
- **Requirements**:
  - Visual representation of the health score (e.g., using a gauge or color-coded indicator).
  - Tooltip or hover text explaining how the health score is calculated.

### 4. API Endpoint
- **Description**: Provide an API endpoint for accessing the health score programmatically.
- **Requirements**:
  - Endpoint accessible via RESTful API.
  - Response in JSON format containing the health score and timestamp of calculation.
  - Authentication and authorization to ensure only authorized users can access the data.

## Acceptance Criteria

### 1. Health Score Calculation
- The health score must be calculated accurately using the specified formula.
- The calculation must update in real-time as task statuses change.

### 2. Data Aggregation
- Task data must be aggregated correctly from the project management system.
- Tasks with statuses other than "shipped", "in_progress", and "planned" must be excluded from the total count.

### 3. UI Integration
- The health score must be displayed clearly in the project dashboard.
- The visual representation must reflect the health score value (e.g., green for high scores, red for low scores).

### 4. API Endpoint
- The API endpoint must return the correct health score and timestamp.
- The endpoint must be secured and accessible only to authorized users.

## Out of Scope
- Customization of the health score formula or weightings.
- Integration with external systems for additional data sources.
- Historical tracking and trend analysis of health scores.
- Automated alerts based on health score thresholds.

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