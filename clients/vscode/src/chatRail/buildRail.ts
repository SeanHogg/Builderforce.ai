/**
 * The rail, read from committed local facts ONLY (G21): the chat's tickets, links, runs, each
 * ticket's presented sync status and how fresh the copy is. Pure: it takes a snapshot, so it
 * answers with the platform denied and is the same code a test and the host run.
 *
 * - Each row's status is `presentRecordSyncStatus` (the ONE presenter over a record and the store's
 *   facts): it keeps only that record's own events and receipts, so a receipt for another record
 *   never moves this one.
 * - Freshness: when the rail was last taken from the platform (the store's read mark, or the newest
 *   server-observed link or run; never a ticket, which a link to an unseen work item stubs), and
 *   whether the chat is bound at all. A bound chat never read says so; only
 *   an unbound chat is "only on this device".
 * - An untitled ticket (linked before the device read it) keeps an empty label; the webview formats
 *   it from its kind and ref in the reader's language.
 */

import { compareMappingAge, inEntityScope, parseSyncId, syncIdText, type ChatTicketLinkValue, type EntityScope, type LocalRecord, type ServerMapping, type SyncId } from "@builderforce/local-first";
import type { LocalFirstView } from "../localFirstView";
import { presentRecordSyncStatus } from "../syncStatusPresenter";
import { railTicketProgress, type RailRunPayload, type RailTicketPayload } from "./railPayloads";
import { ticketsOfChats } from "./ticketsOfChat";
import type {
  ChatRef, RailFreshness, RailLink, RailRun, RailRunHistory, RailTicket,
} from "./railProtocol";

export type RailFacts = Pick<LocalFirstView, "records" | "mappings" | "events" | "receipts" | "conflicts">;

export interface RailRead {
  found: boolean;
  chatClientId?: string;
  tickets: RailTicket[];
  links: RailLink[];
  runHistory: RailRunHistory;
  freshness: RailFreshness;
  /** The local record ids of the runs read (host-side only: the watch's scope, not sent to the webview). */
  runClientIds: string[];
}

const RUNNABLE = new Set(["task", "epic", "gap"]);

const EMPTY_HISTORY: RailRunHistory = { linkedRunnableTickets: 0, runs: [], dispatchers: [], executors: [] };

/** The client id of the chat `ref` names, or undefined when the store holds no such chat. */
export function chatClientIdOf(facts: Pick<RailFacts, "records" | "mappings">, ref: ChatRef, scope?: EntityScope): string | undefined {
  if (typeof ref === "string") {
    return facts.records.some((row) => row.entityType === "chat" && row.id === ref && !row.deletedAt) ? ref : undefined;
  }
  const sync = parseSyncId(ref);
  if (sync === null) return undefined;
  // The same answer the store's `mappingByServerId` gives: the earliest mapping, in the active account.
  let mapping: ServerMapping | undefined;
  for (const row of facts.mappings) {
    if (row.entityType !== "chat" || parseSyncId(row.syncId) !== sync || !inEntityScope(row.destination, scope)) continue;
    if (!mapping || compareMappingAge(row, mapping) < 0) mapping = row;
  }
  if (!mapping) return undefined;
  const live = facts.records.some((row) => row.entityType === "chat" && row.id === mapping.clientEntityId && !row.deletedAt);
  return live ? mapping.clientEntityId : undefined;
}

const newest = (values: ReadonlyArray<string | undefined>): string | undefined =>
  values.reduce<string | undefined>((best, at) => (at !== undefined && (best === undefined || at > best) ? at : best), undefined);

export function readRailFromFacts(facts: RailFacts, ref: ChatRef, lastRefreshAt?: string, scope?: EntityScope): RailRead {
  const chatClientId = chatClientIdOf(facts, ref, scope);
  if (!chatClientId) {
    return { found: false, tickets: [], links: [], runHistory: EMPTY_HISTORY, freshness: { source: "device" }, runClientIds: [] };
  }

  // Each record's SyncId (re-checked: a snapshot row has lost its brand). A mapping with no integer
  // key (a tier ticket, a mirror record) has none.
  const syncIds = new Map<string, SyncId>();
  for (const mapping of facts.mappings) {
    const sync = parseSyncId(mapping.syncId);
    if (sync !== null) syncIds.set(`${mapping.entityType}\u0000${mapping.clientEntityId}`, sync);
  }
  const syncIdOf = (type: string, id: string) => syncIds.get(`${type}\u0000${id}`);

  const tickets = new Map<string, Readonly<LocalRecord<RailTicketPayload>>>();
  const linkRecords: Readonly<LocalRecord<ChatTicketLinkValue>>[] = [];
  const runRecords: Readonly<LocalRecord<RailRunPayload>>[] = [];
  for (const row of facts.records) {
    if (row.deletedAt) continue;
    if (row.entityType === "ticket") tickets.set(row.id, row as LocalRecord<RailTicketPayload>);
    else if (row.entityType === "chat-ticket-link" && (row.payload as ChatTicketLinkValue).chatClientId === chatClientId) {
      linkRecords.push(row as LocalRecord<ChatTicketLinkValue>);
    } else if (row.entityType === "execution" && (row.payload as RailRunPayload).chatClientId === chatClientId) {
      runRecords.push(row as LocalRecord<RailRunPayload>);
    }
  }

  const railTickets: RailTicket[] = [];
  const links: RailLink[] = [];
  const observed: string[] = [];
  const noteObserved = (row: Readonly<LocalRecord>) => {
    if (row.provenance?.evidence === "server-observed") observed.push(row.updatedAt);
  };

  // The chat's tickets: the ONE selection the chat list's row summary rolls up too.
  const chatTickets = ticketsOfChats(linkRecords, (id) => tickets.get(id), new Set([chatClientId])).get(chatClientId) ?? [];
  for (const { link, ticket, index } of chatTickets) {
    const payload = ticket.payload;
    const ticketSyncId = syncIdOf("ticket", ticket.id);
    const linkId = syncIdOf("chat-ticket-link", link.id) ?? -(index + 1);
    links.push({
      clientId: link.id,
      ticketClientId: ticket.id,
      linkType: link.payload.linkType,
      syncStatus: presentRecordSyncStatus(facts, link),
    });
    railTickets.push({
      clientId: ticket.id,
      linkId,
      kind: payload.railKind ?? payload.taskType ?? "task",
      ref: payload.railRef ?? (ticketSyncId !== undefined ? syncIdText(ticketSyncId) : ticket.id),
      label: payload.title,
      ...railTicketProgress(payload),
      exists: payload.exists ?? true,
      linkType: link.payload.linkType,
      ...(payload.parent ? { parent: payload.parent } : {}),
      syncStatus: presentRecordSyncStatus(facts, ticket),
    });
    // A ticket is not evidence of a read: linking an unseen work item lands a stub of it.
    noteObserved(link);
  }

  const runs: RailRun[] = runRecords
    .map((row) => {
      noteObserved(row);
      const { chatClientId: _chat, ...run } = row.payload;
      void _chat;
      return run;
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.executionId - a.executionId));

  const lastIngestedAt = newest([newest(observed), lastRefreshAt]);
  const bound = syncIdOf("chat", chatClientId) !== undefined;

  return {
    found: true,
    chatClientId,
    tickets: railTickets,
    links,
    runHistory: {
      linkedRunnableTickets: railTickets.filter((tk) => RUNNABLE.has(tk.kind)).length,
      runs,
      dispatchers: [...new Set(runs.map((run) => run.submittedBy))],
      executors: [...new Set(runs.flatMap((run) => (run.executor ? [run.executor] : [])))],
    },
    freshness: {
      ...(lastIngestedAt !== undefined ? { lastIngestedAt } : {}),
      source: bound || lastIngestedAt !== undefined ? "server-observed" : "device",
    },
    runClientIds: runRecords.map((row) => row.id),
  };
}
