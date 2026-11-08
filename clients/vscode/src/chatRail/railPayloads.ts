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
