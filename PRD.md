> **PRD** — drafted by Ada (Sr. Product Mgr) · task #732
> _Each agent that updates this PRD signs its change below._

# GET /api/projects/:id/capabilities/rollup - Aggregated Rollup API

## Problem & Goal

### Problem
Project managers and stakeholders need a quick and efficient way to understand the overall health and status of capabilities within a project. Currently, they have to manually aggregate data from multiple endpoints or perform complex queries, which is time-consuming and error-prone.

### Goal
Provide a single API endpoint that returns aggregated data on capabilities within a project, including counts by status and category, and a health score. This will enable users to quickly assess the state of a project and make informed decisions.

## Target Users / ICP Roles

- **Project Managers**: Need to monitor the health and status of projects.
- **Program Managers**: Oversee multiple projects and require aggregated data for reporting.
- **Stakeholders**: Require high-level insights into project progress and health.

## Scope

- **In Scope**:
  - Aggregation of capability data for a specific project.
  - Counts of capabilities by status (e.g., Not Started, In Progress, Completed).
  - Counts of capabilities by category (e.g., Development, Testing, Deployment).
  - Calculation of a health score based on predefined criteria.
  - Support for filtering and sorting parameters.

- **Out of Scope**:
  - Aggregation of data across multiple projects.
  - Real-time data updates (data will be based on the latest snapshot).
  - Customizable health score criteria.

## Functional Requirements

1. **Endpoint Definition**:
   - **Method**: GET
   - **URL**: `/api/projects/{id}/capabilities/rollup`
   - **Parameters**:
     - `id` (string): The unique identifier of the project.

2. **Response Structure**:
   - **Project ID**: Identifier of the project.
   - **Counts by Status**:
     - Not Started: Number of capabilities not yet started.
     - In Progress: Number of capabilities currently in progress.
     - Completed: Number of capabilities completed.
   - **Counts by Category**:
     - Development: Number of capabilities in the development category.
     - Testing: Number of capabilities in the testing category.
     - Deployment: Number of capabilities in the deployment category.
     - etc.
   - **Health Score**: A numerical score representing the overall health of the project (e.g., 0-100).
   - **Last Updated**: Timestamp of when the data was last updated.

3. **Filtering and Sorting**:
   - Allow filtering by status and category.
   - Allow sorting by counts and health score.

4. **Error Handling**:
   - Return appropriate HTTP status codes and error messages for:
     - Invalid project ID.
     - Unauthorized access.
     - Internal server errors.

## Acceptance Criteria

1. **Successful Request**:
   - When a valid project ID is provided, the API returns a 200 OK response with the aggregated data.
   - The data includes counts by status and category, and a health score.

2. **Invalid Project ID**:
   - When an invalid project ID is provided, the API returns a 404 Not Found response with an error message.

3. **Unauthorized Access**:
   - When a user without proper permissions accesses the endpoint, the API returns a 403 Forbidden response.

4. **Internal Server Error**:
   - When an unexpected error occurs, the API returns a 500 Internal Server Error response with a generic error message.

5. **Performance**:
   - The API responds within 500 milliseconds for requests with up to 1000 capabilities.

## Out of Scope

- **Authentication and Authorization**: While the API will enforce access controls, the specifics of authentication mechanisms are not covered in this document.
- **Pagination**: The API will return all relevant data in a single response. If the data set becomes too large, pagination will be handled in a future iteration.
- **Data Export**: The ability to export the aggregated data to formats like CSV or JSON is not included.
- **Historical Data**: The API provides the latest snapshot of data and does not support querying historical data.

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