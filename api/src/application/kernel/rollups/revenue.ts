/**
 * The WRITER for `revenue.*` metric facts.
 *
 * ── PIPELINE IS A STATEMENT ABOUT NOW ───────────────────────────────────────
 * Bucketed on today rather than on each deal's own date, for the same reason
 * `legal.renewals_due` is: "what is open right now" back-dated onto the day each
 * deal was created would claim a pipeline value for days this pass never
 * observed, and a series nobody can reconcile is worse than a point.
 *
 * ── WON IS BUCKETED ON THE CLOSE, AND WIN RATE SHARES ITS DENOMINATOR ───────
 * `revenue.won` sums the deals that closed in a month; `revenue.win_rate`
 * divides that same set by everything that reached a decision in it. They are
 * computed from one predicate so a board cannot show a rising win rate beside a
 * falling won figure that disagrees about which deals closed.
 *
 * `HAVING COUNT(*) > 0` is implicit in the GROUP BY, but the win-rate aggregate
 * additionally refuses a bucket in which nothing was decided: a month with no
 * closes has no win rate, and writing 0 would read as "we lost everything".
 */

import { sql } from 'drizzle-orm';
import { fact, type DomainRollup } from '../metricRollup';

const WINDOW_MONTHS = 18;
const since = sql`DATE_TRUNC('month', NOW()) - (${WINDOW_MONTHS} * INTERVAL '1 month')`;

export const REVENUE_ROLLUP: DomainRollup = {
  domain: 'revenue',
  metrics: [
    {
      key: 'revenue.pipeline',
      requires: ['deals'],
      build: () => [
        fact({
          metric: 'revenue.pipeline',
          bucket: 'day',
          unit: 'USD',
          tenant: sql`d.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', NOW())`,
          value: sql`SUM(d.amount)`,
          tail: sql`
              FROM deals d
             WHERE d.tenant_id IS NOT NULL
               AND d.closed_at IS NULL
               AND d.outcome IS NULL
               AND d.amount IS NOT NULL
             GROUP BY d.tenant_id
          `,
        }),
        // By stage, because "how much pipeline" without "how far along" is the
        // number that makes a forecast wrong: a million in first contact and a
        // million in contracting are not the same million.
        fact({
          metric: 'revenue.pipeline',
          bucket: 'day',
          unit: 'USD',
          tenant: sql`d.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', NOW())`,
          value: sql`SUM(d.amount)`,
          dimension: sql`JSONB_BUILD_OBJECT('stage', COALESCE(d.stage, 'unstaged'))`,
          dimensionKey: sql`'stage:' || COALESCE(d.stage, 'unstaged')`,
          tail: sql`
              FROM deals d
             WHERE d.tenant_id IS NOT NULL
               AND d.closed_at IS NULL
               AND d.outcome IS NULL
               AND d.amount IS NOT NULL
             GROUP BY d.tenant_id, d.stage
          `,
        }),
      ],
    },
    {
      key: 'revenue.won',
      requires: ['deals'],
      build: () => fact({
        metric: 'revenue.won',
        bucket: 'month',
        unit: 'USD',
        tenant: sql`d.tenant_id`,
        bucketAt: sql`DATE_TRUNC('month', d.closed_at)`,
        value: sql`SUM(d.amount)`,
        tail: sql`
            FROM deals d
           WHERE d.tenant_id IS NOT NULL
             AND d.outcome = 'won'
             AND d.closed_at IS NOT NULL
             AND d.closed_at >= ${since}
           GROUP BY d.tenant_id, DATE_TRUNC('month', d.closed_at)
        `,
      }),
    },
    {
      key: 'revenue.win_rate',
      requires: ['deals'],
      build: () => fact({
        metric: 'revenue.win_rate',
        bucket: 'month',
        unit: 'ratio',
        tenant: sql`d.tenant_id`,
        bucketAt: sql`DATE_TRUNC('month', d.closed_at)`,
        // Won over DECIDED, not over everything open: a rate whose denominator
        // grows every time somebody adds a lead falls without anything getting
        // worse, and is the single most misread number on a sales board.
        value: sql`COUNT(*) FILTER (WHERE d.outcome = 'won')::numeric / COUNT(*)`,
        tail: sql`
            FROM deals d
           WHERE d.tenant_id IS NOT NULL
             AND d.outcome IN ('won', 'lost')
             AND d.closed_at IS NOT NULL
             AND d.closed_at >= ${since}
           GROUP BY d.tenant_id, DATE_TRUNC('month', d.closed_at)
        `,
      }),
    },
  ],
};
