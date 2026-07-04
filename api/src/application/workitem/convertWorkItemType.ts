/**
 * Convert a work-item's TYPE across the board ⇄ OKR boundary — the single place
 * that turns a board task into an Epic, an Epic into an OKR Objective, or an
 * Objective back into board work, migrating the surrounding structure so nothing
 * is orphaned. Used by the REST route (`/api/tasks/:id/convert-type`,
 * `/api/pmo/objectives/:id/convert-type`) AND the `work_items.convert_type` MCP
 * tool — one implementation, both callers.
 *
 * Why it exists: teams (and the Brain) sometimes model an OKR as a board Epic
 * named "OKR 1 — …". Those are the wrong TYPE — they never appear on the OKRs tab
 * and never satisfy a project's 360 "Direction". This promotes them to real
 * Objectives (project-scoped, so the 360 counts them immediately) and demotes in
 * the reverse direction.
 *
 * Transitions:
 *   task ⇄ epic          — a `tasks.task_type` flip (same row).
 *   task/epic → objective — create an Objective from the item, RE-LINK its child
 *                           tasks as the objective's delivery links, delete the item.
 *   objective → task/epic — create a board item from the Objective, RE-PARENT its
 *                           task/epic links under it, delete the Objective (its key
 *                           results have no board equivalent and are dropped).
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import type { Env } from '../../env';
import { keyResults, objectiveLinks, objectives, projects, tasks } from '../../infrastructure/database/schema';
import { TaskType } from '../../domain/shared/types';
import type { TaskService } from '../task/TaskService';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { invalidateProjectsList } from '../../presentation/routes/projectRoutes';

/** The PMO rollup/tree version token (mirrors pmoRoutes.pmoVersionKey). Inlined to
 *  avoid a pmoRoutes ↔ this-module import cycle — pmoRoutes calls convertWorkItemType. */
const pmoVersionKey = (tenantId: number): string => `pmo-version:tenant:${tenantId}`;

export type WorkItemKind = 'task' | 'epic' | 'objective';

const BOARD_KINDS = new Set<WorkItemKind>(['task', 'epic']);

export interface ConvertWorkItemInput {
  tenantId: number;
  segmentId: string;
  /** What the item is NOW. task/epic = a `tasks` row; objective = an `objectives` row. */
  sourceKind: WorkItemKind;
  /** Numeric id (as string) for task/epic; the uuid for an objective. */
  sourceId: string;
  /** What to turn it into. */
  target: WorkItemKind;
  /** Required only for objective → task/epic when the objective is not project-scoped. */
  projectId?: number | null;
}

export interface ConvertWorkItemResult {
  kind: WorkItemKind;
  /** Id of the resulting item (string uuid for an objective, numeric-as-string otherwise). */
  id: string;
  projectId: number | null;
  migrated: { children: number; links: number; keyResultsDropped: number; initiativeLinksDropped: number };
  warnings: string[];
}

export interface ConvertDeps {
  db: Db;
  tasks: TaskService;
  /** Worker env — when present, the write busts the tree / projects-list / pmo caches. */
  env?: Env;
}

export class ConvertError extends Error {}

/** Bust every cache a type change can invalidate: the project's epic tree, the
 *  projects-list aggregate the 360 reads, and the PMO rollup/tree. Best-effort. */
async function invalidateCaches(env: Env | undefined, tenantId: number, projectId: number | null): Promise<void> {
  if (!env) return;
  await Promise.all([
    projectId != null ? bumpCacheVersion(env, `task-tree-version:project:${projectId}`).catch(() => {}) : Promise.resolve(),
    invalidateProjectsList(env, tenantId).catch(() => {}),
    bumpCacheVersion(env, pmoVersionKey(tenantId)).catch(() => {}),
  ]);
}

/** Load a board item (task/epic) with a tenant check via its project. */
async function loadBoardItem(db: Db, tenantId: number, id: number) {
  const [row] = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      segmentId: tasks.segmentId,
      title: tasks.title,
      description: tasks.description,
      taskType: tasks.taskType,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(and(eq(tasks.id, id), eq(projects.tenantId, tenantId)));
  if (!row) throw new ConvertError('work item not found');
  return row;
}

/**
 * Convert a work-item between task / epic / objective. Idempotent-safe: converting
 * to the type it already is (task↔task, objective→objective) is a no-op error the
 * caller can ignore. Returns the resulting item's kind + id plus what was migrated.
 */
export async function convertWorkItemType(
  deps: ConvertDeps,
  input: ConvertWorkItemInput,
): Promise<ConvertWorkItemResult> {
  const { db, tasks: taskService, env } = deps;
  const { tenantId, segmentId, sourceKind, target } = input;
  const warnings: string[] = [];
  const noMigration = { children: 0, links: 0, keyResultsDropped: 0, initiativeLinksDropped: 0 };

  // ── Board reclassify: task ⇄ epic (same row) ────────────────────────────────
  if (BOARD_KINDS.has(sourceKind) && BOARD_KINDS.has(target)) {
    const id = Number(input.sourceId);
    if (!Number.isFinite(id)) throw new ConvertError('invalid task id');
    const item = await loadBoardItem(db, tenantId, id);
    if (item.taskType === target) return { kind: target, id: String(id), projectId: item.projectId, migrated: noMigration, warnings };
    await db.update(tasks).set({ taskType: target as TaskType, updatedAt: new Date() }).where(eq(tasks.id, id));
    await invalidateCaches(env, tenantId, item.projectId);
    return { kind: target, id: String(id), projectId: item.projectId, migrated: noMigration, warnings };
  }

  // ── Promote a board item to an OKR Objective ────────────────────────────────
  if (BOARD_KINDS.has(sourceKind) && target === 'objective') {
    const id = Number(input.sourceId);
    if (!Number.isFinite(id)) throw new ConvertError('invalid task id');
    const item = await loadBoardItem(db, tenantId, id);

    // The Objective inherits the item's project scope so the Project 360 counts it
    // as a linked goal immediately (no separate link step needed).
    const [obj] = await db
      .insert(objectives)
      .values({
        tenantId,
        segmentId: item.segmentId ?? segmentId,
        projectId: item.projectId,
        title: item.title,
        description: item.description ?? null,
        status: 'active',
      })
      .returning({ id: objectives.id });
    if (!obj) throw new ConvertError('failed to create objective');

    // The item's child tasks become the objective's delivery links (an OKR "owns"
    // the epics/tasks that advance it). Deleting the parent next sets their
    // parentTaskId to null, so they survive as top-level work linked to the goal.
    const children = await db
      .select({ id: tasks.id, taskType: tasks.taskType })
      .from(tasks)
      .where(eq(tasks.parentTaskId, id));
    if (children.length) {
      await db.insert(objectiveLinks).values(
        children.map((ch) => ({
          tenantId,
          segmentId: item.segmentId ?? segmentId,
          objectiveId: obj.id,
          linkKind: ch.taskType === 'epic' ? 'epic' : 'task',
          taskId: ch.id,
        })),
      );
    }

    await taskService.deleteTask(id);
    await invalidateCaches(env, tenantId, item.projectId);
    return {
      kind: 'objective',
      id: obj.id,
      projectId: item.projectId,
      migrated: { ...noMigration, children: children.length },
      warnings,
    };
  }

  // ── Demote an Objective back to board work ──────────────────────────────────
  if (sourceKind === 'objective' && BOARD_KINDS.has(target)) {
    const [obj] = await db
      .select({ id: objectives.id, projectId: objectives.projectId, title: objectives.title, description: objectives.description })
      .from(objectives)
      .where(and(eq(objectives.id, input.sourceId), eq(objectives.tenantId, tenantId), eq(objectives.segmentId, segmentId)));
    if (!obj) throw new ConvertError('objective not found');

    const projectId = input.projectId ?? obj.projectId;
    if (projectId == null) {
      throw new ConvertError('this objective is not scoped to a project — pass projectId to choose the board it lands on');
    }

    const created = await taskService.createTask(
      { projectId, title: obj.title, description: obj.description ?? undefined, taskType: target as TaskType },
      tenantId,
    );
    const newTaskId = Number(created.toPlain().id);

    // Re-parent the objective's task/epic links under the new board item; initiative
    // links + key results have no board equivalent and are dropped (surfaced as a warning).
    const links = await db
      .select({ id: objectiveLinks.id, taskId: objectiveLinks.taskId, linkKind: objectiveLinks.linkKind })
      .from(objectiveLinks)
      .where(and(eq(objectiveLinks.objectiveId, obj.id), eq(objectiveLinks.tenantId, tenantId)));
    const taskLinks = links.filter((l) => l.taskId != null);
    const initiativeLinks = links.length - taskLinks.length;
    // Re-parent every linked task in ONE statement (they all move under newTaskId) —
    // a single batched UPDATE instead of an N+1 per-link round-trip.
    if (taskLinks.length > 0) {
      await db.update(tasks)
        .set({ parentTaskId: newTaskId, updatedAt: new Date() })
        .where(inArray(tasks.id, taskLinks.map((l) => l.taskId as number)));
    }

    const krRows = await db.select({ id: keyResults.id }).from(keyResults).where(eq(keyResults.objectiveId, obj.id));
    if (krRows.length) warnings.push(`${krRows.length} key result(s) were dropped — board items have no key results`);
    if (initiativeLinks > 0) warnings.push(`${initiativeLinks} initiative link(s) were dropped`);
    if (target === 'task' && taskLinks.length > 0) warnings.push(`${taskLinks.length} child item(s) were re-parented under a task; consider using epic`);

    // Deleting the objective cascades its key results + remaining links.
    await db.delete(objectives).where(and(eq(objectives.id, obj.id), eq(objectives.tenantId, tenantId)));
    await invalidateCaches(env, tenantId, projectId);
    return {
      kind: target,
      id: String(newTaskId),
      projectId,
      migrated: { children: 0, links: taskLinks.length, keyResultsDropped: krRows.length, initiativeLinksDropped: initiativeLinks },
      warnings,
    };
  }

  throw new ConvertError(`unsupported conversion: ${sourceKind} → ${target}`);
}
