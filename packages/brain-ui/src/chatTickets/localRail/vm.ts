/**
 * The view models the local-first rail pieces draw (G21 / G23). They are what a host hands
 * over; the badge, the freshness line and the sync summary draw nothing else, so the web app
 * (which passes none of them) renders the panel exactly as before.
 */

/** One record's presented sync status. */
export type RailSyncStatus = 'pending' | 'syncing' | 'synced' | 'conflict' | 'dead-letter';

/** How fresh the rail's copy is. */
export interface RailFreshnessVM {
  /** ISO instant the copy was last taken from the platform, when it ever was. */
  lastIngestedAt?: string;
  /** `device` while every row was written here; `server-observed` once the platform reported any. */
  source: 'device' | 'server-observed';
}

/** The device's sync summary. */
export interface RailSyncSummaryVM {
  mode: 'local-only' | 'hybrid' | 'specific';
  /** The account the device syncs into; `unbound` is this device only. */
  destination: { kind: 'unbound' } | { kind: 'bound'; label: string };
  queued: { items: number; bytes: number };
  conflicts: number;
  deadLetters: number;
  lastPushAt?: string;
  lastPullAt?: string;
}
