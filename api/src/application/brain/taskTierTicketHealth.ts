/**
 * taskTierTicketHealth — health for the three kinds that live in the `tasks` table
 * (task, gap, epic): leaf status ladder, epic child rollup (raw — `ticketHealthBatch`
 * applies the shared "only a closed lane may emit 100" rule to every kind), and the
 * parent epic each row hangs under. Batched: a
 * constant handful of queries however many task-tier links a chat carries.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { effectiveTaskStatus, isClosedTaskStatus } from '@builderforce/agent-loop';
import { tasks, projects } from '../../infrastructure/database/schema';
import { closedTaskSql } from '../../infrastructure/database/taskClosedSql';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { buildTaskProgressBreakdown } from '../task/taskProgressBreakdown';
import type { Db } from '../../infrastructure/database/connection';
import { missingTicket, ticketKey, ticketKindForTaskType, type TicketHealth, type TicketParent } from './chatTicketTypes';

/**
 * Container rollup: count a child as done the same way a leaf chip does — its LANE is
 * closed (the shared closed class, so a cancelled child is owed nothing). "Done" means
 * the lane is closed: a stamped `completed_at` on an open lane is not done, so an
 * epic's done/total and its children's chips always agree. (`count(completed_at)` alone
 * once reported 0/N for children that were Done by status only.) An ARCHIVED child
 * counts done too, whatever its stale lane — the same rule as the self-row rewrite below
 * (`effectiveTaskStatus`), read through the ONE closed-task SQL fragment.
 */
export const SQL_COUNT_DONE = sql<number>`coalesce(sum(CASE WHEN ${closedTaskSql()} THEN 1 ELSE 0 END), 0)`;

/**
 * Name the PARENT of every task-tier row that has one — child task ⇒ its epic,
 * sub-epic ⇒ the epic above it.
 *
 * Costs at most ONE query however many rows come in, and none at all when nothing
 * in the batch has a `parentTaskId`: parents that are already among the self rows
 * (a chat linked to both the epic and its tasks — the common case) are named for
 * free, and only the ids still unresolved are fetched, in a single `IN (...)`.
 * That keeps the health batch's constant-query-count promise intact — never one
 * lookup per link.
 *
 * A parent that no longer exists, or that lives in another tenant, simply does not
 * resolve: the caller reports NO parent rather than inventing a hierarchy or
 * leaking a cross-tenant title.
 */
async function resolveTaskParents(
  db: Db,
  tenantId: number,
  selfRows: ReadonlyArray<{ id: number; title: string; taskType?: string | null; parentTaskId?: number | null }>,
): Promise<Map<number, TicketParent>> {
  const byChild = new Map<number, TicketParent>();
  const wanted = new Set<number>();
  for (const r of selfRows) {
    if (r.parentTaskId == null) continue;
    const pid = Number(r.parentTaskId);
    if (Number.isInteger(pid) && pid > 0) wanted.add(pid);
  }
  if (wanted.size === 0) return byChild;

  const known = new Map<number, { title: string; taskType?: string | null }>();
  for (const r of selfRows) if (wanted.has(r.id)) known.set(r.id, r);

  const unresolved = [...wanted].filter((id) => !known.has(id));
  if (unresolved.length > 0) {
    const parentRows = await db
      .select({ id: tasks.id, title: tasks.title, taskType: tasks.taskType })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(and(inArray(tasks.id, unresolved), eq(projects.tenantId, tenantId)));
    for (const p of parentRows) known.set(Number(p.id), p);
  }

  for (const r of selfRows) {
    if (r.parentTaskId == null) continue;
    const pid = Number(r.parentTaskId);
    const p = known.get(pid);
    if (!p) continue;
    byChild.set(r.id, { kind: ticketKindForTaskType(p.taskType), ref: String(pid), label: p.title });
  }
  return byChild;
}

/**
 * Write task/gap/epic health into `out`. Tasks + epics + gaps share the tasks table:
 * fetch self rows (title/status) for all, plus child rollups for epics. Gaps are leaf
 * work items (like tasks). Every row additionally carries {@link TicketHealth.parent}.
 */
export async function addTaskTierHealth(
  db: Db,
  tenantId: number,
  ids: { taskIds: Set<number>; epicIds: Set<number>; gapIds: Set<number> },
  out: Map<string, TicketHealth>,
): Promise<void> {
  const { taskIds, epicIds, gapIds } = ids;
  const allTaskLike = [...taskIds, ...epicIds, ...gapIds];
  if (allTaskLike.length === 0) return;
  const rows = await db
    .select({
      id: tasks.id, title: tasks.title, status: tasks.status,
      // Named so the rail can say which epic a chip belongs to (see resolveTaskParents).
      taskType: tasks.taskType, parentTaskId: tasks.parentTaskId,
      archived: tasks.archived,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(inArray(tasks.id, allTaskLike), eq(projects.tenantId, tenantId)));
  // An ARCHIVED ticket is off the board — it reads as the closed `archived` status
  // (agent-loop `effectiveTaskStatus`), never as its stale open lane, so the rail counts it
  // complete and "Hide done" hides it.
  const selfById = new Map(rows.map((r) => [r.id, { ...r, status: effectiveTaskStatus(r) }]));
  // ONE extra batched query at most — the parents not already among these rows.
  const parentByChild = await resolveTaskParents(db, tenantId, rows);

  // Tasks and gaps are both leaf work items — identical health derivation.
  for (const kind of ['task', 'gap'] as const) {
    for (const id of kind === 'task' ? taskIds : gapIds) {
      const r = selfById.get(id);
      if (!r) { out.set(ticketKey(kind, String(id)), missingTicket(kind, String(id))); continue; }
      const parent = parentByChild.get(id);
      // "Done" means the lane is closed — a `completed_at` stamped on an open lane is not.
      const done = isClosedTaskStatus(r.status) ? 1 : 0;
      // Delegate to the canonical status ladder so a chat ticket chip and the task list
      // API never disagree about the same task (in_review is 75, not 50). The ladder
      // already applies the shared "only a closed lane emits 100" rule.
      const progressPct = buildTaskProgressBreakdown({ status: r.status }).progressPct;
      out.set(ticketKey(kind, String(id)), {
        kind, ref: String(id), label: r.title, status: r.status,
        progressPct,
        done, total: 1, exists: true,
        ...(parent ? { parent } : {}),
      });
    }
  }

  if (epicIds.size === 0) return;
  const childRows = await db
    .select({
      parentId: tasks.parentTaskId,
      total: sql<number>`count(*)`,
      done: SQL_COUNT_DONE,
    })
    .from(tasks)
    .where(scopedToTenant(tasks, tenantId, inArray(tasks.parentTaskId, [...epicIds])))
    .groupBy(tasks.parentTaskId);
  const childByParent = new Map(childRows.map((r) => [Number(r.parentId), { total: Number(r.total), done: Number(r.done) }]));
  for (const id of epicIds) {
    const r = selfById.get(id);
    if (!r) { out.set(ticketKey('epic', String(id)), missingTicket('epic', String(id))); continue; }
    const c = childByParent.get(id) ?? { total: 0, done: 0 };
    const total = c.total;
    const done = c.done;
    // The RAW child rollup. `ticketHealthBatch` applies the shared rule to every row once
    // (agent-loop `effectiveTicketProgress`): only a closed lane may emit 100, and a closed
    // lane always does — even with 3 of 5 children done. An open epic whose filed children
    // are all done reads the claimed-complete rung (75): unfiled work can remain until the
    // lane closes.
    const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;
    const parent = parentByChild.get(id);
    out.set(ticketKey('epic', String(id)), {
      kind: 'epic', ref: String(id), label: r.title, status: r.status, progressPct, done, total, exists: true,
      ...(parent ? { parent } : {}),
    });
  }
}
