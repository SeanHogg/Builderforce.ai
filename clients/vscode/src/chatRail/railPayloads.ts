/**
 * How the platform's rail rows are SHAPED as local records, and back.
 *
 * - A linked work item is a local `ticket`. The platform names it `(kind, ref)`: task, epic and
 *   gap share one id space (the server's tasks), so their server id is the bare `ref`; every other
 *   tier (objective, roadmap, spec …) has its own id space, so its server id is `kind:ref`.
 * - A run is a local `execution`, carrying the client id of the chat it ran for.
 * - A chat-ticket link is the `chat-ticket-link` record the local-first package owns.
 *
 * Both directions live here so a row ingested from the platform and a row read for the rail can
 * never disagree about what names a ticket.
 */

import { TASK_TABLE_KINDS, tierRefText, type EntityScope, type LocalFirstTransaction, type ServerMapping, type TicketValue } from "@builderforce/local-first";
import type { RailRun, RailTicketParent } from "./railProtocol";

/**
 * The server key a ticket of `(kind, ref)` is ingested under: a task-table kind's bare `ref` (its
 * SyncId), any other tier's `kind:ref` (`tierRefText`, which the store keeps as the mapping's
 * `externalRef`, with `syncId` null).
 */
export function ticketServerId(kind: string, ref: string): string {
  return TASK_TABLE_KINDS.has(kind) ? ref : tierRefText({ kind, ref });
}

/**
 * The mapping of the ticket `(kind, ref)` names: a task-table kind by its server id, any other tier
 * by its `externalRef` — inside `scope` (the active account: server ids are per tenant).
 */
export function ticketMappingOf(tx: LocalFirstTransaction, kind: string, ref: string, scope?: EntityScope): Promise<ServerMapping | undefined> {
  return TASK_TABLE_KINDS.has(kind)
    ? tx.mappingByServerId("ticket", ref, scope)
    : tx.mappingByExternalRef("ticket", tierRefText({ kind, ref }), scope);
}

/** A ticket the platform listed for a chat: a `TicketValue` plus what the rail draws. */
export interface RailTicketPayload extends TicketValue {
  railKind: string;
  railRef: string;
  progressPct: number;
  done: number;
  total: number;
  exists: boolean;
  parent?: RailTicketParent;
}

/** A ticket's progress as the rail draws it — and as the chat list rolls it up (`ChatTicketHealthInput`). */
export interface RailTicketProgress {
  status: string;
  progressPct: number;
  done: number;
  total: number;
}

/**
 * The ONE mapping from a ticket record to its progress. A ticket the platform listed carries the
 * rail's progress; a locally authored one carries none, so its status stands in (done = 100).
 *
 * The status is always present: a ticket the server listed carries its own lane, and a locally
 * filed one whose record has no status yet (undefined, or an empty string before a refresh fills
 * it) is drawn as `backlog` — the not-started lane the board shows — so the rail never renders an
 * empty or undefined status chip.
 */
export function railTicketProgress(payload: TicketValue & Partial<Pick<RailTicketPayload, "progressPct" | "done" | "total">>): RailTicketProgress {
  // An empty or whitespace-only status is the same "not started yet" as undefined: the record has
  // not been assigned a lane. Only a real lane (a non-blank string) is drawn verbatim.
  const status = typeof payload.status === "string" && payload.status.trim() !== "" ? payload.status : "backlog";
  return {
    status,
    progressPct: payload.progressPct ?? (status === "done" ? 100 : 0),
    done: payload.done ?? 0,
    total: payload.total ?? 0,
  };
}

/** A run the platform listed for a chat. */
export interface RailRunPayload extends RailRun {
  chatClientId: string;
}

/** Local work lists show a platform tier that is not a task (an objective, a spec …) only on the rail. */
export function isRailOnlyTicket(payload: Partial<RailTicketPayload>): boolean {
  return payload.railKind !== undefined && !TASK_TABLE_KINDS.has(payload.railKind);
}

/**
 * What a link payload carries so the server's importer can resolve a tier that has no numeric
 * server id (spec, objective, roadmap …): `{ ticketKind, ticketRef }`. A task-table kind is
 * resolved through `ticketServerId` instead, so it carries nothing here.
 */
export function linkTierFields(kind: string, ref: string): { ticketKind?: string; ticketRef?: string } {
  return TASK_TABLE_KINDS.has(kind) ? {} : { ticketKind: kind, ticketRef: ref };
}

/** The fields a rail read OWNS on a ticket: everything else (project, description, archived …) is the device's. */
const RAIL_OWNED = ["title", "status", "progressPct", "done", "total", "railKind", "railRef", "exists", "parent"] as const;

/**
 * Merge a rail row over a ticket the device already holds (`ingestServerRecords`' merge hook): the
 * rail's fields replace their counterparts, every other field of `existing` is kept. A rail field the
 * server no longer sends (a parent that went away) is removed.
 */
export function mergeRailTicket(existing: unknown, incoming: unknown): unknown {
  const base = { ...(existing && typeof existing === "object" ? existing as Record<string, unknown> : {}) };
  const rail = (incoming ?? {}) as Record<string, unknown>;
  for (const key of RAIL_OWNED) {
    // An untitled row (a stub, a server that sent no label) never blanks a title the device holds.
    if (key === "title" && !rail[key] && typeof base.title === "string") continue;
    if (rail[key] === undefined) delete base[key];
    else base[key] = rail[key];
  }
  return base;
}
