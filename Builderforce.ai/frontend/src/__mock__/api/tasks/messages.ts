/**
 * Direct messaging API mock
 * Implements employer-freelancer conversation threads tied to engagements (jobs)
 */

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

export type Permission = 'employer' | 'freelancer' | 'viewing';

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

/**
 * In-memory message storage (simulating database)
 */
export const mockMessagesData = new Map<string, Message[]>();

/**
 * In-memory conversation storage
 */
export const mockConversationsData = new Map<string, Conversation>();

/**
 * Notification storage
 */
export const mockNotificationsData = new Map<string, MessageNotification[]>();

/**
 * Helper: Get or create conversation for engagement
 */
export function getConversation(jobId: string, employerId: string, freelancerId: string): Conversation {
  const searchKey = `${jobId}:${employerId}:${freelancerId}`;
  let convo = mockConversationsData.get(searchKey);
  
  if (!convo) {
    // Default engagement data
    convo = {
      id: `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      created_at: new Date(),
      updated_at: new Date(),
      job_id: jobId,
      employer_user_id: employerId,
      freelancer_user_id: freelancerId,
      engagement_status: 'active',
      unread_employer_count: 0,
      unread_freelancer_count: 0,
    };
    mockConversationsData.set(searchKey, convo);
    mockMessagesData.set(convo.id, []);
  }
  
  return convo;
}

/**
 * Get all conversations for a user
 */
export function getUserConversations(
  userId: string,
  role: Permission,
  jobId?: string
): Conversation[] {
  const allConversations: Conversation[] = [];
  
  for (const [_, convo] of mockConversationsData.entries()) {
    // Filter by user role and user_id match
    const isParticipant = (role === 'employer' && convo.employer_user_id === userId) ||
                          (role === 'freelancer' && convo.freelancer_user_id === userId);
    
    if (isParticipant) {
      // Apply job filter if provided
      if (jobId && convo.job_id !== jobId) {
        continue;
      }
      allConversations.push(convo);
    }
  }
  
  // Sort by updated_at descending
  return allConversations.sort((a, b) => 
    b.updated_at.getTime() - a.updated_at.getTime()
  );
}

/**
 * Send a message in a conversation
 */
export function sendMessage(params: {
  conversation_id: string;
  sender_user_id: string;
  sender_role: Permission;
  content: string;
  has_attachments?: boolean;
  attachments?: string[];
}): Message {
  const { conversation_id, sender_user_id, sender_role, content, has_attachments = false, attachments = [] } = params;
  const convo = mockConversationsData.get(
    getConversationSearchKey(conversation_id, sender_user_id, sender_role)
  );
  
  if (!convo) {
    throw new Error('Conversation not found');
  }
  
  // Create message
  const message: Message = {
    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    conversation_id,
    sender_user_id,
    sender_role,
    content,
    created_at: new Date(),
    read_at: null,
    has_attachments,
  };
  
  // Store in conversation thread (oldest first)
  const thread = mockMessagesData.get(conversation_id) || [];
  thread.push(message);
  mockMessagesData.set(conversation_id, thread);
  
  // Update conversation updated_at
  convo.updated_at = new Date();
  
  // Handle attachments (not implemented for mock, but structured for future)
  if (attachments && attachments.length > 0) {
    console.log('Attachments stored:', attachments);
  }
  
  // Update unread counts for recipient
  updateUnreadCount(convo, sender_role === 'employer' ? convo.freelancer_user_id : convo.employer_user_id);
  
  // Send notification
  sendNotification(message);
  
  // Update conversation timestamps
  convo.updated_at = new Date();
  mockConversationsData.set(
    getConversationSearchKey(conversation_id, sender_user_id, sender_role),
    convo
  );
  
  return message;
}

/**
 * Get conversation messages (oldest first)
 */
export function getConversationMessages(conversation_id: string): Message[] {
  const thread = mockMessagesData.get(conversation_id) || [];
  // Return as array for sorting oldest first
  return [...thread].sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
}

/**
 * Send notification for new message
 */
export function sendNotification(message: Message): void {
  const convo = mockConversationsData.get(
    getConversationSearchKey(message.conversation_id, message.sender_user_id, message.sender_role)
  );
  
  if (!convo) return;
  
  const recipientId = message.sender_role === 'employer' ? convo.freelancer_user_id : convo.employer_user_id;
  const recipientRole: Permission = message.sender_role === 'employer' ? 'freelancer' : 'employer';
  
  const notification: MessageNotification = {
    id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    message_id: message.id,
    user_id: recipientId,
    role: recipientRole,
    unread: true,
    created_at: new Date(),
    read_at: null,
  };
  
  const notifications = mockNotificationsData.get(recipientId) || [];
  notifications.push(notification);
  mockNotificationsData.set(recipientId, notifications);
}

/**
 * Update unread counts after message receipt
 */
export function updateUnreadCount(convo: Conversation, userId: string): void {
  const isEmployer = userId === convo.employer_user_id;
  
  if (isEmployer) {
    convo.unread_employer_count++;
  } else {
    convo.unread_freelancer_count++;
  }
  
  // Clear notifications for this message on recipient
  clearNotificationForMessage(userId, convo.id);
}

/**
 * Mark message as read
 */
export function markMessageAsRead(message_id: string, user_id: string, role: Permission): void {
  const convo = mockConversationsData.get(
    getConversationSearchKeyByMessageId(message_id, user_id, role)
  );
  
  if (!convo) return;
  
  const thread = mockMessagesData.get(convo.id) || [];
  const messageIndex = thread.findIndex(m => m.id === message_id);
  
  if (messageIndex !== -1) {
    const message = thread[messageIndex];
    if (!message.read_at) {
      message.read_at = new Date();
      thread[messageIndex] = message;
      mockMessagesData.set(convo.id, thread);
    }
  }
  
  // Update unread counts
  if (user_id === convo.employer_user_id) {
    if (convo.unread_employer_count > 0) {
      convo.unread_employer_count--;
    }
  } else {
    if (convo.unread_freelancer_count > 0) {
      convo.unread_freelancer_count--;
    }
  }
  
  // Mark notification as read if exists
  const notifications = mockNotificationsData.get(user_id) || [];
  const notifIndex = notifications.findIndex(n => n.message_id === message_id && n.unread);
  if (notifIndex !== -1) {
    notifications[notifIndex].unread = false;
    notifications[notifIndex].read_at = new Date();
    mockNotificationsData.set(user_id, notifications);
  }
  
  // Update conversation
  convo.updated_at = new Date();
  const searchKey = getConversationSearchKey(convo.id, convo.employer_user_id, 'employer');
  mockConversationsData.set(searchKey, convo);
}

/**
 * Get unread message count for user
 */
export function getUnreadCount(userId: string, role: Permission, jobId?: string): number {
  const conversations = getUserConversations(userId, role, jobId);
  return conversations.reduce((total, convo) => 
    total + (role === 'employer' ? convo.unread_employer_count : convo.unread_freelancer_count), 0
  );
}

/**
 * Get all notifications for user
 */
export function getUserNotifications(
  userId: string,
  role: Permission,
  unreadOnly: boolean = true
): MessageNotification[] {
  const notifications = mockNotificationsData.get(userId) || [];
  
  return notifications
    .filter(n => n.role === role && (unreadOnly ? n.unread : true))
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
}

/**
 * Mark all notifications as read for user
 */
export function markAllNotificationsRead(userId: string, role: Permission): void {
  const notifications = mockNotificationsData.get(userId) || [];
  const now = new Date();
  
  notifications.forEach(n => {
    if (n.role === role && n.unread) {
      n.unread = false;
      n.read_at = now;
    }
  });
  
  mockNotificationsData.set(userId, notifications);
  
  // Update conversation unread counts
  getUserConversations(userId, role).forEach(convo => {
    if (convo.unread_employer_count > 0) convo.unread_employer_count = 0;
    if (convo.unread_freelancer_count > 0) convo.unread_freelancer_count = 0;
    convo.updated_at = new Date();
    
    const searchKey = getConversationSearchKey(convo.id, convo.employer_user_id, 'employer');
    mockConversationsData.set(searchKey, convo);
  });
}

/**
 * Close conversation
 */
export function closeConversation(conversationId: string, userId: string, role: Permission): void {
  const convo = mockConversationsData.get(
    getConversationSearchKey(conversationId, userId, role)
  );
  
  if (!convo) return;
  
  convo.engagement_status = 'closed';
  convo.updated_at = new Date();
  const searchKey = getConversationSearchKeyByMessageId(conversationId, userId, role);
  mockConversationsData.set(searchKey, convo);
}

/**
 * Cancel conversation
 */
export function cancelConversation(conversationId: string, userId: string, role: Permission): void {
  const convo = mockConversationsData.get(
    getConversationSearchKeyByMessageId(conversationId, userId, role)
  );
  
  if (!convo) return;
  
  convo.engagement_status = 'cancelled';
  convo.updated_at = new Date();
  const searchKey = getConversationSearchKeyByMessageId(conversationId, userId, role);
  mockConversationsData.set(searchKey, convo);
}

// =============================================================================
// Helper Functions
// =============================================================================

function getConversationSearchKey(
  conversation_id: string,
  employerUserId: string,
  role: Permission
): string {
  return `${conversation_id}:${employerUserId}:${role}`;
}

function getConversationSearchKeyByMessageId(
  conversation_id: string,
  user_id: string,
  role: Permission
): string {
  // This is a simplified key - in real implementation, resolve to conversation
  return `${conversation_id}:${user_id}:${role}`;
}

function clearNotificationForMessage(userId: string, conversationId: string): void {
  const notifications = mockNotificationsData.get(userId) || [];
  const filtered = notifications.filter(n => n.message_id !== conversationId);
  mockNotificationsData.set(userId, filtered);
}

// =============================================================================
// Sample Data for Testing
// =============================================================================

export function seedSampleData(): void {
  // Create sample employer-freelancer conversation
  const convo = getConversation(
    'job_12345',
    'employer_884923',
    'freelancer_192837'
  );
  
  convo.company_name = 'Acme Corp';
  convo.company_website = 'https://example.com';
  
  const thread = mockMessagesData.get(convo.id) || [];
  
  // Sample messages (oldest first)
  const sampleMessages: Message[] = [
    {
      id: 'msg_001',
      conversation_id: convo.id,
      sender_user_id: 'employer_884923',
      sender_role: 'employer',
      content: 'Hello! I noticed you applied for the frontend developer position. Thanks for your interest!',
      created_at: new Date(Date.now() - 86400000 * 5), // 5 days ago
      read_at: new Date(Date.now() - 86400000 * 4),
      has_attachments: false,
    },
    {
      id: 'msg_002',
      conversation_id: convo.id,
      sender_user_id: 'freelancer_192837',
      sender_role: 'freelancer',
      content: 'Hi! Yes, I\'m excited about this opportunity. I have 5 years of experience with React and modern TypeScript projects.',
      created_at: new Date(Date.now() - 86400000 * 4), // 4 days ago
      read_at: new Date(Date.now() - 86400000 * 3),
      has_attachments: true,
    },
    {
      id: 'msg_003',
      conversation_id: convo.id,
      sender_user_id: 'employer_884923',
      sender_role: 'employer',
      content: 'That sounds great! Would you be able to start working on this next week? I have a few specific requirements we could discuss in detail.',
      created_at: new Date(Date.now() - 86400000 * 2), // 2 days ago
      read_at: null,
      has_attachments: true,
    },
    {
      id: 'msg_004',
      conversation_id: convo.id,
      sender_user_id: 'freelancer_192837',
      sender_role: 'freelancer',
      content: 'I can start next week. Before we dive in, could you share more details about the project timeline and expected deliverables?',
      created_at: new Date(Date.now() - 86400000 * 1), // 1 day ago
      read_at: null,
      has_attachments: false,
    },
  ];
  
  sampleMessages.forEach(msg => thread.push(msg));
  mockMessagesData.set(convo.id, thread);
  
  // Set up unread counts for sample
  convo.unread_freelancer_count = 1; // msg_004 unread
  
  // Create notification
  const notification: MessageNotification = {
    id: 'notif_001',
    message_id: 'msg_004',
    user_id: 'freelancer_192837',
    role: 'freelancer',
    unread: true,
    created_at: new Date(Date.now() - 86400000 * 1),
    read_at: null,
  };
  
  mockNotificationsData.set('freelancer_192837', [notification]);
}