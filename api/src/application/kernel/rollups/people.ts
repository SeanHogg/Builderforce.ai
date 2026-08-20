/**
 * The WRITER for `people.*` metric facts.
 *
 * ── HEADCOUNT IS A POINT, ATTRITION IS A FLOW ───────────────────────────────
 * Headcount is "how many people work here right now" and is bucketed on today;
 * attrition is "how many left in this month" and is bucketed on each leaver's
 * own `ended_at`. Bucketing both the same way is the classic error: a headcount
 * series dated by hire date reports the company as it was on the day each person
 * arrived, which is never a number anyone had.
 *
 * ── ENGAGEMENT IS THE PULSE SCORE, AND IT REFUSES WHEN NOBODY ANSWERED ──────
 * A month with no pulse responses has no engagement score. Writing 0 would put
 * the company at rock bottom for every quiet month — and `trigger` objects fire
 * on these keys with `below` comparators, so the fabricated value is the one
 * that pages somebody.
 */

import { sql } from 'drizzle-orm';
import { fact, type DomainRollup } from '../metricRollup';

const WINDOW_MONTHS = 24;
const since = sql`DATE_TRUNC('month', NOW()) - (${WINDOW_MONTHS} * INTERVAL '1 month')`;

/** Employment states that mean somebody is still on the payroll. */
const EMPLOYED = sql`('active', 'on_leave', 'probation', 'notice')`;

export const PEOPLE_ROLLUP: DomainRollup = {
  domain: 'people',
  metrics: [
    {
      key: 'people.headcount',
      requires: ['people_employees'],
      build: () => [
        fact({
          metric: 'people.headcount',
          bucket: 'day',
          unit: 'people',
          tenant: sql`e.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', NOW())`,
          value: sql`COUNT(*)`,
          tail: sql`
              FROM people_employees e
             WHERE e.tenant_id IS NOT NULL
               AND e.ended_at IS NULL
               AND LOWER(COALESCE(e.status, 'active')) IN ${EMPLOYED}
             GROUP BY e.tenant_id
          `,
        }),
        fact({
          metric: 'people.headcount',
          bucket: 'day',
          unit: 'people',
          tenant: sql`e.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', NOW())`,
          value: sql`COUNT(*)`,
          dimension: sql`JSONB_BUILD_OBJECT('department', COALESCE(e.department, 'unassigned'))`,
          dimensionKey: sql`'department:' || COALESCE(e.department, 'unassigned')`,
          tail: sql`
              FROM people_employees e
             WHERE e.tenant_id IS NOT NULL
               AND e.ended_at IS NULL
               AND LOWER(COALESCE(e.status, 'active')) IN ${EMPLOYED}
             GROUP BY e.tenant_id, e.department
          `,
        }),
      ],
    },
    {
      key: 'people.attrition',
      requires: ['people_employees'],
      build: () => fact({
        metric: 'people.attrition',
        bucket: 'month',
        unit: 'people',
        tenant: sql`e.tenant_id`,
        bucketAt: sql`DATE_TRUNC('month', e.ended_at::timestamp)`,
        value: sql`COUNT(*)`,
        tail: sql`
            FROM people_employees e
           WHERE e.tenant_id IS NOT NULL
             AND e.ended_at IS NOT NULL
             AND e.ended_at::timestamp >= ${since}
           GROUP BY e.tenant_id, DATE_TRUNC('month', e.ended_at::timestamp)
        `,
      }),
    },
    {
      key: 'people.engagement',
      requires: ['pulse_responses'],
      build: () => fact({
        metric: 'people.engagement',
        bucket: 'month',
        unit: 'score',
        tenant: sql`r.tenant_id`,
        bucketAt: sql`DATE_TRUNC('month', r.created_at)`,
        value: sql`AVG(r.score)`,
        tail: sql`
            FROM pulse_responses r
           WHERE r.tenant_id IS NOT NULL
             AND r.score IS NOT NULL
             AND r.created_at >= ${since}
           GROUP BY r.tenant_id, DATE_TRUNC('month', r.created_at)
        `,
      }),
    },
  ],
};
