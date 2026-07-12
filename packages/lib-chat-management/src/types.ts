/**
 * Chat metadata type for the built-in Brain list API.
 */

export interface ChatMetadata {
  /** Unique identifier for the chat session */
  chatId: string;
  /** Human-readable title (auto-generated if not available) */
  title: string;
  /** Timestamp when the chat was initiated */
  createdAt: string;
  /** Timestamp of the last message in the chat */
  updatedAt: string;
  /** Number of unique participants in the chat */
  participantCount: number;
  /** Total number of messages in the chat */
  messageCount: number;
  /** Whether the chat is archived */
  isArchived: boolean;
  /** Preview of the last message (first 50 characters) */
  lastMessagePreview: string;
  /** Optional: participant IDs involved in the chat */
  participants?: string[];
  /** Optional: tags or labels (e.g., "urgent", "technical") */
  tags?: string[];
}

/**
 * Response type for builtin_brain_list endpoint.
 */
export interface BrainListResponse {
  chats: ChatMetadata[];
}

/**
 * Error types for builtin_brain_list endpoint.
 */
export class BrainListError extends Error {
  constructor(
    public message: string,
    public statusCode: number
  ) {
    super(message);
    this.name = 'BrainListError';
  }
}

export const ErrorCode = {
  INVALID_PROJECT_ID: 400,
  PROJECT_NOT_FOUND: 404,
  FORBIDDEN: 403,
  INTERNAL_ERROR: 500,
} as const;