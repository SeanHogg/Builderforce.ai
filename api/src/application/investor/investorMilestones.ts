/**
 * The investor seam's read of "what shipped that investors should hear about".
 *
 * ── WHY A READ AND NOT AN EVENT TABLE ────────────────────────────────────────
 * `workitem.released` leaves the platform as an outbound webhook and nobody inside
 * the platform listened. A milestone is a FACT about a work item (`tasks.investor_milestone`
 * plus `tasks.completed_at`), so the investor update and the board pack ask the
 * work item directly, over a window. Recording the same fact in a second table
 * would be a second answer to "did it ship", and the first thing to diverge would
 * be a reopened ticket.
 *
 * ── ONE FUNCTION, ONE WINDOW RULE ────────────────────────────────────────────
 * `listShippedMilestones` takes an explicit `{since, until}` and both sources use the
 * half-open range `[since, until)`. `sendInvestorUpdate` captures `until` once at the
 * start of a send and stores it on the delivery rows (`payload.milestonesUntil`), and
 * the next update starts there, so consecutive updates tile with no gap and no overlap.
 * The board pack passes its own period. The result is a union keyed by `source`, so
 * board-level milestones (earned by a board, not by one ticket) sit beside work items
 * without a second list or renderer.
 *
 * ── WHY IT IS NOT CACHED ─────────────────────────────────────────────────────
 * It is read only on a preview, a send and a board pack, and the work-item read is
 * served by the partial index `idx_tasks_investor_milestone_completed`. Correct
 * invalidation would need hooks in writers owned by other domains (reopen, archive,
 * releases), and a stale list in an email to investors is worse than one extra
 * indexed query.
 */

import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { deliveries, tasks } from '../../infrastructure/database/schema';
import { listBoardMilestonesSince } from '../delivery/boardMilestones';

/** A work item flagged as an investor milestone that reached a done lane in the window. */
export interface WorkItemMilestone {
  source: 'work_item';
  id: string;
  title: string;
  /** ISO instant the work item entered its done lane. */
  reachedAt: string;
  key: string;
  projectId: number;
}

/** A milestone a board earned (listBoardMilestonesSince, delivery domain). */
export interface BoardSourcedMilestone {
  source: 'board';
  id: string;
  title: string;
  reachedAt: string;
  boardId: string;
  boardName: string;
  earnedPoints: number;
  taskId?: string;
  releaseId?: string;
}

export type InvestorMilestone = WorkItemMilestone | BoardSourcedMilestone;

/** The fields of a `listBoardMilestonesSince` item the merge reads. */
export type BoardMilestoneRow = Pick<BoardSourcedMilestone, 'boardId' | 'boardName' | 'earnedPoints' | 'reachedAt'> & {
  milestone: string;
  /** The epic's tasks.id (epic milestones only). */
  taskId?: string;
  /** product_releases.id (release milestones only). */
  releaseId?: string;
};

export interface MilestoneWindow { since: Date; until: Date }

export interface ShippedMilestones {
  /** The newest {@link MAX_MILESTONES}, newest first. */
  milestones: InvestorMilestone[];
  /** How many more fell in the window than are listed. */
  moreCount: number;
}

/** With no earlier update to measure from, look back this far. */
export const DEFAULT_MILESTONE_LOOKBACK_DAYS = 90;
/** A milestone list is read on a send or a pack, not browsed; this many are listed. */
export const MAX_MILESTONES = 50;
/** Rows pulled per source (the board source clamps its limit to 500 too). `moreCount` is exact
 *  only while each source has at most this many rows in the window; beyond that it is a floor. */
const FETCH_CAP = 500;

/** THE window rule, for both sources: half-open `[since, until)`. */
export function inMilestoneWindow(reachedAt: string | Date, window: MilestoneWindow): boolean {
  const at = new Date(reachedAt).getTime();
  return at >= window.since.getTime() && at < window.until.getTime();
}

/**
 * Merge the flagged work items with the board's milestones, newest first.
 *
 * - Both sources are held to the same `[since, until)` window (the board source also cuts
 *   `until` in SQL; the shared check here is the one place the rule is stated and tested).
 * - A board entry whose epic is in `excludedTaskIds` (archived, or carrying the explicit
 *   flag — flagged ones are already in the work-item set or deliberately out of it) is dropped.
 * - Truncation happens AFTER all of that, keeping the newest {@link MAX_MILESTONES}.
 */
export function mergeMilestones(
  workItems: readonly WorkItemMilestone[],
  boardRows: readonly BoardMilestoneRow[],
  window: MilestoneWindow,
  excludedTaskIds: ReadonlySet<string> = new Set(),
): ShippedMilestones {
  const boardItems: BoardSourcedMilestone[] = boardRows
    .filter((m) => inMilestoneWindow(m.reachedAt, window) && !(m.taskId && excludedTaskIds.has(m.taskId)))
    .map((m) => ({
      source: 'board' as const,
      id: m.taskId ?? m.releaseId ?? `${m.boardId}:${m.milestone}`,
      title: m.milestone, reachedAt: m.reachedAt,
      boardId: m.boardId, boardName: m.boardName, earnedPoints: m.earnedPoints,
      ...(m.taskId ? { taskId: m.taskId } : {}),
      ...(m.releaseId ? { releaseId: m.releaseId } : {}),
    }));
  const all: InvestorMilestone[] = [
    ...workItems.filter((m) => inMilestoneWindow(m.reachedAt, window)),
    ...boardItems,
  ].sort((a, b) => b.reachedAt.localeCompare(a.reachedAt));
  return { milestones: all.slice(0, MAX_MILESTONES), moreCount: Math.max(0, all.length - MAX_MILESTONES) };
}

/** The window start for "since the last update": where the previous one ended, else the lookback. */
export function resolveMilestoneWindowStart(lastWindowEnd: Date | null, now: Date): Date {
  return lastWindowEnd ?? new Date(now.getTime() - DEFAULT_MILESTONE_LOOKBACK_DAYS * 86_400_000);
}

/**
 * Where the last SENT investor update's milestone window ended: the newest
 * `payload.milestonesUntil`, falling back to `sent_at` then `created_at` for rows
 * written before the window was recorded.
 */
export async function lastInvestorUpdateWindowEnd(db: Db, tenantId: number): Promise<Date | null> {
  const [row] = await db
    .select({
      at: sql<Date | null>`max(coalesce((${deliveries.payload}->>'milestonesUntil')::timestamptz at time zone 'UTC', ${deliveries.sentAt}, ${deliveries.createdAt}))`
        .mapWith(deliveries.createdAt),
    })
    .from(deliveries)
    .where(and(
      eq(deliveries.tenantId, tenantId),
      eq(deliveries.template, 'investor_update'),
      eq(deliveries.status, 'sent'),
    ));
  return row?.at ?? null;
}

/** Milestones reached in `[since, until)`, tenant-scoped, newest first. */
export async function listShippedMilestones(
  db: Db,
  input: { tenantId: number } & MilestoneWindow,
): Promise<ShippedMilestones> {
  const { tenantId, since, until } = input;
  if (since >= until) return { milestones: [], moreCount: 0 };

  const [rows, boardRows] = await Promise.all([
    db.select({
      id: tasks.id, key: tasks.key, title: tasks.title,
      projectId: tasks.projectId, completedAt: tasks.completedAt,
    })
      .from(tasks)
      .where(and(
        eq(tasks.tenantId, tenantId),
        eq(tasks.investorMilestone, true),
        eq(tasks.archived, false),
        gte(tasks.completedAt, since),
        lt(tasks.completedAt, until),
      ))
      .orderBy(sql`${tasks.completedAt} desc`)
      .limit(FETCH_CAP),
    listBoardMilestonesSince(db, { tenantId, since, until, limit: FETCH_CAP }),
  ]);

  const workItems: WorkItemMilestone[] = rows.flatMap((row) => row.completedAt
    ? [{
      source: 'work_item' as const,
      id: String(row.id), key: row.key, title: row.title,
      projectId: row.projectId, reachedAt: row.completedAt.toISOString(),
    }]
    : []);

  // ONE query for the epics behind the board entries: an archived epic is not news, and a
  // flagged one is already in (or deliberately out of) the work-item set above.
  const epicIds = [...new Set(boardRows.flatMap((m) => (m.taskId ? [Number(m.taskId)] : [])))].filter(Number.isFinite);
  const excluded = new Set<string>();
  if (epicIds.length > 0) {
    const epics = await db
      .select({ id: tasks.id, archived: tasks.archived, flagged: tasks.investorMilestone })
      .from(tasks)
      .where(and(eq(tasks.tenantId, tenantId), inArray(tasks.id, epicIds)));
    for (const epic of epics) if (epic.archived || epic.flagged) excluded.add(String(epic.id));
  }

  return mergeMilestones(workItems, boardRows, { since, until }, excluded);
}

/** The route's payload: the window and the milestones the next update would list. */
export async function pendingInvestorMilestones(
  db: Db,
  tenantId: number,
  now: Date,
): Promise<{ since: string; until: string } & ShippedMilestones> {
  const since = resolveMilestoneWindowStart(await lastInvestorUpdateWindowEnd(db, tenantId), now);
  const shipped = await listShippedMilestones(db, { tenantId, since, until: now });
  return { since: since.toISOString(), until: now.toISOString(), ...shipped };
}
