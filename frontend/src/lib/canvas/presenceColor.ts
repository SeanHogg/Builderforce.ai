/**
 * One colour per person, everywhere they appear.
 *
 * The remote-cursor layer used to colour by the INDEX of the member in the
 * filtered list — so a person's colour changed whenever somebody above them in
 * the roster joined or left, and the same person was a different colour on two
 * screens at the same moment. Colour is only useful as identity if it is
 * derived from identity, so it is hashed from the user id and nothing else.
 *
 * Four tokens, declared in both themes (`--canvas-presence-1..4`). The palette
 * is deliberately small: these are read at a glance against a busy board, not
 * looked up in a legend.
 */

export const PRESENCE_COLOR_COUNT = 4;

/** A stable `var(--canvas-presence-N)` for this user id. */
export function presenceColor(userId: string): string {
  return `var(--canvas-presence-${presenceColorIndex(userId) + 1})`;
}

/** The 0-based slot this user id hashes to. Exported for assertions. */
export function presenceColorIndex(userId: string): number {
  // FNV-1a over the id. Any stable hash would do; this one is short, has no
  // dependencies and spreads short ids (which real user ids often are) better
  // than summing char codes.
  let hash = 0x811c9dc5;
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return Math.abs(hash) % PRESENCE_COLOR_COUNT;
}
