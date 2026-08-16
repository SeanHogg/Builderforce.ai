/**
 * WHAT IS BEING SOLD AT THIS ADDRESS.
 *
 * ── THE GAP THIS CLOSES ──────────────────────────────────────────────────────
 * `siteVisitor.ts` decided entitlement from the visitor's SUBSCRIPTION alone:
 * signed in and not lapsed meant entitled. That is exactly right for a free app,
 * where there is no subscription to hold and requiring one would lock everybody
 * out of something nobody is charging for — and it is a hole for a PAID one,
 * because the site's own sign-in is an emailed code anybody can request. Sign
 * in, never pay, get the product.
 *
 * The missing fact was never the visitor's; it was the SELLER's. "Is this app
 * free, on sale at a price, opened to a full trial, or withdrawn?" lives on the
 * `app` listing published from the board that became this project, and nothing
 * on the serving path knew how to find it. This module is that lookup, and only
 * that lookup — the RULE it feeds stays in `creationListings.ts`, where the
 * marketplace listing page already asks it.
 *
 * ── THE CACHING SPLIT, WHICH IS THE WHOLE DESIGN ─────────────────────────────
 * What the SELLER decided changes on a publish and is cached. What the VISITOR
 * paid changes on a cancellation and is never cached at any layer — a cached
 * "yes" there is a cancelled subscription that keeps working for a TTL.
 *
 * The cache key carries the marketplace's own version token, which EVERY listing
 * write already bumps (`invalidateListingCaches`). A publish, a re-publish, a
 * price change or a withdrawal therefore orphans every cached site listing at
 * once. That is why the TTL can be generous: it is a ceiling on how long an
 * orphaned entry occupies KV, not on how long a stale answer can be served. It
 * also means the marketplace never has to call into the hosting side, so there
 * is no import cycle and no list of invalidation callbacks to forget.
 */

import { and, eq, sql } from 'drizzle-orm';
import type { Env } from '../../env';
import type { Db } from '../../infrastructure/database/connection';
import {
  SESSION_PROJECT_LINK_APP,
  catalogItems,
  creationSessionProjectLinks,
  creationSessions,
} from '../../infrastructure/database/schema';
import { getCacheVersion, getOrSetCached } from '../../infrastructure/cache/readThroughCache';
import { LISTINGS_VERSION_KEY, type ListingAccessFacts } from '../marketplace/creationListings';
import type { SiteRecord } from './siteHosting';

/** The listing kind that sells access to a hosted app. One value from the shared
 *  contract's registry, named here so the query reads as what it means. */
const APP_LISTING_KIND = 'app';

/** How long an ORPHANED entry may sit in KV. Not a staleness bound — see the
 *  module header; the version token in the key is what makes it correct. */
const SITE_LISTING_TTL_SECONDS = 600;

/** What sells a site, and on what terms. The slug is what a shop window's
 *  checkout button needs; the facts are what the access rule needs. `name` and
 *  `currency` are what the commerce widget needs to say "Subscribe to X — $Y/mo"
 *  without a second query of its own. */
export interface SiteListing extends ListingAccessFacts {
  slug: string;
  name: string;
  currency: string;
  /** The version currently on sale — what an existing subscriber is OFFERED, never
   *  moved onto without accepting. Null for a listing that has never published one. */
  currentSnapshotId: string | null;
}

/**
 * The `app` listing that sells access to this site, or null when nothing does.
 *
 * The join is the identity one: the site's project ← the board that BECAME it
 * (`link_kind = 'app'`) → the `app` listing published from that board. There is
 * deliberately no denormalised pointer on `project_sites` — a second copy of
 * "what sells this app" is a second thing to keep true when a seller
 * re-publishes.
 */
export async function resolveSiteListing(
  db: Db,
  target: { tenantId: number; projectId: number },
): Promise<SiteListing | null> {
  const [row] = await db
    .select({
      slug: catalogItems.slug,
      name: catalogItems.name,
      currency: catalogItems.currency,
      visibility: catalogItems.visibility,
      priceCents: catalogItems.priceCents,
      // Projected here rather than by pulling the whole JSONB body across: each
      // reader needs exactly one key out of it.
      trial: sql<string | null>`${catalogItems.body} ->> 'trial'`,
      currentSnapshotId: sql<string | null>`${catalogItems.body} ->> 'snapshotId'`,
    })
    .from(creationSessionProjectLinks)
    .innerJoin(creationSessions, eq(creationSessions.id, creationSessionProjectLinks.sessionId))
    .innerJoin(catalogItems, and(
      // `(tenant_id, kind, …)` is the leading edge of `uq_catalog_items_slug`, so
      // the JSONB comparison below only ever runs over this tenant's app
      // listings — a handful of rows — rather than over the whole catalogue.
      eq(catalogItems.tenantId, target.tenantId),
      eq(catalogItems.kind, APP_LISTING_KIND),
      // The listing records its source board in `body.source.sessionId` — the
      // same coordinates `publishCreationListing` writes.
      sql`${catalogItems.body} -> 'source' ->> 'sessionId' = ${creationSessions.id}::text`,
    ))
    .where(and(
      eq(creationSessionProjectLinks.projectId, target.projectId),
      eq(creationSessionProjectLinks.linkKind, SESSION_PROJECT_LINK_APP),
      // The tenant gate is on the SESSION: the link table carries no tenant of
      // its own, so reading by project id alone would answer across workspaces.
      eq(creationSessions.tenantId, target.tenantId),
    ))
    // A live listing beats a staged one: staging writes a real `private` row with
    // no publish date, and it is not what a visitor is being sold.
    .orderBy(sql`${catalogItems.publishedAt} DESC NULLS LAST`)
    .limit(1);
  if (!row) return null;
  return {
    slug: row.slug,
    name: row.name,
    currency: row.currency,
    visibility: row.visibility,
    priceCents: row.priceCents,
    trial: (row.trial as ListingAccessFacts['trial']) ?? null,
    currentSnapshotId: row.currentSnapshotId ?? null,
  };
}

/**
 * The same answer, read-through cached — the form the SERVING path uses.
 *
 * Split from {@link resolveSiteListing} rather than given a "skip the cache"
 * flag: a boolean that silently changes whether a function caches is how a hot
 * path ends up uncached without anybody noticing.
 */
export async function siteListing(
  env: Env,
  db: Db,
  site: Pick<SiteRecord, 'siteId' | 'tenantId' | 'projectId'>,
): Promise<SiteListing | null> {
  const version = await getCacheVersion(env, LISTINGS_VERSION_KEY);
  return getOrSetCached<SiteListing | null>(
    env,
    `site-listing:${site.siteId}:v${version}`,
    () => resolveSiteListing(db, site),
    { kvTtlSeconds: SITE_LISTING_TTL_SECONDS },
  );
}
