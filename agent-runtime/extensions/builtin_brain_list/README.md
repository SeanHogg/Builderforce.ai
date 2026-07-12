# Built-in Brain List Plugin

## Overview

The `builtin_brain_list` built-in plugin provides the core functionality for listing all chat sessions associated with a project. This is a platform-level capability that can be used by agents, UI components, and administrative tools.

## Installation

This plugin is included in the core Builderforce platform. No additional installation is required.

## Usage

### As an Agent Tool

You can call `builtin_brain_list` through any agent:

```
List all chats for project ID 11
```

The tool returns detailed metadata about each chat session.

### As a CLI Command

During development, use the CLI to debug and test:

```bash
# Basic usage
builtin brain-list --projectId 11

# With additional options
builtin brain-list --projectId 11 --include-archived
builtin brain-list --projectId 11 --max-chats 20

# Full example
builtin brain-list --projectId 11 \
  --include-archived \
  --max-chats 50
```

### As an HTTP API

```bash
curl -X POST https://api.builderforce.ai/api/builtin_brain_list \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"projectId": 11}'
```

## Configuration

### Plugin Configuration

The plugin can be configured via environment variables or deployment configuration:

```yaml
builtin_brain_list:
  includeArchived: false  # Include archived chats in results
  maxChats: null          # Maximum chats to return (null = no limit in production)
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BUILTIN_BRAIN_LIST_MOCK` | `false` | Enable mock mode for development |
| `BUILTIN_BRAIN_LIST_MAX_CHATS` | `null` | Simulated maximum chat limit |
| `BUILTIN_BRAIN_LIST_INCLUDE_ARCHIVED` | `false` | Include archived chats |

## Implementation

### Architecture

```
agent-runtime/
├── extensions/
│   └── builtin_brain_list/
│       ├── index.ts           # Plugin registration
│       ├── types.ts           # TypeScript types
│       └── package.json       # NPM package configuration
├── packages/
│   └── lib-chat-management/
│       ├── index.ts           # Public API exports
│       ├── types.ts           # Core types
│       └── package.json       # NPM package configuration
└── docs/
    └── builtin-brain-list-api.md
```

### Core Functions

#### `getProjectChats(api, projectId)`

Retrieves all chats for a given project.

**Parameters:**
- `api`: BuilderForceAgentsPluginApi instance
- `projectId`: Number - The project ID

**Returns:** `Promise<ChatMetadata[]>`

**Behavior:**
- Validates projectId
- Checks RBAC permissions
- Queries chat storage
- Filters archived chats (if configured)
- Sorts by updatedAt descending

#### Tool Execution

The plugin registers a tool named `builtin_brain_list` with the following capabilities:

- **Name:** `builtin_brain_list`
- **Description:** Lists all chats for a project
- **Parameters:**
  - `projectId` (number, required)
- **Output:** `BrainListResponse`

### Data Storage

**Current Implementation:**

The plugin currently operates in **mock mode** for development and testing. Mock data is randomly generated to simulate real chat sessions.

**Production Implementation:**

In production, the plugin should connect to a chat storage system (e.g., PostgreSQL, MongoDB) to retrieve actual chat data. The `getProjectChats` function should be replaced with:

```typescript
async function getProjectChats(
  api: BuilderForceAgentsPluginApi,
  projectId: number
): Promise<ChatMetadata[]> {
  // Query actual storage
  const chats = await api.runtime.db.query(
    `
    SELECT
      c.chat_id,
      c.title,
      c.created_at,
      c.updated_at,
      c.is_archived,
      COUNT(m.message_id) as message_count,
      COUNT(DISTINCT m.sender_id) as participant_count
    FROM chat_sessions c
    LEFT JOIN messages m ON c.chat_id = m.chat_id
    WHERE c.project_id = ?
    GROUP BY c.chat_id
    ORDER BY c.updated_at DESC
    `,
    [projectId]
  );

  // Transform query results into ChatMetadata
  return chats.map(chat => ({
    chatId: chat.chat_id,
    title: chat.title,
    createdAt: chat.created_at,
    updatedAt: chat.updated_at,
    participantCount: chat.participant_count,
    messageCount: chat.message_count,
    isArchived: chat.is_archived,
    lastMessagePreview: chat.last_message_preview || "",
    // Participants and tags would be fetched separately
  }));
}
```

## Testing

### Manual Testing

1. **CLI Testing:**
   ```bash
   # List chats for project 11
   builtin brain-list --projectId 11
   
   # Test archive filter
   builtin brain-list --projectId 11 --include-archived
   
   # Test with max chats limit
   builtin brain-list --projectId 11 --max-chats 5
   ```

2. **HTTP API Testing:**
   ```bash
   # Using cURL
   curl -X POST https://api.builderforce.ai/api/builtin_brain_list \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer $TOKEN" \
     -d '{"projectId": 11}'
   ```

### Automated Testing

To add unit tests:

```typescript
import { builtinBrainListPlugin } from "./index";

describe("builtin_brain_list", () => {
  let api: BuilderForceAgentsPluginApi;

  beforeEach(() => {
    // Mock API instance
    api = createMockApi();
  });

  test("validates projectId", async () => {
    const tool = getTool(api, "builtin_brain_list");

    // Test invalid projectId
    await expect(
      tool.execute({ projectId: 0 })
    ).rejects.toThrow(ErrorCode.INVALID_PROJECT_ID);

    await expect(
      tool.execute({ projectId: -1 })
    ).rejects.toThrow(ErrorCode.INVALID_PROJECT_ID);

    await expect(
      tool.execute({ projectId: "invalid" })
    ).rejects.toThrow(ErrorCode.INVALID_PROJECT_ID);
  });

  test("returns empty array for project with no chats", async () => {
    const tool = getTool(api, "builtin_brain_list");

    await expect(
      tool.execute({ projectId: 999 })
    ).resolves.toEqual({ chats: [] });
  });
});
```

## Performance Considerations

### Currently

- Mock mode: Immediate response (< 10ms)
- Data is randomly generated (no database overhead)

### Production

The following optimizations should be implemented:

1. **Database Indexing:**
   ```sql
   CREATE INDEX idx_project_updated_at ON chat_sessions(project_id, updated_at DESC);
   CREATE INDEX idx_project_archived ON chat_sessions(project_id, is_archived);
   ```

2. **Query Optimization:**
   - Use indexed queries
   - Limit participant/message counts to what's needed
   - Cache frequently accessed project metadata

3. **Response Time Targets:**
   - ≤ 1,000 chats: < 300ms
   - ≤ 10,000 chats: < 1s
   - No full table scans

## RBAC Implementation

The plugin enforces RBAC through the BuilderForceAgentsPluginApi:

```typescript
// Check if user has access to project
const hasAccess = await api.auth.checkProjectAccess({
  userId: requestUserId,
  projectId: parseInt(params.projectId),
  requiredPermission: "view",
});

if (!hasAccess) {
  throw new BrainListError(
    "You do not have permission to access this project's chats.",
    ErrorCode.FORBIDDEN
  );
}
```

## Future Enhancements

### Roadmap v1.1

- [ ] **Pagination:** Implement cursor-based pagination for large result sets
- [ ] **Filtering:** Add support for filtering by date range, tags, participants
- [ ] **Export:** CSV and JSON export functionality
- [ ] **Analytics:** Chat volume trends, participant activity metrics
- [ ] **Real-time Updates:** WebSocket subscriptions for live chat updates
- [ ] **Advanced Sorting:** Sorting by message count, participant count, etc.

### Roadmap v2.0

- [ ] **Conversation Summaries:** Automatic summarization of long chats
- [ ] **Sentiment Analysis:** AI-powered sentiment on chat messages
- [ ] **Search:** Full-text search across all chats
- [ ] **Archival Options:** Configurable archival retention policies

## Troubleshooting

### Tool Not Loading

If the tool doesn't appear, verify:
1. Plugin is registered in the platform
2. Plugin dependencies are installed (`@seanhogg/builderforce-agents`)
3. No configuration errors in `agent-runtime/.builderforce/` directory

### Misc Data

Check the logs for warnings:

```
[builtin_brain_list] N archived chats were filtered out for projectId X
```

This indicates archived chats were excluded based on configuration.

### Performance Issues

1. Check database query performance
2. Verify indexes are present
3. Consider caching frequently accessed data
4. Monitor query execution plans

## Contributing

To contribute to this plugin:

1. Add new functionality to `index.ts`
2. Update types in `types.ts`
3. Add documentation in this README
4. Update `builtin-brain-list-api.md`
5. Create tests in appropriate test directory

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for detailed guideliines.

## License

MIT

## Support

For issues or questions, please open an issue on the Builderforce repository.