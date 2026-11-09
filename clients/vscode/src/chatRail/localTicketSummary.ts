/**
 * A chat row's ticket summary (`ticketCount` / `ticketProgressPct` / `ticketOpenCount` /
 * `ticketDoneCount`) computed from the SAME tickets the chat's rail shows.
 *
 * The editor's history list is read from the local store (`createLocalBrainPersistence`), whose
 * chat records carry no server summary. The rail draws the chat's tickets from the store: the
 * platform's tickets mirrored with their server progress, plus the tickets filed on this device.
 * The row used to roll up only the device's UNSYNCED tickets (status-only, so 0%) over a server
 * summary that was absent, so a chat whose rail read 15% read 0% in the list (2026-11-08).
 *
 * THE RULE (one, documented here):
 * - The chat's tickets are `ticketsOfChats` (the rail's ONE selection) and each ticket's progress
 *   is `railTicketProgress` (the rail's ONE mapping); the percent and the open/done counts are ONE
 *   `rollupChatTicketHealth` over them, exactly the rail header's figure.
 * - The store holds no ticket for the chat: the row is returned untouched (the server summary,
 *   when a host supplied one, stands).
 *
 * One index per list load: the link partition is scanned once for the listed chats, then the
 * ticket partition once for the tickets those links name.
 */

import { rollupChatTicketHealth, type ChatTicketHealthInput } from "@builderforce/agent-loop";
import type { ChatTicketLinkValue, LocalFirstStore, LocalFirstTransaction, TicketValue } from "@builderforce/local-first";
import type { BrainChat, BrainPersistenceAdapter } from "@seanhogg/builderforce-brain-embedded";
import { railTicketProgress, type RailTicketPayload } from "./railPayloads";
import { ticketsOfChats } from "./ticketsOfChat";

type TicketSummary = Pick<BrainChat, "ticketCount" | "ticketProgressPct" | "ticketOpenCount" | "ticketDoneCount">;
type TicketPayload = TicketValue & Partial<RailTicketPayload>;

/** The tickets the store holds for the named chats (the rail's selection), as rollup inputs, by chat client id. */
export async function storeTicketsByChat(
  tx: LocalFirstTransaction,
  chatClientIds: ReadonlySet<string>,
): Promise<Map<string, ChatTicketHealthInput[]>> {
  if (chatClientIds.size === 0) return new Map();
  // A scan hands the store's own rows: keep copies of just what is used, never the rows.
  const links: Array<{ id: string; payload: ChatTicketLinkValue }> = [];
  await tx.scan<ChatTicketLinkValue>("chat-ticket-link", (row) => {
    if (!row.deletedAt && chatClientIds.has(row.payload.chatClientId)) links.push({ id: row.id, payload: { ...row.payload } });
  });
  const wanted = new Set(links.map((link) => link.payload.ticketClientId));
  const tickets = new Map<string, { id: string; payload: TicketPayload }>();
  if (wanted.size > 0) {
    await tx.scan<TicketPayload>("ticket", (row) => {
      if (!row.deletedAt && wanted.has(row.id)) tickets.set(row.id, { id: row.id, payload: { ...row.payload } });
    });
  }
  const byChat = new Map<string, ChatTicketHealthInput[]>();
  for (const [chat, rows] of ticketsOfChats(links, (id) => tickets.get(id), chatClientIds)) {
    byChat.set(chat, rows.map(({ ticket }) => railTicketProgress(ticket.payload)));
  }
  return byChat;
}

/** A chat row's summary from the store's tickets for it (see the rule above). */
export function mergeLocalTicketSummary<C extends TicketSummary>(chat: C, tickets: readonly ChatTicketHealthInput[] | undefined): C {
  if (!tickets || tickets.length === 0) return chat;
  const health = rollupChatTicketHealth(tickets);
  return {
    ...chat,
    ticketCount: tickets.length,
    ticketProgressPct: health.pct,
    ticketOpenCount: health.openTickets,
    ticketDoneCount: health.completedTickets,
  };
}

/** Summarize a list of chat rows from the store's tickets: one store read, one index. */
export async function withLocalTickets(store: Pick<LocalFirstStore, "read">, chats: BrainChat[]): Promise<BrainChat[]> {
  const ids = new Set(chats.flatMap((chat) => (chat.clientId ? [chat.clientId] : [])));
  if (ids.size === 0) return chats;
  const byChat = await store.read((tx) => storeTicketsByChat(tx, ids));
  if (byChat.size === 0) return chats;
  return chats.map((chat) => (chat.clientId ? mergeLocalTicketSummary(chat, byChat.get(chat.clientId)) : chat));
}

/** Decorate the host's Brain persistence so every chat it lists or reads carries its rail's ticket summary. */
export function mergeLocalTicketSummaries<P extends Pick<BrainPersistenceAdapter, "listChats" | "getChat" | "listArchivedChats">>(
  persistence: P,
  store: Pick<LocalFirstStore, "read">,
): P {
  const listChats = persistence.listChats.bind(persistence);
  const getChat = persistence.getChat.bind(persistence);
  persistence.listChats = async (params) => withLocalTickets(store, await listChats(params));
  persistence.getChat = async (id) => (await withLocalTickets(store, [await getChat(id)]))[0]!;
  if (persistence.listArchivedChats) {
    const listArchivedChats = persistence.listArchivedChats.bind(persistence);
    persistence.listArchivedChats = async (params) => withLocalTickets(store, await listArchivedChats(params));
  }
  return persistence;
}
