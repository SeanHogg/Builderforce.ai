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
 * ── WHERE THE ROWS ARE READ ─────────────────────────────────────────────────
 * The site tables live on the APPS database; `marketing_leads`, `objects` and
 * `metric_facts` on the core one, and no statement can span the two. So each
 * metric aggregates its site rows on the apps database first — to the finest grain
 * any of its facts needs — and the facts select from those rows ({@link rowsTable}),
 * UNIONed with core rows where the metric spans both.
 *
 * See {@link ../metricRollup} for the engine, the honesty rule (no
 * zero-fill) and why an attributed row must carry its own dimension key.
 */

import { sql } from 'drizzle-orm';
import type { Db } from '../../../infrastructure/database/connection';
import { fact, objectRef, resultRows, rowsTable, type DomainRollup, type PresentTables, type RowsColumn } from '../metricRollup';

/** How much history each pass recomputes. Long enough to repair a gap left by a
 *  failed sweep, short enough that the pass stays a bounded scan. */
const WINDOW_DAYS = 90;

const since = sql`DATE_TRUNC('day', NOW()) - (${WINDOW_DAYS} * INTERVAL '1 day')`;

/** Identified site submissions per (tenant, site, day) — read on the apps database. */
const SITE_LEAD_COLUMNS: readonly RowsColumn[] = [
  { name: 'tenant_id', type: 'int' },
  { name: 'site_id', type: 'int' },
  { name: 'subdomain', type: 'text' },
  { name: 'bucket_at', type: 'timestamp' },
  { name: 'n', type: 'bigint' },
];

/**
 * One grouped read serves both lead facts: the per-site grain is the attributed
 * series, and the tenant total is its sum. The joins lose no record — every
 * `site_records` row has a collection and every collection a site (both NOT NULL,
 * cascading FKs) — so the total is the same count the un-joined scan gave.
 */
async function siteLeadRows(apps: Db) {
  return resultRows(await apps.execute(sql`
    SELECT r.tenant_id, s.id AS site_id, s.subdomain, DATE_TRUNC('day', r.created_at) AS bucket_at, COUNT(*) AS n
      FROM site_records r
      JOIN site_collections c ON c.id = r.collection_id
      JOIN project_sites s ON s.id = c.site_id
     WHERE r.tenant_id IS NOT NULL
       AND r.email IS NOT NULL
       AND r.created_at >= ${since}
     GROUP BY r.tenant_id, s.id, s.subdomain, DATE_TRUNC('day', r.created_at)
  `));
}

/** Completed goals per (tenant, site, day, kind) — read on the apps database. */
const CONVERSION_COLUMNS: readonly RowsColumn[] = [
  { name: 'tenant_id', type: 'int' },
  { name: 'site_id', type: 'int' },
  { name: 'subdomain', type: 'text' },
  { name: 'bucket_at', type: 'timestamp' },
  { name: 'kind', type: 'text' },
  { name: 'n', type: 'bigint' },
];

/**
 * Completed goals, from the two the platform observes first-hand, aggregated to the
 * grain every conversion fact reads from — so the rows are read once for the total,
 * the kind split and the per-site attribution alike.
 */
async function conversionRows(apps: Db, present: PresentTables) {
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
  if (!parts.length) return null;
  const site = present.has('project_sites')
    ? { column: sql`s.subdomain`, join: sql`LEFT JOIN project_sites s ON s.id = x.site_id` }
    : { column: sql`NULL::text`, join: sql`` };
  return resultRows(await apps.execute(sql`
    SELECT x.tenant_id, x.site_id, ${site.column} AS subdomain, x.bucket_at, x.kind, COUNT(*) AS n
      FROM (${sql.join(parts, sql` UNION ALL `)}) AS x
      ${site.join}
     GROUP BY x.tenant_id, x.site_id, ${site.column}, x.bucket_at, x.kind
  `));
}

export const GROWTH_ROLLUP: DomainRollup = {
  domain: 'growth',
  metrics: [
    {
      key: 'growth.leads',
      requires: ['site_records'],
      build: async (present, { apps }) => {
        const sites = rowsTable('v', SITE_LEAD_COLUMNS, await siteLeadRows(apps));
        // A lead from a published site's form and one typed into the CRM are the same
        // fact about the funnel, so the headline is ONE series over both sources.
        const crm = present.has('marketing_leads')
          ? sql` UNION ALL
              SELECT m.tenant_id, DATE_TRUNC('day', m.created_at) AS bucket_at, 1::bigint AS n
                FROM marketing_leads m
               WHERE m.tenant_id IS NOT NULL
                 AND m.email IS NOT NULL
                 AND m.created_at >= ${since}`
          : sql``;
        return [
          fact({
            metric: 'growth.leads',
            bucket: 'day',
            unit: 'leads',
            tenant: sql`l.tenant_id`,
            bucketAt: sql`l.bucket_at`,
            value: sql`SUM(l.n)`,
            tail: sql`FROM (SELECT v.tenant_id, v.bucket_at, v.n FROM ${sites}${crm}) AS l GROUP BY l.tenant_id, l.bucket_at`,
          }),
          // The attributed half. Only a site submission can be attributed — a CRM
          // lead has no artifact behind it — so this reads the site rows alone. Each
          // row is already one (tenant, site, day) point.
          fact({
            metric: 'growth.leads',
            bucket: 'day',
            unit: 'leads',
            tenant: sql`v.tenant_id`,
            bucketAt: sql`v.bucket_at`,
            value: sql`v.n`,
            dimension: sql`JSONB_BUILD_OBJECT('site', v.subdomain, 'site_id', v.site_id)`,
            dimensionKey: sql`'site:' || v.site_id`,
            objectId: objectRef('site', sql`v.tenant_id`, sql`v.site_id::text`),
            tail: sql`FROM ${sites}`,
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
      build: async (present, { apps }) => {
        const rows = await conversionRows(apps, present);
        if (!rows) return null;
        const c = rowsTable('c', CONVERSION_COLUMNS, rows);
        return [
          fact({
            metric: 'growth.conversions',
            bucket: 'day',
            unit: 'conversions',
            tenant: sql`c.tenant_id`,
            bucketAt: sql`c.bucket_at`,
            value: sql`SUM(c.n)`,
            tail: sql`FROM ${c} GROUP BY c.tenant_id, c.bucket_at`,
          }),
          fact({
            metric: 'growth.conversions',
            bucket: 'day',
            unit: 'conversions',
            tenant: sql`c.tenant_id`,
            bucketAt: sql`c.bucket_at`,
            value: sql`SUM(c.n)`,
            dimension: sql`JSONB_BUILD_OBJECT('kind', c.kind)`,
            dimensionKey: sql`'kind:' || c.kind`,
            tail: sql`FROM ${c} GROUP BY c.tenant_id, c.bucket_at, c.kind`,
          }),
          ...(present.has('project_sites')
            ? [fact({
                metric: 'growth.conversions',
                bucket: 'day',
                unit: 'conversions',
                tenant: sql`c.tenant_id`,
                bucketAt: sql`c.bucket_at`,
                value: sql`SUM(c.n)`,
                dimension: sql`JSONB_BUILD_OBJECT('site', c.subdomain, 'site_id', c.site_id)`,
                dimensionKey: sql`'site:' || c.site_id`,
                objectId: objectRef('site', sql`c.tenant_id`, sql`c.site_id::text`),
                // `subdomain IS NOT NULL` is the inner join the single-database query
                // made: a conversion whose site row is gone is counted in the total but
                // cannot be attributed to an artifact that no longer exists.
                tail: sql`
                    FROM ${c}
                   WHERE c.subdomain IS NOT NULL
                   GROUP BY c.tenant_id, c.site_id, c.subdomain, c.bucket_at
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
