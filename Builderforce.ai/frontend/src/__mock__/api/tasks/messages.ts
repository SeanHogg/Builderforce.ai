/**
 * Direct messaging API mock
 * Implements employer-freelancer conversation threads tied to engagements (jobs).
 */

export type Permission = 'employer' | 'freelancer' | 'viewing';

export interface Conversation {
  id: string;
  created_at: Date;
  updated_at: Date;
  job_id: string;
  employer_user_id: string;
  freelancer_user_id: string;
  company_name?: string;
  company_website?: string;
  company_logo_url?: string;
  engagement_status: 'active' | 'closed' | 'cancelled';
  unread_employer_count: number;
  unread_freelancer_count: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_user_id: string;
  sender_role: Permission;
  content: string;
  created_at: Date;
  read_at: Date | null;
  has_attachments: boolean;
}

export interface MessageNotification {
  id: string;
  message_id: string;
  user_id: string;
  role: Permission;
  unread: boolean;
  created_at: Date;
  read_at: Date | null;
}

export type MessageDirection = 'outgoing' | 'incoming';

// =============================================================================
// In-memory storage (simulating database)
// =============================================================================

/** Conversations keyed by conversation id. */
export const mockConversationsData = new Map<string, Conversation>();

/** Conversation lookup by composite engagement key: `${jobId}:${employerId}:${freelancerId}`. */
export const mockConversationEngagementIndex = new Map<string, string>();

/** Messages keyed by conversation id. */
export const mockMessagesData = new Map<string, Message[]>();

/** Notifications keyed by recipient user id. */
export const mockNotificationsData = new Map<string, MessageNotification[]>();

// =============================================================================
// Helpers
// =============================================================================

function engagementKey(jobId: string, employerId: string, freelancerId: string): string {
  return `${jobId}:${employerId}:${freelancerId}`;
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function getConversationById(conversationId: string): Conversation | undefined {
  return mockConversationsData.get(conversationId);
}

// =============================================================================
// Conversations
// =============================================================================

/**
 * Get or create a conversation for a job/engagement.
 */
export function getConversation(
  jobId: string,
  employerId: string,
  freelancerId: string,
): Conversation {
  const key = engagementKey(jobId, employerId, freelancerId);
  const existingId = mockConversationEngagementIndex.get(key);

  if (existingId) {
    const existing = mockConversationsData.get(existingId);
    if (existing) return existing;
  }

  const conversation: Conversation = {
    id: generateId('conv'),
    created_at: new Date(),
    updated_at: new Date(),
    job_id: jobId,
    employer_user_id: employerId,
    freelancer_user_id: freelancerId,
    engagement_status: 'active',
    unread_employer_count: 0,
    unread_freelancer_count: 0,
  };

  mockConversationsData.set(conversation.id, conversation);
  mockConversationEngagementIndex.set(key, conversation.id);
  mockMessagesData.set(conversation.id, []);

  return conversation;
}

/**
 * Find an existing conversation by engagement identifiers.
 */
export function findConversation(
  jobId: string,
  employerId: string,
  freelancerId: string,
): Conversation | undefined {
  const key = engagementKey(jobId, employerId, freelancerId);
  const id = mockConversationEngagementIndex.get(key);
  return id ? mockConversationsData.get(id) : undefined;
}

/**
 * Get all conversations for a user, optionally filtered by job.
 */
export function getUserConversations(
  userId: string,
  role: Permission,
  jobId?: string,
): Conversation[] {
  const results: Conversation[] = [];

  for (const conversation of mockConversationsData.values()) {
    const isParticipant =
      (role === 'employer' && conversation.employer_user_id === userId) ||
      (role === 'freelancer' && conversation.freelancer_user_id === userId);

    if (!isParticipant) continue;
    if (jobId && conversation.job_id !== jobId) continue;

    results.push(conversation);
  }

  // Most recently updated first.
  return results.sort((a, b) => b.updated_at.getTime() - a.updated_at.getTime());
}

// =============================================================================
// Messages
// =============================================================================

/**
 * Send a message in a conversation. Creates a notification for the recipient
 * and increments the recipient's unread count.
 */
export function sendMessage(params: {
  conversation_id: string;
  sender_user_id: string;
  sender_role: Permission;
  content: string;
  has_attachments?: boolean;
  attachments?: string[];
}): Message {
  const {
    conversation_id,
    sender_user_id,
    sender_role,
    content,
    has_attachments = false,
    attachments = [],
  } = params;

  if (!content || content.trim().length === 0) {
    throw new Error('Message content cannot be empty');
  }

  const conversation = getConversationById(conversation_id);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  if (conversation.engagement_status !== 'active') {
    throw new Error(`Cannot send message to ${conversation.engagement_status} conversation`);
  }

  const message: Message = {
    id: generateId('msg'),
    conversation_id,
    sender_user_id,
    sender_role,
    content: content.trim(),
    created_at: new Date(),
    read_at: null,
    has_attachments,
  };

  const thread = mockMessagesData.get(conversation_id) || [];
  thread.push(message);
  mockMessagesData.set(conversation_id, thread);

  // Update conversation timestamps.
  conversation.updated_at = new Date();
  mockConversationsData.set(conversation_id, conversation);

  // Attachments are structured for future file-upload support.
  if (attachments.length > 0) {
    // eslint-disable-next-line no-console
    console.log('Attachments stored:', attachments);
  }

  // Determine recipient.
  const recipientId =
    sender_role === 'employer'
      ? conversation.freelancer_user_id
      : conversation.employer_user_id;
  const recipientRole: Permission = sender_role === 'employer' ? 'freelancer' : 'employer';

  // Increment unread count for recipient.
  if (recipientRole === 'employer') {
    conversation.unread_employer_count++;
  } else {
    conversation.unread_freelancer_count++;
  }

  // Create notification for recipient.
  createNotification(message, recipientId, recipientRole);

  return message;
}

/**
 * Get messages for a conversation sorted oldest first.
 */
export function getConversationMessages(conversation_id: string): Message[] {
  const thread = mockMessagesData.get(conversation_id) || [];
  return [...thread].sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
}

/**
 * Mark a single message as read. Decrements the recipient's unread count and
 * clears the corresponding notification.
 */
export function markMessageAsRead(
  message_id: string,
  user_id: string,
  role: Permission,
): void {
  let conversation: Conversation | undefined;
  let thread: Message[] | undefined;
  let message: Message | undefined;

  for (const [conversationId, messages] of mockMessagesData.entries()) {
    const found = messages.find((m) => m.id === message_id);
    if (found) {
      message = found;
      thread = messages;
      conversation = mockConversationsData.get(conversationId);
      break;
    }
  }

  if (!conversation || !thread || !message) {
    throw new Error('Message not found');
  }

  if (message.read_at) {
    return;
  }

  message.read_at = new Date();
  mockMessagesData.set(conversation.id, thread);

  // Decrement unread count for the reader.
  if (user_id === conversation.employer_user_id && role === 'employer') {
    if (conversation.unread_employer_count > 0) {
      conversation.unread_employer_count--;
    }
  } else if (user_id === conversation.freelancer_user_id && role === 'freelancer') {
    if (conversation.unread_freelancer_count > 0) {
      conversation.unread_freelancer_count--;
    }
  }

  conversation.updated_at = new Date();
  mockConversationsData.set(conversation.id, conversation);

  // Mark notification as read.
  const notifications = mockNotificationsData.get(user_id) || [];
  const notification = notifications.find(
    (n) => n.message_id === message_id && n.role === role && n.unread,
  );

  if (notification) {
    notification.unread = false;
    notification.read_at = new Date();
    mockNotificationsData.set(user_id, notifications);
  }
}

// =============================================================================
// Notifications
// =============================================================================

/**
 * Create a notification for a recipient of a new message.
 */
export function createNotification(
  message: Message,
  recipientId: string,
  recipientRole: Permission,
): void {
  const notifications = mockNotificationsData.get(recipientId) || [];

  // Avoid duplicate notifications for the same message + recipient + role.
  const alreadyExists = notifications.some(
    (n) => n.message_id === message.id && n.role === recipientRole && n.unread,
  );
  if (alreadyExists) return;

  const notification: MessageNotification = {
    id: generateId('notif'),
    message_id: message.id,
    user_id: recipientId,
    role: recipientRole,
    unread: true,
    created_at: new Date(),
    read_at: null,
  };

  notifications.push(notification);
  mockNotificationsData.set(recipientId, notifications);
}

/**
 * Send a notification for a message. Alias for createNotification from message context.
 */
export function sendNotification(message: Message): void {
  const conversation = getConversationById(message.conversation_id);
  if (!conversation) return;

  const recipientId =
    message.sender_role === 'employer'
      ? conversation.freelancer_user_id
      : conversation.employer_user_id;
  const recipientRole: Permission =
    message.sender_role === 'employer' ? 'freelancer' : 'employer';

  createNotification(message, recipientId, recipientRole);
}

/**
 * Get total unread message count for a user.
 */
export function getUnreadCount(userId: string, role: Permission, jobId?: string): number {
  return getUserConversations(userId, role, jobId).reduce((total, conversation) => {
    return (
      total +
      (role === 'employer'
        ? conversation.unread_employer_count
        : conversation.unread_freelancer_count)
    );
  }, 0);
}

/**
 * Get notifications for a user.
 */
export function getUserNotifications(
  userId: string,
  role: Permission,
  unreadOnly = true,
): MessageNotification[] {
  const notifications = mockNotificationsData.get(userId) || [];
  return notifications
    .filter((n) => n.role === role && (unreadOnly ? n.unread : true))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
}

/**
 * Mark all notifications as read for a user and clear all related unread counts.
 */
export function markAllNotificationsRead(userId: string, role: Permission): void {
  const now = new Date();
  const notifications = mockNotificationsData.get(userId) || [];

  notifications.forEach((n) => {
    if (n.role === role && n.unread) {
      n.unread = false;
      n.read_at = now;
    }
  });

  mockNotificationsData.set(userId, notifications);

  getUserConversations(userId, role).forEach((conversation) => {
    if (role === 'employer') {
      conversation.unread_employer_count = 0;
    } else {
      conversation.unread_freelancer_count = 0;
    }
    conversation.updated_at = now;
    mockConversationsData.set(conversation.id, conversation);
  });
}

// =============================================================================
// Conversation lifecycle
// =============================================================================

function updateConversationStatus(
  conversationId: string,
  status: 'closed' | 'cancelled',
): void {
  const conversation = getConversationById(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  conversation.engagement_status = status;
  conversation.updated_at = new Date();
  mockConversationsData.set(conversationId, conversation);
}

export function closeConversation(conversationId: string): void {
  updateConversationStatus(conversationId, 'closed');
}

export function cancelConversation(conversationId: string): void {
  updateConversationStatus(conversationId, 'cancelled');
}

// =============================================================================
// Sample data
// =============================================================================

export function seedSampleData(): void {
  const conversation = getConversation('job_12345', 'employer_884923', 'freelancer_192837');
  conversation.company_name = 'Acme Corp';
  conversation.company_website = 'https://example.com';
  mockConversationsData.set(conversation.id, conversation);

  const thread = mockMessagesData.get(conversation.id) || [];

  const sampleMessages: Message[] = [
    {
      id: 'msg_001',
      conversation_id: conversation.id,
      sender_user_id: conversation.employer_user_id,
      sender_role: 'employer',
      content:
        'Hello! I noticed you applied for the frontend developer position. Thanks for your interest!',
      created_at: new Date(Date.now() - 86400000 * 5),
      read_at: new Date(Date.now() - 86400000 * 4),
      has_attachments: false,
    },
    {
      id: 'msg_002',
      conversation_id: conversation.id,
      sender_user_id: conversation.freelancer_user_id,
      sender_role: 'freelancer',
      content:
        "Hi! Yes, I'm excited about this opportunity. I have 5 years of experience with React and modern TypeScript projects.",
      created_at: new Date(Date.now() - 86400000 * 4),
      read_at: new Date(Date.now() - 86400000 * 3),
      has_attachments: true,
    },
    {
      id: 'msg_003',
      conversation_id: conversation.id,
      sender_user_id: conversation.employer_user_id,
      sender_role: 'employer',
      content:
        'That sounds great! Would you be able to start working on this next week? I have a few specific requirements we could discuss in detail.',
      created_at: new Date(Date.now() - 86400000 * 2),
      read_at: null,
      has_attachments: true,
    },
    {
      id: 'msg_004',
      conversation_id: conversation.id,
      sender_user_id: conversation.freelancer_user_id,
      sender_role: 'freelancer',
      content:
        'I can start next week. Before we dive in, could you share more details about the project timeline and expected deliverables?',
      created_at: new Date(Date.now() - 86400000 * 1),
      read_at: null,
      has_attachments: false,
    },
  ];

  thread.push(...sampleMessages);
  mockMessagesData.set(conversation.id, thread);

  conversation.unread_employer_count = 2; // msg_003 and msg_004 unread by employer
  conversation.updated_at = new Date();
  mockConversationsData.set(conversation.id, conversation);

  createNotification(sampleMessages[2], conversation.employer_user_id, 'employer');
  createNotification(sampleMessages[3], conversation.employer_user_id, 'employer');
}
