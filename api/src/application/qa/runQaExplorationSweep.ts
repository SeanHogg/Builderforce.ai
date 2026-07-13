/**
 * runQaExplorationSweep — the scheduler half of the Agentic Tester.
 *
 * Fired from the frequent cron tick (api/src/index.ts scheduled()). For every
 * enabled qa_schedules row whose next_run_at has elapsed, it snapshots the
 * heatmap, derives an exploration plan, enqueues a `qa_explorations` row
 * (trigger='schedule'), and re-arms next_run_at from the cron expression.
 *
 * This is what makes the QA agent run "as part of a workflow" on a cadence —
 * the platform drives it, not a GitHub Action. A runner (container/agent
 * surface) then claims the queued exploration via POST /api/qa/explorations/claim.
 */

import { and, asc, eq, isNull, lte, or } from 'drizzle-orm';
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { qaExplorations, qaSchedules, qaTargets } from '../../infrastructure/database/schema';
import { QaHeatmapService } from './QaHeatmapService';
import { buildExplorationPlan } from './qaTypes';
import { dispatchQaRunner } from './dispatchQaRunner';
import { nextCronTime } from '../../domain/workflowSchedule';
import type { Env } from '../../env';

/** Max schedules processed per sweep — bounds work per cron tick. */
const SWEEP_LIMIT = 25;

async function resolveTargetUrl(
  db: Db,
  tenantId: number,
  projectId: number,
  targetId: string | null,
): Promise<{ id: string; baseUrl: string } | null> {
  if (targetId) {
    const [t] = await db
      .select({ id: qaTargets.id, baseUrl: qaTargets.baseUrl })
      .from(qaTargets)
      .where(and(eq(qaTargets.id, targetId), eq(qaTargets.tenantId, tenantId)))
      .limit(1);
    if (t) return t;
  }
  const [def] = await db
    .select({ id: qaTargets.id, baseUrl: qaTargets.baseUrl })
    .from(qaTargets)
    .where(and(eq(qaTargets.tenantId, tenantId), eq(qaTargets.projectId, projectId), eq(qaTargets.status, 'active')))
    .orderBy(asc(qaTargets.isDefault))
    .limit(1);
  return def ?? null;
}

export async function runQaExplorationSweep(env: Env): Promise<{ enqueued: number; rearmed: number }> {
  const db = buildDatabase(env);
  const now = new Date();

  const due = await db
    .select()
    .from(qaSchedules)
    .where(and(eq(qaSchedules.enabled, true), or(isNull(qaSchedules.nextRunAt), lte(qaSchedules.nextRunAt, now))))
    .orderBy(asc(qaSchedules.nextRunAt))
    .limit(SWEEP_LIMIT);

  let enqueued = 0;
  let rearmed = 0;
  const heatmap = new QaHeatmapService(db, env);

  for (const s of due) {
    let lastStatus = 'enqueued';
    try {
      const target = await resolveTargetUrl(db, s.tenantId, s.projectId, s.targetId);
      if (!target) {
        lastStatus = 'no_target';
      } else {
        const zones = await heatmap.rankZones(s.tenantId, { sinceDays: s.sinceDays, limit: s.heatBudget * 3 });
        if (zones.length === 0) {
          lastStatus = 'no_heat';
        } else {
          const plan = buildExplorationPlan(zones, s.heatBudget);
          const [exploration] = await db.insert(qaExplorations).values({
            tenantId: s.tenantId, segmentId: s.segmentId ?? undefined, projectId: s.projectId,
            targetId: target.id, credentialId: s.credentialId,
            status: 'queued', trigger: 'schedule',
            heatBudget: s.heatBudget, sinceDays: s.sinceDays,
            plan: JSON.stringify(plan), heatZones: JSON.stringify(zones), model: null,
            zonesPlanned: zones.length, targetUrl: target.baseUrl,
            createdBy: `schedule:${s.id}`, updatedAt: now,
          }).returning({ id: qaExplorations.id });
          enqueued++;
          // Dispatch the managed runner container to drain it now. No-op when the
          // QA_RUNNER_CONTAINER binding isn't provisioned (the row stays queued for
          // an external runner). Best-effort: a dispatch failure must not wedge the
          // sweep — the reaper / next claim still picks the queued row up.
          if (exploration) {
            const dispatched = await dispatchQaRunner(env, { explorationId: exploration.id, tenantId: s.tenantId, projectId: s.projectId }).catch(() => false);
            if (!dispatched) lastStatus = 'enqueued_undispatched';
          }
        }
      }
    } catch (err) {
      lastStatus = 'error';
      console.error(`[qa-sweep] schedule ${s.id} failed`, err);
    }

    // Re-arm from the cron expression so a malformed cron can't wedge the row.
    const next = nextCronTime(s.cron, now, s.timezone) ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);
    await db
      .update(qaSchedules)
      .set({ lastRunAt: now, lastStatus, nextRunAt: next, updatedAt: now })
      .where(eq(qaSchedules.id, s.id));
    rearmed++;
  }

  return { enqueued, rearmed };
}
