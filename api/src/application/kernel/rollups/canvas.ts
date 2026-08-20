/**
 * The WRITER for `canvas.*` metric facts.
 *
 * ── "SHIPPED" HAS ONE DEFINITION AND IT ALREADY EXISTED ─────────────────────
 * `outcomeMetricContract.ts` states the delivery vocabulary — `artifact.deliver`,
 * `artifact.publish`, `workflow.execute` — and its own header asks callers not to
 * "hand-type a fourth spelling of what a delivery is". `canvas.shipped` is
 * exactly that question asked of `metric_facts` instead of the session ledger, so
 * it imports the list rather than restating it. A canvas tile and the outcome
 * scorecard disagreeing about what shipped would make both unusable.
 *
 * ── THE JOIN THE TWO HALVES NEVER HAD ───────────────────────────────────────
 * `creation_outcome_events` measures the PROCESS (a session produced an artifact
 * in 1.1 minutes) and `metric_facts` measures the OUTCOME (the tenant got some
 * leads), and they shared no key — so "this artifact produced those leads" was
 * not a query anybody could write. `canvas.shipped` is written per SESSION as
 * well as per tenant, attributed to that session's registry object, which puts
 * both halves in one table keyed by the same `object_id` the growth rollup
 * stamps on the site a session published.
 */

import { sql } from 'drizzle-orm';
import { fact, objectRef, type DomainRollup } from '../metricRollup';
import { DELIVERY_ACTIONS, outcomeActionList } from '../../outcomes/outcomeMetricContract';

const WINDOW_DAYS = 90;
const since = sql`DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')`;

const DELIVERED = outcomeActionList(DELIVERY_ACTIONS);

export const CANVAS_ROLLUP: DomainRollup = {
  domain: 'canvas',
  metrics: [
    {
      key: 'canvas.sessions',
      requires: ['creation_sessions'],
      build: () => fact({
        metric: 'canvas.sessions',
        bucket: 'day',
        unit: 'sessions',
        tenant: sql`s.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', s.created_at)`,
        value: sql`COUNT(*)`,
        tail: sql`
            FROM creation_sessions s
           WHERE s.tenant_id IS NOT NULL
             AND s.archived_at IS NULL
             AND s.created_at >= ${since}
           GROUP BY s.tenant_id, DATE_TRUNC('day', s.created_at)
        `,
      }),
    },
    {
      key: 'canvas.artifacts',
      requires: ['artifacts'],
      build: () => fact({
        metric: 'canvas.artifacts',
        bucket: 'day',
        unit: 'artifacts',
        tenant: sql`a.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', a.created_at)`,
        value: sql`COUNT(*)`,
        tail: sql`
            FROM artifacts a
           WHERE a.tenant_id IS NOT NULL AND a.created_at >= ${since}
           GROUP BY a.tenant_id, DATE_TRUNC('day', a.created_at)
        `,
      }),
    },
    {
      key: 'canvas.shipped',
      requires: ['creation_outcome_events'],
      build: () => [
        fact({
          metric: 'canvas.shipped',
          bucket: 'day',
          unit: 'deliveries',
          tenant: sql`e.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', e.occurred_at)`,
          value: sql`COUNT(*)`,
          tail: sql`
              FROM creation_outcome_events e
             WHERE e.tenant_id IS NOT NULL
               AND e.action IN (${DELIVERED})
               AND e.phase = 'succeeded'
               AND e.occurred_at >= ${since}
             GROUP BY e.tenant_id, DATE_TRUNC('day', e.occurred_at)
          `,
        }),
        // The attributed half — the join that turns "output" into "impact".
        fact({
          metric: 'canvas.shipped',
          bucket: 'day',
          unit: 'deliveries',
          tenant: sql`e.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', e.occurred_at)`,
          value: sql`COUNT(*)`,
          dimension: sql`JSONB_BUILD_OBJECT('session_id', e.session_id)`,
          dimensionKey: sql`'session:' || e.session_id`,
          objectId: objectRef('creation_session', sql`e.tenant_id`, sql`e.session_id::text`),
          tail: sql`
              FROM creation_outcome_events e
             WHERE e.tenant_id IS NOT NULL
               AND e.action IN (${DELIVERED})
               AND e.phase = 'succeeded'
               AND e.occurred_at >= ${since}
             GROUP BY e.tenant_id, e.session_id, DATE_TRUNC('day', e.occurred_at)
          `,
        }),
      ],
    },
  ],
};
