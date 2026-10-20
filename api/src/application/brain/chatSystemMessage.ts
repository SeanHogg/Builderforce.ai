/**
 * chatSystemMessage — append a system-authored assistant line to a Brain chat
 * (agent dispatch notices + run milestones) and tell every reader it changed.
 */
import { brainChatMessages } from '../../infrastructure/database/schema';
import { broadcastBrainChatChanged } from '../../infrastructure/relay/broadcastRoom';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { bumpChatMessages, bumpUnreadForChatAudience } from './chatCacheVersions';

/** Append a system-authored assistant line to a chat (dispatch notices + run milestones).
 *  metadata is a JSON string column (matches BrainService's JSON.stringify convention).
 *  A duplicate `eventKey` is a no-op (no bump, no broadcast). */
export async function postSystemMessage(
  db: Db,
  env: Env,
  tenantId: number,
  chatId: number,
  content: string,
  metadata?: Record<string, unknown>,
  eventKey?: string,
): Promise<void> {
  // seq is stamped from the generated PK inside the INSERT (migration 1233's trigger),
  // avoiding both the racy MAX(seq)+1 read and a follow-up UPDATE round trip.
  const [inserted] = await db.insert(brainChatMessages).values({
    chatId, role: 'assistant', content, metadata: metadata ? JSON.stringify(metadata) : null,
    eventKey: eventKey ?? null,
  }).onConflictDoNothing().returning({ id: brainChatMessages.id });
  if (!inserted) return;
  await Promise.all([bumpChatMessages(chatId, env), bumpUnreadForChatAudience(db, tenantId, chatId, env)]);
  await broadcastBrainChatChanged(env.SESSION_ROOM, tenantId, chatId);
}
