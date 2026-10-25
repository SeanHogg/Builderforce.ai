/**
 * The chat's linked tickets and its run history — read ONCE, for every host.
 *
 * Two routes (`GET /api/brain/chats/:id/tickets`, `GET /api/brain/chats/:id/runs`) had
 * two readers: the panel's chat-tickets REST adapter (`@seanhogg/builderforce-brain-ui`
 * `restAdapter.ts`, behind the diagnostics capture and the Tickets panel) and the VS Code
 * host's task context pack (PRD 35 E2), which cannot load the React package. They live
 * here — pure, fetch-agnostic, no DOM — and each host hands in the authenticated GET it
 * already has. What a reader does with a failure stays the caller's: the panel degrades
 * a history it could not read to "nothing ran", the pack says "could not be read".
 */

/** The host's authenticated JSON GET, relative to the gateway origin. */
export type ChatStateGet = <T>(path: string) => Promise<T | undefined>;

/** `GET /api/brain/chats/:id/tickets` — the chat's linked tickets ([] when the body has none). Rejects as `get` does. */
export async function readChatTicketLinks<T>(get: ChatStateGet, chatId: number): Promise<T[]> {
  const r = await get<{ tickets?: T[] }>(`/api/brain/chats/${chatId}/tickets`);
  return r?.tickets ?? [];
}

/** `GET /api/brain/chats/:id/runs` — the chat's run history, as the server sends it. Rejects as `get` does. */
export function readChatRunHistory<H>(get: ChatStateGet, chatId: number): Promise<H | undefined> {
  return get<H>(`/api/brain/chats/${chatId}/runs`);
}
