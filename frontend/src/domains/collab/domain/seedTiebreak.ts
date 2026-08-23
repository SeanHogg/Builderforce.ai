/**
 * Decide whether THIS client should seed a freshly-opened shared document.
 *
 * The room is server-authoritative and answers the Yjs sync handshake, so by the
 * time a client is SYNCED the shared state either already holds the document or
 * the document has genuinely never existed. The one moment that still needs a
 * rule is two people opening the SAME never-edited document at once: both see an
 * empty shared array after syncing, and both are locally certain they are first.
 *
 * Seeding is therefore restricted to whichever participant sorts lowest by user
 * id among everyone visibly present (self + awareness peers) — deterministic, so
 * two clients computing it independently reach the same answer without talking to
 * each other. A lone first editor has no peers and so always seeds.
 */
export function shouldSeed(
  selfUserId: string,
  peerUserIds: readonly string[],
  sharedIsEmpty: boolean,
  hasContentToSeed: boolean,
): boolean {
  if (!sharedIsEmpty || !hasContentToSeed) return false;
  const everyone = [selfUserId, ...peerUserIds];
  const min = everyone.reduce((lowest, id) => (id < lowest ? id : lowest), selfUserId);
  return min === selfUserId;
}
