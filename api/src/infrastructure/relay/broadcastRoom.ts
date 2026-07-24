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
  } catch {
    /* best-effort; the surface still works without live push */
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

/** Notify every open surface that a durable chat message was appended. */
export async function broadcastBrainChatChanged(
  ns: DurableObjectNamespace | undefined,
  tenantId: number | string,
  chatId: number | string,
): Promise<void> {
  return broadcastRoom(ns, brainChatRoomName(tenantId, chatId));
}

/** Push a `{type:"changed"}` signal to a project's live board room (see {@link projectRoomName}).
 *  `tenantId` MUST match the tenant the subscribe side scoped the room with. */
export async function broadcastProjectChanged(
  ns: DurableObjectNamespace | undefined,
  tenantId: number | string | null | undefined,
  projectId: number | string | null | undefined,
): Promise<void> {
  if (tenantId == null || projectId == null) return;
  return broadcastRoom(ns, projectRoomName(tenantId, projectId));
}
