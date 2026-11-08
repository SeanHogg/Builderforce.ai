/**
 * The rail, read from committed local facts ONLY (G21): the chat's tickets, links, runs, each
 * ticket's presented sync status and how fresh the copy is. Pure: it takes a snapshot, so it
 * answers with the platform denied and is the same code a test and the host run.
 *
 * Status comes from `presentSurfaceSyncStatus` / `presentStoreSyncStatus` over a snapshot narrowed
 * to the one record (the presenter looks a record up by scanning its `records`, so a whole-store
 * list per ticket would make the rail O(tickets x store)).
 */

import type { LocalFirstSnapshot, LocalRecord, ChatTicketLinkValue } from "@builderforce/local-first";
import { presentStoreSyncStatus, presentSurfaceSyncStatus } from "../syncStatusPresenter";
import type { RailRunPayload, RailTicketPayload } from "./railPayloads";
import type {
  ChatRef, RailFreshness, RailLink, RailRun, RailRunHistory, RailTicket,
} from "./railProtocol";

export type RailFacts = Pick<LocalFirstSnapshot, "records" | "mappings" | "events" | "receipts" | "conflicts">;

export interface RailRead {
  found: boolean;
  chatClientId?: string;
  tickets: RailTicket[];
  links: RailLink[];
  runHistory: RailRunHistory;
  freshness: RailFreshness;
}

const RUNNABLE = new Set(["task", "epic", "gap"]);

const EMPTY_HISTORY: RailRunHistory = { linkedRunnableTickets: 0, runs: [], dispatchers: [], executors: [] };

/** The client id of the chat `ref` names, or undefined when the store holds no such chat. */
export function chatClientIdOf(facts: Pick<RailFacts, "records" | "mappings">, ref: ChatRef): string | undefined {
  if (typeof ref === "string") {
    return facts.records.some((row) => row.entityType === "chat" && row.id === ref && !row.deletedAt) ? ref : undefined;
  }
  const mapping = facts.mappings.find((row) => row.entityType === "chat" && row.serverId === String(ref));
  if (!mapping) return undefined;
  const live = facts.records.some((row) => row.entityType === "chat" && row.id === mapping.clientEntityId && !row.deletedAt);
  return live ? mapping.clientEntityId : undefined;
}

function narrow(facts: RailFacts, record: LocalRecord) {
  return { records: [record], events: facts.events, receipts: facts.receipts, conflicts: facts.conflicts };
}

function numeric(value: string | undefined): number | undefined {
  const parsed = value === undefined ? NaN : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export function readRailFromFacts(facts: RailFacts, ref: ChatRef, lastRefreshAt?: string): RailRead {
  const chatClientId = chatClientIdOf(facts, ref);
  if (!chatClientId) {
    return { found: false, tickets: [], links: [], runHistory: EMPTY_HISTORY, freshness: { source: "device" } };
  }

  const serverIds = new Map<string, string>();
  for (const mapping of facts.mappings) serverIds.set(`${mapping.entityType}\u0000${mapping.clientEntityId}`, mapping.serverId);
  const serverIdOf = (type: string, id: string) => serverIds.get(`${type}\u0000${id}`);

  const tickets = new Map<string, LocalRecord<RailTicketPayload>>();
  const linkRecords: LocalRecord<ChatTicketLinkValue>[] = [];
  const runRecords: LocalRecord<RailRunPayload>[] = [];
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
  const noteObserved = (row: LocalRecord) => {
    if (row.provenance?.evidence === "server-observed") observed.push(row.updatedAt);
  };

  linkRecords.forEach((link, index) => {
    const ticket = tickets.get(link.payload.ticketClientId);
    if (!ticket) return;
    const payload = ticket.payload;
    const ticketServerId = serverIdOf("ticket", ticket.id);
    const linkId = numeric(serverIdOf("chat-ticket-link", link.id)) ?? -(index + 1);
    links.push({
      clientId: link.id,
      ticketClientId: ticket.id,
      linkType: link.payload.linkType,
      syncStatus: presentStoreSyncStatus(narrow(facts, link), { entityType: "chat-ticket-link", id: link.id }),
    });
    railTickets.push({
      clientId: ticket.id,
      linkId,
      kind: payload.railKind ?? payload.taskType ?? "task",
      ref: payload.railRef ?? ticketServerId ?? ticket.id,
      label: payload.title,
      status: payload.status,
      progressPct: payload.progressPct ?? (payload.status === "done" ? 100 : 0),
      done: payload.done ?? 0,
      total: payload.total ?? 0,
      exists: payload.exists ?? true,
      linkType: link.payload.linkType,
      ...(payload.parent ? { parent: payload.parent } : {}),
      syncStatus: presentSurfaceSyncStatus(narrow(facts, ticket), "ticket", ticket.id),
    });
    noteObserved(link);
    noteObserved(ticket);
  });

  const runs: RailRun[] = runRecords
    .map((row) => {
      noteObserved(row);
      const { chatClientId: _chat, ...run } = row.payload;
      void _chat;
      return run;
    })
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.executionId - a.executionId));

  const lastObserved = observed.reduce<string | undefined>((best, at) => (best === undefined || at > best ? at : best), undefined);
  const lastIngestedAt = [lastObserved, lastRefreshAt].reduce<string | undefined>(
    (best, at) => (at !== undefined && (best === undefined || at > best) ? at : best),
    undefined,
  );

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
      source: lastObserved !== undefined || lastRefreshAt !== undefined ? "server-observed" : "device",
    },
  };
}
