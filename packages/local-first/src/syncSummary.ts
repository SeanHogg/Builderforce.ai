/** The counts a sync run reports, and how a partition's counts add into a run's. Pure. */
import type { SyncReceipt } from './records.js';

export interface SyncSummary {
  pulled: number;
  pushed: number;
  duplicates: number;
  conflicts: number;
  rejected: number;
  dependencyPending: number;
  bytes: number;
  /**
   * Pending events refused because their record is unbound. They stay in the
   * journal, unsent and unacknowledged, and count for nothing else here.
   */
  unboundRefused: number;
}

export function emptySyncSummary(unboundRefused = 0): SyncSummary {
  return { pulled: 0, pushed: 0, duplicates: 0, conflicts: 0, rejected: 0, dependencyPending: 0, bytes: 0, unboundRefused };
}

export function addSyncSummary(into: SyncSummary, part: SyncSummary): void {
  into.pulled += part.pulled;
  into.pushed += part.pushed;
  into.duplicates += part.duplicates;
  into.conflicts += part.conflicts;
  into.rejected += part.rejected;
  into.dependencyPending += part.dependencyPending;
  into.bytes += part.bytes;
  into.unboundRefused += part.unboundRefused;
}

/** Counts one receipt under its status. */
export function countReceipt(summary: SyncSummary, status: SyncReceipt['status']): void {
  if (status === 'accepted') summary.pushed += 1;
  if (status === 'duplicate') summary.duplicates += 1;
  if (status === 'conflict') summary.conflicts += 1;
  if (status === 'rejected') summary.rejected += 1;
  if (status === 'dependency_pending') summary.dependencyPending += 1;
}
