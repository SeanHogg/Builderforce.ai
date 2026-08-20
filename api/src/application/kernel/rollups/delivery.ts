/**
 * The WRITER for `delivery.*` metric facts.
 *
 * Throughput, cycle time and WIP — the three numbers a delivery surface leads
 * with, all of them declared by `DOMAIN_MANIFEST` and produced by nothing until
 * this existed.
 *
 * ── TENANCY COMES FROM THE PROJECT ──────────────────────────────────────────
 * `tasks` has no `tenant_id` — it is scoped through `projects`, which is why
 * every aggregate here joins rather than reading a column. That join is also
 * what makes the per-project attribution below free.
 *
 * ── WHY `completed_at` AND NOT `status = 'done'` ────────────────────────────
 * A status is the CURRENT state and carries no date, so bucketing throughput by
 * it would pile every ticket ever finished onto today. `completed_at` is the
 * stamp the lifecycle writes when a ticket actually lands, which is the only
 * column that can produce a series rather than a running total.
 *
 * ── ARCHIVED WORK IS NOT DELETED WORK ───────────────────────────────────────
 * `archived = false` on the WIP count and not on throughput, deliberately:
 * archiving a finished ticket must not retroactively erase the day it shipped,
 * and archiving an unfinished one is exactly how a board is cleaned up — leaving
 * it in WIP would make a tidied backlog read as an overloaded team.
 */

import { sql } from 'drizzle-orm';
import { fact, objectRef, type DomainRollup } from '../metricRollup';

const WINDOW_DAYS = 90;
const since = sql`DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')`;

/** Lanes that mean somebody is holding the ticket right now. */
const ACTIVE = sql`('in_progress', 'in_review')`;

export const DELIVERY_ROLLUP: DomainRollup = {
  domain: 'delivery',
  metrics: [
    {
      key: 'delivery.throughput',
      requires: ['tasks', 'projects'],
      build: () => [
        fact({
          metric: 'delivery.throughput',
          bucket: 'day',
          unit: 'tickets',
          tenant: sql`p.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', t.completed_at)`,
          value: sql`COUNT(*)`,
          tail: sql`
              FROM tasks t
              JOIN projects p ON p.id = t.project_id
             WHERE p.tenant_id IS NOT NULL
               AND t.completed_at IS NOT NULL
               AND t.completed_at >= ${since}
             GROUP BY p.tenant_id, DATE_TRUNC('day', t.completed_at)
          `,
        }),
        // Attributed to the project object, so "which of the things we are
        // building is actually moving" is a slice of the same series rather
        // than a second query nobody writes.
        fact({
          metric: 'delivery.throughput',
          bucket: 'day',
          unit: 'tickets',
          tenant: sql`p.tenant_id`,
          bucketAt: sql`DATE_TRUNC('day', t.completed_at)`,
          value: sql`COUNT(*)`,
          dimension: sql`JSONB_BUILD_OBJECT('project', p.name, 'project_id', p.id)`,
          dimensionKey: sql`'project:' || p.id`,
          objectId: objectRef('project', sql`p.tenant_id`, sql`p.id::text`),
          tail: sql`
              FROM tasks t
              JOIN projects p ON p.id = t.project_id
             WHERE p.tenant_id IS NOT NULL
               AND t.completed_at IS NOT NULL
               AND t.completed_at >= ${since}
             GROUP BY p.tenant_id, p.id, p.name, DATE_TRUNC('day', t.completed_at)
          `,
        }),
      ],
    },
    {
      key: 'delivery.cycle_time_hours',
      requires: ['tasks', 'projects'],
      build: () => fact({
        metric: 'delivery.cycle_time_hours',
        bucket: 'day',
        unit: 'hours',
        tenant: sql`p.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', t.completed_at)`,
        // Bucketed on the day the ticket FINISHED, not the day it started: a
        // cycle time is only knowable at the end, and dating it to the start
        // would keep rewriting history as old tickets landed.
        value: sql`AVG(EXTRACT(EPOCH FROM (t.completed_at - t.created_at)) / 3600.0)`,
        tail: sql`
            FROM tasks t
            JOIN projects p ON p.id = t.project_id
           WHERE p.tenant_id IS NOT NULL
             AND t.completed_at IS NOT NULL
             AND t.completed_at >= ${since}
             AND t.completed_at > t.created_at
           GROUP BY p.tenant_id, DATE_TRUNC('day', t.completed_at)
        `,
      }),
    },
    {
      key: 'delivery.wip',
      requires: ['tasks', 'projects'],
      build: () => fact({
        metric: 'delivery.wip',
        bucket: 'day',
        unit: 'tickets',
        tenant: sql`p.tenant_id`,
        // Bucketed on TODAY: work in progress is a statement about now, and
        // back-dating it onto each ticket's start would claim to know a WIP
        // level for days this pass never observed.
        bucketAt: sql`DATE_TRUNC('day', NOW())`,
        value: sql`COUNT(*)`,
        tail: sql`
            FROM tasks t
            JOIN projects p ON p.id = t.project_id
           WHERE p.tenant_id IS NOT NULL
             AND t.completed_at IS NULL
             AND t.archived = false
             AND t.status IN ${ACTIVE}
           GROUP BY p.tenant_id
        `,
      }),
    },
  ],
};
