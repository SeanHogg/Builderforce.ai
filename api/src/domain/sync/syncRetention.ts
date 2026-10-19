/**
 * Domain — sync retention windows (epic #5747 item 5, ticket #5850 follow-up).
 *
 * `idempotentApply.ts` guarantees that a replayed `eventId` returns the first
 * receipt and does not add a second row. That guarantee is bounded by how long
 * the receipt row survives. `sync_events` is retained for 90 days; after the
 * row is swept the uniqueness lookup finds nothing, and the SAME event id
 * arriving again would be applied as `accepted` — a silent duplicate.
 *
 * Nothing in the sync write path says that out loud. This module owns the two
 * retention windows and the statement that uniqueness does not outlive them.
 *
 * Pure: no database, no HTTP. `sweptTables.ts` registers these constants on the
 * sweeper; a late-replay guard consults `uniquenessSurvivesRetention`.
 */

/** How long a sync event receipt is kept before the sweeper removes it. */
export const SYNC_EVENT_RETENTION_DAYS = 90;

/** How long a recorded sync change is kept before the sweeper removes it. */
export const SYNC_CHANGE_RETENTION_DAYS = 30;

/** The tables this module sets a retention window for. */
export const SYNC_RETENTION_TABLES = ['sync_events', 'sync_changes'] as const;

export type SyncRetentionTable = (typeof SYNC_RETENTION_TABLES)[number];

/**
 * Whether a row of `table` at `ageInDays` is old enough to sweep.
 *
 * True only for `sync_events` at >= 90 days and `sync_changes` at >= 30 days.
 * Every other table — including a table registered with the sweeper by another
 * feature — is false: this module does not own its retention, so it must never
 * be the thing that sweeps it.
 */
export function shouldSweep(table: string, ageInDays: number): boolean {
  if (!Number.isFinite(ageInDays) || ageInDays < 0) return false;
  if (table === 'sync_events') return ageInDays >= SYNC_EVENT_RETENTION_DAYS;
  if (table === 'sync_changes') return ageInDays >= SYNC_CHANGE_RETENTION_DAYS;
  return false;
}

/**
 * Whether a receipt at `ageInDays` is still able to prove an event id was
 * already applied.
 *
 * True below 90 days, false at 90 days and beyond. A caller that receives a
 * replay this late must NOT treat it as a duplicate: the row that would have
 * proved it has been swept, so the apply is a new accept.
 */
export function uniquenessSurvivesRetention(ageInDays: number): boolean {
  if (!Number.isFinite(ageInDays)) return false;
  return ageInDays < SYNC_EVENT_RETENTION_DAYS;
}

/**
 * The consequence in words, for the retention register and for any code review
 * that reads only the sweeper config.
 */
export const RETENTION_NOTE =
  'Event-id uniqueness does not survive retention. A sync_events receipt is kept for ' +
  `${SYNC_EVENT_RETENTION_DAYS} days and a sync_changes row for ${SYNC_CHANGE_RETENTION_DAYS} days; after those windows ` +
  'the sweeper removes them. The idempotency guarantee that a replayed event id returns the first receipt ' +
  'therefore holds only inside the event retention window. Once the receipt row is swept, the same event id ' +
  'arriving again is indistinguishable from a first delivery, so it must be treated as a new accept rather ' +
  'than a duplicate — callers should consult uniquenessSurvivesRetention and refuse to treat a late replay as a duplicate.';