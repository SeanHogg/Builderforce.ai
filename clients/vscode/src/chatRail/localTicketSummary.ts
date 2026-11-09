/**
 * A chat row's ticket summary (`ticketCount` / `ticketProgressPct` / `ticketOpenCount` /
 * `ticketDoneCount`) including the tickets filed ON THIS DEVICE that the platform has not seen.
 *
 * Agents in the editor (a run and its sub-agents) file tickets locally (`ticket-create`), each
 * carrying its root chat's `chatClientId`. Until a sync receipt maps one to a server id it is
 * absent from the server's summary on the chat, so a chat whose every ticket is local read
 * "No tickets".
 *
 * THE MERGE RULE (one, documented here):
 * - "Local unbound" = a live `ticket` record whose `chatClientId` is the chat's and that has NO
 *   server mapping. A mapped ticket is the platform's: the server summary already counts it (or
 *   will on the next list read), so it is never counted twice.
 * - No local unbound tickets: the row is returned untouched (the server summary stands).
 * - Otherwise counts ADD: server count + local count; open/done = server's + the local rollup's.
 *   The percent is ONE `rollupChatTicketHealth` over the server summary (as one input weighted
 *   by its counted tickets, at its percent) plus every local unbound ticket.
 * - A local ticket's progress is the rail's mapping (`railTicketProgress`), so the row and the
 *   rail agree.
 *
 * One index per list load: the ticket partition is scanned once and grouped by `chatClientId`;
 * the mapping lookups touch only tickets of the listed chats.
 */

import { rollupChatTicketHealth, type ChatTicketHealthInput } from "@builderforce/agent-loop";
import type { EntityDestination, LocalFirstStore, LocalFirstTransaction, TicketValue } from "@builderforce/local-first";
import type { BrainChat, BrainPersistenceAdapter } from "@seanhogg/builderforce-brain-embedded";
import { railTicketProgress, type RailTicketPayload } from "./railPayloads";

type TicketSummary = Pick<BrainChat, "ticketCount" | "ticketProgressPct" | "ticketOpenCount" | "ticketDoneCount">;

/** The local unbound tickets of the named chats, as rollup inputs, by chat client id. */
export async function localUnboundTicketsByChat(
  tx: LocalFirstTransaction,
  chatClientIds: ReadonlySet<string>,
): Promise<Map<string, ChatTicketHealthInput[]>> {
  const candidates: Array<{ id: string; chat: string; destination: EntityDestination; input: ChatTicketHealthInput }> = [];
  if (chatClientIds.size === 0) return new Map();
  await tx.scan<TicketValue & Partial<RailTicketPayload>>("ticket", (row) => {
    const chat = row.payload.chatClientId;
    if (row.deletedAt || !chat || !chatClientIds.has(chat)) return;
    candidates.push({ id: row.id, chat, destination: row.destination, input: railTicketProgress(row.payload) });
  });
  const byChat = new Map<string, ChatTicketHealthInput[]>();
  for (const candidate of candidates) {
    if (await tx.mapping("ticket", candidate.id, candidate.destination)) continue;
    const list = byChat.get(candidate.chat);
    if (list) list.push(candidate.input);
    else byChat.set(candidate.chat, [candidate.input]);
  }
  return byChat;
}

/** A chat row's summary with its local unbound tickets merged in (see the rule above). */
export function mergeLocalTicketSummary<C extends TicketSummary>(chat: C, local: readonly ChatTicketHealthInput[] | undefined): C {
  if (!local || local.length === 0) return chat;
  const serverCount = chat.ticketCount ?? 0;
  const serverDone = chat.ticketDoneCount ?? 0;
  const serverOpen = chat.ticketOpenCount ?? Math.max(0, serverCount - serverDone);
  const serverCounted = serverOpen + serverDone;
  const serverInput: ChatTicketHealthInput[] = serverCounted > 0
    ? [{ progressPct: chat.ticketProgressPct ?? 0, done: serverDone, total: serverCounted }]
    : [];
  const localHealth = rollupChatTicketHealth(local);
  return {
    ...chat,
    ticketCount: serverCount + local.length,
    ticketProgressPct: rollupChatTicketHealth([...serverInput, ...local]).pct,
    ticketOpenCount: serverOpen + localHealth.openTickets,
    ticketDoneCount: serverDone + localHealth.completedTickets,
  };
}

/** Merge local unbound tickets into a list of chat rows: one store read, one index. */
export async function withLocalTickets(store: Pick<LocalFirstStore, "read">, chats: BrainChat[]): Promise<BrainChat[]> {
  const ids = new Set(chats.flatMap((chat) => (chat.clientId ? [chat.clientId] : [])));
  if (ids.size === 0) return chats;
  const byChat = await store.read((tx) => localUnboundTicketsByChat(tx, ids));
  if (byChat.size === 0) return chats;
  return chats.map((chat) => (chat.clientId ? mergeLocalTicketSummary(chat, byChat.get(chat.clientId)) : chat));
}

/** Decorate the host's Brain persistence so every chat it lists or reads carries its local tickets. */
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
