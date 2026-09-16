/**
 * The catalogue reads — the public browse feed, one public listing by slug, and
 * the seller's own management view. Split out of `../creationListings.ts`, which
 * re-exports the public names.
 */
import { and, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { LISTING_KIND_IDS, isListingKind } from '@builderforce/creation-canvas-contract';
import type { Db } from '../../../infrastructure/database/connection';
import type { Env } from '../../../env';
import { catalogItems } from '../../../infrastructure/database/schema';
import { getCacheVersion, getOrSetCached } from '../../../infrastructure/cache/readThroughCache';
import { acrossTenants } from '../../../infrastructure/database/tenantScope';
import { LISTINGS_TTL_SECONDS, LISTINGS_VERSION_KEY, listingCacheKey } from './cache';
import { toView, type CreationListingView, type ListingBody } from './model';

export interface BrowseQuery {
  q?: string;
  kind?: string;
  page?: number;
  limit?: number;
  /**
   * Scope the feed to ONE seller — the `publisherRef` behind the `sellerRef` every
   * listing view already publishes, so a caller filters by exactly the value it
   * reads back off a card rather than by a second identifier it has to look up.
   *
   * This is what lets a profile surface show "everything by this advisor" without a
   * private endpoint: it narrows the SAME public predicate (`visibility = 'public'`
   * and published) rather than relaxing it, so an unpublished or withdrawn listing
   * stays invisible no matter whose ref is asked for. `sellerListings` remains the
   * seller's own management view — it is tenant-scoped and shows drafts, which is
   * precisely why it cannot serve this.
   */
  sellerRef?: string;
}

/** Bound on an untrusted ref. `publisher_ref` holds a user id; anything longer is
 *  not one, and truncating rather than rejecting keeps the feed answering — an
 *  over-long ref simply matches nothing, which is the honest result. */
const MAX_SELLER_REF = 128;

/** The seller ref as it will be matched, or '' when absent/unusable. Exported so the
 *  route and the tests agree on what normalisation happened without restating it. */
export function normalizeSellerRef(raw: string | undefined | null): string {
  return (raw ?? '').trim().slice(0, MAX_SELLER_REF);
}

/** The public feed. Cached behind the version token; every publish bumps it. */
export async function browseCreationListings(
  db: Db,
  env: Env,
  query: BrowseQuery,
): Promise<{ listings: readonly CreationListingView[]; total: number }> {
  const limit = Math.min(48, Math.max(1, Math.round(query.limit ?? 24)));
  const page = Math.max(1, Math.round(query.page ?? 1));
  const q = (query.q ?? '').trim().slice(0, 80);
  const kind = isListingKind(query.kind) ? query.kind : '';
  const sellerRef = normalizeSellerRef(query.sellerRef);
  const version = await getCacheVersion(env, LISTINGS_VERSION_KEY);
  // `sellerRef` is part of the KEY, not just the predicate. Leaving it out is how a
  // seller-scoped page and the unscoped feed collide on one entry and each serves
  // the other's rows — the scoped read is a different question, so it is a
  // different key. It goes last so every previously-cached unscoped key keeps its
  // shape, and it is the normalised value rather than the raw query so two spellings
  // of the same ref cannot occupy two entries.
  const key = `${LISTINGS_VERSION_KEY}:${version}:${kind}:${q}:${page}:${limit}:${sellerRef}`;

  return getOrSetCached(env, key, async () => {
    const where = [eq(catalogItems.visibility, 'public'), isNotNull(catalogItems.publishedAt)];
    // `catalog_items` also holds policy packs and internal presets, which are not
    // for sale to anyone. The feed is bounded to the kinds this module publishes,
    // read from the registry rather than restated — a new sellable kind must not
    // need a second edit here to become visible.
    if (kind) where.push(eq(catalogItems.kind, kind));
    else where.push(inArray(catalogItems.kind, [...LISTING_KIND_IDS]));
    if (q) {
      where.push(sql`(${catalogItems.name} ILIKE ${`%${q}%`} OR ${catalogItems.summary} ILIKE ${`%${q}%`})`);
    }
    // The shop window. Cross-tenant by definition — `visibility = 'public'` is the
    // access predicate, not the shopper's own workspace. The call is inlined at
    // both statements rather than hoisted into a local: `where` already carries
    // the shared conditions, and a scope hidden behind a variable name is exactly
    // what the guard cannot read and a reviewer skims past.
    const rows = await db
      .select()
      .from(catalogItems)
      .where(acrossTenants(catalogItems, 'public_catalogue', ...where))
      .orderBy(desc(catalogItems.installCount), desc(catalogItems.publishedAt))
      .limit(limit)
      .offset((page - 1) * limit);
    const [count] = await db
      .select({ total: sql<string>`count(*)` })
      .from(catalogItems)
      .where(acrossTenants(catalogItems, 'public_catalogue', ...where));
    return {
      listings: rows.map((row) => toView(row, row.body as ListingBody | null, false)),
      total: Number(count?.total ?? 0),
    };
  }, { kvTtlSeconds: LISTINGS_TTL_SECONDS });
}

/** One listing's public record, by slug. */
export async function getPublicListing(
  db: Db,
  env: Env,
  slug: string,
): Promise<CreationListingView | null> {
  return getOrSetCached(env, listingCacheKey(slug), async () => {
    const [row] = await db
      .select()
      .from(catalogItems)
      .where(acrossTenants(catalogItems, 'public_catalogue',
        eq(catalogItems.slug, slug), eq(catalogItems.visibility, 'public')))
      .limit(1);
    return row ? toView(row, row.body as ListingBody | null, false) : null;
  }, { kvTtlSeconds: LISTINGS_TTL_SECONDS });
}

/** Everything this seller has published, live or withdrawn. Not cached: it is the
 *  seller's own management view and must show a change the instant they make it. */
export async function sellerListings(
  db: Db,
  tenantId: number,
  userId: string,
): Promise<readonly CreationListingView[]> {
  const rows = await db
    .select()
    .from(catalogItems)
    .where(and(eq(catalogItems.tenantId, tenantId), eq(catalogItems.publisherRef, userId)))
    .orderBy(desc(catalogItems.updatedAt));
  return rows.map((row) => toView(row, row.body as ListingBody | null));
}
