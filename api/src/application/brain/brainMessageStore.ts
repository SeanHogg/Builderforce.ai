/**
 * The ONE Brain transcript write path — seq-managed, idempotent batch append.
 * Split out of `BrainService.ts`; shared by user appends, agent replies, step rows,
 * team-chat posts and execution updates.
 */

import { eq, and, inArray, isNotNull, sql } from 'drizzle-orm';
import { brainChats, brainChatMessages } from '../../infrastructure/database/schema';
import { reconcileKeyedBatch, unwrittenKeys } from '../../domain/shared/keyedBatch';
import { messageColumns, type BrainChatMessageRow } from './brainChatShapes';
import type { Db } from '../../infrastructure/database/connection';

/** Append messages to a chat (seq-managed insert + touch), NO access check —
 *  callers must have already verified access. Shared by `appendMessages`
 *  and `agentReply` so the write path lives once. */
export async function appendRaw(
  db: Db,
  chatId: number,
  messages: Array<{ role: string; content: string; metadata?: string | null; eventKey?: string | null }>,
) {
  const valid = messages.filter((m) => m.role && typeof m.content === 'string');
  if (valid.length === 0) return [];

  // ONE insert for the whole batch, not one per message. This used to be two
  // round-trips per turn in a loop, which is invisible on a 2-message append and
  // becomes 400 queries when a shared guest room's transcript is claimed into an
  // account in a single call.
  //
  // `onConflictDoNothing` on the chat's event-key index is what makes a RETRY safe.
  // A caller whose POST died in transit cannot know whether the turn committed; the
  // old answer was to drop the text rather than risk posting it twice. Re-sending
  // the same `eventKey` now lands at most once, and {@link keyedRows} hands the
  // caller the original row so a retry is indistinguishable from a first attempt.
  const rows = await db
    .insert(brainChatMessages)
    .values(valid.map((msg) => ({
      chatId,
      role: msg.role,
      content: msg.content,
      metadata: msg.metadata ?? null,
      eventKey: msg.eventKey ?? null,
    })))
    // `where` restates the index's predicate: `uq_brain_chat_messages_event` is
    // partial (`event_key IS NOT NULL`), and Postgres only matches ON CONFLICT to a
    // partial index when the statement repeats it. Without it EVERY append — keyed
    // or not — fails with "no unique or exclusion constraint matching the ON
    // CONFLICT specification", which is every chat send. `check:conflict-targets`.
    .onConflictDoNothing({
      target: [brainChatMessages.chatId, brainChatMessages.eventKey],
      where: isNotNull(brainChatMessages.eventKey),
    })
    .returning({ ...messageColumns, eventKey: brainChatMessages.eventKey });

  // The generated PK is an atomic database append order. A read-then-write
  // MAX(seq)+1 races when agents and humans append concurrently — so seq simply
  // BECOMES the id, in one statement for the batch.
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await db
      .update(brainChatMessages)
      .set({ seq: sql`${brainChatMessages.id}` })
      .where(inArray(brainChatMessages.id, ids));
  }

  // Touch updatedAt on the chat
  await db
    .update(brainChats)
    .set({ updatedAt: new Date() })
    .where(eq(brainChats.id, chatId));

  const written = rows.map((row) => ({ ...row, seq: row.id }));
  // Nothing was skipped: every message is new, so the batch IS the answer.
  if (written.length === valid.length) return written.map(({ eventKey: _k, ...row }) => row);
  return keyedRows(db, chatId, valid, written);
}

/**
 * Re-unite a partly-deduplicated batch with the rows it did not write.
 *
 * A conflicting insert returns nothing for the row it skipped, so a retried turn
 * would come back short — and the caller, reading a missing row as a failed write,
 * would be back to losing the text it was trying to save. Fetching the ORIGINAL by
 * its event key closes that: a retry answers exactly what the first attempt did.
 * The ordering rule itself is {@link reconcileKeyedBatch}; this only fetches.
 */
async function keyedRows(
  db: Db,
  chatId: number,
  requested: Array<{ eventKey?: string | null }>,
  written: Array<BrainChatMessageRow & { eventKey: string | null }>,
): Promise<BrainChatMessageRow[]> {
  const missing = unwrittenKeys(requested, written);
  const existing = missing.length === 0 ? [] : await db
    .select({ ...messageColumns, eventKey: brainChatMessages.eventKey })
    .from(brainChatMessages)
    .where(and(eq(brainChatMessages.chatId, chatId), inArray(brainChatMessages.eventKey, missing)));
  return reconcileKeyedBatch(requested, written, existing);
}
