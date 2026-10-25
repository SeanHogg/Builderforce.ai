/**
 * Which SERVER chat a run's server-addressed work names (PRD 36). A run is keyed by its
 * host's chat id; on a host with a local store that id is a view key that never leaves
 * the machine, so the host says which server chat (if any) it is bound to. Resolved
 * here, once, for every part of the loop that talks to the platform about the chat.
 */

import type { BrainRunRequest } from './runTypes';

/** `req.serverChatId`, or the run's own chat id when the host did not say (its chats
 *  are server chats). `null` ⇒ an unbound local chat: no chat id leaves the machine. */
export function resolveServerChatId(chatId: number, req: Pick<BrainRunRequest, 'serverChatId'>): number | null {
  return req.serverChatId === undefined ? chatId : req.serverChatId;
}
