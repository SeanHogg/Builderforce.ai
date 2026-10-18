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
  /** The user's first prompt, when the creator already has it (1245) — Rovr creates the
   *  chat from its local outbox replay, so its first prompt can ride the create instead of
   *  costing a second PATCH. Same write-once rule as `UpdateChatDto`. */
  originalRequest?: string | null;
  projectId?: number | null;
  capability?: string | null;
  /** Conversation (`chat`) or execution (`work`) — migration 0409. Omitted/invalid
   *  opens in {@link NEW_CHAT_MODE}. */
  mode?: string | null;
}

export interface UpdateChatDto {
  title?: string;
  /** The chat's ORIGINAL request (1245) — the user's first prompt, as asked. Set ONCE by
   *  the first-turn seam; there is no reason for a client to rewrite it, so a host that
   *  has already captured one is free to leave it alone by omitting this. See `updateChat`:
   *  only a NON-blank value moves the column, so a `null`/blank sent by accident is a
   *  no-op rather than the erasure of a captured request. */
  originalRequest?: string | null;
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

/**
 * Clamp an inbound ORIGINAL REQUEST (1245) to what the column can hold and what is worth
 * storing. Deliberately NOT `normalizeChatTitle`'s rule: the title is a display summary
 * with a 500-char budget, whereas this is the user's prompt as asked — so it keeps its
 * wording and newlines, only collapses the whitespace a copy/paste drags in, and falls
 * back to null (NOT an empty string) when nothing usable arrived, because "no request
 * captured" and "a blank request" are the same state and the column's null says so.
 *
 * The clamp exists for the same reason the title's does: the first prompt arrives from
 * a composer with no length bound (a pasted file is megabytes), and an unbounded write
 * would be stored whole — not a 500 — so this keeps one absurd paste from bloating every
 * read of the chat.
 */
export const ORIGINAL_REQUEST_MAX_LENGTH = 2000;

export function normalizeOriginalRequest(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  // Newlines and runs of spaces are the paste artefact; the wording itself is untouched.
  const text = String(raw).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return null;
  const chars = Array.from(text);
  if (chars.length <= ORIGINAL_REQUEST_MAX_LENGTH) return text;
  // Counted in code points, so the cut never lands mid-surrogate.
  return chars.slice(0, ORIGINAL_REQUEST_MAX_LENGTH - 1).join('') + '…';
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
  /** Travels with EVERY chat read (1245) so any surface can show what the chat was
   *  actually asked for, without a second round-trip. NULL is the honest answer for a
   *  chat created before the column existed, and the hosts render nothing then. */
  originalRequest: brainChats.originalRequest,
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
