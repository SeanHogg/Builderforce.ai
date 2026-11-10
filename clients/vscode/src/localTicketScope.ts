/**
 * Which tickets belong to which chat, as THIS DEVICE knows it — the store side of the ticket
 * read union (`localTicketReads.ts`) and the chat-link guard (`chatTicketGuard.ts`).
 *
 * A ticket filed in the editor (`ticket-create`) carries its creating chat's client id
 * (`chatClientId`) and exists only here until a sync receipt maps it to a server id. Until
 * then the account's read tools cannot see it, so an agent asking "are this chat's tickets
 * done?" got an empty answer and went looking in other chats (chat #219, 2026-11-08).
 *
 * The chat ids involved: the model may name a chat by its LOCAL id (#61651) or its SERVER id
 * (#219); both resolve to the one client id the tickets carry. Pure of `vscode`: the store
 * and the chat identity are ports.
 */

import {
  chatTicketLinkId,
  entityIdResolver,
  parseEntityRef,
  parseSyncId,
  type EntityDestination,
  type EntityIdResolver,
  type EntityScope,
  type LocalFirstStore,
  type LocalFirstTransaction,
  type TicketValue,
} from "@builderforce/local-first";
import type { LocalChatIdentity } from "@seanhogg/builderforce-brain-embedded";

/** A local ticket record the server has not seen (no sync mapping). */
export interface UnsyncedTicket {
  id: string;
  chatClientId?: string;
  payload: TicketValue;
}

/** The run's own chat: its local id, its bound server chat (null = unbound), its client id. */
export interface RunChat {
  localChatId?: unknown;
  serverChatId: number | null;
  clientChatId?: string;
}

/** What the read union and the guard ask of this device. */
export interface ChatTicketScope {
  readonly current?: RunChat;
  /** The client id of the chat a tool call names (local or server id), or undefined. */
  clientChatIdFor(chatId: unknown): Promise<string | undefined>;
  /** The chat's tickets that exist only on this device. */
  unsyncedTickets(chatClientId: string): Promise<UnsyncedTicket[]>;
  /** One ticket that exists only on this device, by its local id. */
  unsyncedTicket(localId: string): Promise<UnsyncedTicket | undefined>;
  /** Whether this device knows the ticket (local or server id) to be linked to the run's chat. */
  linkedLocally(ticketId: string): Promise<boolean>;
}

/**
 * The live, unmapped tickets of the named chats — ONE scan of the ticket partition, then a
 * mapping lookup per candidate. Shared by the chat-row summary (`chatRail/localTicketSummary.ts`).
 */
export async function scanUnsyncedTickets(
  tx: LocalFirstTransaction,
  chatClientIds: ReadonlySet<string>,
): Promise<UnsyncedTicket[]> {
  if (chatClientIds.size === 0) return [];
  const candidates: Array<UnsyncedTicket & { destination: EntityDestination }> = [];
  await tx.scan<TicketValue>("ticket", (row) => {
    const chat = row.payload.chatClientId;
    if (row.deletedAt || !chat || !chatClientIds.has(chat)) return;
    // The scan hands the store's own row: keep a copy, never the row.
    candidates.push({ id: row.id, chatClientId: chat, payload: { ...row.payload }, destination: row.destination });
  });
  const out: UnsyncedTicket[] = [];
  for (const { destination, ...ticket } of candidates) {
    if (await tx.mapping("ticket", ticket.id, destination)) continue;
    out.push(ticket);
  }
  return out;
}

/** The local client id behind a ticket id: a LocalId as given; a SyncId or tier `kind:ref` through the resolver. */
async function ticketClientId(resolver: EntityIdResolver, ticketId: string, scope: EntityScope | undefined): Promise<string | undefined> {
  const ref = parseEntityRef(ticketId.trim().replace(/^#/, ""));
  if (!ref) return undefined;
  if ("local" in ref) return ref.local;
  return (await resolver.resolve("ticket", ref, scope)).localId ?? undefined;
}

/** `scope` is the active account, read per call: a SyncId or tier ref names that tenant's ticket only. */
export function localChatTicketScope(
  store: LocalFirstStore,
  identity: Pick<LocalChatIdentity, "localIdFor" | "clientIdFor">,
  current?: RunChat,
  scope?: () => EntityScope | undefined,
): ChatTicketScope {
  const resolver = entityIdResolver(store);
  return {
    current,
    async clientChatIdFor(chatId) {
      if (chatId === undefined || chatId === null || chatId === "") return undefined;
      if (current?.clientChatId) {
        const sameLocal = current.localChatId !== undefined && String(chatId) === String(current.localChatId);
        const sameServer = current.serverChatId != null && String(chatId) === String(current.serverChatId);
        if (sameLocal || sameServer) return current.clientChatId;
      }
      // Another chat: the model names chats by their SERVER id (the account's tools list those).
      const serverId = parseSyncId(typeof chatId === "string" ? chatId.trim() : chatId);
      if (serverId === null) return undefined;
      const localId = await identity.localIdFor(serverId);
      return localId === undefined ? undefined : identity.clientIdFor(localId);
    },
    unsyncedTickets: (chatClientId) => store.read((tx) => scanUnsyncedTickets(tx, new Set([chatClientId]))),
    unsyncedTicket: (localId) =>
      store.read(async (tx) => {
        const row = await tx.get<TicketValue>("ticket", localId);
        if (!row || row.deletedAt) return undefined;
        if (await tx.mapping("ticket", row.id, row.destination)) return undefined;
        return { id: row.id, ...(row.payload.chatClientId ? { chatClientId: row.payload.chatClientId } : {}), payload: row.payload };
      }),
    linkedLocally: async (ticketId) => {
      const chat = current?.clientChatId;
      if (!chat) return false;
      const clientId = await ticketClientId(resolver, ticketId, scope?.());
      if (!clientId) return false;
      return store.read(async (tx) => {
        const ticket = await tx.get<TicketValue>("ticket", clientId);
        if (ticket && !ticket.deletedAt && ticket.payload.chatClientId === chat) return true;
        const link = await tx.get("chat-ticket-link", chatTicketLinkId(chat, clientId));
        return !!link && !link.deletedAt;
      });
    },
  };
}
