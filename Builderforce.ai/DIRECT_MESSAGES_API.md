# Direct Messaging API Design

## Overview

Direct messaging between employers and freelancers within specific engagements (jobs). This implementation supports:
- Per-engagement conversation threads
- Bidirectional message exchange
- Unread count tracking
- Notification events

## Data Models

### Conversation
Represents a continuous conversation between an employer and freelancer tied to a specific job.

**Fields:**
- `id`: UUID primary key
- `job_id`: FK to jobs table (engagement identifier)
- `employer_user_id`: FK to users table (employer participant)
- `freelancer_user_id`: FK to users table (freelancer participant)
- `company_name`: Optional string (employer company name)
- `company_website`: Optional string (employer company website)
- `company_logo_url`: Optional string (employer company logo URL)
- `engagement_status`: Enum - `active` | `closed` | `cancelled`
- `unread_employer_count`: Integer (default 0)
- `unread_freelancer_count`: Integer (default 0)
- `created_at`: Timestamp
- `updated_at`: Timestamp

### Message
Individual messages exchanged within a conversation.

**Fields:**
- `id`: UUID primary key
- `conversation_id`: FK to conversations table
- `sender_user_id`: FK to users table (who sent the message)
- `sender_role`: Enum - `employer` | `freelancer` | `viewing`
- `content`: Text (message content)
- `created_at`: Timestamp
- `read_at`: Timestamp (nullable) - When the message was read
- `has_attachments`: Boolean (default false)

### MessageNotification
Notification records for unread messages.

**Fields:**
- `id`: UUID primary key
- `message_id`: FK to messages table (parent message)
- `user_id`: FK to users table (recipient)
- `role`: Enum - `employer` | `freelancer`
- `unread`: Boolean (default true)
- `created_at`: Timestamp
- `read_at`: Timestamp (nullable)

## API Endpoints

### Conversations

#### 1. Create/Get Conversation
**Route:** `POST /api/messages/conversations`  
**Description:** Create a conversation for a job between employer and freelancer, or retrieve existing if present.

**Request Body:**
```json
{
  "job_id": "uuid",
  "employer_user_id": "uuid",
  "freelancer_user_id": "uuid"
}
```

**Response:**
```json
{
  "id": "uuid",
  "job_id": "uuid",
  "employer_user_id": "uuid",
  "freelancer_user_id": "uuid",
  "engagement_status": "active",
  "unread_employer_count": 0,
  "unread_freelancer_count": 0
}
```

#### 2. List User Conversations
**Route:** `GET /api/messages/conversations`  
**Description:** Get all conversations for a user, optionally filtered by job.

**Query Parameters:**
- `user_id` (required): UUID
- `role` (required): `employer` | `freelancer`
- `job_id` (optional): UUID (filter by job)

**Response:**
```json
[
  {
    "id": "uuid",
    "job_id": "uuid",
    "employer_user_id": "uuid",
    "freelancer_user_id": "uuid",
    "engagement_status": "active",
    "unread_employer_count": 1,
    "unread_freelancer_count": 0
  },
  ...
]
```

#### 3. Get Conversation Messages
**Route:** `GET /api/messages/conversations/{conversation_id}/messages`  
**Description:** Retrieve all messages in a conversation (sorted oldest first).

**Response:**
```json
[
  {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_user_id": "uuid",
    "sender_role": "employer",
    "content": "Hello!",
    "created_at": "2025-07-10T10:00:00Z",
    "read_at": "2025-07-10T11:00:00Z",
    "has_attachments": false
  },
  ...
]
```

### Messages

#### 1. Send Message
**Route:** `POST /api/messages/messages`  
**Description:** Send a message in a conversation.

**Request Body:**
```json
{
  "conversation_id": "uuid",
  "sender_user_id": "uuid",
  "sender_role": "employer",
  "content": "Hello!",
  "has_attachments": false
}
```

**Response:**
```json
{
  "id": "uuid",
  "conversation_id": "uuid",
  "sender_user_id": "uuid",
  "sender_role": "employer",
  "content": "Hello!",
  "created_at": "2025-07-10T10:00:00Z",
  "read_at": null,
  "has_attachments": false
}
```

#### 2. Mark Message as Read
**Route:** `POST /api/messages/messages/{message_id}/read`  
**Description:** Mark a message as read and update unread counts.

**Request Body:**
```json
{
  "user_id": "uuid",
  "role": "employer"
}
```

**Response:**
```json
{
  "message_id": "uuid",
  "read_at": "2025-07-10T11:00:00Z",
  "unread_employer_count": 0,
  "unread_freelancer_count": 0
}
```

### Notifications

#### 1. Get Unread Count
**Route:** `GET /api/messages/unread-count`  
**Description:** Get total unread message count for a user.

**Query Parameters:**
- `user_id` (required): UUID
- `role` (required): `employer` | `freelancer`
- `job_id` (optional): UUID (filter by job)

**Response:**
```json
{
  "unread_count": 3
}
```

#### 2. List Notifications
**Route:** `GET /api/messages/notifications`  
**Description:** Get notifications for a user, optionally unread only.

**Query Parameters:**
- `user_id` (required): UUID
- `role` (required): `employer` | `freelancer`
- `unreadOnly` (optional, default true): Boolean

**Response:**
```json
[
  {
    "id": "uuid",
    "message_id": "uuid",
    "user_id": "uuid",
    "role": "freelancer",
    "unread": true,
    "created_at": "2025-07-10T10:00:00Z",
    "read_at": null
  },
  ...
]
```

#### 3. Mark All as Read
**Route:** `POST /api/messages/notifications/read-all`  
**Description:** Mark all notifications for a user as read and clear unread counts.

**Request Body:**
```json
{
  "user_id": "uuid",
  "role": "employer"
}
```

**Response:**
```json
{
  "unread_count_after": 0,
  "processed_notifications": 5
}
```

### Conversation Management

#### 1. Close Conversation
**Route:** `POST /api/messages/conversations/{conversation_id}/close`  
**Description:** Close a conversation (marks as closed, preserves data).

#### 2. Cancel Conversation
**Route:** `POST /api/messages/conversations/{conversation_id}/cancel`  
**Description:** Cancel a conversation (marks as cancelled, preserves data).

## Behavior Rules

### Message Ordering
- New messages appear at the end of the conversation (opposite of standard chat UI where newest is first)
- Oldest messages are displayed first
- Timestamp ordering by `created_at` ascending

### Unread Count Logic
- Incremented when a message is sent from opposite role
- Decrement when message is marked as read by the recipient
- Update conversation `updated_at` timestamp on each modification

### Notification Rules
- Created when a message is sent to a role
- Cleared when message is read by recipient
- Client can poll notifications or receive push notifications

### Permission Model
- `employer` role can send messages to freelancer conversations
- `freelancer` role can send messages to employer conversations
- `viewing` role (future merging of employer view) for read-only access

## Frontend Integration

### Mock API Pattern (Task #374)
- Implemented in `Builderforce.ai/frontend/src/__mock__/api/tasks/messages.ts`
- Uses in-memory storage for demo purposes
- Follows same patterns as `unassigned-high-priority.ts`
- Provides TypeScript interfaces and reference implementation

### Future Production Integration
1. Replace mock API calls with real HTTP requests
2. Use secure authentication (JWT/session tokens)
3. Implement WebSocket/Server-Sent Events for real-time updates
4. Add real-time notification push services (Firebase/OneSignal)
5. Consider end-to-end encryption for security

## Database Migration

### Migration File: `messages_conversations.sql`

```sql
-- Conversations table
CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id),
    employer_user_id UUID NOT NULL REFERENCES users(id),
    freelancer_user_id UUID NOT NULL REFERENCES users(id),
    company_name VARCHAR(255),
    company_website VARCHAR(512),
    company_logo_url VARCHAR(512),
    engagement_status VARCHAR(20) NOT NULL DEFAULT 'active', -- active, closed, cancelled
    unread_employer_count INTEGER NOT NULL DEFAULT 0,
    unread_freelancer_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(job_id, employer_user_id, freelancer_user_id)
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_user_id UUID NOT NULL REFERENCES users(id),
    sender_role VARCHAR(20) NOT NULL, -- employer, freelancer, viewing
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE,
    has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
    INDEX idx_messages_conversation (conversation_id),
    INDEX idx_messages_created_at (created_at)
);

-- Message notifications table
CREATE TABLE IF NOT EXISTS message_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id),
    role VARCHAR(20) NOT NULL, -- employer, freelancer
    unread BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE,
    UNIQUE(message_id, user_id, role)
);

-- Indexes for queries
CREATE INDEX idx_conversations_user_employer ON conversations(employer_user_id);
CREATE INDEX idx_conversations_user_freelancer ON conversations(freelancer_user_id);
CREATE INDEX idx_notifications_user ON message_notifications(user_id);
CREATE INDEX idx_notifications_unread ON message_notifications(user_id) WHERE unread = TRUE;
```

## Error Handling

### Common Error Codes
- `404 Not Found`: Conversation or message not found
- `403 Forbidden`: User not authorized for this role
- `400 Bad Request`: Invalid request parameters or message content
- `409 Conflict`: Conversation already exists for these users and job

### Error Response Format
```json
{
  "error": {
    "code": "CONVERSATION_NOT_FOUND",
    "message": "Conversation not found",
    "details": {}
  }
}
```

## Performance Considerations

### Indexing Strategy
- All foreign keys are indexed for JOIN performance
- `created_at` is indexed for date-range queries
- Composite indexes for common query patterns (unread notifications, user conversations)

### Caching
- Conversation list cache: 5 minutes per user
- Message thread cache: 1 minute per conversation
- Unread count cache: 1 minute per user
- Use Redis or in-memory cache (Memoization)

### Pagination
- API endpoints should support pagination
- Default page size: 20 items
- Maximum page size: 100 items

## Security Considerations

### Authentication
- All API endpoints require authenticated requests
- User context derived from JWT/session token
- Role-based access control enforced at service layer

### Rate Limiting
- Message sending: 30 messages per minute per user
- Conversation listing: 60 requests per minute per user
- Notification polling: 5 requests per minute per user

### Content Moderation
- Message length validation (min 1, max 10,000 characters)
- XSS prevention (sanitize user content before storage)
- Profanity filtering (optional, based on platform policy)

## Monitoring & Metrics

### Key Metrics to Track
1. Messages sent per minute (by role)
2. Unread messages per user (average)
3. Notification delivery success rate
4. Conversation opening rate
5. Average conversation retention (messages per conversation)

### Logging
- Log message sends for audit trail
- Log unauthenticated access attempts
- Log rate limit violations

## Future Enhancements

1. **WebSockets**: Real-time message delivery
2. **File Attachments**: Support for file uploads in messages
3. **Message Reactions**: Emoji reactions to messages
4. **Message Editing**: Ability to edit/modify sent messages
5. **Message Deletion**: Per-user delete with soft delete
6. **Search**: Full-text search across conversations
7. **Starred Messages**: Mark important messages
8. **Mentions**: @mentions system
9. **Voice Messages**: Record and send voice notes
10. **Third-party Integration**: Connect to Slack/Teams