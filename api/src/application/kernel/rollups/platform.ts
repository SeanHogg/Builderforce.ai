/**
 * The WRITER for `platform.*` metric facts.
 *
 * ── A RATE NEEDS A DENOMINATOR, WHICH IS WHY ALL THREE READ THE SAME TABLE ──
 * The obvious source for `platform.error_rate` is the error log, and it is the
 * wrong one: a count of errors is not a rate, and dividing it by "requests"
 * requires a request counter this platform does not keep. `uptime_checks` does
 * carry both halves — every probe is one attempt with one outcome and one
 * latency — so uptime, error rate and p95 are three readings of the same
 * denominator and can never contradict each other about how many attempts there
 * were.
 *
 * ── UPTIME PREFERS THE PRE-AGGREGATED DAY WHERE ONE EXISTS ──────────────────
 * `uptime_samples` is a daily roll-up written by the monitoring pipeline with a
 * `uptime_pct` per service. Where it exists it is the better source — it covers
 * services the synthetic monitor never probed — so it wins, and the check-derived
 * ratio is the fallback for a workspace that only runs monitors.
 */

import { sql } from 'drizzle-orm';
import { fact, type DomainRollup, type PresentTables } from '../metricRollup';

const WINDOW_DAYS = 60;
const since = sql`DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')`;

/** A probe outcome that means the target answered. */
const UP = sql`('up', 'ok', 'healthy', 'pass', 'passed')`;

export const PLATFORM_ROLLUP: DomainRollup = {
  domain: 'platform',
  metrics: [
    {
      key: 'platform.uptime',
      requires: [],
      build: (present: PresentTables) => {
        if (present.has('uptime_samples')) {
          return fact({
            metric: 'platform.uptime',
            bucket: 'day',
            unit: 'percent',
            tenant: sql`s.tenant_id`,
            bucketAt: sql`s.period_day::timestamp`,
            value: sql`AVG(s.uptime_pct)`,
            tail: sql`
                FROM uptime_samples s
               WHERE s.tenant_id IS NOT NULL
                 AND s.uptime_pct IS NOT NULL
                 AND s.period_day::timestamp >= ${since}
               GROUP BY s.tenant_id, s.period_day
            `,
          });
        }
        if (!present.has('uptime_checks')) return null;
        return fact({
          metric: 'platform.uptime',
          bucket: 'day',
          unit: 'percent',
          tenant: sql`c.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', c.checked_at)`,
          value: sql`100.0 * COUNT(*) FILTER (WHERE LOWER(c.status) IN ${UP}) / COUNT(*)`,
          tail: sql`
              FROM uptime_checks c
             WHERE c.tenant_id IS NOT NULL AND c.checked_at >= ${since}
             GROUP BY c.tenant_id, DATE_TRUNC('day', c.checked_at)
          `,
        });
      },
    },
    {
      key: 'platform.error_rate',
      requires: ['uptime_checks'],
      build: () => fact({
        metric: 'platform.error_rate',
        bucket: 'day',
        unit: 'ratio',
        tenant: sql`c.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', c.checked_at)`,
        value: sql`COUNT(*) FILTER (WHERE LOWER(c.status) NOT IN ${UP})::numeric / COUNT(*)`,
        tail: sql`
            FROM uptime_checks c
           WHERE c.tenant_id IS NOT NULL AND c.checked_at >= ${since}
           GROUP BY c.tenant_id, DATE_TRUNC('day', c.checked_at)
        `,
      }),
    },
    {
      key: 'platform.p95_ms',
      requires: ['uptime_checks'],
      build: () => fact({
        metric: 'platform.p95_ms',
        bucket: 'day',
        unit: 'ms',
        tenant: sql`c.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', c.checked_at)`,
        // p95 over SUCCESSFUL probes. A timeout contributes its ceiling rather
        // than its real latency, and folding those in turns a availability
        // problem into a performance graph that says nothing about either.
        value: sql`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY c.latency_ms)`,
        tail: sql`
            FROM uptime_checks c
           WHERE c.tenant_id IS NOT NULL
             AND c.latency_ms IS NOT NULL
             AND LOWER(c.status) IN ${UP}
             AND c.checked_at >= ${since}
           GROUP BY c.tenant_id, DATE_TRUNC('day', c.checked_at)
        `,
      }),
    },
  ],
};
