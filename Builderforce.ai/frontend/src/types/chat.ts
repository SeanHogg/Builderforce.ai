/**
 * Chat-related TypeScript type definitions
 * These types support the chat consolidation feature and related functionality
 */

export interface ChatMessage {
  /** Unique message identifier */
  id: string;
  
  /** The chat this message belongs to */
  chat_id: string;
  
  /** Author/creator of the message */
  author: string;
  
  /** Content of the message */
  content: string;
  
  /** ISO 8601 timestamp of when the message was created */
  timestamp: string;
}

export interface ChatConversation {
  /** Unique chat identifier */
  id: string;
  
  /** Title or subject of the conversation */
  title: string;
  
  /** Creator of the chat */
  created_by: string;
  
  /** Timestamp when the chat was created */
  created_at: string;
  
  /** Last update timestamp */
  updated_at: string;
  
  /** List of messages in the conversation */
  messages: ChatMessage[];
  
  /** Tags or categories for this chat */
  tags?: string[];
  
  /** Whether the chat is archived */
  archived: boolean;
}

export interface ChatConsolidationParams {
  /** Required - Target chat ID */
  target_chat_id: string;
  
  /** Required - Source chat IDs to merge */
  source_chat_ids: string[];
}

export interface ChatConsolidationResult {
  /** Whether the operation succeeded */
  success: boolean;
  
  /** Target chat ID that received the merged messages */
  target_chat_id: string;
  
  /** Source chat IDs that were merged */
  source_chat_ids: string[];
  
  /** Total number of messages merged */
  merged_count: number;
  
  /** Error message if consolidation failed */
  error?: string;
}

export interface ConsolidationError {
  /** Type of error */
  type: 'invalid_target' | 'invalid_source' | 'permission_denied' | 'unknown';
  
  /** Error message */
  message: string;
  
  /** Which chat(s) had issues */
  affected_chat_ids?: string[];
}

/**
 * Validation rules for chat consolidation
 */
export const CHAT_CONSOLIDATION_RULES = {
  MIN_SOURCE_CHATS: 1,
  MAX_SOURCE_CHATS: 5, // In line with AC7
  MAX_MESSAGES_PER_SOURCE: 100, // In line with AC7
  MIN_TARGET_CHAT_ID_LENGTH: 5,
  SOURCE_CHAT_PREFIX: 'chat_',
} as const;

/**
 * Permission levels for chat operations
 */
export enum ChatPermission {
  READ = 'read',
  WRITE = 'write',
  MANAGE = 'manage',
}

/**
 * Chat invitation types
 */
export enum ChatInviteType {
  COLLABORATOR = 'collaborator',
  ADMIN = 'admin',
  GUEST = 'guest',
}