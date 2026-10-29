import { reportCaughtError } from '../observability/caughtErrorReporter';
/**
 * Hourly cost-alert sweep (A5): daily-spend spikes and per-run cost outliers, raised as
 * system alerts over the shared Slack + email path with a cooldown (`raiseSystemAlert`).
 * Rules and thresholds: `costAlertRules.ts`.
 *
 * CADENCE. Registered on the `frequent` tick (every 5 min when work is pending, at least
 * every 30 min otherwise) and gated to once per UTC hour by a KV claim, because the cron
 * triggers carry no hourly expression. Without KV the gate is open and the cooldowns
 * alone keep a repeat from re-notifying.
 *
 * COST OF THE READS. The 14-day spend baseline changes once a day, so it is computed
 * once per UTC day and cached; the hourly statement scans TODAY's usage rows only. The
 * outlier statement fits p90 only for the (tenant, action type) pairs that had a run
 * land in the last two hours.
 */
import { sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import { getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { millicentsToUsd } from '../../domain/shared/money';
import { usageDatabaseOf } from '../llm/usageLedger';
import { runTelemetryDatabase } from '../shared/runTelemetryDatabase';
import { resultRows } from '../kernel/metricRollup';
import {
  costAlertHourKey, isRunCostOutlier, runCostOutlierMessage, spendSpikeMessage, spendSpikeVerdict,
  RUN_OUTLIER_MULTIPLIER, SPEND_BASELINE_DAYS,
} from './costAlertRules';
import { runOutlierStatement } from './runOutlierStatement';
import { raiseSystemAlert, SYSTEM_ALERT_METRICS } from './systemAlert';

const SOURCE = 'application/alerts/costAlertSweep.ts';
const SPIKE_COOLDOWN_HOURS = 20;
/** A run's cost is final once scored — one alert per run. */
const OUTLIER_COOLDOWN_HOURS = 24 * 7;
/** Runs scored this recently are judged; a little over the hour so a late tick misses none. */
const OUTLIER_LOOKBACK_HOURS = 2;
const OUTLIER_ROW_LIMIT = 200;

export interface CostAlertSweepResult {
  ran: boolean;
  tenants: number;
  spikes: number;
  outliers: number;
}

/** Claim this UTC hour. False when another tick already ran it. */
async function claimHour(env: Env, nowMs: number): Promise<boolean> {
  const kv = env.AUTH_CACHE_KV;
  if (!kv) return true;
  const key = costAlertHourKey(nowMs);
  if (await kv.get(key)) return false;
  await kv.put(key, '1', { expirationTtl: 2 * 3_600 });
  return true;
}

/** tenant → its previous {@link SPEND_BASELINE_DAYS} daily totals (USD), days with spend only. */
async function readSpendBaseline(usageDb: Db): Promise<Record<string, number[]>> {
  const rows = resultRows(await usageDb.execute(sql`
    SELECT tenant_id, (created_at::date)::text AS day, SUM(cost_usd_millicents)::bigint AS mc
      FROM llm_usage_log
     WHERE tenant_id IS NOT NULL
       AND created_at >= CURRENT_DATE - ${SPEND_BASELINE_DAYS}::int
       AND created_at < CURRENT_DATE
     GROUP BY tenant_id, day
  `));
  const out: Record<string, number[]> = {};
  for (const r of rows) (out[String(r.tenant_id)] ??= []).push(millicentsToUsd(Number(r.mc ?? 0)));
  return out;
}

async function sweepSpendSpikes(env: Env, db: Db, nowMs: number): Promise<{ tenants: number; spikes: number }> {
  const usageDb = usageDatabaseOf(db);
  const day = new Date(nowMs).toISOString().slice(0, 10);
  const baseline = await getOrSetCached(env, `cost-alerts:baseline:${day}`, () => readSpendBaseline(usageDb), {
    kvTtlSeconds: 26 * 3_600, l1TtlMs: 3_600_000,
  });
  const today = resultRows(await usageDb.execute(sql`
    SELECT tenant_id, SUM(cost_usd_millicents)::bigint AS mc
      FROM llm_usage_log
     WHERE tenant_id IS NOT NULL AND created_at >= CURRENT_DATE
     GROUP BY tenant_id
  `));
  let spikes = 0;
  for (const r of today) {
    const tenantId = Number(r.tenant_id);
    const todayUsd = millicentsToUsd(Number(r.mc ?? 0));
    const verdict = spendSpikeVerdict(todayUsd, baseline[String(tenantId)] ?? []);
    if (!verdict.spike) continue;
    const outcome = await raiseSystemAlert(env, db, {
      tenantId,
      metric: SYSTEM_ALERT_METRICS.spendSpike,
      message: spendSpikeMessage(todayUsd, verdict),
      observedValue: todayUsd,
      threshold: verdict.thresholdUsd,
      severity: 'high',
      cooldownHours: SPIKE_COOLDOWN_HOURS,
    }, nowMs);
    if (outcome === 'raised') spikes++;
  }
  return { tenants: today.length, spikes };
}

async function sweepRunOutliers(env: Env, db: Db, nowMs: number): Promise<number> {
  const rows = resultRows(await runTelemetryDatabase(db).execute(runOutlierStatement(OUTLIER_LOOKBACK_HOURS, OUTLIER_ROW_LIMIT)));
  let outliers = 0;
  for (const r of rows) {
    const costUsd = millicentsToUsd(Number(r.cost_usd_millicents ?? 0));
    const p90Usd = millicentsToUsd(Number(r.p90 ?? 0));
    if (!isRunCostOutlier(costUsd, p90Usd)) continue;
    const executionId = Number(r.execution_id);
    const actionType = String(r.action_type ?? 'other');
    const outcome = await raiseSystemAlert(env, db, {
      tenantId: Number(r.tenant_id),
      metric: SYSTEM_ALERT_METRICS.runCostOutlier,
      message: runCostOutlierMessage(executionId, actionType, costUsd, p90Usd),
      observedValue: costUsd,
      threshold: RUN_OUTLIER_MULTIPLIER * p90Usd,
      subjectKind: 'object',
      subjectRef: `execution:${executionId}`,
      cooldownHours: OUTLIER_COOLDOWN_HOURS,
    }, nowMs);
    if (outcome === 'raised') outliers++;
  }
  return outliers;
}

export async function runCostAlertSweep(env: Env, db: Db, nowMs: number = Date.now()): Promise<CostAlertSweepResult> {
  if (!(await claimHour(env, nowMs))) return { ran: false, tenants: 0, spikes: 0, outliers: 0 };
  const result: CostAlertSweepResult = { ran: true, tenants: 0, spikes: 0, outliers: 0 };
  // Each half isolated: a failed spend read must not hide a run outlier, or vice versa.
  try {
    Object.assign(result, await sweepSpendSpikes(env, db, nowMs));
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'runCostAlertSweep.spendSpikes' });
  }
  try {
    result.outliers = await sweepRunOutliers(env, db, nowMs);
  } catch (error) {
    reportCaughtError(error, { source: SOURCE, operation: 'runCostAlertSweep.runOutliers' });
  }
  return result;
}
