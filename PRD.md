> **PRD** — drafted by Ada (Sr. Product Mgr) · task #392
> _Each agent that updates this PRD signs its change below._

# Product Requirements Document (PRD): List All Project Chats

## Problem & Goal
**Problem**:
Users and system administrators need a way to view, manage, and analyze all chat sessions within a specific project. Currently, there is no centralized way to list all chats associated with a project, making it difficult to track conversations, audit interactions, or enforce compliance.

**Goal**:
Provide a robust, scalable, and secure API endpoint (`builtin_brain_list`) that returns a comprehensive list of all chat sessions for a given `projectId`. This endpoint will serve as a foundational building block for future features, such as chat search, analytics, and moderation tools.

---

## Target Users / ICP Roles
This feature is primarily intended for the following roles within the Ideal Customer Profile (ICP):
1. **System Administrators**: Need visibility into project activity for compliance, security audits, and resource allocation.
2. **Project Managers**: Require oversight of all team communications within their projects to ensure alignment and productivity.
3. **Support Teams**: Use chat history to troubleshoot issues and provide context for user requests.
4. **Developers**: Integrate chat listing into custom dashboards, analytics pipelines, or automation workflows.
5. **AI/ML Engineers**: Leverage chat data for training models, analyzing user behavior, or improving conversational AI.

---

## Scope

### In Scope
1. **API Endpoint**:
   - Implement `builtin_brain_list({ projectId: number })` to return a list of all chats for the specified `projectId`.
   - Ensure the endpoint is idempotent and supports pagination (if the number of chats grows beyond a reasonable limit in future iterations).
2. **Data Returned**:
   - Chat metadata, including:
     - `chatId`: Unique identifier for the chat session.
     - `title`: Human-readable title of the chat (if available; otherwise, auto-generated).
     - `createdAt`: Timestamp of when the chat was initiated.
     - `updatedAt`: Timestamp of the last message in the chat.
     - `participantCount`: Number of unique participants in the chat.
     - `messageCount`: Total number of messages in the chat.
     - `isArchived`: Boolean indicating if the chat is archived.
     - `lastMessagePreview`: A truncated preview of the last message (e.g., first 50 characters).
   - Optional fields (to be determined based on downstream needs):
     - `participants`: List of user IDs or roles involved in the chat.
     - `tags`: Any tags or labels associated with the chat (e.g., "urgent", "technical").
3. **Performance**:
   - The endpoint should respond within **< 300ms** for projects with up to 1,000 chats and **< 1s** for projects with up to 10,000 chats.
   - Optimize database queries to avoid full table scans.
4. **Security & Permissions**:
   - Enforce role-based access control (RBAC) to ensure only authorized users (e.g., project admins, system admins) can access the endpoint.
   - Validate `projectId` to prevent enumeration attacks.
5. **Error Handling**:
   - Return appropriate HTTP status codes and error messages for invalid `projectId`, unauthorized access, or server errors.
6. **Documentation**:
   - Update API documentation to include the new endpoint, request/response examples, and error codes.

### Out of Scope
1. **Pagination**: Initially, the endpoint will return all chats without pagination. Pagination will be added in a future iteration if the number of chats grows significantly.
2. **Real-Time Updates**: The endpoint will return static data. Real-time updates or subscriptions (e.g., WebSocket-based) are out of scope for this PRD.
3. **Chat Content**: The endpoint will not return the full content of messages within chats. This will be handled by a separate endpoint (e.g., `builtin_brain_messages({ chatId })`).
4. **Editing or Deleting Chats**: The endpoint will only list chats. Modifications (e.g., archiving, deleting, renaming) are out of scope.
5. **Offline Access**: No support for caching or offline access in this iteration.
6. **Advanced Filtering/Sorting**: Initially, the endpoint will return chats in descending order of `updatedAt`. Advanced filtering (e.g., by participant, date range, tags) will be added later.
7. **Export Functionality**: Exporting chat lists to CSV/JSON is out of scope for this iteration.

---

## Functional Requirements

| ID  | Requirement                                                                                     | Priority | Notes                                                                                     |
|-----|-------------------------------------------------------------------------------------------------|----------|-------------------------------------------------------------------------------------------|
| FR1 | The `builtin_brain_list` endpoint must accept a `projectId` as input and return a list of chats. | P0       | Must validate `projectId` exists and is accessible to the requester.                     |
| FR2 | Return chat metadata for each chat in the response (see "Data Returned" in Scope).              | P0       | Fields marked as optional may be omitted initially if not readily available.              |
| FR3 | Enforce RBAC to ensure only authorized users can access the endpoint.                           | P0       | Return `403 Forbidden` for unauthorized access.                                           |
| FR4 | Return `200 OK` with an empty array if no chats exist for the `projectId`.                      | P0       |                                                                                           |
| FR5 | Return `400 Bad Request` for invalid `projectId` (e.g., non-integer, out of bounds).             | P0       | Include descriptive error message.                                                        |
| FR6 | Return `404 Not Found` if the `projectId` does not exist.                                       | P0       |                                                                                           |
| FR7 | Return `500 Internal Server Error` for unexpected server errors.                                | P0       | Log errors for debugging.                                                                 |
| FR8 | Order chats by `updatedAt` in descending order (newest first).                                  | P1       | Support for other sorting options is out of scope.                                        |
| FR9 | Support for querying chats created or updated within a specific date range.                    | P2       | Out of scope for initial implementation.                                                  |
| FR10| The endpoint must respond within **< 300ms** for projects with ≤ 1,000 chats.                   | P1       | Monitor performance and optimize if necessary.                                            |

---

## Acceptance Criteria

### API Endpoint
1. **Request**:
   - Method: `GET` (or `POST` if input complexity requires it; to be determined during implementation).
   - Path: `/api/builtin_brain_list` (or `/api/v1/projects/:projectId/chats`; final path TBD).
   - Input: `{ projectId: number }` (e.g., `projectId: 11`).
2. **Response**:
   - Status Code: `200 OK` for successful requests.
   - Body:
     ```json
     {
       "chats": [
         {
           "chatId": "uuid-or-unique-string",
           "title": "Chat Title",
           "createdAt": "ISO-8601-timestamp",
           "updatedAt": "ISO-8601-timestamp",
           "participantCount": 2,
           "messageCount": 15,
           "isArchived": false,
           "lastMessagePreview": "Last message preview..."
         },
         ...
       ]
     }
     ```
   - Status Code: `400 Bad Request` for invalid input (e.g., `{ projectId: "invalid" }`).
     - Body:
       ```json
       {
         "error": "Invalid projectId. Must be a positive integer."
       }
       ```
   - Status Code: `403 Forbidden` for unauthorized access.
     - Body:
       ```json
       {
         "error": "You do not have permission to access this project's chats."
       }
       ```
   - Status Code: `404 Not Found` if the project does not exist.
     - Body:
       ```json
       {
         "error": "Project not found."
       }
       ```
   - Status Code: `500 Internal Server Error` for server errors.
     - Body:
       ```json
       {
         "error": "An unexpected error occurred. Please try again later."
       }
       ```

### Functional
1. ✅ The endpoint returns all 13 existing chats for `projectId: 11` when queried.
2. ✅ The response includes all required metadata fields for each chat (see Scope).
3. ✅ The endpoint returns an empty array for a valid `projectId` with no chats.
4. ✅ The endpoint returns `403 Forbidden` if the requester lacks permissions.
5. ✅ The endpoint returns `404 Not Found` for a non-existent `projectId`.
6. ✅ The endpoint responds within 300ms for `projectId: 11` (or other projects with ≤ 1,000 chats).

### Non-Functional
1. ✅ The endpoint is documented in the API reference with examples and error codes.
2. ✅ The endpoint is monitored for performance and errors in production.
3. ✅ The endpoint adheres to security best practices (e.g., input validation, rate limiting).
4. ✅ The endpoint is tested with edge cases (e.g., empty projects, invalid `projectId`).

---

## Out of Scope (Reiterated)
To avoid scope creep, the following features are explicitly excluded from this PRD:
- Pagination of results.
- Real-time updates or subscriptions.
- Returning full message content.
- Editing or deleting chats.
- Offline access or caching.
- Advanced filtering, sorting, or search.
- Exporting chat lists.
- Support for bulk operations (e.g., archiving multiple chats).