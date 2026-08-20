/**
 * The WRITER for `support.*` metric facts.
 *
 * ── FIRST RESPONSE HAD NO SOURCE COLUMN, SO ONE WAS ADDED ───────────────────
 * `DOMAIN_MANIFEST` has declared `support.first_response_min` since the seat
 * existed, and `support_tickets` recorded only `opened_at` and `resolved_at` —
 * so the metric was not merely unwritten, it was *uncomputable*. Resolution time
 * is a different number and substituting it would have been worse than an empty
 * panel: a team that answers in four minutes and fixes in four days would have
 * been reported as taking four days to reply.
 *
 * Migration 0941 adds `support_tickets.first_responded_at`, and the ITSM ingest
 * stamps it from the help desk's own `stats.first_responded_at` — Freshdesk and
 * Freshservice both publish it, and it is THEIR clock, which is the only one
 * that matches what the customer experienced. Tickets ingested before that
 * column existed have NULL and are excluded rather than back-filled: a
 * first-response time nobody measured is not zero.
 *
 * ── CSAT IS PUBLISHED AS A PERCENTAGE, NOT AS A RAW SENTIMENT ───────────────
 * `feedback_sentiments.score` runs −1…1. A tile labelled "CSAT" showing −0.2
 * means nothing to anyone, so the value is mapped onto 0…100 once, here, at the
 * same edge every money metric converts cents. The mapping is stated in the
 * `unit` so no downstream reader has to guess which scale it received.
 */

import { sql } from 'drizzle-orm';
import { fact, type DomainRollup } from '../metricRollup';

const WINDOW_DAYS = 180;
const since = sql`DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')`;

export const SUPPORT_ROLLUP: DomainRollup = {
  domain: 'support',
  metrics: [
    {
      key: 'support.open_tickets',
      requires: ['support_tickets'],
      build: () => fact({
        metric: 'support.open_tickets',
        bucket: 'day',
        unit: 'tickets',
        tenant: sql`t.tenant_id`,
        // Bucketed on the day the ticket was OPENED, counting the ones still
        // open — the same shape `legal.open_matters` uses, and what makes the
        // series a recomputable history rather than a single current count.
        bucketAt: sql`DATE_TRUNC('day', COALESCE(t.opened_at, t.created_at))`,
        value: sql`COUNT(*)`,
        tail: sql`
            FROM support_tickets t
           WHERE t.tenant_id IS NOT NULL
             AND t.resolved_at IS NULL
             AND COALESCE(t.opened_at, t.created_at) >= ${since}
           GROUP BY t.tenant_id, DATE_TRUNC('day', COALESCE(t.opened_at, t.created_at))
        `,
      }),
    },
    {
      key: 'support.first_response_min',
      requires: ['support_tickets'],
      build: () => fact({
        metric: 'support.first_response_min',
        bucket: 'day',
        unit: 'minutes',
        tenant: sql`t.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', t.first_responded_at)`,
        value: sql`AVG(EXTRACT(EPOCH FROM (t.first_responded_at - COALESCE(t.opened_at, t.created_at))) / 60.0)`,
        tail: sql`
            FROM support_tickets t
           WHERE t.tenant_id IS NOT NULL
             AND t.first_responded_at IS NOT NULL
             AND t.first_responded_at >= ${since}
             AND t.first_responded_at >= COALESCE(t.opened_at, t.created_at)
           GROUP BY t.tenant_id, DATE_TRUNC('day', t.first_responded_at)
        `,
      }),
    },
    {
      key: 'support.csat',
      requires: ['feedback_sentiments'],
      build: () => [
        fact({
          metric: 'support.csat',
          bucket: 'month',
          unit: 'percent',
          tenant: sql`s.tenant_id`,
          bucketAt: sql`DATE_TRUNC('month', s.classified_at)`,
          value: sql`AVG((s.score + 1) / 2.0) * 100.0`,
          tail: sql`
              FROM feedback_sentiments s
             WHERE s.tenant_id IS NOT NULL
               AND s.score IS NOT NULL
               AND s.classified_at >= ${since}
             GROUP BY s.tenant_id, DATE_TRUNC('month', s.classified_at)
          `,
        }),
        // The label mix beside the average, because a mean of zero is produced
        // both by indifference and by half the customers being furious, and only
        // one of those is worth waking somebody up for.
        fact({
          metric: 'support.csat',
          bucket: 'month',
          unit: 'responses',
          tenant: sql`s.tenant_id`,
          bucketAt: sql`DATE_TRUNC('month', s.classified_at)`,
          value: sql`COUNT(*)`,
          dimension: sql`JSONB_BUILD_OBJECT('label', s.label)`,
          dimensionKey: sql`'label:' || s.label`,
          tail: sql`
              FROM feedback_sentiments s
             WHERE s.tenant_id IS NOT NULL
               AND s.classified_at >= ${since}
             GROUP BY s.tenant_id, s.label, DATE_TRUNC('month', s.classified_at)
          `,
        }),
      ],
    },
  ],
};
