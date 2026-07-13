/**
 * Platform Chat Utilities
 *
 * Built-in platform functions for Brain chat consolidation.
 * Implements: builtin_brain_list_sessions, builtin_brain_get_messages, builtin_chats_consolidate
 */

// ----------------------------------------------------------------------
// Chat Session Types
// ----------------------------------------------------------------------

/** Cursor returned by backward cursor pagination */
export interface BackwardCursor {
  /** Position in the session stream */
  position: number;
}

/** Cursor returned by forward cursor pagination */
export interface ForwardCursor {
  /** Position in the session stream */
  position: number;
}

export type ChatCursor = BackwardCursor | ForwardCursor;

/** Human or system participant */
export type ChatParticipantRole = 'human' | 'system' | 'agent' | 'external_service' | 'team_chat' | 'pm_chat' | 'agent_host';

/** Participant identity */
export type ChatParticipantId = string;

export interface ChatParticipant {
  id?: ChatParticipantId;
  role: ChatParticipantRole;
  name: string;
  avatar?: string;
}

/** Brain session metadata */
export interface BrainSession {
  /** Session identifier */
  id: string;
  /** Creation timestamp */
  createdAt: string;
  /** When the session was last updated */
  updatedAt: string;
  /** Human-readable title/ticket ref if derived from a task */
  title?: string;
  /** Human-readable description if derived from a PRD or similar */
  description?: string;
  /** Type of session (implied by organizational type) - pm_chat, epic, feature, user_chat, admin */
  type?: 'pm_chat' | 'epic' | 'feature' | 'user_chat' | 'admin';
  /** comma-separated tags reflecting the parent context */
  tags?: string[];
  /** Number of messages in the stream (offline analytics) */
  messageCount?: number;
  /** Time of earliest message */
  firstMessageAt?: string;
  /** Time of most recent message */
  lastMessageAt: string;
  /** Snowflake ID of parent ticket/PRD/Epic referenced */
  parentId?: string;
  /** opaque reference used for stack and persistence, e.g. brain-session-12345 */
  sessionRef: string;
  /** Participant information (reserved for future use) */
  participant?: ChatParticipant;
}

export interface BrainSessionWithCursor extends BrainSession {
  /** Cursor for either direction when enabled */
  cursor?: ChatCursor;
}

// ----------------------------------------------------------------------
// Chat Message Types
// ----------------------------------------------------------------------

export enum ChatMessageRole {
  User = 'user',
  System = 'system',
  Agent = 'agent',
  Assistant = 'assistant',
}

/** Transcript entry representing one message in brain session messages */
export interface ChatMessage {
  id: string;
  sessionId: string;
  sequence: number;
  role: ChatMessageRole;
  content: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
  /**
   * Optional branchId to support reopen/retrace semantics. If branchId is provided, this message is a revision
   * and the branch history can be replayed to restore an earlier conversation state.
   */
  branchId?: string;
  /** Viewer-friendly key from message.key to help tools call constructors. */
  viewer_key: string;
}

export interface ChatParticipantMessage extends ChatMessage {
  participant: ChatParticipant;
}

// ----------------------------------------------------------------------
// Consolidation Types
// ----------------------------------------------------------------------

/** Source selection for consolidation */
export interface ChatSourceFilter {
  /** Comma-separated list of session refs to unite */
  sourceSessions: string[];
  /** optional updater if known or can be derived from current call options */
  assignedUserId?: string;
}

/** Consolidation result */
export interface ConsolidationReport {
  targetSessionId: string;
  sourceSessionIds: string[];
  totalMessagesMerged: number;
  itemsMerged: Array<{ source: string; inserted: number; notes?: string }>;
  timestamp: string;
}

/** Conversation collation errors */
export interface ConsolidationError {
  targetSessionId: string;
  error: string;
  details?: unknown;
}

export interface ConsolidationResult {
  success: boolean;
  report?: ConsolidationReport;
  errors: ConsolidationError[];
  timestamp: string;
  warningMessage?: string;
}

interface ConsolidationOptions {
  /** Whether to skip existing with branchId and re-sequence; defaults to false (use strict uniqueness) */
  skipReopen?: boolean;
  /** whether to preserve branchId on merged messages; defaults to true for rollback support */
  preserveBranchId?: boolean;
  /** extra notes to attach to the consolidatedAt note */
  notes?: string;
}

/** Merge fidelity options */
export type MergeFidelity = 'strict' | 'lax';

export interface MergeDetail {
  branchId: string;
  targetBranchId: string;
  operation: 'inserted' | 'updated' | 'skipped';
}

/** Message-to-msg alignment mapping */
export interface MessageMap {
  branchId: string;
  sourceRef: string;
  insertedAtIndex: number;
  alignment?: Array<{ srcBranchId: string; alignmentSource: string }>;
}

// ----------------------------------------------------------------------
// Platform Functions (simulated/mocked for task placeholder)
// ----------------------------------------------------------------------

/**
 * List Brain sessions for a tenant.
 * Supports backward lightweight cursor pagination (position records).
 * Returns 0 matches when truncated sets truncation flag (and never matches).
 */
export async function builtin_brain_list_sessions(
  projectId: number,
  options?: {
    /** Filter sessions by sessionRef matching 'brain:' prefix; case-insensitive */
    topic?: string;
    /** Filter sessions by type (pm_chat, epic, feature, user_chat, admin) */
    type?: (BrainSession['type'])[];
    /** Number of sessions per page; max 200 */
    limit?: number;
    /** Forward or backward cursor; false for backward; true for forward */
    forward?: false;
    /** False defaults backward; required when forward is present */
    forward?: boolean;
  }
): Promise<BrainSessionWithCursor[]> {
  // Placeholder for platform invocation; normally calls a unified T-SQL endpoint.
  throw new Error('Not implemented. Requires platform integration (table based).');
}

/**
 * Get session messages for a sessionRef or sessionId.
 */
export async function builtin_brain_get_messages(
  projectId: number,
  sessionId: string | { ref: string; id?: string },
  options?: {
    /** Maximum number of messages to return per page */
    limit?: number;
  }
): Promise<ChatMessage[]> {
  // Placeholder for platform invocation; normally calls a unified T-SQL endpoint.
  throw new Error('Not implemented. Requires platform integration (table based).');
}

/**
 * Consolidate source chats into a target chat using T-SQL native semantics.
 * Validated against the initializer's assigned transaction.
 */
export async function builtin_chats_consolidate(
  gameId: string,
  params: {
    /** Session identifier of the target (site/ticket/PRD) */
    targetSessionId: string;
    /** Session identifiers of sources to merge into the target */
    sourceChatIds: string[];
    /** optional updater if known or can be derived */
    assignedUserId?: string;
  },
  options?: ConsolidationOptions
): Promise<ConsolidationResult> {
  // Placeholder for platform invocation; normally calls a unified T-SQL endpoint.
  throw new Error('Not implemented. Requires platform integration (table based).');
}