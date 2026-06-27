/**
 * Eval drift sweep (Layer 6) — the scheduled half of quality monitoring.
 *
 * Runs on the daily cron. For every tenant with recent eval-scored runs, it
 * computes per-(action_type, model) quality drift and logs an alert for any group
 * whose recent window regressed against its baseline (mean-shift AND/OR PSI). The
 * /api/eval/drift route shows the same report on demand; this sweep is the
 * push side so a silent quality regression surfaces without anyone looking.
 *
 * Best-effort and isolated — a failure here must never disrupt the run pipeline.
 */

import { sql } from 'drizzle-orm';
import { buildDatabase } from '../../infrastructure/database/connection';
import { runModelOutcomes } from '../../infrastructure/database/schema';
import { buildTenantDriftReport } from '../../presentation/routes/evalRoutes';
import type { Env } from '../../env';

export async function runEvalDriftSweep(env: Env): Promise<void> {
  const db = buildDatabase(env);

  // Tenants with eval scores in the last 60 days are the only ones worth checking.
  const sinceMs = Date.now() - 60 * 24 * 60 * 60 * 1000;
  const tenants = await db
    .select({ tenantId: runModelOutcomes.tenantId })
    .from(runModelOutcomes)
    .where(
      sql`${runModelOutcomes.faithfulness} is not null and ${runModelOutcomes.createdAt} >= ${new Date(sinceMs)} and ${runModelOutcomes.tenantId} is not null`,
    )
    .groupBy(runModelOutcomes.tenantId);

  for (const { tenantId } of tenants) {
    if (tenantId == null) continue;
    try {
      const report = await buildTenantDriftReport(db, tenantId);
      for (const g of report.drifting) {
        console.warn(
          `[cron:eval-drift] tenant=${tenantId} group=${g.group} severity=${g.result.severity} ` +
            `delta=${g.result.delta.toFixed(3)} z=${g.result.zScore.toFixed(2)} psi=${g.result.psi.toFixed(3)} (n=${g.samples})`,
        );
      }
    } catch (err) {
      console.error(`[cron:eval-drift] tenant=${tenantId} failed`, err);
    }
  }
}
