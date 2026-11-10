/**
 * Link and unlink from the rail (G21): the host writes the LOCAL `chat-ticket-link` record
 * (`linkChatTicket` / `unlinkChatTicket`), which syncs to the platform through the importer on a
 * granted push. The rail never calls the platform to link, so it works with the platform denied.
 *
 * The webview names a work item by `(kind, ref)` as the platform does. This resolves it to a local
 * ticket: by its server mapping, else by being a local client id. A work item the device has not
 * seen (picked from the platform's typeahead) lands as a minimal server-observed ticket first (an
 * empty title with its kind and ref, labelled where it is drawn), so the link has both ends; the
 * next refresh fills in its title and progress. A chat only on this device links the same way: its
 * client id names it, no server chat is needed.
 */

import { ingestServerRecords, linkChatTicket, unlinkChatTicket, type EntityScope, type LocalFirstStore } from "@builderforce/local-first";
import { linkTierFields, ticketMappingOf } from "./railPayloads";
import type { ChatRailMutationOutcome, ChatRef, RailLinkType, RailTicketRef } from "./railProtocol";
import { ticketRows } from "./railRows";
import { resolveChat, type ResolvedChat } from "./resolveChat";

export interface RailLinkPorts {
  deviceId: string;
  now?: () => Date;
  /** The active account (`activeEntityScope`), read per call: server ids are only unique per tenant. */
  scope?: () => EntityScope | undefined;
}

function failure(error: unknown): ChatRailMutationOutcome {
  const code = (error as { code?: unknown })?.code;
  return { ok: false, error: typeof code === "string" ? code : error instanceof Error ? error.message : String(error) };
}

/** The local ticket a `(kind, ref)` names, or undefined when the device has none. */
async function knownTicket(store: LocalFirstStore, ticket: RailTicketRef, scope: EntityScope | undefined): Promise<string | undefined> {
  return store.read(async (tx) => {
    const mapped = await ticketMappingOf(tx, ticket.kind, ticket.ref, scope);
    if (mapped) return mapped.clientEntityId;
    const local = await tx.get("ticket", ticket.ref);
    return local && !local.deletedAt ? local.id : undefined;
  });
}

async function ticketForLink(store: LocalFirstStore, chat: ResolvedChat, ticket: RailTicketRef, at: string, scope: EntityScope | undefined): Promise<string | undefined> {
  const known = await knownTicket(store, ticket, scope);
  if (known) return known;
  const stub = await ingestServerRecords(store, ticketRows([{ kind: ticket.kind, ref: ticket.ref }], chat.destination, at));
  return stub.clientIds[0];
}

export async function linkRailTicket(
  store: LocalFirstStore,
  ports: RailLinkPorts,
  ref: ChatRef,
  ticket: RailTicketRef,
  linkType: RailLinkType,
): Promise<ChatRailMutationOutcome> {
  try {
    const scope = ports.scope?.();
    const chat = await store.read((tx) => resolveChat(tx, ref, scope));
    if (!chat) return { ok: false, error: "chat_not_found" };
    const at = (ports.now ?? (() => new Date()))().toISOString();
    const ticketClientId = await ticketForLink(store, chat, ticket, at, scope);
    if (!ticketClientId) return { ok: false, error: "ticket_not_found" };
    await linkChatTicket(store, {
      chatClientId: chat.clientId,
      ticketClientId,
      linkType,
      deviceId: ports.deviceId,
      occurredAt: at,
      // A tier with no numeric server id (spec, objective …) is resolved by the importer from these.
      ...linkTierFields(ticket.kind, ticket.ref),
    });
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function unlinkRailTicket(
  store: LocalFirstStore,
  ports: RailLinkPorts,
  ref: ChatRef,
  ticket: RailTicketRef,
): Promise<ChatRailMutationOutcome> {
  try {
    const scope = ports.scope?.();
    const chat = await store.read((tx) => resolveChat(tx, ref, scope));
    if (!chat) return { ok: false, error: "chat_not_found" };
    const ticketClientId = await knownTicket(store, ticket, scope);
    if (!ticketClientId) return { ok: false, error: "ticket_not_found" };
    const removed = await unlinkChatTicket(store, {
      chatClientId: chat.clientId,
      ticketClientId,
      deviceId: ports.deviceId,
      occurredAt: (ports.now ?? (() => new Date()))().toISOString(),
    });
    return removed ? { ok: true } : { ok: false, error: "link_not_found" };
  } catch (error) {
    return failure(error);
  }
}
