import { reportCaughtError } from '../observability/caughtErrorReporter';
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
import { buildDatabase, type Db } from '../../infrastructure/database/connection';
import { runModelOutcomes } from '../../infrastructure/database/schema';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { buildTenantDriftReport } from './driftReport';
import { raiseSystemAlert, SYSTEM_ALERT_METRICS } from '../alerts/systemAlert';
import type { Env } from '../../env';
import { DAY_MS } from '../../domain/shared/time';

/** Just under the daily cron: a persisting regression re-alerts daily, a re-run does not. */
export const EVAL_DRIFT_ALERT_COOLDOWN_HOURS = 20;

export function buildEvalDriftAlertMessage(
  drifting: Array<{ group: string; result: { severity: string } }>,
): string {
  const groups = drifting
    .map((g) => `${g.group} (severity ${g.result.severity})`)
    .join(', ');
  return (
    `Eval drift detected on ${drifting.length} ` +
    `${drifting.length === 1 ? 'group' : 'groups'}: ${groups}.`
  );
}

export async function runEvalDriftSweep(env: Env, db: Db = buildDatabase(env)): Promise<void> {

  // Tenants with eval scores in the last 60 days are the only ones worth checking.
  const sinceMs = Date.now() - 60 * DAY_MS;
  const tenants = await runTelemetryDatabase(db)
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

      // Eval drift is a SYSTEM alert: it fires whenever a regression is detected,
      // independently of any user-defined rule — so it goes through THE system-alert
      // raiser (one alert_event + the shared Slack/email notify), which is best-effort
      // and never throws. The cooldown sits just under the daily cadence: a regression
      // that persists re-alerts once a day, and a re-run of the same sweep does not.
      if (report.drifting.length > 0) {
        await raiseSystemAlert(env, db, {
          tenantId,
          metric: SYSTEM_ALERT_METRICS.evalDrift,
          message: buildEvalDriftAlertMessage(report.drifting),
          observedValue: report.drifting.length,
          cooldownHours: EVAL_DRIFT_ALERT_COOLDOWN_HOURS,
        });
      }
    } catch (err) {
      reportCaughtError(err, { source: "application/eval/runEvalDriftSweep.ts", operation: "runEvalDriftSweep", context: { logMessage: `[cron:eval-drift] tenant=${tenantId} failed`, details: err } });
    }
  }
}
