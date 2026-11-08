/**
 * The platform's rail DTOs as `ServerRecordRow`s for `ingestServerRecords`.
 *
 * The DTOs are the RAW reads (`readChatTicketLinks` / `readChatRunHistory` in brain-embedded):
 * ids, `linkType`, every row the API lists, no cap. A malformed row (no kind or ref, no run id) is
 * left out rather than invented.
 *
 * - A ticket row OWNS only the rail's fields (title, status, progress, tier, parent): it merges over
 *   a ticket the device already holds (`mergeRailTicket`), so a locally authored ticket keeps its
 *   project, description, archive flag and chat.
 * - An untitled row (a work item linked before the device read it) stores an EMPTY title with its
 *   kind and ref; the label is formatted where it is drawn, in the reader's language.
 * - A link row names its ticket by position: its payload is a function of the client ids the earlier
 *   rows of the SAME batch resolved to, so one refresh is one ingest transaction.
 */

import type { ChatTicketLinkValue, EntityDestination, ServerRecordRow } from "@builderforce/local-first";
import { linkTierFields, mergeRailTicket, ticketServerId, type RailRunPayload, type RailTicketPayload } from "./railPayloads";
import type { RailLinkType, RailRun, RailTicketParent } from "./railProtocol";

/** One `GET /api/brain/chats/:id/tickets` row. */
export interface WireTicket {
  linkId?: number;
  kind?: string;
  ref?: string;
  label?: string;
  status?: string;
  progressPct?: number;
  done?: number;
  total?: number;
  exists?: boolean;
  linkType?: string;
  parent?: RailTicketParent;
}

export type WireRun = Partial<RailRun>;

export type ListedTicket = WireTicket & { kind: string; ref: string };

const text = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const asLinkType = (value: unknown): RailLinkType => (value === "created" ? "created" : "linked");
const count = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** The tickets that carry a usable `(kind, ref)`. */
export function listedTickets(tickets: readonly WireTicket[]): ListedTicket[] {
  return tickets.filter((tk): tk is ListedTicket => text(tk.kind) && text(tk.ref));
}

export function ticketRows(tickets: readonly ListedTicket[], destination: EntityDestination, at: string): ServerRecordRow[] {
  return tickets.map((tk) => {
    const payload: RailTicketPayload = {
      // Only for a ticket the device does not hold yet: the merge keeps an existing project.
      projectId: "",
      title: tk.label ?? "",
      status: tk.status ?? "backlog",
      ...(tk.kind === "task" || tk.kind === "epic" || tk.kind === "gap" ? { taskType: tk.kind } : {}),
      railKind: tk.kind,
      railRef: tk.ref,
      progressPct: count(tk.progressPct, 0),
      done: count(tk.done, 0),
      total: count(tk.total, 0),
      exists: tk.exists !== false,
      ...(tk.parent ? { parent: tk.parent } : {}),
    };
    return { entityType: "ticket", serverId: ticketServerId(tk.kind, tk.ref), payload, merge: mergeRailTicket, updatedAt: at, destination };
  });
}

/**
 * One link row per listed ticket that has a link id. Ticket `i` must be row `i` of the batch
 * (`ticketRows` first): the link's payload reads the client id that row resolved to.
 */
export function linkRows(
  tickets: readonly ListedTicket[],
  chatClientId: string,
  destination: EntityDestination,
  at: string,
): ServerRecordRow[] {
  const rows: ServerRecordRow[] = [];
  tickets.forEach((tk, index) => {
    if (typeof tk.linkId !== "number") return;
    const payload = (resolved: ReadonlyArray<string | undefined>): ChatTicketLinkValue | undefined => {
      const ticketClientId = resolved[index];
      return ticketClientId
        ? { chatClientId, ticketClientId, ...linkTierFields(tk.kind, tk.ref), linkType: asLinkType(tk.linkType) }
        : undefined;
    };
    rows.push({ entityType: "chat-ticket-link", serverId: String(tk.linkId), payload, updatedAt: at, destination });
  });
  return rows;
}

export function runRows(runs: readonly WireRun[], chatClientId: string, destination: EntityDestination, at: string): ServerRecordRow[] {
  // `at` stamps the row's `updatedAt` only; the payload never carries it.
  const rows: ServerRecordRow[] = [];
  for (const run of runs) {
    if (typeof run.executionId !== "number") continue;
    const payload: RailRunPayload = {
      chatClientId,
      executionId: run.executionId,
      taskId: count(run.taskId, 0),
      taskTitle: run.taskTitle ?? null,
      agentRef: run.agentRef ?? null,
      agentName: run.agentName ?? null,
      status: run.status ?? "",
      submittedBy: run.submittedBy ?? "",
      source: run.source ?? "",
      executor: run.executor ?? null,
      hostId: run.hostId ?? null,
      hostName: run.hostName ?? null,
      produced: run.produced ?? null,
      errorMessage: run.errorMessage ?? null,
      startedAt: run.startedAt ?? null,
      completedAt: run.completedAt ?? null,
      // Never the ingest instant: a payload that changes on every read is never idempotent.
      createdAt: run.createdAt ?? "",
    };
    rows.push({ entityType: "execution", serverId: String(run.executionId), payload, updatedAt: at, destination });
  }
  return rows;
}
