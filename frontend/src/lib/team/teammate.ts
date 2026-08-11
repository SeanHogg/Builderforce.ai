/**
 * How a teammate joins a session (PRD 21 §3.3).
 *
 * "Drag a teammate onto the board → it joins the session, takes a seat, appears
 * in presence, and can be addressed in the composer." And, in the same breath:
 * "**Keyboard parity is mandatory.** Focus + `Enter` does the same thing. A drag
 * must never be the only route in."
 *
 * Both routes carry the SAME payload through this module, which is the point of
 * it existing: a drag serialises it onto the `DataTransfer`, a keypress puts it
 * on a `CustomEvent`, and the board has one handler for both. The alternative —
 * a MIME string in the footer and a matching literal in the canvas — is the
 * shape that drifts silently the first time either side is edited.
 */

/** The drag payload's MIME type. Namespaced so a stray text drop is not mistaken
 *  for a teammate, and declared once so the source and the target agree. */
export const TEAMMATE_DND_MIME = 'application/x-builderforce-teammate';

/** The keyboard route's event name — dispatched on `window`, handled by whichever
 *  board is on the stage. */
export const TEAMMATE_JOIN_EVENT = 'builderforce:teammate-join';

/** What travels: the minimum the board needs to seat someone and address them. */
export interface TeammatePayload {
  kind: 'human' | 'agent';
  /** `users.id`, `ide_agents.id`, or `seat:<domain>` for an unprovisioned seat. */
  ref: string;
  name: string;
  /** Seat title or workspace role — what the seated object is labelled with. */
  role: string | null;
  /** Built-in seats keep their stable product identity when they cross the
   *  footer/canvas boundary. Custom agents and humans leave both fields null. */
  seat: string | null;
  domain: string | null;
}

export function serializeTeammate(payload: TeammatePayload): string {
  return JSON.stringify(payload);
}

/** Parse a payload back, returning null for anything that is not one — a drop
 *  target must never trust the transfer it was handed. */
export function parseTeammate(raw: string | null | undefined): TeammatePayload | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<TeammatePayload>;
    if (typeof value?.ref !== 'string' || typeof value?.name !== 'string') return null;
    if (value.kind !== 'human' && value.kind !== 'agent') return null;
    return {
      kind: value.kind,
      ref: value.ref,
      name: value.name,
      role: typeof value.role === 'string' ? value.role : null,
      seat: typeof value.seat === 'string' ? value.seat : null,
      domain: typeof value.domain === 'string' ? value.domain : null,
    };
  } catch {
    return null;
  }
}

/** Read a teammate off a drag event, or null when the drag carries something else. */
export function teammateFromDrag(dataTransfer: DataTransfer | null): TeammatePayload | null {
  return parseTeammate(dataTransfer?.getData(TEAMMATE_DND_MIME));
}

/** The keyboard route. Same payload, same handler on the other end. */
export function requestTeammateJoin(payload: TeammatePayload): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<TeammatePayload>(TEAMMATE_JOIN_EVENT, { detail: payload }));
}
