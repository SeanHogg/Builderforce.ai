/**
 * PER-PROJECT delivery signals — the compact inputs the shared delivery-health
 * verdict needs, computed for EVERY project of a tenant in one bounded, grouped
 * pass (no N+1).
 *
 * The /insights/delivery banner fuses tenant-wide DORA + cycle time + bottleneck
 * signals into a single 0–100 health score (frontend `computeDeliveryVerdict`).
 * The project cards used to derive a DIFFERENT, task-status-only health number,
 * so the same project could read "100" on its card and "66" on the delivery tab.
 * This collector closes that gap: it produces the SAME signal bundle per project
 * so the card can run the exact same verdict math and the two numbers agree.
 *
 * It deliberately REUSES the bottleneck/lifecycle pure helpers
 * ({@link buildStageDurations}, {@link summarizePhases}, {@link summarizeRework},
 * {@link summarizeAgingWip}) rather than re-deriving time-in-status — same raw
 * intervals, just grouped by project. Three bounded queries (deploys in window,
 * tasks in window, their transitions by id-set) mirror the tenant collectors;
 * all aggregation is pure JS.
 *
 * NOTE on attribution: deploys with a null project_id (tenant-level deploys) can't
 * be attributed to a project, so they contribute to the tenant-wide DORA rollup
 * but not to any per-project bundle. For a single-project tenant whose deploys
 * carry a project_id the card and the delivery tab match exactly.
 */
import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { deploymentEvents, projects, tasks, taskStatusTransitions } from '../../infrastructure/database/schema';
import { notSystemTask } from '../task/taskScope';
import {
  avg, buildStageDurations, summarizeRework, summarizeAgingWip,
  type TransitionRow, type TaskRow,
} from './bottleneckInsights';
import { summarizePhases } from './lifecycleInsights';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** Same cap as the tenant collectors so a very large tenant stays bounded. */
const MAX_ROWS = 5_000;

/** The compact signal bundle a project card feeds to `computeDeliveryVerdict`.
 *  Shapes mirror the frontend `DeliverySignals` (dora/lifecycle/bottlenecks). */
export interface ProjectDeliverySignals {
  dora: {
    deploymentFrequencyPerDay: number;
    totalDeployments: number;
    leadTimeHours: number | null;
    changeFailureRatePct: number | null;
    mttrHours: number | null;
  };
  lifecycle: { sampleSize: number; totalAvgHours: number };
  bottlenecks: { rework: { reworkRate: number }; agingWip: { stuckCount: number } };
}

interface DeployRow { projectId: number; deployedAt: Date; isFailure: boolean; restoredAt: Date | null }

/**
 * Compute the delivery-signal bundle for every project of `tenantId` over the
 * window. Projects with no tasks AND no attributable deploys are omitted (the
 * card renders a neutral "no data" health for those).
 */
export async function computeProjectDeliverySignals(
  db: Db,
  tenantId: number,
  days: number,
): Promise<Map<number, ProjectDeliverySignals>> {
  const now = Date.now();
  const since = new Date(now - days * DAY_MS);

  // 1. Deploys in window, attributed to a project (null project_id → tenant-only).
  const deployRows = (await db
    .select({
      projectId: deploymentEvents.projectId,
      deployedAt: deploymentEvents.deployedAt,
      isFailure: deploymentEvents.isFailure,
      restoredAt: deploymentEvents.restoredAt,
    })
    .from(deploymentEvents)
    .where(and(
      eq(deploymentEvents.tenantId, tenantId),
      isNotNull(deploymentEvents.projectId),
      gte(deploymentEvents.deployedAt, since),
    ))) as DeployRow[];

  const deploysByProject = new Map<number, DeployRow[]>();
  for (const d of deployRows) {
    const list = deploysByProject.get(d.projectId) ?? [];
    list.push(d);
    deploysByProject.set(d.projectId, list);
  }

  // 2. Tasks in window (same shape + filter as the bottleneck/lifecycle lenses),
  //    plus the projectId to bucket by. createdAt is used for DORA lead time.
  const taskRows = (await db
    .select({
      taskId: tasks.id,
      projectId: tasks.projectId,
      key: tasks.key,
      title: tasks.title,
      status: tasks.status,
      createdAt: tasks.createdAt,
      completedAt: tasks.completedAt,
      lastWorkedAt: tasks.lastWorkedAt,
      redoCount: tasks.redoCount,
      reopenCount: tasks.reopenCount,
    })
    .from(tasks)
    .innerJoin(projects, eq(projects.id, tasks.projectId))
    .where(and(
      eq(projects.tenantId, tenantId),
      eq(tasks.archived, false),
      gte(tasks.updatedAt, since),
      notSystemTask,
    ))
    .orderBy(desc(tasks.updatedAt))
    .limit(MAX_ROWS)) as Array<TaskRow & { projectId: number }>;

  const tasksByProject = new Map<number, Array<TaskRow & { projectId: number }>>();
  const projectByTaskId = new Map<number, number>();
  for (const t of taskRows) {
    const list = tasksByProject.get(t.projectId) ?? [];
    list.push(t);
    tasksByProject.set(t.projectId, list);
    projectByTaskId.set(t.taskId, t.projectId);
  }

  // 3. Transitions for the sampled tasks, bucketed by project.
  const taskIds = taskRows.map((r) => r.taskId);
  const transitionsByProject = new Map<number, TransitionRow[]>();
  if (taskIds.length) {
    const transitions = (await db
      .select({
        taskId: taskStatusTransitions.taskId,
        fromStatus: taskStatusTransitions.fromStatus,
        toStatus: taskStatusTransitions.toStatus,
        occurredAt: taskStatusTransitions.occurredAt,
      })
      .from(taskStatusTransitions)
      .where(inArray(taskStatusTransitions.taskId, taskIds))) as TransitionRow[];
    for (const tr of transitions) {
      const projectId = projectByTaskId.get(tr.taskId);
      if (projectId == null) continue;
      const list = transitionsByProject.get(projectId) ?? [];
      list.push(tr);
      transitionsByProject.set(projectId, list);
    }
  }

  // Per project → the signal bundle. Union of projects seen in tasks or deploys.
  const out = new Map<number, ProjectDeliverySignals>();
  const projectIds = new Set<number>([...tasksByProject.keys(), ...deploysByProject.keys()]);

  for (const projectId of projectIds) {
    const projTasks = tasksByProject.get(projectId) ?? [];
    const projTransitions = transitionsByProject.get(projectId) ?? [];
    const projDeploys = deploysByProject.get(projectId) ?? [];

    // Lifecycle: same dwell intervals → phase rollup → sum of phase averages.
    const durations = buildStageDurations(projTransitions, projTasks, now);
    const byPhase = summarizePhases(durations);
    const totalAvgHours = byPhase.reduce((a, p) => a + p.avgHours, 0);

    // DORA lead time: completed tasks in window, createdAt → completedAt.
    const leadTimes = projTasks
      .filter((t) => t.completedAt != null && t.completedAt.getTime() >= since.getTime())
      .map((t) => (t.completedAt!.getTime() - t.createdAt.getTime()) / HOUR_MS)
      .filter((h) => h >= 0);

    // DORA deploy keys for this project.
    const totalDeployments = projDeploys.length;
    const failures = projDeploys.filter((d) => d.isFailure).length;
    const mttr = projDeploys
      .filter((d) => d.isFailure && d.restoredAt != null)
      .map((d) => (d.restoredAt!.getTime() - d.deployedAt.getTime()) / HOUR_MS)
      .filter((h) => h >= 0);

    out.set(projectId, {
      dora: {
        deploymentFrequencyPerDay: days > 0 ? totalDeployments / days : 0,
        totalDeployments,
        leadTimeHours: avg(leadTimes),
        changeFailureRatePct: totalDeployments ? (failures / totalDeployments) * 100 : null,
        mttrHours: avg(mttr),
      },
      lifecycle: { sampleSize: projTasks.length, totalAvgHours },
      bottlenecks: {
        rework: { reworkRate: summarizeRework(projTasks).reworkRate },
        agingWip: { stuckCount: summarizeAgingWip(projTasks, now).stuckCount },
      },
    });
  }

  return out;
}
