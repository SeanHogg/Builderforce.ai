/**
 * Chat read-state — the single source of "which chats have unread messages for a
 * user". Both the mark-read endpoint (`POST /api/brain/chats/:id/read`) and the
 * cross-surface attention aggregator (`GET /api/runtime/attention`) delegate here,
 * so the unread rule lives ONCE (DRY).
 *
 * The high-water mark is `chat_read_state.last_read_seq` (per chat+user), compared
 * against `brain_chat_messages.seq` (monotonic — each message's own PK id). A chat
 * is unread when it holds a message with `seq > last_read_seq`. A read-state row is
 * created the first time a user opens a chat (marks it read), so a never-opened
 * shared chat is "new", NOT "unread" — unread accrues only on conversations the
 * user has actually read, which is what a badge should mean.
 */
import { and, eq, sql } from 'drizzle-orm';
import { brainChats, brainChatMessages, chatReadState } from '../../infrastructure/database/schema';
import type { Db } from '../../infrastructure/database/connection';

/**
 * Advance a user's read high-water mark for one chat. Idempotent and monotonic:
 * `last_read_seq` only ever moves FORWARD (GREATEST), so an out-of-order mark from
 * a slow request can't un-read newer messages. When `seq` is omitted it snaps to
 * the chat's current max message seq (mark everything read). No-ops when the chat
 * has no messages yet. Access must be checked by the caller.
 */
export async function markChatRead(
  db: Db, tenantId: number, userId: string, chatId: number, seq?: number | null,
): Promise<number> {
  let target = seq ?? null;
  if (target == null) {
    const [row] = await db
      .select({ maxSeq: sql<number>`coalesce(max(${brainChatMessages.seq}), 0)` })
      .from(brainChatMessages)
      .where(eq(brainChatMessages.chatId, chatId));
    target = Number(row?.maxSeq ?? 0);
  }
  await db
    .insert(chatReadState)
    .values({ chatId, userId, tenantId, lastReadSeq: target, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: [chatReadState.chatId, chatReadState.userId],
      // GREATEST so a stale/racing lower mark never rewinds the pointer.
      set: {
        lastReadSeq: sql`greatest(${chatReadState.lastReadSeq}, excluded.last_read_seq)`,
        updatedAt: new Date(),
      },
    });
  return target;
}

/**
 * Per-chat unread COUNT for every chat the user has read (has a read-state row)
 * that now holds newer messages. ONE grouped query joining read-state → messages →
 * chats (bounded by the number of chats the user has opened; no N+1). Archived
 * chats are excluded. Only chats with ≥1 unread message appear in the map.
 *
 * Not cached: unread is per-user live state that changes on every inbound message,
 * and it rides the already-uncached attention aggregator (same rationale as the
 * rest of that endpoint) — a bounded, indexed grouped read.
 */
export async function unreadCountsForUser(
  db: Db, tenantId: number, userId: string,
): Promise<Record<number, number>> {
  const rows = await db
    .select({
      chatId: brainChatMessages.chatId,
      unread: sql<number>`count(*)`,
    })
    .from(chatReadState)
    .innerJoin(brainChatMessages, and(
      eq(brainChatMessages.chatId, chatReadState.chatId),
      sql`${brainChatMessages.seq} > ${chatReadState.lastReadSeq}`,
    ))
    .innerJoin(brainChats, and(
      eq(brainChats.id, chatReadState.chatId),
      eq(brainChats.isArchived, false),
    ))
    .where(and(eq(chatReadState.tenantId, tenantId), eq(chatReadState.userId, userId)))
    .groupBy(brainChatMessages.chatId);

  const out: Record<number, number> = {};
  for (const r of rows) {
    const n = Number(r.unread);
    if (n > 0) out[r.chatId] = n;
  }
  return out;
}
