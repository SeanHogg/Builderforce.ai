/**
 * chatConsolidation — merge one or more source Brain chats INTO a target chat.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { brainChats, brainChatMessages, chatTicketLinks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { resolveSegment } from '../../infrastructure/auth/segmentResolver';
import { ADVISORY_THREAD_AI_CONTEXT_ERROR, advisoryThreadHistoryAdmitted } from '../commerce/advisoryReservation';
import { bumpExecutionState } from '../runtime/executionStateVersion';
import { CHAT_SCOPE } from './chatAgents';
import { bumpChatMessages, bumpChatStructure, bumpUnreadForChatAudience } from './chatCacheVersions';
import { accessibleChat, type ChatTicketDeps } from './chatTicketAccess';
import { copySteps } from './chatStepStore';

export interface ConsolidateResult {
  targetChatId: number;
  mergedChats: number;
  messagesMoved: number;
  linksMoved: number;
}

/** Messages per insert — 6 bound columns each, well under Postgres's 65,535. */
const CONSOLIDATE_INSERT_CHUNK = 2000;

/**
 * Merge source chats into a target: source messages are appended to the target
 * in chronological order, their ticket links + agent invites move to the target,
 * then each source is archived and stamped with merged_into_chat_id so the
 * lineage survives and any ticket resolves to the one surviving conversation.
 */
export async function consolidateChats(
  deps: ChatTicketDeps,
  tenantId: number, userId: string | null,
  input: { targetChatId: number; sourceChatIds: number[] },
): Promise<{ error: string } | ConsolidateResult> {
  const { db, env, assignments } = deps;
  const target = await accessibleChat(db, input.targetChatId, tenantId, userId);
  if (!target) return { error: 'Target chat not found' };
  const sources = [...new Set(input.sourceChatIds)].filter((id) => id !== input.targetChatId);
  if (sources.length === 0) return { error: 'No source chats to merge' };

  // Verify every source belongs to the tenant/user before mutating anything.
  // The checks are independent reads, so they run together; the first missing
  // source (in input order) is still the one reported.
  const owned = await Promise.all(sources.map((sid) => accessibleChat(db, sid, tenantId, userId)));
  const missing = sources.find((_, i) => !owned[i]);
  if (missing != null) return { error: `Source chat ${missing} not found` };

  // Gather source messages, ordered chronologically across all sources.
  const srcMsgs = await db
    .select({ chatId: brainChatMessages.chatId, role: brainChatMessages.role, content: brainChatMessages.content, metadata: brainChatMessages.metadata, eventKey: brainChatMessages.eventKey, createdAt: brainChatMessages.createdAt, seq: brainChatMessages.seq })
    .from(brainChatMessages)
    .where(inArray(brainChatMessages.chatId, sources))
    .orderBy(brainChatMessages.createdAt, brainChatMessages.seq);

  // A sealed advisory thread must not be copied into another chat — that chat
  // would then quote it into aiContext. Refuse before any write.
  const byChat = new Map<number, typeof srcMsgs>();
  for (const row of srcMsgs) {
    const list = byChat.get(row.chatId) ?? [];
    list.push(row);
    byChat.set(row.chatId, list);
  }
  for (const rows of byChat.values()) {
    if (!advisoryThreadHistoryAdmitted(rows)) return { error: ADVISORY_THREAD_AI_CONTEXT_ERROR };
  }

  // Multi-row inserts, chunked under Postgres's bind-parameter limit. seq BECOMES the
  // generated id inside the INSERT (migration 1233's trigger). The VALUES keep
  // chronological order, so the ids (and seq) still ascend with it. Each message keeps
  // its time: the copied steps keep theirs, and the transcript read interleaves the two
  // by time (a consolidation-time stamp put every step ahead of the conversation).
  let messagesMoved = 0;
  for (let i = 0; i < srcMsgs.length; i += CONSOLIDATE_INSERT_CHUNK) {
    const inserted = await db.insert(brainChatMessages).values(srcMsgs.slice(i, i + CONSOLIDATE_INSERT_CHUNK).map((m) => ({
      chatId: input.targetChatId, role: m.role, content: m.content,
      metadata: m.metadata, eventKey: m.eventKey, createdAt: m.createdAt,
    }))).onConflictDoNothing().returning({ id: brainChatMessages.id });
    messagesMoved += inserted.length;
  }
  // The sources' run steps live in their own store; they follow the conversation.
  messagesMoved += await copySteps(db, tenantId, sources, input.targetChatId);

  // Move ticket links to the target (skip ones already present on the target).
  const [srcLinks, targetLinksRows, seg] = await Promise.all([
    db.select().from(chatTicketLinks)
      .where(and(eq(chatTicketLinks.tenantId, tenantId), inArray(chatTicketLinks.chatId, sources))),
    db.select({ kind: chatTicketLinks.ticketKind, ref: chatTicketLinks.ticketRef }).from(chatTicketLinks).where(scopedToTenant(chatTicketLinks, tenantId, eq(chatTicketLinks.chatId, input.targetChatId))),
    resolveSegment(db, tenantId),
  ]);
  const targetHas = new Set(targetLinksRows.map((l) => `${l.kind}:${l.ref}`));
  const newLinks: Array<typeof chatTicketLinks.$inferInsert> = [];
  for (const l of srcLinks) {
    if (targetHas.has(`${l.ticketKind}:${l.ticketRef}`)) continue;
    newLinks.push({
      tenantId, segmentId: seg, chatId: input.targetChatId, ticketKind: l.ticketKind, ticketRef: l.ticketRef,
      linkType: l.linkType, createdBy: l.createdBy,
    });
    targetHas.add(`${l.ticketKind}:${l.ticketRef}`);
  }
  // One multi-row insert for every moved link, not one per link.
  if (newLinks.length > 0) await db.insert(chatTicketLinks).values(newLinks);
  const linksMoved = newLinks.length;
  // Drop the source links (their chats are about to be archived/redirected).
  await db.delete(chatTicketLinks).where(and(eq(chatTicketLinks.tenantId, tenantId), inArray(chatTicketLinks.chatId, sources)));

  // Re-point any chat-scoped agent invites from the sources onto the target.
  for (const sid of sources) {
    const invites = await assignments.list(tenantId, CHAT_SCOPE, String(sid));
    for (const inv of invites) {
      await assignments.assign(tenantId, { agentKind: inv.agentKind, agentRef: inv.agentRef, scope: CHAT_SCOPE, scopeId: String(input.targetChatId), role: inv.role });
      await assignments.unassign(tenantId, inv.id, { scope: CHAT_SCOPE, scopeId: String(sid) });
    }
  }

  // Archive + redirect each source; touch the target.
  await db.update(brainChats)
    .set({ isArchived: true, mergedIntoChatId: input.targetChatId, updatedAt: new Date() })
    .where(and(eq(brainChats.tenantId, tenantId), inArray(brainChats.id, sources)));
  await db.update(brainChats).set({ updatedAt: new Date() }).where(scopedToTenant(brainChats, tenantId, eq(brainChats.id, input.targetChatId)));

  await Promise.all([
    bumpChatMessages(input.targetChatId, env),
    bumpUnreadForChatAudience(db, tenantId, input.targetChatId, env),
    ...sources.map((id) => bumpUnreadForChatAudience(db, tenantId, id, env)),
    bumpExecutionState(env, tenantId),
    ...[input.targetChatId, ...sources].map((id) => bumpChatStructure(id, env)),
  ]);
  return { targetChatId: input.targetChatId, mergedChats: sources.length, messagesMoved, linksMoved };
}
