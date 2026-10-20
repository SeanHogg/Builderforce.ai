/**
 * taskTierTicketHealth — health for the three kinds that live in the `tasks` table
 * (task, gap, epic): leaf status ladder, epic child rollup, the unsupported-delivery
 * cap, and the parent epic each row hangs under. Batched: a constant handful of
 * queries however many task-tier links a chat carries.
 */
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import { TASK_CLOSED_STATUSES, UNSUPPORTED_DELIVERY_PROGRESS_CAP } from '@builderforce/agent-loop';
import { tasks, projects, executions, taskFileChanges } from '../../infrastructure/database/schema';
import { scopedToTenant } from '../../infrastructure/database/tenantScope';
import { buildTaskProgressBreakdown } from '../task/taskProgressBreakdown';
import { coderProducedCode } from '../task/taskActivity';
import { liveExecution } from '../rehearsal/executionMode';
import type { Db } from '../../infrastructure/database/connection';
import { missingTicket, ticketKey, ticketKindForTaskType, type TicketHealth, type TicketParent } from './chatTicketTypes';

/** Task/epic statuses that count as complete when a ticket has no completed_at —
 *  the shared closed class, so a cancelled ticket reads done (100%), never 0%. */
const DONE_STATUS: ReadonlySet<string> = new Set(TASK_CLOSED_STATUSES);

/**
 * Container rollup: count a child as done the same way a leaf chip does
 * (`completed_at` stamped OR status in {@link DONE_STATUS}). `count(completed_at)`
 * alone reported 0/N for children that were Done by status only — the epic-close
 * chip that stayed at 0/5 after the parent shipped.
 */
export const SQL_COUNT_DONE = sql<number>`coalesce(sum(CASE WHEN ${tasks.completedAt} IS NOT NULL OR ${inArray(tasks.status, [...TASK_CLOSED_STATUSES])} THEN 1 ELSE 0 END), 0)`;

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
 * Epics that read complete, but a live execution on the epic or a direct child
 * exists and no coder run left a non-documentation file.
 *
 * Same grain as the child rollup (one parent hop) and the same evidence as
 * `summarizeTaskActivity`'s `staleImplementation`. No executions ⇒ unknown,
 * not unsupported: absence is not evidence, and a genuinely closed epic with
 * no run history must still emit 100.
 */
async function epicsWithUnsupportedDelivery(db: Db, tenantId: number, epicIds: number[]): Promise<Set<number>> {
  const unsupported = new Set<number>();
  if (epicIds.length === 0) return unsupported;
  const wanted = new Set(epicIds);
  const execRows = await db
    .select({
      id: executions.id,
      taskId: executions.taskId,
      parentTaskId: tasks.parentTaskId,
      payload: executions.payload,
    })
    .from(executions)
    .innerJoin(tasks, eq(tasks.id, executions.taskId))
    .where(and(
      eq(executions.tenantId, tenantId),
      liveExecution(),
      or(inArray(executions.taskId, epicIds), inArray(tasks.parentTaskId, epicIds)),
    ));
  if (execRows.length === 0) return unsupported;
  const fileRows = await db
    .select({ executionId: taskFileChanges.executionId, path: taskFileChanges.path })
    .from(taskFileChanges)
    .where(inArray(taskFileChanges.executionId, execRows.map((row) => row.id)));
  const pathsByExec = new Map<number, string[]>();
  for (const file of fileRows) {
    const list = pathsByExec.get(file.executionId) ?? [];
    list.push(file.path);
    pathsByExec.set(file.executionId, list);
  }
  const byEpic = new Map<number, typeof execRows>();
  for (const row of execRows) {
    const owners: number[] = [];
    if (wanted.has(row.taskId)) owners.push(row.taskId);
    if (row.parentTaskId != null && wanted.has(row.parentTaskId)) owners.push(row.parentTaskId);
    for (const epicId of owners) {
      const list = byEpic.get(epicId) ?? [];
      list.push(row);
      byEpic.set(epicId, list);
    }
  }
  for (const epicId of epicIds) {
    const rows = byEpic.get(epicId);
    if (!rows || rows.length === 0) continue;
    const supported = rows.some((row) => coderProducedCode(row.payload, pathsByExec.get(row.id) ?? []));
    if (!supported) unsupported.add(epicId);
  }
  return unsupported;
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
      id: tasks.id, title: tasks.title, status: tasks.status, completedAt: tasks.completedAt,
      // Named so the rail can say which epic a chip belongs to (see resolveTaskParents).
      taskType: tasks.taskType, parentTaskId: tasks.parentTaskId,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(inArray(tasks.id, allTaskLike), eq(projects.tenantId, tenantId)));
  const selfById = new Map(rows.map((r) => [r.id, r]));
  // ONE extra batched query at most — the parents not already among these rows.
  const parentByChild = await resolveTaskParents(db, tenantId, rows);

  // Tasks and gaps are both leaf work items — identical health derivation.
  for (const kind of ['task', 'gap'] as const) {
    for (const id of kind === 'task' ? taskIds : gapIds) {
      const r = selfById.get(id);
      if (!r) { out.set(ticketKey(kind, String(id)), missingTicket(kind, String(id))); continue; }
      const parent = parentByChild.get(id);
      const done = r.completedAt != null || DONE_STATUS.has(r.status) ? 1 : 0;
      // Delegate to the canonical status ladder so a chat ticket chip and the
      // task list API never disagree about the same task (in_review is 75, not 50).
      const progressPct = done
        ? 100
        : buildTaskProgressBreakdown({ status: r.status }).progressPct;
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
  // Only epics that would emit 100 are worth a delivery read. A partial
  // container is already < 100; querying it would not change the chip.
  const claimedComplete: number[] = [];
  for (const id of epicIds) {
    const r = selfById.get(id);
    if (!r) continue;
    const c = childByParent.get(id) ?? { total: 0, done: 0 };
    const claimed = c.total > 0
      ? c.done === c.total
      : (r.completedAt != null || DONE_STATUS.has(r.status));
    if (claimed) claimedComplete.push(id);
  }
  const unsupported = await epicsWithUnsupportedDelivery(db, tenantId, claimedComplete);
  for (const id of epicIds) {
    const r = selfById.get(id);
    if (!r) { out.set(ticketKey('epic', String(id)), missingTicket('epic', String(id))); continue; }
    const c = childByParent.get(id) ?? { total: 0, done: 0 };
    const total = c.total;
    const done = c.done;
    const claimed = total > 0
      ? Math.round((done / total) * 100)
      : (r.completedAt != null || DONE_STATUS.has(r.status) ? 100 : 0);
    const unsupportedDelivery = unsupported.has(id);
    const progressPct = unsupportedDelivery
      ? Math.min(claimed, UNSUPPORTED_DELIVERY_PROGRESS_CAP)
      : claimed;
    const parent = parentByChild.get(id);
    out.set(ticketKey('epic', String(id)), {
      kind: 'epic', ref: String(id), label: r.title, status: r.status, progressPct, done, total, exists: true,
      ...(unsupportedDelivery ? { unsupportedDelivery: true } : {}),
      ...(parent ? { parent } : {}),
    });
  }
}
