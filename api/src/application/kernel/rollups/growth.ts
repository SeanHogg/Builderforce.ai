/**
 * The WRITER for `growth.*` metric facts — and the one the founder journey turns on.
 *
 * ── WHY THIS DOMAIN FIRST ───────────────────────────────────────────────────
 * `founderCanvasPrompt.ts` teaches the model, by name, to bind a canvas
 * `liveMetric` to `growth.leads`, and `canvas_refresh_live_metric` repeats the
 * key in its own tool description. Nothing on the platform ever inserted one.
 * So the flagship demo — publish a site, watch the number move — read a key with
 * no producer, and a founder whose published site was genuinely collecting
 * signups saw an empty panel. The signal was REAL and already captured in
 * `site_records` the whole time; it was simply never rolled up.
 *
 * ── WHAT COUNTS AS A LEAD ───────────────────────────────────────────────────
 * A lead is somebody who IDENTIFIED THEMSELVES: a `site_records` submission
 * carrying an email, or a `marketing_leads` row. Not a page view, not an
 * anonymous form post — an address you can reach. That definition is
 * unambiguous, which is why it ships without waiting on anything.
 *
 * ── WHAT COUNTS AS A CONVERSION ─────────────────────────────────────────────
 * A conversion is a lead who completed the site's OWN commercial goal, which for
 * a published Builderforce site is one of exactly two things the platform can
 * observe first-hand:
 *
 *   • `site_users`         — they created an account on the thing that was built;
 *   • `site_subscriptions` — they started paying for it.
 *
 * Both ride the same key, separated by `dimension_key`, because "how many people
 * converted" and "how many of them paid" are one series and a slice of it rather
 * than two metrics somebody has to remember to add up. Deliberately NOT counted:
 * a `site_records` row in a collection somebody named "signup". A collection name
 * is a label the creator typed, and letting it decide a conversion would make the
 * metric mean something different on every site — the exact ambiguity that kept
 * this key unwritten. An account or a payment means the same thing everywhere.
 *
 * ── ATTRIBUTION ─────────────────────────────────────────────────────────────
 * Every one of these three metrics is written twice: once tenant-wide, and once
 * per PUBLISHED SITE with `metric_facts.object_id` pointing at that site's
 * registry object. That column existed with its own index and an FK and was
 * never populated by anything, which meant no outcome could be traced back to
 * the artifact that produced it — we could say a session made a site in 1.1
 * minutes, and separately that the tenant got some leads, and never that THIS
 * site produced THOSE leads. The attributed rows are what make "what did the
 * thing I built actually do for anyone" a query.
 *
 * See {@link ../metricRollup} for the engine, the honesty rule (no
 * zero-fill) and why an attributed row must carry its own dimension key.
 */

import { sql } from 'drizzle-orm';
import { fact, objectRef, type DomainRollup } from '../metricRollup';

/** How much history each pass recomputes. Long enough to repair a gap left by a
 *  failed sweep, short enough that the pass stays a bounded scan. */
const WINDOW_DAYS = 90;

const since = sql`DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')`;

/**
 * Identified submissions, from every source that captures one.
 *
 * A UNION rather than two metrics: a lead that arrived through a published
 * site's form and a lead typed into the CRM are the same fact about the funnel,
 * and two keys would make the headline a sum a reader has to know to compute.
 */
function leadRows(present: ReadonlySet<string>) {
  const parts = [sql`
    SELECT r.tenant_id, DATE_TRUNC('day', r.created_at) AS bucket_at
      FROM site_records r
     WHERE r.tenant_id IS NOT NULL
       AND r.email IS NOT NULL
       AND r.created_at >= ${since}
  `];
  if (present.has('marketing_leads')) {
    parts.push(sql`
      SELECT l.tenant_id, DATE_TRUNC('day', l.created_at) AS bucket_at
        FROM marketing_leads l
       WHERE l.tenant_id IS NOT NULL
         AND l.email IS NOT NULL
         AND l.created_at >= ${since}
    `);
  }
  return sql.join(parts, sql` UNION ALL `);
}

/**
 * Completed goals, from the two the platform observes first-hand.
 *
 * `site_id` rides along so the same subquery serves the tenant total and the
 * per-site attribution without the rows being read twice.
 */
function conversionRows(present: ReadonlySet<string>) {
  const parts = [];
  if (present.has('site_users')) {
    parts.push(sql`
      SELECT u.tenant_id, u.site_id, DATE_TRUNC('day', u.created_at) AS bucket_at, 'account' AS kind
        FROM site_users u
       WHERE u.tenant_id IS NOT NULL AND u.created_at >= ${since}
    `);
  }
  if (present.has('site_subscriptions')) {
    // `status IN ('active','trialing')` and not every row: a subscription that
    // never started is not a conversion, and counting one would let a failed
    // checkout raise the number the founder judges the launch by.
    parts.push(sql`
      SELECT s.tenant_id, s.site_id, DATE_TRUNC('day', s.created_at) AS bucket_at, 'subscription' AS kind
        FROM site_subscriptions s
       WHERE s.tenant_id IS NOT NULL
         AND s.status IN ('active', 'trialing')
         AND s.created_at >= ${since}
    `);
  }
  return parts.length ? sql.join(parts, sql` UNION ALL `) : null;
}

export const GROWTH_ROLLUP: DomainRollup = {
  domain: 'growth',
  metrics: [
    {
      key: 'growth.leads',
      requires: ['site_records'],
      build: (present) => {
        const rows = leadRows(present);
        return [
          fact({
            metric: 'growth.leads',
            bucket: 'day',
            unit: 'leads',
            tenant: sql`l.tenant_id`,
            bucketAt: sql`l.bucket_at`,
            value: sql`COUNT(*)`,
            tail: sql`FROM (${rows}) AS l GROUP BY l.tenant_id, l.bucket_at`,
          }),
          // The attributed half. Only `site_records` can be attributed — a CRM
          // lead has no artifact behind it — so this reads the site path alone
          // rather than the union.
          fact({
            metric: 'growth.leads',
            bucket: 'day',
            unit: 'leads',
            tenant: sql`r.tenant_id`,
            bucketAt: sql`DATE_TRUNC('day', r.created_at)`,
            value: sql`COUNT(*)`,
            dimension: sql`JSONB_BUILD_OBJECT('site', s.subdomain, 'site_id', s.id)`,
            dimensionKey: sql`'site:' || s.id`,
            objectId: objectRef('site', sql`r.tenant_id`, sql`s.id::text`),
            tail: sql`
                FROM site_records r
                JOIN site_collections c ON c.id = r.collection_id
                JOIN project_sites s ON s.id = c.site_id
               WHERE r.tenant_id IS NOT NULL
                 AND r.email IS NOT NULL
                 AND r.created_at >= ${since}
               GROUP BY r.tenant_id, s.id, s.subdomain, DATE_TRUNC('day', r.created_at)
            `,
          }),
        ];
      },
    },
    {
      key: 'growth.conversions',
      // No hard requirement: either source alone produces a real number, and
      // demanding both would silence the metric on a site with accounts and no
      // billing — which is most of them on day one.
      requires: [],
      build: (present) => {
        const rows = conversionRows(present);
        if (!rows) return null;
        return [
          fact({
            metric: 'growth.conversions',
            bucket: 'day',
            unit: 'conversions',
            tenant: sql`c.tenant_id`,
            bucketAt: sql`c.bucket_at`,
            value: sql`COUNT(*)`,
            tail: sql`FROM (${rows}) AS c GROUP BY c.tenant_id, c.bucket_at`,
          }),
          fact({
            metric: 'growth.conversions',
            bucket: 'day',
            unit: 'conversions',
            tenant: sql`c.tenant_id`,
            bucketAt: sql`c.bucket_at`,
            value: sql`COUNT(*)`,
            dimension: sql`JSONB_BUILD_OBJECT('kind', c.kind)`,
            dimensionKey: sql`'kind:' || c.kind`,
            tail: sql`FROM (${rows}) AS c GROUP BY c.tenant_id, c.bucket_at, c.kind`,
          }),
          ...(present.has('project_sites')
            ? [fact({
                metric: 'growth.conversions',
                bucket: 'day',
                unit: 'conversions',
                tenant: sql`c.tenant_id`,
                bucketAt: sql`c.bucket_at`,
                value: sql`COUNT(*)`,
                dimension: sql`JSONB_BUILD_OBJECT('site', s.subdomain, 'site_id', s.id)`,
                dimensionKey: sql`'site:' || s.id`,
                objectId: objectRef('site', sql`c.tenant_id`, sql`s.id::text`),
                tail: sql`
                    FROM (${rows}) AS c
                    JOIN project_sites s ON s.id = c.site_id
                   GROUP BY c.tenant_id, s.id, s.subdomain, c.bucket_at
                `,
              })]
            : []),
        ];
      },
    },
    {
      key: 'growth.spend',
      requires: ['ad_insights'],
      build: () => [
        fact({
          metric: 'growth.spend',
          bucket: 'day',
          unit: 'USD',
          tenant: sql`i.tenant_id`,
          bucketAt: sql`i.date::timestamp`,
          // Cents at the adapter edge, currency units on the chart — the same
          // conversion boundary every money port on the platform draws.
          value: sql`SUM(i.spend_cents) / 100.0`,
          tail: sql`
              FROM ad_insights i
             WHERE i.tenant_id IS NOT NULL AND i.date >= (CURRENT_DATE - ${WINDOW_DAYS})
             GROUP BY i.tenant_id, i.date
          `,
        }),
        fact({
          metric: 'growth.spend',
          bucket: 'day',
          unit: 'USD',
          tenant: sql`i.tenant_id`,
          bucketAt: sql`i.date::timestamp`,
          value: sql`SUM(i.spend_cents) / 100.0`,
          dimension: sql`JSONB_BUILD_OBJECT('platform', i.platform)`,
          dimensionKey: sql`'platform:' || i.platform`,
          tail: sql`
              FROM ad_insights i
             WHERE i.tenant_id IS NOT NULL AND i.date >= (CURRENT_DATE - ${WINDOW_DAYS})
             GROUP BY i.tenant_id, i.platform, i.date
          `,
        }),
      ],
    },
  ],
};
