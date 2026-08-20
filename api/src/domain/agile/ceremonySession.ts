/**
 * The lifecycle of a TEAM CEREMONY SESSION — a planning-poker session or a
 * retrospective.
 *
 * These two were modelled as ephemeral realtime rooms: `poker_sessions.status` and
 * `retrospectives.status` were created with a default of `'active'` and then NOTHING
 * in the codebase ever wrote them again. A session could be opened, voted in and
 * abandoned, but never finished — so "is this retro done?" had no answer, and any
 * consumer that tried to derive one (a progress ring, a rollup, a digest) would have
 * been reading a constant.
 *
 * They are not ambient rooms. A retro and an estimation session are work a TEAM
 * performs, with a beginning and an end, so they get the same thing every other work
 * item has: a status vocabulary, a terminal state, and one definition of "done" that
 * the write path and every reader share.
 *
 * Kept in the domain layer (no Drizzle, no Hono) precisely so the routes that WRITE a
 * status and `ChatTicketService`, which derives a completion percentage from it, can
 * never disagree about what a finished session looks like.
 */

/**
 * Every status a ceremony session may hold.
 *
 * `active`    — open; the team is still working in it (the created default).
 * `completed` — the ceremony was held and closed. Terminal.
 * `cancelled` — abandoned without being held. Terminal, and deliberately counted as
 *               done: a cancelled session is not outstanding work, and leaving it
 *               short of 100% would park a ring that can never move again.
 */
export const CEREMONY_SESSION_STATUSES = ['active', 'completed', 'cancelled'] as const;

export type CeremonySessionStatus = (typeof CEREMONY_SESSION_STATUSES)[number];

/**
 * Statuses that mean the session is FINISHED — the single definition of terminal.
 *
 * Wider than {@link CEREMONY_SESSION_STATUSES} on purpose: rows written before this
 * vocabulary existed, or by an older client, may carry `closed`/`archived`, and a
 * reader must treat those as finished rather than as permanently in-flight. The WRITE
 * path is strict ({@link isCeremonySessionStatus}); the READ path is forgiving.
 */
export const CEREMONY_SESSION_DONE: ReadonlySet<string> = new Set([
  'completed', 'cancelled', 'closed', 'archived',
]);

/** True for a status a client is allowed to SET. Case-insensitive; unknown → false,
 *  so a typo is a 400 rather than a row nothing can ever interpret. */
export function isCeremonySessionStatus(value: unknown): value is CeremonySessionStatus {
  return typeof value === 'string'
    && (CEREMONY_SESSION_STATUSES as readonly string[]).includes(value.toLowerCase());
}

/** True when a session is finished (see {@link CEREMONY_SESSION_DONE}). Tolerant of
 *  case and of a null/absent status, which means "never set" ⇒ still open. */
export function isCeremonySessionDone(status: string | null | undefined): boolean {
  return !!status && CEREMONY_SESSION_DONE.has(status.toLowerCase());
}
