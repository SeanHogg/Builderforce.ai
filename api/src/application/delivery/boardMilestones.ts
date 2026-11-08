/**
 * BOARD MILESTONES — the investor seam's read of delivery.
 *
 * A board reaches a milestone when an EPIC on it completes or a PRODUCT RELEASE
 * scoped to its project ships. Both facts already exist (`tasks.completed_at` on an
 * epic, `product_releases.released_at`); this module only reads them, joined to the
 * board and to the budget the board earned along the way, so there is no milestone
 * table to drift from the work it describes.
 *
 * Consumed by the investor update (`listBoardMilestonesSince`) and by the board's
 * own budget panel (`readBoardBudget`).
 */

import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { boards, ledgerEntries, productReleases, tasks } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { POINTS } from '../kernel/denominations';
import { BOARD_EARN_PREFIX } from './boardBudgetKeys';

export interface BoardMilestone {
  boardId: string;
  boardName: string;
  milestone: string;
  reachedAt: string;
  /** Points the board earned from the tickets that made up the milestone. */
  earnedPoints: number;
  /** The completed epic's `tasks.id`, as a string. Set only for an epic milestone. */
  taskId?: string;
  /** The `product_releases.id`. Set only for a release milestone. */
  releaseId?: string;
}

export interface MilestoneQuery {
  tenantId: number;
  since: Date;
  /** Exclusive upper bound; with `since` it selects a past window. */
  until?: Date;
  /** Restrict to one board (the board's own panel). */
  boardId?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

interface RawMilestone { key: string; boardId: string; boardName: string; name: string; at: Date; epicId?: number; releaseId?: string }

export async function listBoardMilestonesSince(db: Db, q: MilestoneQuery): Promise<BoardMilestone[]> {
  const limit = Math.min(Math.max(q.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const boardFilter = q.boardId ? eq(boards.id, q.boardId) : undefined;

  const [epics, releases] = await Promise.all([
    db.select({ id: tasks.id, title: tasks.title, at: tasks.completedAt, boardId: boards.id, boardName: boards.name })
      .from(tasks)
      .innerJoin(boards, and(eq(boards.projectId, tasks.projectId), eq(boards.tenantId, tasks.tenantId)))
      .where(scopedToTenant(tasks, q.tenantId, eq(tasks.taskType, 'epic'), gte(tasks.completedAt, q.since), q.until ? lt(tasks.completedAt, q.until) : undefined, boardFilter))
      .orderBy(desc(tasks.completedAt)).limit(limit),
    db.select({ id: productReleases.id, name: productReleases.name, version: productReleases.version, at: productReleases.releasedAt, boardId: boards.id, boardName: boards.name })
      .from(productReleases)
      .innerJoin(boards, and(eq(boards.projectId, productReleases.projectId), eq(boards.tenantId, productReleases.tenantId)))
      .where(scopedToTenant(productReleases, q.tenantId, eq(productReleases.status, 'released'), gte(productReleases.releasedAt, q.since), q.until ? lt(productReleases.releasedAt, q.until) : undefined, boardFilter))
      .orderBy(desc(productReleases.releasedAt)).limit(limit),
  ]);

  const raw: RawMilestone[] = [
    ...epics.filter((e) => e.at).map((e) => ({ key: `epic:${e.id}`, boardId: e.boardId, boardName: e.boardName, name: e.title, at: e.at as Date, epicId: e.id })),
    ...releases.filter((r) => r.at).map((r) => ({
      key: `release:${r.id}`, boardId: r.boardId, boardName: r.boardName,
      name: r.version ? `${r.name} ${r.version}` : r.name, at: r.at as Date, releaseId: r.id,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
  if (raw.length === 0) return [];

  const earned = await earnedByMilestone(db, q.tenantId, raw);
  return raw.map((m) => ({
    boardId: m.boardId,
    boardName: m.boardName,
    milestone: m.name,
    reachedAt: m.at.toISOString(),
    earnedPoints: earned.get(m.key) ?? 0,
    ...(m.epicId != null ? { taskId: String(m.epicId) } : {}),
    ...(m.releaseId ? { releaseId: m.releaseId } : {}),
  }));
}

/** Every ticket under each epic at ANY depth (sub-epics included): one recursive query. */
async function epicDescendants(db: Db, tenantId: number, epicIds: number[]): Promise<Array<{ rootId: number; id: number }>> {
  if (epicIds.length === 0) return [];
  const roots = sql.join(epicIds.map((id) => sql`${id}`), sql`, `);
  const res = await db.execute(sql`
    WITH RECURSIVE sub(root_id, id) AS (
      SELECT t.parent_task_id, t.id FROM tasks t
       WHERE t.tenant_id = ${tenantId} AND t.parent_task_id IN (${roots})
      UNION
      SELECT s.root_id, t.id FROM tasks t JOIN sub s ON t.parent_task_id = s.id
       WHERE t.tenant_id = ${tenantId}
    )
    SELECT root_id, id FROM sub
  `);
  const list = (res as unknown as { rows?: unknown[] }).rows ?? (res as unknown as unknown[]);
  return (list as Array<{ root_id: number | string; id: number | string }>).map((r) => ({ rootId: Number(r.root_id), id: Number(r.id) }));
}

/** Points earned by each milestone's tickets — batched reads, never one per milestone. */
async function earnedByMilestone(db: Db, tenantId: number, raw: RawMilestone[]): Promise<Map<string, number>> {
  const epicIds = raw.flatMap((m) => (m.epicId != null ? [m.epicId] : []));
  const releaseIds = raw.flatMap((m) => (m.releaseId ? [m.releaseId] : []));
  const [descendants, releaseMembers] = await Promise.all([
    epicDescendants(db, tenantId, epicIds),
    releaseIds.length
      ? db.select({ id: tasks.id, releaseId: tasks.releaseId }).from(tasks)
          .where(scopedToTenant(tasks, tenantId, inArray(tasks.releaseId, releaseIds)))
      : Promise.resolve([] as Array<{ id: number; releaseId: string | null }>),
  ]);
  const memberIds = [...new Set([...descendants.map((d) => d.id), ...releaseMembers.map((t) => t.id)])];
  if (memberIds.length === 0) return new Map();

  const rows = await db
    .select({ reference: ledgerEntries.reference, amount: ledgerEntries.amount })
    .from(ledgerEntries)
    .where(and(
      eq(ledgerEntries.tenantId, tenantId),
      eq(ledgerEntries.accountKind, 'board'),
      eq(ledgerEntries.denomination, POINTS),
      inArray(ledgerEntries.reference, memberIds.map((id) => `${BOARD_EARN_PREFIX}${id}`)),
    ));
  const byTask = new Map(rows.map((r) => [r.reference, Number(r.amount)]));

  const totals = new Map<string, number>();
  const add = (key: string, taskId: number) => totals.set(key, (totals.get(key) ?? 0) + (byTask.get(`${BOARD_EARN_PREFIX}${taskId}`) ?? 0));
  for (const d of descendants) add(`epic:${d.rootId}`, d.id);
  for (const t of releaseMembers) if (t.releaseId) add(`release:${t.releaseId}`, t.id);
  return totals;
}
