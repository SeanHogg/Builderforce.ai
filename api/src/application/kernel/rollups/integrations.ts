/**
 * The WRITER for `integrations.*` metric facts.
 *
 * ── TWO REGISTERS, ONE NUMBER ───────────────────────────────────────────────
 * A workspace's connections live in two places by design: `connections` is the
 * connected-accounts primitive every social/ads/analytics/drive/mailbox port
 * instantiates, and `connector_connections` belongs to the 0410 connector
 * platform where a vendor is manifest DATA. Nobody asks "how many connected
 * accounts versus how many connector connections" — they ask whether the
 * workspace is wired up. So it is ONE key with the register as a
 * `dimension_key`, the shape `legal.renewals_due` already uses.
 *
 * ── A SYNC ERROR IS DATED BY THE SYNC ───────────────────────────────────────
 * `integration_sync_logs.started_at` gives the failure a day of its own, which
 * is what makes "did the Tuesday deploy break the HubSpot sync" answerable. A
 * count of currently-erroring credentials could not answer it, because a
 * credential that has since recovered leaves no trace in a current-state read.
 */

import { sql } from 'drizzle-orm';
import { fact, type DomainRollup, type PresentTables } from '../metricRollup';

const WINDOW_DAYS = 60;
const since = sql`DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')`;

function connectedRows(present: PresentTables) {
  const parts = [];
  if (present.has('connections')) {
    parts.push(sql`
      SELECT c.tenant_id, 'account' AS register
        FROM connections c
       WHERE c.tenant_id IS NOT NULL AND LOWER(COALESCE(c.status, 'connected')) = 'connected'
    `);
  }
  if (present.has('connector_connections')) {
    parts.push(sql`
      SELECT cc.tenant_id, 'connector' AS register
        FROM connector_connections cc
       WHERE cc.tenant_id IS NOT NULL AND cc.enabled = true
    `);
  }
  return parts.length ? sql.join(parts, sql` UNION ALL `) : null;
}

export const INTEGRATIONS_ROLLUP: DomainRollup = {
  domain: 'integrations',
  metrics: [
    {
      key: 'integrations.connected',
      requires: [],
      build: (present) => {
        const rows = connectedRows(present);
        if (!rows) return null;
        return [
          fact({
            metric: 'integrations.connected',
            bucket: 'day',
            unit: 'connections',
            tenant: sql`r.tenant_id`,
            bucketAt: sql`DATE_TRUNC('day', NOW())`,
            value: sql`COUNT(*)`,
            tail: sql`FROM (${rows}) AS r GROUP BY r.tenant_id`,
          }),
          fact({
            metric: 'integrations.connected',
            bucket: 'day',
            unit: 'connections',
            tenant: sql`r.tenant_id`,
            bucketAt: sql`DATE_TRUNC('day', NOW())`,
            value: sql`COUNT(*)`,
            dimension: sql`JSONB_BUILD_OBJECT('register', r.register)`,
            dimensionKey: sql`'register:' || r.register`,
            tail: sql`FROM (${rows}) AS r GROUP BY r.tenant_id, r.register`,
          }),
        ];
      },
    },
    {
      key: 'integrations.sync_errors',
      requires: ['integration_sync_logs'],
      build: () => fact({
        metric: 'integrations.sync_errors',
        bucket: 'day',
        unit: 'failures',
        tenant: sql`l.tenant_id`,
        bucketAt: sql`DATE_TRUNC('day', l.started_at)`,
        // Both halves of a failure: a run that reported `error`, and a run that
        // reported success while dropping rows. The second is the one that goes
        // unnoticed, which is precisely why it belongs in the same number.
        value: sql`COUNT(*) FILTER (WHERE LOWER(COALESCE(l.status, '')) = 'error' OR COALESCE(l.items_errored, 0) > 0)`,
        tail: sql`
            FROM integration_sync_logs l
           WHERE l.tenant_id IS NOT NULL AND l.started_at >= ${since}
           GROUP BY l.tenant_id, DATE_TRUNC('day', l.started_at)
          HAVING COUNT(*) FILTER (WHERE LOWER(COALESCE(l.status, '')) = 'error' OR COALESCE(l.items_errored, 0) > 0) > 0
        `,
      }),
    },
  ],
};
