/**
 * The WRITER for `hiring.*` metric facts.
 *
 * ── TIME TO HIRE IS MEASURED FROM THE APPLICATION, NOT THE REQUISITION ──────
 * `hiring_decisions` carries `decided_at`, `job_applications` carries
 * `applied_at`, and the span between them is the candidate's experience of the
 * process — the number a recruiter is actually judged on and the one a candidate
 * feels. Measuring from when the role was OPENED instead would fold "we took
 * three months to start looking" into "we took three months to answer you", and
 * those are two different failures with two different owners.
 *
 * ── OFFER RATE NEEDS TWO TABLES AND ONE DENOMINATOR ─────────────────────────
 * Offers and applications live apart, so the ratio is computed from a UNION that
 * projects each side into a `1/0` pair and divides once per bucket. `HAVING
 * SUM(app) > 0` is what keeps the honesty rule: a month in which somebody sent
 * an offer against a pipeline this window cannot see produces no fact rather
 * than a division by zero or a fabricated 100%.
 */

import { sql } from 'drizzle-orm';
import { fact, type DomainRollup } from '../metricRollup';

const WINDOW_MONTHS = 18;
const since = sql`DATE_TRUNC('month', NOW()) - (${WINDOW_MONTHS} * INTERVAL '1 month')`;

export const HIRING_ROLLUP: DomainRollup = {
  domain: 'hiring',
  metrics: [
    {
      key: 'hiring.applications',
      requires: ['job_applications'],
      build: () => [
        fact({
          metric: 'hiring.applications',
          bucket: 'day',
          unit: 'applications',
          tenant: sql`a.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', COALESCE(a.applied_at, a.created_at))`,
          value: sql`COUNT(*)`,
          tail: sql`
              FROM job_applications a
             WHERE a.tenant_id IS NOT NULL
               AND COALESCE(a.applied_at, a.created_at) >= ${since}
             GROUP BY a.tenant_id, DATE_TRUNC('day', COALESCE(a.applied_at, a.created_at))
          `,
        }),
        // Where they came from, as a slice: the single most actionable cut of
        // this number, because it is the one that decides where the next
        // sourcing hour goes.
        fact({
          metric: 'hiring.applications',
          bucket: 'day',
          unit: 'applications',
          tenant: sql`a.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', COALESCE(a.applied_at, a.created_at))`,
          value: sql`COUNT(*)`,
          dimension: sql`JSONB_BUILD_OBJECT('source', COALESCE(a.source, 'unknown'))`,
          dimensionKey: sql`'source:' || COALESCE(a.source, 'unknown')`,
          tail: sql`
              FROM job_applications a
             WHERE a.tenant_id IS NOT NULL
               AND COALESCE(a.applied_at, a.created_at) >= ${since}
             GROUP BY a.tenant_id, a.source, DATE_TRUNC('day', COALESCE(a.applied_at, a.created_at))
          `,
        }),
      ],
    },
    {
      key: 'hiring.time_to_hire_days',
      requires: ['hiring_decisions', 'job_applications'],
      build: () => fact({
        metric: 'hiring.time_to_hire_days',
        bucket: 'month',
        unit: 'days',
        tenant: sql`d.tenant_id`,
        bucketAt: sql`DATE_TRUNC('month', d.decided_at)`,
        value: sql`AVG(EXTRACT(EPOCH FROM (d.decided_at - COALESCE(a.applied_at, a.created_at))) / 86400.0)`,
        tail: sql`
            FROM hiring_decisions d
            JOIN job_applications a ON a.id = d.application_id AND a.tenant_id = d.tenant_id
           WHERE d.tenant_id IS NOT NULL
             AND d.decision = 'hire'
             AND d.decided_at IS NOT NULL
             AND d.decided_at >= ${since}
             AND d.decided_at > COALESCE(a.applied_at, a.created_at)
           GROUP BY d.tenant_id, DATE_TRUNC('month', d.decided_at)
        `,
      }),
    },
    {
      key: 'hiring.offer_rate',
      requires: ['offer_letters', 'job_applications'],
      build: () => fact({
        metric: 'hiring.offer_rate',
        bucket: 'month',
        unit: 'ratio',
        tenant: sql`h.tenant_id`,
        bucketAt: sql`h.bucket_at`,
        value: sql`SUM(h.offer)::numeric / SUM(h.app)`,
        tail: sql`
            FROM (
              SELECT a.tenant_id,
                     DATE_TRUNC('month', COALESCE(a.applied_at, a.created_at)) AS bucket_at,
                     1 AS app, 0 AS offer
                FROM job_applications a
               WHERE a.tenant_id IS NOT NULL
                 AND COALESCE(a.applied_at, a.created_at) >= ${since}
              UNION ALL
              SELECT o.tenant_id, DATE_TRUNC('month', o.sent_at), 0 AS app, 1 AS offer
                FROM offer_letters o
               WHERE o.tenant_id IS NOT NULL
                 AND o.sent_at IS NOT NULL
                 AND o.sent_at >= ${since}
            ) AS h
           GROUP BY h.tenant_id, h.bucket_at
          HAVING SUM(h.app) > 0
        `,
      }),
    },
  ],
};
