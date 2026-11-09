/**
 * WHICH tickets a chat has, as the device holds them: the ONE selection the rail draws
 * (`buildRail.ts`) and the chat list rolls up (`localTicketSummary.ts`), so a history row's
 * percent and the rail's ring are computed over the same tickets.
 *
 * A chat's tickets are the tickets its live `chat-ticket-link` records name, in link order,
 * whose ticket record is live. That covers both kinds the rail shows: tickets the platform
 * listed for the chat (mirrored with the server's progress) and tickets filed on this device
 * (`ticket-create` writes the link with the ticket). A ticket that merely carries a
 * `chatClientId` but no link is not on the rail, so it is not the chat's here either.
 */

import type { ChatTicketLinkValue, LocalRecord } from "@builderforce/local-first";

type Live<P> = Pick<Readonly<LocalRecord<P>>, "id" | "payload" | "deletedAt">;

export interface ChatTicketOf<L, T> {
  link: L;
  ticket: T;
  /** The link's position among ALL of its chat's live links (a link whose ticket is missing still takes a slot). */
  index: number;
}

/**
 * The tickets of each named chat, by chat client id. `links` may hold links of other chats
 * (skipped); `ticketOf` answers a ticket client id with its record, or undefined when the
 * device holds none. Pure: the rail passes a snapshot's rows, the chat list a transaction's.
 */
export function ticketsOfChats<L extends Live<ChatTicketLinkValue>, T extends Live<unknown>>(
  links: Iterable<L>,
  ticketOf: (ticketClientId: string) => T | undefined,
  chatClientIds: ReadonlySet<string>,
): Map<string, Array<ChatTicketOf<L, T>>> {
  const byChat = new Map<string, Array<ChatTicketOf<L, T>>>();
  const slots = new Map<string, number>();
  for (const link of links) {
    const chat = link.payload.chatClientId;
    if (link.deletedAt || !chatClientIds.has(chat)) continue;
    const index = slots.get(chat) ?? 0;
    slots.set(chat, index + 1);
    const ticket = ticketOf(link.payload.ticketClientId);
    if (!ticket || ticket.deletedAt) continue;
    const list = byChat.get(chat);
    if (list) list.push({ link, ticket, index });
    else byChat.set(chat, [{ link, ticket, index }]);
  }
  return byChat;
}
