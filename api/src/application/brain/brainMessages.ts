/**
 * Brain transcript use cases — read (tail or forward cursor), mark-read, append,
 * the cloud-execution progress post, and thumbs feedback. Split out of
 * `BrainService.ts`; the write path itself is `brainMessageStore.appendRaw`.
 */

import { eq, and, asc, desc, gt } from 'drizzle-orm';
import { brainChats, brainChatMessages } from '../../infrastructure/database/schema';
import { readTimelineTail } from '../../domain/shared/timelineTail';
import { recordActionRating } from '../llm/actionRatings';
import { resolveTenantPlan } from '../tenant/tenantPlanSnapshot';
import { markChatRead } from './chatReadState';
import { messageColumns, type AppendMessagesDto, type MessageFeedback } from './brainChatShapes';
import { canAccessChat, ensureMembership } from './brainChatGuards';
import { appendRaw } from './brainMessageStore';
import { mergeSteps } from './chatStepStore';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { bumpChatMessages } from './chatCacheVersions';

/** A chat's transcript: the MOST RECENT `limit` messages, oldest-first.
 *  The window is the tail, not the head — see {@link readTimelineTail} for why
 *  that distinction is what makes a reopened chat still show its last reply.
 *  `afterSeq` is a forward cursor for pollers: only rows with a greater seq,
 *  oldest-first from the cursor (the HEAD after it, so paging forward leaves no gap). */
export async function getMessages(db: Db, chatId: number, tenantId: number, userId: string, limit = 100, afterSeq?: number | null) {
  const chat = await canAccessChat(db, chatId, tenantId, userId);
  if (!chat) return { error: 'Chat not found' as const };

  if (afterSeq != null) {
    return db
      .select(messageColumns)
      .from(brainChatMessages)
      .where(and(eq(brainChatMessages.chatId, chatId), gt(brainChatMessages.seq, afterSeq)))
      .orderBy(asc(brainChatMessages.seq))
      .limit(Math.min(Math.max(1, limit), 500));
  }

  // The forward cursor above stays conversation-only: a step carries `seq: 0`, so it can
  // never move a poller's cursor, and pollers do not render steps. The tail is the
  // transcript a reader opens, so it gets the run's steps back from their own store.
  let asked = 0;
  const tail = await readTimelineTail(
    (rows) => {
      asked = rows;
      return db
        .select(messageColumns)
        .from(brainChatMessages)
        .where(eq(brainChatMessages.chatId, chatId))
        .orderBy(desc(brainChatMessages.seq))
        .limit(rows);
    },
    limit,
    500,
  );
  return mergeSteps(db, chatId, tail, tail.length >= asked);
}

/** Advance the caller's read high-water mark for a chat (unread-badge state).
 *  Access-checked, then delegates to the shared {@link markChatRead} rule.
 *  `seq` omitted → mark everything read. Returns the seq actually stored. */
export async function markRead(db: Db, chatId: number, tenantId: number, userId: string, seq?: number | null) {
  const chat = await canAccessChat(db, chatId, tenantId, userId);
  if (!chat) return { error: 'Chat not found' as const };
  const lastReadSeq = await markChatRead(db, tenantId, userId, chatId, seq);
  return { lastReadSeq };
}

export async function appendMessages(
  db: Db,
  chatId: number,
  tenantId: number,
  userId: string,
  dto: AppendMessagesDto,
) {
  // Owner, member, or (for shared chats) any teammate may post — migration 0288.
  const chat = await canAccessChat(db, chatId, tenantId, userId);
  if (!chat) return { error: 'Chat not found' as const };

  if (!Array.isArray(dto.messages) || dto.messages.length === 0) {
    return { error: 'messages array is required' as const };
  }

  // Contributing to a shared chat joins you to it (records the live audience).
  // Best-effort and independent of the message write, so the two run together.
  const [, written] = await Promise.all([
    ensureMembership(db, chatId, tenantId, userId, (chat as unknown as { ownerId: string | null }).ownerId),
    appendRaw(db, chatId, dto.messages),
  ]);
  return written;
}

/**
 * Post a progress/result update from a cloud execution into the Brain chat that
 * launched it. The execution payload supplies the chat id; callers may not choose
 * an unrelated chat. Tenant scope and archive state are still checked here at the
 * write boundary, and attribution remains machine-readable in message metadata.
 */
export async function postExecutionUpdate(
  db: Db,
  chatId: number,
  tenantId: number,
  input: { agentRef: string; agentName?: string; content: string },
) {
  const [chat] = await db
    .select({ id: brainChats.id })
    .from(brainChats)
    .where(and(
      eq(brainChats.id, chatId),
      eq(brainChats.tenantId, tenantId),
      eq(brainChats.isArchived, false),
    ))
    .limit(1);
  if (!chat) return { error: 'Originating Brain chat not found' as const };

  const content = input.content.trim();
  if (!content) return { error: 'content is required' as const };
  const agentName = input.agentName?.trim() || 'BuilderForce Agent';
  const metadata = JSON.stringify({
    authoredBy: { kind: 'agent', ref: input.agentRef, name: agentName },
    via: 'cloud-execution',
  });
  const [message] = await appendRaw(db, chatId, [{ role: 'assistant', content, metadata }]);
  return { chatId, message };
}

/**
 * Record a thumbs up/down on one assistant reply.
 *
 * TWO writes, deliberately, from ONE click:
 *   1. `metadata.feedback` on the message — the UI's own state, so re-opening the
 *      chat shows the thumb the user pressed. Unchanged behaviour.
 *   2. A durable `llm_action_ratings` row (migration 0468) joining that verdict to
 *      the MODEL that earned it and the MCP tool the turn executed.
 *
 * (2) is what was missing. The thumbs have existed for a long time and every press
 * went only into (1) — a JSON blob, unindexed, with no model attribution — so the
 * platform collected its most direct quality signal and could never answer the
 * question the signal exists for. The model comes off the reply's own provenance
 * metadata, so it is the id the gateway actually resolved, never a guess.
 *
 * The rating write is best-effort inside `recordActionRating`; a telemetry failure
 * must not fail the click.
 */
export async function setMessageFeedback(
  db: Db,
  env: Env,
  messageId: number,
  tenantId: number,
  userId: string,
  feedback: MessageFeedback,
  /** What the client knows about the rated turn that the row does not: which MCP
   *  tool ran, and the action bucket. Both optional — a prose-only reply has no
   *  tool, and "it answered badly" is still a rateable outcome. */
  context?: { toolName?: string | null; actionType?: string | null },
) {
  // Find the message and verify ownership through its chat
  const [msg] = await db
    .select({
      id: brainChatMessages.id,
      chatId: brainChatMessages.chatId,
      metadata: brainChatMessages.metadata,
    })
    .from(brainChatMessages)
    .where(eq(brainChatMessages.id, messageId));
  if (!msg) return { error: 'Message not found' as const };

  // Verify access to the parent chat (owner or member). The chat's project scopes
  // the rating so project-level routing learns from it.
  const chat = await canAccessChat(db, msg.chatId, tenantId, userId, { projectId: brainChats.projectId });
  if (!chat) return { error: 'Message not found' as const };

  // Merge feedback into existing metadata JSON
  const existing = msg.metadata ? JSON.parse(msg.metadata) : {};
  existing.feedback = feedback;

  const [updated] = await db
    .update(brainChatMessages)
    .set({ metadata: JSON.stringify(existing) })
    .where(eq(brainChatMessages.id, messageId))
    .returning(messageColumns);
  if (!updated) return { error: 'Update failed' as const };
  await bumpChatMessages(msg.chatId, env);

  // The model that actually served this reply, as persisted by the streaming path
  // (see brain-embedded/provenance.ts). Absent on pre-provenance turns — those
  // carry no attribution, so rating them would invent evidence for a model that
  // may never have run, and the row is skipped.
  const model = typeof existing?.provenance?.model === 'string' ? existing.provenance.model : '';
  const plan = await resolveTenantPlan(env, tenantId).then((p) => p.effectivePlan).catch(() => 'free' as const);
  if (model || feedback === null) {
    await recordActionRating(env, db, { tenantId, userId, plan }, {
      surface: 'brain',
      subjectKind: 'turn',
      subjectRef: `brain_message:${messageId}`,
      resolvedModel: model,
      toolName: context?.toolName ?? null,
      actionType: context?.actionType ?? undefined,
      projectId: (chat as { projectId?: number | null }).projectId ?? null,
      rating: feedback === 'up' ? 1 : feedback === 'down' ? -1 : 0,
    });
  }

  return updated;
}
