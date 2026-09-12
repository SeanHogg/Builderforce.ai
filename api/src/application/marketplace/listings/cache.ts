/**
 * The marketplace listing caches — the browse feed's version token, one key per
 * public listing, and the never-invalidated snapshot key. Split out of
 * `../creationListings.ts` (whose header explains the three rows a publish writes);
 * that module re-exports the public names.
 */
import type { Env } from '../../../env';
import { bumpCacheVersion, invalidateCached } from '../../../infrastructure/cache/readThroughCache';

// ---------------------------------------------------------------------------
// Cache keys
// ---------------------------------------------------------------------------

/**
 * The public browse feed is searchable and filterable (q / kind / page) — an
 * UNBOUNDED keyspace — so it is cached behind a version token that every write
 * bumps, orphaning every cached variant at once. Same shape as the skills feed in
 * `marketplaceRoutes.ts`, deliberately: two invalidation strategies for two public
 * catalogues is how one of them goes stale for a fortnight without anyone noticing.
 */
/**
 * Exported because it is the invalidation signal for readers OUTSIDE this
 * module, not just for the browse feed.
 *
 * `application/ide/siteListing.ts` caches which listing sells a hosted site and
 * the seller facts that decide access to it, and both answers change on exactly
 * the writes that bump this token. Folding the token into that cache's KEY means
 * a publish, a re-publish, a price change or a withdrawal orphans it
 * automatically — no call from here into the hosting side, no import cycle, and
 * no reader this module has to remember exists. The alternative, a list of
 * invalidation callbacks, is a list somebody eventually forgets to add to.
 */
export const LISTINGS_VERSION_KEY = 'marketplace:creations:list';
export const LISTINGS_TTL_SECONDS = 120;

/** A single listing's public payload. Bounded keyspace (one key per slug), so it
 *  is invalidated by key rather than by version token. */
export const listingCacheKey = (slug: string) => `marketplace:creation:${slug}`;

/**
 * A published snapshot, keyed by its id — and NEVER invalidated, because it can
 * never change.
 *
 * This is the one cache here that needs no invalidation story at all, and the
 * reason is a property of the design rather than a hope: a re-publish writes a
 * NEW snapshot and points the listing at it, so the row behind a given id is
 * immutable from the moment it exists. That makes the hot path — a popular free
 * game being launched by strangers — a cache hit that never goes stale, which is
 * the difference between a marketplace people play in and one that reads a JSONB
 * document out of Postgres on every press of a Play button.
 */
export const snapshotCacheKey = (snapshotId: string) => `marketplace:snapshot:${snapshotId}`;
export const SNAPSHOT_TTL_SECONDS = 3600;

export async function invalidateListingCaches(env: Env, slug?: string): Promise<void> {
  await Promise.all([
    bumpCacheVersion(env, LISTINGS_VERSION_KEY),
    slug ? invalidateCached(env, listingCacheKey(slug)) : Promise.resolve(),
  ]);
}
