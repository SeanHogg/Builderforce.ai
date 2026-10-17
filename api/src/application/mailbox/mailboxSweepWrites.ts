/**
 * mailboxSweepWrites — when the frequent mailbox sweeps are allowed to write. Pure
 * predicates + named cadences; the sweeps own the I/O.
 *
 * Both sweeps run on the 5-minute tick and both used to write on every pass whether
 * or not anything had happened:
 *
 *   • mailbox-push: a `poll`-mode watch was UPDATEd (cursor, last_delta_at, status,
 *     last_error, updated_at) after every drain, even when the delta was empty and the
 *     cursor came back unchanged. See {@link watchDrainNeedsWrite}.
 *   • mailbox-automation: the stale-`processing` reap DELETE ran unconditionally at the
 *     top of every pass, including on deployments with no enabled rule at all. See
 *     {@link MAILBOX_AUTOMATION_REAP_INTERVAL_MS}.
 */

/**
 * Must a drained watch row be written back?
 *
 * Yes when the provider handed back a different cursor (there is something new to
 * remember — losing it would replay the window), or when the row is carrying a state
 * the successful drain has to clear (`status` not `active`, or a recorded `last_error`).
 * An empty delta on a healthy watch changes nothing, so it writes nothing — which means
 * `last_delta_at` now records the last drain that MOVED the cursor, not the last poll.
 */
export function watchDrainNeedsWrite(
  row: { cursor: string | null; status: string; lastError: string | null },
  nextCursor: string | null,
): boolean {
  return (row.cursor ?? null) !== (nextCursor ?? null)
    || row.status !== 'active'
    || row.lastError !== null;
}

/**
 * How often the scheduled automation sweep reaps claims stuck in `processing`.
 *
 * A claim is only reaped once it is 30 minutes stale, so reaping every 5 minutes bought
 * nothing but a DELETE per tick. Once per this interval (a KV marker, see
 * {@link MAILBOX_AUTOMATION_REAP_MARKER_KEY}) bounds the extra wait for a crashed claim
 * to be retried at 15 minutes, and the reap is skipped outright when no enabled rule
 * exists, since nothing can then claim the message again anyway.
 */
export const MAILBOX_AUTOMATION_REAP_INTERVAL_MS = 15 * 60_000;

/** KV key of the "reaped recently" marker for the scheduled (all-tenant) sweep. */
export const MAILBOX_AUTOMATION_REAP_MARKER_KEY = 'cron:mailbox-automation:reaped';

/** Age after which a `processing` claim is presumed dead and released. */
export const MAILBOX_AUTOMATION_STALE_PROCESSING_MS = 30 * 60_000;
