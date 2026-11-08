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

import type { TicketValue } from "@builderforce/local-first";
import type { RailRun, RailTicketParent } from "./railProtocol";

/** The kinds that live in the server's task table (one id space). */
const TASK_TABLE_KINDS: ReadonlySet<string> = new Set(["task", "epic", "gap"]);

/** The server id a ticket of `(kind, ref)` is mapped under. */
export function ticketServerId(kind: string, ref: string): string {
  return TASK_TABLE_KINDS.has(kind) ? ref : `${kind}:${ref}`;
}

/** The `(kind, ref)` a server id names; `kind` is `task` for a bare id (its tier rides the payload). */
export function ticketRefOfServerId(serverId: string): { kind: string; ref: string } {
  const at = serverId.indexOf(":");
  return at < 0 ? { kind: "task", ref: serverId } : { kind: serverId.slice(0, at), ref: serverId.slice(at + 1) };
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
