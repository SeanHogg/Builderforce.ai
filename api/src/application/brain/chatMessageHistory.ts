/**
 * chatMessageHistory — a chat's transcript for an agent that needs to "review the
 * chat history" (e.g. before deciding what to merge/consolidate).
 */
import { desc, eq } from 'drizzle-orm';
import { readTimelineTail } from '../../domain/shared/timelineTail';
import { brainChatMessages } from '../../infrastructure/database/schema';
import { ADVISORY_THREAD_AI_CONTEXT_ERROR, advisoryChatAdmittedToAiContext } from '../commerce/advisoryReservation';
import { accessibleChat, type ChatTicketDeps } from './chatTicketAccess';

/** A chat's message transcript (role/content/seq), tenant/user-scoped through
 *  the same access guard. Lets the Brain read a conversation before deciding
 *  what to merge/consolidate — the missing half of "review the chat history". */
export async function listChatMessages(
  deps: ChatTicketDeps, tenantId: number, chatId: number, userId: string | null, limit = 200,
): Promise<{ error: string } | Array<{ role: string; content: string; seq: number; createdAt: Date }>> {
  const { db, env } = deps;
  const chat = await accessibleChat(db, chatId, tenantId, userId);
  if (!chat) return { error: 'Chat not found' };
  if (!await advisoryChatAdmittedToAiContext(db, chatId, env)) {
    return { error: ADVISORY_THREAD_AI_CONTEXT_ERROR };
  }
  return readTimelineTail(
    (rows) => db
      .select({ role: brainChatMessages.role, content: brainChatMessages.content, seq: brainChatMessages.seq, createdAt: brainChatMessages.createdAt })
      .from(brainChatMessages)
      .where(eq(brainChatMessages.chatId, chatId))
      .orderBy(desc(brainChatMessages.seq))
      .limit(rows),
    limit,
    500,
  );
}
