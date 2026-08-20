/**
 * Persistence for the {@link PlanVerdict} — the half of `planVerdict.ts` that
 * knows a table exists (migration 1075).
 *
 * Kept apart from the pure verdict so the thing that PRODUCES a verdict (the Epic
 * fan-out, the manager's SCHEDULE pass) never has to care where it lands, and so
 * the verdict itself stays unit-testable without a database.
 *
 * A CLEAN re-plan deletes the row rather than storing an all-false verdict. "No
 * row" and "a row saying nothing is wrong" would be two encodings of the same
 * fact, and the readers would eventually disagree about which one means what.
 */

import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infrastructure/database/connection';
import { taskPlanVerdicts } from '../../infrastructure/database/schema';
import { bumpCacheVersion } from '../../infrastructure/cache/readThroughCache';
import { pmoVersionKey } from '../pmo/pmoCacheKeys';
import type { Env } from '../../env';
import { planVerdictIsClean, type PlanVerdict } from './planVerdict';

/** A stored verdict, as every reader consumes it. */
export interface StoredPlanVerdict extends PlanVerdict {
  taskId: number;
  /** Which reasoning step produced the plan being judged. */
  source: string | null;
  plannedAt: string;
}

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v)) : [];
}

/**
 * Write (or clear) the verdict for one parent task, and orphan the PMO caches so
 * the planning spine shows the warning on the next read rather than after a TTL.
 *
 * Best-effort by contract: a fan-out that succeeded must never be undone because
 * its verdict could not be recorded, so the caller swallows failures. That is why
 * this returns void rather than a result nobody could act on.
 */
export async function recordPlanVerdict(
  env: Env | undefined,
  db: Db,
  input: {
    tenantId: number;
    projectId: number;
    taskId: number;
    verdict: PlanVerdict;
    source?: string | null;
  },
): Promise<void> {
  const { tenantId, projectId, taskId, verdict } = input;
  if (planVerdictIsClean(verdict)) {
    await db.delete(taskPlanVerdicts)
      .where(and(eq(taskPlanVerdicts.tenantId, tenantId), eq(taskPlanVerdicts.taskId, taskId)));
  } else {
    const row = {
      tenantId,
      projectId,
      taskId,
      compressed: verdict.compressed,
      overrunTaskIds: verdict.overruns,
      cyclicTaskIds: verdict.cyclic,
      capacityDeferredTaskIds: verdict.capacityDeferred,
      source: input.source ?? null,
      plannedAt: new Date(),
    };
    await db.insert(taskPlanVerdicts).values(row).onConflictDoUpdate({
      target: taskPlanVerdicts.taskId,
      set: { ...row, updatedAt: new Date() },
    });
  }
  if (env) await bumpCacheVersion(env, pmoVersionKey(tenantId));
}

/** Every open verdict in a tenant (optionally one project), keyed by parent task id. */
export async function loadPlanVerdicts(
  db: Db,
  tenantId: number,
  projectId?: number,
): Promise<Map<number, StoredPlanVerdict>> {
  const rows = await db.select()
    .from(taskPlanVerdicts)
    .where(projectId != null
      ? and(eq(taskPlanVerdicts.tenantId, tenantId), eq(taskPlanVerdicts.projectId, projectId))
      : eq(taskPlanVerdicts.tenantId, tenantId));
  return new Map(rows.map((r) => [r.taskId, {
    taskId: r.taskId,
    compressed: r.compressed,
    overruns: idList(r.overrunTaskIds),
    cyclic: idList(r.cyclicTaskIds),
    capacityDeferred: idList(r.capacityDeferredTaskIds),
    source: r.source,
    plannedAt: (r.plannedAt ?? r.createdAt ?? new Date()).toISOString(),
  }]));
}

/** The verdicts for a specific set of parents — the ticket-drawer read. */
export async function loadPlanVerdictsForTasks(
  db: Db,
  tenantId: number,
  taskIds: readonly number[],
): Promise<Map<number, StoredPlanVerdict>> {
  if (taskIds.length === 0) return new Map();
  const rows = await db.select()
    .from(taskPlanVerdicts)
    .where(and(eq(taskPlanVerdicts.tenantId, tenantId), inArray(taskPlanVerdicts.taskId, [...taskIds])));
  return new Map(rows.map((r) => [r.taskId, {
    taskId: r.taskId,
    compressed: r.compressed,
    overruns: idList(r.overrunTaskIds),
    cyclic: idList(r.cyclicTaskIds),
    capacityDeferred: idList(r.capacityDeferredTaskIds),
    source: r.source,
    plannedAt: (r.plannedAt ?? r.createdAt ?? new Date()).toISOString(),
  }]));
}
