# Built-in Brain List API

## Overview

The `builtin_brain_list` endpoint provides a comprehensive list of all chat sessions for a given project. This API is designed to support compliance auditing, project management, and team analytics.

## Endpoint

```
POST /api/builtin_brain_list
```

## Request

### Headers

```
Content-Type: application/json
Authorization: Bearer <token>
```

### Body

```json
{
  "projectId": 11
}
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `projectId` | number | Yes | The project ID to query chats for |

### Request Example

```bash
curl -X POST https://api.builderforce.ai/api/builtin_brain_list \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "projectId": 11
  }'
```

## Response

### Success (200 OK)

```json
{
  "chats": [
    {
      "chatId": "chat-11-1",
      "title": "Team Chat 1",
      "createdAt": "2025-01-15T10:30:00.000Z",
      "updatedAt": "2025-01-20T14:20:00.000Z",
      "participantCount": 3,
      "messageCount": 27,
      "isArchived": false,
      "lastMessagePreview": "Let's discuss the Q4 strategy roadmap",
      "tags": ["urgent", "planning"]
    },
    {
      "chatId": "chat-11-2",
      "title": "Team Chat 2",
      "createdAt": "2025-01-10T08:15:00.000Z",
      "updatedAt": "2025-01-19T16:45:00.000Z",
      "participantCount": 2,
      "messageCount": 12,
      "isArchived": true,
      "lastMessagePreview": "Finalized the design mockups",
      "tags": []
    }
  ]
}
```

### Error Responses

#### Bad Request (400)

```json
{
  "error": "Invalid projectId. Must be a positive integer."
}
```

**Possible causes:**
- `projectId` is not a number
- `projectId` is less than 1

#### Forbidden (403)

```json
{
  "error": "You do not have permission to access this project's chats."
}
```

**Possible causes:**
- User does not have access to the project
- User's role does not have permission to view chat metadata

#### Not Found (404)

```json
{
  "error": "Project not found."
}
```

**Possible causes:**
- The `projectId` does not exist in the system

#### Internal Server Error (500)

```json
{
  "error": "An unexpected error occurred. Please try again later."
}
```

**Possible causes:**
- Database connection issues
- Unexpected server errors
- Errors in chat service

## Chat Metadata Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `chatId` | string | Yes | Unique identifier for the chat session |
| `title` | string | Yes | Human-readable title (auto-generated if unavailable) |
| `createdAt` | string (ISO-8601) | Yes | Timestamp when the chat was initiated |
| `updatedAt` | string (ISO-8601) | Yes | Timestamp of the last message in the chat |
| `participantCount` | number | Yes | Number of unique participants in the chat |
| `messageCount` | number | Yes | Total number of messages in the chat |
| `isArchived` | boolean | Yes | Whether the chat is archived |
| `lastMessagePreview` | string | Yes | Truncated preview of the last message (max 50 chars) |
| `participants` | string[] | No | List of user IDs or roles involved in the chat |
| `tags` | string[] | No | Tags or labels (e.g., "urgent", "technical") |

## Response Ordering

Chats are returned in descending order by `updatedAt` (newest first).

## Performance

| Project Size | Target Response Time |
|--------------|---------------------|
| ≤ 1,000 chats | < 300ms |
| ≤ 10,000 chats | < 1s |

The API is optimized to avoid full table scans by:
- Indexing on `projectId` and `updatedAt`
- Using efficient join queries for participant/message counts
- Caching frequently accessed project chat metadata

## Security & Access Control

### RBAC Requirements

Users must have the following access level to successfully call this endpoint:

| Role | Permission |
|------|------------|
| Project Admin | ✅ Full access |
| Project Member | ✅ Read-only access |
| Project Viewer | ❌ No access |
| System Admin | ✅ Full access (all projects) |

### Rate Limiting

The endpoint is subject to rate limiting:
- Standard rate limit: 100 requests per minute per user
- Burst limit: 10 concurrent requests per user

### Input Validation

The following validations are performed:
1. `projectId` must be a positive integer
2. `projectId` must not exceed the maximum project ID in the system
3. User must be a member of the project (for project-scoped access)

## Error Handling

All errors follow a consistent response format:

```json
{
  "error": "<human-readable error message>"
}
```

Error codes are reflected in HTTP status codes. Detailed error information is logged server-side for debugging.

## Pagination

**Out of Scope (Initial Release)**

Pagination is not included in the initial release. For projects with larger numbers of chats (10,000+), additional iteration or fallback to a page-based query is recommended.

Future iterations may include:
- Cursor-based pagination
- Offset-based pagination options

## Mock/Simulation Mode

During development and testing, the plugin can operate in mock mode that returns simulated chat data. This mode is controlled via environment variables.

### Environment Variables

```bash
BUILTIN_BRAIN_LIST_MOCK=true
BUILTIN_BRAIN_LIST_MAX_CHATS=13
```

### Mock Behavior

- Uses simulated chat data matching the PRD's example
- Does not persist changes
- Suitable for frontend development and testing

## Monitoring & Observability

### Metrics Tracked

- Request count by projectId
- Response time buckets (p50, p95, p99)
- Error rate by error code
- Success rate overall

### Logging

Important events are logged:
- Successful requests
- Validation failures
- Access denials (403)
- Database errors
- Unexpected failures (500)

## Related Endpoints

- `builtin_team_chat_read` - Read a specific chat's messages
- `builtin_projects_get` - Get project details
- `builtin_projects_list` - List all projects

## Changelog

### v1.0.0 (Initial Release)

- Basic chat listing functionality
- Mock data support for development
- RBAC enforcement scheduled for subsequent release
- Error handling and monitoring framework