/**
 * The ONE Brain transcript write path — seq-managed, idempotent batch append.
 * Split out of `BrainService.ts`; shared by user appends, agent replies, step rows,
 * team-chat posts and execution updates.
 */

import { eq, and, inArray, isNotNull, sql } from 'drizzle-orm';
import { brainChats, brainChatMessages } from '../../infrastructure/database/schema';
import { freshRequests, reconcileKeyedBatch, unwrittenKeys } from '../../domain/shared/keyedBatch';
import { messageColumns, type BrainChatMessageRow } from './brainChatShapes';
import type { Db } from '../../infrastructure/database/connection';
import { bumpChatMessages, bumpUnreadForChatAudience } from './chatCacheVersions';
import { isStepRow } from '@builderforce/agent-loop';
import { anchorStepSeqs, appendSteps } from './chatStepStore';

type AppendInput = { role: string; content: string; metadata?: string | null; eventKey?: string | null };

/** Append messages to a chat (seq-managed insert + touch), NO access check —
 *  callers must have already verified access. Shared by `appendMessages`
 *  and `agentReply` so the write path lives once. */
export async function appendRaw(db: Db, chatId: number, messages: AppendInput[]) {
  return (await appendRawOutcome(db, chatId, messages)).rows;
}

/** What an append did, for a caller that acts on it: the rows as answered (request order), and the requested
 *  messages that were actually WRITTEN now. A retry of a message that already committed answers its original row but
 *  is not in `written` - so the effects of a first attempt (a comment on a ticket, a ping, an agent's reply, a
 *  learning pass, an unread badge) are not run a second time. */
export interface AppendOutcome<M extends AppendInput> {
  rows: BrainChatMessageRow[];
  written: M[];
  /** The conversation rows inserted now (not steps): what a learning pass may read. */
  writtenRows: BrainChatMessageRow[];
}

/** {@link appendRaw}, reporting what was written. */
export async function appendRawOutcome<M extends AppendInput>(db: Db, chatId: number, messages: M[]): Promise<AppendOutcome<M>> {
  const valid = messages.filter((m) => m.role && typeof m.content === 'string');
  if (valid.length === 0) return { rows: [], written: [], writtenRows: [] };

  // Step rows are run telemetry and go to the operational store, not this table; the
  // rest is the conversation. The chat is touched FIRST because the steps carry its tenant.
  //
  // ONE CLOCK. The two halves land on different databases, each with its own `now()`,
  // and the transcript read interleaves them by time — so the batch is stamped here,
  // one app clock rising with the batch index, and a run's steps sort before the reply
  // sent with them instead of by whichever compute's clock ran ahead.
  const at = Date.now();
  const stamped = valid.map((m, i) => ({ ...m, createdAt: new Date(at + i) }));
  const turns = stamped.filter((m) => !isStepRow(m));
  const steps = stamped.filter((m) => isStepRow(m));
  const [touched] = await db
    .update(brainChats)
    .set({ updatedAt: new Date() })
    .where(eq(brainChats.id, chatId))
    .returning({
      tenantId: brainChats.tenantId,
      // The seq a trailing step anchors to (see anchorStepSeqs), read in the same trip.
      lastSeq: sql<number>`(SELECT COALESCE(MAX(${brainChatMessages.seq}), 0) FROM ${brainChatMessages} WHERE ${brainChatMessages.chatId} = ${chatId})`,
    });
  const [turn, stepRows] = await Promise.all([
    insertTurns(db, chatId, turns),
    touched
      ? appendSteps(db, touched.tenantId, chatId, steps.map((s) => ({ metadata: s.metadata as string, eventKey: s.eventKey ?? null, createdAt: s.createdAt })))
      : Promise.resolve([] as BrainChatMessageRow[]),
  ]);
  const turnRows = turn.rows;
  // Orphan the cached transcript reads (`chatPolledReads.ts`) and the unread maps of
  // users who have actually read this chat (tenant-wide bump kept the unread cache
  // cold in busy tenants). Only when something was written: a retry that found its
  // rows already there changed nothing a reader or an unread badge could show.
  // (A step is run telemetry that carries no effect of its own: a retried step batch at worst re-orphans a cache.)
  const wroteSomething = turn.fresh.some(Boolean) || stepRows.length > 0;
  if (wroteSomething) {
    await Promise.all([
      bumpChatMessages(chatId),
      touched ? bumpUnreadForChatAudience(db, touched.tenantId, chatId) : undefined,
    ]);
  }

  // Answer in the order asked, each half having kept its own order.
  let t = 0;
  let s = 0;
  const out: BrainChatMessageRow[] = [];
  const written: M[] = [];
  for (const m of valid) {
    const isStep = isStepRow(m);
    const fresh = isStep ? true : turn.fresh[t];
    const row = isStep ? stepRows[s++] : turnRows[t++];
    if (row) out.push(row);
    if (fresh) written.push(m);
  }
  return { rows: anchorStepSeqs(out, Number(touched?.lastSeq ?? 0)), written, writtenRows: turn.written };
}

/** The conversation half of {@link appendRaw}: one seq-managed, idempotent insert. */
async function insertTurns(
  db: Db,
  chatId: number,
  valid: Array<{ role: string; content: string; metadata?: string | null; eventKey?: string | null; createdAt: Date }>,
): Promise<{ rows: BrainChatMessageRow[]; fresh: boolean[]; written: BrainChatMessageRow[] }> {
  if (valid.length === 0) return { rows: [], fresh: [], written: [] };

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
      createdAt: msg.createdAt,
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

  // seq is the generated PK (atomic append order; MAX(seq)+1 races under concurrent
  // appends). Migration 1233's BEFORE INSERT trigger stamps it inside the INSERT, so
  // RETURNING already carries it — no follow-up UPDATE round trip.

  const written = rows;
  const stripped = written.map(({ eventKey: _k, ...row }) => row);
  const fresh = freshRequests(valid, written);
  // Nothing was skipped: every message is new, so the batch IS the answer.
  if (written.length === valid.length) return { rows: stripped, fresh, written: stripped };
  return { rows: await keyedRows(db, chatId, valid, written), fresh, written: stripped };
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
