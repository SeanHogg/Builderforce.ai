> **PRD** — drafted by Ada (Sr. Product Mgr) · task #718
> _Each agent that updates this PRD signs its change below._

# GET /api/projects/:id/capabilities/rollup - Aggregated Rollup API

## Problem & Goal

### Problem
Project managers and stakeholders need a quick and efficient way to understand the overall health and status of project capabilities. Currently, they have to manually aggregate data from multiple endpoints or perform complex queries, which is time-consuming and error-prone.

### Goal
Provide an API endpoint that returns aggregated rollup data, including counts by status and category, as well as a health score for a given project. This will enable users to quickly assess the current state of project capabilities and make informed decisions.

## Target Users / ICP Roles

- **Project Managers**: Need to monitor and report on project health and status.
- **Product Owners**: Require insights into the distribution of capabilities across different statuses and categories.
- **Stakeholders**: Need a high-level overview of project progress and health.

## Scope

- **Endpoint**: `GET /api/projects/:id/capabilities/rollup`
- **Aggregated Data**:
  - Counts of capabilities by status (e.g., Not Started, In Progress, Completed)
  - Counts of capabilities by category (e.g., Feature, Bug, Enhancement)
  - Health score for the project based on the status of its capabilities
- **Response Format**: JSON
- **Authentication**: Required
- **Authorization**: Users must have read access to the specified project

## Functional Requirements

1. **Input Validation**
   - Validate that the `:id` parameter is a valid UUID.
   - Ensure the user has permission to access the project with the given ID.

2. **Data Aggregation**
   - Retrieve all capabilities associated with the specified project.
   - Aggregate counts of capabilities by status and category.
   - Calculate the health score based on the status of the capabilities. The health score should be a numerical value between 0 and 100, where a higher score indicates a healthier project.

3. **Response Structure**
   - The API should return a JSON object with the following structure:
     ```json
     {
       "projectId": "uuid",
       "countsByStatus": {
         "Not Started": 10,
         "In Progress": 5,
         "Completed": 20
       },
       "countsByCategory": {
         "Feature": 15,
         "Bug": 10,
         "Enhancement": 10
       },
       "healthScore": 75
     }
     ```

4. **Error Handling**
   - If the project does not exist, return a 404 error with a meaningful message.
   - If the user does not have permission to access the project, return a 403 error.
   - If the `:id` parameter is invalid, return a 400 error.

5. **Performance**
   - The API should respond within 500ms for projects with up to 10,000 capabilities.

## Acceptance Criteria

- The API endpoint `GET /api/projects/:id/capabilities/rollup` is implemented and accessible via HTTPS.
- The endpoint returns the correct aggregated counts by status and category for the specified project.
- The health score is accurately calculated based on the status of the capabilities.
- The response is returned in the specified JSON format.
- The API handles invalid inputs and unauthorized access gracefully, returning appropriate error messages and status codes.
- The API meets the performance requirement of responding within 500ms for projects with up to 10,000 capabilities.

## Out of Scope

- **Historical Data**: The API does not provide historical rollup data. It only reflects the current state of project capabilities.
- **Filtering and Sorting**: The API does not support filtering or sorting of the aggregated data.
- **Custom Health Score Calculation**: The health score calculation is predefined and cannot be customized via the API.
- **Pagination**: The API does not support pagination for the aggregated data.
- **Bulk Operations**: The API is designed for single-project rollup and does not support aggregating data for multiple projects in a single request.

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