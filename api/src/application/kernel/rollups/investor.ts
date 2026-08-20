/**
 * The WRITER for `investor.*` metric facts.
 *
 * ── PORTFOLIO VALUE IS COST BASIS, AND SAYS SO ─────────────────────────────
 * `portfolio_companies` records `invested_amount` and `ownership_percent`. It
 * does NOT record a current valuation for the underlying company, so a mark-to-
 * market figure is not computable from this database and inventing one — say,
 * ownership × the last round's post-money — would publish a number whose inputs
 * are a year stale under a label that implies they are not.
 *
 * So the metric is the money actually deployed into positions still held, and
 * its `unit` says `USD` rather than anything that implies a mark. An exited
 * position is excluded: it is a realised return, and folding it into "portfolio
 * value" makes a fund look like it still owns what it sold.
 */

import { sql } from 'drizzle-orm';
import { fact, type DomainRollup } from '../metricRollup';

/** Opportunity states that mean nobody has decided yet. */
const LIVE = sql`('open', 'active', 'reviewing', 'diligence', 'sourced', 'pending')`;

export const INVESTOR_ROLLUP: DomainRollup = {
  domain: 'investor',
  metrics: [
    {
      key: 'investor.portfolio_value',
      requires: ['portfolio_companies'],
      build: () => [
        // Bucketed on TODAY: a position's value is a statement about now, and
        // this table records no valuation history to back-date it onto.
        fact({
          metric: 'investor.portfolio_value',
          bucket: 'day',
          unit: 'USD',
          tenant: sql`p.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', NOW())`,
          value: sql`SUM(p.invested_amount)`,
          tail: sql`
              FROM portfolio_companies p
             WHERE p.tenant_id IS NOT NULL
               AND p.exited_at IS NULL
               AND p.invested_amount IS NOT NULL
             GROUP BY p.tenant_id
          `,
        }),
        // Realised capital, as a slice rather than a second key: "what we hold"
        // and "what came back" are the two halves of one answer, and separating
        // them into two metrics is how a fund's own dashboard stops adding up.
        fact({
          metric: 'investor.portfolio_value',
          bucket: 'day',
          unit: 'USD',
          tenant: sql`p.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', NOW())`,
          value: sql`SUM(p.invested_amount)`,
          dimension: sql`JSONB_BUILD_OBJECT('position', 'exited')`,
          dimensionKey: sql`'position:exited'`,
          tail: sql`
              FROM portfolio_companies p
             WHERE p.tenant_id IS NOT NULL
               AND p.exited_at IS NOT NULL
               AND p.invested_amount IS NOT NULL
             GROUP BY p.tenant_id
          `,
        }),
      ],
    },
    {
      key: 'investor.opportunities',
      requires: ['investment_opportunities'],
      build: () => fact({
        metric: 'investor.opportunities',
        bucket: 'day',
        unit: 'opportunities',
        tenant: sql`o.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', NOW())`,
        value: sql`COUNT(*)`,
        tail: sql`
            FROM investment_opportunities o
           WHERE o.tenant_id IS NOT NULL
             AND o.decided_at IS NULL
             AND LOWER(COALESCE(o.status, 'open')) IN ${LIVE}
           GROUP BY o.tenant_id
        `,
      }),
    },
  ],
};
