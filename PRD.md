> **PRD** — drafted by Ada (Sr. Product Mgr) · task #730
> _Each agent that updates this PRD signs its change below._

# POST /api/projects/:id/capabilities — Create a Capability

## Problem & Goal

### Problem
Currently, there is no API endpoint to allow users to programmatically add new capabilities to a project. This limitation restricts automation and integration with other systems, leading to manual and error-prone processes.

### Goal
Create a new API endpoint `POST /api/projects/:id/capabilities` that allows users to create a new capability for a specific project. This will enable automation, improve integration capabilities, and reduce manual errors.

## Target Users / ICP Roles

- **Project Managers**: To automate the creation of project capabilities.
- **System Integrators**: To integrate with other systems and tools.
- **Developers**: To programmatically manage project capabilities.

## Scope

- **Endpoint Creation**: Implement `POST /api/projects/:id/capabilities` to create a new capability.
- **Validation**: Ensure the request data is valid before creating a capability.
- **Response**: Provide appropriate responses and status codes for different scenarios.
- **Authentication & Authorization**: Ensure that only authorized users can create capabilities for a project.

## Functional Requirements

1. **Endpoint Definition**
   - **URL**: `POST /api/projects/{projectId}/capabilities`
   - **Headers**:
     - `Authorization: Bearer {token}`
     - `Content-Type: application/json`
   - **Path Parameters**:
     - `projectId` (string): The unique identifier of the project.

2. **Request Body**
   - **Capability Object**:
     - `name` (string, required): The name of the capability.
     - `description` (string, optional): A brief description of the capability.
     - `status` (string, optional): The status of the capability (e.g., "active", "inactive"). Defaults to "active" if not provided.
     - `tags` (array of strings, optional): Tags associated with the capability.

3. **Validation**
   - `name` must be a non-empty string.
   - `status` must be one of the predefined allowed values (e.g., "active", "inactive").
   - `tags` must be an array of non-empty strings.

4. **Response**
   - **Success**:
     - Status Code: `201 Created`
     - Body:
       ```json
       {
         "id": "unique-capability-id",
         "projectId": "project-id",
         "name": "Capability Name",
         "description": "Capability Description",
         "status": "active",
         "tags": ["tag1", "tag2"],
         "createdAt": "timestamp",
         "updatedAt": "timestamp"
       }
       ```
   - **Error**:
     - Status Code: `400 Bad Request` for validation errors.
     - Status Code: `401 Unauthorized` if the user is not authenticated.
     - Status Code: `403 Forbidden` if the user does not have permission to create capabilities for the project.
     - Status Code: `404 Not Found` if the project does not exist.
     - Body:
       ```json
       {
         "error": "Error message"
       }
       ```

5. **Authentication & Authorization**
   - The user must be authenticated.
   - The user must have the necessary permissions to create capabilities for the specified project.

## Acceptance Criteria

- [ ] The endpoint `POST /api/projects/{projectId}/capabilities` is implemented and accessible.
- [ ] The endpoint accepts a valid capability object in the request body.
- [ ] The endpoint returns a `201 Created` status code with the capability object when creation is successful.
- [ ] The endpoint validates the request body and returns appropriate error messages and status codes for invalid data.
- [ ] The endpoint returns `401 Unauthorized` when the user is not authenticated.
- [ ] The endpoint returns `403 Forbidden` when the user does not have permission to create capabilities.
- [ ] The endpoint returns `404 Not Found` when the specified project does not exist.
- [ ] The capability is stored in the database with the correct data and associations.
- [ ] The capability creation is audited and logged appropriately.

## Out of Scope

- **Capability Updates**: This endpoint is only for creation. Updating capabilities will be handled by a separate endpoint.
- **Capability Deletion**: Deleting capabilities is out of scope for this task.
- **Bulk Creation**: This endpoint does not support bulk creation of capabilities.
- **Complex Validation Rules**: Advanced validation rules beyond basic data validation are not included.
- **Integration with External Systems**: While the endpoint enables integration, actual integration with specific external systems is not part of this task.

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