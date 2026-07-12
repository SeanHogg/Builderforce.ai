/**
 * Message Schema — Canonical event emitted by Slack
 *
 * This is the canonical `Message` event representing outbound Slack messages.
 * The platform normalizes all outbound messages through this schema for consistency.
 *
 * @see $PRD_CANONICAL_INTEGRATIONS task #310
 */

export interface Message {
  eventId: string; // UUID v4. Unique per normalization event.
  sourceIntegration: 'SLACK';
  message: MessageItem;
  sourceRef: {
    userId: string; // Slack user ID
    channel: string; // Slack channel ID or @username for DM
    workspaceId: string; // Slack workspace/team ID
  };
  sentAt: Date | string;
  scheduledFor?: Date | string; // For scheduled messages
  // Message content
  content: MessageContent;
  // Metadata
  threadStart?: string; // Message ID (ts) of parent message in thread
  replyCount?: number; // Number of replies in thread
  friendlyChannel?: string; // Human-readable channel name (e.g., #general, @username)
  friendlyUserId?: string; // Human-readable user display name (e.g., @john)
  // Platform-assigned metadata
  linkedTicketId?: string;
  linkedIssueKey?: string;
  linkedPipelineRunId?: string;
  linkedChangeSetId?: string;
  linkedAlertId?: string;
}

export interface MessageItem {
  text: string;
  type: MessageContentType;
  blocks?: Block[]; // Block Kit formatted message
  attachments?: MessageAttachment[];
}

export type MessageContentType = 'text' | 'blocks' | 'text_blocks'; // Prefer blocks unless legacy

export interface Block {
  type: string; // e.g., 'section', 'actions', 'header', 'divider'
  text?: BlockText;
  blockId?: string;
  elements?: BlockElement[];
  accessory?: BlockElement;
  fields?: BlockText[];
}

export interface BlockText {
  type: 'plain_text' | 'mrkdwn';
  text: string;
  emoji?: boolean;
  verbatim?: boolean;
}

export interface BlockElement {
  type: 'button' | 'static_select' | 'users_select' | 'conversations_select';
  text?: BlockText;
  value?: string;
  action_id?: string;
}

export interface MessageAttachment {
  title?: string;
  text?: string;
  color?: 'good' | 'warning' | 'danger' | string;
  fallback?: string;
  actions?: AttachmentAction[];
}

export interface AttachmentAction {
  text: string;
  type: 'button';
  value?: string;
  style?: 'default' | 'primary' | 'danger';
  url?: string;
}