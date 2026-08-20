import { reportCaughtError } from '../../application/observability/caughtErrorReporter';
/**
 * broadcastRoom — push a frame to everyone watching a realtime room so clients
 * re-fetch (no polling). Shared by the poker/retro surfaces and the ceremony
 * (standup/planning) room; the room id namespaces the surface
 * (`poker:<id>` / `retro:<id>` / `ceremony:<projectId>`).
 *
 * Best-effort: a relay miss never fails the underlying mutation — the surface
 * still works without live push, it just falls back to manual refresh.
 */
export async function broadcastRoom(
  ns: DurableObjectNamespace | undefined,
  room: string,
  /** Optional explicit frame; defaults to the room's `{type:"changed"}` signal. */
  frame?: string,
): Promise<void> {
  if (!ns) return;
  try {
    await ns.get(ns.idFromName(room)).fetch('https://session-room/broadcast', {
      method: 'POST',
      ...(frame ? { body: frame } : {}),
    });
  } catch (error) {
    /* best-effort; the surface still works without live push */
  
    reportCaughtError(error, { source: "infrastructure/relay/broadcastRoom.ts", operation: "broadcastRoom" });
  }
}

/**
 * Room id for a project's live board channel. One room per project carries every
 * project-scoped change — task create/update/move/delete AND execution lifecycle
 * — so all of a project's views (board, kanban, calendar, list) and any open
 * task drawer re-fetch the instant a teammate OR an agent mutates the project.
 *
 * Tenant-qualified: the project id alone is an enumerable integer, so without the
 * tenant prefix tenant B could subscribe to tenant A's project change-events.
 * Mirrors {@link brainChatRoomName}. BOTH the subscribe side (project stream
 * route) and every publish side (below) must build the room the same way or the
 * live stream silently breaks.
 */
export const projectRoomName = (tenantId: number | string, projectId: number | string): string =>
  `project:${tenantId}:${projectId}`;

/** Tenant-qualified room for one Brain chat. Tenant qualification prevents an id
 * collision from ever crossing tenant boundaries inside the shared relay. */
export const brainChatRoomName = (tenantId: number | string, chatId: number | string): string =>
  `brain-chat:${tenantId}:${chatId}`;

/**
 * Room id for a project's live CEREMONY channel (standup + planning share one room).
 *
 * Tenant-qualified for exactly the reason {@link projectRoomName} is: the project id is
 * an enumerable integer, and the unqualified `ceremony:<projectId>` meant two tenants'
 * project 11 relayed presence, cursors and drag previews into the same room. BOTH the
 * subscribe side (`GET /api/ceremonies/rooms/:id/ws`) and every publish side must build
 * the name through this function or the live channel silently splits in two.
 */
export const ceremonyRoomName = (tenantId: number | string, projectId: number | string): string =>
  `ceremony:${tenantId}:${projectId}`;

/**
 * Push the SERVER's `changed` signal into a ceremony room.
 *
 * The signal used to be client-driven: whoever committed a mutation sent
 * `{type:"changed"}` over its own socket and the DO relayed it. That made the refresh
 * fan-out depend on the mutating client still being connected and still choosing to send
 * it — a mutation from the AI Manager, a cron sweep or a second tab reached nobody — and
 * it let any connected client fabricate a refresh storm. The DO now refuses the frame
 * from a client entirely; this is the only way one is produced.
 */
export const broadcastCeremonyChanged = (
  ns: DurableObjectNamespace | undefined,
  tenantId: number | string,
  projectId: number | string,
): Promise<void> => broadcastRoom(ns, ceremonyRoomName(tenantId, projectId));

/**
 * Room id for ONE execution's live event stream (status/message/file/tool frames).
 *
 * Reuses the per-execution DO name convention already established by
 * `CLOUD_RUNNER` (`exec:<executionId>`) rather than inventing a third id shape —
 * the two live in different namespaces (`CLOUD_RUNNER` vs `SESSION_ROOM`), so the
 * same name means "this run" in both without colliding.
 *
 * Deliberately NOT tenant-qualified, unlike {@link projectRoomName}. The only
 * subscribe path (`GET /api/runtime/executions/:id/stream`) resolves the run
 * through `loadOwnedExecution` FIRST and relays the upgrade only for a run the
 * caller's tenant owns, so a room name cannot be used to reach another tenant's
 * stream. Qualifying it would mean an executionId→tenantId read on the hot
 * publish path (every tool event) purely to re-derive something the subscribe
 * side has already proved.
 */
export const executionRoomName = (executionId: number | string): string => `exec:${executionId}`;

/** Publish one execution event frame (see `ExecutionSubscriberEvent`) into a run's
 *  live room, from ANY isolate. This is the cross-isolate half of the live tail:
 *  the emitting isolate need not be the one holding the viewer's socket. */
export async function broadcastExecutionEvent(
  ns: DurableObjectNamespace | undefined,
  executionId: number | string,
  frame: string,
): Promise<void> {
  return broadcastRoom(ns, executionRoomName(executionId), frame);
}

/** Tenant-qualified room for one Creation Session. */
export const creationSessionRoomName = (tenantId: number | string, sessionId: string): string =>
  `creation:${tenantId}:${sessionId}`;

/** Notify every open surface that a durable chat message was appended. */
export async function broadcastBrainChatChanged(
  ns: DurableObjectNamespace | undefined,
  tenantId: number | string,
  chatId: number | string,
): Promise<void> {
  return broadcastRoom(ns, brainChatRoomName(tenantId, chatId));
}

/**
 * Push a `{type:"changed"}` signal to EVERY live room a project has — the board room
 * (`SESSION_ROOM`) and the ceremony room (`CEREMONY_ROOM`).
 *
 * ONE NOTIFIER, because a project has more than one live surface and they must not
 * diverge. The board room was pushed by the mutation routes while the ceremony's round
 * table relied on the mutating CLIENT sending its own `changed` frame — so a ticket moved
 * by the AI Manager, by a cron sweep or from another tab refreshed the board and left the
 * standup showing stale cards, and any connected client could fabricate a refresh storm.
 * The ceremony DO now refuses a client-sent `changed` outright; this is where the real
 * one comes from.
 *
 * Takes the whole `env` rather than one namespace precisely so a future third surface is
 * added HERE and every caller gets it, instead of ten call sites each learning about a
 * new binding. Both pushes are best-effort and independent: a missing binding or a relay
 * miss on one never suppresses the other.
 *
 * `tenantId` MUST match the tenant the subscribe side scoped the room with.
 */
export async function broadcastProjectChanged(
  env: { SESSION_ROOM?: DurableObjectNamespace; CEREMONY_ROOM?: DurableObjectNamespace } | undefined,
  tenantId: number | string | null | undefined,
  projectId: number | string | null | undefined,
): Promise<void> {
  if (tenantId == null || projectId == null) return;
  await Promise.all([
    broadcastRoom(env?.SESSION_ROOM, projectRoomName(tenantId, projectId)),
    broadcastRoom(env?.CEREMONY_ROOM, ceremonyRoomName(tenantId, projectId)),
  ]);
}
