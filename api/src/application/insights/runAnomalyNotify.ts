import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Push the run-anomalies lens (A5c). `GET /api/insights/run-anomalies` is pull-only:
 * an outlier run was visible to whoever opened the lens and to nobody else. This daily
 * sweep reads the same lens (`getRunAnomalies`, cached) for every tenant that had a run
 * scored since the last tick and raises ONE system alert per tenant naming the issues
 * whose most recent flagged run is new since then — not the whole window again.
 */
import { and, gte, isNotNull } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { runModelOutcomes } from '../../infrastructure/database/schema';
import { acrossTenants } from '../../infrastructure/database/tenantScope';
import { DAY_MS } from '../../domain/shared/time';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { raiseSystemAlert, SYSTEM_ALERT_METRICS } from '../alerts/systemAlert';
import { getRunAnomalies } from './runAnomalyInsights';
import type { RunAnomalyIssue } from './runAnomalyIssues';

/** The window the lens reads for the notifier — the detector's history. */
export const RUN_ANOMALY_NOTIFY_WINDOW_DAYS = 30;
/** Just under the daily cadence, so a late tick never suppresses the next day's alert. */
const COOLDOWN_HOURS = 20;

const METRIC_PHRASE: Record<RunAnomalyIssue['metric'], string> = {
  cost: 'cost', duration: 'duration', toolFailures: 'tool failures',
};

/** The issues with a flagged run newer than `sinceMs`. */
export function newRunAnomalyIssues(issues: readonly RunAnomalyIssue[], sinceMs: number): RunAnomalyIssue[] {
  return issues.filter((i) => Date.parse(i.latestFlaggedAt) >= sinceMs);
}

export function runAnomalyAlertMessage(issues: readonly RunAnomalyIssue[]): string {
  const parts = issues.map((i) => {
    const runs = i.examples.map((e) => `#${e.executionId}`).join(', ');
    return `${METRIC_PHRASE[i.metric]} (${i.runs} run${i.runs === 1 ? '' : 's'}${runs ? `, e.g. ${runs}` : ''}; ≈$${i.excessCostUsd.toFixed(2)} above typical)`;
  });
  return `Agent runs outside their normal range: ${parts.join('; ')}.`;
}

export async function runRunAnomalyNotifySweep(env: Env, db: Db, nowMs: number = Date.now()): Promise<{ tenants: number; alerted: number }> {
  const sinceMs = nowMs - DAY_MS;
  const tenants = await runTelemetryDatabase(db)
    .selectDistinct({ tenantId: runModelOutcomes.tenantId })
    .from(runModelOutcomes)
    .where(acrossTenants(runModelOutcomes, 'scheduled_sweep', and(
      isNotNull(runModelOutcomes.tenantId),
      isNotNull(runModelOutcomes.executionId),
      gte(runModelOutcomes.createdAt, new Date(sinceMs)),
    )));
  let alerted = 0;
  for (const { tenantId } of tenants) {
    if (tenantId == null) continue;
    try {
      const lens = await getRunAnomalies(db, env, tenantId, RUN_ANOMALY_NOTIFY_WINDOW_DAYS);
      const fresh = newRunAnomalyIssues(lens.issues, sinceMs);
      if (fresh.length === 0) continue;
      const outcome = await raiseSystemAlert(env, db, {
        tenantId,
        metric: SYSTEM_ALERT_METRICS.runAnomaly,
        message: runAnomalyAlertMessage(fresh),
        observedValue: fresh.reduce((n, i) => n + i.runs, 0),
        cooldownHours: COOLDOWN_HOURS,
      }, nowMs);
      if (outcome === 'raised') alerted++;
    } catch (error) {
      reportCaughtError(error, { source: 'application/insights/runAnomalyNotify.ts', operation: 'runRunAnomalyNotifySweep', context: { details: { tenantId } } });
    }
  }
  return { tenants: tenants.length, alerted };
}
