/**
 * Brain chat DTOs and the column projections every Brain read returns. Split out
 * of `BrainService.ts` (which re-exports the public types) so the chat use-case
 * modules share one definition of each shape.
 */

import { brainChats, brainChatMessages } from '../../infrastructure/database/schema';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface CreateChatDto {
  tenantId: number;
  userId: string;
  title?: string;
  projectId?: number | null;
  capability?: string | null;
  /** Conversation (`chat`) or execution (`work`) — migration 0409. Omitted/invalid
   *  opens in {@link NEW_CHAT_MODE}. */
  mode?: string | null;
}

export interface UpdateChatDto {
  title?: string;
  /** The per-chat Memory switch (1228): recall from and write back to the project's
   *  memory. A property of the conversation, so every surface reads the same value. */
  memoryEnabled?: boolean;
  projectId?: number | null;
  /** LOCK toggle (owner only): 'shared' = teammate-visible, 'locked' = private. */
  visibility?: 'shared' | 'locked';
  /** What the chat is making (migration 0345) — a client-registry capability id,
   *  or null to clear it. See {@link normalizeCapability}. */
  capability?: string | null;
  /** Switch the conversation between `chat` and `work` (migration 0409). An
   *  unrecognised value is IGNORED (the column is left as-is) rather than silently
   *  resetting a running execution back to a conversation. */
  mode?: string | null;
  /** Archive / UN-archive the conversation. Written only when a boolean actually
   *  arrives, so a PATCH that never mentions it leaves the state as it is — which is
   *  what makes archive reversible: the one way back is `false`. */
  isArchived?: boolean;
}

/**
 * Sanitize an inbound capability id. The catalogue itself is a client-side UI
 * registry (frontend/src/lib/brain/capabilities.ts) and an id the client no longer
 * knows resolves to "no capability" on read, so the server stores it opaquely
 * rather than keeping a second copy of the list that would drift. All we enforce is
 * the column's shape: a short, plain identifier, or null.
 */
export function normalizeCapability(v: string | null | undefined): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return /^[a-z0-9_-]{1,64}$/i.test(s) ? s : null;
}

export interface AppendMessagesDto {
  messages: Array<{
    role: string;
    content: string;
    metadata?: string;
    /**
     * Producer-chosen idempotency key, unique per chat (`uq_brain_chat_messages_event`).
     * A caller that cannot tell whether its write landed — a dropped connection, a
     * retried POST — sends the SAME key again and gets the original row back instead
     * of a second copy of the turn. Optional: a message without one is always inserted.
     */
    eventKey?: string | null;
  }>;
}

/** Which team chat to resolve. A project team chat (`projectId`), a named workforce
 *  team's chat (`teamId`), or — both omitted — the tenant-wide "broader team" chat. */
export interface TeamChatScope {
  projectId?: number | null;
  teamId?: number | null;
}

// ---------------------------------------------------------------------------
// Return shapes (presentation-agnostic) — unified project chats, origin=brainstorm
// ---------------------------------------------------------------------------

export const chatColumns = {
  id: brainChats.id,
  projectId: brainChats.projectId,
  origin: brainChats.origin,
  title: brainChats.title,
  ownerId: brainChats.userId,
  visibility: brainChats.visibility,
  capability: brainChats.capability,
  mode: brainChats.mode,
  memoryEnabled: brainChats.memoryEnabled,
  /** The archive state travels with EVERY chat read. A projection without it made the
   *  list unable to tell a host that a chat is already archived, so the UI's
   *  "don't offer Archive on an archived row" guard had nothing to test and read as
   *  covered while protecting nothing. */
  isArchived: brainChats.isArchived,
  createdAt: brainChats.createdAt,
  updatedAt: brainChats.updatedAt,
} as const;

/**
 * The DETAIL read's projection — the SAME columns as {@link chatColumns}, under the
 * name the singleton/detail call sites already import. An alias, not a second
 * definition: when the two were separate objects the only difference was
 * `isArchived`, so the list and the detail could disagree about one fact. Both names
 * are kept because `brainScopedChats.ts` (and any future detail reader) reads better
 * against them.
 */
export const chatDetailColumns = chatColumns;


export const messageColumns = {
  id: brainChatMessages.id,
  role: brainChatMessages.role,
  content: brainChatMessages.content,
  metadata: brainChatMessages.metadata,
  seq: brainChatMessages.seq,
  createdAt: brainChatMessages.createdAt,
} as const;

/** One row as every transcript read returns it — {@link messageColumns} materialized. */
export interface BrainChatMessageRow {
  id: number;
  role: string;
  content: string;
  metadata: string | null;
  seq: number;
  createdAt: Date;
}

export type MessageFeedback = 'up' | 'down' | null;
