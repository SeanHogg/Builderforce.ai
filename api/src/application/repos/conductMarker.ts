/**
 * conductMarker — "the PR-conduct sweep EXAMINED this ticket recently", on the manager
 * journal (`manager_actions`), so stall triage can tell a ticket the sweep owns from one it
 * merely would own if it were running.
 *
 * ── WHY A MARKER ─────────────────────────────────────────────────────────────────────
 * `isConductedBySweep` used to be derived from ticket state alone ("in review, no live run,
 * policy is not queue"). But the sweep is silent when the `pr-ticket-reconciler` control is
 * off, when the project's manager config is disabled, when the tenant's dispatch budget has
 * no room, or when the ticket sits past the per-tick cap — and in each case triage then
 * withheld its remedy for a ticket nobody was conducting. The only honest evidence that the
 * sweep owns a ticket is that it recently looked at it.
 *
 * ── COST ─────────────────────────────────────────────────────────────────────────────
 * No new table: the marker is a `manager_actions` row (`conduct_seen`). The no-op outcomes
 * (wait_for_run, await_merge, …) journal nothing else, so a row per ticket per tick would
 * be the same every-pass duplicate `managerActionJournal` exists to prevent. The stamp is
 * therefore REFRESHED at most every {@link CONDUCT_MARKER_REFRESH_MS}; triage trusts a
 * marker for {@link CONDUCT_DEFERRAL_WINDOW_MS} (three refresh periods), so one missed
 * tick never flaps ownership. Both reads are ONE batched query per project.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { managerActions } from '../../infrastructure/database/schema';
import { reportCaughtError } from '../observability/caughtErrorReporter';
import { CONDUCT_MARKER_ACTION, recordManagerAction } from '../manager/managerActionJournal';

export { CONDUCT_MARKER_ACTION };

/** A ticket's marker is rewritten no more often than this. */
export const CONDUCT_MARKER_REFRESH_MS = 10 * 60_000;

/** Triage defers to the sweep only for a ticket conducted within this window. */
export const CONDUCT_DEFERRAL_WINDOW_MS = 3 * CONDUCT_MARKER_REFRESH_MS;

/** When each of `taskIds` was last examined by the sweep. One query. Absent = never / unreadable. */
export async function loadConductMarkers(
  db: Db, args: { tenantId: number; projectId: number; taskIds: readonly number[] },
): Promise<Map<number, Date>> {
  const out = new Map<number, Date>();
  if (!args.taskIds.length) return out;
  try {
    const rows = await db
      .select({ taskId: managerActions.taskId, at: sql<Date>`max(${managerActions.createdAt})` })
      .from(managerActions)
      .where(and(
        eq(managerActions.tenantId, args.tenantId),
        eq(managerActions.projectId, args.projectId),
        eq(managerActions.actionType, CONDUCT_MARKER_ACTION),
        inArray(managerActions.taskId, [...args.taskIds]),
      ))
      .groupBy(managerActions.taskId);
    for (const r of rows) if (r.taskId != null && r.at) out.set(r.taskId, new Date(r.at as unknown as string));
  } catch (error) {
    // Unreadable marker => "not recently conducted", the safe side: triage keeps its remedy.
    reportCaughtError(error, {
      source: 'application/repos/conductMarker.ts', operation: 'loadConductMarkers',
      level: 'warning', context: { tenantId: args.tenantId, projectId: args.projectId },
    });
  }
  return out;
}

/** PURE: was this ticket conducted within the deferral window? */
export function conductedRecently(markers: ReadonlyMap<number, Date>, taskId: number, now: number): boolean {
  const at = markers.get(taskId);
  return at != null && now - at.getTime() < CONDUCT_DEFERRAL_WINDOW_MS;
}

/** The ids among `taskIds` the sweep conducted recently — what triage defers to. */
export async function loadRecentlyConducted(
  db: Db, args: { tenantId: number; projectId: number; taskIds: readonly number[]; now: number },
): Promise<Set<number>> {
  const markers = await loadConductMarkers(db, args);
  return new Set(args.taskIds.filter((id) => conductedRecently(markers, id, args.now)));
}

/**
 * Stamp one examined ticket, unless its marker is still fresh. Returns true when a row was
 * written. Best-effort (the journal write never throws).
 */
export async function stampConducted(
  db: Db,
  args: { tenantId: number; projectId: number; taskId: number; title: string; now: number },
  markers: Map<number, Date>,
): Promise<boolean> {
  const at = markers.get(args.taskId);
  if (at != null && args.now - at.getTime() < CONDUCT_MARKER_REFRESH_MS) return false;
  if (at != null) {
    // ONE row per ticket, refreshed in place: the table never accumulates a row per interval.
    try {
      await db.update(managerActions).set({ createdAt: new Date(args.now) }).where(and(
        eq(managerActions.tenantId, args.tenantId),
        eq(managerActions.projectId, args.projectId),
        eq(managerActions.taskId, args.taskId),
        eq(managerActions.actionType, CONDUCT_MARKER_ACTION),
      ));
      markers.set(args.taskId, new Date(args.now));
      return true;
    } catch { return false; }
  }
  await recordManagerAction(db, {
    tenantId: args.tenantId, projectId: args.projectId, taskId: args.taskId,
    actionType: CONDUCT_MARKER_ACTION,
    summary: `PR conduct examined "${args.title}"`,
  });
  markers.set(args.taskId, new Date(args.now));
  return true;
}
