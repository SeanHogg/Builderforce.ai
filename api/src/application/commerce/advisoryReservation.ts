/**
 * A1 — the advisory THREAD's admission to aiContext.
 *
 * A confirmed 1:1 reservation against a bound advisor becomes a meeting, a
 * calendar event and a `restricted` Brain thread in the SERVICE tenant (the
 * advisor's workspace) — planned in `advisorySessionPlan.ts`, written in
 * `advisoryProvisioning.ts`. This module owns what happens to the thread after:
 *
 *   - it is absent from `aiContext` until the founder explicitly invites the
 *     advisor ({@link inviteAdvisorToAdvisoryThread});
 *   - every transcript path asks {@link advisoryChatAdmittedToAiContext} first.
 *
 * Admission is asked of `boundaryAdmits` — this module does not invent a second
 * confidentiality model.
 *
 * THE FOUNDER IS IN ANOTHER TENANT. The thread lives in the advisor's tenant and
 * is owned by the founder (`brain_chats.user_id`), whose active tenant is their
 * own workspace. The invite therefore reads the chat by id + owner as a DECLARED
 * cross-tenant read (`acrossTenants(…, 'subject_own_rows', …)`): a person acting
 * on a row they own. Every later write is scoped to the THREAD's tenant.
 */
import { and, asc, eq } from 'drizzle-orm';
import {
  ADVISORY_THREAD_CONFIDENTIALITY,
  advisoryThreadHistoryAdmitted,
  encodeAdvisoryThreadMarker,
  readAdvisoryThreadState,
  type AdvisoryThreadState,
} from '@builderforce/creation-canvas-contract';

export {
  ADVISORY_THREAD_AI_CONTEXT_ERROR,
  ADVISORY_THREAD_CONFIDENTIALITY,
  ADVISORY_THREAD_MARKER,
  advisoryThreadAdmitted,
  advisoryThreadConfidentiality,
  advisoryThreadHistoryAdmitted,
  advisoryThreadInAiContext,
  advisoryThreadMarkerFields,
  encodeAdvisoryThreadMarker,
  readAdvisoryThreadState,
  sealedAdvisoryThread,
  type AdvisoryThreadState,
} from '@builderforce/creation-canvas-contract';
import type { Db } from '../../infrastructure/database/connection';
import { brainChatMessages, brainChats, chatMembers } from '../../infrastructure/database/schema';
import { acrossTenants, scopedToTenant } from '../../infrastructure/database/tenantScope';
import { getOrSetCached, invalidateCached, type CacheEnv } from '../../infrastructure/cache/readThroughCache';
import { reportCaughtError } from '../observability/caughtErrorReporter';

const SOURCE = 'application/commerce/advisoryReservation.ts';

/** The one cache key for a chat's aiContext admission. */
export const advisoryAdmissionCacheKey = (chatId: number): string => `advisory-admitted:chat:${chatId}`;

function markerExtra(metadata: string | null): Record<string, unknown> {
  if (!metadata) return {};
  try {
    const raw = JSON.parse(metadata) as Record<string, unknown>;
    const rest = { ...raw };
    delete rest.marker;
    delete rest.confidentiality;
    delete rest.founderInvitedAdvisor;
    delete rest.hostRef;
    return rest;
  } catch (error) {
    // A marker row whose metadata is not JSON carries no extra fields to keep.
    reportCaughtError(error, { source: SOURCE, operation: 'markerExtra' });
    return {};
  }
}

export type AdvisorInviteResult = (AdvisoryThreadState & { tenantId: number }) | { error: string };

/**
 * The only act that admits the thread to aiContext. Does not lower the stored
 * confidentiality, does not copy the thread into another tenant, and refuses
 * an invite for anyone other than the bound advisor.
 *
 * Looks the chat up by id AND owner (the caller), across tenants — the thread is
 * in the advisor's tenant, never the founder's active one.
 */
export async function inviteAdvisorToAdvisoryThread(
  db: Db,
  env: CacheEnv,
  chatId: number,
  founderUserId: string,
  advisorUserId: string,
): Promise<AdvisorInviteResult> {
  if (!founderUserId || !advisorUserId || founderUserId === advisorUserId) {
    return { error: 'Only the founder can invite the advisor' };
  }
  const [chat] = await db
    .select({ id: brainChats.id, tenantId: brainChats.tenantId })
    .from(brainChats)
    .where(acrossTenants(brainChats, 'subject_own_rows', eq(brainChats.id, chatId), eq(brainChats.userId, founderUserId)))
    .limit(1);
  if (!chat) return { error: 'Only the founder can invite the advisor' };
  const tenantId = chat.tenantId;

  const rows = await db
    .select({ id: brainChatMessages.id, metadata: brainChatMessages.metadata })
    .from(brainChatMessages)
    .where(and(eq(brainChatMessages.chatId, chatId), eq(brainChatMessages.role, 'system')));
  const marker = rows
    .map((row) => ({ id: row.id, metadata: row.metadata, state: readAdvisoryThreadState(row.metadata) }))
    .find((row) => row.state);
  if (!marker?.state) return { error: 'Not an advisory thread' };
  if (marker.state.hostRef !== advisorUserId) return { error: 'That person is not the advisor on this thread' };

  const [member] = await db
    .select({ id: chatMembers.id })
    .from(chatMembers)
    .where(scopedToTenant(
      chatMembers,
      tenantId,
      eq(chatMembers.chatId, chatId),
      eq(chatMembers.userId, advisorUserId),
    ))
    .limit(1);
  if (!member) {
    try {
      await db.insert(chatMembers).values({
        chatId,
        tenantId,
        userId: advisorUserId,
        status: 'active',
        invitedBy: founderUserId,
        role: 'participant',
      });
    } catch (error) {
      reportCaughtError(error, { source: SOURCE, operation: 'inviteAdvisorToAdvisoryThread' });
      return { error: 'Advisor could not be invited' };
    }
  }

  const next: AdvisoryThreadState = {
    confidentiality: ADVISORY_THREAD_CONFIDENTIALITY,
    founderInvitedAdvisor: true,
    hostRef: marker.state.hostRef,
  };
  await db.update(brainChatMessages).set({
    metadata: encodeAdvisoryThreadMarker(next, markerExtra(marker.metadata)),
  }).where(eq(brainChatMessages.id, marker.id));
  await invalidateCached(env, advisoryAdmissionCacheKey(chatId));
  return { ...next, tenantId };
}

/**
 * May this chat's transcript cross aiContext?
 *
 * Reads the opening system-message marker directly, not the tail window a
 * transcript loader returns — a long chat must not age the marker out of the
 * window and then quote the thread. No marker → unchanged.
 *
 * Cached per chat (every agentReply / recall / chat-ticket read asks it); the
 * founder's invite is the only write that changes the answer and invalidates it.
 */
export async function advisoryChatAdmittedToAiContext(db: Db, chatId: number, env: CacheEnv): Promise<boolean> {
  return getOrSetCached(env, advisoryAdmissionCacheKey(chatId), async () => {
    const rows = await db
      .select({ metadata: brainChatMessages.metadata })
      .from(brainChatMessages)
      .where(and(eq(brainChatMessages.chatId, chatId), eq(brainChatMessages.role, 'system')))
      .orderBy(asc(brainChatMessages.seq))
      .limit(8);
    return advisoryThreadHistoryAdmitted(rows);
  });
}
