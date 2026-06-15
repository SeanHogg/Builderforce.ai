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
 */
export const projectRoomName = (projectId: number | string): string => `project:${projectId}`;

/** Push a `{type:"changed"}` signal to a project's live board room (see {@link projectRoomName}). */
export async function broadcastProjectChanged(
  ns: DurableObjectNamespace | undefined,
  projectId: number | string | null | undefined,
): Promise<void> {
  if (projectId == null) return;
  return broadcastRoom(ns, projectRoomName(projectId));
}
