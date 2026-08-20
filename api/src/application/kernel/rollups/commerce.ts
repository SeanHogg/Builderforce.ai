/**
 * The WRITER for `commerce.*` metric facts.
 *
 * ── ORDERS ARE DATED BY THE PLACEMENT, REFUNDS BY THE REFUND ────────────────
 * `orders.placed_at` and `orders.refunded_at` are different days on the same
 * row, and bucketing both on the order date would make a refund appear to have
 * happened in the month of the sale — which is how a good month quietly
 * rewrites itself weeks later. Each event is dated by when it occurred.
 *
 * ── GMV EXCLUDES REFUNDED ORDERS ────────────────────────────────────────────
 * Gross merchandise value counts what was actually transacted. A refunded order
 * is money that came back, and leaving it in GMV while also reporting it as a
 * refund counts the same reversal as both a sale and a loss.
 *
 * ── MONEY CROSSES THE CENTS BOUNDARY HERE ───────────────────────────────────
 * `total_cents` is the storage unit and the chart's unit is currency, so the
 * division happens once, at this edge — the same rule the payout and ad ports
 * apply, and the reason no downstream reader has to know which of the two a
 * given number is in.
 */

import { sql } from 'drizzle-orm';
import { fact, type DomainRollup } from '../metricRollup';

const WINDOW_DAYS = 180;
const since = sql`DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')`;

/** Orders that never became a sale. Counting them would make an abandoned cart
 *  indistinguishable from a purchase on every commerce surface. */
const SETTLED = sql`('paid', 'fulfilled', 'completed', 'refunded')`;

const placedAt = sql`COALESCE(o.placed_at, o.created_at)`;

export const COMMERCE_ROLLUP: DomainRollup = {
  domain: 'commerce',
  metrics: [
    {
      key: 'commerce.orders',
      requires: ['orders'],
      build: () => fact({
        metric: 'commerce.orders',
        bucket: 'day',
        unit: 'orders',
        tenant: sql`o.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', ${placedAt})`,
        value: sql`COUNT(*)`,
        tail: sql`
            FROM orders o
           WHERE o.tenant_id IS NOT NULL
             AND o.status IN ${SETTLED}
             AND ${placedAt} >= ${since}
           GROUP BY o.tenant_id, DATE_TRUNC('day', ${placedAt})
        `,
      }),
    },
    {
      key: 'commerce.gmv',
      requires: ['orders'],
      build: () => fact({
        metric: 'commerce.gmv',
        bucket: 'day',
        unit: 'USD',
        tenant: sql`o.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', ${placedAt})`,
        value: sql`SUM(o.total_cents) / 100.0`,
        tail: sql`
            FROM orders o
           WHERE o.tenant_id IS NOT NULL
             AND o.status IN ${SETTLED}
             AND o.refunded_at IS NULL
             AND ${placedAt} >= ${since}
           GROUP BY o.tenant_id, DATE_TRUNC('day', ${placedAt})
        `,
      }),
    },
    {
      key: 'commerce.refunds',
      requires: ['orders'],
      build: () => fact({
        metric: 'commerce.refunds',
        bucket: 'day',
        unit: 'USD',
        tenant: sql`o.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', o.refunded_at)`,
        // The VALUE refunded, not the count: the count is what a support queue
        // cares about and the value is what the margin does, and this key sits
        // beside `commerce.gmv` on the same tile.
        value: sql`SUM(o.total_cents) / 100.0`,
        tail: sql`
            FROM orders o
           WHERE o.tenant_id IS NOT NULL
             AND o.refunded_at IS NOT NULL
             AND o.refunded_at >= ${since}
           GROUP BY o.tenant_id, DATE_TRUNC('day', o.refunded_at)
        `,
      }),
    },
  ],
};
