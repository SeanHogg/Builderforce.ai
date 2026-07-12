# API Module

This module provides mock backend APIs for testing and development. These APIs simulate production backend endpoints that will be implemented later in the actual API layer.

## Structure

```
frontend/src/__mock__/api/
├── index.ts           # Central export point
├── README.md          # This file
└── tasks/
    ├── index.ts       # Tasks-related API exports
    └── messages.ts    # Message/conversation APIs
```

## Available APIs

### Messages API

The messages module implements direct messaging between employers and freelancers.

**Location:** `@/lib/api/messages` (when migrated to production) or `@/__mock__/api/tasks/messages` (current)

**Data Models:**

- `Conversation` - Engagement between an employer and freelancer on a job
- `Message` - Individual message within a conversation
- `MessageNotification` - Notification for unread messages
- `Permission` - 'employer' | 'freelancer' | 'viewing'

**Key Functions:**

```typescript
// Get or create conversation for a job
getConversation(jobId: string, employerId: string, freelancerId: string): Conversation

// List user conversations
getUserConversations(userId: string, role: Permission, jobId?: string): Conversation[]

// Send a message
sendMessage(params: {
  conversation_id: string;
  sender_user_id: string;
  sender_role: Permission;
  content: string;
  has_attachments?: boolean;
}): Message

// Get conversation messages (oldest first)
getConversationMessages(conversation_id: string): Message[]

// Mark messages as read
markMessageAsRead(message_id: string, user_id: string, role: Permission): void

// Get unread count
getUnreadCount(userId: string, role: Permission, jobId?: string): number

// Get notifications
getUserNotifications(userId: string, role: Permission, unreadOnly?: boolean): MessageNotification[]

// Mark all notifications as read
markAllNotificationsRead(userId: string, role: Permission): void

// Close/cancel conversation
closeConversation(conversation_id: string): void
cancelConversation(conversation_id: string): void
```

**Sample Data (Development):**

```typescript
import { seedSampleData } from '@/__mock__/api/tasks/messages';

seedSampleData(); // Pre-populates with test conversation and messages
```

## Usage Examples

### Creating a conversation and sending a message:

```typescript
import {
  getConversation,
  sendMessage,
  getUserConversations,
  getConversationMessages,
  markMessageAsRead,
} from '@/__mock__/api/tasks/messages';

// Get conversation for job
const conversation = getConversation('job_123', 'employer_abc', 'freelancer_xyz');

// Send message
const message = sendMessage({
  conversation_id: conversation.id,
  sender_user_id: 'employer_abc',
  sender_role: 'employer',
  content: 'Hello! Can we schedule a call?',
});

// Get messages in thread
const messages = getConversationMessages(conversation.id);

// Mark message as read
markMessageAsRead(message.id, 'freelancer_xyz', 'freelancer');

// Check unread count
const unreadCount = getUnreadCount('freelancer_xyz', 'freelancer');
```

## Future Production Integration

When implementing the real backend APIs, follow these steps:

1. Create REST API endpoints in `backend/api/messages/`
2. Implement proper authentication and authorization
3. Add WebSocket support for real-time message delivery
4. Implement database migrations for conversation/message tables
5. Replace mock calls with real HTTP requests
6. Add rate limiting and content moderation
7. Implement proper error handling and logging

## Data Storage

Currently uses in-memory JavaScript objects for simulating database storage:

- `mockConversationsData` - Map<conversationId, Conversation>
- `mockMessagesData` - Map<conversationId, Message[]>
- `mockNotificationsData` - Map<userId, MessageNotification[]>
- `mockConversationEngagementIndex` - Map<engagementKey, conversationId>

In production, this will be replaced with PostgreSQL/Redis backed storage.

## Testing

When writing tests, can seed sample data:

```typescript
seedSampleData(); // Create test conversation and messages
```

Or manually create conversations and messages as needed.