/**
 * The per-run cost-outlier statement of the hourly cost-alert sweep: the runs scored in the last
 * `lookbackHours` whose cost is more than {@link RUN_OUTLIER_MULTIPLIER}x the 30-day p90 of their
 * (tenant, action type).
 *
 * A run that reported no cost has a NULL cost: unknown, not free. `percentile_cont` ignores NULLs,
 * so the sample gate must count only the runs that HAVE a cost (`COUNT(o.cost_usd_millicents)`), or
 * a p90 fitted to two priced runs would pass a 20-sample gate. The history is the same population
 * the judged runs come from (cloud runs, `execution_id` set), so a client run's rows neither feed
 * nor dilute it.
 */

import { sql, type SQL } from 'drizzle-orm';
import {
  RUN_OUTLIER_HISTORY_DAYS, RUN_OUTLIER_MIN_SAMPLES, RUN_OUTLIER_MIN_USD, RUN_OUTLIER_MULTIPLIER,
  RUN_OUTLIER_PERCENTILE,
} from './costAlertRules';

export function runOutlierStatement(lookbackHours: number, rowLimit: number): SQL {
  return sql`
    WITH recent AS (
      SELECT tenant_id, execution_id, action_type, cost_usd_millicents
        FROM run_model_outcomes
       WHERE tenant_id IS NOT NULL AND execution_id IS NOT NULL
         AND created_at >= NOW() - make_interval(hours => ${lookbackHours}::int)
    ),
    hist AS (
      SELECT o.tenant_id, o.action_type,
             percentile_cont(${RUN_OUTLIER_PERCENTILE}::float8) WITHIN GROUP (ORDER BY o.cost_usd_millicents) AS p90
        FROM run_model_outcomes o
        JOIN (SELECT DISTINCT tenant_id, action_type FROM recent) k
          ON k.tenant_id = o.tenant_id AND k.action_type = o.action_type
       WHERE o.execution_id IS NOT NULL
         AND o.created_at >= NOW() - make_interval(days => ${RUN_OUTLIER_HISTORY_DAYS}::int)
       GROUP BY o.tenant_id, o.action_type
      HAVING COUNT(o.cost_usd_millicents) >= ${RUN_OUTLIER_MIN_SAMPLES}::int
    )
    SELECT r.tenant_id, r.execution_id, r.action_type, r.cost_usd_millicents, h.p90
      FROM recent r
      JOIN hist h ON h.tenant_id = r.tenant_id AND h.action_type = r.action_type
     WHERE r.cost_usd_millicents > ${RUN_OUTLIER_MULTIPLIER}::int * h.p90
       AND r.cost_usd_millicents >= ${Math.round(RUN_OUTLIER_MIN_USD * 100_000)}::int
     ORDER BY r.cost_usd_millicents DESC
     LIMIT ${rowLimit}
  `;
}
