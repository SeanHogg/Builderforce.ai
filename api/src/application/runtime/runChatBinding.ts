/**
 * runChatBinding — may this caller BIND a run to a Brain chat?
 *
 * A run bound to a chat narrates there, and its cloud agent links the work items it
 * creates into that chat with tenant-scoped access (`chatAccessUserFor`: the host chat is
 * the one chat a self-acting agent reaches without membership). That exception is only
 * sound if the chat was bound by someone who could open it — so every entry point that
 * accepts an originating chat (`/api/tasks/:id/run-now`'s `chatId`, the submit routes'
 * free-form `payload.chatId`) asks HERE, through the same shared chat-access guard the
 * chat endpoints use. A caller with no user identity cannot bind a chat.
 */
import type { Db } from '../../infrastructure/database/connection';
import { canAccessChat } from '../brain/brainChatGuards';
import { parseOriginatingChatId } from './cloudDispatch';

/** Whether `userId` may bind a run in `tenantId` to `chatId`. */
export async function mayBindRunToChat(db: Db, tenantId: number, userId: string | null | undefined, chatId: number): Promise<boolean> {
  if (!userId) return false;
  return (await canAccessChat(db, chatId, tenantId, userId)) != null;
}

/** The originating chat a submit `payload` names that the caller may NOT bind (so the
 *  route refuses the submit), or null when it names none or one the caller can open. */
export async function unbindableRunChat(db: Db, tenantId: number, userId: string | null | undefined, payload: string | null | undefined): Promise<number | null> {
  const chatId = parseOriginatingChatId(payload);
  if (chatId == null) return null;
  return (await mayBindRunToChat(db, tenantId, userId, chatId)) ? null : chatId;
}

/** The refusal every binding entry point answers with — the same words run-now always used. */
export const UNBINDABLE_RUN_CHAT_ERROR = 'Originating Brain chat not found';
